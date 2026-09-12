import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddWorkspaceDialogView, type AddWorkspaceStatus } from './AddWorkspaceDialog'

const noop = (): void => {}
function renderView(path: string, workspaceRoot?: string, status: AddWorkspaceStatus = 'idle', connected = true): string {
  return renderToStaticMarkup(<AddWorkspaceDialogView path={path} workspaceRoot={workspaceRoot}
    hostLabel="Test host" status={status} connected={connected}
    onPathChange={noop} onCancel={noop} onStart={noop} />)
}
const startDisabled = /modal__action--confirm"[^>]*disabled/
const inputDisabled = /add-workspace__input"[^>]*disabled/
const cancelDisabled = /modal__action--cancel"[^>]*disabled/
const preview = (markup: string): string => markup.match(/<output[^>]*>(.*?)<\/output>/)?.[1] ?? 'missing'

describe('AddWorkspaceDialogView', () => {
  it('opens a shared modal with a host label, one empty focused input and empty preview', () => {
    const markup = renderView('')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('modal__header')
    expect(markup).toContain('>Add workspace</h2>')
    expect(markup).toContain('aria-label="Close dialog"')
    expect(markup).toContain('Test host')
    expect(markup).toContain('Workspace folder on the host (relative or absolute path):')
    expect(markup).toMatch(/add-workspace__input"[^>]*autofocus=""/)
    expect(markup.split('<input').length - 1).toBe(1)
    expect(markup).toContain('value=""')
    expect(preview(markup)).toBe('')
    expect(markup).toMatch(startDisabled)
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it.each([
    ['my-project', '/home/pyry/pyry-workspace', '/home/pyry/pyry-workspace/my-project'],
    ['  my-project  ', '/base/', '/base/my-project'],
    ['my-project', '/', '/my-project'],
    ['my-project', '/base///', '/base/my-project'],
    [' ../a//b ', '/base', '/base/../a//b'],
    ['~/project', '/base', '/base/~/project'],
    [' /home/pyry/projects/existing ', '/base', '/home/pyry/projects/existing'],
    ['/absolute//path/', undefined, '/absolute//path/'],
    ['/absolute', 'relative-base', '/absolute'],
    ['child', '/base with spaces ', '/base with spaces /child']
  ])('previews %s against %s without local canonicalisation', (path, root, expected) => {
    const markup = renderView(path, root)
    expect(preview(markup)).toBe(expected)
    expect(markup).not.toMatch(startDisabled)
  })

  it.each([undefined, '', 'relative', ' /absolute'])('blocks relative input without usable base %s', (base) => {
    const markup = renderView('project', base)
    expect(preview(markup)).toBe('')
    expect(markup).toMatch(startDisabled)
    expect(markup).toContain('Host workspace location is unavailable')
    expect(renderView('/absolute', base)).not.toMatch(startDisabled)
  })

  it.each(['', '   '])('keeps blank input empty without unavailable-location feedback', (path) => {
    const markup = renderView(path)
    expect(preview(markup)).toBe('')
    expect(markup).toMatch(startDisabled)
    expect(markup).not.toContain('Host workspace location is unavailable')
  })

  it.each([
    ['idle', false, 'Connect this host before starting a chat'],
    ['disconnected', true, 'Connect this host before starting a chat'],
    ['rejected', true, 'Could not start a chat in that folder'],
    ['timed-out', true, 'Could not confirm completion within 30 seconds. The chat may still appear.']
  ] as const)('retains %s feedback and always permits cancellation', (status, connected, copy) => {
    const markup = renderView('/absolute', undefined, status, connected)
    expect(markup).toContain(copy)
    expect(markup).not.toMatch(inputDisabled)
    expect(markup).not.toMatch(cancelDisabled)
    if (connected) expect(markup).not.toMatch(startDisabled)
    else expect(markup).toMatch(startDisabled)
  })

  it('freezes editing and confirmation while pending but keeps both dismissal controls enabled', () => {
    const markup = renderView('project', '/base', 'creating')
    expect(markup).toMatch(inputDisabled)
    expect(markup).toMatch(startDisabled)
    expect(markup).not.toMatch(cancelDisabled)
    expect(markup).not.toMatch(/modal__close"[^>]*disabled/)
    expect(markup).not.toContain('role="alert"')
  })

  it('keeps unavailable-location guidance visible when editing after a failed attempt', () => {
    const markup = renderView('relative', undefined, 'rejected')
    expect(markup).toContain('Host workspace location is unavailable')
    expect(markup).toContain('Could not start a chat in that folder')
    expect(markup).toMatch(startDisabled)
  })

  it('escapes the input and host-provided preview without content-derived attributes', () => {
    const markup = renderView('Tom & <script>boom</script>', '/host/<b>')
    expect(preview(markup)).toBe('/host/&lt;b&gt;/Tom &amp; &lt;script&gt;boom&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('title=')
    expect(markup).not.toMatch(/aria-label="[^"]*(Tom|host\/)/)
  })
})
