import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunConfigView, RunConfigSections } from './RunConfigSections'

// No DOM harness (jsdom/Testing Library) — mirrors LogDataSection.test.tsx. RunConfigView is pure
// (model/effort/yolo + the two usage figures in, markup out), so a server-rendered string proves each
// visible state; the container is exercised only for "server-renders the AC4 default without touching
// window.pyry" (zustand v5's useStore reads getInitialState() = snapshot:null under server render, so
// the populated states are unreachable there and are proven on the pure view instead).

// The Model/Effort/YOLO cases don't exercise the Context window gauge, so they pass the "unavailable"
// usage pair (windowTokens: 0); the Context window block below varies the two figures explicitly.
const NO_USAGE = { usedTokens: 0, windowTokens: 0 } as const

// The run of markup belonging to the sibling element whose class value is `className` and that
// contains `needle`. Sibling elements are delimited by the repeated class token, so this isolates a
// single Model row / Effort segment to assert its own selection marker without cross-row bleed.
function segmentFor(markup: string, className: string, needle: string): string {
  return markup.split(className).find((chunk) => chunk.includes(needle)) ?? ''
}

describe('RunConfigView — Model', () => {
  it('marks the Opus row selected for the short alias "opus"; Sonnet/Haiku unmarked', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="opus" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
    expect(segmentFor(markup, 'run-config__model-row', 'Sonnet 4.6')).not.toContain('Current model')
    expect(segmentFor(markup, 'run-config__model-row', 'Haiku 4.5')).not.toContain('Current model')
    // Exactly one row is marked.
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks Opus for a full id "claude-opus-4-7" (family substring match, not exact equality)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView model="claude-opus-4-7" effort="" yolo={false} {...NO_USAGE} />
    )
    expect(segmentFor(markup, 'run-config__model-row', 'Opus 4.7')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks the Sonnet row for "sonnet"', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="sonnet" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Sonnet 4.6')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks the Haiku row for "haiku"', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="haiku" effort="" yolo={false} {...NO_USAGE} />)
    expect(segmentFor(markup, 'run-config__model-row', 'Haiku 4.5')).toContain('Current model')
    expect(markup.match(/Current model/g)?.length).toBe(1)
  })

  it('marks no row for the empty model (AC4 default) or an unrecognized model', () => {
    for (const model of ['', 'some-unknown-model']) {
      const markup = renderToStaticMarkup(<RunConfigView model={model} effort="" yolo={false} {...NO_USAGE} />)
      expect(markup).not.toContain('Current model')
    }
  })

  it('always renders all three names and descriptors, matched or not', () => {
    for (const model of ['opus', '', 'gibberish']) {
      const markup = renderToStaticMarkup(<RunConfigView model={model} effort="" yolo={false} {...NO_USAGE} />)
      for (const text of [
        'Opus 4.7',
        'best for complex work',
        'Sonnet 4.6',
        'faster, cheaper',
        'Haiku 4.5',
        'fastest'
      ]) {
        expect(markup).toContain(text)
      }
    }
  })
})

describe('RunConfigView — Effort', () => {
  it('marks exactly the current level with aria-current, the rest unmarked', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort={level} yolo={false} {...NO_USAGE} />)
      expect(segmentFor(markup, 'run-config__effort-segment', `>${level}<`)).toContain(
        'aria-current="true"'
      )
      expect(markup.match(/aria-current="true"/g)?.length).toBe(1)
    }
  })

  it('marks no segment for the empty effort (AC4 default) or an unknown value', () => {
    for (const effort of ['', 'turbo']) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort={effort} yolo={false} {...NO_USAGE} />)
      expect(markup).not.toContain('aria-current')
    }
  })

  it('always renders all five level labels', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={false} {...NO_USAGE} />)
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(markup).toContain(`>${level}<`)
    }
  })
})

describe('RunConfigView — YOLO', () => {
  it('reflects yolo:true as an on switch (aria-checked="true")', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={true} {...NO_USAGE} />)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
    // Read-only: the switch advertises it does not accept input.
    expect(markup).toContain('aria-readonly="true"')
  })

  it('reflects yolo:false as an off switch (aria-checked="false")', () => {
    const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={false} {...NO_USAGE} />)
    expect(markup).toContain('aria-checked="false"')
  })

  it('renders the row title and caption in both states', () => {
    for (const yolo of [true, false]) {
      const markup = renderToStaticMarkup(<RunConfigView model="" effort="" yolo={yolo} {...NO_USAGE} />)
      expect(markup).toContain('Auto-accept tool calls')
      expect(markup).toContain('Claude runs commands without asking for confirmation. Use carefully.')
    }
  })
})

describe('RunConfigView — Context window', () => {
  // The four other sections are exercised above; these props supply a neutral base so each case
  // varies only the two usage figures.
  const base = { model: '', effort: '', yolo: false }

  it('renders the usage line, a progressbar, and a proportional fill when window > 0', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={146000} windowTokens={200000} />
    )
    expect(markup).toContain('73% used (146K of 200K tokens)')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="73"')
    // renderToStaticMarkup serializes the inline fill width as style="width:73%".
    expect(markup).toContain('width:73%')
  })

  it('reflects a newer, smaller snapshot after a compaction (AC4)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={20000} windowTokens={200000} />
    )
    expect(markup).toContain('10% used (20K of 200K tokens)')
    expect(markup).toContain('width:10%')
  })

  it('rounds the percentage to the nearest integer', () => {
    // 45000 / 200000 = 22.5% → rounds to 23%.
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={45000} windowTokens={200000} />
    )
    expect(markup).toContain('23% used (45K of 200K tokens)')
  })

  it('shows a raw count under 1000 tokens (no "K" abbreviation)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={500} windowTokens={200000} />
    )
    expect(markup).toContain('0% used (500 of 200K tokens)')
  })

  it('clamps an over-full session to 100% so the bar never overflows its track (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={210000} windowTokens={200000} />
    )
    expect(markup).toContain('100% used')
    expect(markup).toContain('width:100%')
  })

  it('shows an unavailable state — never a broken bar/NaN/divide-by-zero — when window is 0 (AC5)', () => {
    const markup = renderToStaticMarkup(
      <RunConfigView {...base} usedTokens={146000} windowTokens={0} />
    )
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('role="progressbar"')
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
    expect(markup).not.toContain('Infinity')
    expect(markup).toContain('Context usage unavailable')
  })

  it('always renders the header and the verbatim explainer, available or not (Figma 20:155)', () => {
    for (const windowTokens of [0, 200000]) {
      const markup = renderToStaticMarkup(
        <RunConfigView {...base} usedTokens={146000} windowTokens={windowTokens} />
      )
      expect(markup).toContain('Context window')
      // renderToStaticMarkup escapes the apostrophe in "claude's" to &#x27; in the serialized markup.
      expect(markup).toContain(
        'When full, oldest messages get dropped from claude&#x27;s view ' +
          '(delimiter still shows; old messages stay in your scroll).'
      )
    }
  })
})

describe('RunConfigSections (container)', () => {
  it('server-renders the AC4 default without touching window.pyry', () => {
    // useStore reads getInitialState() (snapshot:null) under server render, so the container always
    // renders the coalesced default — the real opening frame before a snapshot arrives. No bridge is
    // dereferenced during render, so no window.pyry mock is needed.
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<RunConfigSections />)
    }).not.toThrow()
    // AC4 default: no radio filled, no segment marked, switch off.
    expect(markup).not.toContain('Current model')
    expect(markup).not.toContain('aria-current')
    expect(markup).toContain('aria-checked="false"')
    // The null-snapshot default (windowTokens: 0) collapses into the same unavailable branch as the
    // daemon's window_tokens == 0 signal — no % used, no NaN, no divide-by-zero (AC5).
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('NaN')
    expect(markup).toContain('Context usage unavailable')
    // The static catalog + labels still render.
    expect(markup).toContain('Opus 4.7')
    expect(markup).toContain('>low<')
  })
})
