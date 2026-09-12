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

function renderView(name: string): string {
  return renderToStaticMarkup(
    <EditWorkspaceDialogView
      name={name}
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
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeTruthy()
    expect(markup).toContain(`id="${titleId}"`)
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('>Edit workspace</h2>')
  })

  it('seeds the Name field with the row’s current label (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('>Workspace name (optional):</span>')
    expect(markup).toContain('value="Second Brain"')
    // Only the optional name appears; host and folder are held by the container.
    expect(markup.split('<input').length - 1).toBe(1)
    // NOT autofocused, unlike the Create-channel dialog: that field opens empty, this one opens
    // seeded, and stealing focus into a prefilled field invites an accidental overwrite.
    expect(markup).not.toContain('autofocus')
  })

  it('renders only the name field in shared modal content', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('modal__content')
    expect(markup).not.toContain('edit-workspace__path')
    expect(markup).toContain('aria-label="Close dialog"')
  })

  it('renders Cancel and OK actions (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('modal__action--cancel')
    expect(markup).toContain('modal__action--confirm')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it('enables OK when the trimmed name is blank', () => {
    expect(renderView('')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('   ')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables OK past 128 characters and enables it at exactly 128 (AC4)', () => {
    // The bound is measured on the TRIMMED name, which is what OK sends — so surrounding whitespace
    // can never push an otherwise-legal name over. `x`.repeat is a client-owned literal, not daemon text.
    expect(renderView(`  ${'x'.repeat(128)}  `)).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('x'.repeat(129))).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK on an ordinary name and never disables Cancel (AC4)', () => {
    const markup = renderView('Kitchen Ledger')
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(markup).not.toMatch(/modal__action--cancel"[^>]*disabled/)
  })

  it('renders a hostile label as inert attribute text, never live markup (AC4)', () => {
    // The assertion is about the DELIMITERS, not the payload's words: `onerror=boom` survives verbatim
    // inside the value and is inert there, because `<` and `>` are escaped so no tag is ever opened.
    const markup = renderView('Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img src=x')
  })

  it('counts astral characters as two UTF-16 code units', () => {
    expect(renderView('😀'.repeat(64))).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('😀'.repeat(65))).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

})

describe('requestRenameWorkspace', () => {
  it.each(['', '   ', ' second-brain '])('clears an optional name: %j', (name) => {
    expect(capture(send => requestRenameWorkspace(send, '/home/me/second-brain', name, 'host-b')))
      .toEqual([{ type: 'renameWorkspace', serverId: 'host-b',
        payload: { path: '/home/me/second-brain', label: null } }])
  })

  it('routes exactly one rename to the selected host without changing its path', () => {
    expect(capture(send => requestRenameWorkspace(send, '/fake/../workspace ', ' Ledger ', 'host-a')))
      .toEqual([{ type: 'renameWorkspace', serverId: 'host-a',
        payload: { path: '/fake/../workspace ', label: 'Ledger' } }])
  })

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
    // The way back to the folder name is OK itself. The comparison is against `workspaceLabelFor`'s
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
