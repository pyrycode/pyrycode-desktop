import { describe, it, expect } from 'vitest'
import { buildReadWorkspaceFile } from './readWorkspaceFileEnvelope'
import { decodeEnvelope } from './codec'
import { MAX_PLAINTEXT_BYTES } from '../../shared/wire/types'
import type { ReadWorkspaceFilePayload } from '../../shared/wire/types'
import {
  MAX_WORKSPACE_FILE_PATH_LENGTH
} from '../../shared/ipc/workspaceFileRead'
import { MAX_RETRIEVAL_IDENTIFIER_LENGTH } from '../../shared/ipc/attachmentRetrieval'

// The pure builder mirrors buildRequestAttachment: (id, ts, payload) → serialized
// read_workspace_file bytes, no clock, counter or side effect. The REAL codec, so the assertions pin
// actual wire bytes.
describe('buildReadWorkspaceFile', () => {
  const PAYLOAD: ReadWorkspaceFilePayload = {
    conversation_id: '9d4e7a21-8c05-4f3b-b6e2-1a7c9e30d5f4',
    path: 'docs/notes/plan.md'
  }

  it('encodes the envelope in wire order: id, type, ts, then conversation_id and path', () => {
    const bytes = buildReadWorkspaceFile({ id: 91, ts: '2026-09-24T09:14:05Z', payload: PAYLOAD })

    expect(new TextDecoder().decode(bytes)).toBe(
      '{"id":91,"type":"read_workspace_file","ts":"2026-09-24T09:14:05Z","payload":' +
        '{"conversation_id":"9d4e7a21-8c05-4f3b-b6e2-1a7c9e30d5f4","path":"docs/notes/plan.md"}}'
    )
  })

  it('carries exactly the two payload keys and no request id of any kind', () => {
    // Correlation rides the ENVELOPE (in_reply_to); the window's request key is client-internal and
    // never reaches the daemon.
    const envelope = decodeEnvelope(
      buildReadWorkspaceFile({ id: 7, ts: '2026-09-24T12:00:00.000Z', payload: PAYLOAD })
    )

    expect(envelope.type).toBe('read_workspace_file')
    expect(envelope.id).toBe(7)
    expect(Object.keys(envelope.payload as Record<string, unknown>)).toEqual([
      'conversation_id',
      'path'
    ])
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('stays under MAX_PLAINTEXT_BYTES for the worst-case ask the IPC guard admits', () => {
    // Every code unit a control character, the one JSON escapes to six bytes (\u00XX): the largest
    // envelope a guarded ask can produce. This is what makes the guard's bounds a proof that the
    // build never throws for an accepted ask, rather than a hope.
    const worst = '\u0001'
    const bytes = buildReadWorkspaceFile({
      id: Number.MAX_SAFE_INTEGER,
      ts: '2026-09-24T12:00:00.000000000+00:00',
      payload: {
        conversation_id: worst.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH),
        path: worst.repeat(MAX_WORKSPACE_FILE_PATH_LENGTH)
      }
    })

    expect(bytes.length).toBeLessThan(MAX_PLAINTEXT_BYTES)
  })
})
