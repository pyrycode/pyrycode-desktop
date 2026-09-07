import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  SendMessagePayload,
  SlashCommandListPayload,
  WireSlashCommand
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #681 — an Actions entry the workspace cannot run renders unavailable and SENDS
// NOTHING when picked, by click or by Enter. It drives the whole client path on the launchPairedApp
// fixture: pushed frame → Noise → decode (#936) → IPC arm (#937) → bridge → store (#954) → the
// availability decision → the panel, then does the one thing the unit tiers structurally cannot — click a
// greyed row and press Enter on it.
//
// WHY IT HAS TO BE PLAYWRIGHT. vitest runs the `node` environment (vitest.config.ts): every renderer test
// is a renderToStaticMarkup string assertion with no DOM, no effects and no click handlers.
// composerActionAvailability.test.ts pins the four UNKNOWN readings and the match rule as data, and
// ComposerActionsMenu.test.tsx pins the greyed row's markup; only a real window can prove that picking it
// sends nothing while an available row beside it still sends, and that arrow navigation is not stuck on
// the row that cannot be picked.
//
// THE LIST IS A SERVER PUSH. The daemon publishes the menu unsolicited from its `initialize` reply —
// nothing the client sends provokes it — so it goes out through daemon.pushFrame rather than through
// buildReplyFrames, which only answers outbound envelopes (the sibling specs' convention).
//
// ONE test() block, ONE launch, ONE continuous drive — the slash-command-type-ahead.spec.ts shape: each
// launch pays a full handshake and no step here mutates persistent state.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// attributes, focus and counts, plus the decoded outbound's `text` — which is a client-owned slash
// command, not a secret. The pairing plumbing lives in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; short headroom over
// Playwright's 5s default for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness).
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-09-04T12:00:00.000Z'

// The trigger's client-owned label and the three row labels, plus #681's client-owned explanation. All
// duplicated as literals rather than imported, the ~15 `Send` locators' convention: THEY ARE LOAD-BEARING
// LOCATORS, and rewording one in the source without updating this spec breaks it, which is the point.
// `exact: true` for composer-actions.spec.ts's measured reason — getByRole matches `name` as a
// case-insensitive SUBSTRING, and the thread overflow trigger one region up reads `More actions`.
const ACTIONS_LABEL = 'Actions'
const AVAILABLE_ROW = 'Reset session'
const UNAVAILABLE_ROW = 'Knowledge capture'
const UNAVAILABLE_NOTE = '(unavailable in this workspace)'
// #1218's control row. It is NOT a slash command, so a complete published list that does not name it
// proves nothing about it and it must never be greyed out — the whole of that ticket's AC3, and a
// failure that would ship looking correct.
const CONTROL_ROW = 'New session (restarts claude)'

function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

// A COMPLETE menu — nothing dropped, no row reporting a cut field — carrying `clear` and `compact` and
// NOT `knowledge-capture`. Completeness is what makes the absence provable; every incomplete shape is an
// UNKNOWN reading that leaves all three rows available, and those cases are data in
// composerActionAvailability.test.ts rather than four more launches here.
//
// `compact` publishes its verb as an ALIAS of a differently-named row, so this drive also exercises AC3's
// alias arm through the real decode path: a name-only match would grey a working command out.
const COMMANDS: WireSlashCommand[] = [
  command({ name: 'clear', description: 'Clear conversation history and free up context' }),
  command({ name: 'compact-conversation', aliases: ['compact'] }),
  command({ name: 'model', argument_hint: '<model>' })
]

/** One unsolicited `slash_command_list` frame for the seeded conversation. Sealed via the production
 *  encoder, so the decode this exercises is the shipped one. */
function slashCommandListFrame(): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'slash_command_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      commands: COMMANDS,
      dropped_commands: 0
    } satisfies SlashCommandListPayload
  })
}

/**
 * A daemon script that CAPTURES the decoded outbound instead of answering it — composer-actions.spec.ts's
 * helper verbatim, because the proof this ticket needs is a NEGATIVE one: after a blocked click and a
 * blocked Enter, `sent` must still be empty. A bubble-absence assertion alone would pass for an echo that
 * simply never painted.
 *
 * A factory rather than a module-level array, so no test can see another's captures.
 */
function captureOutbound(): {
  sent: SendMessagePayload[]
  buildReplyFrames: (inbound: Uint8Array) => Uint8Array[]
} {
  const sent: SendMessagePayload[] = []
  return {
    sent,
    buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(inbound)
      switch (envelope.type) {
        case 'send_message':
          sent.push(envelope.payload as SendMessagePayload)
          return []
        default:
          return [seedConversationsFrame()]
      }
    }
  }
}

const actionsTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: ACTIONS_LABEL, exact: true })
const actionsPanel = (page: Page): Locator =>
  page.getByRole('menu', { name: ACTIONS_LABEL, exact: true })

test('an unpublished action is greyed out and sends nothing, by click or by Enter (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  // --- 1. The menu arrives unsolicited, before the panel is ever opened. ---
  daemon.pushFrame(slashCommandListFrame())

  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  const unavailable = panel.getByRole('menuitem', { name: UNAVAILABLE_ROW })
  const available = panel.getByRole('menuitem', { name: AVAILABLE_ROW })

  // --- 2. GREYING IS NOT HIDING (AC1). Every row is still offered and still a menu item; exactly
  // one of them is marked, and it is the one no published row names. The assertion retries, so a frame
  // still in flight when the panel opened resolves here rather than racing. Four rows since #1218. ---
  await expect(panel.getByRole('menuitem')).toHaveCount(4)
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(panel.locator('[aria-disabled="true"]')).toHaveCount(1)

  // AC4 — a client-owned explanation assistive technology announces, rather than an inert row with no
  // reason given. It is hidden text inside the row, so it is part of the accessible name and reaches no
  // attribute.
  await expect(unavailable).toContainText(UNAVAILABLE_NOTE)

  // AC3's alias arm, through the real decode: `compact` is published only as an ALIAS of
  // `compact-conversation`, and its row is NOT marked. A name-only match would have greyed it.
  await expect(panel.getByRole('menuitem', { name: 'Compact session' })).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )

  // #1218's AC3, live and against the strongest input this spec has: a COMPLETE published list naming
  // `clear` and `compact-conversation` and nothing else. That list proves the absence of the three slash
  // commands, and proves NOTHING about a control frame that is not a slash command at all — so the
  // control row must be offered here exactly as in a workspace that publishes everything. The `count(1)`
  // above already bounds the marking to one row; this names which row must not be it, so a regression
  // reads as "New session was greyed out" rather than as an arithmetic surprise.
  await expect(panel.getByRole('menuitem', { name: CONTROL_ROW })).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )

  // --- 3. CLICKING IT SENDS NOTHING (AC1), and the panel stays open — nothing happened, so nothing is
  // reported. A row that closed the panel would read as a successful pick. ---
  //
  // `force: true` IS LOAD-BEARING AND IS NOT A WORKAROUND. Playwright's actionability check reads
  // `aria-disabled="true"` as not-enabled and refuses an ordinary click, which is corroboration that the
  // marking lands where assistive tooling looks — but refusing to click proves nothing about what the app
  // does WHEN clicked, and `aria-disabled` is advisory: a real user's pointer reaches this row and React's
  // onClick fires. Forcing the click is what drives the path the gate actually guards. Do not "fix" this
  // by asserting the refusal instead.
  await unavailable.click({ force: true })
  await expect(panel).toBeVisible()
  expect(sent).toHaveLength(0)
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(0)

  // --- 4. ENTER ON THE FOCUSED ROW SENDS NOTHING EITHER (AC1) — the other half of "picking it". The row
  // is reached with the arrows, which also proves the roving tabindex is NOT stuck on it: a `disabled`
  // <button> would not be focusable and the focus call would silently no-op. ---
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(unavailable).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  expect(sent).toHaveLength(0)

  // --- 5. THE GATE IS PER ROW, not a dead menu (AC1). The same open panel still sends an available row's
  // command — arrowed back to it, so the keyboard path is proven to work rather than merely to refuse. ---
  //
  // TWO steps, not one, since #1218 appended a fourth row: the ring wraps, so from the third row the
  // first is now two ArrowDowns away, THROUGH the control row. Passing over it is part of what this
  // proves — arrowing onto a row does not activate it.
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByRole('menuitem', { name: CONTROL_ROW })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(available).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel).toBeHidden()

  await expect.poll(() => sent.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(sent[0].text).toBe('/clear')
})
