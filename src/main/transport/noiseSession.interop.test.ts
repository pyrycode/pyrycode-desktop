// #30 Noise spike (2/2): prove the #29 noise-c.wasm JS initiator interoperates with the REAL Go
// `flynn/noise` stack the daemon runs. This is the interop half — a THROWAWAY de-risking spike,
// not production code, not wired into src/main/index.ts. The vitest run is the only execution path.
//
// It swaps #29's JS<->JS inline responder for a genuine `flynn/noise` (v1.1.0) responder — the
// daemon's actual library — spoken over a stdio line protocol. `createNoiseSession` from #29 is
// consumed UNCHANGED (a drop-in), matching the way #30 later drops the real relay transport on.
//
// What it proves:
//   AC1  a byte-identical IK handshake + one AEAD-sealed round-trip against the real Go stack.
//        Reaching transport state is itself the by-value BLAKE2s-vs-SHA-256 proof #29 deferred:
//        divergent hash choices MAC-fail before any frame opens (a JS-only run shares one impl).
//   AC2  a deliberate mismatch (wrong hash suite, wrong responder static, or a tampered msg 2)
//        is OBSERVED to fail at MAC verification — never reaching transport state.
//   AC3  an operator-gated live path over #21's createRelayConnection against the live relay +
//        daemon, reached only when a real paired credential is supplied via the environment.
//
// The load-bearing interop line is the `Split()` asymmetry (#29's carried-forward note): flynn
// returns raw (cs1,cs2) [responder maps recv=cs1/send=cs2], noise-c returns role-adjusted
// [send,recv] [JS does no swap]. Each side swaps at most once; crossing them completes the
// handshake but MAC-fails the first transport frame — so AC1's round-trip is the structural pin.
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNoiseLib } from './noiseLib'
import {
  createNoiseSession,
  type NoiseSession,
  type NoiseSessionEvent
} from './noiseSession'
import { createRelayConnection, type RelayEvent } from './relayConnection'
import {
  base64StdEncode,
  base64StdDecode,
  encodeInnerFrame,
  decodeInnerFrame,
  encodeEnvelope,
  makeHelloClientPayload
} from './codec'
import type { HelloClientPayload } from '../../shared/wire/types'

const RESPONDER_DIR = fileURLToPath(new URL('./noiseSpikeResponder', import.meta.url))

// Build the Go responder ONCE at module load — synchronously, so `goAvailable` is known at
// collection time (vitest evaluates describe.skipIf conditions before beforeAll runs). On a
// toolchain-less runner the build fails and every Go-dependent test skips gracefully; the live
// path (if a credential is present) then carries the real-Go-stack proof (AC permits this).
let goAvailable = false
let responderBin = ''
let buildDir = ''
let skipReason = ''
try {
  buildDir = mkdtempSync(join(tmpdir(), 'noise-spike-responder-'))
  responderBin = join(buildDir, process.platform === 'win32' ? 'responder.exe' : 'responder')
  execFileSync('go', ['build', '-o', responderBin, '.'], { cwd: RESPONDER_DIR, stdio: 'pipe' })
  goAvailable = true
} catch (err) {
  // Static reason only — never the build stderr (classify-don't-forward). ENOENT = no `go`.
  skipReason = (err as { code?: string }).code === 'ENOENT' ? 'go toolchain not found' : 'go responder build failed'
}
if (!goAvailable) {
  // Operator signal that the real-Go interop proof was skipped. Static string, no bytes.
  console.warn(`[noise interop spike] Go-dependent tests skipped: ${skipReason}`)
}

const EMPTY = new Uint8Array(0)
const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj))
const bytes = (u: Uint8Array): number[] => Array.from(u)

// A hello-shaped body carrying a DUMMY token (never a real credential) — synthetic bytes only;
// the automatable path has no real secret on it (see the spec's Security review).
const HELLO: HelloClientPayload = {
  role: 'client',
  device_name: 'noise-interop-spike-desktop',
  client_version: '0',
  protocol_versions: ['v2'],
  token: 'dummy-interop-token-not-a-real-credential',
  capabilities: []
}

/** Flip one byte (the AEAD tag region) to force a MAC failure on the peer's read. */
function flipByte(frame: Uint8Array): Uint8Array {
  const copy = new Uint8Array(frame)
  copy[copy.length - 1] ^= 0xff
  return copy
}

// --- The Go responder child, over the stdio line protocol (see noiseSpikeResponder/main.go):
//   child->parent once:   PUB <b64 responder static public key>
//   parent->child lines:  <b64 raw Noise frame>          (msg 1, then transport frames)
//   child->parent lines:  FRAME <b64 raw Noise frame>    (msg 2, then AEAD echoes)
//   child->parent on fail: ERR <static-reason>           then exit non-zero
type ResponderLine =
  | { kind: 'pub'; key: Uint8Array }
  | { kind: 'frame'; frame: Uint8Array }
  | { kind: 'err'; reason: string }

interface ResponderChild {
  pub: Promise<Uint8Array>
  feed(frame: Uint8Array): void
  onLine(handler: (line: ResponderLine) => void): void
  exited: Promise<void>
  kill(): void
}

function parseLine(line: string): ResponderLine | null {
  try {
    if (line.startsWith('PUB ')) return { kind: 'pub', key: base64StdDecode(line.slice(4)) }
    if (line.startsWith('FRAME ')) return { kind: 'frame', frame: base64StdDecode(line.slice(6)) }
    if (line.startsWith('ERR ')) return { kind: 'err', reason: line.slice(4) }
  } catch {
    // A malformed base64 line from the (trusted) child cannot happen in practice; ignore it
    // rather than throw inside the stdout handler.
  }
  return null
}

function spawnResponder(args: string[]): ResponderChild {
  const child = spawn(responderBin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let killed = false
  let handler: ((line: ResponderLine) => void) | null = null
  const buffered: ResponderLine[] = []
  let resolvePub!: (k: Uint8Array) => void
  const pub = new Promise<Uint8Array>((r) => (resolvePub = r))
  let resolveExit!: () => void
  const exited = new Promise<void>((r) => (resolveExit = r))

  function dispatch(line: ResponderLine): void {
    if (line.kind === 'pub') return resolvePub(line.key)
    if (handler) handler(line)
    else buffered.push(line)
  }

  let stdoutBuf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const parsed = parseLine(stdoutBuf.slice(0, nl))
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (parsed) dispatch(parsed)
    }
  })
  child.on('exit', () => resolveExit())
  child.on('error', () => resolveExit()) // spawn failure — never leaves pub/exited hanging forever
  child.stdin.on('error', () => {
    /* ignore EPIPE when the child has already exited */
  })

  return {
    pub,
    feed(frame) {
      if (!killed) child.stdin.write(base64StdEncode(frame) + '\n')
    },
    onLine(h) {
      handler = h
      for (const l of buffered.splice(0)) h(l)
    },
    exited,
    kill() {
      if (killed) return
      killed = true
      child.kill('SIGKILL')
    }
  }
}

/**
 * A bounded waiter: resolves as soon as `check()` holds (re-checked on every notify), or after
 * `timeoutMs` (resolve, not reject — the caller asserts the resulting state). Keeps negative
 * tests deterministic and inside vitest's 5s default.
 */
function makeWaiter(): { notify(): void; wait(check: () => boolean, timeoutMs?: number): Promise<void> } {
  const waiters: Array<{ check: () => boolean; done: () => void; timer: ReturnType<typeof setTimeout> }> = []
  return {
    notify() {
      for (const w of [...waiters]) {
        if (w.check()) {
          clearTimeout(w.timer)
          const i = waiters.indexOf(w)
          if (i >= 0) waiters.splice(i, 1)
          w.done()
        }
      }
    },
    wait(check, timeoutMs = 2000) {
      return new Promise<void>((resolve) => {
        if (check()) return resolve()
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer)
          if (i >= 0) waiters.splice(i, 1)
          resolve()
        }, timeoutMs)
        waiters.push({ check, done: resolve, timer })
      })
    }
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c()
    } catch {
      /* teardown */
    }
  }
})
afterAll(() => {
  if (buildDir) {
    try {
      rmSync(buildDir, { recursive: true, force: true })
    } catch {
      /* teardown */
    }
  }
})

// Warm the memoized wasm load ONCE before any console spy installs (as #29): the Emscripten glue
// prints a one-time streaming-compile fallback warning at first load — warm it away here so the
// log-free assertion measures the harness + adapter alone.
beforeAll(async () => {
  await loadNoiseLib()
})

/**
 * Wire the UNCHANGED #29 initiator to a fresh Go responder child. Returns the driven initiator,
 * the observed initiator events, the responder's reported ERR reasons, and a bounded waiter.
 */
async function connectInterop(opts: {
  args?: string[]
  wrongStatic?: boolean
  tamperMsg2?: boolean
}): Promise<{
  initiator: NoiseSession
  events: NoiseSessionEvent[]
  responderErrs: string[]
  waiter: ReturnType<typeof makeWaiter>
  hello: Uint8Array
}> {
  const child = spawnResponder(opts.args ?? [])
  cleanups.push(() => child.kill())
  const responderPub = await child.pub

  const lib = await loadNoiseLib()
  const curve = lib.constants.NOISE_DH_CURVE25519
  const [devicePriv] = lib.CreateKeyPair(curve) // fresh in-process device static — synthetic
  const remoteStaticPublicKey = opts.wrongStatic ? lib.CreateKeyPair(curve)[1] : responderPub

  const hello = enc(HELLO)
  const events: NoiseSessionEvent[] = []
  const responderErrs: string[] = []
  const waiter = makeWaiter()

  const initiator = await createNoiseSession({
    staticPrivateKey: devicePriv,
    remoteStaticPublicKey,
    prologue: EMPTY,
    hello,
    sendFrame: (f) => child.feed(f),
    onEvent: (e) => {
      events.push(e)
      waiter.notify()
    }
  })
  cleanups.push(() => initiator.close())

  let tampered = false
  child.onLine((line) => {
    if (line.kind === 'frame') {
      let frame = line.frame
      if (opts.tamperMsg2 && !tampered) {
        frame = flipByte(frame) // corrupt the real Go-produced msg 2 before the JS reads it
        tampered = true
      }
      initiator.onFrame(frame)
    } else if (line.kind === 'err') {
      responderErrs.push(line.reason)
      waiter.notify()
    }
  })
  void child.exited.then(() => waiter.notify())

  return { initiator, events, responderErrs, waiter, hello }
}

describe.skipIf(!goAvailable)('Go flynn/noise ↔ #29 noise-c.wasm initiator (real cross-stack interop)', () => {
  it('AC1: completes the IK handshake and reaches transport state with an AEAD round-trip', async () => {
    const { initiator, events, waiter, hello } = await connectInterop({})
    initiator.start()

    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
    const complete = events.find((e) => e.type === 'handshake-complete')
    expect(complete, 'handshake must complete against the real Go responder').toBeDefined()
    // Both-direction early-data across the two stacks: the Go responder recovered our `hello`
    // from IK msg 1 and echoed it as the `hello_ack` early-data of msg 2, recovered here.
    expect(bytes((complete as { helloAck: Uint8Array }).helloAck)).toEqual(bytes(hello))

    // One AEAD round-trip AFTER the handshake. This is the by-value BLAKE2s proof #29 deferred:
    // a divergent hash would have MAC-failed msg 2; a double-swapped Split would MAC-fail HERE.
    const probe = new TextEncoder().encode('desktop -> daemon round-trip probe #30')
    initiator.sendMessage(probe)
    await waiter.wait(() => events.some((e) => e.type === 'message'))
    const msg = events.find((e) => e.type === 'message')
    expect(msg, 'a post-handshake AEAD frame must round-trip through the Go cipher states').toBeDefined()
    expect(bytes((msg as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(probe))
  })

  it('AC2: a wrong-hash (BLAKE2b) responder MAC-fails — no handshake, no transport', async () => {
    const { initiator, events, responderErrs, waiter } = await connectInterop({ args: ['--hash', 'blake2b'] })
    initiator.start()
    // The BLAKE2b symmetric state diverges from byte 1, so the Go responder's ReadMessage of our
    // BLAKE2s msg 1 fails its MAC — the negative twin of AC1's positive by-value BLAKE2s proof.
    await waiter.wait(() => responderErrs.length > 0)
    expect(responderErrs, 'the BLAKE2b responder must MAC-fail reading msg 1').toContain('handshake-read-failed')
    expect(events.some((e) => e.type === 'handshake-complete')).toBe(false)
    expect(events.some((e) => e.type === 'message')).toBe(false)
  })

  it('AC2: a wrong responder static key MAC-fails at the responder — no handshake, no transport', async () => {
    const { initiator, events, responderErrs, waiter } = await connectInterop({ wrongStatic: true })
    initiator.start()
    // Wrong peer-static -> the initiator's es/ss DH outputs disagree with the responder's, so the
    // encrypted static in msg 1 fails its MAC at the RESPONDER's ReadMessage (per the IK flow).
    await waiter.wait(() => responderErrs.length > 0)
    expect(responderErrs).toContain('handshake-read-failed')
    expect(events.some((e) => e.type === 'handshake-complete')).toBe(false)
    expect(events.some((e) => e.type === 'message')).toBe(false)
  })

  it('AC2: a tampered msg 2 surfaces handshake-read-failed on the JS initiator, no completion', async () => {
    const { initiator, events, waiter } = await connectInterop({ tamperMsg2: true })
    initiator.start()
    await waiter.wait(() => events.some((e) => e.type === 'error'))
    const reasons = events.filter((e) => e.type === 'error').map((e) => (e as { reason: string }).reason)
    expect(reasons).toContain('handshake-read-failed')
    expect(events.some((e) => e.type === 'handshake-complete')).toBe(false)
  })

  it('security: drives the full Go↔JS handshake + transport + error path with zero JS console output', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      const { initiator, events, waiter } = await connectInterop({})
      initiator.start()
      await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
      initiator.sendMessage(new TextEncoder().encode('log-free probe'))
      await waiter.wait(() => events.some((e) => e.type === 'message'))
      // Also exercise the error path — it must classify without logging bytes.
      initiator.onFrame(new Uint8Array(48).fill(0x33))
      await waiter.wait(() => events.some((e) => e.type === 'error'), 500)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

// --- AC3: operator-gated live path. The SAME initiator over an unchanged createRelayConnection,
// against the live relay + daemon. Single-shot (observe one handshake; no #22 reconnect). The real
// paired credential is read from the environment at runtime and NEVER logged, echoed, or committed.
interface LiveConfig {
  url: string
  serverId: string
  token: string
  serverStaticPub: string
  deviceName: string
}

function readLiveEnv(): LiveConfig | null {
  const url = process.env.PYRY_LIVE_RELAY_URL
  const serverId = process.env.PYRY_LIVE_SERVER_ID
  const token = process.env.PYRY_LIVE_DEVICE_TOKEN
  const serverStaticPub = process.env.PYRY_LIVE_SERVER_STATIC_PUB
  if (!url || !serverId || !token || !serverStaticPub) return null
  return { url, serverId, token, serverStaticPub, deviceName: process.env.PYRY_LIVE_DEVICE_NAME ?? 'pyrycode-desktop-spike' }
}

const live = readLiveEnv()

/** Drive the live path once. `corruptStatic` flips the server static to force a 4426 close. */
async function runLive(cfg: LiveConfig, corruptStatic: boolean): Promise<{ events: NoiseSessionEvent[]; closeCode: number | null }> {
  const lib = await loadNoiseLib()
  const [devicePriv] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)
  const serverStatic = corruptStatic ? flipByte(base64StdDecode(cfg.serverStaticPub)) : base64StdDecode(cfg.serverStaticPub)

  // The token rides INSIDE the encrypted hello (Noise early-data), never a relay-readable header.
  const hello = encodeEnvelope({
    id: 1,
    type: 'hello',
    ts: new Date().toISOString(),
    payload: makeHelloClientPayload({ deviceName: cfg.deviceName, clientVersion: '0', token: cfg.token })
  })

  const events: NoiseSessionEvent[] = []
  const waiter = makeWaiter()
  let closeCode: number | null = null
  let firstOut = true
  let initiator!: NoiseSession

  const relay = createRelayConnection({
    url: cfg.url,
    headers: {
      'X-Pyrycode-Server': cfg.serverId,
      'X-Pyrycode-Token': cfg.token, // relay requires non-empty but ignores the value under v2
      'User-Agent': 'pyrycode-desktop-spike/0'
    },
    onEvent: (e: RelayEvent) => {
      if (e.type === 'connected') initiator.start()
      else if (e.type === 'message') {
        try {
          const { data } = decodeInnerFrame(e.frame)
          initiator.onFrame(base64StdDecode(data))
        } catch {
          /* fail-closed on a malformed frame; the bounded wait converts it to a timeout */
        }
      } else if (e.type === 'closed') {
        closeCode = e.code
        waiter.notify()
      }
    }
  })
  cleanups.push(() => relay.close())

  initiator = await createNoiseSession({
    staticPrivateKey: devicePriv,
    remoteStaticPublicKey: serverStatic,
    prologue: EMPTY,
    hello,
    // Tag the first outbound frame noise_init, the rest noise_msg; base64-std the raw Noise bytes
    // into an InnerFrameV2 at the relay boundary (the #5 codec, composed unchanged).
    sendFrame: (raw) => {
      const type = firstOut ? 'noise_init' : 'noise_msg'
      firstOut = false
      relay.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))
    },
    onEvent: (e) => {
      events.push(e)
      waiter.notify()
    }
  })
  cleanups.push(() => initiator.close())

  await waiter.wait(() => events.some((e) => e.type === 'handshake-complete') || closeCode !== null, 8000)
  if (!corruptStatic && events.some((e) => e.type === 'handshake-complete')) {
    initiator.sendMessage(hello) // any AEAD-sealed frame; a decrypted reply proves the round-trip
    await waiter.wait(() => events.some((e) => e.type === 'message') || closeCode !== null, 8000)
  }
  return { events, closeCode }
}

describe.skipIf(!live)('operator-gated live relay + daemon (real credential from the environment)', () => {
  it('AC3: reaches the daemon post-handshake open state over the real relay', async () => {
    const { events, closeCode } = await runLive(live as LiveConfig, false)
    expect(
      events.some((e) => e.type === 'handshake-complete'),
      `expected daemon handshake-complete; observed close code ${closeCode ?? 'none'}`
    ).toBe(true)
    // No transport-decrypt failure once open (records whether the AEAD round-trip succeeded).
    expect(events.some((e) => e.type === 'error' && e.reason === 'transport-decrypt-failed')).toBe(false)
  })

  it('AC3: a deliberate server-static mismatch closes with a 4426-class Noise handshake failure', async () => {
    const { events, closeCode } = await runLive(live as LiveConfig, true)
    expect(events.some((e) => e.type === 'handshake-complete')).toBe(false)
    expect(closeCode).toBe(4426)
  })
})
