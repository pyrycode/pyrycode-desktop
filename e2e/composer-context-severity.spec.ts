import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import type { Page } from '@playwright/test'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  SessionSettingsPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1062 — the composer footer's context reading turning amber at 50% and red at
// 70%. The PAINTED colour is what lives here and nowhere else: `vitest.config.ts` runs
// `environment: 'node'` and every renderer spec is a `renderToStaticMarkup` string, so a stylesheet's
// effect is invisible to that tier. What the renderer tier owns instead is the ladder's two boundaries as
// VALUES (contextUsage.test.ts) and the three emitted markups (ConversationScreen.test.tsx); this spec
// proves the class it emits actually reaches the token it names.
//
// A SEPARATE spec rather than steps bolted onto a sibling: all six specs that seed a run configuration
// seed 50 000 / 200 000 = 25%, which is the primary step, and their drives are ordered around a reading
// that never moves. Making one of them walk three steps would put a colour ladder inside a drive about
// something else and would change six baselines to prove one.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame here is one the daemon sends unprovoked or in reply — a `turn_state` thinking → idle pair is an
// ordinary turn end, and `session_settings` is the reply to the app's own `request_session_settings`.
// Only the FIGURES and the timing are this test's.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, a computed
// colour, or a count. The session id and the token figures are non-secret display/routing literals; the
// pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a
// token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SESSION_ID = 'session-1062'

// One window for all three steps, so each step is a numerator and the percentage is read off it directly.
const WINDOW_TOKENS = 200_000

// The three drives, at BOTH boundaries rather than at comfortable interior values: 49/50 is the pair that
// falsifies a `> 50` slip and 70 is the first value of the top step. The reading is the design's own
// M3 body/small run either way; only the colour and, at the top, the prefix may differ.
const STEPS = [
  { usedTokens: 98_000, text: 'Context: 49%', token: '--color-primary' },
  { usedTokens: 100_000, text: 'Context: 50%', token: '--color-warning' },
  { usedTokens: 140_000, text: 'Context high: 70%', token: '--color-error' }
] as const

// #1166: the figure the launch-time reply carries, and it is a FOURTH value sharing no reading text with
// any step above. Since opening a chat now asks for the run configuration, this drive can no longer open
// on an absent reading — and that absence was its proof that each step below was produced by the cycle
// preceding it. This restores the proof as a POSITIVE one: the drive opens by pinning a reading no step
// can produce, so a first cycle that changed nothing would still be caught. Comfortably inside the
// primary band, so it also cannot be confused with either boundary.
const LAUNCH = { usedTokens: 20_000, text: 'Context: 10%' } as const

// A token's value as the CSSOM serialises a COLOUR — `#ffca45` becomes `rgb(255, 202, 69)`, the form
// every getComputedStyle() reading is in. Painted onto a throwaway probe rather than parsed by hand, so
// the conversion is the engine's own and cannot drift from it. Copied from composer-message-box.spec.ts,
// which is where this idiom was established.
const tokenColor = async (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (value === '') return ''
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)

function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

function sessionSettingsFrame(inReplyTo: number, usedTokens: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      session_id: SESSION_ID,
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: usedTokens,
      window_tokens: WINDOW_TOKENS
    } satisfies SessionSettingsPayload
  })
}

test('composer footer: the context reading steps primary → warning → error as the window fills (AC3, AC4)', async ({
  launchPairedApp
}) => {
  // The figures the fake answers WITH, as a variable the body moves between cycles — deliberately not a
  // consume-once queue. A duplicate `request_session_settings` (a sheet open landing beside a turn edge)
  // then answers with the same value instead of skipping a step, so the drive cannot desync on a request
  // it did not schedule.
  // Annotated `number`, not inferred: LAUNCH is `as const`, so the initialiser's type is the literal
  // 20000 and every later assignment would be a type error. It is mutated only inside the loop below,
  // which the launch assertion gates, so the reply to the on-open request can only carry this value.
  let usedTokens: number = LAUNCH.usedTokens

  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      switch (env.type) {
        case 'list_conversations':
          return [seedConversationsFrame()]
        case 'request_session_settings':
          return [sessionSettingsFrame(env.id, usedTokens)]
        default:
          return []
      }
    }
  })

  const reading = page.locator('.composer__context')

  // The reading mounts only once a run-config snapshot exists, and nothing PUSHES one — `session_settings`
  // is reply-only. Since #1166 the app asks on conversation open, and `launchPairedApp` navigates by
  // clicking the seeded row, so the reply to that on-open request is what mounts this reading before any
  // turn has run. Pinning its figure is this drive's proof that each step below was produced by the cycle
  // that preceded it: LAUNCH shares no reading text with any step, so a cycle that produced nothing would
  // leave this text standing and fail.
  await expect(reading).toHaveText(LAUNCH.text, { timeout: ROUNDTRIP_TIMEOUT_MS })

  for (const step of STEPS) {
    usedTokens = step.usedTokens

    // The refresh trigger's edge is a running → not-running TRANSITION, per conversation — a lone `idle`
    // fires nothing at all, because the edge is a `Set.delete` that returns false when the conversation
    // was never marked running. Hence the pair, on every cycle including the first.
    daemon.pushFrame(turnStateFrame('thinking'))
    daemon.pushFrame(turnStateFrame('idle'))

    // The text is the barrier for "this cycle's snapshot has landed": it is unique per step (the third
    // carries the top step's word), so a stale reading from the previous cycle cannot satisfy it.
    await expect(reading).toHaveText(step.text, { timeout: ROUNDTRIP_TIMEOUT_MS })
    await expect(reading).toHaveCSS('color', await tokenColor(page, step.token))
  }
})
