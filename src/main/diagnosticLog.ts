// The content-free diagnostic logger for the Electron background process. Every transport module
// (relayConnection, daemonConnection, noiseRelayDriver, noiseSession) is "LOG-FREE by construction":
// it classifies each caught error into a static code and DROPS the object, because an error message
// could echo a token, a key, or message plaintext. That secret-safety is correct, but it also means
// a real connection bug reaches the UI as a vague "failed" with zero diagnosis. This module turns
// "log-free-by-construction" into "content-free-log BY CONSTRUCTION": it accepts ONLY an allowlisted
// envelope of an event — its name, a static classification code, a byte length / count, and safe
// connection coordinates — never the value inside.
//
// The guarantee is STRUCTURAL, enforced by the type system at every call site: `DiagnosticEvent` has
// no field shaped to carry a token, key, header map, URL, query string, or payload bytes — and no
// index signature, `Record`, or `unknown`. It is NOT a runtime scrubber (a scrubber is a denylist and
// fails open). See the ticket #126 security review.
//
// It is Electron-free and imports nothing but its own types: the effectful edge (where records land)
// is the INJECTED `DiagnosticSink`, so the core unit-tests against a capture array with no fs. The
// sinks (stdout / rotating file) live in diagnosticLogSinks.ts and are selected at the composition
// root by app.isPackaged.

declare const safeBytesBrand: unique symbol
/**
 * Content-free encoding of raw bytes that failed BEFORE decryption — ciphertext / handshake material
 * / length prefixes, provably not plaintext and therefore safe to keep (Bucket 1, #133). A nominal
 * `string` subtype whose brand symbol never leaves this module, so a bare `string` (or any
 * post-decryption-derived value, e.g. the `hash?` digest) does NOT satisfy it: the pre/post-decryption
 * boundary is enforced by the type system at every call site. Minted ONLY by encodeSafeBytes.
 */
export type SafeBytesEncoding = string & { readonly [safeBytesBrand]: true }

/**
 * Caller-facing allowlist of content-free envelope fields. There is deliberately NO field for a
 * token, key, header map, URL, query string, or payload bytes — the security contract of #126 is the
 * ABSENCE of any secret-carrying shape, enforced by this type at every call site (not a runtime
 * scrub). New content-free fields (a payload hash + length, a correlation id — #125) slot in later
 * as additive optional properties without breaking existing call sites or serialization. The one
 * raw-bytes field, `safeBytes`, is admissible ONLY as the branded output of encodeSafeBytes and only
 * for bytes that failed BEFORE decryption (#133) — never plaintext.
 */
export interface DiagnosticEvent {
  /** Required. The event name, e.g. 'relay-closed', 'daemon-failed'. A static literal at each site. */
  event: string
  /** Static classification, e.g. 'pong-timeout', 'not-paired', 'malformed-hello-ack'. */
  code?: string
  /** An HTTP or WebSocket status number, e.g. 404, 1006, 1000, 1009. */
  status?: number
  /** A byte length (an opaque frame's `.length`) — never the bytes themselves. */
  bytes?: number
  /** A count, e.g. the number of messages in a batch. */
  count?: number
  /** A safe connection coordinate — the relay HOSTNAME only, never url.href / url.search. */
  host?: string
  /** A safe path component ('/v1/client') only, never the query string. */
  path?: string
  /** A one-way digest of an opaque frame/payload — never the bytes. A fixed-width, content-free
   *  correlation handle: an identical frame recurring, or a frame changing / truncating between
   *  send and receive, shows up as a repeated / differing / shifting hash. Hex BLAKE2s-256. */
  hash?: string
  /** Lowercase hex of the raw bytes of a frame that failed BEFORE decryption — ciphertext /
   *  handshake material / length prefixes, safe to keep (Bucket 1, #133), NEVER plaintext. Bounded
   *  to MAX_SAFE_BYTES raw bytes. Typed as the branded encodeSafeBytes output, DISTINCT from `hash?`:
   *  no plain string and no post-decryption value type-checks here, so a call site cannot smuggle
   *  plaintext-derived bytes in. `bytes` carries the true uncapped length alongside. */
  safeBytes?: SafeBytesEncoding
}

/**
 * Fixed cap on the RAW bytes captured into `safeBytes` before hex-encoding (→ ≤ 2× hex chars). It
 * bounds the log line regardless of frame size and denies a hostile peer a per-frame log-amplification
 * lever; the frame header / length-prefix / ciphertext prefix a framing diagnosis needs all sit in
 * the first bytes, and `bytes: frame.length` carries the true uncapped length alongside so a
 * truncation / length mismatch stays visible even at this cap. (Mirrors #130's MAX_LOGGED_TYPE_CHARS
 * discipline: a code-level cap, not a stochastic rule.)
 */
export const MAX_SAFE_BYTES = 64

/**
 * The SOLE minter of a SafeBytesEncoding: lowercase-hex-encode the first MAX_SAFE_BYTES raw bytes of
 * a frame that failed BEFORE decryption. TOTAL on any input (an empty frame → ''). Co-located here so
 * the brand symbol stays module-private — no code outside this file can fabricate a SafeBytesEncoding
 * without an explicit, greppable cast. Takes a Uint8Array (never a string), and is imported ONLY by
 * pre-decryption failure paths; a post-decryption module must NOT import it (#133 AC4). The lone
 * `as SafeBytesEncoding` is the sanctioned brand cast — it stamps a value we just built as hex.
 */
export function encodeSafeBytes(frame: Uint8Array): SafeBytesEncoding {
  return Buffer.from(frame.subarray(0, MAX_SAFE_BYTES)).toString('hex') as SafeBytesEncoding
}

/**
 * The effectful edge, injected. Writes one already-serialized record as a single line. Synchronous.
 * May throw — the core swallows it (a diagnostics sink must not take down the transport it observes).
 */
export interface DiagnosticSink {
  write(line: string): void
}

/** The logger handle. Stamps the record fields the caller cannot supply, and never throws. */
export interface DiagnosticLog {
  /** Stamp seq + ts onto the allowlisted fields, serialize to one JSON line, write to the sink. */
  event(fields: DiagnosticEvent): void
}

/**
 * The internal record — the allowlisted fields plus the three the logger owns. `seq`/`ts` come AFTER
 * the caller's fields in the spread so the logger's own stamps always win, even against a mis-cast
 * caller. Not exported: the shape is an implementation detail of the JSON-line serialization.
 */
type DiagnosticRecord = DiagnosticEvent & { seq: number; ts: string }

/**
 * Build the diagnostic logger over an injected sink. One main process constructs exactly one of
 * these at the composition root (one `seq` counter, one file), consumed by every transport module.
 */
export function createDiagnosticLog(deps: {
  sink: DiagnosticSink
  /** Injected clock; default the wall clock (mirrors daemonConnection.now). Tests pin it. */
  now?: () => string
}): DiagnosticLog {
  const { sink } = deps
  const now = deps.now ?? ((): string => new Date().toISOString())

  // Module-local single-writer counter. `event()` has no `await`, so it runs to completion with no
  // check-then-act gap — `seq` is strictly monotonic and gap-free per process. Starts at 0.
  let seq = 0

  return {
    event(fields: DiagnosticEvent): void {
      const record: DiagnosticRecord = { ...fields, seq, ts: now() }
      seq += 1
      // JSON-lines: greppable, diffable, and injection-safe — JSON.stringify escapes any embedded
      // newline, so a string field can never split one record into two lines. Serialization lives
      // here (once, not per-sink) so both sinks emit byte-identical records.
      const line = JSON.stringify(record)
      try {
        sink.write(line)
      } catch {
        // Swallow: a diagnostics logger observing the transport must not be able to crash it (AC3).
        // A full disk / permission error silently drops the line rather than taking down the
        // connection.
      }
    }
  }
}
