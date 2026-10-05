import { describe, it, expect, vi } from 'vitest'
import { onDiagnostic, type DiagnosticSource } from './receiveDiagnostic'
import { createDiagnosticLog, type DiagnosticLog, type DiagnosticEvent } from './diagnosticLog'
import { DIAGNOSTIC_CHANNEL, type RendererDiagnosticEvent } from '../shared/ipc/diagnostics'

// Compile-time pin (AC "single allowlist"): the renderer-safe RendererDiagnosticEvent must stay
// identical to #126's canonical DiagnosticEvent MODULO the main-only fields. A drift in EITHER
// direction turns Equals<…> into `false`, so `const _pin: true = false` fails `npm run typecheck`
// (which includes this .test.ts under the node project — the only project that spans both src/main
// and src/shared). This is the deterministic net that lets the security audit trust ONE allowlist
// across the IPC boundary. It lives here, main-side, because crossing the shared→main boundary is
// illegal from a src/shared test (the web project cannot reach src/main).
//
// #133: the canonical allowlist now also carries `safeBytes` — a branded pre-decryption byte
// encoding populated ONLY by main-process transport failure paths. The renderer holds no frame bytes
// (transport-out-of-the-window, CLAUDE.md) and cannot even reference the branded type across the
// shared→main leaf boundary, so RendererDiagnosticEvent deliberately omits it. The pin therefore
// subtracts `safeBytes` from the canonical side. The security-relevant guarantee is UNCHANGED: every
// field the untrusted renderer can send is still exactly a canonical allowlisted field (so it cannot
// smuggle a field #126's logger would spread onto the log line); only the reverse capability-parity
// direction is relaxed, and only for fields the renderer must never produce. A future main-only field
// must be added to this Omit list — a conscious, reviewed decision — or the pin breaks.
//
// #132: the startup session banner adds three more main-only fields — `appVersion`, `noiseProtocol`,
// `protocolVersion` — emitted ONLY from the composition root (sourced from Electron's app.getVersion()
// and the shared wire constants). The renderer has no reason and no capability to emit a version
// banner, so RendererDiagnosticEvent deliberately omits them too; keeping them out of the renderer
// mirror is what preserves "every field the renderer can send is a canonical allowlisted field". They
// are subtracted from the canonical side here, exactly as #133 did for `safeBytes`.
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const _allowlistPin: Equals<
  RendererDiagnosticEvent,
  Omit<DiagnosticEvent, 'messageId' | 'connectionId' | 'safeBytes' | 'appVersion' | 'noiseProtocol' | 'protocolVersion'>
> = true
void _allowlistPin

// A structural stand-in for Electron's ipcMain: only on/removeListener, spied. No Electron
// harness needed — the receiver is typed against the minimal source, not ipcMain.
function fakeSource(): DiagnosticSource & {
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
} {
  return { on: vi.fn(), removeListener: vi.fn() }
}

describe('onDiagnostic', () => {
  it('registers exactly one listener on the diagnostic channel', () => {
    const source = fakeSource()

    onDiagnostic(source, { event: vi.fn() })

    expect(source.on).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(source.on).toHaveBeenCalledWith(DIAGNOSTIC_CHANNEL, expect.any(Function))
  })

  it('forwards the projected record to logger.event, stripping the IpcMainEvent', () => {
    const source = fakeSource()
    const logger: DiagnosticLog = { event: vi.fn() }
    onDiagnostic(source, logger)
    const listener = source.on.mock.calls[0][1]

    const fakeEvent = { sender: 'must-not-be-forwarded' }
    listener(fakeEvent, { event: 'store-transition', code: 'ok' })

    expect(logger.event).toHaveBeenCalledTimes(1)
    expect(logger.event).toHaveBeenCalledWith({ event: 'store-transition', code: 'ok' })
    expect((logger.event as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1) // event stripped
  })

  it('never lets a planted secret reach the real logger end-to-end (AC4)', () => {
    // Wire the receiver to a REAL logger over a capture sink, so the assertion covers the whole
    // path — including #126's `{ ...fields }` spread, the foot-gun a raw-forward would trip.
    const lines: string[] = []
    const logger = createDiagnosticLog({ sink: { write: (line) => void lines.push(line) } })
    const source = fakeSource()
    onDiagnostic(source, logger)
    const listener = source.on.mock.calls[0][1]

    listener({}, { event: 'store-transition', secret: 'SUPER_SECRET', text: 'plaintext' })

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('SUPER_SECRET')
    expect(lines[0]).not.toContain('plaintext')
    expect(JSON.parse(lines[0]).event).toBe('store-transition')
  })

  it('drops a malformed record without calling logger.event (AC2)', () => {
    const source = fakeSource()
    const logger: DiagnosticLog = { event: vi.fn() }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onDiagnostic(source, logger)
    const listener = source.on.mock.calls[0][1]

    listener({}, { code: 'no-event-field' })

    expect(logger.event).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('swallows a throwing logger so a diagnostics fault never crashes the observee (AC3)', () => {
    const source = fakeSource()
    const logger: DiagnosticLog = {
      event() {
        throw new Error('boom')
      }
    }
    onDiagnostic(source, logger)
    const listener = source.on.mock.calls[0][1]

    expect(() => listener({}, { event: 'store-transition' })).not.toThrow()
  })

  it('unsubscribes the exact listener it registered', () => {
    const source = fakeSource()

    const unsubscribe = onDiagnostic(source, { event: vi.fn() })
    const listener = source.on.mock.calls[0][1]
    unsubscribe()

    expect(source.removeListener).toHaveBeenCalledTimes(1)
    expect(source.removeListener).toHaveBeenCalledWith(DIAGNOSTIC_CHANNEL, listener)
  })
})
