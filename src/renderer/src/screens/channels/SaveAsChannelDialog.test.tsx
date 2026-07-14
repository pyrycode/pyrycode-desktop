import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NewFolderRoundTrip } from '../../store/newFolderStore'
import {
  SaveAsChannelDialogView,
  requestPromoteConversation,
  requestCreateChannelFolder,
  slugForChannel
} from './SaveAsChannelDialog'

// The #218/#398 idiom: server-render the pure view with injected props — no DOM harness, no store, no
// clicks (the `node` env fires none). The open / name-typing / location / created-outcome wiring lives
// in the SaveAsChannelDialog container and is untested reviewed glue (the CreateFolderDialog posture).
// This file proves the dialog view (AC1/AC2/AC5), the pure slug (the daemon single-clean-element
// invariant), and the two dispatch helpers (AC3/AC4). The round-trip + location are injected props, so
// every state is server-renderable without a store.
const noop = (): void => {}

function renderView(
  name: string,
  location: 'dedicated' | 'scratch' = 'dedicated',
  roundTrip: NewFolderRoundTrip = { status: 'idle' }
): string {
  return renderToStaticMarkup(
    <SaveAsChannelDialogView
      name={name}
      location={location}
      roundTrip={roundTrip}
      onNameChange={noop}
      onLocationChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

// Capture a single `<input>` tag by its `value` attribute, so `checked` / `disabled` membership can be
// asserted regardless of the server-renderer's attribute order (the whole tag runs `<input` → first `>`,
// and attribute values never contain `>`).
function inputByValue(markup: string, value: string): string {
  const match = markup.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))
  return match ? match[0] : ''
}

describe('SaveAsChannelDialogView', () => {
  it('renders an accessible modal dialog labelled by its title (AC1)', () => {
    const markup = renderView('My channel')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="save-as-channel-title"')
    expect(markup).toContain('id="save-as-channel-title"')
    expect(markup).toContain('Save as channel')
  })

  it('renders the Name field prefilled with the injected name (AC1)', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).toContain('Name')
    expect(markup).toContain('value="Investment Strategy Review"')
  })

  it('renders both location options with exactly the dedicated radio checked by default (AC1)', () => {
    const markup = renderView('x', 'dedicated')
    expect(markup).toContain('Move to dedicated channel folder')
    expect(markup).toContain('Keep in scratch')
    const dedicatedChecked = inputByValue(markup, 'dedicated').includes('checked')
    const scratchChecked = inputByValue(markup, 'scratch').includes('checked')
    expect(dedicatedChecked).toBe(true)
    expect([dedicatedChecked, scratchChecked].filter(Boolean)).toHaveLength(1)
  })

  it('checks scratch and unchecks dedicated when location is scratch — still exactly one (AC1)', () => {
    const markup = renderView('x', 'scratch')
    const dedicatedChecked = inputByValue(markup, 'dedicated').includes('checked')
    const scratchChecked = inputByValue(markup, 'scratch').includes('checked')
    expect(scratchChecked).toBe(true)
    expect([dedicatedChecked, scratchChecked].filter(Boolean)).toHaveLength(1)
  })

  it('renders the live slug preview under the dedicated option, updating with the name (AC2)', () => {
    const markup = renderView('Investment Strategy Review', 'dedicated')
    expect(markup).toContain('save-as-channel__preview')
    expect(markup).toContain('~/pyry-workspace/channels/investment-strategy-review/')
    // Updates with the name.
    expect(renderView('Other Name', 'dedicated')).toContain(
      '~/pyry-workspace/channels/other-name/'
    )
  })

  it('renders no location preview when Keep in scratch is selected (AC2)', () => {
    const markup = renderView('Investment Strategy Review', 'scratch')
    expect(markup).not.toContain('save-as-channel__preview')
    expect(markup).not.toContain('~/pyry-workspace/channels/')
  })

  it('disables Save, the Name input, and both radios while in-flight', () => {
    const markup = renderView('a name', 'dedicated', { status: 'in-flight' })
    expect(markup).toMatch(/save-as-channel__save"[^>]*disabled/)
    expect(markup).toMatch(/save-as-channel__input"[^>]*disabled/)
    expect(inputByValue(markup, 'dedicated')).toContain('disabled')
    expect(inputByValue(markup, 'scratch')).toContain('disabled')
  })

  it('enables Save once a non-blank name is entered at idle (AC preserved from #274)', () => {
    expect(renderView('a name')).not.toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('disables Save when the name is empty', () => {
    expect(renderView('')).toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('disables Save when the name is whitespace-only', () => {
    expect(renderView('   ')).toMatch(/save-as-channel__save"[^>]*disabled/)
  })

  it('surfaces a generic apostrophe-free failure line when rejected (AC5)', () => {
    const markup = renderView('a name', 'dedicated', { status: 'rejected' })
    expect(markup).toContain('save-as-channel__error')
    expect(markup).toContain('Could not create that folder')
    // Apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27; (the standing desktop lesson),
    // and the reply carries no daemon error text (#396) — so no escaped apostrophe should appear.
    expect(markup).not.toContain('&#x27;')
  })

  it('renders no failure line for idle / in-flight / created (AC5)', () => {
    const nonRejected: NewFolderRoundTrip[] = [
      { status: 'idle' },
      { status: 'in-flight' },
      { status: 'created', path: '~/pyry-workspace/channels/x' }
    ]
    for (const roundTrip of nonRejected) {
      expect(renderView('a name', 'dedicated', roundTrip)).not.toContain('save-as-channel__error')
    }
  })

  it('renders the prefilled name as inert attribute text, never live markup (AC1)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })
})

describe('slugForChannel', () => {
  it('kebab-cases a multi-word name', () => {
    expect(slugForChannel('Investment Strategy Review')).toBe('investment-strategy-review')
  })

  it('trims leading and trailing whitespace', () => {
    expect(slugForChannel('  Padded Name  ')).toBe('padded-name')
  })

  it('collapses a path separator to a single hyphen (no "/")', () => {
    expect(slugForChannel('UI/UX Notes')).toBe('ui-ux-notes')
  })

  it('collapses ".." to a single hyphen (no "..")', () => {
    expect(slugForChannel('a..b')).toBe('a-b')
  })

  it('falls back to "channel" for a punctuation-only or blank name (non-empty invariant)', () => {
    expect(slugForChannel('!!!')).toBe('channel')
    expect(slugForChannel('   ')).toBe('channel')
  })

  it('produces a single-clean-element slug for any non-blank input (daemon #887 name guard)', () => {
    const inputs = ['Investment Strategy Review', 'UI/UX Notes', 'a..b', 'Tom & Jerry', '  x  ']
    for (const input of inputs) {
      expect(slugForChannel(input)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

describe('requestPromoteConversation', () => {
  it('fires exactly one promoteConversation with the id, trimmed name, and explicit cwd (AC3/AC4)', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, 'conv-42', 'My Channel', '/daemon/returned/path')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'promoteConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'My Channel',
        cwd: '/daemon/returned/path'
      }
    })
  })

  it('trims edge whitespace from the name before dispatching', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, 'conv-42', '  Padded Name  ', '/home/pyry/scratch/conv-42')
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

describe('requestCreateChannelFolder', () => {
  it('fires exactly one createWorkspaceFolder with the channels parent and the slugged name (AC4)', () => {
    const sendCommand = vi.fn()
    requestCreateChannelFolder(sendCommand, 'Investment Strategy Review')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'createWorkspaceFolder',
      payload: { parent: '~/pyry-workspace/channels', name: 'investment-strategy-review' }
    })
  })
})
