import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { automaticRecoveryTarget, PairedShellView } from './PairedShell'
import { HostRow } from './screens/channels/ChannelList'
import { daemonLeg } from './screens/conversation/ConversationScreen'
import type { ConnectionStatus } from './store/sessionStore'

const rejected: ConnectionStatus = {
  type: 'error', error: { code: 'pairing-rejected', message: 'unused', retryable: false }
}
const offline: ConnectionStatus = { type: 'disconnected' }
const connected: ConnectionStatus = {
  type: 'connected', ack: { protocol_version: 'v2', server_id: 'a', conn_id: 'c', capabilities: [] }
}
const servers = [{ serverId: 'a' }, { serverId: 'b' }]
const noop = (): void => {}
afterEach(() => vi.unstubAllGlobals())

describe('automatic recovery decision', () => {
  it('waits for every saved host, ignores departed hosts and respects saved order', () => {
    const statuses = new Map<string, ConnectionStatus>([['a', rejected]])
    expect(automaticRecoveryTarget(servers, statuses)).toBeNull()
    statuses.set('b', { type: 'connecting' })
    expect(automaticRecoveryTarget(servers, statuses)).toBeNull()
    statuses.set('b', rejected)
    statuses.set('departed', connected)
    expect(automaticRecoveryTarget(servers, statuses)).toBe('a')
    expect(automaticRecoveryTarget([...servers].reverse(), statuses)).toBe('b')
    statuses.set('b', connected)
    expect(automaticRecoveryTarget(servers, statuses)).toBeNull()
    statuses.set('b', offline)
    expect(automaticRecoveryTarget(servers, statuses)).toBe('a')
    statuses.set('a', offline)
    expect(automaticRecoveryTarget(servers, statuses)).toBeNull()
  })

  it('distinguishes rejection, connecting and ordinary offline status', () => {
    expect(daemonLeg(rejected).label).toBe('Pyrycode Pairing rejected')
    expect(daemonLeg(offline).label).toBe('Pyrycode Offline')
    expect(daemonLeg({ type: 'connecting' }).label).toBe('Pyrycode Connecting')
  })

  it('renders a named repair button and failed host treatment', () => {
    const markup = renderToStaticMarkup(<HostRow label="Host" serverId="a" failed onRepair={noop} />)
    expect(markup).toContain('channel-list__host--failed')
    expect(markup).toContain('aria-label="Repair host"')
    expect(markup).toContain('type="button"')
  })

  it('renders recovery beside the sidebar without a selected conversation', () => {
    vi.stubGlobal('window', { pyry: {} })
    const markup = renderToStaticMarkup(<PairedShellView route="pairServer" paneKey={null}
      recoveryServerId="a" recoveryRejected
      onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop}
      onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop}
    />)
    expect(markup).toContain('paired-shell__sidebar')
    expect(markup).toContain('aria-label="Pairing code"')
    expect(markup).toContain('Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.')
    expect(markup).not.toContain('aria-label="Send"')
  })
})
