import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// Clicking an allowed link opens it in the OS browser (#610 AC3) — the one criterion of that ticket no
// server-render test can express. The unit tier (AssistantMarkdown.test.tsx) owns the allowlist itself,
// because both allow and deny are properties of the emitted markup; what it structurally cannot reach is
// what a CLICK does, which needs a real Chromium, a real BrowserWindow and the main process's
// setWindowOpenHandler all present at once.
//
// That handler (src/main/index.ts:56) is the entire click mechanism, and the renderer's only lever on it
// is the anchor's `target="_blank"`: a plain anchor is a same-document navigation that will-navigate
// (:79) cancels, so the link would render correctly and silently do NOTHING. That failure is invisible to
// every other tier — the markup is identical apart from that one attribute — which is what this spec
// exists to catch. VERIFIED BY MUTATION: with `target="_blank"` removed from the override, the positive
// control below still passes (the anchor and its href are unchanged) and the test then fails at the
// click, which hangs on the cancelled same-document navigation and never reaches a recorded URL.
//
// THE SHELL CALL IS STUBBED BEFORE THE CLICK, non-negotiably: the real shell.openExternal launches the
// operator's browser, so an unstubbed run pops a window open on every execution. The stub is installed in
// the MAIN process through the same `app.evaluate` idiom window-reopen-converges.spec.ts:58 uses, and it
// records rather than suppresses, so what is asserted is the URL the app actually handed to the OS.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads DOM attributes, a window count, a
// document URL, or the recorded link — all non-secret display/routing literals. The pairing plumbing
// (synthetic token, fake static key) lives in launchPairedApp and is never echoed; no failure diagnostic
// serialises a token, key or plaintext.

// The reply travels a real send → Noise → decode → render round trip; the siblings' headroom for a cold
// runner.
const STREAM_TIMEOUT_MS = 15_000

// The click leaves the renderer, crosses to the main process's window-open handler and lands in the stub;
// generous, since a failure here means the feature is broken rather than slow.
const OPEN_TIMEOUT_MS = 10_000

// Fixed literals, the fakeDaemon convention (no Date.now(), no randomness). The URL is a documentation
// host that is never dialed — the anchor is clicked, but shell.openExternal is stubbed and the handler
// denies the in-app window, so nothing in this run resolves or fetches it.
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const TURN_ID = 'turn-1'
const LINK_URL = 'https://link.example/target'
const LINK_TEXT = 'the link'
// Markdown link syntax, so the anchor can only exist if AssistantMarkdown's `a` override built it. The
// surrounding prose keeps the fixture a real reply rather than a bare URL, and its text differs from the
// link text so a locator can never confuse the two.
const REPLY_TEXT = `Follow [${LINK_TEXT}](${LINK_URL}) for the details.`
const TYPED_TEXT = 'hello from the composer'

const assistantDeltaFrame = (): Uint8Array =>
  encodeEnvelope({
    id: 99,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: TURN_ID,
      seq: 0,
      text: REPLY_TEXT
    } satisfies AssistantDeltaPayload
  })

// The turn_end is load-bearing here, not framing: a still-growing reply renders as plain text, and only a
// SETTLED one renders through .bubble__markdown — so without this frame there is no anchor to click.
const turnEndFrame = (): Uint8Array =>
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

// The send-and-stream shape: `send_message` → the ordered [assistant_delta, turn_end] stream; every other
// inbound (the auto-fired `list_conversations`) → the shared one-row seed, since a scripted
// buildReplyFrames overrides the fixture's default arm. The #448 guard rides along — the send arm answers
// only the OPENED row's conversation_id, so a client regression to a placeholder id gets no frames and the
// positive control times out, mirroring the real daemon's rejection.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      return [assistantDeltaFrame(), turnEndFrame()]
    }
    default:
      return [seedConversationsFrame()]
  }
}

// The main-process global the stub records into. A property on globalThis rather than a closure variable,
// because each app.evaluate call runs its own function in that process and shares nothing else.
const RECORDER_KEY = '__pyryOpenedExternally'

test('clicking a link in an assistant reply opens it in the OS browser', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp({ buildReplyFrames })

  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()

  // POSITIVE CONTROL, per window-reopen-converges.spec.ts. Without it a "nothing opened" failure could not
  // be told apart from a reply that never rendered a link at all — and the deny-first rendering this
  // ticket replaced produced exactly that: the visible text, no anchor.
  const anchor = page.locator('.bubble__markdown a')
  await expect(anchor).toHaveAttribute('href', LINK_URL, { timeout: STREAM_TIMEOUT_MS })
  await expect(anchor).toHaveText(LINK_TEXT)

  // Stub shell.openExternal in the main process, recording the URL instead of launching a browser.
  // defineProperty rather than a plain assignment: it succeeds against a data property and an accessor
  // alike, and `configurable: true` leaves the stub itself replaceable. The app reads
  // `shell.openExternal` at call time (index.ts:64), so the patched property is what it reaches.
  await app.evaluate(({ shell }, key) => {
    const recorded: string[] = []
    ;(globalThis as unknown as Record<string, string[]>)[key] = recorded
    Object.defineProperty(shell, 'openExternal', {
      value: (url: string) => {
        recorded.push(url)
        return Promise.resolve()
      },
      configurable: true,
      writable: true
    })
  }, RECORDER_KEY)

  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const documentUrlBefore = page.url()

  await anchor.click()

  // AC3's first half: that exact URL reached the OS browser path. Polled, because the click crosses from
  // the renderer into the main process and the assertion reads the far side.
  await expect
    .poll(
      () =>
        app.evaluate(
          (_electron, key) => (globalThis as unknown as Record<string, string[]>)[key] ?? [],
          RECORDER_KEY
        ),
      { timeout: OPEN_TIMEOUT_MS }
    )
    .toEqual([LINK_URL])

  // AC3's second half, and the reason `{ action: 'deny' }` is returned on the handler's ALLOWED path too:
  // the URL goes to the OS browser and no in-app window is constructed for it, so remote content is never
  // loaded into any renderer. A regression to `{ action: 'allow' }` fails here and nowhere else.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
    windowsBefore
  )
  // ...and the app window itself did not navigate. The composer still being on screen is the product-level
  // reading of the same claim: a navigated window loses the whole React app.
  expect(page.url()).toBe(documentUrlBefore)
  await expect(page.getByPlaceholder('Message…')).toBeVisible()
})
