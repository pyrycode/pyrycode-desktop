import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// #969 — the message bubble's meta row and its copy control, proved in the one tier that can. Renderer
// tests are static server renders under `environment: 'node'` with no DOM, no stylesheet and no click
// (vitest.config.ts), so ConversationScreen.test.tsx pins the markup — which rows carry the row, where
// in the bubble it sits, what the control is as an element — and everything below it here is what only
// a running browser can answer:
//
//   1. THE MEASUREMENT THIS SPEC EXISTS FOR. src/main/index.ts installs a setPermissionRequestHandler
//      that denies EVERY renderer permission request unconditionally, and Electron routes
//      `clipboard-sanitized-write` through that handler. Whether Chromium issues a request at all for a
//      user-gesture navigator.clipboard.writeText in a focused window — or grants it at the
//      content-settings layer without ever asking — decides whether this ticket is renderer-only or has
//      to narrow that handler. Nothing short of the built app answers it, and a wrong guess ships a
//      control that silently does nothing.
//   2. The click and the keyboard activation, neither of which exists in the unit tier.
//   3. The restyle's geometry: 6px on all four corners, the drawn 16/20 padding, and the meta row's two
//      alignments. Read as computed style rather than pixel-compared against the Figma — the sibling
//      specs' idiom (assistant-whitespace.spec.ts).
//
// THE CLIPBOARD READ-BACK GOES THROUGH THE MAIN PROCESS, never navigator.clipboard.readText: reading is
// a categorically different permission from writing, the handler denies it, and this ticket must not
// depend on it being granted. Electron's own `clipboard` module in the main process is outside the
// renderer permission model entirely, so `app.evaluate` reads the real OS clipboard directly — which is
// also what makes this a genuine end-to-end proof rather than a renderer-side self-report.
//
// SIDE EFFECT, ACCEPTED: this spec overwrites the machine's clipboard with its own non-secret literals.
// That is inherent to proving a copy control end to end. It deliberately does NOT read the prior
// contents in order to restore them — the clipboard routinely holds a password-manager secret, and
// pulling that into a test process (where a failure diagnostic could serialise it) is a worse trade
// than the annoyance of a clobbered clipboard.
//
// SECRET HYGIENE (the sibling specs' standing rule): every literal below is a non-secret display string
// and every assertion reads text, computed style or a clipboard round-trip of those same literals. The
// pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never echoed.

// A real send → Noise → decode → render round-trip, then a real OS clipboard write; generous headroom
// for a cold runner (the sibling specs' value).
const ROUND_TRIP_TIMEOUT_MS = 15_000

// The reply carries MARKDOWN SOURCE, not a plain line, because that is what AC3 distinguishes: the
// control must copy the string the daemon sent, not the DOM AssistantMarkdown renders it into. A
// heading and a fenced block are the two constructs whose rendered text differs most from their source
// — `# ` and the fences vanish from the DOM entirely — so a control that scraped textContent would fail
// this assertion while passing a plain-text one. Built with join('\n'), never an indented template
// literal, which CommonMark would read as an indented code block (the unit tier's fixture lesson).
const REPLY_SOURCE = ['# Heading', '', 'A settled reply.', '', '```ts', 'const x = 1', '```'].join('\n')
const TYPED_TEXT = 'hello from the composer'
// Not a substring of either message, so a stale read cannot be mistaken for a successful copy.
const CLIPBOARD_SENTINEL = 'sentinel-before-any-copy'

const FIXED_TS = '2026-07-07T12:00:00.000Z'
const TURN_ID = 'turn-1'

// The [assistant_delta, turn_end] pair send-and-stream.spec.ts uses: every pushed frame is one a real
// daemon produces, and turn_end SETTLES the bubble so it renders through the markdown path — the branch
// whose copy source differs from its rendered text.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      return [
        encodeEnvelope({
          id: 99,
          type: 'assistant_delta',
          ts: FIXED_TS,
          payload: {
            conversation_id: SEEDED_ROW.id,
            turn_id: TURN_ID,
            seq: 0,
            text: REPLY_SOURCE
          } satisfies AssistantDeltaPayload
        }),
        encodeEnvelope({
          id: 100,
          type: 'turn_end',
          ts: FIXED_TS,
          payload: {
            conversation_id: SEEDED_ROW.id,
            turn_id: TURN_ID,
            stop_reason: 'end_turn'
          } satisfies TurnEndPayload
        })
      ]
    }
    default:
      return [seedConversationsFrame()]
  }
}

test('copies a message to the OS clipboard by pointer and by keyboard, and draws the redrawn bubble', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  // Seed a known value so a no-op control cannot pass by leaving something plausible behind.
  await app.evaluate(({ clipboard }, seed) => clipboard.writeText(seed), CLIPBOARD_SENTINEL)

  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()

  const assistantBubble = page.locator('.bubble[data-thread-role="assistant"]')
  const userBubble = page.locator('.bubble[data-thread-role="user"]')
  await expect(assistantBubble.locator('.bubble__markdown')).toBeVisible({
    timeout: ROUND_TRIP_TIMEOUT_MS
  })

  // --- 1. The measurement + the pointer path (AC3). If the blanket permission denial reaches
  // clipboard-sanitized-write, this is where it shows: the write is refused, the clipboard still holds
  // the sentinel, and the ticket takes its branch-2 handler narrowing. ---
  await assistantBubble.locator('..').getByRole('button', { name: 'Copy message' }).click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), {
      timeout: ROUND_TRIP_TIMEOUT_MS
    })
    .toBe(REPLY_SOURCE)

  // --- 2. The keyboard path (AC3). A real <button> is focusable and Enter-activated with no key
  // handler of our own, which is exactly the claim: focus it, press Enter, and the USER message
  // replaces the assistant one on the clipboard. Distinct texts make the swap unambiguous. ---
  const userCopy = userBubble.locator('..').getByRole('button', { name: 'Copy message' })
  await userCopy.focus()
  await expect(userCopy).toBeFocused()
  await page.keyboard.press('Enter')
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), {
      timeout: ROUND_TRIP_TIMEOUT_MS
    })
    .toBe(TYPED_TEXT)

  // --- 2b. THE ALLOWLIST IS STILL AN ALLOWLIST. #969 opened src/main/index.ts's permission handler for
  // the first time, from an unconditional deny to exactly one permission. This is the guard on the
  // other half of that line: a permission NOT on the list must still come back denied, so the handler
  // can never quietly become "grant what the renderer asks for". Notifications is the probe because it
  // routes through the same request handler, resolves rather than throwing, and the app needs it as
  // little as it needs the camera — the same argument covers `clipboard-read`, which the identity
  // comparison denies for exactly this reason and which nothing here may ever grant. ---
  const notifications = await page.evaluate(() => Notification.requestPermission())
  expect(notifications).toBe('denied')

  // --- 3. The redraw's geometry (AC1). Computed style, read the way the sibling specs read it. The
  // radius is asserted as one uniform value across all four corners — the shape change from the mobile
  // bubble's mirrored clipped corner — and the padding as the drawn 16/20. ---
  const box = await assistantBubble.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius
      ],
      paddingBlock: [style.paddingTop, style.paddingBottom],
      paddingInline: [style.paddingLeft, style.paddingRight]
    }
  })
  expect(box.radii).toEqual(['6px', '6px', '6px', '6px'])
  expect(box.paddingBlock).toEqual(['16px', '16px'])
  expect(box.paddingInline).toEqual(['20px', '20px'])

  // --- 4. The meta row's two alignments (AC2): the drawing gives the user variant `justify-end` and the
  // assistant variant none. Read as computed style because the difference is a single declaration on a
  // modifier the unit tier can only see as a class name. ---
  const justify = (bubble: typeof assistantBubble): Promise<string> =>
    bubble.locator('.bubble__meta').evaluate((el) => getComputedStyle(el).justifyContent)
  expect(await justify(userBubble)).toBe('flex-end')
  expect(await justify(assistantBubble)).not.toBe('flex-end')

  // --- 5. The row sits at the FOOT of the bubble, below the content (AC2). The unit tier proves it in
  // markup order; this proves the browser lays it out there, which is what the drawing actually says. ---
  const laidOutAtFoot = await assistantBubble.evaluate((el) => {
    const content = el.querySelector('.bubble__markdown')
    const meta = el.querySelector('.bubble__meta')
    if (content === null || meta === null) return false
    return meta.getBoundingClientRect().top >= content.getBoundingClientRect().bottom
  })
  expect(laidOutAtFoot).toBe(true)
})
