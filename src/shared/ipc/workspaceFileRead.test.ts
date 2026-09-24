import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_FILE_READ_CHANNEL,
  WORKSPACE_FILE_READ_EVENT_CHANNEL,
  isWorkspaceFileReadRequest,
  MAX_WORKSPACE_FILE_PATH_LENGTH
} from './workspaceFileRead'
import { DAEMON_EVENT_CHANNEL } from './events'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
  MAX_RETRIEVAL_IDENTIFIER_LENGTH
} from './attachmentRetrieval'

const VALID = {
  requestKey: 'read-1',
  conversationId: '7a1f6b2c-9e04-4d3a-8f52-13c6b0d9a4e1',
  path: 'docs/notes/plan.md'
}

describe('workspace-file-read channels', () => {
  it('are distinct from each other and from every neighbouring channel', () => {
    // Off DAEMON_EVENT_CHANNEL so an outcome never reaches the daemon-event bridges.
    const channels = [
      WORKSPACE_FILE_READ_CHANNEL,
      WORKSPACE_FILE_READ_EVENT_CHANNEL,
      DAEMON_EVENT_CHANNEL,
      ATTACHMENT_RETRIEVAL_CHANNEL,
      ATTACHMENT_RETRIEVAL_EVENT_CHANNEL
    ]
    expect(new Set(channels).size).toBe(channels.length)
  })
})

describe('isWorkspaceFileReadRequest', () => {
  it('accepts a well-formed ask', () => {
    expect(isWorkspaceFileReadRequest(VALID)).toBe(true)
  })

  it('accepts a path of any shape within the bound, leaving confinement to the daemon', () => {
    // Shape and size only: this side never resolves the path, so a canonicity check here would guard
    // nothing. The daemon confines it to the conversation's workspace.
    expect(isWorkspaceFileReadRequest({ ...VALID, path: '../../etc/passwd' })).toBe(true)
    expect(isWorkspaceFileReadRequest({ ...VALID, path: '/Users/someone/notes.md' })).toBe(true)
  })

  it('refuses a non-object, null and a primitive', () => {
    expect(isWorkspaceFileReadRequest(null)).toBe(false)
    expect(isWorkspaceFileReadRequest(undefined)).toBe(false)
    expect(isWorkspaceFileReadRequest('docs/plan.md')).toBe(false)
    expect(isWorkspaceFileReadRequest(7)).toBe(false)
  })

  it('refuses a missing field', () => {
    expect(isWorkspaceFileReadRequest({ conversationId: VALID.conversationId, path: VALID.path })).toBe(
      false
    )
    expect(isWorkspaceFileReadRequest({ requestKey: VALID.requestKey, path: VALID.path })).toBe(false)
    expect(
      isWorkspaceFileReadRequest({ requestKey: VALID.requestKey, conversationId: VALID.conversationId })
    ).toBe(false)
  })

  it('refuses a non-string or explicitly-undefined field', () => {
    expect(isWorkspaceFileReadRequest({ ...VALID, path: 7 })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, path: ['docs', 'plan.md'] })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, path: undefined })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, requestKey: 1 })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, conversationId: null })).toBe(false)
  })

  it('refuses an empty value in any field', () => {
    expect(isWorkspaceFileReadRequest({ ...VALID, path: '' })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, requestKey: '' })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, conversationId: '' })).toBe(false)
  })

  it('refuses a path over its bound and accepts one exactly at it', () => {
    expect(
      isWorkspaceFileReadRequest({ ...VALID, path: 'p'.repeat(MAX_WORKSPACE_FILE_PATH_LENGTH + 1) })
    ).toBe(false)
    expect(
      isWorkspaceFileReadRequest({ ...VALID, path: 'p'.repeat(MAX_WORKSPACE_FILE_PATH_LENGTH) })
    ).toBe(true)
  })

  it('bounds the request key and the conversation id by the shared identifier bound', () => {
    const over = 'x'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1)
    const atLimit = 'y'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH)
    expect(isWorkspaceFileReadRequest({ ...VALID, requestKey: over })).toBe(false)
    expect(isWorkspaceFileReadRequest({ ...VALID, conversationId: over })).toBe(false)
    expect(
      isWorkspaceFileReadRequest({ ...VALID, requestKey: atLimit, conversationId: atLimit })
    ).toBe(true)
  })

  it('refuses a prototype-polluting ask read back under its own key', () => {
    const hostile = JSON.parse(
      '{"requestKey":"k","conversationId":"c","__proto__":{"path":"notes.md"}}'
    ) as unknown
    expect(isWorkspaceFileReadRequest(hostile)).toBe(false)
  })
})
