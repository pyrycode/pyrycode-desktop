import { describe, expect, it } from 'vitest'
import { parseChatHistoryRequest, parseChatHistorySnapshot, type DurableThreadItem } from './chatHistory'

const items: DurableThreadItem[] = [
  { kind: 'userText', text: 'hello', createdAt: 123, messageId: 'msg', attachments: [{ attachmentId: 'a', filename: 'a.png' }] },
  { kind: 'assistantText', turnId: 'turn', text: 'partial', createdAt: 124 },
  { kind: 'toolCall', turnId: 'turn', toolUseId: 'tool', parentToolUseId: 'parent', name: 'Read', inputSummary: 'file',
    input: JSON.parse('{"__proto__":"inert","path":"file"}'), result: { isError: false, resultSummary: 'ok', resultDetail: '' },
    denial: { toolName: 'Read', decisionReasonType: 'rule', decisionReason: 'denied', message: 'no', truncatedFields: [], droppedFields: null }, elapsedSeconds: 1.5 },
  { kind: 'turnBoundary', turnId: 'turn', stopReason: 'done', outcome: 'complete', isError: false, terminalReason: 'finished', errorCategory: '' },
  { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: 'date' },
  { kind: 'unrecognizedMessage', site: 'undecodable', messageType: '', raw: '<script>', truncated: true },
  { kind: 'compactionBoundary', failed: false, manual: true, preTokens: null, postTokens: 123 },
  { kind: 'banner', level: 'warning', text: 'report', stopsTurn: false, truncated: false },
  { kind: 'modelRefusal', refusal: { type: 'modelRefusalFallback', originalModel: 'old', fallbackModel: 'new', scope: 'session', refusalCategory: 'policy', banner: 'fallback', truncatedFields: null, droppedFields: ['detail'] } },
  { kind: 'modelRefusal', refusal: { type: 'modelRefusalNoFallback', originalModel: 'old', refusalCategory: 'policy', banner: 'refused', truncatedFields: [], droppedFields: null } },
  { kind: 'toolCall', turnId: '', toolUseId: '', name: '', inputSummary: '', result: null },
  { kind: 'userText', text: '', createdAt: undefined },
  { kind: 'compactionBoundary', failed: true, manual: false }
]
const timeline = { version: 1, kind: 'timeline', serverId: 'host', conversationId: 'chat', items, prependedRows: 12,
  coverage: { status: 'received', cursor: 'opaque', atStart: false } }
const summary = { id: 'chat', name: null, is_promoted: false, is_archived: true, cwd: '/display', last_message_ts: '', last_used_at: 'date', workspace_label: null }

describe('chat history records and requests', () => {
  it('matches every current ThreadItem field and preserves ordered rows and coverage', () => {
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(timeline)))).toEqual(timeline)
    for (const coverage of [{ status: 'unknown' }, { status: 'received', cursor: '', atStart: true }]) {
      expect(parseChatHistorySnapshot({ ...timeline, items: [], coverage })).toMatchObject({ items: [], coverage })
    }
  })
  it('projects only declared fields recursively and detaches mutable input', () => {
    const value = { ...timeline, credentials: 'secret', phase: 'responding', items: [
      { kind: 'userText', text: 'safe', attachments: [{ attachmentId: 'a', filename: 'f', bytes: 'secret' }], pendingPermission: 'secret' },
      { ...items[2], input: {}, result: { isError: true, resultSummary: 'oops', token: 'secret' } }
    ] }
    const parsed = parseChatHistorySnapshot(value)
    expect(JSON.stringify(parsed)).not.toContain('secret')
    value.items.length = 0
    expect(parsed.kind === 'timeline' && parsed.items).toHaveLength(2)
    const list = parseChatHistorySnapshot({ version: 1, kind: 'list', serverId: 'host', conversations: [
      { ...summary, token: 'secret' }, { ...summary, id: 'second', name: 'named' }
    ] })
    expect(list).toEqual({ version: 1, kind: 'list', serverId: 'host', conversations: [summary, { ...summary, id: 'second', name: 'named' }] })
  })
  it('carries a list row muted flag through, restores a pre-flag row as not muted, and rejects a non-boolean', () => {
    const list = (rows: unknown[]) => ({ version: 1, kind: 'list', serverId: 'host', conversations: rows })
    const muted = parseChatHistorySnapshot(list([{ ...summary, is_muted: true }, { ...summary, id: 'b', is_muted: false }, { ...summary, id: 'c' }]))
    const rows = muted.kind === 'list' ? muted.conversations : []
    expect(rows.map((row) => row.is_muted)).toEqual([true, false, undefined])
    for (const is_muted of ['true', 1, null]) expect(() => parseChatHistorySnapshot(list([{ ...summary, is_muted }]))).toThrow()
  })
  it('carries a list row agent through as codex or claude, restores an untagged row without one, and rejects a non-string', () => {
    const list = (rows: unknown[]) => ({ version: 1, kind: 'list', serverId: 'host', conversations: rows })
    const parsed = parseChatHistorySnapshot(list([
      { ...summary, agent: 'codex' }, { ...summary, id: 'b', agent: 'claude' }, { ...summary, id: 'c', agent: 'other' }, { ...summary, id: 'd' }
    ]))
    const rows = parsed.kind === 'list' ? parsed.conversations : []
    expect(rows.map((row) => row.agent)).toEqual(['codex', 'claude', 'claude', undefined])
    expect('agent' in rows[3]).toBe(false)
    for (const agent of [1, null, {}]) expect(() => parseChatHistorySnapshot(list([{ ...summary, agent }]))).toThrow()
  })
  it.each([null, [], {}, { ...timeline, version: 2 }, { ...timeline, prependedRows: -1 },
    { ...timeline, items: [{ kind: 'assistantText', text: 2 }] }, { ...timeline, coverage: { status: 'requested' } },
    { ...timeline, coverage: { status: 'received', cursor: '', atStart: 'yes' } },
    { ...timeline, items: [{ ...items[2], result: { isError: false } }] },
    { ...timeline, items: [{ ...items[0], createdAt: NaN }] },
    { ...timeline, items: [{ kind: 'userText', text: 'x'.repeat(16 * 1024 * 1024 + 1) }] },
    { ...timeline, items: new Array(100_001).fill(null) }
  ])('rejects malformed snapshots', (value) => { expect(() => parseChatHistorySnapshot(value)).toThrow() })
  it('validates operation shapes, coordinates and bounded identities', () => {
    for (const operation of ['readList', 'removeServer']) expect(parseChatHistoryRequest({ operation, serverId: '' })).toMatchObject({ operation })
    for (const operation of ['readTimeline', 'removeConversation']) expect(parseChatHistoryRequest({ operation, serverId: 'host', conversationId: '../chat' })).toMatchObject({ operation })
    expect(parseChatHistoryRequest({ operation: 'replaceTimeline', serverId: 'host', conversationId: 'chat', snapshot: timeline })).toMatchObject({ snapshot: timeline })
    for (const value of [null, { operation: 'readList', serverId: 'x', path: '/tmp' },
      { operation: 'readList', serverId: 'x'.repeat(8193) }, { operation: 'readTimeline', serverId: 'x' },
      { operation: 'replaceTimeline', serverId: 'other', conversationId: 'chat', snapshot: timeline },
      { operation: 'replaceList', serverId: 'host', snapshot: timeline }, { operation: 'delete', serverId: 'host' }
    ]) expect(() => parseChatHistoryRequest(value)).toThrow()
  })
})
