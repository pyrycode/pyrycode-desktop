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

[#928](../codebase/928.md), the fourth sibling, is `e2e/real-claude-question-answer.spec.ts` — the
real-stack net over the whole question vertical, whose fake-tier twin is
`e2e/question-answer-continue.spec.ts` (#922, see
[conversation-shell-question-panel.md](conversation-shell-question-panel.md)). It clones #432's
structure — same fixture trio, same DOM-only assertion posture — but is the first sibling on this
tier whose proof cannot rest on a tool side-effect: the trigger forbids claude from writing code or
using any other tool, so what must be shown (the answers map reaching claude) is observable only in
what claude says next. It asserts reply content, deliberately against #432's closing instruction not
to — that instruction assumed a tool effect to fall back on, which this slice does not have. The
non-vacuity argument is `expectNamesChoiceFirst`: the spec always clicks the **last** offered
`.question-panel__option-label` of every question in the batch (stepping the whole batch via the
panel's own trailing Next/Continue control, never just the first), then asserts the post-answer
continuation names that label **before** any of the question's unchosen labels, case-insensitively —
a claude that never read the answers can still restate its own question, but a restatement lists
labels in offer order, where the chosen one was deliberately put last. Two real-stack failure modes
this spec exists to catch are invisible to #922's fake tier: the per-device remote-permission opt-in
(pyrycode#702) defaults to deny and leaves a denied batch silently outstanding, and a rejected answer
is silent by design (no reply, no error envelope, no `question_dismissed`) — both read from the
window as indistinguishable from a send that never left, since the panel clears optimistically either
way. Adds the single-consumer `claudeModel` fixture option (see below) so this spec alone can run
under `claude-sonnet-5` rather than the tier's default `haiku` — the only model under which a live
`AskUserQuestion` call has been measured in either tree, transcribed from the daemon-side twin
`pyrycode#1987`.
[#933](https://github.com/pyrycode/pyrycode-desktop/issues/933) added a second, independent
declaration alongside `claudeModel` — `test.use({ requiredCapabilities: ['question'] })` — so this
spec skips cleanly against a daemon built before pyrycode#2020 (which added the `question` capability
string) rather than failing when the surface wait below deadlines with nothing to show for it. See
§ Capability-gated skip below.

[#929](https://github.com/pyrycode/pyrycode-desktop/issues/929), the fifth sibling, is
`e2e/real-claude-question-cancel.spec.ts` — the refusal twin of #928's answer arm on the same question
vertical, whose fake-tier twin is `e2e/question-cancel-refuses.spec.ts` (#921, see
[question-panel-cancel-refusal.md](question-panel-cancel-refusal.md)). It clones #928's fixture trio
(`skipPermissions:false`, `interactiveRunner:'stream-json'`, `allowRemotePermissions:true`) and its
`claudeModel`/`requiredCapabilities` declarations byte for byte — the second consumer of both, after
\#928 — but diverges on the one axis its own AC needs: the trigger gates a real file-write on the
answer, naming a per-run unique bare base name with no directory, so refusing the batch has a real
absence to prove rather than #928's deliberately tool-less prompt. The proof is not the panel's
optimistic clear (#921 already proves that on the fake tier and this spec explicitly must not
re-assert it) but a **recursive** post-quiesce walk of `daemon.workdir` for that base name, asserted
empty — and made non-vacuous by an allow arm that answers "allow" to any permission dialog raised
*after* the refusal, so a claude that guessed an answer and pressed on genuinely could have produced
the artefact. `questionResolverV2.admit` gates a refusal on the same pyrycode#702 per-device opt-in
that gates an answer, defaulting to deny, so `allowRemotePermissions` is load-bearing here exactly as
it is for #928. The daemon-side twin, pyrycode#1995, measured a live claude stopping cleanly after a
refusal — no further modal, no re-ask, nothing written — which is why both containment arms (allow,
re-ask) are expected never to fire on a passing run without that being dead code; a green run with
zero modals allowed is a structural gap in what the model has been observed to do, not evidence the
arms are unreachable.

[#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055), the sixth sibling, is
`e2e/real-claude-attachment.spec.ts` — the real-stack proof that an attached file actually reaches
claude, the gap every other tier in this repo cannot close: the fake tier stubs the upload's *outcome*
and uploads nothing, and the unit tier asserts only on the frame this window built, so neither can tell
"the id rode the frame" from "the daemon resolved it, named its path in the prompt, and claude opened the
file." It clones the fixture trio and `withIsolatedElectronApp` drive (needed here, uniquely among the
siblings, for the `ElectronApplication` handle the dialog stub requires — the #517 lift), stubs
`dialog.showOpenDialog` with a **real** file (a solid `#FF0000` PNG this spec writes to a temp dir and
reaps in a `finally`) rather than #890's invented outcome, and lets production chunk it to the real
daemon. **One precondition this spec's own first live run discovered the hard way:** an
`attachment_chunk` carries no conversation id by design, so a completing upload resolves against the
daemon's follow-active cursor — which only a prior `send_message` stamps, never conversation creation
itself. The spec therefore drives one ordinary **cursor-stamp turn**, drained to quiesce, before
attaching; without it the upload is refused with `attachment.storage_failed` and the spec never reaches
the send under test. See [live e2e runbook](live-e2e-runbook.md) § Current real-claude gate state for the
measured failure and [#1076](https://github.com/pyrycode/pyrycode-desktop/issues/1076), the matching
operator-facing gap this spec's diagnosis surfaced (filed, not fixed here). The assertion reads the
assistant rows' stripped text, skip-offset past the stamp turn's own reply, against a **word-anchored**
`/\bred\b/i` — anchored rather than substring, since claude's own prose about a missing image ("I don't
see any image attached… could you re-send it?") satisfies `considered`/`required` on a bad day, which is
exactly the false green this boundary exists to refuse. `skipPermissions` stays at its `true` default, so
claude's read of the file never blocks on a permission modal. Bumped the tier's
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor from 12 to 13.

## How it works

### Gated out of the default run

`playwright.config.ts` excludes every `real-*.spec.ts` file via `testIgnore`, so `npm run e2e` (what
the agent pipeline runs) never loads this spec. The pattern is `/(^|\/)real-[^/]*\.spec\.ts$/` —
anchored to a path boundary and held inside one filename segment (#928; previously the unanchored
`/real-.*\.spec\.ts$/`, whose `.*` could span `/` and matched every spec in the tree when an
*ancestor directory* happened to be named `real-…`, as the dispatcher's own `real-claude-gate-<N>`
worktree is — see § Current real-claude gate state in the [live e2e runbook](live-e2e-runbook.md) for
the run that found it). `playwright.real-claude.config.ts`'s `testMatch` carries the identical
pattern and the two must stay byte-for-byte the same. It runs only via its own command and config:

```bash
npm run e2e:real-claude   # = npm run build && playwright test --config playwright.real-claude.config.ts
```

`playwright.real-claude.config.ts` matches only this spec, with `workers: 1`, `retries: 0`, and a
`timeout: 300_000` generous enough for a cold real-claude turn. This was designed as part of the
operator's **pre-ship gate**, documented in `README.md` alongside `npm run build` and `npm test` —
there is no CI (org policy), so an unrun real-claude test earns nothing until an operator actually
runs it before shipping.

For the current pass/fail state of this gate, see the [live e2e runbook](live-e2e-runbook.md)
§ Current real-claude gate state — the single page that carries it.

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

### Capability-gated skip — the one check that runs after the daemon exists

[#933](https://github.com/pyrycode/pyrycode-desktop/issues/933) added a fourth, opt-in skip gate: a
`real-*` spec can declare `test.use({ requiredCapabilities: [...] })` to skip — never fail — against
a daemon whose `hello_ack` doesn't advertise a capability the spec needs. A spec that declares nothing
(every spec but `real-claude-question-answer.spec.ts` and `real-claude-question-cancel.spec.ts`, both
declaring `question`) dials no probe and is gated exactly by the three checks above, byte for byte.
Declaring one turns a stale daemon from a routed-to-a-builder test *failure* into a
routed-to-the-operator environment *skip* — the same class as a missing credential — which matters
because the dispatcher's real-claude gate can't tell "the code is wrong" from "the daemon predates
this feature" any other way.

The check necessarily runs **after** `waitForDaemonReady`, the one exception to this file's "skip
before creating any resource" rule: reading what the daemon supports needs the daemon already
running. The fixture's `try`/`finally` reaps the process group and both temp dirs on every exit path
regardless, so this late skip leaks nothing.

The mechanism, in `e2e/fixtures/daemonCapabilityGate.ts`:

- `decideCapabilityGate(required, read)` is the whole judgement, pure and total, covered directly
  under `npm test` — nothing in this repo can assert on its own Playwright skip. An empty `required`
  short-circuits to "run" unconditionally, even given a failed read; that's the invariant that keeps
  every pre-#933 spec's behavior unchanged.
- `readDaemonCapabilities` drives one harness-side Noise handshake over the fake routing relay
  (mirroring `daemonConnection`'s `loadDialConfig` field-for-field, with an ephemeral static key
  instead of the persisted device keypair) and **advertises exactly the declared capabilities** — the
  daemon's `negotiateCapabilities` returns the *intersection* of what's advertised with what it
  supports, so a probe advertising nothing would read every capability as missing. It reuses the
  fixture's own `pairFields` rather than minting a second device (the daemon's `Devices.Validate` is a
  pure hash lookup that doesn't consume the token). It is total — it never throws or rejects — and
  fails closed into a skip on a handshake error, a malformed ack, or a timeout, retrying a timed-out
  attempt against an absolute deadline (not an attempt count) so the suite can never hang here; the
  retry is load-bearing, not defensive, because the relay silently drops a client frame that beats the
  daemon's `/v1/server` registration (the same race § Readiness describes for the app's own leg).
- The skip reason names the missing capability, names the daemon as the stale thing, and carries a
  concrete `go build -o ~/.local/bin/pyry ./cmd/pyry` (or `PYRY_BIN`) rebuild line, matching the
  concreteness of the credential skip's own `security find-generic-password …` line. It is built only
  from client-owned constants and from the spec's own `required` list — **never** from the daemon's
  advertised strings, which are untrusted text that `ZeroExecutedGate` (`e2e/reporters/`) prints
  verbatim into the operator's run log.

`vitest.config.ts` and `playwright.config.ts` each gained one line so the pure decision could be unit
tested beside the fixture it serves without Playwright trying to collect it: `.test.ts` under `e2e/`
is vitest's, `.spec.ts` is Playwright's — a suffix invariant, not a directory one.

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

The `--model` value is a `claudeModel` fixture option (#928; default `'haiku'`, preserved byte-for-byte
for every spec that doesn't override it). `real-claude-question-answer.spec.ts` (#928) and
`real-claude-question-cancel.spec.ts` (#929) are its two consumers, both overriding it to
`claude-sonnet-5` — see the sibling entries above.

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

- **Strip the cursor, and since [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014), the
  meta row, before counting.** The streaming cursor `▎` is a child `<span class="bubble__cursor">`
  **inside** the assistant row, so raw `textContent` is non-empty even on an empty streaming bubble.
  [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) filled `.bubble__meta`'s timestamp
  slot (the [message bubble's meta row](conversation-shell-message-bubble.md#the-meta-row)), and that row
  is the bubble's last child on the streaming branch too, so an unstripped read turned this tier's whole
  liveness predicate into the "row merely exists" check its own docblock says it was written to replace —
  every assistant row now carries a non-empty trailing stamp regardless of what claude actually said.
  `nonEmptyAssistantCount()` strips both `▎` and the `.bubble__meta` subtree (`META_SELECTOR`, on a
  **detached clone** so the live DOM the rest of each spec asserts on is untouched), trims, and counts
  non-empty rows; `real-claude-question-answer.spec.ts`'s `assistantText()` generalises the same strip
  from the count to the concatenated text, which also restores `continuationOf`'s
  `after.startsWith(before)` prefix invariant — the stamp trails *every* row, so an unstripped read had
  silently dropped that assertion to its whole-text fallback. The strip is structural (remove the
  subtree), not a digit-shape match against the timestamp's format, so it survives whatever the row grows
  next. All four reads (`real-claude.spec.ts`, `real-claude-interrupt.spec.ts`,
  `real-claude-queue-drop.spec.ts`, `real-claude-question-answer.spec.ts`) keep the constant named
  `META_SELECTOR` verbatim, so `rg META_SELECTOR e2e/` finds the whole set — mirroring how `CURSOR_CHAR`
  is already duplicated across the same four specs rather than lifted. Because `testIgnore` keeps this
  whole tier out of every gate that runs by default, nothing would have caught the regression without an
  operator run of `npm run e2e:real-claude` — the next text-bearing child added to `.bubble` needs the
  same two-grep sweep (`toHaveText|toContainText` **and** `textContent|allTextContents|allInnerTexts|
  innerText`, across all of `e2e/` with no tier filter) documented in [E2E test
  harness](e2e-harness.md#edge-cases-and-limitations).
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
- **Pass/fail is a manual PR observation, not automated.** The agent env has no Anthropic credentials
  and there is no CI, so the "fails on a pre-#854 daemon, passes on a #854 daemon" proof is recorded
  once by the operator in the PR description, mirroring `pyrycode#854`'s own convention. The current
  observed state lives in the [live e2e runbook](live-e2e-runbook.md) § Current real-claude gate state.
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
- [#928 codebase notes](../codebase/928.md) — the fourth tier sibling
  (`real-claude-question-answer.spec.ts`); the real-stack liveness net over the question-answer
  vertical, contrasted with the fake-stack twin #922. Added the single-consumer `claudeModel` fixture
  option and, as a fallout fix, anchored both configs' `real-*` filename patterns to a path boundary.
- [Conversation shell — question panel](conversation-shell-question-panel.md) — the panel surface
  `real-claude-question-answer.spec.ts` (#928) drives by structure only
  (`.question-panel__option-label`, `.question-panel__continue`, `.question-panel__labels`); its
  fake-stack twin `e2e/question-answer-continue.spec.ts` (#922) is what first proved that surface.
- [Live e2e runbook](live-e2e-runbook.md) / [#13](../codebase/13.md) — the manual, live-**relay**
  operator gate; this scenario automates the real-daemon+real-claude half but still uses a local relay,
  so it does not replace the live-relay verification.
- [#449 codebase notes](../codebase/449.md) — the isolated-HOME reply-fan-out diagnosis (since
  resolved); for the current gate state see the [live e2e runbook](live-e2e-runbook.md) § Current
  real-claude gate state.
- [Loopback relay dev affordance](loopback-relay-affordance.md) / [#97](../codebase/97.md) +
  [Secret-backend dev affordance](secret-backend-affordance.md) / [#99](../codebase/99.md) — the two
  dev flags this scenario consumes without relaxing.
- [#933](https://github.com/pyrycode/pyrycode-desktop/issues/933) — added the capability-gated skip
  (`e2e/fixtures/daemonCapabilityGate.ts`) described above; `real-claude-question-answer.spec.ts`
  (#928) and `real-claude-question-cancel.spec.ts` (#929) are its two consumers, both declaring
  `question`.
- [#929](https://github.com/pyrycode/pyrycode-desktop/issues/929) — the fifth tier sibling
  (`real-claude-question-cancel.spec.ts`); the refusal twin of #928's answer arm, contrasted with the
  fake-stack twin #921 ([question-panel-cancel-refusal.md](question-panel-cancel-refusal.md)). Proves a
  live claude honours a Cancel refusal by leaving no artefact for the gated work, via a recursive
  post-quiesce workdir walk made non-vacuous by an allow arm on any post-refusal permission modal.
- [Composer send § 10](composer-send.md#10-attachments-named-on-the-outbound-frame---takeattachments-1039-reworked-by-1055)
  / [Composer attach § Pending attachments](composer-attach.md#pending-attachments-1039) / [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) — the sixth tier sibling
  (`real-claude-attachment.spec.ts`), covered above; the live proof for the client-side change that names
  a message's attachments on the outbound `send_message` frame.
