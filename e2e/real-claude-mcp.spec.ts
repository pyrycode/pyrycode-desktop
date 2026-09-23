import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload, type SpawnedDaemon } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// A NON-BYPASS CHILD, AND THAT IS THE WHOLE PRECONDITION. The daemon hands claude its own MCP config with
// `--strict-mcp-config` only on a spawn without `--dangerously-skip-permissions`; a bypass child sees no
// daemon MCP server, and the daemon neither publishes nor answers MCP status for it (pyrycode
// docs/protocol-mobile.md § Asking for MCP status on demand). `skipPermissions: false` drops that flag.
// The stream-json runner is production's, as in the permission-modal sibling. The one turn below asks
// a plain question that needs no tool, so no permission decision is ever pending.
test.use({ skipPermissions: false, interactiveRunner: 'stream-json' })

// Tier-3 real-claude e2e for #1579, the MCP family's first `real-*` spec. #1492's Reconnect drive and the
// toggle slice after it EXTEND THIS FILE rather than adding their own.
//
// WHAT IT PROVES: the Channel info sheet, opened against a real pyry daemon and a real claude, renders the
// daemon's own `pyry_approve` and `pyry_files` servers. Those rows are decoded from `mcp_status` bytes the
// fake transport did not author, so the #1489 decode and the #1490 render are checked against the real
// producer. Opening the sheet also sends this ticket's `mcp_status_request`; the report on screen is that
// answer or the child's spawn-time publication, and the two share one payload.
//
// THE RECONNECT DRIVE (#1583) then sends one `reconnectMcpServer` for `pyry_files` through `window.pyry`,
// because both daemon servers normally read `connected` and so offer no button (the fake tier,
// channel-mcp-reconnect.spec.ts, owns the press). The daemon checks the asking device before anything
// else, and only a live run can say whether this app's paired device may actuate. The drive ends in
// exactly one of two outcomes, a fresh report or the refusal notice, and records which as the
// `mcp-reconnect-outcome` annotation. Both are passes: the annotation, not the verdict, is the answer.
// To tell the reconnect's report from the sheet-open ask's, the drive waits for that ask's answer first.
//
// WHAT IS DELIBERATELY NOT ASSERTED:
//   - A server's status word or error prose. Both are claude's open-set text, and whether an MCP server
//     reads `connected` or `pending` at a given moment is claude's timing, not this client's contract.
//   - The unavailable notice on a chat with no child yet. That binds the gate to the daemon's eviction
//     timing; the fake tier (channel-mcp-status-request.spec.ts) owns the notice.
//   - Reply content. The turn exists only to spawn the child; its text is never read.
//
// It inherits the real-claude harness: `spawnClaude` defaults to true, so the full skip-gate applies
// (`pyry` + `claude` on PATH + a credential, checked before any resource exists). It declares no
// `requiredCapabilities`: `mcp_status_request` rides the `interactive` capability every real spec already
// negotiates. THE DAEMON AT `PYRY_BIN` MUST INCLUDE THE ON-DEMAND REQUEST (pyrycode#2381/#2382). A daemon
// without it may still publish at spawn, but a failure here against an older binary is an environment
// fault, not a client one.
//
// ADDING THIS FILE MAKES THE TIER'S FLOOR STALE. `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` lives in the
// dispatcher's configuration, not in this repo; this is one more executed spec, and the bump is the
// operator's. The runbook's § Current real-claude gate state records the counts.
//
// SECRET HYGIENE: the pairing payload is referenced nowhere but the arrival step. Row assertions match
// the two daemon-owned names below exactly, so a failure prints a constant and never claude text.

// The daemon's own servers — the same client-owned constants McpServersSection.tsx filters on.
const BUILT_IN_SERVERS = ['pyry_approve', 'pyry_files'] as const
const CHANNEL_INFO_ROW = 'Channel info'
const CREATE_CHAT_LABEL = 'Create chat'
const SHOW_BUILT_IN = 'Show built-in'

const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// Streaming cursor, stripped before the non-empty check (real-claude-new-session.spec.ts's strip).
const CURSOR_CHAR = '▎'
const CURSOR_SELECTOR = '.bubble__cursor'
const META_SELECTOR = '.bubble__meta'

const HANDSHAKE_TIMEOUT_MS = 45_000
// One cold turn: spawn + model load + first reply.
const TURN_TIMEOUT_MS = 120_000
// The report must follow the child's MCP initialize; generous, because it is a spawn-time handshake.
const REPORT_TIMEOUT_MS = 60_000
const SPEC_TIMEOUT_MS = 300_000
// The daemon's answer to one mcp_reconnect: a refusal is immediate, an accepted one waits on claude.
const RECONNECT_TIMEOUT_MS = 60_000
const RECONNECT_TARGET = 'pyry_files'
const RECONNECT_REFUSED = 'The daemon refused to reconnect the MCP server.'

// Counts and routing ids only; no row string is copied out of the page.
type McpProof = { reports: string[]; refusals: string[]; off: () => void }
type DriveWindow = typeof window & { mcpProof: McpProof }

async function watchMcp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const proof: McpProof = { reports: [], refusals: [], off: () => {} }
    proof.off = window.pyry.onDaemonEvent((event) => {
      if (event.type === 'mcpStatus') proof.reports.push(event.conversationId)
      if (event.type === 'mcpReconnectRejected') proof.refusals.push(event.conversationId)
    })
    ;(window as DriveWindow).mcpProof = proof
  })
}

function readMcp(page: Page): Promise<{ reports: string[]; refusals: string[] }> {
  return page.evaluate(() => {
    const { reports, refusals } = (window as DriveWindow).mcpProof
    return { reports: [...reports], refusals: [...refusals] }
  })
}

/** Non-empty assistant replies, counted and never read out. */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page.locator(ASSISTANT_ROW).evaluateAll(
    (els, { cursor, meta }) =>
      els.filter((el) => {
        const content = document.createElement('div')
        content.append(el.cloneNode(true))
        content.querySelectorAll(meta).forEach((node) => node.remove())
        return (content.textContent ?? '').split(cursor).join('').trim().length > 0
      }).length,
    { cursor: CURSOR_CHAR, meta: META_SELECTOR }
  )
}

/** Pair against the real daemon; the seeded row rendering is the connected gate
 *  (real-claude-system-prompt.spec.ts's `pairAndConnect`). */
async function pairAndConnect(
  page: Page,
  relay: { url: string },
  pairFields: SpawnedDaemon['pairFields']
): Promise<void> {
  const payload = encodePairingPayload({
    server: pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: pairFields.token,
    server_static_pubkey: pairFields.server_static_pubkey
  })
  await pairFromUnpairedLaunch(page, payload)
  await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
}

/** Mint a chat through the operator flow and wait for its empty thread. */
async function createChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: CREATE_CHAT_LABEL, exact: true }).click({ force: true })
  await expect(page.locator('.conversation__empty')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })
}

/** One turn to bring the conversation's child up, waited to completion. */
async function spawnChild(page: Page, message: string): Promise<void> {
  await page.getByPlaceholder('Message…').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'claude never replied, so no child is running and there is no MCP status to read'
    })
    .toBeGreaterThan(0)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
}

test('real claude: the Channel info sheet shows the daemon’s own MCP servers', async ({ relay, daemon, page }) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  await pairAndConnect(page, relay, daemon.pairFields)
  await watchMcp(page)
  await createChat(page)
  await spawnChild(page, `What is 2 plus 2? run=${Date.now()}`)

  // The operator's own route to the sheet. Opening it is what sends `mcp_status_request`.
  const beforeOpen = (await readMcp(page)).reports.length
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: CHANNEL_INFO_ROW }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('MCP servers', { exact: true })).toBeVisible()

  // The toggle renders only once a report is held, so its arrival is the report's.
  const toggle = sheet.getByRole('checkbox', { name: SHOW_BUILT_IN })
  await expect(
    toggle,
    'no MCP report reached the sheet: the daemon neither answered the request nor published at spawn. ' +
      'Check that PYRY_BIN includes mcp_status_request and that the child was not spawned in bypass mode'
  ).toBeVisible({ timeout: REPORT_TIMEOUT_MS })

  // Built-ins are hidden until Show built-in is ticked, which starts unticked on every open.
  for (const name of BUILT_IN_SERVERS) await expect(sheet.getByText(name, { exact: true })).toHaveCount(0)
  await toggle.check()
  for (const name of BUILT_IN_SERVERS) {
    await expect(
      sheet.getByText(name, { exact: true }),
      `the daemon's report did not list its own ${name} server`
    ).toBeVisible()
  }

  // #1583's drive. Wait for the sheet-open ask's answer so it cannot be read as the reconnect's.
  await expect
    .poll(async () => (await readMcp(page)).reports.length, {
      timeout: REPORT_TIMEOUT_MS,
      message: 'the daemon never answered the sheet-open mcp_status_request'
    })
    .toBeGreaterThan(beforeOpen)
  const held = await readMcp(page)
  const conversationId = held.reports[held.reports.length - 1]
  expect(held.reports.every((id) => id === conversationId), 'every report names the one chat').toBe(true)
  expect(held.refusals).toEqual([])

  await page.evaluate(
    ({ id, name }) => window.pyry.sendCommand({ type: 'reconnectMcpServer', payload: { conversation_id: id, server_name: name } }),
    { id: conversationId, name: RECONNECT_TARGET }
  )
  let outcome: 'report' | 'refused' | null = null
  await expect
    .poll(async () => {
      const now = await readMcp(page)
      const refused = now.refusals.includes(conversationId)
      const answered = now.reports.length > held.reports.length
      outcome = refused && !answered ? 'refused' : answered && !refused ? 'report' : null
      return refused || answered
    }, { timeout: RECONNECT_TIMEOUT_MS, message: 'the daemon neither answered nor refused the mcp_reconnect' })
    .toBe(true)
  expect(outcome, 'the reconnect drew both a report and a refusal').not.toBeNull()
  test.info().annotations.push({ type: 'mcp-reconnect-outcome', description: outcome ?? 'both' })

  const notice = sheet.getByText(RECONNECT_REFUSED, { exact: true })
  if (outcome === 'refused') {
    // The refusal keeps the held rows and shows the notice.
    await expect(notice).toBeVisible()
  } else {
    await expect(notice).toHaveCount(0)
  }
  for (const name of BUILT_IN_SERVERS) await expect(sheet.getByText(name, { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as DriveWindow).mcpProof.off() })
})
