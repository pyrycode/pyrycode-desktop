import { describe, it, expect, vi } from 'vitest'
import { createWindowOpenHandler } from './windowOpenHandler'

// The main window's window-open handler with `shell.openExternal` injected. The full allow and deny
// matrix lives in src/shared/externalLink.test.ts; this file proves the handler consults it, hands an
// allowed URL over unchanged, and denies the in-app window on every path.
describe('createWindowOpenHandler', () => {
  it.each([
    ['an https link', 'https://example.com/a'],
    ['an Obsidian open link', 'obsidian://open?vault=Second%20brain&file=Plan']
  ])('hands %s to openExternal and still denies the window', (_name, url) => {
    const openExternal = vi.fn()
    expect(createWindowOpenHandler(openExternal)({ url })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    ['the Obsidian new action', 'obsidian://new?vault=x&content=y'],
    ['the Advanced URI plugin action', 'obsidian://adv-uri?vault=x&commandid=y'],
    ['an Obsidian open link that appends', 'obsidian://open?vault=x&file=y&append=z'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a file: URL', 'file:///etc/passwd'],
    ['a mailto: URL', 'mailto:a@b.example'],
    ['an unknown scheme', 'pyry-evil://do/thing'],
    ['an unparseable URL', 'not a url']
  ])('never opens %s', (_name, url) => {
    const openExternal = vi.fn()
    expect(createWindowOpenHandler(openExternal)({ url })).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
