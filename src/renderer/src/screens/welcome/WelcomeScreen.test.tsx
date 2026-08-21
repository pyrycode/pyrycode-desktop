import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WelcomeView, WelcomeScreen } from './WelcomeScreen'

// No DOM harness (jsdom/Testing Library) — mirrors PairingScreen.test.tsx / App.test.tsx. WelcomeView is
// pure (props in, markup out), so a server-rendered string proves the copy, the structure, and — for the
// setup link — the whole behaviour, because the click mechanism IS an emitted attribute (target="_blank"
// → setWindowOpenHandler → shell.openExternal). The container (WelcomeScreen) is a passthrough today and
// gets the "renders without throwing" smoke, exactly as PairingScreen does; the onPair passthrough itself
// is reviewed glue.
const noop = (): void => {}

function renderView(props: { onPair?: () => void } = {}): string {
  return renderToStaticMarkup(<WelcomeView {...props} />)
}

describe('WelcomeView', () => {
  it('renders the hero copy verbatim — title, subtitle, body (AC1, AC2)', () => {
    const markup = renderView({ onPair: noop })
    // The title is the page heading, so the element is pinned along with its text.
    expect(markup).toContain('<h1 class="welcome__title">Pyrycode</h1>')
    // The de-duplicated subtitle. Figma node 103-754 still reads "Control Claude multiple Claude server
    // instances." (a repeated word); this assertion is the pin against someone "fixing" it back.
    expect(markup).toContain('Control multiple Claude server instances.')
    expect(markup).not.toContain('Control Claude multiple Claude')
    expect(markup).toContain(
      'Pyrycode runs Claude on your computer or home server. Channels and conversation history live on your machine, accessible from any device.'
    )
  })

  it('lays the hero out as the mark followed by the copy block (AC1)', () => {
    const markup = renderView({ onPair: noop })
    expect(markup).toContain('<svg class="welcome__mark"')
    // The horizontal row itself is a CSS property (flex-direction) and belongs to visual review; what
    // the markup can prove is that both halves live inside the hero, mark first.
    const heroAt = markup.indexOf('class="welcome__hero"')
    const markAt = markup.indexOf('class="welcome__mark"')
    const copyAt = markup.indexOf('class="welcome__copy"')
    expect(heroAt).toBeGreaterThanOrEqual(0)
    expect(markAt).toBeGreaterThan(heroAt)
    expect(copyAt).toBeGreaterThan(markAt)
  })

  it('renders the primary CTA as a button carrying the leading icon and the label (AC3)', () => {
    const markup = renderView({ onPair: noop })
    const button = markup.slice(markup.indexOf('<button'), markup.indexOf('</button>'))
    expect(button).toContain('<svg')
    expect(button).toContain('I already have pyrycode')
  })

  it('still renders the primary CTA with onPair omitted — the dormant state (AC3)', () => {
    // Nothing mounts this screen yet (#658 does), so the navigation prop is optional and a click is a
    // no-op. The button must render regardless; an `onPair!()` call would throw here instead.
    let markup: string | undefined
    expect(() => {
      markup = renderView()
    }).not.toThrow()
    expect(markup).toContain('<button')
    expect(markup).toContain('I already have pyrycode')
  })

  it('renders the setup CTA as an external-opening anchor on the pinned URL (AC4)', () => {
    const markup = renderView({ onPair: noop })
    // The whole anchor as ONE string (the AssistantMarkdown.test.tsx:111 move). target="_blank" is in it
    // deliberately and is not decoration: it is what makes the click a window-open request, which
    // setWindowOpenHandler (src/main/index.ts:56) answers with shell.openExternal + deny. Without it the
    // click is a same-document navigation that will-navigate (:79) cancels — the link would look right
    // and do nothing, which no separate attribute assertion distinguishes from success as clearly.
    expect(markup).toContain(
      '<a class="welcome__setup" href="https://pyryco.de/setup" target="_blank" rel="noreferrer">Set up pyrycode first</a>'
    )
  })

  it('renders the footer as non-interactive text, and it is the only link-free row (AC5)', () => {
    const markup = renderView({ onPair: noop })
    // Positive: the line exists, is a <p>, and holds the full text.
    expect(markup).toContain(
      '<p class="welcome__footer">Open source · github.com/pyrycode/pyrycode-desktop</p>'
    )
    // Negative, paired with the positive in the same case so neither can pass vacuously: the screen
    // legitimately contains one anchor (the setup CTA), so a bare "no <a" would be false. COUNTING is
    // what makes this non-vacuous — it fails the moment the footer becomes a link, and just as loudly
    // if the setup link is deleted.
    expect(markup.match(/<a\b/g)?.length).toBe(1)
    expect(markup).not.toContain('href="https://github.com')
  })
})

describe('WelcomeScreen', () => {
  it('renders without throwing with no Electron bridge present (AC7)', () => {
    // No globalThis.window stub — deliberately NOT the App.test.tsx:29-35 idiom. PairingScreen needs that
    // stub because it dereferences window.pyry at render (`bridge ?? window.pyry`); this container's whole
    // point is that it touches no bridge and no store, so the ABSENT stub is the assertion. The explicit
    // `window` check below keeps that non-vacuous — it fails if a later edit installs a stub instead of
    // fixing the container.
    expect('window' in globalThis).toBe(false)
    let markup: string | undefined
    expect(() => {
      markup = renderToStaticMarkup(<WelcomeScreen />)
    }).not.toThrow()
    expect(markup).toContain('Pyrycode')
  })
})
