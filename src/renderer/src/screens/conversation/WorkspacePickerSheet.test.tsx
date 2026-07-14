import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspacePickerSheetView, requestChangeWorkspace } from './WorkspacePickerSheet'
import type { RecentWorkspace } from '@shared/wire/types'
import type { RendererCommand } from '@shared/ipc/commands'

// #383: the Workspace Picker sheet. WorkspacePickerSheetView is the pure, exported view (the
// ChannelInfoSheetView / WorkspaceChip pattern) — server-render it with injected props (no store) to
// prove the chrome, the populated / not-loaded / loaded-empty Recent branch, the current-workspace
// "default" mark, the choose + create-folder gating, and the untrusted-string escaping. `now` is
// injected so the "Last used …" relative time is deterministic. The interaction container
// (RecentWorkspacesData mount, the Escape effect, the window.pyry dispatch) is untested reviewed glue —
// exactly like the ChannelInfoSheet container — since the `node` env fires no clicks and runs no effects.
const noop = (): void => {}

function workspace(overrides: Partial<RecentWorkspace> = {}): RecentWorkspace {
  return { path: '~/Workspace/Projects/pyrycode', last_used_at: '2026-07-12T00:00:00Z', ...overrides }
}

// Isolate a single button's opening tag (up to its first `>`) so `disabled` presence is assertable —
// the WorkspaceChip test idiom. `class="…"` closing-quote keeps `__row` from matching `__row-icon`.
function rowTag(markup: string): string {
  return markup.match(/<button[^>]*class="workspace-picker__row"[^>]*>/)?.[0] ?? ''
}
function otherTag(markup: string): string {
  return markup.match(/<button[^>]*class="workspace-picker__other"[^>]*>/)?.[0] ?? ''
}

describe('WorkspacePickerSheetView — the Workspace Picker sheet (#383)', () => {
  it('renders the bottom-sheet dialog chrome — handle, labelled dialog, title, close control (AC5)', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView workspaces={[]} activeCwd={null} now={0} onClose={noop} />
    )
    // The status-sheet chrome, reused verbatim: a modal dialog labelled by its own (distinct) title id,
    // the drag handle, the static "Choose workspace" title, and the icon-only close control.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="workspace-picker-sheet-title"')
    expect(markup).toContain('id="workspace-picker-sheet-title"')
    expect(markup).toContain('status-sheet__handle')
    expect(markup).toContain('Choose workspace')
    expect(markup).toContain('aria-label="Close"')
  })

  it('renders each recent workspace path with a deterministic "Last used …" meta (AC1)', () => {
    // now = a row's last_used_at + 2h → formatLastActivity yields the deterministic "2h ago" bucket.
    const now = Date.parse('2026-07-12T00:00:00Z') + 2 * 60 * 60 * 1000
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[workspace({ path: '~/alpha' }), workspace({ path: '~/beta' })]}
        activeCwd={null}
        now={now}
        onClose={noop}
      />
    )
    expect(markup).toContain('~/alpha')
    expect(markup).toContain('~/beta')
    expect(markup).toContain('Last used 2h ago')
  })

  it('marks exactly the current-workspace row with the "default" pill (AC2)', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[workspace({ path: '~/alpha' }), workspace({ path: '~/beta' })]}
        activeCwd={'~/alpha'}
        now={0}
        onClose={noop}
      />
    )
    // Exactly one pill, on the matching row — proven by count and by position (~/alpha's pill sits
    // between ~/alpha and ~/beta in document order).
    expect(markup.match(/workspace-picker__default-pill/g)?.length ?? 0).toBe(1)
    expect(markup.indexOf('~/alpha')).toBeLessThan(markup.indexOf('default'))
    expect(markup.indexOf('default')).toBeLessThan(markup.indexOf('~/beta'))
  })

  it('marks no row when there is no active conversation (AC2)', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[workspace({ path: '~/alpha' })]}
        activeCwd={null}
        now={0}
        onClose={noop}
      />
    )
    expect(markup).not.toContain('workspace-picker__default-pill')
  })

  it('distinguishes not-loaded (null) from loaded-empty ([]) and neither crashes (AC1)', () => {
    // null: the Recent header alone — no rows, no empty copy (the one-shot request is in flight).
    const nullMarkup = renderToStaticMarkup(
      <WorkspacePickerSheetView workspaces={null} activeCwd={null} now={0} onClose={noop} />
    )
    expect(nullMarkup).toContain('Recent')
    expect(nullMarkup).not.toContain('workspace-picker__row')
    expect(nullMarkup).not.toContain('workspace-picker__empty')
    // []: the header plus the muted empty line — structurally distinct from the null case.
    const emptyMarkup = renderToStaticMarkup(
      <WorkspacePickerSheetView workspaces={[]} activeCwd={null} now={0} onClose={noop} />
    )
    expect(emptyMarkup).toContain('Recent')
    expect(emptyMarkup).toContain('workspace-picker__empty')
    expect(emptyMarkup).not.toBe(nullMarkup)
  })

  it('gates the recent-workspace rows on onChoose — inert without an active conversation (AC3)', () => {
    // omitted onChoose ⇒ the row button renders disabled…
    const disabledMarkup = renderToStaticMarkup(
      <WorkspacePickerSheetView workspaces={[workspace()]} activeCwd={null} now={0} onClose={noop} />
    )
    expect(rowTag(disabledMarkup)).toContain('disabled')
    // …supplied onChoose ⇒ it does not. (The dispatch itself is proven by the helper test below.)
    const enabledMarkup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[workspace()]}
        activeCwd={null}
        now={0}
        onClose={noop}
        onChoose={noop}
      />
    )
    expect(rowTag(enabledMarkup)).not.toContain('disabled')
  })

  it('keeps the generic create-folder label, disabled, when there is no active conversation (AC1)', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView workspaces={[]} activeCwd={null} now={0} onClose={noop} />
    )
    // No active conversation ⇒ the generic label and a disabled entry (onCreateFolder omitted).
    expect(markup).toContain('Create new folder')
    expect(markup).not.toContain('Create new folder under')
    expect(otherTag(markup)).toContain('disabled')
  })

  it('names the current workspace and enables the create entry for an active conversation (AC1)', () => {
    // #398: with onCreateFolder supplied and an activeCwd, the entry enables and its label names the
    // workspace it will create under (the two track "active conversation" together in the container).
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[]}
        activeCwd={'~/alpha'}
        now={0}
        onClose={noop}
        onCreateFolder={noop}
      />
    )
    expect(markup).toContain('Create new folder under ~/alpha')
    expect(otherTag(markup)).not.toContain('disabled')
  })

  it('renders an HTML-ish path escaped, never as live markup (AC5)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const markup = renderToStaticMarkup(
      <WorkspacePickerSheetView
        workspaces={[workspace({ path: '<b>x</b>' })]}
        activeCwd={null}
        now={0}
        onClose={noop}
      />
    )
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })
})

describe('requestChangeWorkspace — the change-workspace dispatch helper (#383)', () => {
  it('dispatches changeWorkspace with the row path mapped into the cwd wire field (AC3)', () => {
    const sent: RendererCommand[] = []
    const sendCommand = (command: RendererCommand): void => {
      sent.push(command)
    }
    requestChangeWorkspace(sendCommand, 'c1', '~/Workspace/Projects/pyrycode')
    // The chosen row's path lands in the `cwd` key (not `path`) — the #379 wire-field contract.
    expect(sent).toEqual([
      {
        type: 'changeWorkspace',
        payload: { conversation_id: 'c1', cwd: '~/Workspace/Projects/pyrycode' }
      }
    ])
  })
})
