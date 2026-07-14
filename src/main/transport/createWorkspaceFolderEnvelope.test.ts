import { describe, it, expect } from 'vitest'
import { buildCreateWorkspaceFolder } from './createWorkspaceFolderEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type CreateWorkspaceFolderPayload } from '../../shared/wire/types'

// The pure builder mirrors buildCreateConversation: (id, ts, payload) → serialized
// create_workspace_folder bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes — the request payload is exactly the two required strings
// { parent, name } (#381).
describe('buildCreateWorkspaceFolder', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips a create_workspace_folder envelope carrying exactly { parent, name }', () => {
    const payload: CreateWorkspaceFolderPayload = { parent: '/home/user/projects', name: 'new-app' }

    const bytes = buildCreateWorkspaceFolder({ id: 2, ts: FIXED_TS, payload })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('create_workspace_folder')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual({ parent: '/home/user/projects', name: 'new-app' })
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap (over-long name)', () => {
    const overCap: CreateWorkspaceFolderPayload = {
      parent: '/home/user/projects',
      name: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildCreateWorkspaceFolder({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
