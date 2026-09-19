import { test, expect, FIRST_SERVER_ID, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ContextUsagePayload,
  Envelope,
  SessionSettingsPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1421 — the composer footer's reading taking claude's own figure once one has
// been reported, in place of the daemon's transcript-derived settings pair. What lives HERE and nowhere
// else is the WHOLE PATH: a `context_usage` frame off the socket, through the decoder, the bridge and the
// store, into the rendered text. The renderer tier proves each surface reads the store
// (ConversationScreen.test.tsx, RunConfigSections.test.tsx) and the selection rule as values
// (contextTokenSource.test.ts), but every one of those seeds the store directly — none of them can catch
// a frame that never reaches it.
//
// THE DRIVE IS A SOURCE SWAP, NOT A LADDER WALK. Both figures sit in the SAME severity step (primary), so
// the emitted class never changes and the only observable difference between the two assertions is the
// NUMBER — which is the source. The ladder itself is composer-context-severity.spec.ts's, and putting a
// colour change in this drive would let a passing assertion mean either thing.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame here is one the daemon sends — `session_settings` is the reply to the app's own
// `request_session_settings`, and `context_usage` is either a correlated on-open reply or an unsolicited
// turn-end reading. The two tests below exercise those distinct production paths.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text. The session
// id and the token figures are non-secret display/routing literals, the three inventories are sent EMPTY
// (this ticket reads none of them, and their rows are the most disclosive content on the frame), and the
// pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a token,
// a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SESSION_ID = 'session-1421'

// The transcript route's figures: 50K of 200K = 25%. What the footer shows until claude answers.
const SETTINGS = { usedTokens: 50_000, windowTokens: 200_000, text: 'Context: 25%' } as const

// Claude's own reading: 80K of 200K = 40%. A DIFFERENT window would also prove the swap, but an identical
// one makes the test sharper — the two readings differ ONLY in the numerator that came off this frame, so
// nothing about the swap can be attributed to a window that moved underneath it.
const REPORTED = { totalTokens: 80_000, maxTokens: 200_000, text: 'Context: 40%' } as const

// #1421 holds claude's `percentage` and never displays it, recomputing from the token pair instead so the
// clamp and the severity ladder stay one computation across both surfaces. Seeded to a value the pair
// cannot produce and that no other figure in this file shares, so a surface that ever read it would draw
// 99% and fail rather than pass quietly.
const UNDISPLAYED_PERCENTAGE = 99

function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
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
      used_tokens: SETTINGS.usedTokens,
      window_tokens: SETTINGS.windowTokens
    } satisfies SessionSettingsPayload
  })
}

// The three inventories go out EMPTY and their dropped counts zero — a real, if degenerate, shape the
// daemon emits, and the one this ticket's two integers are the whole of. `[]` and `0` are values here, not
// absences: the frame positively reports that claude listed no rows.
function contextUsageFrame(inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'context_usage',
    ts: FIXED_TS,
    ...(inReplyTo === undefined ? {} : { in_reply_to: inReplyTo }),
    payload: {
      conversation_id: SEEDED_ROW.id,
      model: 'seeded-model',
      total_tokens: REPORTED.totalTokens,
      max_tokens: REPORTED.maxTokens,
      percentage: UNDISPLAYED_PERCENTAGE,
      categories: [],
      dropped_categories: 0,
      mcp_tools: [],
      dropped_mcp_tools: 0,
      memory_files: [],
      dropped_memory_files: 0
    } satisfies ContextUsagePayload
  })
}

test('composer footer: claude’s reported reading displaces the settings-derived figure (AC5)', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      switch (env.type) {
        case 'list_conversations':
          return [seedConversationsFrame()]
        // Answered with the SAME figures every time, deliberately. The turn edge below triggers a refresh,
        // so the settings pair is re-asserted AFTER claude's reading has landed — which makes the closing
        // assertion a proof that a later transcript refresh cannot take the surface back.
        case 'request_session_settings':
          return [sessionSettingsFrame(env.id)]
        default:
          return []
      }
    }
  })

  const reading = page.locator('.composer__context')

  // The opening state: no reading has been reported for this conversation, so the footer shows the
  // transcript route's figure. Since #1166 the app asks for the run configuration on conversation open,
  // and launchPairedApp navigates by clicking the seeded row, so the reply to that on-open request is what
  // mounts this.
  await expect(reading).toHaveText(SETTINGS.text, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // One turn. The refresh trigger's edge is a running → not-running TRANSITION per conversation — a lone
  // `idle` fires nothing, because the edge is a `Set.delete` that returns false when the conversation was
  // never marked running — hence the pair.
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))

  // Then the reading the daemon fans out after that turn end.
  daemon.pushFrame(contextUsageFrame())

  await expect(reading).toHaveText(REPORTED.text, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // Claude's own `percentage` is held and not displayed. Asserted on the whole footer rather than on the
  // reading alone, so the figure cannot have leaked into a sibling control either.
  await expect(page.locator('.composer__footer')).not.toContainText(`${UNDISPLAYED_PERCENTAGE}%`)
})

test('chat activation requests context once and replaces both readings before a turn', async ({ launchPairedApp }) => {
  const requests: Envelope[] = []
  const app = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      if (env.type === 'list_conversations') return [seedConversationsFrame()]
      if (env.type === 'request_session_settings' || env.type === 'request_context_usage') requests.push(env)
      return env.type === 'request_session_settings' ? [sessionSettingsFrame(env.id)] : []
    }
  })
  const { page, daemon } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  const contextRequests = () => requests.filter(env => env.type === 'request_context_usage')
  const settingsRequests = () => requests.filter(env => env.type === 'request_session_settings')
  const reading = page.locator('.composer__context')
  const gauge = page.getByRole('progressbar', { name: 'Context window usage' })
  await expect(reading).toHaveText(SETTINGS.text)
  await expect.poll(() => contextRequests().length).toBe(1)
  expect(contextRequests()[0].payload).toEqual({ conversation_id: SEEDED_ROW.id })
  expect(settingsRequests()).toHaveLength(1)
  expect(settingsRequests()[0].payload).toEqual(contextRequests()[0].payload)

  // Hold the correlated reply until both surfaces show the fallback. Opening the sheet only asks
  // for settings; if context were attached to that sender, this count would incorrectly grow.
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
  await expect(gauge).toHaveAttribute('aria-valuenow', '25')
  await expect.poll(() => settingsRequests().length).toBe(2)
  expect(contextRequests()).toHaveLength(1)
  daemon.pushFrame(contextUsageFrame(contextRequests()[0].id))
  await expect(reading).toHaveText(REPORTED.text)
  await expect(gauge).toHaveAttribute('aria-valuenow', '40')
  await expect(page.locator('.run-config__context-usage')).toHaveText('40% used (80K of 200K tokens)')
  await page.screenshot({ path: '/tmp/builder-1504-visual/gauge.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.screenshot({ path: '/tmp/builder-1504-visual/footer.png', animations: 'disabled' })

  // Reopen explicitly, with no turn or reply to the second ask. The held reading survives.
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => contextRequests().length).toBe(2)
  expect(contextRequests()[1].payload).toEqual({ conversation_id: SEEDED_ROW.id })
  await expect.poll(() => settingsRequests().length).toBe(3)
  await expect(reading).toHaveText(REPORTED.text)

  // Observe at the renderer boundary so main's connected socket cannot conceal a misplaced send.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Debugger.enable')
  await page.evaluate(() => { (window as any).__contextCommands = [] })
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: '(globalThis.__contextCommands.push(arguments[0].type), false)'
  })
  for (const type of ['disconnected', 'connecting', 'failed']) {
    await app.app.evaluate(({ BrowserWindow }, { channel, serverId, type }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, {
        type, serverId, error: { code: 'transport', message: 'Offline', retryable: true }
      })
    }, { channel: DAEMON_EVENT_CHANNEL, serverId: FIRST_SERVER_ID, type })
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await page.evaluate(() => (window as any).__contextCommands)).toEqual([])
  }
  await cdp.detach()
  expect(contextRequests()).toHaveLength(2)
})
