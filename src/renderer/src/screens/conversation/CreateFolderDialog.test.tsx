import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NewFolderRoundTrip } from '../../store/newFolderStore'
import { CreateFolderDialogView, requestCreateWorkspaceFolder } from './CreateFolderDialog'

// The RenameConversationDialog test twin: server-render the pure view with injected props — no DOM
// harness, no store, no clicks (the `node` env fires none). The open / name-typing / created-outcome
// wiring lives in the CreateFolderDialog container and is untested reviewed glue (the ChannelInfoSheet
// posture). This file proves the dialog view (AC1/AC2/AC3/AC5) and the dispatch helper (AC3). The
// round-trip state is an injected prop, so all four union states are server-renderable.
const noop = (): void => {}

function renderView(name: string, roundTrip: NewFolderRoundTrip = { status: 'idle' }): string {
  return renderToStaticMarkup(
    <CreateFolderDialogView
      name={name}
      roundTrip={roundTrip}
      onNameChange={noop}
      onCancel={noop}
      onCreate={noop}
    />
  )
}

describe('CreateFolderDialogView', () => {
  it('renders an accessible modal dialog labelled by its title, titled "Create workspace" (AC1)', () => {
    const markup = renderView('')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="create-folder-title"')
    expect(markup).toContain('id="create-folder-title"')
    expect(markup).toContain('Create workspace')
  })

  it('renders the field label and a Cancel + Create action row (AC1)', () => {
    const markup = renderView('')
    expect(markup).toContain('What should this workspace be called?')
    expect(markup).toContain('create-folder__cancel')
    expect(markup).toContain('create-folder__create')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Create</button>')
  })

  it('renders the entered name as a controlled input value (AC1)', () => {
    expect(renderView('my-folder')).toContain('value="my-folder"')
  })

  it('disables Create when the name is empty (AC2)', () => {
    // Assert on the Create button specifically — its class marker followed by `disabled` before its `>`.
    expect(renderView('')).toMatch(/create-folder__create"[^>]*disabled/)
  })

  it('disables Create when the name is whitespace-only (AC2)', () => {
    expect(renderView('   ')).toMatch(/create-folder__create"[^>]*disabled/)
  })

  it('enables Create with a non-blank name at idle (AC2)', () => {
    expect(renderView('my-folder')).not.toMatch(/create-folder__create"[^>]*disabled/)
  })

  it('disables both Create and the input while in-flight (AC3)', () => {
    const markup = renderView('my-folder', { status: 'in-flight' })
    expect(markup).toMatch(/create-folder__create"[^>]*disabled/)
    expect(markup).toMatch(/create-folder__input"[^>]*disabled/)
  })

  it('surfaces a generic apostrophe-free failure line when rejected (AC5)', () => {
    const markup = renderView('my-folder', { status: 'rejected' })
    expect(markup).toContain('create-folder__error')
    expect(markup).toContain('Could not create that folder')
    // Apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27; (the standing desktop lesson),
    // and the reply carries no daemon error text (#396) — so no escaped apostrophe should appear.
    expect(markup).not.toContain('&#x27;')
  })

  it('renders no failure line for idle / in-flight / created (AC5)', () => {
    const nonRejected: NewFolderRoundTrip[] = [
      { status: 'idle' },
      { status: 'in-flight' },
      { status: 'created', path: '~/pyry-workspace/new' }
    ]
    for (const roundTrip of nonRejected) {
      expect(renderView('my-folder', roundTrip)).not.toContain('create-folder__error')
    }
  })

  it('renders the name as inert attribute text, never live markup (AC5)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })
})

describe('requestCreateWorkspaceFolder', () => {
  it('fires exactly one createWorkspaceFolder with parent verbatim and the name (AC3)', () => {
    const sendCommand = vi.fn()
    requestCreateWorkspaceFolder(sendCommand, '~/pyry-workspace', 'my folder')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'createWorkspaceFolder',
      payload: { parent: '~/pyry-workspace', name: 'my folder' }
    })
  })

  it('trims edge whitespace from the name before dispatching (AC3)', () => {
    const sendCommand = vi.fn()
    requestCreateWorkspaceFolder(sendCommand, '~/pyry-workspace', '  padded  ')
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'createWorkspaceFolder',
      payload: { parent: '~/pyry-workspace', name: 'padded' }
    })
  })
})
