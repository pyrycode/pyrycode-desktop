// An in-process Noise_IK **responder** "fake daemon" — TEST-ONLY infrastructure (#91). It speaks
// the responder side of the wire protocol so automated tests can drive the REAL client initiator
// through a genuine `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake and one sealed transport
// round-trip in CI, with no Go toolchain and no network. It is the content-aware peer the
// content-blind #90 forwarder splices frames to: the daemon dials the forwarder's `/v1/server`
// leg, the client under test dials `/v1/client`.
//
// It MIRRORS noiseSession.ts as a responder: HandshakeState(NOISE_ROLE_RESPONDER), ReadMessage on
// IK message 1 (recovering the client static and the `hello` early-data), WriteMessage(hello_ack)
// on message 2, then Split into transport ciphers. It uses the exact NOISE_PROTOCOL constant and
// the production `codec` framing (encodeEnvelope / encodeInnerFrame / base64Std*) — NOT a
// hand-rolled shortcut — so a lax fake can't pass while diverging from the real daemon (AC3).
//
// It also gains a rekey-INITIATOR capability (#112, mirroring pyrycode #450/#453/#454): initiateRekey()
// seals a `rekey_request` control envelope under the current send cipher and enters
// `awaiting-rekey-init`; the client's fresh `noise_init` (msg1) is then answered as a fresh RESPONDER
// handshake (EMPTY early-data both ways, no `rekey_ack`) whose Split ciphers atomically replace the
// old ones, after which a resume frame under the NEW send cipher gives the client a deterministic
// swap signal (there is no wire ack). Throughout that window the daemon KEEPS SERVING transport
// frames under the OLD ciphers (#524) — see the routing note below. The crypto is faithful, and so
// is the OUTBOUND TAGGING (#525): the three handshake replies — initial IK msg2, rekey msg2,
// reconnect msg2 — go out as `noise_resp`, mirroring the real daemon's TypeNoiseResp (pyrycode
// internal/relay/v2session_handshake.go:241, v2session_rekey.go:146); every other outbound — the
// transport replies, the `rekey_request` control envelope, the post-rekey resume frame, the
// reconnect re-sends, pushFrame — stays `noise_msg`, mirroring TypeNoiseMsg (v2session.go:913/:954/
// :1265, v2session_rekey.go:315). The tag follows the FRAME, never the session state. Today's client
// still discards the inbound `type` and reads by session state (noiseRelayDriver.onMessage), so the
// split is behaviour-preserving — the fake is simply correct AHEAD of the client, and a client that
// starts distinguishing the two meets a faithful fake instead of a drifted one. See sendNoise.
//
// It also gains a RECONNECT capability (#416): a supervised client, on a relay drop, re-dials and
// starts a FRESH createNoiseSession carrying its `hello` — a full IK handshake whose first frame is
// tagged `noise_init` (noiseRelayDriver.ts:189/203), NOT an in-session rekey. The inner `type` is
// therefore consulted for ROUTING ONLY — mirroring the real daemon, whose top-level dispatch switches
// purely on it (pyrycode internal/relay/v2session.go:664-669). In `transport` state a `noise_init`
// routes to handleReconnect (handleMsg1's hello-recovery + hello_ack, plus handleRekeyInit's atomic
// cipher swap), reusing the SAME responder static. In `awaiting-rekey-init` (#524) the type — never
// the state — picks the path too: a `noise_init` is the client's rekey msg1 (handleRekeyInit, the
// swap); anything else is an app frame the daemon fanned out before that msg1 landed, so it is SERVED
// by handleTransport under the OLD ciphers with the state held, per spec #450's "transport frames
// continue flowing under the OLD CipherStates". Both are exactly the routing signal the driver
// documents, so branching on it is faithful. Transport-frame INTERPRETATION still relies solely on
// the Noise state machine + AEAD: a hostile `type` cannot misroute a transport frame — in the rekey
// window it only redirects an undecryptable frame from `handshake-read-failed` to
// `transport-decrypt-failed`, the AEAD remaining the sole authority on whether the frame opens — and
// a hostile `noise_init` triggers only a fresh-handshake attempt that FAILS CLOSED
// (`handshake-read-failed`) — never a downgrade or a transport bypass.
// pushFrame() seals a server-initiated frame under the current send cipher (the initiateRekey
// seal-and-stream minus the state transition); reconnectResendFrames stream after the reconnect
// hello_ack under the new send cipher. All three are modal-agnostic — the modal specifics live only
// in the tests.
//
// Split() send/recv role-mapping (AC4, load-bearing): `noise-c.wasm` returns the two transport
// ciphers already role-adjusted as `[send, recv]` for BOTH roles (noise-c.wasm.d.ts:47-51,
// confirmed against the 0.4.0 wrapper's `[send, receive]` doc + the noise-c C API), so the
// responder uses the SAME mapping as the initiator — sendCipher = split[0], recvCipher = split[1],
// no swap. The flynn/noise responder swaps because flynn returns the raw pair; noise-c does not.
// Crossing the mapping still completes the handshake but MAC-fails the first transport frame — so
// the round-trip self-test (fakeDaemon.test.ts) is the deterministic oracle that pins this.
//
// TEST-ONLY — it holds a Noise static key and a permissive `ws://` dialer, so it MUST NEVER be
// imported into the production graph (src/main/index.ts, src/preload, src/renderer). Its only
// importers are *.test.ts and (later) the #89 round-trip consumer, exactly like fakeRelayForwarder.
//
// LOG-FREE by construction (mirrors noiseSession.ts / codec.ts): no console.*, and NO key, token,
// or frame/plaintext bytes in any diagnostic. Every caught wasm/codec error is CLASSIFIED into a
// static FakeDaemonErrorReason and the caught object dropped — a library error string can echo
// transcript bytes. All observable behaviour is via the handle and the spliced frames.
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import { type NoiseCipherState } from 'noise-c.wasm'
import { NOISE_PROTOCOL, MAX_FRAME_BYTES, type HelloAckPayload, type Envelope } from '../../shared/wire/types'
import { loadNoiseLib } from './noiseLib'
import {
  encodeEnvelope,
  decodeEnvelope,
  encodeInnerFrame,
  decodeInnerFrame,
  base64StdEncode,
  base64StdDecode
} from './codec'

// Empty associated-data for every transport frame — the v2 suite's mandate, matching noiseSession
// and the daemon (its CipherState has no AD parameter). Shared, never mutated.
const EMPTY_AD = new Uint8Array(0)

// Fixed, deterministic hello_ack envelope framing. The client's parseHelloAck reads only the four
// payload fields; `id`/`ts` are required to be a number/string but their values are not inspected,
// so a fixed pair keeps the fake deterministic and wall-clock-free.
const HELLO_ACK_ID = 1
const HELLO_ACK_TS = '2026-01-01T00:00:00Z'

// Fixed, deterministic framing for the sealed `rekey_request` control envelope the daemon streams
// to trigger an in-session rekey (mirrors HELLO_ACK_ID/TS). The client's #108 recognizer peeks only
// `.type`; `id`/`ts`/`payload` values are not inspected, so fixed values keep the fake wall-clock-free.
const REKEY_REQUEST_ID = 2
const REKEY_REQUEST_TS = '2026-01-01T00:00:00Z'

// Fixed, deterministic framing for the `attachment_stored` reply attachmentStoredReplyFrames builds
// (mirrors HELLO_ACK_ID/TS). Only `in_reply_to` and the payload carry meaning there; `id`/`ts` are
// required by the codec but inspected by nothing, so fixed values keep the fake wall-clock-free.
const ATTACHMENT_STORED_ID = 7001
const ATTACHMENT_STORED_TS = '2026-01-01T00:00:00Z'

// The default post-rekey "resume" frame: a fixed `message` envelope the daemon seals under the NEW
// send cipher immediately after its swap. There is no `rekey_ack`, so this frame — decrypting under
// the client's fresh recv cipher — is the deterministic client-side signal that the client finished
// swapping to the new keys. Exported so a test can assert the exact bytes; overridable per run via
// FakeDaemonOptions.rekeyResumeMessage. Built via the production codec with the file's deterministic
// id/ts convention (a module-load-time pure call — no wall clock, no randomness).
export const DEFAULT_REKEY_RESUME_MESSAGE: Uint8Array = encodeEnvelope({
  id: 3,
  type: 'message',
  ts: '2026-01-01T00:00:00Z',
  payload: {
    conversation_id: 'rekey',
    message_id: 'rekey-resume-1',
    role: 'assistant',
    text: 'resumed under new keys'
  }
})

/**
 * A `buildReplyFrames` builder that answers an attachment upload the way the real daemon does (#964):
 * ONE `attachment_stored` for the chunk that completed the transfer, and SILENCE for everything else.
 *
 * The caller names WHICH chunk index completes, and that parameter is the point of the factory rather
 * than a convenience. Upstream's rule is that `in_reply_to` carries the envelope id of the chunk WHOSE
 * ARRIVAL COMPLETED THE TRANSFER — not the highest index. Chunks are index-addressed and may be
 * reassembled in any order, so the completing chunk is whichever one closed the set and a client cannot
 * predict which of its envelope ids that will be. A fake that always answered the last chunk would let a
 * consumer keying on a PREDICTED final envelope id pass forever; naming a non-final index makes that
 * failure mode reachable in a test.
 *
 * Every other chunk of a healthy upload gets NO REPLY AT ALL, which is why this cannot simply answer
 * every chunk. A non-`attachment_chunk` frame and an undecodable one both yield `[]` — the fake answers
 * only what it understands, and a decode failure inside it must not masquerade as a daemon-side crash.
 *
 * STATELESS BY CONSTRUCTION: the closure holds one number and no arrival set. Two transfers interleaving
 * on one session therefore cannot race here, and there is nothing to reset between tests.
 *
 * ⭐ A CHUNK NAMING NO CONVERSATION IS REFUSED, ON EVERY INDEX (#1205). This mirrors pyrycode #2143: the
 * daemon files an upload under the conversation the chunk names, has no cursor to fall back to, and
 * answers an absent or empty `conversation_id` with `attachment.invalid_chunk` on the first chunk carrying
 * it. The fake answers every such chunk rather than only the first — it keeps no arrival set — and a
 * transfer settles on its first reject regardless, so the client-visible outcome is the same. It is here,
 * in the HEALTHY fake, so that a client which stops sending the field goes red in the unit tier rather
 * than in the operator's composer, which is exactly how the omission reached production. Not a registry
 * check: the fake hosts no conversations, so any non-empty string is "known" to it.
 *
 * Test-only scaffolding, and it lives beside the fake for DEFAULT_REKEY_RESUME_MESSAGE's reason: the fake
 * owns the daemon's side of the protocol, a test owns the assertions.
 */
export function attachmentStoredReplyFrames(
  completingIndex: number
): (inboundPlaintext: Uint8Array) => Uint8Array[] {
  return (inboundPlaintext: Uint8Array): Uint8Array[] => {
    let envelope: ReturnType<typeof decodeEnvelope>
    try {
      envelope = decodeEnvelope(inboundPlaintext)
    } catch {
      return [] // not an envelope at all — nothing to answer
    }
    if (envelope.type !== 'attachment_chunk') return []
    const payload = envelope.payload
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return []
    const {
      attachment_id: attachmentId,
      conversation_id: conversationId,
      index
    } = payload as Record<string, unknown>
    if (typeof conversationId !== 'string' || conversationId === '') {
      return [attachmentRejectEnvelope(envelope.id, 'attachment.invalid_chunk')]
    }
    if (typeof attachmentId !== 'string' || index !== completingIndex) return []
    return [
      encodeEnvelope({
        id: ATTACHMENT_STORED_ID,
        type: 'attachment_stored',
        ts: ATTACHMENT_STORED_TS,
        // The chunk THIS reply answers — the one that completed the set, whatever its index.
        in_reply_to: envelope.id,
        payload: { attachment_id: attachmentId }
      })
    ]
  }
}

/**
 * The six reject codes the upload leg can answer a chunk with (#965). Verified against pyrycode
 * `internal/protocol/codes.go` on 2026-09-03. `attachment.not_found` and `attachment.stream_aborted`
 * are absent on purpose: both exist upstream but belong to the RETRIEVAL direction (#687), so a fake
 * that could emit them here would let a test assert a contract this leg does not have.
 */
export type AttachmentRejectCode =
  | 'attachment.invalid_chunk'
  | 'attachment.integrity_failed'
  | 'attachment.too_large'
  | 'attachment.too_many_uploads'
  | 'attachment.storage_failed'
  | 'message.too_long'

/**
 * The daemon's own reject table, mirrored: the STATIC message and the retryability it publishes for each
 * code (`internal/relay/v2session_attachment.go`'s `rejectInvalidChunk` … `rejectStorageFailed`, whose
 * flags are `false, false, false, true, true`). Mirrored rather than inferred from the code names, and
 * carried so a fixture is a REAL reject instead of a code in an empty shell — which is what makes the
 * client-side content-free outcome and retryability assertions prove something.
 *
 * `message.too_long` is the one entry with no upstream text to mirror: the code is declared in
 * `codes.go` but has no emit site in the Go tree, so its message here is FAKE-OWNED. It is static and
 * path-free like the others, which is all any client may assume of it.
 */
const ATTACHMENT_REJECTS: Readonly<
  Record<AttachmentRejectCode, { message: string; retryable: boolean }>
> = {
  'attachment.invalid_chunk': { message: 'attachment chunk rejected', retryable: false },
  'attachment.integrity_failed': { message: 'attachment integrity check failed', retryable: false },
  'attachment.too_large': { message: 'attachment exceeds the per-upload byte bound', retryable: false },
  'attachment.too_many_uploads': { message: 'too many uploads in flight', retryable: true },
  'attachment.storage_failed': { message: 'attachment could not be stored', retryable: true },
  'message.too_long': { message: 'message exceeds the maximum size', retryable: false }
}

// Fixed, deterministic framing for the `error` reject attachmentRejectReplyFrames builds (mirrors
// ATTACHMENT_STORED_ID/TS). Only `in_reply_to` and the payload carry meaning; `id`/`ts` are required by
// the codec but inspected by nothing, so fixed values keep the fake wall-clock-free.
const ATTACHMENT_REJECT_ID = 7002
const ATTACHMENT_REJECT_TS = '2026-01-01T00:00:00Z'

/**
 * A `buildReplyFrames` builder that REFUSES an attachment upload the way the real daemon does (#965):
 * ONE `error` envelope correlated to the rejected chunk, and SILENCE for everything else. The sibling
 * of attachmentStoredReplyFrames above — same shape, opposite terminal.
 *
 * The parameter is `rejectedIndex`, not the sibling's `completingIndex`, and the difference is real: a
 * reject names the chunk that TRIGGERED the condition, which for `too_many_uploads` or `storage_failed`
 * can be any chunk in the stream rather than the one that closed the set. `in_reply_to` carries that
 * chunk's envelope id, which is the only correlation handle the consumer (#861) can key on.
 *
 * The payload is a faithful `{ code, message, retryable }` — the shape `attachmentReplyError` marshals.
 * `retry_after_s` is deliberately ABSENT: that field is `*int,omitempty` and the daemon's literal is
 * closed over three fields, so no attachment reject ever carries it, and a fake that invented one would
 * let a client learn a backoff duration the wire cannot supply.
 *
 * A non-`attachment_chunk` frame, a chunk at another index, and an undecodable frame all yield `[]` —
 * the fake answers only what it understands, and a decode failure inside it must not masquerade as a
 * daemon-side crash.
 *
 * STATELESS BY CONSTRUCTION, like the sibling: the closure holds one number and one string and no
 * arrival set, so two transfers interleaving on one session cannot race here and there is nothing to
 * reset between tests.
 */
export function attachmentRejectReplyFrames(
  rejectedIndex: number,
  code: AttachmentRejectCode
): (inboundPlaintext: Uint8Array) => Uint8Array[] {
  return (inboundPlaintext: Uint8Array): Uint8Array[] => {
    let envelope: ReturnType<typeof decodeEnvelope>
    try {
      envelope = decodeEnvelope(inboundPlaintext)
    } catch {
      return [] // not an envelope at all — nothing to answer
    }
    if (envelope.type !== 'attachment_chunk') return []
    const payload = envelope.payload
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return []
    const { index } = payload as Record<string, unknown>
    if (index !== rejectedIndex) return []
    return [attachmentRejectEnvelope(envelope.id, code)]
  }
}

/**
 * One reject frame answering the chunk at `inReplyTo` — the chunk that triggered the condition,
 * whatever its index. Shared by the reject builder above and by the healthy builder's absent-conversation
 * arm (#1205), so the two cannot drift in shape: a faithful `{ code, message, retryable }` and nothing
 * else, `retry_after_s` deliberately absent (see `attachmentRejectReplyFrames`).
 */
function attachmentRejectEnvelope(inReplyTo: number, code: AttachmentRejectCode): Uint8Array {
  const { message, retryable } = ATTACHMENT_REJECTS[code]
  return encodeEnvelope({
    id: ATTACHMENT_REJECT_ID,
    type: 'error',
    ts: ATTACHMENT_REJECT_TS,
    in_reply_to: inReplyTo,
    payload: { code, message, retryable }
  })
}

/** Config for one fake daemon. Test-only; nothing is persisted, no real credential is read. */
export interface FakeDaemonOptions {
  /** Base forwarder URL, no trailing path (from startFakeRelayForwarder().url). The daemon dials
   *  `${url}/v1/server`. */
  url: string
  /** Reply builder: given the decrypted inbound plaintext, return the reply plaintext to seal and
   *  stream back. Default: echo the inbound plaintext verbatim. Ignored when buildReplyFrames is set. */
  buildReply?: (inboundPlaintext: Uint8Array) => Uint8Array
  /** Streaming-serve reply builder (#116, test infra): given the decrypted inbound plaintext,
   *  return an ORDERED list of plaintext envelopes — the fake seals each as its own `noise_msg` and
   *  streams them in order (the debug-bundle `[chunk0, …, done]` or `[error]` shape). Takes
   *  precedence over buildReply when set. The one-frame `initiateRekey` streaming path is the
   *  precedent; this generalizes it to N frames per inbound. */
  buildReplyFrames?: (inboundPlaintext: Uint8Array) => Uint8Array[]
  /** hello_ack payload overrides. Defaults: protocol_version 'v2', server_id 'fake-daemon',
   *  conn_id 'conn-1', capabilities []. */
  helloAck?: Partial<HelloAckPayload>
  /** Forwarded to loadNoiseLib as its load deadline; omit for the loader default. */
  loadTimeoutMs?: number
  /** Plaintext the daemon seals under the NEW send cipher right after a rekey swap (initiateRekey).
   *  Default: DEFAULT_REKEY_RESUME_MESSAGE — a canned `message` envelope. */
  rekeyResumeMessage?: Uint8Array
  /** Ordered plaintext envelopes the daemon re-seals (under the NEW send cipher) and streams right
   *  after a RECONNECT handshake's hello_ack (#416). Default `[]`. Generalises `rekeyResumeMessage` to
   *  N frames. Modal-agnostic: the modal e2e passes `[modalShownEnvelope]` (a still-held modal re-send)
   *  or `[]` (resolved-while-away); a queue e2e would pass a `queue_state` envelope. Streaming AFTER
   *  hello_ack guarantees the client processes `connected` (→ reset) before the re-sends repopulate. */
  reconnectResendFrames?: Uint8Array[]
  /** Test-only replay negotiation probe. Receives authenticated hello; overrides unconditional resends. */
  buildReconnectFrames?: (hello: Envelope) => Uint8Array[]
}

/** Closed set of static reasons — NEVER carries key/token/frame/plaintext bytes. */
export type FakeDaemonErrorReason =
  | 'frame-decode-failed' // decodeInnerFrame/base64StdDecode threw at the leg boundary
  | 'handshake-read-failed' // msg1 ReadMessage MAC-failed / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // an inbound transport frame failed to open
  | 'closed' // close() ran before the round-trip completed

/** The outcome of one fake-daemon run. `whenSettled()` resolves this once and caches it. */
export type FakeDaemonOutcome = { ok: true } | { ok: false; reason: FakeDaemonErrorReason }

/** Handle for one fake daemon. */
export interface FakeDaemon {
  /** Responder static X25519 public key (32B). The client uses this as its remoteStaticPublicKey —
   *  the QR-known server static the real client pins. */
  staticPublicKey: Uint8Array
  /** Resolves once the responder has completed the handshake and streamed one reply (ok:true), or
   *  hit a daemon-side failure (ok:false + static reason). Never rejects. close() before completion
   *  resolves it { ok:false, reason:'closed' }. Cached: repeated calls share one promise. */
  whenSettled(): Promise<FakeDaemonOutcome>
  /** As the daemon: seal a `rekey_request` under the current send cipher, stream it, and enter
   *  `awaiting-rekey-init` to answer the client's fresh `noise_init`. That window keeps serving
   *  inbound transport frames under the CURRENT (pre-swap) ciphers (#524). No-op unless in `transport`. */
  initiateRekey(): void
  /** Server-initiated push (#416): seal `plaintext` under the CURRENT send cipher and stream it as a
   *  `noise_msg`. The `initiateRekey` seal-and-stream pattern minus the state transition. Serves in
   *  `transport` AND in `awaiting-rekey-init` (#532 — the old send cipher is still live across the
   *  rekey window, per spec #450); no-op otherwise or without a send cipher. Modal-agnostic — any
   *  envelope (the modal e2e pushes a crafted `modal_shown` to raise the initial modal mid-session). */
  pushFrame(plaintext: Uint8Array): void
  /** Tear down the WS leg + free the wasm handshake/cipher state. Idempotent. */
  close(): Promise<void>
}

type DaemonState = 'awaiting-msg1' | 'transport' | 'awaiting-rekey-init' | 'closed'

/** The two inner-frame tags this fake ever emits. Narrow on purpose: `InnerFrameV2.type` is a bare
 *  `string` (wire/types.ts), so this alias is the ONLY compile-time backstop against a typo. */
type OutboundInnerType = 'noise_resp' | 'noise_msg'

/**
 * Stand up the fake daemon: load the shared wasm, generate a responder static keypair, dial the
 * `/v1/server` leg, and arm the responder. Resolves once the leg is OPEN with handlers armed — so
 * the client's msg1 (sent only after forwarder.whenReady()) is never dropped. Rejects with
 * NoiseLoadError only if the shared wasm load fails/times out (no handle exists yet, so a rejection
 * is the correct async shape — mirrors createNoiseSession).
 */
export async function startFakeDaemon(options: FakeDaemonOptions): Promise<FakeDaemon> {
  const lib = await loadNoiseLib({ timeoutMs: options.loadTimeoutMs })

  // A fresh, synthetic, in-process responder static (noise-c CSPRNG, never Math.random). `staticPub`
  // is the "QR-known server static" the client pins as remoteStaticPublicKey.
  const [staticPriv, staticPub] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)

  // `hs` is nulled the moment it is consumed (Split) or auto-freed by the library on a thrown
  // error, so no entry point ever calls into a freed wasm handshake object.
  let hs: ReturnType<typeof lib.HandshakeState> | null = lib.HandshakeState(
    NOISE_PROTOCOL,
    lib.constants.NOISE_ROLE_RESPONDER
  )
  // Responder in IK: pass the local static private; rs is null (the initiator static is recovered
  // from msg1). Empty prologue → null, matching the client's empty-prologue handshake.
  hs.Initialize(null, staticPriv, null, null)

  let sendCipher: NoiseCipherState | null = null
  let recvCipher: NoiseCipherState | null = null
  let state: DaemonState = 'awaiting-msg1'
  let leg: WebSocket | null = null
  let closePromise: Promise<void> | null = null

  const buildReply = options.buildReply ?? ((plaintext: Uint8Array) => plaintext)
  const buildReplyFrames = options.buildReplyFrames
  const rekeyResumeMessage = options.rekeyResumeMessage ?? DEFAULT_REKEY_RESUME_MESSAGE
  const reconnectResendFrames = options.reconnectResendFrames ?? []
  const helloAck: HelloAckPayload = {
    protocol_version: 'v2',
    server_id: 'fake-daemon',
    conn_id: 'conn-1',
    capabilities: [],
    ...options.helloAck
  }

  // Settle-once deferred. No-op initialiser keeps the synchronous executor from needing a
  // definite-assignment `!`. It never rejects — a daemon-side failure is a resolved { ok:false }.
  let settled = false
  let resolveSettled: (outcome: FakeDaemonOutcome) => void = () => {}
  const settledPromise = new Promise<FakeDaemonOutcome>((resolve) => {
    resolveSettled = resolve
  })
  function settle(outcome: FakeDaemonOutcome): void {
    if (settled) return
    settled = true
    resolveSettled(outcome)
  }

  // Free every wasm object we still own. Each free is guarded so teardown is idempotent and never
  // throws (mirrors noiseSession.freeAll).
  function freeAll(): void {
    for (const obj of [hs, sendCipher, recvCipher]) {
      try {
        obj?.free()
      } catch {
        /* already freed / teardown */
      }
    }
    hs = null
    sendCipher = null
    recvCipher = null
  }

  // Frame + send one raw Noise output as an InnerFrameV2 text frame, mirroring the client. The
  // CALLER names the tag (#525): the three handshake replies pass `noise_resp`, every other outbound
  // takes the `noise_msg` default — see the module header for the daemon-side authority. Pure
  // framing: the AEAD seal always happens at the call site, so the tag can never influence key
  // selection. Synchronous and unbuffered — handleRekeyInit's msg2-then-resume and handleReconnect's
  // msg2-then-resends are ordering-critical (the client's cipher swap depends on that order).
  function sendNoise(raw: Uint8Array, type: OutboundInnerType = 'noise_msg'): void {
    if (leg === null || leg.readyState !== WebSocket.OPEN) return
    leg.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))
  }

  function handleMsg1(raw: Uint8Array): void {
    if (hs === null) return
    try {
      const hello = hs.ReadMessage(raw, true) ?? EMPTY_AD
      // Faithfulness (AC3): the recovered `hello` early-data must be a well-formed envelope, exactly
      // as the real daemon parses it. A malformed hello fail-closes to handshake-read-failed.
      decodeEnvelope(hello)
      const msg2 = hs.WriteMessage(
        encodeEnvelope({ id: HELLO_ACK_ID, type: 'hello_ack', ts: HELLO_ACK_TS, payload: helloAck })
      )
      // noise-c returns [send, recv] role-adjusted for the responder — no swap (see the module note).
      const split = hs.Split() // consumes + frees hs
      hs = null
      sendCipher = split[0]
      recvCipher = split[1]
      sendNoise(msg2, 'noise_resp')
      state = 'transport'
    } catch {
      hs = null // the library auto-freed the handshake state on the throw
      settle({ ok: false, reason: 'handshake-read-failed' })
      void close()
    }
  }

  // As the daemon (pyrycode #450/#453/#454): AEAD-seal a `rekey_request` control envelope under the
  // CURRENT send cipher, stream it, and enter `awaiting-rekey-init` to answer the client's fresh
  // msg1. Set state BEFORE sendNoise (re-entrancy discipline, mirroring the session): over a real WS
  // this is not synchronously re-entrant, but the ordering stays faithful to the responder. No-op
  // unless a completed session is in `transport` (a `whenSettled` ok:true is not required — the
  // daemon may rekey before its single reply, but the tests rekey after the baseline round-trip).
  function initiateRekey(): void {
    if (state !== 'transport' || sendCipher === null) return
    const trigger = encodeEnvelope({
      id: REKEY_REQUEST_ID,
      type: 'rekey_request',
      ts: REKEY_REQUEST_TS,
      payload: { reason: 'scheduled' }
    })
    const sealed = sendCipher.EncryptWithAd(EMPTY_AD, trigger)
    state = 'awaiting-rekey-init'
    sendNoise(sealed)
  }

  // The client's fresh `noise_init` (rekey msg1). Run a fresh handshake as RESPONDER reusing the SAME
  // static — byte-identical to the initial responder init — with EMPTY early-data both ways (no hello
  // recovered, no hello_ack sent), atomically swap our own transport ciphers, then stream msg2 and a
  // resume frame under the NEW send cipher. The atomic swap mirrors handleMsg1 / noiseSession's
  // discipline: install BOTH new ciphers before freeing either old one, nothing fallible between.
  function handleRekeyInit(raw: Uint8Array): void {
    if (sendCipher === null || recvCipher === null) return
    try {
      const fresh = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_RESPONDER)
      fresh.Initialize(null, staticPriv, null, null)
      fresh.ReadMessage(raw, true) // client's fresh msg1; discard the early-data (empty on a rekey)
      const reply = fresh.WriteMessage(EMPTY_AD) // msg2 with empty early-data — no hello_ack on a rekey
      // noise-c returns [send, recv] role-adjusted for the responder — no swap (see the module note).
      const pair = fresh.Split() // consumes + frees the fresh handshake
      const prevSend = sendCipher
      const prevRecv = recvCipher
      sendCipher = pair[0]
      recvCipher = pair[1]
      for (const obj of [prevSend, prevRecv]) {
        try {
          obj?.free()
        } catch {
          /* already freed / teardown */
        }
      }
      state = 'transport'
      sendNoise(reply, 'noise_resp')
      // The post-swap resume frame under the NEW send cipher — the client's deterministic swap signal.
      sendNoise(sendCipher.EncryptWithAd(EMPTY_AD, rekeyResumeMessage))
    } catch {
      // Malformed / wrong-suite client msg1: the library auto-freed the fresh handshake and NO cipher
      // was reassigned (both still hold the old keys). Classify + tear down, mirroring handleMsg1.
      settle({ ok: false, reason: 'handshake-read-failed' })
      void close()
    }
  }

  // A supervised client's RECONNECT `noise_init` (#416): the driver re-dials after a relay drop and
  // starts a FRESH createNoiseSession carrying its `hello` — a full IK handshake, NOT an in-session
  // rekey. So this reuses handleMsg1's hello-recovery + hello_ack (the reconnect's `connected` ack must
  // match the initial one) with handleRekeyInit's atomic swap (install BOTH new ciphers, free BOTH old,
  // nothing fallible between). The reconnectResendFrames then stream under the NEW send cipher, in
  // order, AFTER hello_ack — so the client processes `connected` (→ reset) before they repopulate. A
  // malformed / wrong-suite reconnect msg1 fails closed to handshake-read-failed with both old ciphers
  // still installed (no torn state), exactly as handleMsg1 / handleRekeyInit.
  function handleReconnect(raw: Uint8Array): void {
    if (sendCipher === null || recvCipher === null) return
    try {
      const fresh = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_RESPONDER)
      fresh.Initialize(null, staticPriv, null, null)
      // Recover + validate the client `hello` early-data exactly as handleMsg1 — a malformed hello
      // fail-closes (faithfulness: a lax fake must reject what the real daemon rejects).
      const hello = fresh.ReadMessage(raw, true) ?? EMPTY_AD
      const reconnectHello = decodeEnvelope(hello)
      const frames = options.buildReconnectFrames?.(reconnectHello) ?? reconnectResendFrames
      const msg2 = fresh.WriteMessage(
        encodeEnvelope({ id: HELLO_ACK_ID, type: 'hello_ack', ts: HELLO_ACK_TS, payload: helloAck })
      )
      // noise-c returns [send, recv] role-adjusted for the responder — no swap (see the module note).
      const pair = fresh.Split() // consumes + frees the fresh handshake
      const prevSend = sendCipher
      const prevRecv = recvCipher
      sendCipher = pair[0]
      recvCipher = pair[1]
      const send = sendCipher // capture while narrowed, before the sendNoise calls below
      for (const obj of [prevSend, prevRecv]) {
        try {
          obj?.free()
        } catch {
          /* already freed / teardown */
        }
      }
      state = 'transport'
      sendNoise(msg2, 'noise_resp')
      // Re-send the still-held frames sealed under the NEW send cipher, in order (modal-agnostic).
      for (const frame of frames) {
        sendNoise(send.EncryptWithAd(EMPTY_AD, frame))
      }
    } catch {
      // Malformed / wrong-suite reconnect msg1: the library auto-freed the fresh handshake and NO cipher
      // was reassigned (both still hold the old keys). Classify + tear down, mirroring handleMsg1.
      settle({ ok: false, reason: 'handshake-read-failed' })
      void close()
    }
  }

  function handleTransport(raw: Uint8Array): void {
    if (recvCipher === null || sendCipher === null) return
    const send = sendCipher
    let plaintext: Uint8Array
    try {
      plaintext = recvCipher.DecryptWithAd(EMPTY_AD, raw)
    } catch {
      // A crossed Split mapping surfaces HERE (MAC failure on the first transport frame). The
      // cipher survives; the session stays open (non-terminal for this single-round-trip fake).
      settle({ ok: false, reason: 'transport-decrypt-failed' })
      return
    }
    // buildReplyFrames streams an ordered list of plaintext envelopes (one sealed `noise_msg` each,
    // in order); otherwise the single buildReply. Both seal under the current send cipher (#116).
    const frames = buildReplyFrames ? buildReplyFrames(plaintext) : [buildReply(plaintext)]
    for (const frame of frames) {
      sendNoise(send.EncryptWithAd(EMPTY_AD, frame))
    }
    settle({ ok: true }) // first reply settles ok; cached thereafter, session stays open (AC2)
  }

  // The one untrusted→trusted boundary. Inert after close so a frame arriving post-freeAll never
  // touches a freed wasm object (mirrors noiseSession.onFrame). The inner `type` is consulted for
  // ROUTING ONLY (#416, #524), as the real daemon does (v2session.go:664-669): a `noise_init` is a
  // handshake init — a supervised client's reconnect msg1 in `transport`, its rekey msg1 in
  // `awaiting-rekey-init` — and everything else is a transport frame, INCLUDING inside the rekey
  // window, where an app frame the daemon fanned out before the msg1 landed is still served under the
  // OLD ciphers with the state held. Transport-frame INTERPRETATION still relies solely on the Noise
  // state machine + AEAD, so a hostile `type` cannot misroute a transport frame (in the rekey window
  // it only picks which rejection an undecryptable frame takes — `transport-decrypt-failed` rather
  // than `handshake-read-failed`), and a hostile `noise_init` only triggers a fresh-handshake attempt
  // that FAILS CLOSED — never a downgrade or a transport bypass.
  function onMessage(data: RawData): void {
    if (state === 'closed') return
    let innerType: string
    let raw: Uint8Array
    try {
      const inner = decodeInnerFrame(toBytes(data))
      innerType = inner.type
      raw = base64StdDecode(inner.data)
    } catch {
      settle({ ok: false, reason: 'frame-decode-failed' }) // caught object dropped — no bytes
      void close()
      return
    }
    if (state === 'awaiting-msg1') handleMsg1(raw)
    else if (state === 'awaiting-rekey-init' && innerType === 'noise_init') handleRekeyInit(raw)
    else if (innerType === 'noise_init') handleReconnect(raw)
    else handleTransport(raw)
  }

  // Server-initiated push (#416): seal `plaintext` under the CURRENT send cipher and stream it as a
  // `noise_msg` — the initiateRekey seal-and-stream pattern minus the state transition.
  // Modal-agnostic (any envelope).
  //
  // `awaiting-rekey-init` serves too (#532), which is faithfulness, not laxity: the cipher swap
  // happens ONLY inside handleRekeyInit, so throughout that window `sendCipher` is still the live OLD
  // cipher and the real daemon keeps fanning out transport frames under it for the whole
  // awaiting-reply window (pyrycode #450). The tag is unchanged — sendNoise's `noise_msg` default,
  // exactly what the real daemon emits for a transport frame there. That frame is precisely the one
  // the client's rekey window has to decrypt, so without this arm no test could produce it.
  // `closed` and a null send cipher stay excluded.
  function pushFrame(plaintext: Uint8Array): void {
    if ((state !== 'transport' && state !== 'awaiting-rekey-init') || sendCipher === null) return
    sendNoise(sendCipher.EncryptWithAd(EMPTY_AD, plaintext))
  }

  function close(): Promise<void> {
    if (closePromise !== null) return closePromise
    state = 'closed'
    settle({ ok: false, reason: 'closed' }) // no-op if the run already settled
    freeAll()
    const socket = leg
    leg = null
    closePromise = new Promise<void>((resolve) => {
      if (socket === null) {
        resolve()
        return
      }
      socket.terminate() // synchronous forced teardown; cancels an in-flight dial too
      resolve()
    })
    return closePromise
  }

  const socket = new WebSocket(`${options.url}/v1/server`, { maxPayload: MAX_FRAME_BYTES })
  leg = socket
  // Attach the message handler synchronously so no inbound frame is missed once the leg opens.
  socket.on('message', (data: RawData) => onMessage(data))

  await new Promise<void>((resolve, reject) => {
    const onDialError = (err: Error): void => {
      // No handle reaches the caller on a failed upgrade. Release this attempt before rejection;
      // close synchronously frees the Noise state and terminates the leg, returning a settled promise.
      void close()
      reject(err)
    }
    socket.once('error', onDialError)
    socket.once('open', () => {
      socket.off('error', onDialError)
      // Post-open lifecycle: a dropped leg drives teardown so an awaiter of whenSettled never hangs.
      socket.on('error', () => void close())
      socket.on('close', () => void close())
      resolve()
    })
  })

  return {
    staticPublicKey: staticPub,
    whenSettled: () => settledPromise,
    initiateRekey,
    pushFrame,
    close
  }
}

/**
 * Normalise one inbound WS message to a single Uint8Array. `ws` delivers a Buffer (a Uint8Array
 * subclass — no copy) in the default nodebuffer mode; the array/ArrayBuffer arms cover fragmented
 * and arraybuffer-mode delivery. Loss-less re-assembly, not inspection — reused verbatim from
 * relayConnection's toFrame / the forwarder's toBytes.
 */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}
