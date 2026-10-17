import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import type { ConnectionStatus } from '../../store/sessionStore'
import { partitionActive, partitionSidebar } from './channelListViewModel'
import { ChannelListView } from './ChannelList'

const row = (id: string, pinned_at: string | null = '2026-10-01T00:00:00Z', serverId = 'a') => ({
  id, serverId, pinned_at, name: id, is_promoted: true, is_archived: false,
  cwd: '', workspace_label: null, last_message_ts: '', last_used_at: ''
})
const identity = (r: ReturnType<typeof row>) => [r.serverId, r.id]

describe('sidebar pin partition', () => {
  it('orders true instants oldest first with arbitrary fractional precision and identity ties', () => {
    const rows = [row('same', '2026-10-01T01:00:00.000100+01:00', 'b'),
      row('z', '2026-10-01T00:00:00.0001000Z'), row('same', '2026-10-01T00:00:00.0001Z'),
      row('later', '2026-10-01T00:00:00.000100000000000001Z'),
      row('first', '2026-09-30T23:59:59.999999Z')]
    const before = JSON.stringify(rows)
    expect(partitionSidebar(rows, ['a', 'b']).pinned.map(identity)).toEqual([
      ['a', 'first'], ['a', 'same'], ['a', 'z'], ['b', 'same'], ['a', 'later']
    ])
    expect(JSON.stringify(rows)).toBe(before)
  })
  it('keeps invalid timestamps after valid ones, rejects bare/impossible dates, and uses UTF-16 ties', () => {
    const rows = [row('\uE000', 'bad'), row('😀', '2026-02-30T00:00:00Z'),
      row('B', '2026-10-01'), row('A', ''), row('valid', '2024-02-29T00:00:00z')]
    expect(partitionSidebar(rows, ['a']).pinned.map(r => r.id)).toEqual(['valid', 'A', 'B', '😀', '\uE000'])
  })
  it('only extracts active promoted paired rows and preserves all other partition behavior', () => {
    const rows = [row('Zed', null), row('Alpha', null), row('pin'),
      { ...row('chat'), is_promoted: false }, { ...row('archive'), is_archived: true },
      row('unknown', '', 'gone'), { ...row('legacy'), pinned_at: undefined }]
    const result = partitionSidebar(rows, ['a'])
    expect(result.pinned.map(r => r.id)).toEqual(['pin'])
    expect(result.channels.map(r => r.id)).toEqual(['Alpha', 'legacy', 'unknown', 'Zed'])
    expect(result.discussions.map(r => r.id)).toEqual(['chat'])
    expect(partitionActive(rows).channels.map(r => r.id)).toContain('pin')
  })
})

const noop = () => {}
function markup(conversations: readonly ConversationSummary[], extra: Partial<ComponentProps<typeof ChannelListView>> = {}) {
  return renderToStaticMarkup(<ChannelListView conversations={conversations} serverIds={['a', 'b']}
    statuses={new Map<string, ConnectionStatus>([['a', { type: 'connected', ack: {} } as ConnectionStatus], ['b', { type: 'connecting' }]])}
    hostLabels={new Map([['a', '<Host>']])} openConversationId="same"
    onOpen={noop} onOpenSettings={noop} onOpenArchive={noop} onPairNewHost={noop}
    onCreateChat={noop} onCreateChannel={noop} onEditWorkspace={noop} onEditHost={noop}
    onAddWorkspace={noop} onSaveAsChannel={noop} onRename={noop} onEditChannel={noop} {...extra} />)
}

describe('pinned row markup', () => {
  it('renders one global section before hosts with escaped suffix, fallbacks, selection and connected-only pens', () => {
    const html = markup([row('same'), { ...row('same', '', 'b'), name: null }])
    expect(html.indexOf('>Pinned<')).toBeLessThan(html.indexOf('channel-list__host'))
    expect(html).toContain(' · &lt;Host&gt;')
    expect(html).toContain('Untitled')
    expect(html).toContain(' · Server')
    expect(html.match(/class="channel-list__row"/g)).toHaveLength(2)
    expect(html.match(/class="channel-list__rename"/g)).toHaveLength(1)
    expect(html.match(/aria-current="true"/g)).toHaveLength(2)
    expect(html).toContain('channel-list__pinned-rule')
    expect(html).not.toContain('data-host-down="true"')
  })
  it.each(['disconnected', 'error'] as const)('marks only pinned rows down for %s', type => {
    const html = markup([row('pin'), row('normal', null)], { statuses: new Map([['a',
      type === 'error' ? { type, error: { code: 'transport', message: 'Offline', retryable: true } } : { type }]]) })
    expect(html.match(/data-host-down="true"/g)).toHaveLength(1)
    expect(html).not.toContain('class="channel-list__rename"')
  })
  it('omits section and separator without eligible pins', () => {
    expect(markup([row('ordinary', null)])).not.toContain('channel-list__pinned')
  })
})
