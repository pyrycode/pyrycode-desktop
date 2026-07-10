# #252 — UI-driven real-claude e2e: pair, send, assert the reply streams twice

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/252
**Size:** S · **Labels:** `enhancement`, `security-sensitive`
**Depends on:** #251 (routing-aware fake relay — merged, PR #253), #179 (interactive flip — merged), #97/#99 (loopback relay + keychain-free secret backend — merged), #40 (Playwright/Electron harness — merged)

## Design source

N/A — this ticket adds an end-to-end **test**, not UI. No new markup, no visual surface. (The reply/user rows it asserts against already shipped in #179; this spec only reads their selectors.)

## Files to read first

Codegraph is not initialised for this repo (`mcp__codegraph__*` errors here) — this list is built from direct reads.

**Desktop (this repo):**
- `e2e/send-and-stream.spec.ts` (all 175 lines) — **the template.** Reuse: the isolated `--user-data-dir`, the two `app.isPackaged`-gated env flags, the `encodePairingPayload` helper, the local-fixture (`test.extend`) LIFO-teardown pattern, and the exact pairing steps. **Do NOT copy its reply/user selectors** (`data-message-role="daemon"`/`"user"` at lines 166/171) — those are the stale non-interactive path (see Design § Selectors).
- `src/main/transport/fakeRoutingRelay.ts:27-45,121-272` — `startFakeRoutingRelay()` API you dial: `url` (no trailing path), `whenReady(timeoutMs?)`, `close()`; the `/v1/client` (raw) + `/v1/server` (routing) legs; the "client frame dropped while server leg not OPEN" behaviour (§ Concurrency).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:120-214` — the row markup you assert: `data-thread-role="assistant"` reply bubble (line 154) with the **child cursor span** `▎` (lines 160-164); `data-thread-role="user"` echo (line 208); `data-thread-role="tool"` chip (line 188). The cursor-inside-the-bubble is the non-empty-text trap (§ Assertions).
- `src/renderer/src/screens/conversation/composerSend.ts:17,43-67` — `MILESTONE_CONVERSATION_ID = 'default'` (the exact literal the app sends, verbatim) and the `send_message` payload shape. This is why the daemon registry must be seeded to bind `'default'` (§ The binding problem).
- `src/renderer/src/store/threadTimeline.ts:49-55,122,150-155` — the reducer: `assistantDelta` coalesces onto the tail; `turnEnd` appends a `turnBoundary` (closes the cursor). Grounds the per-turn quiesce signal.
- `src/main/relayPolicy.ts:25,50-55` — `LOOPBACK_RELAY_ENV_FLAG = 'PYRY_ALLOW_LOOPBACK_RELAY'`; set to `'1'` on the **app** so the payload's loopback `ws://` relay bypasses the prod allowlist (unchanged from #94).
- `src/main/secretBackend.ts:27,72-78` — `TEST_SECRET_BACKEND_ENV_FLAG = 'PYRY_TEST_SECRET_BACKEND'`; set to `'1'` on the app for a keychain-free secret backend (headless).
- `src/shared/wire/types.ts` (grep `QrPayload`) — the paste payload shape: `{ server, relay, token, server_static_pubkey }`. `server_static_pubkey` is canonical base64-**std** (padded).
- `e2e/pair-to-conversation.spec.ts` (#93) — the pairing-flow reference #94 is built on; confirms the paste/Pair/Confirm/Send-enabled selectors.
- `playwright.config.ts` (all 17 lines) — you add a `testIgnore` here; the new spec runs under a second config.
- `e2e/fixtures/electronApp.ts` — the shared launch primitive. **Note:** #94 deliberately does NOT use it (it needs local relay/daemon fixtures); #252 follows suit with inline fixtures.

**Sibling `pyrycode` repo (reference only — may NOT be in your worktree; every load-bearing value is inlined in this spec, do not block on reading these):**
- `internal/e2e/realclaude/interactive_bootstrap_liveness_test.go` — the daemon-side twin (#854). `spawnBootstrapDaemon` (spawn args), `seedBootstrapRegistry` + `seedBoundConversation` (the registry JSON you replicate), `drainForAssistantReply` (the two-turn liveness shape).
- `internal/e2e/realclaude/fixtures.go:96-143` — `WithWorktreeAuthenticated` (the isolated-HOME-with-real-claude-creds recipe).

## Context

Every current Desktop e2e (#89 transport round-trip, #93/#94 UI pair/send/stream) runs against a fake relay + a fake daemon that **always answer**. They stay green even if the real daemon never responds. This ticket is the thin client-layer net over the daemon-side liveness test (#854): drive the **real** stack — real `pyry`, real claude on `--model haiku`, #251's content-blind routing relay — with the built Electron UI standing in for #854's headless phone.

Two prerequisites landed, making this reachable and turning it into an additive test:
- **#179** — the desktop advertises the `interactive` capability and renders the daemon's structured reply into the timeline as `data-thread-role="assistant"`. Before it, a non-interactive client got *no reply* from a v2 daemon.
- **#251** — `startFakeRoutingRelay()`: a raw `/v1/client` leg (byte-identical to what the app dials) and a routing-envelope `/v1/server` leg (what a real daemon registers on), multiplexed by `conn_id`, token injected into the first frame per conn.

Because there is no CI (org policy), this test earns its keep only by running in the operator's pre-ship gate alongside `npm run build` and `npm test` — hence it is gated out of the agent-pipeline `npm run e2e`.

**Scope headline: this ticket changes zero production `src/` code.** The app, as built, already works against the real daemon+relay. The entire deliverable is one new spec + its config + gating wiring. If you find yourself editing anything under `src/`, stop and re-read — the seam you need already exists.

## The binding problem (the ticket's must-resolve-first open question) — RESOLVED

The desktop sends `conversation_id: 'default'` (`MILESTONE_CONVERSATION_ID`, hard-coded, sent verbatim) and **cannot** seed the daemon's registry from the client side.

A fresh real daemon does **not** auto-bind an ad-hoc `'default'` conversation. Verified in the daemon (`internal/relay/handlers/send_message.go:145-165`): `send_message` calls `router.Route(conversationID)` *before* enqueue and rejects an unbound/unknown conversation — `ErrConversationNotFound` → non-retryable `conversation.not_found`; a known-but-unbound conversation → retryable `server.binary_offline`. It never falls through to the bootstrap session (#678). So an un-seeded `'default'` would be rejected and no reply would ever stream — the turn would time out.

Two facts make seeding work:
1. `ConversationID` is an **opaque string**, not a validated UUID — *"Format conventions (UUIDv4 vs. other) are not fixed here"* (`internal/conversations/conversation.go:17-18`). Lookup is by string equality. So `'default'` is a legal conversation id.
2. The daemon loads its registry **once at startup** (no reload). Seeding files on disk *before* spawn is sufficient.

**Resolution: the fixture seeds the daemon's registry before spawn**, exactly mirroring #854's `seedBootstrapRegistry` + `seedBoundConversation`, with the one change that the bound conversation id is the literal `'default'` (not a UUID). This binds `'default'` → the seeded bootstrap pool session, so `router.Route('default')` resolves and the reply stream binds (via the #854 PID-probe path already merged on the daemon side).

## Design

### Module / file structure

Additive only. No `src/` changes.

| File | New/Edit | Purpose |
|------|----------|---------|
| `e2e/real-claude.spec.ts` | **new** | The spec: inline relay/daemon/page fixtures (#94 pattern), pairing flow, two-turn liveness loop. |
| `playwright.real-claude.config.ts` | **new** | Second config: `testMatch` the real-claude spec only; long test timeout; `workers: 1`, `retries: 0`. |
| `playwright.config.ts` | edit | Add `testIgnore` so the default `npm run e2e` (agent pipeline) never picks up the real-claude spec. |
| `package.json` | edit | Add `"e2e:real-claude"` script running the second config. |
| `README.md` | edit | Document the command + prerequisites as part of the operator pre-ship gate. |

Keep the daemon/relay fixtures **inline in the spec** (as #94 keeps its forwarder/daemon fixtures local). This holds the new-file count at two and matches the established pattern. Do not create a shared fixture module.

### Fixtures and teardown ordering (contracts)

Three `test.extend` fixtures, chained so creation order is `relay → daemon → page` and teardown is LIFO `page → daemon → relay` — the app closes first so its supervisor can't churn-reconnect (or emit a spurious `failed`) when the daemon/relay drop, exactly as #94 enforces.

```ts
type RealClaudeFixtures = {
  relay: FakeRoutingRelay            // startFakeRoutingRelay() from #251
  daemon: SpawnedDaemon              // real pyry + claude; see contract below
  page: Page                         // built Electron window, guaranteed-unpaired start
}

// The daemon fixture yields only the three credential fields decoded from
// `pyry pair` stdout. The `relay` field of the pasted QrPayload is assembled
// test-side from `relay.url` (the #251 relay), never from pyry's output.
interface SpawnedDaemon {
  pairFields: Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>
}
```

- `relay` fixture: `await startFakeRoutingRelay()` → teardown `await relay.close()`.
- `daemon` fixture (depends on `relay`): performs the skip-gating, credential provisioning, `pyry pair`, registry seeding, and daemon spawn (below) → teardown reaps the process group and removes the temp dirs.
- `page` fixture (depends on `daemon`): launches the built app with the two env flags + an isolated `--user-data-dir` (verbatim from #94 lines 107-116) → teardown closes the app and removes its data dir.

### Skip-gating (the daemon fixture, before any spawn)

The real stack needs binaries + credentials the agent pipeline lacks. Resolve them up front and **skip cleanly** (`test.skip(condition, reason)`) when absent — an unrun-because-unavailable is correct; a hard failure would be noise:

- `claude` binary — resolve on `PATH`. Absent → skip.
- `pyry` binary — resolve via `PYRY_BIN` env override, else `pyry` on `PATH`. Absent → skip with a message pointing at "build pyry from a #854-inclusive tree". (Do not attempt `go build` from the fixture — keep it simple; the pre-ship doc tells the operator to build it.)
- Credentials — read `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` from the outer env. **Both empty → skip** with the Keychain-extraction hint (see § Credential provisioning). On the OAuth path, also require a readable operator `~/.claude.json` — unreadable → skip.

### Credential provisioning — isolated HOME, real creds (mirrors `WithWorktreeAuthenticated`)

The daemon needs an **isolated HOME** (empty `~/.pyry` registry + empty claude sessions dir = a genuinely fresh daemon) but real claude needs the operator's credentials, which live in the *real* HOME. Reconcile exactly as the Go fixture does:

1. **Before** isolating: capture `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`; on the OAuth path, read the operator's real `~/.claude.json` bytes (from the real `HOME`).
2. Create the isolated daemon HOME: `daemonHome = await mkdtemp(join(tmpdir(), 'pyry-daemon-'))`, and `workdir = join(daemonHome, 'work')` (mkdir). The isolated workdir guarantees an empty claude sessions dir.
3. When spawning `pyry pair` and the daemon, pass `env` = `{ ...process.env, HOME: daemonHome, <the captured cred var(s)> }`. On the OAuth path, write the captured bytes to `join(daemonHome, '.claude.json')` at mode `0o600` **so interactive (PTY) claude skips the onboarding theme picker** — without it, ptyrunner reads the picker glyph as "ready" and the turn deadlocks (#496).

Note the app's `--user-data-dir` (its unpaired-start isolation) is a **separate** temp dir from the daemon's HOME. Two isolations, two dirs.

### Pairing — mint against the real daemon, dial the test relay

1. Run `pyry pair -pyry-name=test --name=<device-name>` as a subprocess under the isolated HOME + cred env; capture stdout. (`-pyry-name=test` sets the registry instance dir `<home>/.pyry/test/`; `--name` is the device label.)
2. Decode the pairing payload from stdout: scan lines, base64url-decode + `JSON.parse` each, pick the object carrying `server` / `token` / `server_static_pubkey`. (The pair output is the same base64url-JSON format `parsePairingPayload` consumes.) These three fields become `daemon.pairFields`.
3. In the test body, build the pasted payload with `encodePairingPayload` (copy #94's helper): `{ server: pairFields.server, relay: \`${relay.url}/v1/client\`, token: pairFields.token, server_static_pubkey: pairFields.server_static_pubkey }`. The `relay` field is the **test** relay's client leg — the app dials it verbatim (`relayConnection` uses `config.url` unchanged). Do **not** use the `relay` value pyry emits (it points at the prod relay).

### Registry seeding (before daemon spawn) — the binding fix

Write two files under `<daemonHome>/.pyry/test/`, replicating the Go seed functions with `convId = 'default'`. Use a fixed bootstrap UUID literal (any valid v4 shape; it only needs to match between the two files). Inline the JSON directly — these shapes are load-bearing and small:

- `sessions.json` — one bootstrap entry:
  `{"version":1,"sessions":[{"id":"<BOOTSTRAP_UUID>","label":"","created_at":"2026-01-01T00:00:00Z","last_active_at":"2026-01-01T00:00:00Z","bootstrap":true,"lifecycle_state":"active"}]}`
- `conversations.json` — bind `'default'` to that session:
  `{"conversations":[{"id":"default","cwd":"<workdir>","current_session_id":"<BOOTSTRAP_UUID>","is_promoted":false,"last_used_at":"2026-01-01T00:00:00Z"}]}`

`current_session_id` = the bootstrap pool id; `cwd` = the isolated `workdir`. (Field-for-field from `seedBootstrapRegistry` / `seedBoundConversation`; the real claude child still writes its transcript at its own minted uuid, and the daemon's merged #854 PID-probe resolves the reply — nothing extra to seed for that.)

### Daemon spawn (contract — args + env from `spawnBootstrapDaemon`)

Spawn `pyry` with Node `child_process.spawn(pyryBin, args, { env, detached: true })`. `detached: true` puts the daemon and its claude child in one process group so teardown can reap the grandchild (§ Concurrency).

- **args:** `-pyry-socket=<SHORT-SOCKET> -pyry-name=test -pyry-claude=<claudeBin> -pyry-idle-timeout=0 -pyry-workdir=<workdir> -pyry-relay=${relay.url}/v1/server -- --model haiku --dangerously-skip-permissions`
- **env:** `{ ...process.env, HOME: daemonHome, <cred var(s)>, PYRY_ALLOW_INSECURE_RELAY: '1', PYRY_MOBILE_V2: '1' }`

Load-bearing details, each with its failure mode:
- **`-pyry-relay=${relay.url}/v1/server`** — #251's relay identifies the daemon leg by the path `/v1/server`. The daemon uses an explicit relay path verbatim (`internal/relay/connection.go:147-164`: an operator-supplied path is preserved; a bare URL gets `/v1/server` appended). Do **not** use `/v2/server` — that suffix is a Go-fake-relay convention; #251's relay would `legFor() → null` and terminate the socket. (Bare `${relay.url}` also works — the daemon appends `/v1/server`. Use the explicit form for clarity.)
- **`-pyry-socket=<SHORT-SOCKET>`** — must be a **short** path under `/tmp` (e.g. `mkdtemp('/tmp/pyry-sock-')` + `/pyry.sock`), **not** `os.tmpdir()`. macOS `os.tmpdir()` returns a long `/var/folders/...` path; a control socket there overflows the 104-byte `sun_path` limit → `bind(2)` EINVAL → the daemon never starts (#860). Remove this dir in teardown.
- **`PYRY_MOBILE_V2=1`** — enables the daemon's v2 mobile leg + the structured reply stream that fans out to interactive conns. Without it, no `assistant_delta` reaches the app.
- **`PYRY_ALLOW_INSECURE_RELAY=1`** — lets the daemon dial the loopback `ws://` relay. (The app's twin is `PYRY_ALLOW_LOOPBACK_RELAY=1`, set separately on the app.)

After spawn, block until the control socket is dialable, polling `<SHORT-SOCKET>` (net.connect on the unix socket, ~50 ms cadence, ~10 s cap), and fail fast if the process exits first — the `waitForReady` shape from `spawnBootstrapDaemon`. This gates "process up"; relay registration is handled by the app's readiness signal below.

### Readiness — Send-enabled, not `whenReady`

`relay.whenReady()` resolves only when the server leg **and** ≥1 client leg are both registered — but the client leg exists only once the app dials, a chicken-and-egg the fixture can't await before launching the app. So follow #94: treat **Send-enabled** (the `connected` daemon event) as readiness.

The daemon registers on `/v1/server` asynchronously after startup. If the app's first `noise_init` reaches the relay before the daemon leg is OPEN, #251's relay drops that frame silently (`onClientMessage` early-returns) — the app's handshake stalls, its supervisor times out and re-dials (a fresh `conn_id`), and by then the daemon is registered. This self-heals within the supervisor's retry budget, so use a **generous** handshake timeout (~30–45 s) to absorb real daemon startup latency plus a re-dial or two. Do not add an explicit relay-registration wait; there is no standalone signal for it and the re-dial covers it.

### Selectors — the one place #94 is stale

| What | #94 (stale) | #252 (correct) | Why |
|------|-------------|----------------|-----|
| Daemon reply | `.bubble[data-message-role="daemon"]` | `[data-thread-role="assistant"]` | Interactive stream renders into the timeline (`ConversationScreen.tsx:154`), not the non-interactive MessageBubble. A real v2 daemon fans the structured stream to interactive conns; the `message`/MessageBubble path never fires. |
| User echo | `.bubble[data-message-role="user"]` | `[data-thread-role="user"]` | #179 routes the optimistic echo into the timeline (`composerSend.ts:64` → `ConversationScreen.tsx:208`). |

Pairing (`textarea[aria-label="Pairing code"]`, Pair, `[aria-label="Server key fingerprint"]`, Confirm), `.conversation`, Send (`aria-label="Send"`), and composer (`placeholder="Message…"`) are all current — reuse #94 verbatim.

## State + concurrency model

- **Two subprocesses**, both children of the Playwright worker: the Electron app (via `_electron.launch`) and `pyry` (via `child_process.spawn`, which itself supervises a claude grandchild). No shared state between them except the wire path app → relay → daemon.
- **Process-group reaping (AC: reap daemon AND its claude child).** Spawn `pyry` with `detached: true`; in teardown send `process.kill(-child.pid, 'SIGTERM')` to the whole group, wait for `exit` with a short grace, then `process.kill(-child.pid, 'SIGKILL')` if it hasn't exited. Killing the group (negative pid) guarantees the claude grandchild dies even if `pyry` is force-killed before it can reap its own child. Guard against ESRCH (already-dead). The daemon's own SIGTERM handler reaps claude on the graceful path; the group-kill is the deterministic backstop.
- **Teardown is LIFO and total** — runs on pass and fail via the fixture lifecycle (no manual afterEach): app close + `rm(userDataDir)` → daemon group-kill + `rm(daemonHome)` + `rm(socketDir)` → `relay.close()`. Every temp dir created is removed.
- **Streaming timeline.** `assistant_delta` frames coalesce onto the tail `assistantText` item (`threadTimeline.ts:82-86`); `turn_end` appends a `turnBoundary`, which drops the assistant item from the tail and clears its `inProgress` cursor. This is the per-turn quiesce signal used to sequence the two turns.

## Assertions — two-turn liveness, content-agnostic

Real claude's words are non-deterministic, so assert **liveness only**: a non-empty assistant reply per turn. Two subtleties drive the exact shape:

- **The cursor trap.** The streaming cursor `▎` (U+258E) is a child `<span>` **inside** the `data-thread-role="assistant"` element (`ConversationScreen.tsx:160-164`). `textContent` of the row therefore includes `▎` even when the reply text is still empty. A naive "non-empty" check would pass on an empty streaming bubble. **Strip `▎` before the non-empty check.**
- **Tool-split.** One turn can produce multiple `assistantText` items if a tool call interleaves (`ConversationScreen.tsx:125`). So do not assert "exactly N assistant rows == N turns"; assert the count of *non-empty* assistant rows **strictly increases** per turn.

Define one helper and use it for both turns:
- `nonEmptyAssistantCount()` — count `[data-thread-role="assistant"]` rows whose `textContent`, with `▎` removed and trimmed, is non-empty.

Flow (bulleted scenario; the developer writes it in Playwright idiom):
- **Precondition (AC1).** Paste the assembled payload → Pair → wait fingerprint → Confirm → wait `.conversation` visible → wait Send enabled within the handshake timeout (~30–45 s). Reaching `.conversation` proves the pairing record persisted; Send-enabled proves the Noise handshake completed and interactive was granted.
- **Turn 1 (AC2).** Fill the composer with a random, content-agnostic message (vary per run; e.g. embed a nonce — do not assert on it). Click Send. `expect.poll(nonEmptyAssistantCount, { timeout: TURN_TIMEOUT }).toBeGreaterThanOrEqual(1)`. Then wait for the turn to quiesce: `expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: TURN_TIMEOUT })` (turn_end received → cursor cleared), so turn-1 streaming is fully settled before turn 2 — kills the turn-1/turn-2 count race.
- **Turn 2 (AC3).** `const base = await nonEmptyAssistantCount()` (stable now that turn 1 quiesced). Fill a second distinct random message, Send. `expect.poll(nonEmptyAssistantCount, { timeout: TURN_TIMEOUT }).toBeGreaterThan(base)`. Turn 1 proves the bridge binds on a fresh session; turn 2 proves it survives once the session exists.
- `TURN_TIMEOUT` ≈ 120 s (matches #854's per-turn budget for a cold PTY claude: spawn + model load + first reply). Set the whole-spec timeout via `test.setTimeout(...)` (or the config's `timeout`) generously — roughly handshake + 2×TURN_TIMEOUT + headroom (~300 s).

Optionally assert the user echo (`[data-thread-role="user"]`) as an extra liveness signal — not required by the ACs.

## Gating out of the default run (AC4)

- `playwright.config.ts` (default, runs on `npm run e2e`): add `testIgnore: /real-claude\.spec\.ts$/`. The agent pipeline (no daemon, no claude, no creds) then never loads the spec.
- `playwright.real-claude.config.ts` (new): `testDir: './e2e'`, `testMatch: /real-claude\.spec\.ts$/`, `fullyParallel: false`, `workers: 1`, `retries: 0`, `reporter: 'list'`, and a generous `timeout` (~300_000). Mirror the default config's shape otherwise.
- `package.json`: add `"e2e:real-claude": "npm run build && playwright test --config playwright.real-claude.config.ts"` (build first — the spec launches the *built* app, same as `e2e`).

The filename-based `testIgnore` is structural (can't be forgotten the way a grep tag can) and needs no per-test annotation.

## RED/GREEN observation (AC5)

Not code — a one-time manual observation captured in the PR description, mirroring #854's "fails on main before the fix" criterion:
- Against a **pre-#854** (deadlocking) `pyry` build: turn 1 times out with no `data-thread-role="assistant"` reply (the fresh-daemon bootstrap deadlock). RED.
- Against a **#854-inclusive** build: both turns pass. GREEN.
The operator records both in the PR. Document the pre-#854 build hint (checkout/build a pre-#854 tree) in the PR notes, not in the spec code.

## Error handling

- **Skips, not failures**, for missing binaries/creds (§ Skip-gating) — the only correct outcome when the real stack is unavailable.
- **Timeouts are the liveness signal.** A stalled handshake (Send never enables) or a turn with no non-empty assistant reply fails via the bounded `expect`/`expect.poll` timeouts — that *is* the deadlock the test exists to catch. Keep the timeouts generous enough that a healthy cold start never flakes, tight enough that a genuine hang still fails within the run.
- **Subprocess death.** `waitForReady` fails fast if `pyry` exits before the socket appears; surface its captured stderr in the failure message — but see secret hygiene: stderr from `pyry` is content-free by construction (#62), safe to echo for diagnosis.

## Security review

**Verdict:** PASS

The label flags three real surfaces: a *real* `pyry pair` bearer token is minted, a *real* server static pubkey is pinned, and the *real* prod relay-allowlist bypass is driven. The offsetting fact walked below: **this ticket changes zero production `src/` code** — the diff is `e2e/` + two config edits + a README edit — so every production trust boundary, Electron webPreference, crypto primitive, and IPC channel is *provably* untouched (nothing to change them exists in the diff). The findings therefore concern only the new test's own hygiene.

**Findings:**

- **[Trust boundaries]** No production finding — the pairing-payload → main-process boundary (`parsePairingPayload` / `pairingConfirmation.ts`) is unchanged; the test adds none. The one new parse is test-side: `pyry pair` stdout → `{server, token, server_static_pubkey}`. It reads output of a subprocess the test itself spawned under an isolated HOME (trusted-local, not attacker-controlled). SHOULD FIX (test robustness, not security): decode defensively (scan lines, tolerate non-payload lines) so a format change surfaces as a clear skip/fail, not a confusing crash.
- **[Tokens, secrets, credentials]** SHOULD FIX — the minted bearer token and the pinned pubkey must never be serialized into a log or a failure message. Design already routes around it (assertions read DOM text/visibility/counts only; `pairFields` are fixture-local, used solely to build the pasted payload). Developer discipline + code-review check: no `console.log`/`Error` interpolates the token, payload, or pubkey. App-side token storage uses the keychain-free **test** backend (#99) — acceptable *because it is a test*; the production `safeStorage` path is unchanged. Credential env vars are passed to the daemon subprocess only, never written to disk (except the operator's own `~/.claude.json`, copied into the isolated HOME at `0o600`).
- **[File / storage operations]** No finding — every write lands in a fresh `mkdtemp` daemon HOME (Node `mkdtemp` → `0o700`) or a short `/tmp` socket dir, all removed on pass and fail. Seeded JSON contains only test-controlled values (a fixed bootstrap UUID, the isolated `workdir`) — no untrusted input concatenated into any path, so no traversal surface. `.claude.json` is copied at `0o600`. No secret persists past teardown.
- **[Inter-process / Electron attack surface]** No finding — the test adds no `ipcMain`/`contextBridge` channel, registers no custom protocol, sets no `webPreferences`, and loads no remote content. It launches the built app as-is. Provably untouched: the production diff contains no `src/` change.
- **[Cryptographic primitives]** No finding — no crypto is introduced. The Noise `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake is the app's existing vetted wasm implementation, unchanged; the test pins the real server static pubkey from `pyry pair` (correct, not hand-rolled). The per-run message nonce is non-security (defeats reply caching only); any source (a counter, a timestamp) is fine — it never gates trust.
- **[Network & I/O]** No finding — the loopback `ws://` relay is the sanctioned #97 test seam, entered via the existing `app.isPackaged`-gated `PYRY_ALLOW_LOOPBACK_RELAY` flag; **no new bypass** is added and the prod `wss://` allowlist is untouched (no `src/` change). No `rejectUnauthorized: false`. The app's `maxPayload` frame cap and connect/idle timeouts are inherited from `relayConnection.ts`, unchanged. Bounded `expect`/handshake timeouts are the test's own liveness gate.
- **[Error messages, logs, telemetry]** SHOULD FIX — two developer disciplines: (1) surface spawned-`pyry` stderr *only* on **startup** failure (before any message flows, where it cannot contain message plaintext); do not tee it after the handshake. `pyry`/the transport are content-free by construction (#62) but the startup-only rule is the deterministic guard. (2) Do **not** enable Playwright `screenshot`/`trace`/`video` for this spec — the default config enables none; the new `playwright.real-claude.config.ts` must not add them (a trace could capture more than DOM text).
- **[Concurrency]** No finding — subprocess lifecycle is owned by the `test.extend` fixtures: LIFO teardown (app → daemon → relay) runs on pass and fail; the daemon + claude grandchild are reaped by process-group kill (SIGTERM → grace → SIGKILL on the negative pid); the app closes first so its supervisor cannot churn-reconnect on the drop; #251's relay deletes a conn-id on socket close. No new production async task or timer.
- **[Threat model alignment]** No finding — the test does not weaken any production mitigation. The "hostile" surfaces the threat model worries about (malicious relay, hostile daemon response) are here trusted-local doubles/binaries the test itself spawns, so they are out of this test's scope by construction; a real hostile relay/daemon remains the transport's job (#62, #199 defensive parse), unchanged. The asserted reply text is read via `textContent` (never `innerHTML`) and rendered as auto-escaped React children (`ConversationScreen.tsx:154`), so hostile markup in a reply cannot execute in the test context. `--dangerously-skip-permissions` is confined to the spawned claude under the isolated HOME/workdir on `--model haiku`, reproducing #854's harness; it never touches the operator's real environment.

No MUST FIX. The SHOULD-FIX items are developer-discipline notes carried in the spec (§ Assertions, § Error handling, § Gating) for code-review to confirm; none requires a design change.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10

## Open questions

- **Residual: routing protocol parity on `/v1/server`.** #251's `routingEnvelope.ts` is a port of the daemon's `protocol.RoutingEnvelope`, and #251 was built explicitly as this ticket's bridge, so this is expected-correct — but the real daemon on `/v1/server` speaking exactly what #251 decodes is only *proven* the first time this test runs GREEN. That is the point of the test; no pre-work needed.
- **Random-message tool avoidance.** A content-agnostic random message could occasionally provoke a tool call, splitting a turn into multiple assistant rows. The strictly-increasing non-empty-count assertion is robust to that, so no need to constrain the prompt — but if the operator observes flakiness, phrasing the message to discourage tools (e.g. "reply with a single short word") is a safe, still-content-agnostic tightening (it's what #854 uses).
- **`pyry` build provenance.** The test skips if `pyry` is absent but cannot verify the resolved binary was built from a #854-inclusive tree. The pre-ship doc must state this; the RED/GREEN observation (AC5) is the human check that the build under test actually contains the fix.
