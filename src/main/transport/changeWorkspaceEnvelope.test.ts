import { describe, it, expect } from 'vitest'
import { buildChangeWorkspace } from './changeWorkspaceEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type ChangeWorkspacePayload } from '../../shared/wire/types'

// The pure builder mirrors buildRenameConversation: (id, ts, payload) → serialized change_workspace
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire bytes.
// Two required-string fields (conversation_id, cwd), so — like rename — there is no explicit-null
// subtlety to preserve (#379).
describe('buildChangeWorkspace', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips a change_workspace envelope carrying the exact id, ts, and payload', () => {
    const payload: ChangeWorkspacePayload = { conversation_id: 'conv-9', cwd: '/home/user/project' }

    const envelope = decodeEnvelope(buildChangeWorkspace({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('change_workspace')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: ChangeWorkspacePayload = {
      conversation_id: 'conv-9',
      cwd: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildChangeWorkspace({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
