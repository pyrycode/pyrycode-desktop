import { describe, it, expect, vi } from 'vitest'
import { logSessionStart } from './sessionBanner'
import { createDiagnosticLog, type DiagnosticLog } from './diagnosticLog'
import { NOISE_PROTOCOL, PROTOCOL_VERSION } from '../shared/wire/types'

describe('logSessionStart', () => {
  it('emits exactly one banner record at startup (a)', () => {
    const lines: string[] = []
    const log = createDiagnosticLog({ sink: { write: (line) => void lines.push(line) } })

    logSessionStart(log, '9.9.9-test')

    expect(lines).toHaveLength(1)
  })

  it('carries the app version and the wire-protocol identity verbatim (b)', () => {
    const lines: string[] = []
    const log = createDiagnosticLog({ sink: { write: (line) => void lines.push(line) } })

    logSessionStart(log, '9.9.9-test')

    const record = JSON.parse(lines[0])
    expect(record.event).toBe('session-start')
    expect(record.appVersion).toBe('9.9.9-test')
    // Assert against the imported constants, not retyped literals — proves "reused verbatim".
    expect(record.noiseProtocol).toBe(NOISE_PROTOCOL)
    expect(record.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('carries no field beyond the allowlisted version fields (c)', () => {
    const lines: string[] = []
    const log = createDiagnosticLog({ sink: { write: (line) => void lines.push(line) } })

    logSessionStart(log, '9.9.9-test')

    const record = JSON.parse(lines[0])
    // Nothing secret-shaped: exactly the four caller fields plus the logger's own seq/ts stamps.
    expect(Object.keys(record).sort()).toEqual(
      ['appVersion', 'event', 'noiseProtocol', 'protocolVersion', 'seq', 'ts'].sort()
    )
  })

  it('calls logger.event once with exactly the four version fields (c, at the call boundary)', () => {
    const log: DiagnosticLog = { event: vi.fn() }

    logSessionStart(log, '9.9.9-test')

    expect(log.event).toHaveBeenCalledTimes(1)
    expect(log.event).toHaveBeenCalledWith({
      event: 'session-start',
      appVersion: '9.9.9-test',
      noiseProtocol: NOISE_PROTOCOL,
      protocolVersion: PROTOCOL_VERSION
    })
  })
})
