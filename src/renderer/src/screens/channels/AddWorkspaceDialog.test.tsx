import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddWorkspaceDialogView, type AddWorkspaceStatus } from './AddWorkspaceDialog'

// The CreateChannelDialog / EditHostDialog test twin (#360's idiom): server-render the pure view with
// injected props — no DOM harness, no store, no clicks (the `node` env fires none). Which rows draw the
// plus that opens this dialog is `ChannelList.test.tsx`'s (AC1); the click, the focus and the round trip
// are `e2e/sidebar-add-workspace.spec.ts`'s. This file proves the dialog's own markup and the whole of
// its three-arm status matrix (AC1–AC3).
const noop = (): void => {}

function renderView(path: string, status: AddWorkspaceStatus = 'idle', connected = true): string {
  return renderToStaticMarkup(
    <AddWorkspaceDialogView
      path={path}
      connected={connected}
      status={status}
      onPathChange={noop}
      onCancel={noop}
      onStart={noop}
    />
  )
}

const startDisabled = /add-workspace__start"[^>]*disabled/
const inputDisabled = /add-workspace__input"[^>]*disabled/
const cancelDisabled = /add-workspace__cancel"[^>]*disabled/

describe('AddWorkspaceDialogView', () => {
  it('disables submission for an unavailable selected host and preserves an editable field', () => {
    const markup = renderView('/home/pyry/project', 'idle', false)
    expect(markup).toMatch(startDisabled)
    expect(markup).not.toMatch(inputDisabled)
    expect(markup).not.toMatch(cancelDisabled)
    expect(markup).toContain('Connect this host before starting a chat')
  })

  it('reports an uncertain timeout and allows an explicit retry while connected', () => {
    const markup = renderView('/home/pyry/project', 'timed-out')
    expect(markup).toContain('Could not confirm completion within 30 seconds. The chat may still appear.')
    expect(markup).not.toMatch(startDisabled)
    expect(markup).not.toMatch(inputDisabled)
    expect(markup).not.toMatch(cancelDisabled)
  })

  it('renders an accessible modal dialog titled Add workspace (AC1)', () => {
    const markup = renderView('')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="add-workspace-title"')
    expect(markup).toContain('id="add-workspace-title"')
    expect(markup).toContain('>Add workspace</h2>')
  })

  it('renders one path field, empty and focused on open (AC1)', () => {
    const markup = renderView('')
    expect(markup).toContain('>Folder path on the host</span>')
    // `autofocus=""` is what React's server renderer emits for `autoFocus`, and React DOM focuses the
    // element on mount — so this one attribute IS the "focused" half of AC1, assertable here rather
    // than only in a running window.
    expect(markup).toMatch(/add-workspace__input"[^>]*autofocus=""/)
    expect(markup).toContain('value=""')
    // Exactly one field: the machine is fixed by the host row whose plus was clicked, so there is no
    // host choice to make here.
    expect(markup.split('<input').length - 1).toBe(1)
  })

  it('renders Cancel and Start chat actions (AC1)', () => {
    const markup = renderView('/home/pyry/project')
    expect(markup).toContain('add-workspace__cancel')
    expect(markup).toContain('add-workspace__start')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Start chat</button>')
  })

  it('disables Start chat while the trimmed path is blank (AC2)', () => {
    expect(renderView('')).toMatch(startDisabled)
    expect(renderView('   ')).toMatch(startDisabled)
  })

  it('disables Start chat while the trimmed path is relative (AC2)', () => {
    // The one client rule: an absolute path keeps the sidebar's group keys canonical, since `~/foo` and
    // `/home/x/foo` would be two groups. Everything else about the folder is the daemon's to police.
    expect(renderView('project')).toMatch(startDisabled)
    expect(renderView('~/project')).toMatch(startDisabled)
    expect(renderView('./project')).toMatch(startDisabled)
  })

  it('enables Start chat on an absolute path, edge whitespace included (AC2)', () => {
    expect(renderView('/home/pyry/project')).not.toMatch(startDisabled)
    // The refusal is measured on the TRIMMED path, which is also what the dispatch sends, so surrounding
    // whitespace can never make an otherwise-legal path unreachable.
    expect(renderView('  /home/pyry/project  ')).not.toMatch(startDisabled)
  })

  it('freezes the field and the action while the create is in flight (AC2)', () => {
    const markup = renderView('/home/pyry/project', 'creating')
    expect(markup).toMatch(inputDisabled)
    expect(markup).toMatch(startDisabled)
  })

  it('renders no error line until a rejection arrives (AC2)', () => {
    expect(renderView('/home/pyry/project')).not.toContain('add-workspace__error')
    expect(renderView('/home/pyry/project', 'creating')).not.toContain('add-workspace__error')
  })

  it('renders the client-owned failure line once and re-enables the action on a rejection (AC3)', () => {
    const markup = renderView('/home/pyry/project', 'rejected')
    expect(markup.split('Could not start a chat in that folder').length - 1).toBe(1)
    expect(markup).toContain('add-workspace__error')
    expect(markup).not.toMatch(startDisabled)
    expect(markup).not.toMatch(inputDisabled)
  })

  it('never disables Cancel, in any status — it is the exit while a create hangs (AC1)', () => {
    for (const status of ['idle', 'creating', 'rejected'] as const) {
      expect(renderView('/home/pyry/project', status)).not.toMatch(cancelDisabled)
    }
  })

  it('renders the typed path as inert attribute text, never live markup (AC3)', () => {
    // The path is operator free text bound for the wire; it reaches exactly ONE sink, the controlled
    // input's auto-escaped value. The assertion is about the DELIMITERS and not about the payload's
    // words: `onerror=boom` survives verbatim inside the value and is inert there — what makes it inert
    // is that `<` and `>` are escaped, so no tag is ever opened. Asserting the absence of the words
    // instead would be a detector for the wrong thing and would pass on a sink that interpolated the
    // value into, say, a `title` attribute.
    const markup = renderView('/tmp/Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="/tmp/Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img')
  })

  it('lets the typed path reach no title and no aria-label anywhere (AC3)', () => {
    // `HostRow`'s four declines, re-derived here: no `title`, no `aria-label` built from the text, no
    // id / key / lookup path, no log line. The first two are attribute reads; the third is pinned by the
    // fixed `add-workspace-title` id above, which is a constant and not derived from anything.
    for (const status of ['idle', 'creating', 'rejected'] as const) {
      const markup = renderView('/home/pyry/project', status)
      expect(markup).not.toContain('title=')
      expect(markup).not.toContain('aria-label=')
    }
  })
})
