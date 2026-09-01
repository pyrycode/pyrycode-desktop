import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationStatus } from '../../store/conversationStatus'
import { ConversationStatusDot } from './ConversationStatusDot'

// The #218 idiom this directory already uses: server-render the pure view with an injected prop — no DOM
// harness, no store. The component's one input is a closed union, so the whole matrix is four renders.
const dot = (status: ConversationStatus): string =>
  renderToStaticMarkup(<ConversationStatusDot status={status} />)

// The FULL attribute value, `ChannelList.test.tsx:92-95`'s form: the dot wears the geometry base AND its
// modifier, so `class="conversation-status-dot"` with its closing quote would silently match NOTHING —
// the quote follows the LAST class. Pinning the whole value fixes the base class and the modifier
// together, which is what makes one marker defend both AC1 (the modifier differs) and AC4 (the base box
// is on every state).
const INPUT_REQUIRED_MARKER =
  'class="conversation-status-dot conversation-status-dot--input-required"'
const WORKING_MARKER = 'class="conversation-status-dot conversation-status-dot--working"'
const NEW_MESSAGES_MARKER = 'class="conversation-status-dot conversation-status-dot--new-messages"'
const IDLE_MARKER = 'class="conversation-status-dot conversation-status-dot--idle"'

// The base class plus the space a modifier always follows — the element-counting handle. Opening quote
// included, so it counts DOTS rather than class mentions.
const BASE_OPEN = 'class="conversation-status-dot '

const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

// Mirrors the type's declaration order. It is an ARRAY, not a `Record`, so `tsc` cannot see it fall behind
// a new union member: a status left out of here goes untested, the distinctness count below still passes,
// and the collision guard never sees the new class. Extending it is a deliberate edit whenever the union
// grows (#873 added `input-required`).
const ALL_STATUSES: readonly ConversationStatus[] = [
  'input-required',
  'working',
  'new-messages',
  'idle'
]

describe('ConversationStatusDot (#800)', () => {
  it('binds each status to its own modifier, over the shared base class (AC1/AC4)', () => {
    // One case per union member, so each binding is pinned rather than sampled — the `HostConnectionDots`
    // discipline at ChannelList.test.tsx:592. Idle is asserted like the other two: it carries an EXPLICIT
    // `--idle` modifier rather than the base alone, so a dropped modifier fails here instead of rendering
    // as a correct-looking idle dot.
    expect(dot('input-required')).toContain(INPUT_REQUIRED_MARKER)
    expect(dot('working')).toContain(WORKING_MARKER)
    expect(dot('new-messages')).toContain(NEW_MESSAGES_MARKER)
    expect(dot('idle')).toContain(IDLE_MARKER)
  })

  it('emits pairwise-distinct markup for the four statuses (AC1)', () => {
    // The assertion that catches a modifier interpolated from the wrong value, or dropped entirely — both
    // of which leave the four assertions above partly green while collapsing two states into one dot.
    expect(new Set(ALL_STATUSES.map(dot)).size).toBe(4)
  })

  it('emits exactly one dot per status (AC1)', () => {
    for (const status of ALL_STATUSES) {
      expect(countOf(dot(status), BASE_OPEN)).toBe(1)
    }
  })

  it('names every dot in the app’s own voice, on a role that carries it (AC2)', () => {
    // `aria-label` on a bare <span> is DROPPED by the accessible-name computation — a name needs a role to
    // land on, and `role="img"` is the ARIA-in-HTML-legal one for a non-interactive graphic
    // (ChannelList.tsx:320-322 records this for the host dots). Without it AC2 passes review and fails in
    // a screen reader.
    for (const status of ALL_STATUSES) {
      expect(dot(status)).toContain('role="img"')
    }
    // The literal shipped copy, one case each: client-owned constants, never daemon text. `input-required`
    // is the one state blocked on the operator, so naming it is what keeps the amber from being the only
    // signal (#873 AC3).
    expect(dot('input-required')).toContain('aria-label="Input required"')
    expect(dot('working')).toContain('aria-label="Assistant working"')
    expect(dot('new-messages')).toContain('aria-label="New messages"')
    expect(dot('idle')).toContain('aria-label="Idle"')
  })

  it('shares no class token with the connection dots or the sidebar row (collision guard)', () => {
    // The hazard the ticket names twice, in both directions. Playwright locators run in strict mode, so an
    // element JOINING `launchPairedApp.ts:224`'s unfiltered `.channel-list__row-open` — which 28 specs ride
    // — strict-violates rather than failing an assertion. And `ChannelList.test.tsx` counts
    // `channel-list__host-dot …` as literal substrings while `ConversationScreen.test.tsx` asserts
    // `toContain('conn-dot--up')`, either of which a new dot's class could satisfy by accident. This guard
    // is what survives a later rename of this block.
    for (const status of ALL_STATUSES) {
      const markup = dot(status)
      expect(markup).not.toContain('conn-dot')
      expect(markup).not.toContain('channel-list__row')
      expect(markup).not.toContain('channel-list__host-dot')
    }
  })
})
