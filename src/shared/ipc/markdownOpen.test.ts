import { describe, it, expect } from 'vitest'
import {
  MARKDOWN_OPEN_CHANNEL,
  MAX_MARKDOWN_OPEN_NAME_LENGTH,
  MAX_MARKDOWN_OPEN_TEXT_LENGTH,
  isMarkdownOpenRequest
} from './markdownOpen'
import { DAEMON_EVENT_CHANNEL } from './events'
import { ATTACHMENT_OPEN_CHANNEL, ATTACHMENT_OPEN_EVENT_CHANNEL } from './attachmentOpen'
import { WORKSPACE_FILE_READ_CHANNEL, WORKSPACE_FILE_READ_EVENT_CHANNEL } from './workspaceFileRead'

// #1631 — the open-in-another-app request's boundary guard. The bound's relation to the largest file the
// reader can receive is pinned in src/main/markdownOpen.test.ts, which may import from src/main.

const VALID = { text: '# Plan\n\nBody', displayName: 'Plan.md' }

describe('markdown-open channel', () => {
  it('is distinct from every neighbouring channel', () => {
    const channels = [
      MARKDOWN_OPEN_CHANNEL,
      DAEMON_EVENT_CHANNEL,
      ATTACHMENT_OPEN_CHANNEL,
      ATTACHMENT_OPEN_EVENT_CHANNEL,
      WORKSPACE_FILE_READ_CHANNEL,
      WORKSPACE_FILE_READ_EVENT_CHANNEL
    ]
    expect(new Set(channels).size).toBe(channels.length)
  })
})

describe('isMarkdownOpenRequest (#1631)', () => {
  it('accepts the text and the display name, empty strings included', () => {
    expect(isMarkdownOpenRequest(VALID)).toBe(true)
    // An empty note is loaded content, and the sanitiser has a fallback for an empty name.
    expect(isMarkdownOpenRequest({ text: '', displayName: '' })).toBe(true)
  })

  it('accepts each field at its bound and drops one code unit over', () => {
    const atBound = { text: 'x'.repeat(MAX_MARKDOWN_OPEN_TEXT_LENGTH), displayName: 'n'.repeat(MAX_MARKDOWN_OPEN_NAME_LENGTH) }
    expect(isMarkdownOpenRequest(atBound)).toBe(true)
    expect(isMarkdownOpenRequest({ ...atBound, text: `${atBound.text}x` })).toBe(false)
    expect(isMarkdownOpenRequest({ ...atBound, displayName: `${atBound.displayName}n` })).toBe(false)
  })

  it('drops a non-object, a missing field or a non-string field', () => {
    for (const value of [null, undefined, 'Plan.md', 42, []]) expect(isMarkdownOpenRequest(value)).toBe(false)
    expect(isMarkdownOpenRequest({ text: 'Body' })).toBe(false)
    expect(isMarkdownOpenRequest({ displayName: 'Plan.md' })).toBe(false)
    expect(isMarkdownOpenRequest({ ...VALID, text: 7 })).toBe(false)
    expect(isMarkdownOpenRequest({ ...VALID, displayName: null })).toBe(false)
    expect(isMarkdownOpenRequest({ ...VALID, displayName: ['Plan.md'] })).toBe(false)
  })

  it('drops a field that is only inherited', () => {
    const hostile: unknown = JSON.parse('{"text":"Body","__proto__":{"displayName":"Plan.md"}}')
    expect(isMarkdownOpenRequest(hostile)).toBe(false)
  })
})
