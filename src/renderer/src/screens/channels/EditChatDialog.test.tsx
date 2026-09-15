import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary, ConversationCreatedPayload } from '@shared/wire/types'
import { EditChatDialogView, requestRenameConversation } from './EditChatDialog'

// The #218/#224 idiom (the SaveAsChannelDialog test twin): server-render the pure view with injected
// props — no DOM harness, no store, no clicks (the `node` env fires none). The open / name-typing /
// dispatch wiring lives in the ChannelList container and is proven by composition + the spy test below.
// AC1's present-on-channel / absent-on-discussion is in ChannelList.test.tsx; this file proves the dialog
// itself (AC2/AC3/AC5) and the dispatch helper (AC3/AC4).
const noop = (): void => {}

// #1440: `available` is threaded rather than always defaulted, because AC3 lives entirely in the gap
// between the two buttons' disabled expressions — OK reads `blank || !available`, Archive chat reads
// `!available` alone — and only a render that varies BOTH inputs can tell them apart.
function renderView(name: string, available?: boolean): string {
  return renderToStaticMarkup(
    <EditChatDialogView
      name={name}
      available={available}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
      onArchive={noop}
    />
  )
}

describe('EditChatDialogView', () => {
  it('renders an accessible modal dialog labelled by its title (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeTruthy()
    expect(markup).toContain(`id="${titleId}"`)
    expect(markup).toContain('class="modal"')
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('aria-label="Close dialog"')
    // #1440 — the header is the retitle, in SENTENCE case against the drawing's title case, matching
    // every sibling in this file (Edit host, Edit workspace, Create channel, Add workspace). The old
    // word is asserted GONE, not merely unmentioned: three e2e specs locate this dialog by its role
    // name, and a header that kept both words would let them pass while the retitle had not happened.
    expect(markup).toContain('Edit chat')
    expect(markup).not.toContain('Rename')
  })

  it('renders the Channel name field prefilled with the injected current name (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('Channel name:')
    expect(markup).toContain('value="kitchenclaw refactor"')
  })

  it('renders Cancel and OK actions (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).toContain('modal__action--cancel')
    expect(markup).toContain('modal__action--confirm')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it('disables OK when the name is empty (AC2)', () => {
    const markup = renderView('')
    // Assert on the OK button specifically — the class marker followed by `disabled` before its `>`.
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables OK when the name is whitespace-only (AC2)', () => {
    const markup = renderView('   ')
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK once a non-blank name is entered (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('renders the prefilled name as inert attribute text, never live markup (AC5)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })

  // #1440 — the Archive chat button, drawn as the content slot's own `Actions` frame (487:2320): left
  // of the field's own edge, below the input, above the centred footer. Its TEXT is its accessible
  // name and it carries no `aria-label`: naming the conversation in one would put daemon-authored text
  // into an attribute, which CLAUDE.md forbids outright (the `EditWorkspaceDialogView` rule verbatim).
  it('renders an Archive chat button in the content area, below the field (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('class="rename-conversation__actions"')
    expect(markup).toMatch(/class="rename-conversation__archive"[^>]*>Archive chat<\/button>/)
    // Ordering, read off the markup rather than asserted by eye: the field's label precedes the
    // actions row, which precedes the footer's Cancel. A button that drifted into the footer or above
    // the input would still contain all three substrings, so the INDICES are the assertion.
    expect(markup.indexOf('rename-conversation__label')).toBeLessThan(
      markup.indexOf('rename-conversation__actions')
    )
    expect(markup.indexOf('rename-conversation__actions')).toBeLessThan(
      markup.indexOf('modal__action--cancel')
    )
  })

  it('names the Archive chat button by its text alone, with no aria-label (AC1)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).not.toMatch(/class="rename-conversation__archive"[^>]*aria-label/)
  })

  // AC3, the whole of it: the two buttons read DIFFERENT halves of the same guard. A blank field is
  // the render that separates them — OK is disabled by `blank || !available`, Archive chat by
  // `!available` alone — so a regression that reused OK's expression reddens right here rather than in
  // an e2e drive. `available` is left defaulted, which is also the sidebar caller's shape.
  it('leaves Archive chat enabled while a blank name disables OK (AC3)', () => {
    const markup = renderView('')
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(markup).not.toMatch(/class="rename-conversation__archive"[^>]*disabled/)
  })

  it('leaves Archive chat enabled for an unchanged, non-blank name (AC3)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).not.toMatch(/class="rename-conversation__archive"[^>]*disabled/)
  })

  it('disables Archive chat alongside OK when the host is unavailable (AC3)', () => {
    const markup = renderView('kitchenclaw refactor', false)
    expect(markup).toMatch(/class="rename-conversation__archive"[^>]*disabled/)
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
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
    last_used_at: '2026-07-11T12:00:00Z',
    workspace_label: null
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
      last_used_at: '2026-07-12T00:00:00Z',
      workspace_label: null
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
