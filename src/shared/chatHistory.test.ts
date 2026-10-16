import { describe, expect, it } from 'vitest'
import { parseChatHistoryRequest, parseChatHistorySnapshot } from './chatHistory'

const summary = { id: 'chat', name: null, is_promoted: false, is_archived: true, cwd: '/display', last_message_ts: '', last_used_at: 'date', workspace_label: null }

describe('chat history records and requests', () => {
  it('projects and detaches ordered list rows without retaining undeclared fields', () => {
    const rows = [{ ...summary, token: 'secret' }, { ...summary, id: 'second', name: 'named', token: 'secret' }]
    const parsed = parseChatHistorySnapshot({ version: 1, kind: 'list', serverId: 'host', conversations: rows })
    rows.length = 0
    expect(parsed).toEqual({ version: 1, kind: 'list', serverId: 'host',
      conversations: [summary, { ...summary, id: 'second', name: 'named' }] })
    expect(JSON.stringify(parsed)).not.toContain('secret')
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
  it.each([null, [], {}, { version: 2, kind: 'list', serverId: 'host', conversations: [] },
    { version: 1, kind: 'timeline', serverId: 'host', conversationId: 'chat', items: [] },
    { version: 1, kind: 'list', serverId: 'host', conversations: [null] }
  ])('rejects malformed or retired snapshots', value => { expect(() => parseChatHistorySnapshot(value)).toThrow() })
  it('validates operation shapes, coordinates and bounded identities', () => {
    for (const operation of ['readList', 'removeServer']) expect(parseChatHistoryRequest({ operation, serverId: '' })).toMatchObject({ operation })
    for (const operation of ['readThread', 'removeConversation']) expect(parseChatHistoryRequest({ operation, serverId: 'host', conversationId: '../chat' })).toMatchObject({ operation })
    for (const value of [null, { operation: 'readList', serverId: 'x', path: '/tmp' },
      { operation: 'readList', serverId: 'x'.repeat(8193) }, { operation: 'readTimeline', serverId: 'x' },
      { operation: 'replaceTimeline', serverId: 'host', conversationId: 'chat', snapshot: {} },
      { operation: 'replaceList', serverId: 'host', snapshot: {} }, { operation: 'delete', serverId: 'host' }
    ]) expect(() => parseChatHistoryRequest(value)).toThrow()
  })
})


describe('saved list archive timestamp', () => {
  const list = (rows: unknown[]) => ({ version: 1, kind: 'list', serverId: 'host', conversations: rows })
  it.each(['2026-09-30T12:00:00Z', 'invalid-time', '', null])('preserves %s through JSON restoration', (archived_at) => {
    const saved = list([{ ...summary, archived_at }])
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it('restores a pre-field saved snapshot without inventing an archive time', () => {
    const saved = list([summary])
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it.each([false, true, 1, {}, []])('rejects wrong-type saved stamps: %s', (archived_at) => {
    expect(() => parseChatHistorySnapshot(list([{ ...summary, archived_at }]))).toThrow()
  })
})

describe('saved received read IDs', () => {
  const list = (row: unknown) => ({ version: 1, kind: 'list', serverId: 'host', conversations: [row] })
  it('restores zero, safe maximum and legacy omission without inventing fields', () => {
    const row = { ...summary, read_up_to: 0, latest_entry_id: Number.MAX_SAFE_INTEGER }
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(list(row))))).toEqual(list(row))
    expect(parseChatHistorySnapshot(list(summary))).toEqual(list(summary))
  })
  it.each([null, -1, 0.5, '1', {}, Number.MAX_SAFE_INTEGER + 1])('rejects invalid marks %j', (value) => {
    for (const key of ['read_up_to', 'latest_entry_id']) {
      expect(() => parseChatHistorySnapshot(list({ ...summary, [key]: value }))).toThrow()
    }
  })
})
