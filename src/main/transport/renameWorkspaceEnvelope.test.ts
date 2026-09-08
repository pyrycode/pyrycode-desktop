import { describe, it, expect } from 'vitest'
import { buildRenameWorkspace } from './renameWorkspaceEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type RenameWorkspacePayload } from '../../shared/wire/types'

// The pure builder mirrors buildRenameConversation: (id, ts, payload) → serialized rename_workspace
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire
// bytes — the request payload is exactly { path, label } (#1289).
describe('buildRenameWorkspace', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips a rename_workspace envelope carrying exactly { path, label }', () => {
    const payload: RenameWorkspacePayload = { path: '/home/user/projects/app', label: 'Ledger' }

    const bytes = buildRenameWorkspace({ id: 2, ts: FIXED_TS, payload })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('rename_workspace')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual({ path: '/home/user/projects/app', label: 'Ledger' })
  })

  it('preserves a literal null label — the CLEAR signal, never dropped to an absent key', () => {
    // The one field posture that distinguishes this verb from its two-required-strings neighbours:
    // the daemon reads an absent `label` as malformed and a literal null as "clear the label", so a
    // serializer that omitted the key would silently change the request's meaning.
    const payload: RenameWorkspacePayload = { path: '/home/user/projects/app', label: null }

    const decoded = decodeEnvelope(buildRenameWorkspace({ id: 3, ts: FIXED_TS, payload }))

    expect(decoded.payload).toEqual({ path: '/home/user/projects/app', label: null })
    expect(JSON.stringify(decoded.payload)).toContain('"label":null')
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap (over-long label)', () => {
    const overCap: RenameWorkspacePayload = {
      path: '/home/user/projects/app',
      label: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildRenameWorkspace({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
