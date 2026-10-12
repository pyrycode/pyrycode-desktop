import { describe, it, expect } from 'vitest'
import { allowedLinkHref } from './externalLink'

// The one allowlist both the renderer and the main process consult. Allowed hrefs come back VERBATIM;
// every denial is null. Obsidian fixtures use the vault's real shape: a name with a space, and a file path
// whose slash and emoji arrive percent-encoded, the way micromark hands a link destination over.
const OPEN_NOTE =
  'obsidian://open?vault=Second%20brain&file=%F0%9F%93%8B%20Projects%2FPlan'

describe('allowedLinkHref', () => {
  it.each([
    ['an https link', 'https://example.com'],
    ['an http link', 'http://example.com/a'],
    ['an uppercase web scheme', 'HTTPS://example.com/a'],
    ['an Obsidian open link to a note', OPEN_NOTE],
    ['an Obsidian open link to a vault', 'obsidian://open?vault=Second%20brain'],
    ['an Obsidian open link by absolute path', 'obsidian://open?path=%2FUsers%2Fme%2Fnote.md'],
    ['an Obsidian open link with a pane type', `${OPEN_NOTE}&paneType=tab`],
    ['a bare Obsidian open link', 'obsidian://open'],
    ['an Obsidian open link naming the note with its extension', 'obsidian://open?vault=x&file=Plan.md'],
    ['an Obsidian open link with an uppercase note extension', 'obsidian://open?vault=x&file=Plan.MD'],
    ['an Obsidian open link to a nested note with no extension', 'obsidian://open?vault=x&file=A%2FB%2FPlan'],
    // Scheme case is folded by every URL parser on the way, so it cannot change which handler runs.
    ['an uppercase Obsidian scheme', 'OBSIDIAN://open?vault=x'],
    ['a mixed-case Obsidian scheme', 'ObSiDiAn://open?vault=x']
  ])('allows %s, returning it unchanged', (_name, href) => {
    expect(allowedLinkHref(href)).toBe(href)
  })

  it.each([
    ['undefined', undefined],
    ['an empty href', ''],
    ['a relative href', './doc.md'],
    ['a protocol-relative href', '//example.com/x'],
    ['a web scheme with no authority', 'http:example.com'],
    ['a javascript: href', 'javascript:alert(1)'],
    ['an uppercase javascript: href', 'JAVASCRIPT:alert(1)'],
    ['a data: href', 'data:text/html,hello'],
    ['a file: href', 'file:///etc/passwd'],
    ['a mailto: href', 'mailto:a@b.example'],
    ['an unknown custom scheme', 'pyry-evil://do/thing'],
    // Obsidian actions other than `open`. Plugins can register handlers that run commands.
    ['the Obsidian new action', 'obsidian://new?vault=x&name=y&content=z'],
    ['the Advanced URI plugin action', 'obsidian://adv-uri?vault=x&commandid=y'],
    ['the Obsidian search action', 'obsidian://search?vault=x&query=y'],
    ['the Obsidian daily action', 'obsidian://daily?vault=x'],
    // `open` itself writes when given prepend or append.
    ['open with append', `${OPEN_NOTE}&append=text`],
    ['open with prepend', `${OPEN_NOTE}&prepend=text`],
    ['open with an action parameter', `${OPEN_NOTE}&action=new`],
    ['open with an unknown parameter', `${OPEN_NOTE}&commandid=y`],
    ['open with a percent-encoded key', `${OPEN_NOTE}&%61ppend=text`],
    // A file with no Obsidian viewer goes to the operating system's default app, so it would run.
    ['open naming a non-note file', 'obsidian://open?vault=x&file=x.hta'],
    ['open naming a nested non-note file', 'obsidian://open?vault=x&file=A%2Fx.jar'],
    ['open naming a non-note file behind a trailing slash', 'obsidian://open?vault=x&file=x.hta%2F'],
    ['open naming a non-note file behind a trailing backslash', 'obsidian://open?vault=x&file=x.hta%5C'],
    ['open naming a non-note file with a trailing dot', 'obsidian://open?vault=x&file=x.hta.'],
    ['open naming a non-note file by absolute path', 'obsidian://open?path=%2Ftmp%2Fx.command'],
    ['open naming a file through the exact-path prefix', 'obsidian://open?vault=x&file=file%3Ax'],
    // The documented cost of the rule above: a dot in a note's name needs the `.md` spelled out.
    ['open naming a dotted note without its extension', 'obsidian://open?vault=x&file=Plan%20v1.2'],
    // Obsidian decodes every value in its main process and a malformed escape throws there.
    ['open with a malformed escape in file', 'obsidian://open?vault=x&file=%zz'],
    ['open with a malformed escape in vault', 'obsidian://open?vault=%zz'],
    ['open with an encoded ampersand in a value', 'obsidian://open?vault=x&file=a%26append%3Dtext'],
    ['open with an encoded hash in a value', 'obsidian://open?vault=x&file=a%23append=text'],
    // Obsidian parses the fragment into handler parameters too.
    ['open with a fragment', `${OPEN_NOTE}#append=text`],
    ['open with an empty fragment', 'obsidian://open?vault=x#'],
    // Casing and spelling tricks on the action itself.
    ['an uppercase action', 'obsidian://OPEN?vault=x'],
    ['a capitalised action', 'obsidian://Open?vault=x'],
    ['an uppercase scheme with a forbidden action', 'OBSIDIAN://new?vault=x'],
    ['a percent-encoded action', 'obsidian://op%65n?vault=x'],
    ['an action with a suffix', 'obsidian://openx?vault=x'],
    ['an action with a trailing dot', 'obsidian://open.?vault=x'],
    // Authority tricks: the parsed host would read `open` or the string would start `//open`.
    ['userinfo in front of open', 'obsidian://x@open?vault=x'],
    ['open as userinfo in front of new', 'obsidian://open@new?vault=x'],
    ['a port after open', 'obsidian://open:80?vault=x'],
    ['a path after open', 'obsidian://open/?vault=x'],
    ['open with no authority', 'obsidian:open?vault=x'],
    ['open as a path with an empty authority', 'obsidian:///open?vault=x'],
    ['leading whitespace', ' obsidian://open?vault=x']
  ])('denies %s', (_name, href) => {
    expect(allowedLinkHref(href)).toBeNull()
  })
})
