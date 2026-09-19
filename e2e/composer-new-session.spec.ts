import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type {
  NewSessionPayload,
  ResettingPayload,
  SessionTransitionPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1218 — the Actions menu's Reset session row, the only entry in that menu that is
// not a slash command and, since #1496, the conversation's only reset path. Picking it dispatches a
// `new_session` control frame asking the daemon to kill claude and spawn a fresh one in the open
// conversation. It shipped as `New session (restarts claude)` beside a `/clear` row that carried the
// Reset session label; the fold dropped that row and gave this one its words. The two slash rows that
// remain are e2e/composer-actions.spec.ts's, which this spec deliberately does not restate.
//
// WHY IT HAS TO BE PLAYWRIGHT. vitest runs the `node` environment (vitest.config.ts): every renderer test
// is a renderToStaticMarkup string assertion with no DOM, no effects and no click handlers.
// ComposerActionsMenu.test.tsx pins the row's presence, its words and the property that keeps it out of
// the availability path; sendNewSession.test.ts pins what the helper does with a null, an empty and a
// real id. Only a real window can prove that PICKING the row reaches the wire as a control frame rather
// than as message text.
//
// THE DAEMON ANSWERS THIS FRAME WITH NOTHING AT ALL — not even an error — so AC4 has two arms and both
// are here, one per test. They are a MATCHED PAIR and neither is worth much alone: the first asserts that
// a silent daemon draws no delimiter and surfaces no error, and that assertion is only non-vacuous
// because the second proves this same drive DOES draw exactly one when a `session_transition` arrives.
// Delete either and the other stops meaning anything.
//
// ONE launch per test: each pays a full handshake, but the two arms differ in what the daemon does, and
// a single continuous drive cannot un-draw a delimiter to test the silent case afterwards.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, values and
// counts, plus the decoded outbound's `conversation_id` — a routing id this app already holds, not a
// secret. No failure diagnostic serialises a token, a key or plaintext; the pairing plumbing lives in
// launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; short headroom over
// Playwright's 5s default for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes pushes
// by envelope id, so one fixed id is reused across every frame.
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-09-07T12:00:00.000Z'

// Client-owned labels, duplicated as literals rather than imported — the ~15 `Send` locators' convention.
// THEY ARE LOAD-BEARING LOCATORS: rewording one in ComposerActionsMenu.tsx without updating this spec
// breaks it, which is the point. `exact: true` on the trigger for composer-actions.spec.ts's measured
// reason — getByRole matches `name` as a case-insensitive SUBSTRING, and the thread overflow trigger one
// region up reads `More actions`.
const ACTIONS_LABEL = 'Actions'
const NEW_SESSION_ROW = 'Reset session'

const actionsTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: ACTIONS_LABEL, exact: true })
const actionsPanel = (page: Page): Locator =>
  page.getByRole('menu', { name: ACTIONS_LABEL, exact: true })

/**
 * A daemon script that CAPTURES the decoded outbound instead of answering it, the composer-actions.spec.ts
 * factory with one arm added. Both kinds of outbound are captured, because AC2 is as much about what does
 * NOT go out as about what does: a `new_session` that also posted the row's label down the message path
 * would satisfy a one-sided capture.
 *
 * `new_session` → `[]`, and that is the REAL daemon's behaviour rather than a convenience: this frame is
 * answered with nothing at all. `send_message` → `[]` too, so a stray one is captured rather than
 * provoking a reply. Every other inbound (the auto-fired `list_conversations`) → the shared one-row seed,
 * since a scripted buildReplyFrames overrides the fixture's default arm.
 *
 * A factory rather than module-level arrays, so no test can see another's captures. The `as` casts are
 * the send-and-stream.spec.ts idiom: the `case` already narrowed the envelope type, and this is a test.
 */
function captureOutbound(): {
  newSessions: NewSessionPayload[]
  messages: unknown[]
  buildReplyFrames: (inbound: Uint8Array) => Uint8Array[]
} {
  const newSessions: NewSessionPayload[] = []
  const messages: unknown[] = []
  return {
    newSessions,
    messages,
    buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(inbound)
      switch (envelope.type) {
        case 'new_session':
          newSessions.push(envelope.payload as NewSessionPayload)
          return []
        case 'send_message':
          messages.push(envelope.payload)
          return []
        default:
          return [seedConversationsFrame()]
      }
    }
  }
}

/** The daemon's answer when it DOES have a child to rotate — the marker rendered as `.session-delimiter`,
 *  thread-shadow.spec.ts's builder with this ticket's conversation. `reason` is the daemon's own word for
 *  the rotation and the delimiter does not branch on which of the three it is; `workspace_cwd` is literal
 *  null for every reason but `workspace_change`. `conversation_id` names the seeded row because that is
 *  the chat this drive has open — a frame without it fails the decode and draws nothing at all (#1192). */
const sessionTransitionFrame = (): Uint8Array =>
  encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'session_transition',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      previous_session_id: 'session-1218-a',
      new_session_id: 'session-1218-b',
      reason: 'clear',
      occurred_at: FIXED_TS,
      workspace_cwd: null
    } satisfies SessionTransitionPayload
  })

const resettingFrame = (
  active: boolean,
  phase: ResettingPayload['phase'],
  handoff: ResettingPayload['handoff']
): Uint8Array =>
  encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'resetting',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, active, phase, handoff } satisfies ResettingPayload
  })

test('picking Reset session sends one new_session naming the open chat, and nothing else (AC2, AC4)', async ({
  launchPairedApp
}) => {
  const { newSessions, messages, buildReplyFrames } = captureOutbound()
  const { page } = await launchPairedApp({ buildReplyFrames })

  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  await panel.getByRole('menuitem', { name: NEW_SESSION_ROW }).click()
  await expect(panel).toBeHidden()

  // THE POSITIVE READ COMES FIRST, and it is the ordering anchor for every negative below. A captured
  // envelope means the whole renderer → preload → main → router → Noise → loopback path has completed for
  // this click, so anything the click was going to do to the window has already happened. The frame names
  // the OPEN conversation — the fixture navigates by clicking the single seeded row, so that is the chat
  // on screen — which is the difference between restarting this claude and restarting whichever
  // conversation the daemon's process-wide follow-active cursor points at.
  await expect.poll(() => newSessions.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(newSessions[0]).toEqual({ conversation_id: SEEDED_ROW.id })

  // NOTHING TRAVELLED THE MESSAGE PATH (AC2). The row's id is not a slash command, so routing it through
  // the path the two slash rows take would have sent the literal string as prose to claude — the exact
  // mistake this menu's second kind of entry exists to prevent, and the one #1496 had to keep true while
  // giving this row the label the message-text row used to wear. Three independent readings of it: no
  // outbound message, no user bubble in the thread, and no text left in the message box.
  expect(messages).toHaveLength(0)
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(0)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('')

  // AC4's FIRST ARM: the never-messaged conversation, where the daemon has no child to rotate and answers
  // with nothing. Nothing is drawn and no error surfaces — the honest outcome for a fire-and-forget verb
  // that answers no question. This is a negative with no event to await, which is why it sits after the
  // capture above; the second test is what proves it is not vacuous.
  await expect(page.locator('.session-delimiter')).toHaveCount(0)
  await expect(page.locator('[role="alert"]')).toHaveCount(0)
})

test('reset phases reach the composer and session_transition clears the label with one delimiter', async ({
  launchPairedApp
}) => {
  const { newSessions, buildReplyFrames } = captureOutbound()
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  await actionsTrigger(page).click()
  await actionsPanel(page).getByRole('menuitem', { name: NEW_SESSION_ROW }).click()

  // Gate on the restart having reached the wire before answering it, so the marker is the answer to this
  // drive's own frame rather than a push that raced it.
  await expect.poll(() => newSessions.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)

  // Exercise the full wire → IPC → keyed timeline → mounted composer path. The live gate's
  // old daemon rotated the session without emitting these frames; a delimiter alone cannot
  // prove the label path works.
  const statusLabel = page.locator('.composer-status .conversation__thinking')
  daemon.pushFrame(resettingFrame(true, 'wrapping_up', 'pending'))
  await expect(statusLabel).toHaveText('Resetting: writing the handoff note…')
  daemon.pushFrame(resettingFrame(true, 'restarting', 'written'))
  await expect(statusLabel).toHaveText('Resetting: restarting claude… handoff note written')

  // The daemon's answer when it DOES have a child to rotate. It is a SERVER PUSH — the real daemon emits
  // this marker unprovoked on the inbound path rather than as a reply to the frame — so it goes out
  // through daemon.pushFrame rather than through buildReplyFrames, which only answers outbound envelopes.
  daemon.pushFrame(sessionTransitionFrame())

  // EXACTLY ONE, in the open thread. One is the whole assertion: a restart is one boundary, and a count
  // that could drift to two would mean the marker was filed twice.
  await expect(page.locator('.session-delimiter')).toHaveCount(1, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(statusLabel).toHaveCount(0)
})

test('reset labels keep one-line geometry beside the trailing error chip at minimum width', async ({
  launchPairedApp
}, testInfo) => {
  const { page, app, daemon } = await launchPairedApp()
  const row = page.locator('.composer-status')
  const label = row.locator('.composer-status__label')
  const chip = row.locator('.composer-status__error')
  const composer = page.locator('.composer__row')
  const states: Array<{ phase: ResettingPayload['phase']; handoff: ResettingPayload['handoff']; copy: string }> = [
    { phase: 'restarting', handoff: 'written', copy: 'Resetting: restarting claude… handoff note written' },
    { phase: 'restarting', handoff: 'skipped', copy: 'Resetting: restarting claude… handoff note skipped' },
    { phase: 'wrapping_up', handoff: 'pending', copy: 'Resetting: writing the handoff note…' }
  ]

  for (const trailing of [false, true]) {
    if (trailing) {
      // Keep the fake transport live so reset frames still use the decoder. Only the connection
      // failure is injected at the preload boundary, as in stopped-turn.spec.ts.
      await app.evaluate(({ BrowserWindow }, channel) => {
        BrowserWindow.getAllWindows()[0].webContents.send(channel, {
          type: 'failed', serverId: 'fake-daemon',
          error: { code: 'transport', message: '', retryable: true }
        })
      }, DAEMON_EVENT_CHANNEL)
    }
    await expect(chip).toHaveCount(trailing ? 1 : 0)
    for (const width of [800, 1280]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setSize(width, 600)
      }, width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect(label).toHaveCount(0)
      const idleRow = await row.boundingBox()
      const idleComposer = await composer.boundingBox()
      expect(idleRow?.height).toBe(24)

      for (const { phase, handoff, copy } of states) {
        daemon.pushFrame(resettingFrame(true, phase, handoff))
        await expect(label).toHaveText(copy)
        expect((await row.boundingBox())?.height).toBe(idleRow?.height)
        expect((await composer.boundingBox())?.y).toBe(idleComposer?.y)
        await expect(label).toHaveCSS('white-space', 'nowrap')
        await expect(label).toHaveCSS('text-overflow', 'ellipsis')
        await expect(label).toHaveCSS('overflow', 'hidden')
        const bounds = await label.evaluate(el => {
          const rect = el.getBoundingClientRect()
          const activity = el.parentElement!.getBoundingClientRect()
          return {
            height: rect.height,
            lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
            contained: rect.left >= activity.left && rect.right <= activity.right,
            truncated: el.scrollWidth > el.clientWidth,
            singleTextNode: el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE
          }
        })
        expect(bounds.height).toBe(bounds.lineHeight)
        expect(bounds.contained).toBe(true)
        expect(bounds.singleTextNode).toBe(true)
        if (width === 800 && trailing) expect(bounds.truncated).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(`reset-${width}-${trailing ? 'error' : 'empty'}-${handoff}.png`),
          animations: 'disabled'
        })
      }
      daemon.pushFrame(resettingFrame(false, '', ''))
      await expect(label).toHaveCount(0)
      expect((await row.boundingBox())?.height).toBe(idleRow?.height)
      expect((await composer.boundingBox())?.y).toBe(idleComposer?.y)
    }
  }
})
