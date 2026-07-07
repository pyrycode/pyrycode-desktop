# Spec: E2E — pair through the window against the fake relay + fake daemon, reach the conversation screen (#93)

**Size:** S. **One new file** — `e2e/pair-to-conversation.spec.ts`. **Zero production-source edits**, zero config/package edits: it reuses existing selectors (adds no test-only markup to `src/`), the existing `e2e` script (`npm run build && playwright test`), and the two already-merged, `app.isPackaged`-gated dev affordances (#97, #99). It imports the existing electron-free fake targets (#90, #91) and drives the real pairing UI.

## Design source

N/A — no user-visible UI is added. This is test infrastructure (like #40): it drives the **existing** `PairingScreen` and `ConversationScreen` through their existing DOM selectors and asserts a transition. No new markup, no theme tokens, nothing to fetch from Figma. The visual-fidelity check is intentionally not applicable.

## Files to read first

- `src/main/daemonConnection.roundtrip.test.ts:154-205` — **the canonical wiring to mirror.** `standUpRoundTrip` boots `startFakeRelayForwarder()` + `startFakeDaemon({url})`, builds the `PairedServerRecord` (relay = `` `${forwarder.url}/v1/client` ``, `server_static_pubkey` = base64-std of `daemon.staticPublicKey`, a synthetic dummy token), and its LIFO teardown discipline (stop the client before dropping the fake target). This spec drives the SAME target through the UI instead of constructing the connection directly.
- `e2e/fixtures/electronApp.ts` (whole, 45 lines) — the scenario-agnostic launch primitive. **Read it, do NOT edit it** (AC + technical note: it must stay scenario-agnostic). Copy its two hardening moves into this spec's own launch: `args: ['.']` (launches the built app) and stripping `ELECTRON_RENDERER_URL` from the child env. This spec cannot reuse its `page`/`electronApp` fixtures because they hardcode the env — it launches its own app with extra env + an isolated user-data dir.
- `e2e/smoke.spec.ts` (whole, 11 lines) — the existing spec idiom. Note its `.conversation`-at-boot assertion passes only on the **shared** userData carrying a stale leftover pairing (written in #40, before the #80 router). It is non-hermetic; **do not emulate it and do not reconcile against it** — this scenario launches with an isolated userData so it starts genuinely unpaired.
- `playwright.config.ts` (whole) — `testDir: './e2e'`, `workers: 1`, default 30 s test timeout. No change needed; confirm the shape.
- `src/main/transport/fakeRelayForwarder.ts:20-38` (the `FakeRelayForwarder` handle) and `84-200` (`startFakeRelayForwarder`) — `url` / `whenReady` / `close`. **`whenReady()` resolves only once BOTH legs connect**, and the client leg connects only after paste+confirm dials it — so do NOT await `whenReady` before pasting (it would block until timeout).
- `src/main/transport/fakeDaemon.ts:54-90` (`FakeDaemonOptions` / `FakeDaemon` handle) and `101-124` (`startFakeDaemon`) — `staticPublicKey` (32 B), `whenSettled`, `close`. Its `/v1/server` leg is OPEN when `startFakeDaemon` resolves, so the client's msg1 is never dropped. The default `buildReply` echoes; `#93 sends no message`, so `whenSettled()` stays pending (it settles `ok` only on a transport frame — that's #94's concern).
- `src/main/pairingPayload.ts:28-55` (reject reasons + `RELAY_ALLOWLIST`) and `101-174` (`parsePairingPayload`) — the parse gate. Explains WHY #97 is load-bearing: a `ws://…` relay is rejected `relay-scheme-not-wss` under the production policy; only the loopback affordance accepts it, so **reaching the fingerprint card proves #97 is active**. Also: the outer payload is base64url of a 4-field JSON object; there is NO `pyry://` wrapper (the textarea placeholder is a mockup).
- `src/main/pairingPayload.test.ts:14-17` — the `b64url` encode helper to mirror: `Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')` (URL-safe, no padding — the strict alphabet the gate requires).
- `src/main/relayPolicy.ts:25` — `LOOPBACK_RELAY_ENV_FLAG = 'PYRY_ALLOW_LOOPBACK_RELAY'`. Import this constant to single-source the flag name. (Module is electron-free — its only import is a type from `pairingPayload`.)
- `src/main/secretBackend.ts:27` — `TEST_SECRET_BACKEND_ENV_FLAG = 'PYRY_TEST_SECRET_BACKEND'`. Import it too. (Module is electron-free — `import type` only.)
- `src/main/index.ts:117-124` (secret-backend selection) and `161-178` (relay-policy selection + `onPaired: () => connection.reconnect()`) — the composition root reads both flags from `process.env` and gates on `app.isPackaged`; **`reconnect()` is what kicks off the handshake after a successful confirm.** Confirm the flags reach the built app via `process.env` (they do — the child env this spec sets is what `process.env` reflects).
- `src/renderer/src/App.tsx:38-66` — **the router. THE load-bearing subtlety:** `onPaired` (fired on `confirm-succeeded`) calls `setRoute('conversation')`. The mid-session flip to `.conversation` gates on the confirm IPC succeeding (record persisted), NOT on the handshake. `routeForStatus` gates only the LAUNCH-time initial screen.
- `src/renderer/src/appRoute.ts` (whole) — `routeForStatus`: isolated userData → `not-paired` → `pairing` screen at boot (fail-safe: only `paired` → `conversation`).
- `src/renderer/src/screens/pairing/PairingScreen.tsx:94-101` (paste `textarea[aria-label="Pairing code"]` + the `Pair` button), `124-159` (fingerprint block `[aria-label="Server key fingerprint"]` + the `Confirm` button), `187-194` (confirm → `onPaired` on `confirm-succeeded`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:51-127` — the `Composer`: the Send button is `<button aria-label="Send" disabled={!canSend}>`. **This is the DOM-observable handshake signal.**
- `src/renderer/src/screens/conversation/composerSend.ts:95-108` — `composerAvailability`: ONLY `status.type === 'connected'` yields `canSend: true`; every other status yields `canSend: false`. So the Send button enabling ⇔ the `connected` event arrived ⇔ the Noise_IK handshake completed.

## Context

This is the first e2e scenario that drives the **built** app's main-process transport at a controllable target rather than the live relay + real `pyry` daemon. It builds on the #40 launch/teardown harness and the #80/#84 app-shell router, and consumes the in-process fake relay forwarder (#90) + fake Noise_IK responder daemon (#91) — the same doubles the transport-level round-trip test (#89) drives. Where #89 constructs `createDaemonConnection` directly, this scenario enters through the **real pairing screen**: paste → fingerprint → confirm → the app dials and handshakes on its own.

Both blockers are merged. This scenario is their consumer and relaxes no validation itself; it only sets their two env flags for the run:

- **#97** (`selectRelayPolicy`, `relayPolicy.ts`) — set `PYRY_ALLOW_LOOPBACK_RELAY=1` so the built app accepts the fake `ws://127.0.0.1:<port>` relay when parsing the pasted payload. Without it, `Pair` (submit) rejects `relay-scheme-not-wss` and the fingerprint card is never reached.
- **#99** (`selectSecretEncryption`, `secretBackend.ts`) — set `PYRY_TEST_SECRET_BACKEND=1` so `secureStore.set` does not fail closed in a keychain-less runner. Without it, `Confirm` fails `persist-failed` and the route never flips.

Both affordances are `app.isPackaged`-gated inert in packaged builds; a launched-from-`.` build is `!isPackaged`, so the flags take effect exactly here.

### Evidence model — reconcile AC5's wording with the code (READ THIS)

AC5 says "only after a successful Noise_IK handshake does the window route to the conversation screen (`.conversation` visible)." **Against the current code that is imprecise**, and the test must not rely on it: the route flip to `.conversation` fires from `App.onPaired`, which is wired to `PairingScreen`'s `confirm-succeeded` — i.e. the confirm IPC **persisting the record**, not the handshake. The handshake is kicked off *separately* by the main-process `onPaired: () => connection.reconnect()` (index.ts) and completes a network round-trip later. The ticket's "router gates on pairing status" note describes the **launch-time** `routeForStatus` path (initial screen), not the post-confirm transition.

So the two DOM observables carry **different** proofs, and the test asserts BOTH:

| Observable | Proves |
|---|---|
| Fingerprint card `[aria-label="Server key fingerprint"]` appears after `Pair` | `parsePairingPayload` accepted the loopback `ws://` relay → **#97 active** |
| `.conversation` visible after `Confirm` | confirm IPC persisted the record (`secureStore.set` succeeded) → **#99 active** + pair-through-UI works |
| Send button `[aria-label="Send"]` becomes **enabled** | the `connected` daemon event reached the renderer store → **Noise_IK handshake completed** |

Together these deliver AC5's *intent* (prove the handshake via the built UI) faithfully. The Send-enabled assertion is **required**, not optional — it is the only DOM-observable handshake proof; `.conversation` alone would pass even if the handshake later failed. #89 already proves the handshake is deterministic through this exact assembled stack + fake daemon, so Send-enabled is a reliable (non-flaky) signal here.

## Design

### Single new file: `e2e/pair-to-conversation.spec.ts`

A local Playwright `test.extend` (in this file only — the shared fixture stays untouched) provides three fixtures whose `use()` epilogues tear down on pass *and* fail (the property `electronApp.ts` was built for). Contracts, not bodies (each `use` body is ~3-6 lines):

- **`forwarder`** — `startFakeRelayForwarder()` → `use(fwd)` → `await fwd.close()`.
- **`daemon`** (depends on `forwarder`) — `startFakeDaemon({ url: forwarder.url })` → `use(d)` → `await d.close()`. Default `buildReply` is fine (no message is sent).
- **`page`** (depends on `daemon`, so teardown closes the app *before* the fake targets — the roundtrip test's stop-client-before-forwarder LIFO) — create a fresh per-run user-data dir, launch the built app, hand the first window to the test, then `await app.close()` and remove the dir. The dependency on `daemon` is for teardown ordering only; the value is unused in this fixture.

Launch shape inside the `page` fixture (mirrors `electronApp.ts`'s hardening, plus this scenario's env + isolation):

```ts
// env: strip the dev-server override, enable both affordances
const env = { ...process.env }
delete env.ELECTRON_RENDERER_URL
env[LOOPBACK_RELAY_ENV_FLAG] = '1'      // imported from ../src/main/relayPolicy
env[TEST_SECRET_BACKEND_ENV_FLAG] = '1' // imported from ../src/main/secretBackend
// isolated userData → genuinely unpaired start
const userDataDir = await mkdtemp(join(os.tmpdir(), 'pyry-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
```

`--user-data-dir` is the Electron command-line switch that overrides `app.getPath('userData')`; passing it in `args` isolates every persisted secret to a throwaway dir, so the launch-time pairing-status query resolves `not-paired` and the router shows the pairing screen (see Open questions for the position-in-`args` verification note).

### Pairing payload construction (in the test body)

The fake target's coordinates flow into the app through the **pasted payload** (typed into the real textarea), not through env — that is the whole point of driving the pairing UI. Build a `QrPayload` and encode it in two layers:

- Fields: `server` = any non-empty label (e.g. `'fake-daemon'`); `relay` = `` `${forwarder.url}/v1/client` `` (a `ws://127.0.0.1:<port>/v1/client` URL — loopback, no userinfo, so it passes #97 + the un-relaxed `relay-has-credentials` check); `token` = a **synthetic literal, never a real credential** (e.g. `'dummy-token-not-a-real-credential'`, mirroring the roundtrip test); `server_static_pubkey` = `Buffer.from(daemon.staticPublicKey).toString('base64')` (standard base64 with padding — identical to the codec's `base64StdEncode`, so no `codec` import is needed).
- Outer encoding: `Buffer.from(JSON.stringify(qr), 'utf-8').toString('base64url')` — the strict, no-padding base64url the gate requires (mirror `pairingPayload.test.ts:14-17`).

### Assertion sequence (one test)

Written as scenario steps; the developer writes them in Playwright's idiom (`expect(...).toBeVisible()` etc. auto-wait, absorbing React's async mount and the IPC round-trips):

1. **Pre-state (AC4).** Assert `textarea[aria-label="Pairing code"]` is visible (the pairing screen's editing phase), and `.conversation` has count 0 (not mounted) — so the later transition, not a static end-state, is the evidence.
2. **Paste.** `fill` the textarea with the base64url payload.
3. **Submit.** Click the `Pair` button — `getByRole('button', { name: 'Pair', exact: true })` (exact avoids the busy `Pairing…` label and the `Cancel` button).
4. **Fingerprint (proves #97).** Assert `[aria-label="Server key fingerprint"]` is visible — the reviewing phase, reached only because the loopback relay parsed. (No need to compare the fingerprint text to a known value; its presence is the proof.)
5. **Confirm.** Click `getByRole('button', { name: 'Confirm', exact: true })`.
6. **Route flip (proves #99 + pair-through-UI).** Assert `.conversation` is visible.
7. **Handshake (proves Noise_IK completed).** Assert `getByRole('button', { name: 'Send' })` is **enabled** — it starts disabled at conversation-mount (status `connecting`/`disconnected`) and enables only on the `connected` event.

### What stays out

No package.json / playwright.config / vitest.config edits (the `e2e` script and `testDir` already cover this file). No `src/` changes — selectors are reused as-is. No new exported types. No knowledge-doc AC (documentation phase owns `docs/knowledge/codebase/93.md`, written after merge).

## State + concurrency model

No app state changes — this is a test-side process supervisor. Concurrency is Playwright's: `workers: 1` serializes Electron launches (config unchanged). The three fixtures scope one forwarder + one daemon + one app to the single test; the fixture `use()` lifecycle tears each down on pass and fail (no manual `afterEach`). **Teardown order is LIFO by the fixture dependency chain** (`page` → `daemon` → `forwarder`): the app closes first so its supervisor cannot churn-reconnect / emit a spurious `failed` when the fake target's socket drops — the same discipline the roundtrip test enforces with its reversed cleanup array. Ordering note that is *already handled by the doubles*: `startFakeDaemon` resolves with its `/v1/server` leg OPEN, and the client dials `/v1/client` only after confirm — so msg1 is never dropped, with no explicit `whenReady` barrier needed in the test.

## Error handling

Every failure surfaces as a Playwright timeout with a descriptive locator diagnostic — no silent pass:

- **#97 flag not taking effect** → `Pair` rejects, the fingerprint card never appears → step 4 times out.
- **#99 flag not taking effect** → `Confirm` fails `persist-failed`, the route never flips → step 6 times out.
- **Handshake fails** (wrong pubkey, splice/role-map error) → the `connected` event never arrives, Send stays disabled → step 7 times out.
- **Stray `ELECTRON_RENDERER_URL`** → neutralised by the env strip (as in `electronApp.ts`).
- **Orphaned processes / leftover userData** → prevented by fixture-lifecycle teardown + per-run `mkdtemp` + removal.

Optional diagnostic aid (not required): `daemon.whenSettled()` and `forwarder.whenReady()` are available if a failing run needs a sharper "did the splice/handshake even start" signal, but the DOM assertions above are the acceptance evidence — keep the test lean and prefer them.

## Security review (this ticket is `security-sensitive`)

This scenario is a **consumer** of two already-audited, packaged-inert dev affordances (#97, #99); it relaxes no production validation and ships no code. The adversarial pass walked:

- **Trust boundary / untrusted input.** The pasted payload is the production trust boundary. The test drives the **real** `parsePairingPayload` gate end to end — base64url → UTF-8/JSON → 4-field validation → relay scheme+host (via the injected policy) → embedded-credentials check — and bypasses none of it. Its payload is a legitimate loopback relay (`ws://127.0.0.1:<port>/v1/client`, no userinfo). The gate stays the single enforcement site.
- **Dev-affordance escape.** Both flags are `isPackaged`-false-first inert (`relayPolicy.ts:54`, `secretBackend.ts:77`). The spec launches a `!isPackaged` build (`args: ['.']`) — the intended dev/test context — and edits neither gate, so **every packaged build is byte-identical to today** regardless of these flags. The keychain-free backend (a reversible XOR transform, not crypto) is reachable only through the gate and never in a shipped build.
- **Secrets / key material.** The token is a **synthetic literal** (mandated in Design, mirroring the roundtrip test's `DUMMY_TOKEN`); the device static keypair is minted fresh in-process by the app; the fake daemon's static is a synthetic CSPRNG key. No real credential or key exists in this flow. All of it is written only to a throwaway per-run `mkdtemp` userData that teardown removes — no contamination of the developer's real app userData, and the shared stale pairing cannot contaminate the run. **Hardening (folded into Design/Error handling): no failure diagnostic may serialize the pasted payload or any secret** — the DOM assertions read visibility/enabled-state only; keep it that way so a future real-credential variant cannot inherit a leaky pattern.
- **Attack-surface expansion.** None shipped: a test-only file under `e2e/`, never bundled; the forwarder binds `127.0.0.1:0` only for the test and closes at teardown; the two flags are set on a `{ ...process.env }` **copy** passed to `electron.launch`, so the parent and any sibling process env is untouched.

**Verdict: PASS.** No new production seam, no secret leak, no shipped surface. The security-load-bearing checks (`relay-not-url`, `relay-has-credentials`, `isPackaged` gating) all remain in force on the path this test exercises.

## Testing strategy

The deliverable **is** the test — one e2e scenario, run by `npm run e2e` (builds, then `playwright test` over `e2e/`). No new unit tests (no new `src/` production code). Layering is unchanged: `npm test` (vitest, `src/` only) and `npm run typecheck` do not touch `e2e/`; Playwright transpiles the spec + its `src/` imports at run time. Acceptance = the single test passes: an isolated-userData built app, driven through the real pairing UI against the in-process fake target, reaches `.conversation` and enables Send.

## Open questions

- **`--user-data-dir` position in `args`.** Electron scans argv for the switch regardless of position, and `.` remains the first non-switch arg (app path). `args: ['.', '--user-data-dir=…']` is expected to work; if the app path fails to resolve, try `['--user-data-dir=…', '.']`. Verify empirically on the first run (a wrong-isolation symptom is the app booting straight to `.conversation` on the shared userData, exactly the `smoke.spec.ts` non-hermetic behaviour to avoid).
- **Playwright resolving the `src/` imports.** The spec imports `startFakeRelayForwarder` / `startFakeDaemon` (which pull `noise-c.wasm`, `codec`, `ws`, wire types — all electron-free and proven under vitest) plus the two flag constants. Confirm Playwright's TS loader transpiles them and the wasm loads in its Node context on the first run; the fake-daemon's one-time wasm compile is the main setup latency (well within the 30 s test timeout, but if a cold CI runner is tight, warm it in a `test.beforeAll` via `loadNoiseLib()` as the roundtrip test does). If the wasm import misbehaves under Playwright specifically, that is the single integration risk to surface early.
- **Headless CI.** No CI today; when added, Electron e2e on headless Linux needs `xvfb-run` (macOS dev runs headful). Not scoped here; noted so it is not a surprise.
