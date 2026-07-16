# Real-claude liveness e2e

`e2e/real-claude.spec.ts` is a Playwright scenario that drives the **built Electron app** through
the real pairing UI against a **freshly-spawned real `pyry` daemon running real `claude --model
haiku`**, bridged through the [fake routing relay](fake-routing-relay.md), and asserts a non-empty
`data-thread-role="assistant"` reply streams into the thread for two consecutive sends.

Introduced in [#252](../codebase/252.md), split from [#178](../codebase/178.md). Depends on
[#251](../codebase/251.md) (the routing-aware relay bridge) and [#179](../codebase/179.md) (the
interactive-capability flip that makes a v2 daemon's structured reply reach this client at all).

## What it does

Every other Desktop e2e — [#89](../codebase/89.md) (transport round-trip), [#93](../codebase/93.md)/
[#94](../codebase/94.md) (UI pair/send/stream) — runs against a fake relay **and** a fake daemon that
always answer. They stay green even if a real daemon never responds. This scenario is the thin
client-layer net over the daemon-side liveness test, `pyrycode#854` (merged) — it drives the real
stack the operator actually ships, with the Electron window standing in for that ticket's headless
phone.

It is **not** a live-relay test. The relay leg is still the local, in-process
[fake routing relay](fake-routing-relay.md); only the daemon and claude are real. Verifying against
the actual `pyrycode-relay.pyryco.de` relay remains the manual
[live e2e runbook](live-e2e-runbook.md) (#13) — see that doc's "Automated coverage" note.

It is also not the only real-daemon tier. [#439](../codebase/439.md) added a **credential-light**
sibling — [real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) — that spawns a real
`pyry` with no `claude` and no Anthropic credential, for the registry-backed user actions (rename,
archive, delete, …) that never touch claude. That tier shares this spec's fixture chain
(`e2e/fixtures/realDaemon.ts`) via two additive option fixtures; this doc's spec continues to consume the
fixture unmodified.

[#445](../codebase/445.md) added the first **turn-coupled** sibling on this spec's own claude-spawning
tier (`spawnClaude:true`, no `test.use(...)` needed): `e2e/real-claude-interrupt.spec.ts` clones this
spec's precondition verbatim and swaps the two-turn body for an interrupt-mid-turn liveness proof — the
real-stack net over the [interrupt envelope](interrupt-envelope.md)'s client wiring (#305–#307), which
the fake-stack twins (#307, #427) can only prove against a scripted `daemon.pushFrame`, not a genuinely
running turn. Split from #431; its twin [#446](../codebase/446.md) shipped next on the same tier.

[#446](../codebase/446.md), #445's twin, is `e2e/real-claude-queue-drop.spec.ts` — the same
long-prompt precondition clone, but the body proves queue-while-busy-then-drop: a second send issued
mid-turn enqueues as a `data-thread-role="queued"` [queue-store](queue-store.md) row (rather than
starting a new turn, since `composerAvailability` gates only on connection, never turn phase), the drop
removes it while turn 1 is still provably running (bracketing `interruptButton`-visible checks
immediately before and after the drop, the DOM-only answer to the #442-class dequeue-before-drain
hazard), and — reusing #445's two-signal-quiesce-plus-settle idiom verbatim — the turn drains to prove
the dropped send produced no assistant turn at all.

[#432](../codebase/432.md), the third sibling on this tier, is `e2e/real-claude-permission-modal.spec.ts`
— the deepest liveness net in the suite. It clones the same precondition and swaps the turn body for a
prompt engineered to force exactly one deterministic, permission-gated tool call, waits for
`page.getByRole('dialog')` (the real daemon relaying claude's per-tool prompt as `modal_shown` — a
timeout is a genuine liveness signal, not a flake), answers "allow" via a helper that absorbs two
daemon-supplied unknowns (the affirmative option's label, matched by a start-anchored
case-insensitive regex, and whether it is the default, resolved by a conditional `Confirm` click),
then reuses #445/#446's two-signal quiesce to prove the turn completes. Unlike #445's "long prompt"
mitigation, this spec's causation proof is structural: `turn_end` cannot fire without the tool
running, which cannot happen without the allow. Adds a single-consumer `skipPermissions` fixture
option (default `true` = current args byte-for-byte) that drops `--dangerously-skip-permissions` for
this spec alone, mirroring the #439 `seedPromoted` single-consumer precedent.

## How it works

### Gated out of the default run

`playwright.config.ts` adds `testIgnore: /real-claude\.spec\.ts$/`, so `npm run e2e` (what the agent
pipeline runs) never loads this spec. It runs only via its own command and config:

```bash
npm run e2e:real-claude   # = npm run build && playwright test --config playwright.real-claude.config.ts
```

`playwright.real-claude.config.ts` matches only this spec, with `workers: 1`, `retries: 0`, and a
`timeout: 300_000` generous enough for a cold real-claude turn. This was designed as part of the
operator's **pre-ship gate**, documented in `README.md` alongside `npm run build` and `npm test` —
there is no CI (org policy), so an unrun real-claude test earns nothing until an operator actually
runs it before shipping.

> **As of [#449](../codebase/449.md) this spec is red on the live stack**, for a reason unrelated to
> anything documented below: the isolated-HOME harness daemon delivers the turn (claude completes it
> in an identical manual PTY probe) but no reply event ever fans back to the app. It still SKIPs
> cleanly under the pipeline's `npm run e2e` (`testIgnore`, unaffected by this). Until the #449
> diagnosis lands a fixture fix with a live-verified green, do not treat `npm run e2e:real-claude` as
> a working pre-ship gate — **`scripts/live-drive.mjs` is the current interim gate**; see the
> [live e2e runbook](live-e2e-runbook.md)'s "Automated coverage" note.

### Skip-gating, not failing, when the real stack is unavailable

The `daemon` fixture resolves three prerequisites *before* creating any resource, and skips cleanly
(`testInfo.skip(condition, reason)`) if any is missing — an unrun-because-unavailable test is the
correct outcome, not a hard failure:

- `claude` on `PATH`.
- `pyry` — via `PYRY_BIN` override, else `PATH`. Must be built from a tree that includes
  `pyrycode#854` (an older daemon deadlocks on a fresh session; that deadlock is the RED this spec
  exists to catch).
- A credential: `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` **plus** a readable operator
  `~/.claude.json` (read from the real `HOME`, before the daemon's HOME gets isolated).

### Fixture chain and teardown

The `relay → daemon → page` chain lives in the shared `e2e/fixtures/realDaemon.ts` fixture
([#420](../codebase/420.md)) — extracted verbatim from this spec's original file-local `test.extend`
so the coming tier-2/tier-3 real-* specs (real-daemon-actions, interrupt/queue, permission modal)
reuse it instead of re-transcribing the harness. The spec imports `test`, `expect`, and
`encodePairingPayload` from the fixture and keeps only its streaming selectors, spec-body timeouts,
`nonEmptyAssistantCount`, and the pairing drive (paste → Pair → Confirm → wait-for-Send) in the
`test(...)` body — the drive itself stayed in the spec since #420 scoped the extraction to the spawn
recipe only, mirroring `launchPairedApp`'s own extract-on-second precedent. Teardown is LIFO
(`page → daemon → relay`) — the app closes first so its supervisor can't churn-reconnect on the
daemon/relay dropping:

- **`relay`** — `startFakeRoutingRelay()` ([#251](../codebase/251.md)); `close()` on teardown.
- **`daemon`** — skip-gates, then: creates an isolated `daemonHome` (`mkdtemp`), copies the operator's
  real `~/.claude.json` into it at `0o600` (on the OAuth path — otherwise interactive PTY claude
  reads the onboarding theme picker as "ready" and deadlocks, `pyrycode#496`), runs `pyry pair`
  under that HOME to mint credentials, **seeds the registry** (see below), spawns `pyry` with
  `detached: true` on the relay's `/v1/server` leg, and waits for its control socket to become
  dialable. Wrapped in `try`/`finally` so setup failure, test failure, and success all reap the
  subprocess and remove every temp dir.
- **`page`** — launches the built app (`args: ['.']`, `ELECTRON_RENDERER_URL` stripped) with the two
  `app.isPackaged`-gated dev flags — `PYRY_ALLOW_LOOPBACK_RELAY` ([#97](../codebase/97.md)) and
  `PYRY_TEST_SECRET_BACKEND` ([#99](../codebase/99.md)) — and an isolated `--user-data-dir` for a
  guaranteed-unpaired start. Verbatim from [#94](../codebase/94.md).

### The binding problem: seeding `'default'` before spawn

The desktop always sends `conversation_id: 'default'` (`composerSend.ts`'s
`MILESTONE_CONVERSATION_ID`) and cannot seed the daemon's registry from the client side. A fresh real
daemon does not auto-bind an ad-hoc `'default'` conversation — `send_message` rejects an unbound
conversation (`pyrycode#678`) and the turn would time out.

Before spawning, the fixture writes `<daemonHome>/.pyry/test/sessions.json` (one bootstrap-pool
session at a fixed UUID) and `conversations.json` (binding `id: "default"` to that session's
`current_session_id`) — the registry loads once at daemon startup, no reload, so seeding the files
first is sufficient. This is legal because `ConversationID` is an opaque string in the daemon, not a
validated UUID. Field-for-field port of `pyrycode#854`'s `seedBootstrapRegistry`/
`seedBoundConversation`, with `'default'` in place of a generated UUID.

### Daemon spawn — the load-bearing flags

```
-pyry-socket=<short /tmp path>   -pyry-name=test   -pyry-claude=<claudeBin>
-pyry-idle-timeout=0             -pyry-workdir=<isolated workdir>
-pyry-relay=<relay.url>/v1/server
-- --model haiku --dangerously-skip-permissions
```

env: `PYRY_ALLOW_INSECURE_RELAY=1` (lets the daemon dial a loopback `ws://` relay) and
`PYRY_MOBILE_V2=1` (enables the v2 mobile leg + structured reply stream — without it no
`assistant_delta` reaches the app).

- **`/v1/server`, never `/v2/server`.** The fake routing relay identifies legs by exact upgrade path
  and drops anything else; `/v2/server` is a Go-fake-relay-only convention from `pyrycode#854` that
  does not apply here.
- **A short socket path is mandatory.** `os.tmpdir()` on macOS returns a long `/var/folders/...` path
  that overflows the 104-byte unix `sun_path` limit — `bind(2)` fails and the daemon never starts
  (`pyrycode#860`). The fixture uses a fresh `mkdtemp('/tmp/pyry-sock-')` instead.

### Readiness — Send-enabled, not `relay.whenReady()`

`whenReady()` needs the server leg **and** a client leg registered, but the client leg only exists
once the app dials — a chicken-and-egg the fixture can't resolve before launching the app. So, as in
[#94](../codebase/94.md), the spec treats **Send-enabled** (the `connected` daemon event) as
readiness, with a generous 45s handshake timeout. If the app's first `noise_init` reaches the relay
before the daemon's `/v1/server` leg is registered, the relay silently drops that frame, the app's
supervisor re-dials on a fresh `conn_id`, and by then the daemon has registered — this self-heals
within the timeout rather than needing an explicit relay-registration wait.

### Assertions — content-agnostic, two-turn liveness

Real claude's words are non-deterministic, so the scenario asserts liveness only:

- **Strip the cursor before counting.** The streaming cursor `▎` is a child `<span
  class="bubble__cursor">` **inside** the assistant row, so raw `textContent` is non-empty even on an
  empty streaming bubble. `nonEmptyAssistantCount()` strips `▎`, trims, and counts non-empty rows.
- **Turn 1** sends a message, polls `nonEmptyAssistantCount() ≥ 1`, then waits `.bubble__cursor` to
  reach count 0 — the `turn_end` quiesce signal — before turn 2 reads its baseline. This removes the
  race where turn 2's poll could observe turn 1's still-streaming reply.
- **Turn 2** snapshots `base = nonEmptyAssistantCount()`, sends a second message, and polls for
  **strictly-increasing** count (not an exact total) — robust to a tool call splitting one turn into
  multiple assistant rows.
- The message text itself (`"Reply with a single short word. run=<nonce> turn=<n>"`) discourages tool
  calls without pinning content; the strictly-increasing assertion tolerates a tool split regardless.

### Selectors differ from #94

A real v2 daemon fans its structured stream to interactive conns, rendering into the timeline as
`data-thread-role="assistant"`/`"user"` — not [#94](../codebase/94.md)'s non-interactive
`data-message-role="daemon"`/`"user"` `MessageBubble`, which never fires for an interactive
connection. This is why [#179](../codebase/179.md) (interactive flip) is a hard prerequisite: before
it, a non-interactive client got no reply at all from a v2 daemon.

## Configuration and usage

Run via `npm run e2e:real-claude`. Prerequisites and the credential-extraction hint (Keychain, for
Max-only accounts without an API key) are documented in `README.md` under "Pre-ship gate". `PYRY_BIN`
overrides the resolved `pyry` binary when it isn't on `PATH` (e.g. a sibling-repo build).

## Edge cases and limitations

- **Process-group reaping.** `pyry` is spawned `detached: true` so it and its real-claude grandchild
  share a process group; teardown sends SIGTERM to the group (`kill(-pid)`), waits with a grace
  period, then SIGKILL if still alive. Guards against ESRCH (already dead). This is the deterministic
  backstop — the daemon's own SIGTERM handler reaps claude on the graceful path.
- **Stderr surfacing is startup-only.** The daemon's stderr is captured only until its control socket
  becomes dialable; capture stops the moment readiness is reached, so a post-handshake failure can
  never tee message plaintext into a diagnostic — keeping the transport's log-free-by-construction
  invariant ([#62](../codebase/62.md)) intact even on a test failure path.
- **`pyry pair` stdout is never echoed.** It carries the pairing token; a decode failure surfaces only
  a static error string, never the scanned stdout.
- **No `screenshot`/`trace`/`video`** on this config — a trace could capture more than DOM text.
- **RED/GREEN is a manual PR observation, not automated.** The agent env has no Anthropic credentials
  and there is no CI, so the "fails on a pre-#854 daemon, passes on a #854 daemon" proof is recorded
  once by the operator in the PR description, mirroring `pyrycode#854`'s own convention. Per #449,
  the current live-stack observation is RED for a different, still-open reason (isolated-HOME
  reply-fan-out) — see the callout above.
- **Turn timeout is 120s per turn** to absorb a cold PTY claude (spawn + model load + first reply);
  the whole-spec timeout is 300s (handshake + 2×turn + headroom).

## Related

- [#252 codebase notes](../codebase/252.md) · Spec: `docs/specs/architecture/252-real-claude-e2e.md`
  · PR [#258](https://github.com/pyrycode/pyrycode-desktop/pull/258).
- [Fake routing relay](fake-routing-relay.md) / [#251](../codebase/251.md) — the bridge this spec
  dials; its `/v1/server` leg is where the spawned real daemon registers.
- [E2E test harness](e2e-harness.md) / [#40](../codebase/40.md) — the launch/teardown primitive. This
  scenario's own fixture chain now lives in `e2e/fixtures/realDaemon.ts`
  ([#420](../codebase/420.md)), the real-stack sibling of `launchPairedApp.ts` (#433).
- [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) / [#439](../codebase/439.md) —
  the credential-light sibling tier sharing this spec's fixture chain via additive option fixtures.
- [Interrupt envelope](interrupt-envelope.md) / [#445 codebase notes](../codebase/445.md) — the
  turn-coupled sibling spec (`real-claude-interrupt.spec.ts`) on this same claude-spawning tier; the
  real-stack liveness net over the interrupt client wiring.
- [Queue store](queue-store.md) / [#446 codebase notes](../codebase/446.md) — #445's twin
  (`real-claude-queue-drop.spec.ts`); the real-stack liveness net over the queue-while-busy-then-drop
  client wiring.
- [#432 codebase notes](../codebase/432.md) — the third tier sibling
  (`real-claude-permission-modal.spec.ts`); the real-stack liveness net over the permission-modal
  chain, contrasted with the fake-stack twin #426.
- [Live e2e runbook](live-e2e-runbook.md) / [#13](../codebase/13.md) — the manual, live-**relay**
  operator gate; this scenario automates the real-daemon+real-claude half but still uses a local relay,
  so it does not replace the live-relay verification.
- [#449 codebase notes](../codebase/449.md) — the isolated-HOME reply-fan-out diagnosis that currently
  keeps this spec red on the live stack; `scripts/live-drive.mjs` is the interim gate until it resolves.
- [Loopback relay dev affordance](loopback-relay-affordance.md) / [#97](../codebase/97.md) +
  [Secret-backend dev affordance](secret-backend-affordance.md) / [#99](../codebase/99.md) — the two
  dev flags this scenario consumes without relaxing.
