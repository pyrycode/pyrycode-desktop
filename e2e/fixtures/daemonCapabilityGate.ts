// The real-daemon CAPABILITY gate (#933) — harness-side, never production.
//
// Until now e2e/fixtures/realDaemon.ts gated every `real-*` spec on one thing: whether a `pyry`
// binary resolves. It never checked what that binary SUPPORTS, so a daemon predating a feature
// produced a test FAILURE, and the dispatcher's real-claude gate routes a failure back to a builder
// who cannot rebuild a Go binary. A stale daemon is an environment fault — the same class as a
// missing credential — so it has to present as a SKIP, which parks the run in Inbox for the
// operator instead. This module is the two halves of that: a PURE decision, and the read that feeds
// it.
//
// WHY THE READ LIVES HERE AND NOT IN PRODUCTION CODE. The fixture never sees the ack today:
// daemonConnection's parseHelloAck hands the full payload to the renderer on `connected`, but every
// bridge ignores `event.ack` and no store keeps `capabilities`. Adding a production surface purely
// so a test could read it would be the wrong trade. Nothing under src/main/transport imports
// `electron` — the whole client transport is plain Node, and realDaemon.ts already imports two
// modules from it — so the harness can drive its own handshake with the same vetted pieces the app
// uses. No new crypto: createNoiseRelayDriver → createNoiseSession → noise-c.wasm, consumed
// unchanged at the pinned Noise_IK_25519_ChaChaPoly_BLAKE2s variant.
//
// THE ACK CARRIES AN INTERSECTION, NOT THE DAEMON'S SET. The daemon's negotiateCapabilities returns
// *the client's advertised set ∩ its own supported set*, so a probe that advertises nothing learns
// nothing. readDaemonCapabilities therefore advertises EXACTLY what the spec declared: the ack is
// then a subset of `required`, and `required \ ack` is the missing set, exactly.
//
// SECRET HYGIENE (the consuming fixture carries a security-sensitive label):
//   - The probe carries its own daemon-minted pairing token in the upgrade header and in the hello
//     early-data, exactly as daemonConnection's loadDialConfig does — and readDaemonCapabilities is
//     TOTAL: it never throws and never rejects, so no stack carrying that header or a wasm/codec
//     message can reach a Playwright diagnostic. Every caught object is DROPPED; only a static
//     cause crosses.
//   - The skip reason is built from client-owned constants and from `required` ONLY, never from the
//     capability strings the daemon sent. Those are untrusted text, and ZeroExecutedGate prints the
//     reason verbatim into the operator's (pipeline-salvaged) run log.
//   - This module is log-free by construction, mirroring fakeRoutingRelay.ts.
import { base64StdDecode } from '../../src/main/transport/codec'
import { buildClientHello, parseHelloAck } from '../../src/main/transport/helloExchange'
import { loadNoiseLib } from '../../src/main/transport/noiseLib'
import { createNoiseRelayDriver } from '../../src/main/transport/noiseRelayDriver'
import type {
  NoiseRelayDriver,
  RelaySessionEvent,
  SessionMaterial
} from '../../src/main/transport/noiseRelayDriver'
import type { RelayConnectionConfig } from '../../src/main/transport/relayConnection'
import type { QrPayload } from '../../src/shared/wire/types'

/** Why a capability read did not complete. A closed set of static strings — never wire bytes. */
export type CapabilityReadFailure = 'handshake-failed' | 'malformed-ack' | 'timeout'

/** The outcome of one capability read. `capabilities` is the daemon's ack set — UNTRUSTED text. */
export type CapabilityRead =
  | { ok: true; capabilities: readonly string[] }
  | { ok: false; cause: CapabilityReadFailure }

/** Skip this spec, or don't. `reason` is what testInfo.skip renders and ZeroExecutedGate prints. */
export type CapabilityGateDecision = { skip: false } | { skip: true; reason: string }

/** The credential fields realDaemon.ts decodes from `pyry pair` stdout. */
type PairFields = Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>

// --- Timings ------------------------------------------------------------------------------------
// One attempt's window. Short on purpose: the daemon's control socket is already dialable when the
// probe runs, so the only thing being absorbed is its relay-leg registration, and a lost first frame
// is only recoverable by re-dialling (see the retry note in probeOnce).
const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000
// The absolute bound on the whole read — an ABSOLUTE deadline, not an attempt count, so the suite
// can never hang here no matter how the attempts behave.
const DEFAULT_DEADLINE_MS = 15_000

// The responder static is a raw X25519 key; decodeServerKey applies the same check on the app side.
const SERVER_KEY_LENGTH = 32

// Identity the probe presents. Deliberately NOT the app's device name or version: this connection is
// the harness's own, and an operator reading a daemon-side trace should be able to tell it apart
// from the window's leg.
const PROBE_DEVICE_NAME = 'realdaemon-e2e-capability-probe'
const PROBE_CLIENT_VERSION = '0.0.0-e2e-capability-probe'

// The rebuild-and-install line. Kept as one constant so both reason shapes stay actionable in the
// same way the credential skip's `security find-generic-password …` line is. `~/.local/bin/pyry` is
// where this repo's own live-drive harness expects the operator's daemon to sit.
const REBUILD_INSTRUCTION =
  'Rebuild and reinstall the daemon from a current `pyrycode` checkout — ' +
  '`go build -o ~/.local/bin/pyry ./cmd/pyry` — or point PYRY_BIN at a freshly built binary, ' +
  'then re-run.'

/** Render capability names for a message. Input is ALWAYS drawn from `required`, never from the ack. */
function formatCapabilities(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(', ')
}

/**
 * Decide whether a `real-*` spec runs, given what it declared and what the daemon advertised. PURE
 * and total — this is the whole judgement, so it is directly coverable under `npm test` (nothing in
 * this repo can assert on its own Playwright skip) and the fixture stays thin wiring.
 *
 * Empty `required` short-circuits to "run" even on a FAILED read. That is the invariant that keeps
 * every spec predating this ticket gated exactly as it was — on the `pyry` binary alone — and it
 * belongs here rather than only in the fixture's dial short-circuit, which is an optimisation.
 */
export function decideCapabilityGate(
  required: readonly string[],
  read: CapabilityRead
): CapabilityGateDecision {
  if (required.length === 0) return { skip: false }

  const wanted = formatCapabilities(required)

  if (!read.ok) {
    // Fail closed: an unreadable capability set is not evidence of support. Skipping (not failing)
    // keeps this on the environment-fault route, same as the read succeeding and coming up short.
    return {
      skip: true,
      reason:
        `real-daemon: could not read the daemon capability set (${read.cause}), so the required ` +
        `capability ${wanted} cannot be confirmed — skipping rather than failing, because an ` +
        `unverifiable daemon is an environment fault, not a test defect. ${REBUILD_INSTRUCTION}`
    }
  }

  // The missing set is a filter over `required`, NEVER over `read.capabilities`. The two are equal
  // in value and opposite in PROVENANCE: this way every string that can reach the reason below is
  // one the spec itself wrote. See the security review in
  // docs/specs/architecture/933-real-daemon-capability-skip-gate.md.
  const missing = required.filter((name) => !read.capabilities.includes(name))
  if (missing.length === 0) return { skip: false }

  return {
    skip: true,
    reason:
      `real-daemon: the installed \`pyry\` does not advertise ${formatCapabilities(missing)} — the ` +
      'DAEMON binary is stale, not this spec, so there is nothing a code change here can fix. ' +
      REBUILD_INSTRUCTION
  }
}

/**
 * Run ONE handshake and settle on the first decisive event. Resolves; never rejects.
 *
 * `stop()` fires on EVERY settle including the successful one, and that is load-bearing rather than
 * tidy: createNoiseRelayDriver builds a relaySupervisor that re-dials with backoff on its own, so a
 * driver left running would keep reconnecting for the rest of the suite. stop() re-enters this sink
 * synchronously through `terminal`, which the one-shot latch makes inert.
 */
function probeOnce(
  connection: Omit<RelayConnectionConfig, 'onEvent'>,
  session: SessionMaterial,
  attemptTimeoutMs: number
): Promise<CapabilityRead> {
  return new Promise<CapabilityRead>((resolve) => {
    let settled = false
    let driver: NoiseRelayDriver | null = null
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => settle({ ok: false, cause: 'timeout' }),
      attemptTimeoutMs
    )

    function settle(read: CapabilityRead): void {
      if (settled) return
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      try {
        driver?.stop()
      } catch {
        // Teardown must not throw, and a stop() failure cannot change the read we already have.
      }
      resolve(read)
    }

    function onEvent(event: RelaySessionEvent): void {
      switch (event.type) {
        case 'handshake-complete': {
          let capabilities: readonly string[]
          try {
            capabilities = parseHelloAck(event.helloAck).capabilities
          } catch {
            // WireDecodeError. The object is DROPPED — its message can echo ack bytes.
            settle({ ok: false, cause: 'malformed-ack' })
            return
          }
          settle({ ok: true, capabilities })
          return
        }
        case 'error':
        case 'terminal':
          // Either the session failed or the supervisor gave up / was closed under us. Both are
          // decisive for THIS attempt; the static reason is deliberately not forwarded.
          settle({ ok: false, cause: 'handshake-failed' })
          return
        default:
          // relay-link-up / relay-link-down / message — not decisive. A link-down is exactly the
          // case the supervisor heals on its own inside the attempt window.
          return
      }
    }

    try {
      driver = createNoiseRelayDriver({ connection, session, onEvent })
      // A sink that fired during construction settled before `driver` was assigned, so its stop()
      // was a no-op on null. Stop it here instead — otherwise that supervisor outlives the attempt.
      if (settled) {
        try {
          driver.stop()
        } catch {
          // as above
        }
      }
    } catch {
      settle({ ok: false, cause: 'handshake-failed' })
    }
  })
}

/**
 * Read the daemon's advertised capability set by driving one client-leg handshake against the
 * harness's own routing relay, and closing again. TOTAL: it never throws and never rejects — every
 * failure becomes a `CapabilityReadFailure`.
 *
 * It mirrors daemonConnection's loadDialConfig field-for-field (same four headers, empty prologue,
 * `/v1/client` path) with three substitutions: an EPHEMERAL static minted from the shared wasm
 * loader instead of the persisted device keypair (deviceKeypair needs safeStorage);
 * `advertise` instead of production's `[CAPABILITY_INTERACTIVE, CAPABILITY_MULTI_AGENT]`; and a
 * probe-shaped identity.
 *
 * The caller must supply a dedicated daemon-minted pairing. The daemon binds that pairing to the
 * first accepted static key; using the app's pairing here would prevent its independent key from
 * authenticating later. Retries within this read reuse the same probe key and pairing.
 */
export async function readDaemonCapabilities(input: {
  /** The fake routing relay's base URL — the client leg path is appended here, as the app does. */
  relayUrl: string
  pairFields: PairFields
  /** Advertised to the daemon, which returns the INTERSECTION. Pass exactly what the spec declared. */
  advertise: readonly string[]
  attemptTimeoutMs?: number
  deadlineMs?: number
}): Promise<CapabilityRead> {
  const attemptTimeoutMs = input.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS
  const deadline = Date.now() + (input.deadlineMs ?? DEFAULT_DEADLINE_MS)

  try {
    const lib = await loadNoiseLib()
    const [staticPrivateKey] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)
    const remoteStaticPublicKey = base64StdDecode(input.pairFields.server_static_pubkey)
    if (remoteStaticPublicKey.length !== SERVER_KEY_LENGTH) {
      return { ok: false, cause: 'handshake-failed' }
    }

    const connection: Omit<RelayConnectionConfig, 'onEvent'> = {
      url: `${input.relayUrl.replace(/\/+$/, '')}/v1/client`,
      headers: {
        'X-Pyrycode-Server': input.pairFields.server,
        'X-Pyrycode-Token': input.pairFields.token,
        'User-Agent': `pyrycode-desktop-e2e/${PROBE_CLIENT_VERSION}`,
        'X-Pyrycode-Device-Name': PROBE_DEVICE_NAME
      },
      // Bounded to the attempt so a hung upgrade cannot outlive it. maxFrameBytes is deliberately
      // NOT set: the 1 MiB relayConnection default is the cap, and it must not be widened here.
      connectTimeoutMs: attemptTimeoutMs
    }

    const session: SessionMaterial = {
      staticPrivateKey,
      remoteStaticPublicKey,
      prologue: new Uint8Array(0),
      hello: buildClientHello({
        id: 1,
        ts: new Date().toISOString(),
        deviceName: PROBE_DEVICE_NAME,
        clientVersion: PROBE_CLIENT_VERSION,
        token: input.pairFields.token,
        capabilities: input.advertise
      })
    }

    // RETRY IS LOAD-BEARING, NOT DEFENSIVE. The fake relay silently DROPS a client frame that
    // arrives before the daemon's /v1/server leg is OPEN, and nothing re-sends it — the app only
    // recovers from this by re-dialling (docs/knowledge/features/real-claude-liveness-e2e.md
    // § "Readiness — Send-enabled, not `relay.whenReady()`"). whenReady() cannot be awaited first
    // either: it needs a client leg, and the probe IS the client leg. So a timed-out attempt
    // re-dials until the deadline, while handshake-failed and malformed-ack return at once, being
    // deterministic. At least one attempt always runs.
    let last: CapabilityRead
    do {
      last = await probeOnce(connection, session, attemptTimeoutMs)
      if (last.ok || last.cause !== 'timeout') return last
    } while (Date.now() < deadline)
    return last
  } catch {
    // Wasm load, keypair mint, or a malformed server_static_pubkey. The object is DROPPED: it can
    // carry the key material or a library internal, and this function must never reject.
    return { ok: false, cause: 'handshake-failed' }
  }
}
