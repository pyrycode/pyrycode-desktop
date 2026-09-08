import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RendererCommand } from '@shared/ipc/commands'
import { EditWorkspaceDialogView, requestRenameWorkspace } from './EditWorkspaceDialog'

// The CreateChannelDialog test twin (#1179's idiom, itself #360's): server-render the pure view with
// injected props — no DOM harness, no store, no clicks (the `node` env fires none). Which rows draw the
// pen that opens this dialog is `ChannelList.test.tsx`'s; the click, the hover, the drawn box and the
// round trip are `e2e/sidebar-workspace-edit.spec.ts`'s. This file proves the dialog's own markup and
// the send helper's payload (AC4/AC5).
const noop = (): void => {}

function renderView(name: string, path = '/home/me/second-brain'): string {
  return renderToStaticMarkup(
    <EditWorkspaceDialogView
      name={name}
      path={path}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

/** Collect the commands a call hands to `sendCommand`, so a helper's whole output is assertable. */
function capture(run: (send: (command: RendererCommand) => void) => void): RendererCommand[] {
  const sent: RendererCommand[] = []
  run((command) => sent.push(command))
  return sent
}

describe('EditWorkspaceDialogView', () => {
  it('renders an accessible modal dialog titled Edit workspace (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="edit-workspace-title"')
    expect(markup).toContain('id="edit-workspace-title"')
    expect(markup).toContain('>Edit workspace</h2>')
  })

  it('seeds the Name field with the row’s current label (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('>Name</span>')
    expect(markup).toContain('value="Second Brain"')
    // Exactly one field. The path line is read-only prose, not a second input a user could edit into
    // a rename of the wrong thing.
    expect(markup.split('<input').length - 1).toBe(1)
    // NOT autofocused, unlike the Create-channel dialog: that field opens empty, this one opens
    // seeded, and stealing focus into a prefilled field invites an accidental overwrite.
    expect(markup).not.toContain('autofocus')
  })

  it('renders the workspace’s full cwd on one line under the field (AC4)', () => {
    const markup = renderView('Second Brain', '/home/me/notes/second-brain')
    expect(markup).toContain(
      '<p class="edit-workspace__path">/home/me/notes/second-brain</p>'
    )
    // Under the field, not above it — the field is the thing being edited and leads.
    expect(markup.indexOf('edit-workspace__field')).toBeLessThan(
      markup.indexOf('edit-workspace__path')
    )
  })

  it('renders Cancel and Save actions (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('edit-workspace__cancel')
    expect(markup).toContain('edit-workspace__save')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Save</button>')
  })

  it('disables Save when the trimmed name is blank (AC4)', () => {
    expect(renderView('')).toMatch(/edit-workspace__save"[^>]*disabled/)
    expect(renderView('   ')).toMatch(/edit-workspace__save"[^>]*disabled/)
  })

  it('disables Save past 128 characters and enables it at exactly 128 (AC4)', () => {
    // The bound is measured on the TRIMMED name, which is what Save sends — so surrounding whitespace
    // can never push an otherwise-legal name over. `x`.repeat is a client-owned literal, not daemon text.
    expect(renderView(`  ${'x'.repeat(128)}  `)).not.toMatch(/edit-workspace__save"[^>]*disabled/)
    expect(renderView('x'.repeat(129))).toMatch(/edit-workspace__save"[^>]*disabled/)
  })

  it('enables Save on an ordinary name and never disables Cancel (AC4)', () => {
    const markup = renderView('Kitchen Ledger')
    expect(markup).not.toMatch(/edit-workspace__save"[^>]*disabled/)
    expect(markup).not.toMatch(/edit-workspace__cancel"[^>]*disabled/)
  })

  it('renders a hostile label as inert attribute text, never live markup (AC4)', () => {
    // The assertion is about the DELIMITERS, not the payload's words: `onerror=boom` survives verbatim
    // inside the value and is inert there, because `<` and `>` are escaped so no tag is ever opened.
    const markup = renderView('Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img')
  })

  it('renders a hostile cwd as an escaped CHILD and lets it reach no attribute (AC4)', () => {
    const markup = renderView('Second Brain', '/home/me/<img src=x onerror=boom>')
    expect(markup).toContain('&lt;img src=x onerror=boom&gt;</p>')
    expect(markup).not.toContain('<img')
    // The whole of "neither the cwd nor the label reaches an attribute": no title anywhere, and no
    // aria-label built from either value — the dialog is named by its title element alone.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label=')
  })
})

describe('requestRenameWorkspace', () => {
  it('sends exactly one renameWorkspace carrying the cwd and the trimmed name (AC5)', () => {
    const sent = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', '  Kitchen Ledger  ')
    )
    expect(sent).toEqual([
      {
        type: 'renameWorkspace',
        payload: { path: '/home/me/second-brain', label: 'Kitchen Ledger' }
      }
    ])
  })

  it('sends label: null when the trimmed name is the FOLDER segment, not the current label (AC5)', () => {
    // The way back to the folder name is Save itself. The comparison is against `workspaceLabelFor`'s
    // segment — the daemon may be holding a quite different label at the time, and that is irrelevant.
    const sent = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', ' second-brain ')
    )
    expect(sent).toEqual([
      { type: 'renameWorkspace', payload: { path: '/home/me/second-brain', label: null } }
    ])
  })

  it('names the label key unconditionally, so null is a value and never an absence (AC5)', () => {
    const [command] = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', 'second-brain')
    )
    // Narrowed on the discriminant rather than cast: `RendererCommand` has payload-free members, so a
    // cast here would be a real bypass of the one gate that typechecks this file.
    if (command.type !== 'renameWorkspace') throw new Error(`sent ${command.type}`)
    // An ABSENT key is a contract violation the daemon rejects as malformed; a literal `null` is the
    // value "clear this workspace's label". `toEqual` above is blind to the difference — this is not.
    expect(Object.keys(command.payload).sort()).toEqual(['label', 'path'])
  })

  it('passes a traversal-shaped cwd through VERBATIM rather than sanitising it', () => {
    // The daemon looks the path up by byte-for-byte equality against a stored `cwd`, never by a join,
    // so a `../` value is answered `workspace.not_found` rather than traversing anything. Normalising
    // it here would make this client disagree with the daemon about which workspace was named.
    const hostile = '/home/me/../../etc'
    const sent = capture((send) => requestRenameWorkspace(send, hostile, 'Ledger'))
    expect(sent).toEqual([
      { type: 'renameWorkspace', payload: { path: hostile, label: 'Ledger' } }
    ])
  })

  it('still sends the trimmed name when the cwd has no usable segment', () => {
    // `workspaceLabelFor('')` is null, which a non-blank trimmed name can never equal — so the
    // folder-segment branch needs no special case for the unknown-workspace shape.
    const sent = capture((send) => requestRenameWorkspace(send, '', 'Ledger'))
    expect(sent).toEqual([{ type: 'renameWorkspace', payload: { path: '', label: 'Ledger' } }])
  })
})
