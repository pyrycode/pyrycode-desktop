# #433 — e2e fixture: `launchPairedApp` (shared fake-daemon pairing harness)

**Size:** S · **Security-sensitive:** no (test infrastructure only) · **Figma:** none (drives existing UI; no new visual surface)

## Context

Two Playwright specs — `e2e/pair-to-conversation.spec.ts` (#93) and `e2e/send-and-stream.spec.ts` (#94) — hand-roll the identical harness: a file-local `test.extend` chain `forwarder → daemon → page` that starts `startFakeRelayForwarder()` + `startFakeDaemon()`, launches the built app with the two `isPackaged`-gated dev flags and an isolated `--user-data-dir`, drives the real pairing UI (paste synthetic payload → Pair → Confirm), clicks the seeded ChannelList row to cross the one real `list → thread` step (#140), and waits for Send to enable (the DOM-observable handshake proof). Each also re-declares `encodePairingPayload`, `DUMMY_TOKEN`, and the one-row `SEEDED_ROW` seed.

#435 (merged, PR#436) repaired this drive in both specs post-#140 — seed a one-row conversation list, click `.channel-list__row-open`. This ticket **extracts** that repaired drive into one shared fixture so the batch of per-flow specs filed on top (#422–#429, #434, #420) starts at "paired, connected, on the thread, Send enabled" in a few lines instead of re-copying (and drifting) the harness.

This is test infrastructure only. No `src/` change. `electronApp.ts` (the scenario-agnostic launch primitive) stays untouched — it is imported only by `smoke.spec.ts`, and this ticket extracts the *fuller* harness the two specs duplicate, not that thinner primitive.

## Files to read first

- `e2e/pair-to-conversation.spec.ts` (full, 199 ll) — **the source harness to extract**: the `forwarder/daemon/page` `test.extend` chain (ll.80–126), `encodePairingPayload` (ll.128–132), `DUMMY_TOKEN` (l.43), `SEEDED_ROW` + `buildReply` (ll.63–78), the paste→Pair→Confirm→row-click→Send-enabled drive (ll.157–197). All of this moves into the fixture.
- `e2e/send-and-stream.spec.ts` (full, 248 ll) — **the second consumer**. Note its `buildReplyFrames` (ll.124–131): default arm returns `[conversationsSeed()]` (the row seed) and the `send_message` arm streams `[assistant_delta, turn_end]`. This is the AC4 precedence contract — a scripted `buildReplyFrames` overrides the fixture's default `buildReply`, so the spec seeds the row itself. Its assertion selectors + reply-frame builders stay in the spec.
- `e2e/fixtures/electronApp.ts:21-44` — the existing launch hardening (`args: ['.']`, `delete env.ELECTRON_RENDERER_URL`) the new fixture mirrors. **Do not modify it** — `smoke.spec.ts` owns it.
- `src/main/transport/fakeDaemon.ts:100-159` — `FakeDaemonOptions` (the `Omit<…,'url'>` superset the fixture accepts) + the `FakeDaemon` handle (`staticPublicKey`, `pushFrame`, `initiateRekey`, `whenSettled`, `close`). Line 383: `buildReplyFrames` takes precedence over `buildReply` — the mechanism behind AC4.
- `src/main/transport/fakeRelayForwarder.ts:20-46` — `FakeRelayForwarder` handle; `url` has no trailing path (append `/v1/client` for the pasted relay). `whenReady()` is **not** needed here — the daemon's `/v1/server` leg is open when `startFakeDaemon` resolves, and the client dials only after Confirm.
- `src/shared/wire/types.ts` — `ConversationSummary`, `ConversationsPayload`, `QrPayload`, `HelloAckPayload` (imported via `../../src/shared/wire/types` from `e2e/fixtures/`).
- `src/main/transport/codec.ts` — `encodeEnvelope` for the seed frame (the daemon-side codec; wire-codec home is `main/transport`, not `shared/wire`).
- `src/main/relayPolicy.ts` — `LOOPBACK_RELAY_ENV_FLAG` export. `src/main/secretBackend.ts` — `TEST_SECRET_BACKEND_ENV_FLAG` export.
- `playwright.config.ts` — no `timeout` field ⇒ Playwright's 30 s default; `workers: 1`, `fullyParallel: false`. Confirms the fixture must extend the per-test timeout to cover the ~60 s launch+handshake.

## Design

### Module + public surface — `e2e/fixtures/launchPairedApp.ts`

A new fixture module built on `base.extend`, exporting:

- `test` — `base.extend<PairedAppFixtures>({ … })`, the extended Playwright `test` the two specs import.
- `expect` — re-exported from `@playwright/test` (mirrors `electronApp.ts`).
- `type LaunchPairedAppOptions = Omit<FakeDaemonOptions, 'url'>` — the reply-scripting superset. `url` is fixture-supplied (from the forwarder); everything else (`buildReply`, `buildReplyFrames`, `helloAck`, plus future daemon knobs like `reconnectResendFrames`) passes straight through. Accepting the whole `Omit` — rather than enumerating three named overrides — is what lets a future reconnect/queue spec script the daemon without editing the fixture.
- `type PairedApp` — the returned handle: `{ page: Page; app: ElectronApplication; daemon: FakeDaemon }`.
- `seedConversationsFrame(): Uint8Array` — the reusable one-row `conversations` seed builder (a fixed-literal `ConversationSummary` → `encodeEnvelope`). Exported so a spec that scripts its own `buildReplyFrames` reuses the *same* seed on its default arm instead of re-declaring the row (kills the `SEEDED_ROW` duplication that motivated the extraction).

Internal (not exported): `PairedAppFixtures = { launchPairedApp: (options?: LaunchPairedAppOptions) => Promise<PairedApp> }`, module-private `SEEDED_ROW`, `DUMMY_TOKEN`, `encodePairingPayload`, and the drive selectors.

Exported-symbol count = 2 types + 1 helper + the standard `test`/`expect` re-export pair. Under the red line.

### The factory fixture

`launchPairedApp` is a **factory fixture**, not a value fixture — each spec passes different reply options, which a plain value can't accept. The fixture yields a function; the fixture's own epilogue (after `use`) tears down every resource the function created.

```ts
launchPairedApp: async ({}, use, testInfo) => {
  testInfo.setTimeout(LAUNCH_TEST_TIMEOUT_MS)   // fixture owns the 60 s budget (see § Timeout)
  const teardown: Array<() => Promise<void>> = []  // drained LIFO in the epilogue
  await use(async (options = {}) => { /* create resources, drive UI, return PairedApp */ })
  for (const step of teardown.reverse()) { try { await step() } catch { /* best-effort */ } }
}
```

Inside the factory, in this exact order (each pushes its teardown thunk the moment its resource comes up, so a mid-drive failure still cleans up whatever was created):

1. `userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-'))` → push `() => rm(userDataDir, { recursive: true, force: true })`.
2. `forwarder = await startFakeRelayForwarder()` → push `() => forwarder.close()`.
3. `daemon = await startFakeDaemon({ url: forwarder.url, buildReply: () => seedConversationsFrame(), ...options })` → push `() => daemon.close()`.
4. `app = await electron.launch({ args: ['.', \`--user-data-dir=${userDataDir}\`], env })` with `env = { ...process.env }` minus `ELECTRON_RENDERER_URL`, plus `LOOPBACK_RELAY_ENV_FLAG='1'` and `TEST_SECRET_BACKEND_ENV_FLAG='1'` → push `() => app.close()`.
5. `page = await app.firstWindow()`.
6. Run the drive (below).
7. `return { page, app, daemon }`.

**Default seeding + precedence (AC1/AC4).** The default `buildReply: () => seedConversationsFrame()` seeds the one-row list so the `list → thread` path exists with the spec supplying nothing. `...options` spreads *after* the default, so a caller's `buildReply`/`buildReplyFrames` wins. Because `fakeDaemon` prefers `buildReplyFrames` over `buildReply` whenever set (fakeDaemon.ts:383), a spec that passes `buildReplyFrames` makes the default seed dead code — and is therefore responsible for seeding the row on its own default arm via the exported `seedConversationsFrame()`. This is exactly `send-and-stream`'s shape.

### The drive (fixture-owned; runs inside the factory before it returns)

All pairing/navigation selectors live here; per-flow **assertion** selectors stay in the specs. Steps, each auto-waited:

- Build the pasted payload with `encodePairingPayload({ server: 'fake-daemon', relay: \`${forwarder.url}/v1/client\`, token: DUMMY_TOKEN, server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64') })`. `encodePairingPayload` = JSON → `base64url`, no `pyry://` wrapper (mirrors the daemon's `pair.Encode`).
- `expect(page.locator('textarea[aria-label="Pairing code"]')).toBeVisible()` — settles the pending→pairing route before pasting.
- Fill the paste box, click `getByRole('button', { name: 'Pair', exact: true })`.
- `expect(page.locator('[aria-label="Server key fingerprint"]')).toBeVisible()` — proves the loopback `ws://` relay was accepted (#97 active).
- Click `getByRole('button', { name: 'Confirm', exact: true })`.
- Click `page.locator('.channel-list__row-open')` — the one real `list → thread` step. This is a **real product-UI navigation** (`onClick` → dispatch `open` → route `'thread'`), never a test hook / forced route dispatch / store mutation (AC1/AC3). The seeded row renders only after the handshake completes (the connected rising edge fires `list_conversations` → the one-row reply arrives), so this click's auto-wait *is* the connected gate.
- `expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })` — Send enables only on the `connected` daemon event, i.e. after the real Noise_IK handshake terminates at the fake daemon. This is the fixture's completion signal; the factory resolves here.

The invariant these steps assert (fixture reaches "connected thread, Send enabled") is verified end-to-end by the two migrated specs — see § Testing.

### Teardown / LIFO model (AC2)

The `teardown` stack is pushed in creation order (`rm`, `forwarder.close`, `daemon.close`, `app.close`) and drained in **reverse** in the fixture epilogue, giving the exact AC2 order:

`app.close()` → `daemon.close()` → `forwarder.close()` → `rm(userDataDir)`.

App-first is load-bearing: the app closes before the fake target's socket drops, so the relay supervisor can't churn-reconnect / emit a spurious `failed`. `userDataDir` removal is last because the app process (the only writer of that dir) is already down. Because the epilogue runs after `use` through Playwright's fixture lifecycle, it fires on pass **and** fail — a failing test never orphans an Electron process. Registering each thunk as its resource comes up (not after the whole drive succeeds) keeps a partial-launch failure (e.g. the row click times out) from leaking resources. Each thunk is best-effort (`try/catch`) so one failure doesn't abort the rest of the LIFO drain; `close()` on both fakes is already idempotent.

### Returned handle (AC3)

`PairedApp = { page, app, daemon }`. `daemon` is the full `FakeDaemon` handle, so a spec can `pushFrame` a server-initiated frame, `initiateRekey`, `await whenSettled()`, read `staticPublicKey`, or `close` early. The forwarder is intentionally **not** exposed — neither migrating spec needs it, and AC3 lists only these three. A future reconnect spec (#434 family) that needs `forwarder.dropClientLeg()` can widen the handle in its own architect run; adding it now would be speculative (see Open Questions).

### Timeout ownership

The fixture calls `testInfo.setTimeout(LAUNCH_TEST_TIMEOUT_MS)` (≈ 60 000 ms) in setup, so the migrated specs drop their per-test `test.setTimeout(TEST_TIMEOUT_MS)`. Any test using this fixture inherently needs the extended budget (launch + wasm compile + handshake), so owning it in the fixture removes that boilerplate from every consumer. The internal Send-enabled wait keeps its own `HANDSHAKE_TIMEOUT_MS` (≈ 15 000 ms) as element-level headroom. (Fallback if `testInfo.setTimeout` in a factory fixture proves awkward: keep `test.setTimeout(…)` in each spec body — but prefer fixture ownership.)

## Spec migration (AC5)

Both specs `import { test, expect } from './fixtures/launchPairedApp'` and drop their `base` import, their `forwarder/daemon/page` `test.extend` block, `Fixtures` type, `encodePairingPayload`, `DUMMY_TOKEN`, and the launch/env/user-data-dir plumbing.

**`pair-to-conversation.spec.ts`** goes thin: `const { page } = await launchPairedApp()`, then assert the milestone end-state (`.conversation` visible, `Send` enabled). The fixture's drive already proves the pairing-screen → connected-thread transition, so the pre-state `toHaveCount(0)` absent-check is subsumed and dropped. Drop its `SEEDED_ROW`/`buildReply` (now fixture-default) and its wire-type imports it no longer references.

**`send-and-stream.spec.ts`** keeps its reply-frame builders (`assistantDeltaFrame`, `turnEndFrame`, `REPLY_TEXT`, `TURN_ID`, `FIXED_TS`, `TYPED_TEXT`) and its `buildReplyFrames` dispatcher, but its default arm returns `[seedConversationsFrame()]` (imported from the fixture) instead of a locally-declared `conversationsSeed`/`SEEDED_ROW`. It calls `const { page } = await launchPairedApp({ buildReplyFrames })`, then runs its type → send → assert-user-bubble → assert-streamed-daemon-bubble steps unchanged. It keeps its own `decodeEnvelope`/`encodeEnvelope` and the wire-type imports its frames need.

`npm run e2e` (which runs `npm run build` then `playwright test`) stays green.

## Error handling + security discipline

Carried verbatim from the specs (preserve, don't relax): the pasted payload's `token` is the synthetic `DUMMY_TOKEN`, never a real credential; the fake daemon's `staticPublicKey` terminates the handshake at the fake. No failure diagnostic serializes the payload, token, or any plaintext — every fixture assertion reads DOM visibility / enabled-state / text only. The two dev flags are `app.isPackaged`-gated; a launched-from-`.` build is `!isPackaged`, so the flags take effect and the fixture relaxes no production validation itself. If the drive fails (e.g. fingerprint never renders, row never becomes clickable), the auto-wait times out with a plain Playwright locator message — no secret material in the throw.

## Testing strategy

- No standalone unit test for the fixture — its coverage *is* the two e2e specs it powers. They exercise the full drive (pair → connected thread → Send enabled) and, via Playwright's lifecycle, the LIFO teardown on both pass and fail.
- Verification gate: `npm run e2e` green with both migrated specs passing (serialized, `workers: 1`). `pair-to-conversation` proves the connected-thread milestone; `send-and-stream` proves the streamed round-trip on top of the same fixture.
- e2e/ is **not** covered by the project's typecheck config (neither tsconfig includes `e2e/`); Playwright transpiles without type-checking. A standalone `tsc --noEmit` pass over the e2e files (or reliance on the QA gate) catches any type drift in the fixture's exported surface — worth a manual check given the new exported types.

## Open questions

- **Forwarder in the handle?** Deferred — no in-scope spec needs `forwarder.dropClientLeg()`. If #434 (stateful fake) or a reconnect spec needs it, widen `PairedApp` to `{ page, app, daemon, forwarder }` then; it's a purely additive change to this fixture.
- **Timeout mechanism.** `testInfo.setTimeout` in the factory fixture is the preferred owner; if the developer finds it doesn't take effect for the factory shape, fall back to per-spec `test.setTimeout(…)`. Either satisfies the contract.
