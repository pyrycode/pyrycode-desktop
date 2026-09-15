import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  BackgroundTask,
  ConversationSummary,
  EnvelopeType
} from '../src/shared/wire/types'

// #569: the reconnect reconciliation for background-task rosters, proved through the real transport.
//
// The daemon half landed upstream (pyrycode#2077-#2080): on any (re)connection it unicasts one
// `background_task_roster` for EVERY conversation whose bound session has reported one — snapshot-shaped,
// match-and-replace on `conversation_id`, safe to re-apply on every connect. The desktop side needed no
// code change for it: `setRoster` is unconditional replacement truth for a conversation's membership, so
// a connect-time re-send applies idempotently by construction, and `selectRosterFor` already keeps "no
// frame has ever arrived" (`null`) apart from "observed, nothing alive" (a present, empty entry).
//
// WHAT WAS NOT PROVED, and is the whole subject of this spec: that the `connected` clear and the
// re-assertion land in THAT ORDER. `subscribeBackgroundTaskRoster`'s `connected` branch drops the
// reconnecting server's held rosters, and a reconciled roster applied AHEAD of that clear would be wiped
// by it — leaving the panel reading "No background-task report yet" while work was alive, with no error
// and no failing unit test. The argument is available by reading (`daemonConnection` emits `connected`
// from its `handshake-complete` arm and inbound frames arrive as `message` through the same synchronous
// sink), but the daemon reconciles off its own handshake tail, which is a different clock. So it is
// proved here rather than read.
//
// THE TWO ASSERTIONS THAT TOGETHER PIN THE ORDER, since neither does it alone:
//   - the SILENT conversation reading "No background-task report yet" proves the clear RAN — it held a
//     task before the drop and the burst says nothing about it;
//   - the re-asserted conversation still listing its task proves the clear ran FIRST — had it run last,
//     that conversation would read "No background-task report yet" too.
// The stale task vanishing is replacement truth, not ordering, and is asserted as its own criterion.
//
// WHY PLAYWRIGHT AND NOT VITEST. `vitest.config.ts` sets `environment: 'node'` and every renderer spec
// renders through `renderToStaticMarkup` — no DOM, no effects, no clicks — so the unit tier cannot drive a
// handshake, a socket drop, or a panel open. The subject here IS an ordering through the real transport,
// which no store-level fake can observe: the store's own unit tests drive `resetRostersFor` and
// `setRoster` in whatever order they choose, which is precisely the question.
//
// NO `needs-real-claude`. A live claude cannot be made to start a background task and then lose its
// connection on cue, so the fake-transport tier is what can actually prove these criteria; pyrycode#2080
// already proved the daemon half against a real session.
//
// SECRET HYGIENE (the sibling specs' rule). Every task field below is a CLIENT-OWNED SYNTHETIC LITERAL
// declared in this file — never a real command line, never anything from the pairing plumbing — so a
// Playwright failure diff printing an expected/actual string discloses nothing. That matters more here
// than in most specs: a roster row's `description` is, for `taskType: local_bash`, the literal command
// line claude ran, and the panel is where it is rendered. Assertions read DOM text, counts and classes.

// The harness is #416's, reused verbatim rather than extended: `reconnectResendFrames` re-seals ordered
// plaintexts under the NEW send cipher and streams them right after the reconnect `hello_ack`, which is
// the reconcile burst's shape exactly, and `dropClientLeg()` forces a genuine reconnect.
// `permission-modal-answer-paths.spec.ts` is the working example of the pair.
//
// NOTE THE ABSENT `event_id`. A reconciled frame deliberately carries none — it is kept out of the
// daemon's replay ring — and this helper omits it, so the spec pins that its absence is not malformedness.
// `Envelope.event_id` is optional and no decode branch or store setter reads it.
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 569, type, ts: '2026-09-15T09:00:00Z', payload, in_reply_to })

/** One roster snapshot. `dropped_tasks` is a VALUE and always present (the daemon's field has no
 *  `omitempty`); `tasks: []` is the positive statement that nothing is alive, never "no news". */
const roster = (conversation_id: string, tasks: BackgroundTask[]): Uint8Array =>
  frame('background_task_roster', { conversation_id, tasks, dropped_tasks: 0 })

/** One roster row. `truncated_fields: null` means nothing was cut and is a distinct value from `[]` — the
 *  one nullable field on this row, and not the same shape as the payload's non-nullable `tasks`. */
const task = (task_id: string, description: string): BackgroundTask => ({
  task_id,
  task_type: 'local_bash',
  description,
  truncated_fields: null
})

// The three synthetic descriptions. Mutually non-substring, because the assertions below pair a
// `toContainText` with a `not.toContainText` and a containment between two of them would make one of the
// pair vacuous.
const STALE = 'stale roster entry dropped at reconnect'
const LIVE = 'live roster entry reasserted at connect'
const QUIET_HELD = 'held by the quiet room before the drop'
const UNREPORTED_HELD = 'held by the unreported topic before the drop'

// Two more rows beside the fixture's seeded one, sharing its `cwd` so all three land in the same
// workspace group (which mounts expanded, so every row is clickable). Their `name`s share NO SUBSTRING
// with the seeded row's or each other's: Playwright's `hasText` is a case-insensitive SUBSTRING match, so
// an overlapping name would make one row filter select two rows — the trap `SECOND_SEEDED_ROW` documents,
// measured there rather than guessed.
const QUIET: ConversationSummary = { ...SEEDED_ROW, id: 'reconnect-quiet', name: 'Quiet room' }
const UNREPORTED: ConversationSummary = {
  ...SEEDED_ROW,
  id: 'reconnect-unreported',
  name: 'Unreported topic'
}

// The reconnect is a real handshake over loopback behind the supervisor's backoff, so the post-drop waits
// need headroom over Playwright's 5s default (the siblings' value).
const RECONNECT_TIMEOUT_MS = 20_000

/**
 * A daemon script that answers the two requests the drive provokes and nothing else. `rows` is read LIVE
 * on each call rather than captured by value, because the reconnect's own `connected` edge re-fires
 * `list_conversations` — the reply must carry all three rows by then, not the one the fixture seeded with.
 *
 * `request_history` is answered with an empty page rather than ignored, for a reason that bears on an
 * assertion below: an unanswered history request leaves a failure in the composer status slot, and that
 * slot resolves `recovery ?? refusal ?? notice ?? history ?? taskCount` — a history occupant would hide
 * the background-task pill this spec uses as its reconnect gate.
 */
function fake(rows: ConversationSummary[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations: rows })]
    if (env.type === 'request_history') {
      return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
    }
    return []
  }
}

const rowFor = (page: Page, name: string): Locator =>
  page.locator('.channel-list__row').filter({ hasText: name })
const openChat = async (page: Page, name: string): Promise<void> => {
  await rowFor(page, name).locator('.channel-list__row-open').click()
  await expect(rowFor(page, name).locator('.channel-list__row-open')).toHaveAttribute(
    'aria-current',
    'true'
  )
}

const panelFor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Background tasks', exact: true })
/** The operator's own route to the panel: the thread overflow menu. `exact` on both — `getByRole` matches
 *  `name` as a case-insensitive SUBSTRING and the composer's own trigger one region down reads `Actions`,
 *  which a non-exact `More actions` would not collide with but a non-exact `Actions` certainly would. */
const openPanel = async (page: Page): Promise<Locator> => {
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  return panel
}
/** Closed by the panel's own button rather than Escape: only one sheet is ever open here, but the composer
 *  also listens for Escape (the interrupt path), and a close that could be served by two handlers is not
 *  the thing to lean on when the next assertion depends on the panel being gone. */
const closePanel = async (page: Page): Promise<void> => {
  await panelFor(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panelFor(page)).toHaveCount(0)
}

test('a reconnect re-asserted roster survives the connected clear and the two silences stay apart', async ({
  launchPairedApp
}) => {
  test.setTimeout(90_000)
  const rows: ConversationSummary[] = [SEEDED_ROW]
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: fake(rows),
    // THE RECONCILE BURST. Ordered, but order is immaterial by contract: the daemon walks its registry in
    // insertion order and that order is not a contract, so the client correlates by `conversation_id` and
    // never by position. The two silences are expressed here and must not be collapsed —
    //   QUIET      → an EXPLICIT EMPTY snapshot: "observed, nothing alive".
    //   UNREPORTED → deliberately ABSENT: "nothing has been reported", which is NOT "nothing is alive".
    reconnectResendFrames: [
      roster(QUIET.id, []),
      roster(SEEDED_ROW.id, [task('task-live', LIVE)])
    ]
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  rows.push(QUIET, UNREPORTED)
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  await expect(rowFor(page, QUIET.name!).locator('.channel-list__row-open')).toBeVisible()
  await expect(rowFor(page, UNREPORTED.name!).locator('.channel-list__row-open')).toBeVisible()

  // Every one of the three holds a roster BEFORE the drop, so "neither shows the pre-disconnect list"
  // below is a statement about something that was genuinely there.
  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-stale', STALE), task('task-live', LIVE)]))
  daemon.pushFrame(roster(QUIET.id, [task('task-quiet', QUIET_HELD)]))
  daemon.pushFrame(roster(UNREPORTED.id, [task('task-unreported', UNREPORTED_HELD)]))

  // The footer pill is the reconnect gate, and it carries its own evidence. It is gated on
  // `status.type === 'connected'`, so it is hidden while disconnected; and it reads the TRUE roster size
  // (`tasks.size + droppedTasks`), so 2 → 1 is the membership replacement in one observation.
  const pill = page.locator('.composer-status__tasks')
  await expect(pill).toHaveText('2 tasks running')

  const panel = await openPanel(page)
  await expect(panel.locator('.background-task-panel__row')).toHaveCount(2)
  await expect(panel).toContainText(STALE)
  await expect(panel).toContainText(LIVE)
  await closePanel(page)

  // AC4's baseline, captured rather than hardcoded. `.conversation__thread` is present even at zero
  // timeline items (the empty-state placeholder renders inside it — measured, not assumed), so the honest
  // "nothing was added" reading is the container's CHILD COUNT compared against itself across the
  // reconnect, plus the zero bubble count asserted beside it so the baseline cannot already be nonzero and
  // hide a later addition.
  const threadRows = page.locator('[data-thread-role]')
  const threadItems = page.locator('.conversation__thread > *')
  await expect(page.locator('.conversation__empty')).toBeVisible()
  await expect(threadRows).toHaveCount(0)
  const threadItemsBefore = await threadItems.count()

  forwarder.dropClientLeg()

  // AC1. The pill coming back at ONE task is the reconnect gate and the first half of the ordering proof:
  // had the `connected` clear run AFTER the burst, this conversation would hold nothing and the pill would
  // be absent entirely rather than showing a task.
  await expect(pill).toHaveText('1 task running', { timeout: RECONNECT_TIMEOUT_MS })

  // AC1 + AC2 at row level: the re-asserted task is listed, and the one the burst does not name is gone
  // rather than carried over as though still live.
  const afterReconnect = await openPanel(page)
  await expect(afterReconnect.locator('.background-task-panel__row')).toHaveCount(1)
  await expect(afterReconnect).toContainText(LIVE)
  await expect(afterReconnect).not.toContainText(STALE)
  await closePanel(page)

  // AC4. Nothing the reconciliation carried reached the chat timeline — these frames carry no `turn_id`
  // and never enter the timeline reducer, so the empty thread must still be empty and the container must
  // hold exactly what it held before.
  await expect(page.locator('.conversation__empty')).toBeVisible()
  await expect(threadRows).toHaveCount(0)
  await expect(threadItems).toHaveCount(threadItemsBefore)

  // AC3, first silence: re-asserted with an EXPLICIT EMPTY roster → "observed, nothing alive". Asserted by
  // CLASS as well as by copy, because the class is what the store's three-way reading actually selects;
  // the two sentences happen to be substring-independent, but a collapse would be a class-level bug.
  await openChat(page, QUIET.name!)
  const quietPanel = await openPanel(page)
  await expect(quietPanel.locator('.background-task-panel__empty')).toHaveText('No background tasks')
  await expect(quietPanel.locator('.background-task-panel__unobserved')).toHaveCount(0)
  await expect(quietPanel).not.toContainText(QUIET_HELD)
  await closePanel(page)

  // AC3, second silence — and the OTHER half of the ordering proof. This conversation held a task before
  // the drop and the burst says nothing about it, so reading "No background-task report yet" is what shows
  // the `connected` clear ran at all. Absence from the burst means "nothing has been reported", never
  // "nothing is alive", so it must NOT read as the observed-empty conversation above.
  await openChat(page, UNREPORTED.name!)
  const unreportedPanel = await openPanel(page)
  await expect(unreportedPanel.locator('.background-task-panel__unobserved')).toHaveText(
    'No background-task report yet'
  )
  await expect(unreportedPanel.locator('.background-task-panel__empty')).toHaveCount(0)
  await expect(unreportedPanel).not.toContainText(UNREPORTED_HELD)
})
