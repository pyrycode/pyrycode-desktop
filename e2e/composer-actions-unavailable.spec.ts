import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  SendMessagePayload,
  SessionSettingsPayload,
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
// #1496 MOVED THIS ANCHOR, and a rename would not have been enough. It read `Reset session` — the
// ungreyed `/clear` slash row — while CONTROL_ROW below read the New session label. The fold made both
// names resolve to the SAME row, so renaming in place would have left this spec green for the wrong
// reason: the available-row half would have been driving the control row, which sends no `send_message`
// at all. `Compact session` is the available slash row now, and it doubles as AC3's alias-arm proof
// because the fixture publishes its verb only as an alias.
const AVAILABLE_ROW = 'Compact session'
const UNAVAILABLE_ROW = 'Knowledge capture'
const UNAVAILABLE_NOTE = '(unavailable in this workspace)'
// #1218's control row, labelled `Reset session` and drawn first since #1496. It is NOT a slash command,
// so a complete published list that does not name it proves nothing about it and it must never be greyed
// out — the whole of that ticket's AC3, #1496's AC2, and a failure that would ship looking correct. It is
// also the conversation's only reset path now, so greying it would leave a chat with no way to start over.
const CONTROL_ROW = 'Reset session'

function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

// A COMPLETE menu — nothing dropped, no row reporting a cut field — carrying `compact` and NOT
// `knowledge-capture`. Completeness is what makes the absence provable; every incomplete shape is an
// UNKNOWN reading that leaves every row available, and those cases are data in
// composerActionAvailability.test.ts rather than four more launches here.
//
// `compact` publishes its verb as an ALIAS of a differently-named row, so this drive also exercises AC3's
// alias arm through the real decode path: a name-only match would grey a working command out.
//
// IT NAMES NEITHER THE CONTROL ROW NOR `clear`, and #1496 removed the `clear` entry it used to publish
// for exactly that reason. That is the sharpest input for the control row's never-greyed property: a list
// still publishing `clear` would keep this spec green for an implementation that folded the control row
// back into COMPOSER_ACTIONS under the id `/clear` — the tidy-up that would put the conversation's only
// reset path back under the workspace's control.
const COMMANDS: WireSlashCommand[] = [
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
  // still in flight when the panel opened resolves here rather than racing. Three rows since #1496. ---
  await expect(panel.getByRole('menuitem')).toHaveCount(3)
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(panel.locator('[aria-disabled="true"]')).toHaveCount(1)

  // AC4 — a client-owned explanation assistive technology announces, rather than an inert row with no
  // reason given. It is hidden text inside the row, so it is part of the accessible name and reaches no
  // attribute.
  await expect(unavailable).toContainText(UNAVAILABLE_NOTE)

  // AC3's alias arm, through the real decode: `compact` is published only as an ALIAS of
  // `compact-conversation`, and its row is NOT marked. A name-only match would have greyed it. This is
  // the same row the drive below picks, so the alias arm is proved by a row that then genuinely sends.
  await expect(available).not.toHaveAttribute('aria-disabled', 'true')

  // #1218's AC3 and #1496's AC2, live and against the strongest input this spec has: a COMPLETE published
  // list naming `compact-conversation` and `model` and nothing else — neither the control row nor `clear`.
  // That list proves the absence of a slash command it does not name, and proves NOTHING about a control
  // frame that is not a slash command at all — so the control row must be offered here exactly as in a
  // workspace that publishes everything. The `count(1)` above already bounds the marking to one row; this
  // names which row must not be it, so a regression reads as "Reset session was greyed out" rather than
  // as an arithmetic surprise.
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
  // TWO steps, not one, and still two after #1496 moved the control row from last to first: the ring
  // wraps, so from the greyed last row the first ArrowDown lands on the control row and the second on the
  // available one. Passing over the control row is part of what this proves — arrowing onto a row does not
  // activate it, which matters more now that the row it passes over restarts claude.
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByRole('menuitem', { name: CONTROL_ROW })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(available).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel).toBeHidden()

  await expect.poll(() => sent.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(sent[0].text).toBe('/compact')
})

// #1697 — a session whose `session_settings` reply says it has no slash commands (a Codex session) is
// offered every command row GREYED rather than none, mobile's `absentComposerActions` rule. The published
// menu here names `compact`, so a greyed Compact session proves the flag wins over the menu. Picking a
// greyed row sends nothing; the control row is untouched.
function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID + 1,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      session_id: 'session-1697',
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000,
      capabilities: { slash_commands: false, mcp_servers: false, context_usage_detail: false }
    } satisfies SessionSettingsPayload
  })
}

test('a session without slash commands greys every command row, and a pick sends nothing (#1697)', async ({
  launchPairedApp
}) => {
  const sent: SendMessagePayload[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(inbound)
      switch (envelope.type) {
        case 'send_message':
          sent.push(envelope.payload as SendMessagePayload)
          return []
        case 'request_session_settings':
          return [sessionSettingsFrame(envelope.id)]
        default:
          return [seedConversationsFrame()]
      }
    }
  })
  daemon.pushFrame(slashCommandListFrame())

  // The context reading arrives in the same reply as the flags, so once it shows, the flags are held too.
  await expect(page.locator('.composer__context')).toHaveText('Context: 25%', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  const rows = panel.getByRole('menuitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toHaveText(CONTROL_ROW)
  await expect(rows.nth(0)).not.toHaveAttribute('aria-disabled', 'true')
  for (const [index, label] of [
    [1, AVAILABLE_ROW],
    [2, UNAVAILABLE_ROW]
  ] as const) {
    await expect(rows.nth(index)).toContainText(label)
    await expect(rows.nth(index)).toContainText(UNAVAILABLE_NOTE)
    await expect(rows.nth(index)).toHaveAttribute('aria-disabled', 'true')
  }

  // A forced click (the first test's reason) and an Enter on a greyed row both leave the panel open and
  // send nothing. Compact session is the row the published menu names, so it is the sharper one to pick.
  const compact = panel.getByRole('menuitem', { name: AVAILABLE_ROW })
  await compact.click({ force: true })
  await expect(panel).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(compact).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  expect(sent).toHaveLength(0)
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(0)
})
