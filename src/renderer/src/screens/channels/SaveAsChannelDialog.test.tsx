import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary } from '@shared/wire/types'
import { SaveAsChannelDialogView, requestPromoteConversation } from './SaveAsChannelDialog'

// The #218/#224 idiom: server-render the pure view with injected props — no DOM harness, no store, no
// clicks (the `node` env fires none). The name-typing / open / dispatch wiring lives in the ChannelList
// container and is proven by composition + the spy test below (the PermissionModal posture). AC1's
// present-on-discussion / absent-on-channel is in ChannelList.test.tsx; this file proves the dialog
// itself (AC2/AC3) and the dispatch helper (AC4).
const noop = (): void => {}

function renderView(name: string): string {
  return renderToStaticMarkup(
    <SaveAsChannelDialogView name={name} onNameChange={noop} onCancel={noop} onSave={noop} />
  )
}

describe('SaveAsChannelDialogView', () => {
  it('renders an accessible modal dialog labelled by its title (AC2)', () => {
    const markup = renderView('My channel')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="save-as-channel-title"')
    expect(markup).toContain('id="save-as-channel-title"')
    expect(markup).toContain('Save as channel')
  })

  it('renders the Name field prefilled with the injected suggested name (AC2)', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).toContain('Name')
    expect(markup).toContain('value="Investment Strategy Review"')
  })

  it('renders Cancel and Save actions (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).toContain('save-as-channel__cancel')
    expect(markup).toContain('save-as-channel__save')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Save</button>')
  })

  it('disables Save when the name is empty (AC3)', () => {
    const markup = renderView('')
    // Assert on the Save button specifically — the class marker followed by `disabled` before its `>`.
    expect(markup).toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('disables Save when the name is whitespace-only (AC3)', () => {
    const markup = renderView('   ')
    expect(markup).toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('enables Save once a non-blank name is entered (AC3)', () => {
    const markup = renderView('a name')
    expect(markup).not.toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('renders the prefilled name as inert attribute text, never live markup (AC2)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })
})

describe('requestPromoteConversation', () => {
  const row: ConversationSummary = {
    id: 'conv-42',
    name: 'Investment Strategy Review',
    is_promoted: false,
    is_archived: false,
    cwd: '/home/pyry/scratch/conv-42',
    last_message_ts: '2026-07-11T12:00:00Z',
    last_used_at: '2026-07-11T12:00:00Z'
  }

  it('fires exactly one promoteConversation command with the row id, name, and the row cwd (AC4)', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, row, 'My Channel')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'promoteConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'My Channel',
        cwd: '/home/pyry/scratch/conv-42'
      }
    })
  })

  it('trims edge whitespace from the name before dispatching (AC4)', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, row, '  Padded Name  ')
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'promoteConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'Padded Name',
        cwd: '/home/pyry/scratch/conv-42'
      }
    })
  })
})
