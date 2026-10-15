import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HostedPaneState } from '@shared/ipc/hostedPane'
import { HostedPane, hostedPaneStore } from './HostedPane'

const identity = { generation: 7, serverId: 'host', appId: 'app',
  hostLabel: '<img src=x> & "host"', appLabel: '<script>app</script> & "app"' }

function render(state: HostedPaneState): string {
  // Zustand's server-render snapshot reads getInitialState, rather than getState.
  vi.spyOn(hostedPaneStore, 'getInitialState').mockReturnValue({ state })
  return renderToStaticMarkup(<HostedPane />)
}

afterEach(() => vi.restoreAllMocks())

describe('HostedPane trusted chrome', () => {
  it.each([
    ['loading', 'Loading app…', false],
    ['ready', 'Connected', false],
    ['disconnected', 'Disconnected', true],
    ['unsupported', 'Hosted apps are unsupported', true],
    ['unavailable', 'App unavailable', true]
  ] as const)('retains escaped identity and controls while %s', (type, copy, recoverable) => {
    const html = render({ ...identity, type })
    expect(html).toContain('<span>&lt;img src=x&gt; &amp; &quot;host&quot;</span>')
    expect(html).toContain('<strong>&lt;script&gt;app&lt;/script&gt; &amp; &quot;app&quot;</strong>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain(`<span role="status">${copy}</span>`)
    expect(html).toContain('<button type="button">Close app</button>')
    expect(html.includes('<button type="button">Reopen app</button>')).toBe(recoverable)
    expect(html).toContain('</header><div class="hosted-pane__surface"></div>')
  })

  it('renders nothing after close', () => {
    expect(render({ type: 'closed', generation: 8 })).toBe('')
  })
})
