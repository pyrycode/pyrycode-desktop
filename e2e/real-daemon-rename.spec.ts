import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) — a real spawned `pyry` daemon on #251's content-blind
// routing relay, gating on the `pyry` binary ALONE (no `claude`, no Anthropic credential). It exists to
// catch the `promote_conversation` class of gap (pyrycode/pyrycode#949): the daemon defined the type +
// payload + registry op but registered NO handler, so the real wire answered `unsupported` — while the
// whole fake-daemon suite stayed green, because a fake answers anything. The registry-backed user actions
// (rename / archive / restore / delete / …) are pure registry ops daemon-side and never touch claude, so
// they can be proven against a real daemon deterministically and cheaply.
//
// This spec is the harness's liveness proof: it renames the seeded conversation through the product's own
// Rename UI and asserts the new title lands in the channel list (and the old one is gone). `rename_conversation`
// is a REGISTERED pure registry op daemon-side (pyrycode/pyrycode#820: decode → mutate → eager Save → typed
// reply + `conversation_updated` broadcast) — exactly the handler `promote_conversation` lacked, so it is a
// safe liveness action. The four sibling action specs (#440–#443) reuse this same claude-less harness.
//
// `spawnClaude:false` selects the claude-less spawn mode; `seedPromoted:true` seeds the conversation as a
// saved Channel so it renders the Rename pencil (partitionByPromotion → the Channels section). Post-pairing
// the app lands on `route='list'` (PairedShell), so the seeded row renders in the channel list without
// entering a thread. The spec runs only under `npm run e2e:real-claude` (the config's `real-*` testMatch)
// and is excluded from the default `npm run e2e` (its filename testIgnore). When `pyry` is unavailable it
// SKIPS cleanly (the daemon fixture's skip-gate) — never a hard failure.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; NEW_TITLE and oldTitle
// are non-secret literals; the pairing payload is built the same way as real-claude.spec.ts and never
// echoed into a message. No failure diagnostic serialises the token, keys, or a transcript.

test.use({ spawnClaude: false, seedPromoted: true })

// --- Timeouts ----------------------------------------------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — mirrors real-claude.spec.ts's HANDSHAKE_TIMEOUT_MS. There is NO cold-claude
// turn to absorb here (rename is a pure registry op), so the whole-spec budget is far tighter.
const HANDSHAKE_TIMEOUT_MS = 45_000
// A fast registry op (rename_conversation) + the conversation_updated → re-list round-trip + re-render.
const RENAME_TIMEOUT_MS = 15_000
// Whole spec: handshake + rename round-trip + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 90_000

test('real daemon persists a rename round-trip, visible in the channel list', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // --- Pair against the real daemon, dial the test relay's /v1/client leg (real-claude.spec.ts:80-87). ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim (relayConnection uses config.url unchanged); NOT pyry's emitted relay
    // (which points at prod). The loopback affordance (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  // --- Readiness gate: the Rename pencil renders ONLY for a promoted row, so its visibility proves the
  // whole chain — handshake complete → session `connected` → the auto-fired `list_conversations` returned
  // the seeded promoted row → it rendered in the Channels section. Stronger than a bare row-visible check.
  const renamePencil = page.locator('.channel-list__rename')
  await expect(renamePencil).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // The old title, read from the DOM. The nameless seed renders `titleFor(null)` = "Untitled", but reading
  // it (rather than hardcoding) keeps the "old title gone" assertion robust to whatever the daemon returns.
  const oldTitle = (await page.locator('.channel-list__title').first().textContent())?.trim() ?? ''

  // A per-run nonce so reruns differ (defeats any accidental reply caching) and NEW_TITLE can never collide
  // with oldTitle.
  const runNonce = Date.now()
  const NEW_TITLE = `renamed ${runNonce}`

  // --- Drive the product rename UI: pencil → dialog → fill → Save. #1476 retitled the Channels pen's
  // dialog to Edit channel and moved it to the `.edit-channel*` namespace; the pencil keeps its own
  // `.channel-list__rename` token. This file is a `real-*` spec, so `npm run e2e` ignores it by filename
  // and only `npm run e2e:real:gate` executes this edit. ---
  await renamePencil.click()
  await expect(page.getByRole('dialog', { name: 'Edit channel', exact: true })).toBeVisible()
  // `fill` clears the prefilled current title before typing.
  await page.locator('.edit-channel__input').fill(NEW_TITLE)
  // OK is enabled because NEW_TITLE is non-blank, and it SENDS because the per-run nonce guarantees the
  // typed name differs from the seeded title — the #1476 unchanged-name no-send path is not this drive's.
  await page.getByRole('dialog', { name: 'Edit channel', exact: true }).getByRole('button', { name: 'OK', exact: true }).click()

  // --- Assert the new title renders (AC3). Auto-waits the rename round-trip: command → daemon
  // rename_conversation → conversation_updated broadcast → shouldRefreshList → re-request → updated reply →
  // re-render. A timeout here is a genuine liveness signal (the #949-class catch), not a flake.
  await expect(
    page.locator('.channel-list').getByText(NEW_TITLE, { exact: true })
  ).toBeVisible({ timeout: RENAME_TIMEOUT_MS })

  // --- Assert the old title no longer renders (AC3). ---
  await expect(
    page.locator('.channel-list').getByText(oldTitle, { exact: true })
  ).toHaveCount(0)
})
