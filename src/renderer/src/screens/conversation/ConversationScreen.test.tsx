import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationScreen } from './ConversationScreen'
import { placeholderMessages } from './placeholderMessages'

// No DOM harness (jsdom/Testing Library) yet — the shell is static this ticket,
// so a server-rendered markup string is enough to assert structure. #2 adds the
// DOM harness when the composer gains real input/click behaviour.
function render(): string {
  return renderToStaticMarkup(<ConversationScreen />)
}

describe('ConversationScreen', () => {
  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('renders one bubble per placeholder message', () => {
    const markup = render()
    const bubbleCount = markup.match(/data-message-role="/g)?.length ?? 0
    expect(bubbleCount).toBe(placeholderMessages.length)
  })

  it('renders both message roles', () => {
    const markup = render()
    expect(markup).toContain('data-message-role="user"')
    expect(markup).toContain('data-message-role="daemon"')
  })

  it('renders the composer with a text input and an accessible send control', () => {
    const markup = render()
    expect(markup).toContain('<textarea')
    expect(markup).toContain('<button')
    expect(markup).toContain('aria-label="Send"')
  })

  it('renders each placeholder message text', () => {
    const markup = render()
    for (const message of placeholderMessages) {
      expect(markup).toContain(message.text)
    }
  })
})
