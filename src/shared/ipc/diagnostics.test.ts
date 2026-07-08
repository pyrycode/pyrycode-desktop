import { describe, it, expect } from 'vitest'
import { DIAGNOSTIC_CHANNEL, projectDiagnosticEvent } from './diagnostics'

// This is a pure, Electron-free leaf test — it does NOT import across the shared→main boundary
// (src/shared is typechecked by BOTH tsconfigs, and the web project deliberately cannot reach
// src/main). The compile-time allowlist pin that ties RendererDiagnosticEvent to #126's
// DiagnosticEvent lives in the main-side receiveDiagnostic.test.ts, where crossing the boundary is
// legal under the node project.

describe('diagnostic channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The preload sender ships on this channel and the main receiver listens on it; a drift
    // between the two would silently drop every record. Pin it like the command constant.
    expect(DIAGNOSTIC_CHANNEL).toBe('pyry:diagnostic')
  })
})

describe('projectDiagnosticEvent', () => {
  it('returns a fresh object equal in allowlisted fields but not the same reference', () => {
    const input = {
      event: 'store-transition',
      code: 'ok',
      status: 200,
      bytes: 12,
      count: 3,
      host: 'relay.example.com',
      path: '/v1/client',
      hash: 'abc'
    }

    const output = projectDiagnosticEvent(input)

    expect(output).toEqual(input)
    expect(output).not.toBe(input) // projection, not pass-through
  })

  it('drops a planted secret in a non-allowlisted field (AC4)', () => {
    const output = projectDiagnosticEvent({
      event: 'store-transition',
      code: 'ok',
      token: 'SUPER_SECRET',
      text: 'plaintext'
    })

    expect(output).toEqual({ event: 'store-transition', code: 'ok' })
    expect(output).not.toHaveProperty('token')
    expect(output).not.toHaveProperty('text')
    const serialized = JSON.stringify(output)
    expect(serialized).not.toContain('SUPER_SECRET')
    expect(serialized).not.toContain('plaintext')
  })

  it('drops non-allowlisted fields while retaining allowlisted ones', () => {
    expect(projectDiagnosticEvent({ event: 'e', code: 'c', nope: 'x' })).toEqual({
      event: 'e',
      code: 'c'
    })
  })

  it('returns null when event is missing, empty, or non-string', () => {
    expect(projectDiagnosticEvent({ code: 'c' })).toBeNull()
    expect(projectDiagnosticEvent({ event: '' })).toBeNull()
    expect(projectDiagnosticEvent({ event: 42 })).toBeNull()
  })

  it('returns null for a null or non-object value', () => {
    expect(projectDiagnosticEvent(null)).toBeNull()
    expect(projectDiagnosticEvent(undefined)).toBeNull()
    expect(projectDiagnosticEvent('store-transition')).toBeNull()
    expect(projectDiagnosticEvent(42)).toBeNull()
  })

  it('omits a wrong-typed optional field but keeps the valid event (AC2)', () => {
    expect(projectDiagnosticEvent({ event: 'e', status: 'x', host: 42 })).toEqual({ event: 'e' })
  })

  it('omits a non-finite number field', () => {
    expect(projectDiagnosticEvent({ event: 'e', status: Infinity, bytes: NaN })).toEqual({
      event: 'e'
    })
  })

  it('truncates an over-long string field to 128 chars', () => {
    const output = projectDiagnosticEvent({ event: 'a'.repeat(200), code: 'b'.repeat(200) })

    expect(output?.event).toHaveLength(128)
    expect(output?.code).toHaveLength(128)
  })
})
