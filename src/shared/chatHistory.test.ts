import { describe, expect, it } from 'vitest'
import { parseChatHistoryRequest, parseChatHistorySnapshot, threadHistoryCodec } from './chatHistory'

const summary = { id: 'chat', name: null, is_promoted: false, is_archived: true, cwd: '/display', last_message_ts: '', last_used_at: 'date', workspace_label: null }

describe('chat history records and requests', () => {
  it('admits bounded opaque recovery only on before-page requests and detached partial pages', () => {
    const request = { operation: 'beforeThreadPage', serverId: 'host', conversationId: 'chat', limit: 20, continuation: 'YQ', recovery: 'Yg' }
    expect(parseChatHistoryRequest(request)).toEqual(request)
    const value = { partial: true, metadata: { hostId: 'host', conversationId: 'chat', epoch: 'e', version: 0, checkpoint: 0, repair: null },
      items: [], ranges: [], continuation: 'YQ', recovery: 'Yg' }
    const parsed = threadHistoryCodec.page(value, 'host', 'chat')
    value.recovery = 'Yw'
    expect(parsed.recovery).toBe('Yg')
    for (const recovery of ['', null, 2, 'private text', 'Y'.repeat(65537)]) {
      expect(() => parseChatHistoryRequest({ ...request, recovery })).toThrow()
      expect(() => threadHistoryCodec.page({ ...value, recovery }, 'host', 'chat')).toThrow()
    }
    expect(() => parseChatHistoryRequest({ ...request, operation: 'newestThreadPage' })).toThrow()
  })
  it('detaches reset identities and boundary observations and rejects malformed ownership', () => {
    const metadata = { hostId: 'h', conversationId: 'c', epoch: 'e', version: 2, checkpoint: 2, uncommittedVersion: 0, repair: null }
    const observation = { metadata, completion: { fromVersion: 0, version: 2 }, availability: { start: 100, available: false } }
    const request = { operation: 'mutateThread', serverId: 'h', conversationId: 'c', change: {
      ...observation, resetId: 'reset', acceptEpoch: true, priorProgress: [observation], items: [], removeIds: [], ranges: []
    } }
    const parsed = parseChatHistoryRequest(request)
    observation.availability.start = 0
    expect(parsed).toMatchObject({ change: { availability: { start: 100 }, priorProgress: [{ availability: { start: 100 } }] } })
    for (const patch of [{ resetId: 2 }, { resetId: 'x'.repeat(8193) },
      { availability: { start: -1, available: true } }, { availability: { start: 1, available: 'yes' } },
      { completion: undefined, availability: { start: 1, available: true } },
      { priorProgress: [{ ...observation, availability: { start: 1, available: true, extra: 1 } }] }
    ]) expect(() => parseChatHistoryRequest({ ...request, change: { ...request.change, ...patch } })).toThrow()
  })
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


describe.each(['archived_at', 'pinned_at'])('saved list %s timestamp', (field) => {
  const list = (rows: unknown[]) => ({ version: 1, kind: 'list', serverId: 'host', conversations: rows })
  it.each(['2026-09-30T12:00:00Z', 'invalid-time', '', null])('preserves %s through JSON restoration', (archived_at) => {
    const saved = list([{ ...summary, [field]: archived_at }])
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it('restores a pre-field saved snapshot without inventing an archive time', () => {
    const saved = list([summary])
    expect(parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it.each([false, true, 1, {}, []])('rejects wrong-type saved stamps: %s', (archived_at) => {
    expect(() => parseChatHistorySnapshot(list([{ ...summary, [field]: archived_at }]))).toThrow()
  })
  it('never echoes invalid input', () => {
    expect(() => parseChatHistorySnapshot(list([{ ...summary, [field]: { private: 'PRIVATE_SENTINEL' } }]))).toThrow()
    try { parseChatHistorySnapshot(list([{ ...summary, [field]: { private: 'PRIVATE_SENTINEL' } }])) }
    catch (error) { expect(String(error)).not.toContain('PRIVATE_SENTINEL') }
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


describe('owned progress admission', () => {
  const metadata = { hostId: 'host', conversationId: 'chat', epoch: 'e', version: 12,
    checkpoint: 12, uncommittedVersion: 0, repair: null }
  const completion = { fromVersion: 0, version: 5 }
  const change = { metadata, acceptEpoch: true, items: [], removeIds: [], ranges: [],
    priorProgress: [{ metadata: { ...metadata, version: 5, checkpoint: 5 }, completion }] }
  const request = (c: object) => ({ operation: 'mutateThread', serverId: 'host', conversationId: 'chat', change: c })
  it('detaches exact completion evidence instead of assigning the latest live checkpoint', () => {
    const parsed = parseChatHistoryRequest(request(change))
    expect(parsed).toEqual(request(change))
    expect(parsed).not.toBe(change)
    if (parsed.operation !== 'mutateThread') throw Error('expected mutation')
    expect(parsed.change.priorProgress?.[0].metadata).not.toBe(change.priorProgress[0].metadata)
    expect(parsed.change.priorProgress?.[0].completion).not.toBe(completion)
    expect(parsed.change).not.toHaveProperty('completion')
  })
  it.each([
    { completion: { fromVersion: 6, version: 5 } },
    { completion: { fromVersion: 0, version: 13 } },
    { completion: { fromVersion: -1, version: 5 } },
    { completion: { fromVersion: 0, version: 0.5 } },
    { completion: { ...completion, certified: true } },
    { completion: true }, { certified: true },
    { priorProgress: [{ metadata: { ...metadata, epoch: 'other' } }] },
    { priorProgress: [{ metadata: { ...metadata, hostId: 'other' } }] },
    { priorProgress: [{ metadata: { ...metadata, conversationId: 'other' } }] },
    { priorProgress: [{ metadata, completion: { fromVersion: 0, version: 13 } }] },
    { priorProgress: [{ metadata, other: true }] },
    { priorProgress: Array(100_001).fill({ metadata }) }
  ])('rejects malformed or cross-owner progress %#', extra => {
    expect(() => parseChatHistoryRequest(request({ ...change, ...extra }))).toThrow()
  })
})
