# Live e2e runbook — the manual operator gate for the Phase-1 round-trip

The manual operator recipe for the **Phase-1 milestone gate** ([#13](https://github.com/pyrycode/pyrycode-desktop/issues/13)): pair the built desktop app with the **live** relay and the **real** `pyry` daemon on pyrybox, send a message, and watch the structured reply stream back into the window — the full **pair → connect → send → stream** round-trip against real infrastructure, not fakes.

This runs **only on an operator machine, never under CI**. Pairing against the live relay and driving a real daemon needs live credentials, a running daemon, and network access the pipeline agents do not have — so this gate is not agent-executable. It is the **manual sibling** of the automated fake-transport [e2e harness](e2e-harness.md) ([#40](https://github.com/pyrycode/pyrycode-desktop/issues/40)): that suite launches the built app and drives pairing/send/stream against fakes in Playwright; this runbook confirms the **same** mechanism works against the **live** stack. It is the desktop equivalent of mobile's live-e2e runbook — desktop reuses the same wire contract (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), so the same manual-vs-automated separation applies. It is a setup + verification recipe, not a tour of the transport stack; the wire/Noise details live in the feature docs and ADR 0002 by reference.

Proving the round-trip live is deliberately what unblocks the Phase-2 hardening + automated-test batch (#35–#41). The automated round-trip and UI-driven e2e (#39/#41) encode this milestone as regression coverage and are sequenced **after** this gate, blocked *by* it — see [Automated coverage is deferred](#automated-coverage-is-deferred).

## Prerequisites (daemon + relay side)

The operator supplies the daemon, the relay endpoint, and the credentials at run time; this runbook hardcodes none of them. The one fixed value is the milestone relay host, which is already public in the client.

1. **A running `pyry` daemon on pyrybox, reachable through the relay.** Its exact endpoint and credentials are operator-supplied.

2. **The relay must be `pyrycode-relay.pyryco.de` over `wss:` — this is load-bearing.** The desktop client only accepts a pairing payload whose relay **host** is in a single-entry allowlist: `RELAY_ALLOWLIST = { 'pyrycode-relay.pyryco.de' }` (`src/main/pairingPayload.ts:55`, [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52)), matched by exact host with a `wss:` scheme (the deployed relay is `wss://pyrycode-relay.pyryco.de/v1/client`). A payload naming any other relay — or any look-alike host — is rejected inline with `relay-host-not-allowed` and **never pairs**. So for milestone 1 the operator's daemon must be reachable via that exact relay. A future multi-relay change adds entries to that one set and nowhere else.

3. **Mint the pairing payload with `pyry pair` on pyrybox** (`--name <label>` to label the device, so `pyry pair list` and `pyry pair revoke` can name it afterwards). It emits a base64url string (URL-safe, **no padding**) of a four-field JSON tuple — `server`, `relay`, `token`, `server_static_pubkey` — with **no `pyry://` wrapper** (the wire encoding the desktop gate parses; `src/main/pairingPayload.ts:1-21`), then a `Static-key fp:` line carrying the fingerprint § 2 step 3 verifies. The operator copies the payload string to the desktop machine. There is **no flag that reprints an existing payload** — every `pyry pair` run mints a *new* device token and adds another registry entry, so use `pyry pair list` to inspect what already exists.

## 1. Build + launch the app (AC1, first half)

```
npm install
npm run build
```

`npm run build` is the salvage / QA gate (typecheck, then the electron-vite build; CLAUDE.md) — it must be clean before launch. Launch the built app.

A fresh install has **no stored pairing**, so the [app-shell](app-shell.md) router ([#80](https://github.com/pyrycode/pyrycode-desktop/issues/80)) resolves `not-paired` at launch and **lands on the pairing screen** (the conversation screen is reachable *only* on a genuine `paired` — every other launch outcome falls safe to pairing).

## 2. Pair — the numbered flow (AC1, core)

Each step names the feature it leans on. See the [pairing input screen](pairing-input-screen.md).

1. **Paste** the `pyry pair` payload into the pairing screen's monospace field ([#55](https://github.com/pyrycode/pyrycode-desktop/issues/55)).
2. **Submit (Pair).** Main parses the payload, validates the relay against the allowlist ([#52](https://github.com/pyrycode/pyrycode-desktop/issues/52)), and derives the server-key **fingerprint** ([#53](https://github.com/pyrycode/pyrycode-desktop/issues/53)); the screen shows the fingerprint in its 23-char `aa:bb:cc:dd:ee:ff:11:22` form (8 colon-separated lowercase-hex byte-pairs, grouped for readability).
3. **Verify the fingerprint byte-for-byte** against the `Static-key fp:` line `pyry pair` printed on pyrybox. **This is the security trust anchor** — the grouping is *spatial only*; compare the characters, case, and order **verbatim**. If they do not match exactly, **do not confirm** (pairing-input-screen.md § Security posture).
4. **Confirm.** The pairing persists in main via `safeStorage`, and **connect-on-pair** ([#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)) immediately dials the live relay — re-sourcing the just-persisted record at dial time — and runs the `Noise_IK` handshake. No restart: `onPaired` advances the app-shell to the conversation screen (daemon-connection.md § Connect-on-pair).

## 3. Observe `connected` (AC1, end) — the UI observable

The load-bearing "connection reached `connected`" signal is in the composer, **not** in app logs. The send button is gated on the live connection status ([#31](https://github.com/pyrycode/pyrycode-desktop/issues/31)); it flips the moment `status` reaches `connected` ([composer send § 4](composer-send-internals.md#4-connection-status-gate--composeravailability-31)):

- **Before the handshake completes:** the send button is **disabled**. This is the *expected* pre-handshake state — benign, not a failure. (Through [#968](https://github.com/pyrycode/pyrycode-desktop/issues/968) this state also rendered an inline `Connecting…` caption, a `role="status"` live region; that caption is retired, so the disabled button is the only local observable — the [connection banner](conversation-shell-chrome.md#connection-banner-279) at the top of the thread carries the announcement instead.)
- **On `connected`:** the send button **enables**.

Watch the **UI** (the composer enabling) and the **pyrybox daemon logs**, not the desktop app. The desktop transport is **log-free by construction** ([#62](https://github.com/pyrycode/pyrycode-desktop/issues/62)) — no `console.*` around the handshake, so a stray log can never leak the token, keys, or transcript. There deliberately are no verbose desktop transport logs to read.

## 4. Send + stream (AC2)

Type a message in the composer and send it (the send button or **Enter**; [#66](https://github.com/pyrycode/pyrycode-desktop/issues/66)):

- It appears in the thread **immediately** as a `user` bubble — the optimistic echo, carrying `data-message-role="user"` (composer-send.md § Data flow).
- The daemon on pyrybox receives it (the outbound `send_message` envelope, [#65](https://github.com/pyrycode/pyrycode-desktop/issues/65)) and the structured reply **streams back** — decoded in main ([#68](https://github.com/pyrycode/pyrycode-desktop/issues/68)) and rendered into the thread as `data-message-role="daemon"` bubbles ([#69](https://github.com/pyrycode/pyrycode-desktop/issues/69); conversation-shell.md § Seams).
- The daemon's echo of the same `message_id` is **deduped** — one `user` bubble, not two.

Seeing the sent `user` bubble followed by the streamed `daemon` reply in the window is the AC2 observable.

If the connect **fails**, a `failed` daemon event surfaces in the composer as a `Connection error` caption — that is the cue to check the **pyrybox daemon logs** (the desktop side is log-free by design).

## 5. Record the outcome (AC3)

Record the round-trip result as a **comment on [#13](https://github.com/pyrycode/pyrycode-desktop/issues/13)**: a screenshot of the streamed reply in the window and/or the relevant pyrybox daemon log excerpt. Mark it explicitly as **operator-verified on the live stack, not a CI gate** — the developer/agent pipeline cannot and need not run this stack. Any code gap surfaced during the run is a **new** ticket, not scope for #13.

## Known limitations and gotchas

- **Relay-allowlist rejection is the most likely first-run failure.** A payload whose `relay` host is anything other than `pyrycode-relay.pyryco.de` rejects inline (`relay-host-not-allowed`) and nothing is stored — check the payload's `relay` field first (§ Prerequisites step 2).
- **`error` and `not-paired` both route to pairing** (the [#80](https://github.com/pyrycode/pyrycode-desktop/issues/80) fail-safe). A stored-but-unreadable pairing shows the pairing screen, not the conversation — re-paste to recover. There is no "your pairing is unreadable" banner this milestone.
- **A transient-drop reconnect does not yet reload the stored record** — that is [#83](https://github.com/pyrycode/pyrycode-desktop/issues/83) (open). This gate is unaffected: a fresh pair (this runbook's path) dials the current record via #82's `reconnect()`, which re-sources at dial time; #83 only concerns automatic re-dials mid-session after a transient drop.
- **Single active conversation.** Everything uses `MILESTONE_CONVERSATION_ID = 'default'` ([#66](https://github.com/pyrycode/pyrycode-desktop/issues/66)) — there is no conversation-selection surface this milestone.
- **Dark scheme only, mobile layout stretched to the window** — the desktop-specific layout is deferred until the app is fully functioning.
- **Real-daemon fixture paths must be canonical.** The fixture resolves its temporary daemon home before deriving the workspace path, daemon cwd argument, and registry seed cwd. On macOS, `/tmp` resolves to `/private/tmp`; mixing them makes one workspace appear as two groups. The seeded subdirectory remains distinct, and the short control-socket path is unchanged ([#1674](https://github.com/pyrycode/pyrycode-desktop/issues/1674)).

## Current real-claude gate state

**Latest verified run: #1879, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1879#issuecomment-6048554295)
records `feature/1879` at `609a8ba87db3`, integrated with main `bb34dbf6d3f7`, in
run `2026-10-07T22-53-47-094Z`. The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`;
exit 0 in 4m 14s, no flaky tests. The sole skip is
`real claude picks up a saved channel system prompt at Reset session`, with no
reason recorded. The dispatcher removed `needs-real-claude` and advanced the ticket.

The supplied per-test gate report confirms `real-daemon-history-on-open.spec.ts` →
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
was present, executed and passed on its first attempt in 6.2 s
(1 executed, 1 passed, 0 failed, 0 skipped). It establishes a served saved baseline,
fully exits Electron, writes 205 channel posts while closed and reopens the same
protected profile. One newest ask exposes a gap; programmatic positioning creates
no demand, and each fresh focused reader step asks once. Recovery removes the
marker and displays all posts after the baseline in order without duplicates.

This named proof uses `spawnClaude: false`, real daemon storage/transport and the
local test relay. Suite annotations identify daemon `0.37.0` on 8 of 27 tests and
`PYRY_BIN=/usr/local/bin/pyry`; the history test has no daemon-revision annotation.
The counted report supplies named acceptance beyond a green exit or suite total.
Documentation did not run tests or access dispatcher logs. See
[known-gap verification](development-verification-history.md#known-gap-recovery-verification)
for protected-restoration coverage and fixture traps.

**Previous verified run: #1815, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1815#issuecomment-6047160427)
records `feature/1815` at `b4eee350bb4d`, integrated with main `66ce9425cd88` in run
`2026-10-07T21-21-05-639Z`. The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`;
exit 0, 4m 22s. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no
reason recorded. The dispatcher removed `needs-real-claude` and advanced the ticket.

The dispatcher's per-test gate report lists the required
`real-daemon-history-on-open.spec.ts` →
`a real daemon refreshes saved history with a channel post written while Electron is closed`
as present, executed and passed on its first attempt in this run (3.1 s;
1 executed, 1 passed, 0 failed, 0 skipped). The spec saves a baseline with served/
display evidence, fully exits Electron, writes a unique channel post in the
fixture's awaited while-closed callback, and relaunches the same protected profile.
Opening shows exactly one matching bubble and one newest ask without upward input;
the marker was absent from the saved baseline. This is real daemon storage and
transport through the local test relay with `spawnClaude: false`, not a Claude-turn
or production-relay proof. Suite annotations report daemon `0.37.0` on 8 of 27 tests;
the history test has no daemon-revision annotation.

Earlier builder evidence at `490ba22e` (1 executed, 1 passed, 0 failed, 0 skipped)
does not substitute for this dispatcher acceptance at the reviewed head. Evidence
above comes from the supplied counted gate report and linked PASS comment;
documentation did not read dispatcher logs or run live tests. See
[fake/unit evidence and input-gate trap](development-verification.md#what-each-test-tier-proves).

**Previous verified run: #1818, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1818#issuecomment-6029664454)
records `feature/1818` at `5d1b88adaa`, integrated with main `59efab093c` in run
`2026-10-07T02-23-21-880Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no reason recorded.
The [supplemental named result](https://github.com/pyrycode/pyrycode-desktop/issues/1818#issuecomment-6029885598)
confirms `e2e/real-claude-permission-modal.spec.ts` →
`real claude session checkbox grants repeated Bash use only in the current session`
was present, executed and passed on its first attempt in this same run, in 37.2 s
(1 executed, 1 passed, 0 failed, 0 skipped). Every test records `daemon-revision: 0.37.0`.

The inline card retains the live spec's repeated Bash effect without renewed permission in the
same session, then renewed permission before any effect in a distinct session in the same workspace.
Card disappearance alone is insufficient. The configured gate installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
requested `npm run e2e:real:gate`. Counted execution and this named pass satisfy the execution
requirement despite the command mismatch. The dispatcher removed `needs-real-claude` and advanced
the ticket. Evidence comes from the linked comments; documentation did not read dispatcher logs or
run live tests. See [inline permission verification](development-verification.md#inline-permission-verification)
for fake interaction and visual evidence. The live results concern the local test relay, not the
production relay.

**Previous verified run: #1817, 2026-10-06 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1817#issuecomment-6025928858)
records `feature/1817` at `1cec087404`, integrated with main `04e1cbd95b` in run
`2026-10-06T21-33-26-050Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no reason recorded.
The [named live results](https://github.com/pyrycode/pyrycode-desktop/issues/1817#issuecomment-6026040792)
confirm all three required consumers were present, executed and passed on the first attempt in
this same run, with `daemon-revision: 0.37.0`:

| Migrated spec | Named scenario | Recorded result |
| --- | --- | --- |
| `real-claude-permission-modal.spec.ts` | `real claude session checkbox grants repeated Bash use only in the current session` | Passed, 14.3 s |
| `real-claude-permission-mode.spec.ts` | `operator bypass stays confirmed through a no-op write, then the menu returns to bypass and Manual approval enforces Read` | Passed, 11.0 s |
| `real-claude-question-cancel.spec.ts` | `real claude raises a clarifying question that refusing through Cancel stops the gated work` | Passed, 10.0 s |

The consumers now activate supplied choice buttons, twice for non-defaults. The grant spec retains
a fresh Bash witness after checked second activation, a second fresh effect with no new permission
in the same session, then a new permission before any effect in a different session in the same
workspace. The mode spec retains daemon-announced mode and enforced Read proof; the question-refusal
spec retains continuation, quiescence and absence of the gated artefact while servicing permissions.
Panel disappearance alone proves none of these daemon effects.

The configured gate installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
requested `npm run e2e:real:gate`. The counted run and named passes satisfy its zero-execution guard
and this ticket's live acceptance despite the command mismatch. The dispatcher removed
`needs-real-claude` and advanced the ticket. Evidence comes from the linked gate and named-result
comments; documentation did not read dispatcher logs or run live tests.
See [permission interaction/capture coverage](conversation-shell-permission-modal.md#verification)
for completed fake-tier proofs. These gate results concern the local test relay, not the production relay.

**Previous verified run: #1723, 2026-10-06 — 26 executed, 26 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1723#issuecomment-6024904239)
records `feature/1723` at `1832410096`, merged with main `d627211c4d` in run
`2026-10-06T20-27-45-100Z`. The supplied per-test gate report confirms
`real claude restores the status after reconnect during the same running turn`
was present, executed and passed. The sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`; no reason is recorded.
The configured command installed and built, then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`,
rather than the criterion's `npm run e2e:real:gate`. The counted run and named
pass establish the required execution despite this command mismatch.

The [reconnect spec](../../../e2e/real-claude-phase-reconnect.spec.ts) holds a real
foreground Bash tool open and requires a new connection, an attributed running
phase and the same uncompleted turn before accepting restored status. The
[earlier verified baseline](https://github.com/pyrycode/pyrycode-desktop/pull/1763#issuecomment-5994328407)
recorded `responding`, connections 1 → 2 and the original turn still running:
the selected test executed once, passed once, with 0 failed and 0 skipped.
That verifier confirmed daemon v0.31.1 release revision
`ad7c57a850277bea48aafc4daad2cd2983e8fc90` contains prerequisite
`25b532b6205507784a7615fe59d3c5a7bb2f5484` (pyrycode#2718).
This provenance belongs to the earlier baseline, not a version assertion about
the latest gate. Existing desktop behavior needed no production fix. The live
observer cannot prove omission of `event_id`; the
[fake regression](conversation-timeline-store-limits.md#testing) supplies that seam.
These results cover the built desktop, local relay, real daemon and real Claude;
the production relay is outside this gate.

**Previous verified run: #1729, 2026-10-06 — 25 executed, 25 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1729#issuecomment-6024105618)
records `feature/1729` at `98f3db3893`, integrated with main `8b95b3bda8`, in run
`2026-10-06T19-37-51-069Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`; no skip reason is recorded.
The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
issue's `npm run e2e:real:gate` spelling. Counted execution satisfies the purpose of the command's
nonzero-execution guard; the named results below establish both required scenarios despite this
command mismatch.

The [supplemental live evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1729#issuecomment-6024286951)
confirms both adapted inline scenarios were present, executed and passed in that same run, each on
its first attempt with no retries:

| Spec and executed scenario | Executed | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `real-claude-question-answer.spec.ts` — `real claude changes model during a question and resumes with the original answer` | 1 | 1 | 0 | 0 | 11.2 s |
| `real-claude-question-cancel.spec.ts` — `real claude raises a clarifying question that refusing through Cancel stops the gated work` | 1 | 1 | 0 | 0 | 10.4 s |

The answer scenario now selects every `.question-batch__question` without stepping; its proof
still requires a real continuation naming the chosen option before the unchosen options. The refusal
scenario targets the whole inline batch and retains continuation, quiescence and recursive absence
of the gated artefact. These current-run passes establish their real-Claude continuation proof;
optimistic panel disappearance alone would not.

The supplemental evidence records `daemon-revision: 0.37.0` on every test and cites the
dispatcher-host report
`pyrycode-desktop-agents/logs/2026-10-06T19-37-51-069Z_real-claude-gate_#1729.log`.
The results cover the built desktop, local test relay, real daemon and real Claude; the production
relay is outside this gate. Documentation records the supplied evidence without rerunning live tests.


**Previous verified run: #1731, 2026-10-06 — 25 executed, 25 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1731#issuecomment-6023654588)
records `feature/1731` at `b8b61010e0`, merged with main `2168a4b739`, exit 0.
The sole listed skip is `real claude picks up a saved channel system prompt at Reset session`;
no skip reason is recorded in that comment. The configured command built the app then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather
than the issue's `npm run e2e:real:gate`. The counted per-scenario passes below establish
the intended execution despite this command mismatch.

The [supplemental live evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1731#issuecomment-6023883060)
confirms all three required `e2e/real-claude-queue-delivery.spec.ts` scenarios were present,
executed and passed in that same run, each on its first attempt with no retries:

| Executed test | Executed | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `real claude delivers one queued follow-up exactly once` | 1 | 1 | 0 | 0 | 14.3 s |
| `real claude delivers two queued follow-ups in submission order` | 1 | 1 | 0 | 0 | 15.2 s |
| `real claude drops the queued head and completes the remaining follow-up` | 1 | 1 | 0 | 0 | 13.0 s |

These scenarios assert transcript order: first reply, delivered follow-up, its reply,
then each next delivery/reply; one originating row per delivered send and no dropped row.
The same run also passed `real-claude-queue-drop.spec.ts` (11.1 s) and
`real-claude-queue-send-now.spec.ts` (14.0 s), both first attempt.

**Executed daemon provenance:** `PYRY_BIN=/usr/local/bin/pyry`, the image's test binary
selected by `config-desktop/dispatcher.env`. The supplemental evidence records
`daemon-revision: 0.37.0` on every test and verifies source tag `v0.37.0` contains
both required daemon commits: GitHub comparisons of `8581e740...v0.37.0` (#2819) and
`29f1ab04...v0.37.0` (#2820) each report the tag ahead of the commit. The dispatcher
health check requires at least 0.37.0. This records the executed binary's annotated
release and verified tag ancestry, rather than assuming a closed prerequisite is installed.
Each queue-delivery scenario also emits `queue-delivery-evidence` using that same
fixture-resolved executable. The results cover the built desktop, local test relay,
real daemon and real Claude; the production relay is outside this gate.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1790#issuecomment-6023555321)
confirms all eight `e2e/queued-own-settlement.spec.ts` scenarios executed and passed in the
current-head fake gate (296 executed, 296 passed, 0 failed, 4 skipped), including the two
mixed-delivery orders and both restoration orders. This establishes mounted regression
coverage alongside the real-Claude results above.

**Previous verified run: #1785, 2026-10-05 — 24 executed, 24 passed, 0 failed, 1 skipped.**
At `29e351d298` integrated with main `cb82a7d9d5`, all three required question-answer,
question-cancel and multi-agent cases executed and passed against daemon release `0.34.0`,
source `9834e99ee0`; see [per-test evidence and provenance](development-verification.md#live-test-diagnosis).

**Previous verified run: #1657, 2026-10-01 — 24 executed, 24 passed, 0 failed, 1 skipped.**
The [dispatcher verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1657#issuecomment-5933303183)
records branch `dbe8a350a0` merged with `origin/main` `bd5b9348e7`, exit 0.
Its per-test JSON log `2026-10-01T14-11-47-394Z_real-claude-gate_#1657.log` under
`pyrycode-desktop-agents/logs/` confirms `real-daemon-multi-agent.spec.ts` executed and passed
at 14:15:24 UTC, retry 0 (665ms). The version-checking specs attach daemon revision
`36acd04c79f1279c5c5dfb14a4c35e4dc6b6aff0`. The sole skip remains the Reset session fixme
for pyrycode#2436. This covers the built app and local relay, not the production relay.

`e2e/real-daemon-multi-agent.spec.ts` uses `spawnClaude: false` and
`requiredCapabilities: ['interactive', 'multi_agent']`; `daemonCapabilityGate` skips unsupported
daemons, including those predating v0.27.0. Its body records the app's own `connected` ack
after reconnecting and requires both names; the separate gate probe cannot prove production
advertises them. See the [liveness overview](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists).

**Previous verified run: combined #1673 and #1674, 2026-09-27 — 23 executed, 23 passed, 0 failed, 1 skipped.**
The operator ran `npm run e2e:real:gate` on commit `97ad5940`, containing both fixes and
`origin/main` at `d085e321`. The configured test binary reported `pyry 0.27.0`.
All five release-version cases and the workspace grouping, cwd-equality, and unique-create
cases passed. The three version-checking specs now accept either a source revision or a
release version and record the parsed value as `daemon-revision`. The one skipped case is
the existing Reset session `test.fixme` for pyrycode#2436. This result covers the built
desktop, local routing relay, real daemon, and real Claude. It does not test the production
relay. The outcome is recorded on [#1673](https://github.com/pyrycode/pyrycode-desktop/issues/1673)
and [#1674](https://github.com/pyrycode/pyrycode-desktop/issues/1674).

**Previous recorded run: #1522, 2026-09-19 — 22 executed, 22 passed, 0 failed, 1 skipped;
all four required queue cases passed on retry 0.** The
[dispatcher verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1522#issuecomment-5741840980)
records `feature/1522` at `8abd854c7b`, merged with `origin/main` at `db45831a51`
(0 commits behind), exit 0, wall clock 151.9s. Per-test JSON in dispatcher-host log
`2026-09-19T12-23-02-498Z_real-claude-gate_#1522.log` confirms these executions;
the log is under `pyrycode-desktop-agents/logs/`.

All three cases in
[`e2e/real-claude-queue-delivery.spec.ts`](../../../e2e/real-claude-queue-delivery.spec.ts)
ran against real Claude with the stream-json runner. Their `queue-delivery-evidence`
attachments each report **daemon revision `8a850505`**, read from the executed binary's
`version` output using the fixture's `PYRY_BIN`/PATH resolution. This is binary evidence,
not the newer daemon checkout revision inspected during implementation.

| Executed test | Queued before release | Completed marker order | Result |
| --- | ---: | --- | --- |
| `real claude delivers one queued follow-up exactly once` | 1 | 0 → 1 | PASS |
| `real claude delivers two queued follow-ups in submission order` | 2 | 0 → 1 → 2 | PASS |
| `real claude drops the queued head and completes the remaining follow-up` | 2 (then head dropped) | 0 → 2 | PASS |

Marker 0 belongs to the held first turn; 1 and 2 belong to the follow-ups in submission
order. Every listed turn had exactly one normal completion, each next turn started after
the previous completion, and all attachments report `released: true`, `complete: true`
and zero remaining queue items. The passing cases also checked one surviving originating
user row per delivered message, removed queued/drop affordances, rendered response markers
and no additional desktop send through the three-second settle window. The drop case
observed no turn for marker 1.

The retained
[`e2e/real-claude-queue-drop.spec.ts`](../../../e2e/real-claude-queue-drop.spec.ts)
case, `real claude enqueues a mid-turn send, drops it before drain, and runs no turn for it`,
also executed and passed on the stream-json runner. It checks cancellation of the only
follow-up, row removal and stable idle UI/content after release. It uses the same daemon
fixture and binary resolution; it does not emit a separate revision attachment.

The suite declares **23 tests in 20 files**, including the three new delivery cases.
The sole skip was `real-claude-system-prompt.spec.ts` → `real claude picks up a saved channel
system prompt at Reset session`, the existing `test.fixme` for pyrycode#2436; it is not a
pass. The gate reported a configured execution floor of 10, still below the 22 runnable
tests; adjusting that external setting remains the operator's work.

This run did not reproduce the reported stuck queue. The change adds regression proof
without a production repair or a confirmed daemon prerequisite. The result covers the
built desktop, local routing relay, real daemon and real Claude at the recorded revision;
it does not establish behavior through the production relay. The
[liveness overview](real-claude-liveness-e2e.md#what-it-does) explains the correlated proof.

**#1579 added `e2e/real-claude-mcp.spec.ts`, which passed in the combined 2026-09-27 run.**
It opens Channel info against a real daemon and a real non-bypass child (`skipPermissions: false`, so
the daemon spawns the child with its strict `--mcp-config` and the on-demand `mcp_status_request` this
ticket's Channel-info trigger sends has something to answer), ticks Show built-in, and asserts the
daemon's own `pyry_approve`/`pyry_files` rows by exact name — see [Channel info § MCP servers
section](conversation-shell-channel-info-mcp.md#mcp-servers-section-1490).
The latest run executed 24 tests against the fork's configured floor of 10.
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is still owed a bump to 24 so a missing runnable
case cannot hide behind the lower floor. The floor lives in the fork's dispatcher
configuration, not this repo.

### Earlier recorded runs

See [earlier gate evidence](live-e2e-runbook-history.md#earlier-recorded-runs) for the
older runs and their daemon/runner diagnosis.

**Silent-skip warning:** without `claude`, `pyry`, or the credential (`ANTHROPIC_API_KEY`, or
`CLAUDE_CODE_OAUTH_TOKEN` plus a readable `~/.claude.json`) the suite **skips every spec and still
exits 0**. Read the skip reasons, never the exit code — or use `npm run e2e:real:gate`, which turns
an all-skip run into a non-zero exit naming the missing prerequisite.

This section is the **single** authoritative record of real-claude gate state. README, the feature
doc (`real-claude-liveness-e2e.md`), and the spec header point here instead of restating it — so the
next state change updates one place, not four.

## Automated coverage: what the pipeline runs itself, and what stays manual

**Since 2026-09-02 the dispatcher runs the real-claude tier itself on this fork.** Before that date a `needs-real-claude` ticket parked in Inbox and waited for an operator to run the suite by hand. Parking and running are two separate dispatcher steps, and the running half is opt-in per fork through one setting in `pyrycode-desktop-agents/.env` — untracked, so no PR here can change it:

```
PYRY_REAL_CLAUDE_GATE_CMD="npm install --no-audit --no-fund >&2 && npm run build >&2 && npx playwright test --config playwright.real-claude.config.ts --reporter=json"
PYRY_REAL_CLAUDE_GATE_FORMAT=playwright-json
PYRY_REAL_CLAUDE_GATE_TIMEOUT_MS=1800000
PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED=24
```

Why each line is what it is:

- **Install and build chatter goes to stderr on purpose.** The gate reads stdout and expects Playwright's JSON report alone. Its parser skips to the first `{`, but npm output ahead of the report can still defeat it, so the chatter is routed away rather than tolerated.
- **The gate needs the per-test JSON reporter, not `e2e:real:gate`.** The repo's own gate script prints a human list. The dispatcher counts tests that ran a body, and it cannot count what it cannot read.
- **The floor must match the runnable test count on the branch.** A lower floor can hide a missing-prerequisite skip. Count tests, not files, and account explicitly for an existing `test.fixme`: the latest run declares 25 tests, with 24 runnable after the known system-prompt exclusion. The example above reflects those 24; the actual gate still reported 10. Updating this document does not change the fork's external configuration. See § Current real-claude gate state for the executed tests and the excluded case.
- **The floor is one-sided.** It answers "did enough tests run", never "did the right ones run". The 66-executed run described in § Current real-claude gate state cleared a floor of 10 with room to spare while running 56 fake-tier specs under the real-daemon config. A count above the floor is not evidence that the intended tier ran.

**This fork cannot tell an inherited failure from a new one.** On a red run the gate is meant to re-run just the failing tests against the base commit, so a failure that already exists on `main` parks for the operator instead of being blamed on the branch. That comparison never runs here: the dispatcher's filter builder rejects any test name outside a conservative character set, and every Playwright name carries spaces and a `›` separator, so the filter is always refused ([agent-dispatcher#38](https://github.com/pyrycode/agent-dispatcher/issues/38)). While any spec in the tier is red, **every** gated ticket that reaches the gate is failed and sent back for rework for a fault it did not cause, and each one needs a hand correction. That is what happened to [#928](https://github.com/pyrycode/pyrycode-desktop/issues/928) on the first live run, for the pre-existing red later filed as [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941).

**Three setup requirements nothing validates at configuration time:**

- The repo needs an `error:real-claude-gate` label; the gate's park path applies it. This repo did not have one until 2026-09-02.
- The credential must reach the command. Without it the suite exits 0 with everything skipped, and the floor is what turns that into a park rather than a pass.
- The daemon the gate spawns comes from `PYRY_BIN` or `PATH`, so a stale `~/.local/bin/pyry` fails or skips any spec that needs a newer wire feature. Rebuild and reinstall it before restarting the dispatcher with the gate on, since the dispatcher reads its environment at startup. Since [#933](https://github.com/pyrycode/pyrycode-desktop/issues/933) a spec can declare the daemon capabilities it needs, and the fixture skips it with a reason naming the missing string when the daemon does not advertise them — see [real-claude-liveness-e2e.md](real-claude-liveness-e2e.md). The skip still counts against the floor, so a stale daemon parks the ticket rather than passing it.

**What a verdict means.** A pass moves the ticket to In Documentation and strips `needs-real-claude`. A genuine failure sends it back with the rework label and keeps `needs-real-claude`, so it must pass the gate again after the fix. Anything the gate cannot trust — an inherited failure, nothing executed, an unreadable report, a run the outer clock killed — parks the ticket in Inbox with `error:real-claude-gate`, which excludes it from re-selection until a person clears the label. That clearing step is deliberately human.

**The live-relay half stays manual, by design.**
 There is **no automated live-*relay* e2e**, by design — pairing against the actual
`pyrycode-relay.pyryco.de` relay needs operator credentials and network access the pipeline agents
do not have, so that half stays manual, never under CI (consistent with the Phase-1/Phase-2 split
and the mobile precedent). The current coverage is the automated fake-transport
[e2e harness](e2e-harness.md) ([#40](https://github.com/pyrycode/pyrycode-desktop/issues/40)) **plus**
the per-slice unit suites (#52/#53/#55/#62/#65/#66/#68/#69), which already prove pair/connect/send/
stream against fakes, **plus** this runbook as the live-stack operator confirmation.

[#252](../codebase/252.md)'s [real-claude liveness e2e](real-claude-liveness-e2e.md) was built to automate
the other half this runbook used to be the *only* check for: whether a real `pyry` daemon running real
claude actually replies (as opposed to a fake daemon that always answers). It still dials a **local**
fake relay, not the live one, so it does not verify the live-relay allowlist/network path — this
runbook remains the only check for that.

The harness spec **SKIPs cleanly in the pipeline** (the `testIgnore` gate in `playwright.config.ts` — it
never runs, and is never seeded green, under the agent's `npm run e2e`). For the current pass/fail result
of a real operator run, see § Current real-claude gate state above — the single page that carries it.

**`npm run e2e:real:gate` is the exit-code-safe form of this `real-*` harness**
([#479](https://github.com/pyrycode/pyrycode-desktop/issues/479)). It runs the same specs against the same
`playwright.real-claude.config.ts` as `e2e:real-claude`, adding only an exit-code enforcement layer: when
every spec skips for a missing prerequisite (`pyry` / `claude` / a credential) the run "passes" with **zero
tests executed**, and the gate turns that silent-nothing-ran into a **non-zero exit** that names the missing
prerequisite (surfaced verbatim from the fixture's own skip reason). Prefer it over the raw `e2e:real-claude`
for operator use — the plain command exits **0** on all-skip and so cannot tell an under-provisioned machine
apart from a genuine live pass (that green-on-all-skip stays load-bearing on the pipeline, which is why the
plain command is left untouched). The gate closes only the *silent-zero* hazard: it still dials a **local**
fake relay, so it does **not** supersede `scripts/live-drive.mjs` below.

**`scripts/live-drive.mjs` is the live-RELAY pre-ship gate** (built app → *production* relay → live Mac
daemon → vault workdir) — the path `e2e:real-claude` never exercises, since that harness dials a *local*
fake relay. `npm run build && node scripts/live-drive.mjs .` pairs a throwaway device, creates a
conversation through the UI, sends a message, waits for the real claude reply to stream in, then revokes
the pairing (first green 2026-07-15, ~4s round-trip). It prints progress lines only — never the pairing
payload or token. It is complementary to `e2e:real-claude`, not a stand-in — run it before a ship to
cover the live-relay path the harness cannot.

**It is now safe to chain** (`npm run build && node scripts/live-drive.mjs .` actually stops on RED):
as of [#480](https://github.com/pyrycode/pyrycode-desktop/issues/480), the script exits **non-zero** on
RED/timeout, on any thrown step (pairing, connect, create-conversation, send), and on the two pre-launch
early exits — only GREEN (a real reply streamed) exits 0. The exit code is deferred via `process.exitCode`
rather than `process.exit`, so the `finally` cleanup (close the app, remove the temp user-data dir, and
`pyry pair revoke` the throwaway device) always runs to completion first — a skipped revoke would leak a
**live** credential, since the device was paired with `--allow-remote-permissions` against the real daemon.

## Cross-references

- [E2E harness](e2e-harness.md) / [#40](https://github.com/pyrycode/pyrycode-desktop/issues/40) — the automated fake-transport sibling this runbook is the manual counterpart of.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#252](../codebase/252.md) — aims to automate the real-daemon+real-claude half of this runbook (still a local relay, not the live one); for its current pass/fail state see § Current real-claude gate state above.
- [App shell](app-shell.md) / [#80](https://github.com/pyrycode/pyrycode-desktop/issues/80) — the launch router: fresh install → pairing screen; `onPaired` → conversation, no restart (steps 1–2).
- [Pairing input screen](pairing-input-screen.md) / [#55](https://github.com/pyrycode/pyrycode-desktop/issues/55) + [Daemon connection](daemon-connection.md) / [#82](https://github.com/pyrycode/pyrycode-desktop/issues/82) — the pair → connect path: paste → fingerprint-verify → confirm → connect-on-pair dials the live relay.
- [Composer send](composer-send.md) / [#31](https://github.com/pyrycode/pyrycode-desktop/issues/31) + [#66](https://github.com/pyrycode/pyrycode-desktop/issues/66) and [Conversation shell](conversation-shell.md) / [#69](https://github.com/pyrycode/pyrycode-desktop/issues/69) — the send → stream path: the connection-status gate (the `connected` observable) and the thread render.
- `src/main/pairingPayload.ts` / [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52) — the relay-allowlist gate (`RELAY_ALLOWLIST`, line 55), the load-bearing prerequisite.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay; the wire types match mobile field-for-field, which is why this is the desktop equivalent of mobile's live-e2e runbook.
- `scripts/live-drive.mjs` / [#480](https://github.com/pyrycode/pyrycode-desktop/issues/480) — the live-RELAY pre-ship gate: built app → production relay → live Mac daemon → vault workdir, the automated companion to this manual live-relay runbook, covering the live-relay path `e2e:real-claude` never touches.
