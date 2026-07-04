// The single hardened noise-c.wasm loader for the Electron MAIN process. `noise-c.wasm` is an
// Emscripten/WASM build of rweather/noise-c (the reference C implementation) — vetted, never
// hand-rolled crypto. Both the Noise session (noiseSession.ts) and the device keypair generator
// (../noiseKeyPairGenerator.ts) share this ONE process-lived instance, so the wasm initializes
// exactly once. It runs in the main process only, never the renderer (transport-out-of-the-window).
//
// LOG-FREE by construction: no console.*, and a caught load error is CLASSIFIED into a static
// category — never forwarded (a wasm error string could echo internals). This mirrors codec.ts's
// WireDecodeError/WireEncodeError category-only discipline.
import createNoise, { type NoiseLib } from 'noise-c.wasm'

// Only a broken/hostile environment ever hits this deadline — the wasm loads in tens of ms under
// Node/vitest. Mirrors relayConnection's connect-timeout magnitude; it is a backstop, not a knob
// tuned for the happy path.
const DEFAULT_LOAD_TIMEOUT_MS = 10_000

/**
 * Category-only load failure. The message names the failure category; it never carries the raw
 * wasm error text (classify-don't-forward — a library error string could echo bytes). Mirrors
 * codec.ts's WireDecodeError.
 */
export class NoiseLoadError extends Error {
  readonly reason: 'wasm-load-failed' | 'wasm-load-timeout'
  constructor(reason: 'wasm-load-failed' | 'wasm-load-timeout') {
    super(`noise-c.wasm ${reason}`)
    this.name = 'NoiseLoadError'
    this.reason = reason
  }
}

// The one memoized SUCCESSFUL load. Concurrent first calls share this promise (no double-init); it
// is nulled on any rejection so a later call retries a fresh load rather than returning a
// permanently-poisoned rejected promise.
let libPromise: Promise<NoiseLib> | null = null

/**
 * Load the noise-c wasm ONCE per process and memoize the successful NoiseLib. `createNoise(cb)`
 * has no async error callback, so a wasm instantiation that never fires the callback would hang
 * forever (the #29 NIT). This loader converts that to a bounded rejection: the callback races a
 * deadline, and a synchronous throw is classified too. `timeoutMs` is test-overridable.
 */
export function loadNoiseLib(options?: { timeoutMs?: number }): Promise<NoiseLib> {
  if (libPromise === null) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    libPromise = new Promise<NoiseLib>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new NoiseLoadError('wasm-load-timeout'))
      }, timeoutMs)
      try {
        createNoise((lib) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(lib)
        })
      } catch {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new NoiseLoadError('wasm-load-failed')) // category-only — never the thrown text
      }
    }).catch((err) => {
      libPromise = null // reset on failure so a later call retries a fresh load
      throw err
    })
  }
  return libPromise
}
