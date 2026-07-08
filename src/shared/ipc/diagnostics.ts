// The one-way, content-free diagnostic pipe from the renderer window to the background process:
// the channel it travels on, the renderer-safe record type, and the boundary projection that
// re-validates it. Renderer-side surfaces (the state store — #134, later the render layer) can
// land in the same one-click debug bundle as the transport logs (#126), without ever giving the
// renderer a path to emit a secret.
//
// The producer here is the UNTRUSTED renderer. So this module ships projectDiagnosticEvent — the
// deterministic safety net the main receiver (receiveDiagnostic.ts) applies at the renderer→main
// boundary. The renderer holds no keys, tokens, or plaintext (CLAUDE.md), so it cannot forward a
// secret it never receives; the projection keeps that true even if the renderer is buggy.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the relative
// import in those callers (see tsconfig.node.json). RendererDiagnosticEvent is DEFINED here (not
// reached in from src/main) because src/shared is a clean leaf — the same convention commands.ts
// and events.ts follow. Its field-for-field identity with #126's DiagnosticEvent is pinned by a
// compile-time equality assertion in diagnostics.test.ts, so a future field there surfaces as a
// typecheck failure rather than a silent capability gap.

/** The IPC channel every content-free diagnostic record travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it.
 *  A mismatch would silently drop every record, so both sides reference this constant. */
export const DIAGNOSTIC_CHANNEL = 'pyry:diagnostic' as const

/**
 * The renderer-safe mirror of #126's allowlisted DiagnosticEvent — a content-free envelope of an
 * event: its name, a static classification code, byte lengths / counts, and safe connection
 * coordinates, never the value inside. Field-for-field identical to DiagnosticEvent (pinned by the
 * type-equality assertion in the test). This type is the COMPILE-TIME half of the allowlist (AC1):
 * it makes the correct call obvious at #134's call site. It is erased at runtime, so it provides
 * zero guarantee against a compromised renderer — projectDiagnosticEvent is the deterministic half
 * that actually enforces the allowlist at the untrusted boundary.
 */
export interface RendererDiagnosticEvent {
  /** Required. The event name, e.g. 'store-transition'. A static literal at each site. */
  event: string
  /** Static classification, e.g. 'ok', 'not-paired'. */
  code?: string
  /** An HTTP or WebSocket status number, e.g. 404, 1006. */
  status?: number
  /** A byte length — never the bytes themselves. */
  bytes?: number
  /** A count, e.g. the number of messages in a batch. */
  count?: number
  /** A safe connection coordinate — the relay HOSTNAME only. */
  host?: string
  /** A safe path component ('/v1/client') only, never the query string. */
  path?: string
  /** A one-way digest of an opaque frame/payload — never the bytes. Hex BLAKE2s-256. */
  hash?: string
}

/** The longest legitimate field is a 64-hex-char BLAKE2s hash; 128 is safe headroom. Bounds a
 *  compromised renderer's ability to bloat the log line / debug bundle (defense-in-depth). */
const MAX_STRING_LENGTH = 128

const capString = (value: string): string => value.slice(0, MAX_STRING_LENGTH)

/**
 * The deterministic boundary safety net (AC2). Validate AND project in one pass, returning a
 * FRESHLY built object literal containing only allowlisted fields — never `value` itself. This
 * matters because #126's logger.event() SPREADS its argument (`{ ...fields, seq, ts }`,
 * diagnosticLog.ts:87): forwarding a raw renderer object would spread any planted extra field
 * (`token`, `text`, `__proto__`, …) straight onto the log line. A function that only ever returns a
 * fresh object makes "forgot to project, forwarded raw" structurally impossible — the load-bearing
 * reason AC2/AC4 exist.
 *
 * Contract:
 *  - `event` is required: not a non-empty string → return null (nothing to log).
 *  - each optional field is copied only if present AND the correct primitive type; a wrong-typed
 *    optional is OMITTED, not fatal (a bogus `status` must not discard an otherwise-valid event).
 *  - fields are enumerated by name — an ALLOWLIST, fail-closed: a field not named here is
 *    structurally absent from the output, never a scrubbed-out denylist entry (which fails open).
 *  - each string field is truncated to MAX_STRING_LENGTH.
 */
export function projectDiagnosticEvent(value: unknown): RendererDiagnosticEvent | null {
  if (typeof value !== 'object' || value === null) return null

  if (!('event' in value) || typeof value.event !== 'string' || value.event.length === 0) {
    return null
  }

  const projected: RendererDiagnosticEvent = { event: capString(value.event) }

  if ('code' in value && typeof value.code === 'string') projected.code = capString(value.code)
  if ('host' in value && typeof value.host === 'string') projected.host = capString(value.host)
  if ('path' in value && typeof value.path === 'string') projected.path = capString(value.path)
  if ('hash' in value && typeof value.hash === 'string') projected.hash = capString(value.hash)

  if ('status' in value && typeof value.status === 'number' && Number.isFinite(value.status)) {
    projected.status = value.status
  }
  if ('bytes' in value && typeof value.bytes === 'number' && Number.isFinite(value.bytes)) {
    projected.bytes = value.bytes
  }
  if ('count' in value && typeof value.count === 'number' && Number.isFinite(value.count)) {
    projected.count = value.count
  }

  return projected
}
