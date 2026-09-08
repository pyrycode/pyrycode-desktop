import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for THE SIDEBAR STATUS DOT'S FIVE PAINT BINDINGS (#1174 AC1, Figma node 106:3051 in
// the Channel list frame 103:2985). Only this tier can prove them: `vitest.config.ts` sets
// `environment: 'node'`, so every renderer spec is a `renderToStaticMarkup` string assertion with no
// stylesheet, no cascade and no `getComputedStyle`. The renderer tier can see that `ConversationStatusDot`
// EMITS `conversation-status-dot--working` — `ChannelList.test.tsx`'s `STATUS_DOT_*` constants pin exactly
// that, and #1174 leaves them untouched — and it can never see whether the class paints anything.
//
// That gap is the whole reason this file exists, and #1174 widened it. Until this ticket each status wore
// its colour as a RING and idle wore nothing, so a dropped binding left a visibly missing dot. Now the ring
// is one declaration on the base rule and each status contributes only a `background`, which means a
// modifier that stopped painting would still draw a correct-looking IDLE dot — the one wrong reading
// available, and one no unit test can reach.
//
// A DEDICATED FILE rather than an extension of `connection-dot-colours.spec.ts`, whose probe idiom every
// read below copies. That spec's header scopes it to the four CONNECTION-dot categories, which report
// whether a machine is reachable; this dot reports what a conversation is doing, and the two families are
// deliberately kept disjoint down to sharing no class substring. #1174's acceptance also pins that file as
// unchanged, so it is the model here and never the host.
//
// PROBES RATHER THAN DRIVEN STATE. Reaching `working`, `new-messages` and `input-required` on real rows
// would mean seeding four per-id stores through the relay for a fact that has nothing to do with any of
// them: what is under test is the stylesheet. The one clause that genuinely needs a laid-out row — an idle
// dot fills only while its row is hovered or open — is asserted on real rows in
// `sidebar-row-geometry.spec.ts` block 11b, where a drive that puts an open row and a resting row on
// screen at once already ships.
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion below reads a computed colour STRING or an
// element count — never a seed name, never row text. No failure diff can print daemon-derived content.

// The four statuses `ConversationStatus` is closed over, in the type's own declaration order.
const STATUSES = ['input-required', 'working', 'new-messages', 'idle'] as const

// The ring EVERY status wears since #1174, as Chromium serialises a computed `box-shadow`:
// `inset 0 0 0 1px var(--color-primary)`, `--color-primary` being #9dcbfc — the drawing's stroke on the
// dot in all five of the frame's states. Read as a computed colour rather than as a class, so this fails
// if the token is swapped for the wrong one, if the token's own value drifts, or if a literal is
// substituted. An inset SHADOW and not a `border` is load-bearing and is not a detail of this assertion:
// the repo has no `box-sizing` reset, so a border would grow the 6px box and shift every row's title.
const RING = 'rgb(157, 203, 252) 0px 0px 0px 1px inset'

// The CSSOM's serialisation of "no background" — what an unpainted probe reads back as, and therefore
// exactly what a lost binding would produce.
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

// The fill inside that ring, per status. Each is the DERIVED value of the token the rule names, never the
// token's own name. `--color-tertiary` #ffb59f is the frame's `tertiary-fixed-dim`, `--color-success`
// #2fc038 its `Schemes/Success`, and `--color-warning` #ffca45 the amber from the operator's design-notes
// table — the drawing has no input-required node to read, which is why that one has no Figma variable
// behind it. Idle is unfilled AT REST and is the reason this record's value is the transparent string
// rather than a colour.
const FILLS: Record<(typeof STATUSES)[number], string> = {
  'input-required': 'rgb(255, 202, 69)',
  working: 'rgb(255, 181, 159)',
  'new-messages': 'rgb(47, 192, 56)',
  idle: TRANSPARENT
}

test('every status dot wears the primary ring, and its fill is the drawn one (AC1)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  // The precondition that gives the probe reads someone to matter to, and the wait that lets the sidebar
  // arrive before they run. A count, so the failure diff prints a number rather than daemon text. One,
  // because the fixture seeds a single conversation and reaches the thread by clicking its row.
  await expect(page.locator('.channel-list__row .conversation-status-dot')).toHaveCount(1)

  // One probe per status, appended to the live document so it inherits the same cascade the real dots do,
  // read, then removed. Appended to `document.body` and therefore OUTSIDE any `.channel-list__row`, which
  // is what makes the idle read below the at-rest one: the conditional fill hangs off the row.
  //
  // Nothing is asserted inside the page — the values come back out and the expectations live here, so a
  // failure prints what was actually painted.
  const painted = await page.evaluate((statuses) => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const read = statuses.map((status) => {
      probe.className = `conversation-status-dot conversation-status-dot--${status}`
      const style = getComputedStyle(probe)
      return { ring: style.boxShadow, fill: style.backgroundColor }
    })
    probe.remove()
    return read
  }, STATUSES)

  for (const [index, { ring, fill }] of painted.entries()) {
    const status = STATUSES[index]
    // The ring is on the BASE rule, so it is the same declaration in all four reads. Hoisting it there is
    // what #1174 did; asserting it per status is what detects a hoist that only reached three of them.
    expect(ring, `conversation-status-dot--${status} lost the primary ring`).toBe(RING)
    expect(fill, `conversation-status-dot--${status} has the wrong fill`).toBe(FILLS[status])
  }

  // And the three painted fills are DISTINCT, so the three states stay tellable apart at a glance — two
  // modifiers collapsed onto one token passes every read above and fails here. Idle is excluded because
  // its at-rest transparency is not a fill and is already pinned exactly by the loop.
  const filled = painted.map(({ fill }) => fill).filter((fill) => fill !== TRANSPARENT)
  expect(filled).toHaveLength(STATUSES.length - 1)
  expect(new Set(filled).size).toBe(filled.length)
})
