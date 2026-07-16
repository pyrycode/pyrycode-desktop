# #464 — fake e2e: unpair and re-pair return to the app-root PairingScreen

**Size:** S · **Security-sensitive:** no · **Figma:** N/A (coverage-only test of already-shipped controls) · **Split from:** #429 (child A)

## Context

The **session-EXIT path** — the flip from a paired, connected thread back to the app-root `PairingScreen`
— has no e2e coverage today (only the initial pairing happy path does). Two affordances drive this exit
and both funnel through the same `runUnpair` → `onUnpaired()` → `App.tsx setRoute('pairing')` flip:

- **Unpair** — the two-phase `UnpairControl` in the thread header (`ConversationScreen.tsx`). Idle `Unpair`
  button → `Forget this pairing?` prompt with `Cancel` / `Confirm`. Cancel returns to idle keeping the
  session; Confirm runs `runUnpair` and flips to pairing.
- **Re-pair** — the `RepairControl` / `RepairPrompt` (#167), a `Re-pair` button shown only when
  `shouldOfferRepair(status)` is true (terminal, non-retryable error whose code is not `'unpair'`). Clicking
  it runs the same `runUnpair` flow.

This ticket adds **one fake-stack e2e spec** on the shared `launchPairedApp` fixture (#433) covering both
exits, plus **two small test-only infra edits** to make the Re-pair trigger reachable on the fake stack. No
production code changes.

### The Re-pair trigger is verified reachable (not an unrealizable assertion — cf. #440)

The ticket flags: if the fatal-close hook proves infeasible, route back rather than assert an unreachable
`Re-pair`. It is **feasible** — the chain was traced end-to-end through merged code:

1. Forwarder closes the **client leg** with a fatal WS code (`4401`) — a clean `ws.close(4401)`, distinct
   from the existing `dropClientLeg()`'s abnormal `terminate()` (1006, retryable → auto-reconnect).
2. The client's relay socket receives a peer close → `relayConnection.ts:237-250`: on a peer-initiated close
   `pending === null`, so the peer's raw code `4401` is forwarded verbatim as `{ type: 'closed', code: 4401 }`.
3. `relaySupervisor.ts:211-212`: `DEFAULT_FATAL_CLOSE_CODES.has(4401)` is true → `emitTerminal(4401)` →
   `{ type: 'terminal', code: 4401 }`. **No re-dial is armed** for a fatal code, so no auto-reconnect.
4. `daemonConnection.ts:812-820`: `stopped` is false (a live session, no local stop) → `emitFailed(
   'connection-closed', …)` → `{ type: 'failed', error: { code: 'connection-closed', retryable: false } }`
   (`emitFailed` hardcodes `retryable: false`, `daemonConnection.ts:437-438`).
5. IPC → renderer `sessionStore` → `status.type === 'error'`. `shouldOfferRepair` (`composerSend.ts:130-131`)
   is `error && !retryable && code !== 'unpair'` → **true** → `RepairPrompt` renders `Re-pair`.

`4401`/`4421`/`4426` are interchangeable (all three are in the client's `DEFAULT_FATAL_CLOSE_CODES`,
`relaySupervisor.ts:40`); the spec uses `4401`.

## Files to read first

- `e2e/pair-to-conversation.spec.ts` — **the skeleton to clone.** Nav/interaction-only e2e on the launcher:
  imports `{ test, expect }` from the fixture, `const { page } = await launchPairedApp()`, then drives real
  clicks and asserts DOM visibility. No `buildReplyFrames`, no codec import — #464 has the identical shape.
- `e2e/fixtures/launchPairedApp.ts:105-116` — `PairedApp` handle (**edit target 2**: add `forwarder`), and
  `:137-237` — the fixture body. Leaves you on the thread, **connected, Send enabled**, client leg live. Both
  return sites (`:191` reuse path, `:236` default drive) already have `forwarder` in scope.
- `src/main/transport/fakeRelayForwarder.ts:20-46` (`FakeRelayForwarder` interface) + `:192-197`
  (`dropClientLeg`) — **edit target 1**: add `closeClientLeg(code)` next to `dropClientLeg`. `:167-173` — the
  leg-slot `close` handler that nulls `clientLeg` (unchanged; the new clean close triggers it the same way).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1562-1617` — `UnpairControl` two-phase
  confirm: idle `Unpair` button; confirm phase renders `Forget this pairing?` + `Cancel` + `Confirm` (busy →
  `Forgetting…`). Also `:1247-1283` (`RepairPrompt` / `RepairControl`, the `Re-pair` button) and `:129,162`
  (both controls mounted in the thread). **All four buttons share the `conversation__unpair` class** — select
  by role + accessible name, never by class.
- `src/renderer/src/screens/conversation/unpairAction.ts:42-60` — `runUnpair`: flips route via `onUnpaired`
  ONLY on `result: 'ok'`; the fake stack's real `window.pyry.unpair` clears the isolated-dir pairing → ok.
- `src/renderer/src/App.tsx:35-40,111-124` — `onUnpaired={() => setRoute('pairing')}` → app-root
  `<PairingScreen>`; the pairing route is **not mounted** while on `conversation`, so its textarea has count 0.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:89-96` — app-root entry surface: `<h1>Paste pairing
  code</h1>` + `textarea[aria-label="Pairing code"]` (the return-to-pairing proof).
- Memory / prior art: sibling `docs/specs/architecture/465-paired-shell-navigation-fake-e2e.md` (same launcher,
  same NOT-sec/NOT-Figma posture, secret-hygiene note); `dropClientLeg` precedent is #416.
- [[e2e-not-typechecked-by-project-config]] and the #428 standalone-`tsc` gotcha (temp tsconfig must include
  the `src/**` globs so the `noise-c.wasm` ambient `.d.ts` loads).

## Selector map (the load-bearing contract)

| Target | Selector | Notes |
| --- | --- | --- |
| thread root | `page.locator('.conversation')` | fixture end-state |
| Send | `page.getByRole('button', { name: 'Send' })` | enabled ⇒ session live |
| idle Unpair | `page.getByRole('button', { name: 'Unpair', exact: true })` | opens confirm |
| confirm prompt | `page.getByText('Forget this pairing?')` | confirm-phase gate |
| Cancel | `page.getByRole('button', { name: 'Cancel', exact: true })` | keeps session |
| Confirm | `page.getByRole('button', { name: 'Confirm', exact: true })` | `exact` avoids the busy `Forgetting…` |
| Re-pair | `page.getByRole('button', { name: 'Re-pair', exact: true })` | surfaces only after the fatal close |
| app-root pairing surface | `page.locator('textarea[aria-label="Pairing code"]')` | visible ⇒ returned to pairing; count 0 ⇒ still paired |

Select the four unpair/re-pair buttons **by role + accessible name**, not by class — they all carry
`conversation__unpair`. Only one is present at a time given the phase, so names disambiguate.

## Design

### Test-only infra edits (production relay path untouched)

**Edit 1 — `fakeRelayForwarder.ts`: add `closeClientLeg(code: number): void`.**
Contract (add to the `FakeRelayForwarder` interface + the returned object):
> Cleanly close the current client leg with a caller-chosen WS close code (contrast `dropClientLeg`'s abnormal
> 1006 `terminate()`). Content-agnostic — the forwarder never interprets the code; a code in the client's
> `DEFAULT_FATAL_CLOSE_CODES` (`4401`/`4421`/`4426`) drives the supervised client to a terminal (non-retryable)
> failure instead of a re-dial. No-op when no client leg is connected. The server leg is unaffected.

Body is a one-liner mirroring `dropClientLeg`: `if (clientLeg !== null) clientLeg.close(code)`. It reuses the
existing `close`-handler leg-nulling (`:167-173`) unchanged. **Do not** import any client/wire module — the
module's content-blind import discipline holds (only `ws` + Node built-ins); the numeric code is an opaque
argument, not an interpreted value.

**Edit 2 — `launchPairedApp.ts`: expose the forwarder on `PairedApp`.**
- Import the type: `import { startFakeRelayForwarder, type FakeRelayForwarder } from '…/fakeRelayForwarder'`.
- Add `forwarder: FakeRelayForwarder` to the `PairedApp` type; add `forwarder` to **both** return objects
  (`:191` reuse path, `:236` default drive). Update the "forwarder is intentionally not exposed" comment
  (`:110-111`) to note this spec (#464) is the first in-scope consumer of a forwarder leg control.
- Purely additive: existing consumers destructure `{ page }` / `{ page, daemon }` etc., so no call-site cascade.

### The spec: two `test()` blocks (each drives real product-UI controls only)

**Block A — Unpair: Cancel keeps the session, then Confirm returns to pairing (one launch).**
Cancel keeps the session mounted, so both AC2 and AC3 share a single `launchPairedApp()` (each launch pays the
full ~60s handshake — the sibling "one launch when state permits" discipline, #425/#465):

1. `const { page } = await launchPairedApp()` — thread, Send enabled (fixture end-state). Assert `.conversation`
   visible.
2. Click `Unpair` (idle) → assert `Forget this pairing?` visible.
3. Click `Cancel` → **keeps the session** *(AC2)*: assert `.conversation` still visible, `Send` still enabled,
   and `textarea[aria-label="Pairing code"]` has **count 0** (app-root pairing route not mounted). Assert idle
   `Unpair` visible again (phase back to idle).
4. Re-open: click `Unpair` again → assert `Forget this pairing?` visible.
5. Click `Confirm` → **returns to pairing** *(AC3)*: assert `textarea[aria-label="Pairing code"]` visible.

**Block B — Re-pair returns to pairing (its own launch — a fatal close is terminal).**

1. `const { page, forwarder } = await launchPairedApp()` — thread, Send enabled, client leg live.
2. `forwarder.closeClientLeg(4401)` — fire the fatal close immediately (the handshake is already complete when
   the fixture resolves, so the client leg is connected).
3. Assert `Re-pair` visible — Playwright auto-wait absorbs the close → terminal → `error` → re-render latency.
4. Click `Re-pair` → **returns to pairing** *(AC4)*: assert `textarea[aria-label="Pairing code"]` visible.

### Why the return-to-pairing proof is the app-root textarea

The app-root `PairingScreen` and the in-shell pair-another screen (#465) render the same component, but that
ambiguity does **not** apply here: neither exit navigates to the in-shell `pairServer` route — both flip the
**top-level App route** to `'pairing'`, which unmounts `PairedShell` entirely. While on the thread the app-root
pairing route is not mounted, so `textarea[aria-label="Pairing code"]` count is 0; after the flip it is the
sole pairing surface. Its visibility (Block A step 5, Block B step 4) is the unambiguous teardown proof, and its
**absence** (Block A step 3, `toHaveCount(0)`) is the session-intact proof.

## State + concurrency model

None introduced. `UnpairControl` owns an ephemeral `'idle' | 'confirming' | 'unpairing'` phase via `useState`
(ADR 0006); the spec drives it through real clicks. The `error` status in Block B originates in the real
main-process transport (fatal close → `daemonConnection.emitFailed`) and crosses the real IPC bridge into the
renderer `sessionStore` — the fake stack exercises the production classification path unchanged. `emitTerminal`
arms **no** re-dial for a fatal code, so no reconnect races the assertion. The fixture owns teardown (LIFO:
app → daemon → forwarder → `rm`); the newly exposed `forwarder` reference does not change teardown ordering.

## Error handling

Playwright auto-wait + `expect(...).toBeVisible()` / `.toBeEnabled()` / `.toHaveCount(0)` per step; a mis-route
or a non-surfacing Re-pair fails as a timeout at the exact step. The `runUnpair` error branch (unpair itself
fails → stays on the thread, code `'unpair'` excluded from `shouldOfferRepair`) is not exercised — the fake
stack's real `window.pyry.unpair` clears the isolated-dir pairing and returns ok. No product error banner is
asserted. **Secret hygiene** (carry the sibling one-liner into the spec header): every assertion reads DOM
visibility / enabled-state only; the synthetic token + fake static key live in `launchPairedApp` and are never
echoed; no failure diagnostic serializes a token, key, pairing payload, or close reason.

## Testing strategy

- `npm run e2e` (= `build && playwright test`, fake suite only — `testIgnore: /real-.*\.spec\.ts$/`; the new
  `unpair-repair.spec.ts` is included). Target green: both blocks pass end-to-end.
- **e2e is not typechecked by either project tsconfig** ([[e2e-not-typechecked-by-project-config]]) — run a
  standalone `tsc` pass. Per the #428 gotcha, the temp tsconfig extending `tsconfig.node.json` must **include
  the `src/**` globs** alongside the spec (else the `noise-c.wasm` ambient `.d.ts` doesn't load → spurious
  TS7016). The spec itself imports only `{ test, expect }` from the fixture; the fixture is the sole importer
  of `src/main/transport/*`.
- `npm run build` (the salvage/QA gate) must stay green — the two infra edits are additive and touch no
  production consumer, so `npm test` (vitest) and typecheck are unaffected. There is no unit test to add: the
  forwarder method is exercised by the e2e Block B, and no existing `fakeRelayForwarder`/`launchPairedApp`
  unit test asserts the handle shape.

### Scenario coverage (map to AC)

- New spec on `launchPairedApp` covering both teardown exits; `npm run e2e` green. *(AC1)*
- Unpair → Cancel keeps the session (thread mounted, Send enabled, no pairing textarea). *(AC2)*
- Re-open → Confirm returns to the app-root pairing surface. *(AC3)*
- Fatal relay close surfaces `Re-pair`; clicking it returns to the app-root pairing surface. *(AC4)*

## Open questions

- **None blocking.** The one residual risk (the fatal-close hook not surfacing Re-pair on the fake stack) is
  retired by the end-to-end code trace in Context. If a live run nonetheless shows the terminal not surfacing,
  the ticket's own instruction applies: route back rather than weaken the AC — but no code path supports that
  outcome. Do not add speculative seeding or a second launch to Block A; Cancel keeps the session by design.
