import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary, ConversationCreatedPayload } from '@shared/wire/types'
import { RenameConversationDialogView, requestRenameConversation } from './RenameConversationDialog'

// The #218/#224 idiom (the SaveAsChannelDialog test twin): server-render the pure view with injected
// props — no DOM harness, no store, no clicks (the `node` env fires none). The open / name-typing /
// dispatch wiring lives in the ChannelList container and is proven by composition + the spy test below.
// AC1's present-on-channel / absent-on-discussion is in ChannelList.test.tsx; this file proves the dialog
// itself (AC2/AC3/AC5) and the dispatch helper (AC3/AC4).
const noop = (): void => {}

function renderView(name: string): string {
  return renderToStaticMarkup(
    <RenameConversationDialogView name={name} onNameChange={noop} onCancel={noop} onSave={noop} />
  )
}

describe('RenameConversationDialogView', () => {
  it('renders an accessible modal dialog labelled by its title (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="rename-conversation-title"')
    expect(markup).toContain('id="rename-conversation-title"')
    expect(markup).toContain('Rename')
  })

  it('renders the Name field prefilled with the injected current name (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('Name')
    expect(markup).toContain('value="kitchenclaw refactor"')
  })

  it('renders Cancel and Save actions (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).toContain('rename-conversation__cancel')
    expect(markup).toContain('rename-conversation__save')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Save</button>')
  })

  it('disables Save when the name is empty (AC2)', () => {
    const markup = renderView('')
    // Assert on the Save button specifically — the class marker followed by `disabled` before its `>`.
    expect(markup).toMatch(/rename-conversation__save"[^>]*disabled/)
  })

  it('disables Save when the name is whitespace-only (AC2)', () => {
    const markup = renderView('   ')
    expect(markup).toMatch(/rename-conversation__save"[^>]*disabled/)
  })

  it('enables Save once a non-blank name is entered (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).not.toMatch(/rename-conversation__save"[^>]*disabled/)
  })

  it('renders the prefilled name as inert attribute text, never live markup (AC5)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })
})

describe('requestRenameConversation', () => {
  const row: ConversationSummary = {
    id: 'conv-42',
    name: 'kitchenclaw refactor',
    is_promoted: true,
    is_archived: false,
    cwd: '/home/pyry/scratch/conv-42',
    last_message_ts: '2026-07-11T12:00:00Z',
    last_used_at: '2026-07-11T12:00:00Z'
  }

  it('fires exactly one renameConversation command with the row id and name (AC3)', () => {
    const sendCommand = vi.fn()
    requestRenameConversation(sendCommand, row, 'New Name')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'renameConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'New Name'
      }
    })
  })

  it('dispatches a payload with no cwd key — rename is a non-reuse of promote (AC3)', () => {
    const sendCommand = vi.fn()
    requestRenameConversation(sendCommand, row, 'New Name')
    const command = sendCommand.mock.calls[0][0]
    expect(command.payload).not.toHaveProperty('cwd')
  })

  it('trims edge whitespace from the name before dispatching (AC3)', () => {
    const sendCommand = vi.fn()
    requestRenameConversation(sendCommand, row, '  Padded Name  ')
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'renameConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'Padded Name'
      }
    })
  })

  // #368: the Channel Info sheet passes its active conversation — a 5-field ConversationCreatedPayload
  // (no is_archived / last_message_ts), not a ConversationSummary — straight into this helper. The
  // widened `Pick<ConversationSummary, 'id'>` param accepts it with no adapter, since the helper reads
  // only `.id`. A ConversationSummary still satisfies the narrowed param, so the tests above stay valid.
  it('accepts a ConversationCreatedPayload-shaped arg — the widened id-only param (#368, AC3)', () => {
    const created: ConversationCreatedPayload = {
      id: 'conv-99',
      is_promoted: false,
      cwd: '/home/pyry/scratch/conv-99',
      name: null,
      last_used_at: '2026-07-12T00:00:00Z'
    }
    const sendCommand = vi.fn()
    requestRenameConversation(sendCommand, created, '  Renamed  ')
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'renameConversation',
      payload: {
        conversation_id: 'conv-99',
        name: 'Renamed'
      }
    })
  })
})
