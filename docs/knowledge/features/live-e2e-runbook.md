# Live e2e runbook — the manual operator gate for the Phase-1 round-trip

This runbook covers operator prerequisites, the Phase-1 production-relay round-trip
([#13](https://github.com/pyrycode/pyrycode-desktop/issues/13)) and the current automated
real-daemon gate. The operator supplies credentials and infrastructure; agents record
supplied evidence. The local real-* tier and production-relay check exercise different paths.

- [Prerequisites](#prerequisites-daemon--relay-side), including the dedicated Codex sign-in.
- [Build, pair and send](#1-build--launch-the-app-ac1-first-half): the milestone operator recipe.
- [Current real-claude gate state](#current-real-claude-gate-state): counted named evidence.
- [Automated coverage](#automated-coverage-what-the-pipeline-runs-itself-and-what-stays-manual): Luna proof and invocation.
- [Automation and operator gates](live-e2e-runbook-automation.md): configuration and production-relay checks.
- [Recent gate evidence](live-e2e-runbook-recent-gates.md) and [earlier evidence](live-e2e-runbook-history.md): historical results and daemon provenance.

## Prerequisites (daemon + relay side)

The operator supplies the daemon, the relay endpoint, and the credentials at run time; this runbook hardcodes none of them. The one fixed value is the milestone relay host, which is already public in the client.

1. **A running `pyry` daemon on pyrybox, reachable through the relay.** Its exact endpoint and credentials are operator-supplied.

2. **The relay must be `pyrycode-relay.pyryco.de` over `wss:` — this is load-bearing.** The desktop client only accepts a pairing payload whose relay **host** is in a single-entry allowlist: `RELAY_ALLOWLIST = { 'pyrycode-relay.pyryco.de' }` (`src/main/pairingPayload.ts:55`, [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52)), matched by exact host with a `wss:` scheme (the deployed relay is `wss://pyrycode-relay.pyryco.de/v1/client`). A payload naming any other relay — or any look-alike host — is rejected inline with `relay-host-not-allowed` and **never pairs**. So for milestone 1 the operator's daemon must be reachable via that exact relay. A future multi-relay change adds entries to that one set and nowhere else.

3. **Mint the pairing payload with `pyry pair` on pyrybox** (`--name <label>` to label the device, so `pyry pair list` and `pyry pair revoke` can name it afterwards). It emits a base64url string (URL-safe, **no padding**) of a four-field JSON tuple — `server`, `relay`, `token`, `server_static_pubkey` — with **no `pyry://` wrapper** (the wire encoding the desktop gate parses; `src/main/pairingPayload.ts:1-21`), then a `Static-key fp:` line carrying the fingerprint § 2 step 3 verifies. The operator copies the payload string to the desktop machine. There is **no flag that reprints an existing payload** — every `pyry pair` run mints a *new* device token and adds another registry entry, so use `pyry pair list` to inspect what already exists.

### Dedicated Codex sign-in for the local real-* tier

Codex coverage is default-off in `RealDaemonOptions`; only the Luna spec opts in with
`codexCapture: true`. Other specs keep their existing gates, environment and arguments,
without Codex probing or provisioning. The operator supplies Codex >=0.156.1 on PATH and
a persistent dedicated sign-in outside both the runner's `~/.codex` and production `~/.pyry`:

```bash
CODEX_HOME=/absolute/dedicated/codex-home codex login
export PYRY_CODEX_CAPTURE_HOME=/absolute/dedicated/codex-home
```

Export the variable in the dispatcher's environment as a path visible to the gate. Agents
do not fetch, copy or provision credentials. **Serialize use of this sign-in:** never share it
between two live runs at once, including daemon-side capture/live tests. Renewal keys are
single use; copying the runner's ChatGPT login can log it out. The daemon may update the
dedicated home's config, so this must be a separately provisioned home.

Before isolating daemon HOME, the fixture resolves the operator home and canonicalizes the
dedicated path. Equal or descendant locations under either protected root are forbidden,
including aliases through supplied-path or protected-root symlinks. Existing ancestors and
dangling symlink targets must be resolved before missing-directory skips: `realpath` alone
would misclassify a missing protected alias as a harmless missing prerequisite.
The selected PATH executable is probed with `codex --version` using an empty temporary
`CODEX_HOME`, without accessing the dedicated sign-in. The canonical dedicated directory
is linked, never copied, at `<daemonHome>/.pyry/test/codex-home` before daemon spawn.
Successful teardown and failed-setup cleanup remove fixture-owned resources and the link,
preserving the dedicated directory and its contents.

Use the combined checkout and set `PYRY_BIN` to a test daemon supporting Codex model
publication and agent/model/effort channel creation; record its `pyry version`. Retain the
existing Claude executable and operator-provided Claude credential setup: this scenario
bootstraps with an effort-capable Claude Opus conversation before creating the Codex channel.
See [Automated coverage](#automated-coverage-what-the-pipeline-runs-itself-and-what-stays-manual)
for the portable command and skip/failure meanings.

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

As of 2026-10-15, credentialed acceptance of production daemon-built threads is
pending. The final manual fake-daemon suite executed and passed 434 cases, failed
zero and skipped 20. The 15 production activation cases and 12 supplied thread
cases were present and passed. This is fake-transport evidence only. The source
revision is `8d2f3a03d69c7b81019354feca58d42e0008d977`. See the
[activation plan](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions)
for configuration, source/report hashes and individual skip reasons.

No credentialed thread run, daemon source revision, binary digest or live artifact
is supplied by this manual completion. Do not carry earlier legacy-route live
acceptance forward as proof of this activation. Execute the following exact specs
against an isolated source-stamped daemon containing daemon #3164, #3236 and #3324:

- `e2e/real-claude-thread.spec.ts`
- `e2e/real-daemon-history-on-open.spec.ts`
- `e2e/real-claude-phase-reconnect.spec.ts`
- `e2e/real-claude-queue-delivery.spec.ts`
- `e2e/real-claude-queue-send-now.spec.ts`
- `e2e/real-claude-permission-modal.spec.ts`
- `e2e/real-claude-permission-mode.spec.ts`
- `e2e/real-claude-codex-channel.spec.ts`

Record the Desktop source and daemon source/binary identities. Assert accepted
`interactive` and `thread` on the actual app connection separately from the
fixture's probe pairing. Return named-scenario executed/passed/failed/skipped counts
and JSON/artifact paths for send/stream, reopen, reconnect, older paging, agent
placement, queued delivery, session reset and saved-history recovery. Collection
or an all-skip exit supplies no execution proof. Use the dedicated test executable;
never silently replace the operator's running daemon.

### Earlier October 14 effort acceptance

**Earlier recorded run: #1949, 2026-10-14 — 27 executed, 27 passed, 0 failed,
1 skipped; the repaired effort-default test passed on its first attempt.** The
supplied dispatcher per-test report records `2026-10-14T11-31-33-267Z`, testing
`feature/1949` at `a1e0ae54b399` integrated with `origin/main` at `cbf60aa2a012`.
The configured full suite exited 0 in 4m 14s, with no flaky passes. `PYRY_BIN` selected
`/opt/pyry-test-daemon/pyry`; annotations on 9 of 28 tests identify release `0.39.0`,
including the named effort case. No source revision or binary digest was supplied for
this gate executable.

`real-claude-effort-default.spec.ts` →
**`applied effort, confirmed preference, restart, chat recall and channel creation choice`**
was present, executed and passed in 17.0s, one attempt: 1 executed, 1 passed,
0 failed, 0 skipped within the 27-executed, 0-failed, 1-skipped run. The full result
supplies suite acceptance for the observation repair. The single skip was
`real claude picks up a saved channel system prompt at Reset session`, with no reason
recorded. The history-gap case also passed on its first attempt in 5.3s; the Luna case
passed in 10.4s with daemon-revision and published-model-row annotations. See the
[dispatcher gate record](https://github.com/pyrycode/pyrycode-desktop/issues/1949).

The configured dispatcher command used install/build followed by
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather
than the criterion's literal `npm run e2e:real:gate`. Its per-test counts establish that
the full live suite and the required named test executed and passed; this was not an
all-skip exit or a focused rerun substituted for the suite.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1950#issuecomment-6166742411)
also confirms three consecutive focused passes through the provisioned launcher, retries
disabled, on 2026-10-14. The exact named effort scenario above executed and passed on
attempt zero in each run:

| Started (UTC) | Duration | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10:37:04.044 | 20,937ms | 1 | 1 | 0 | 0 |
| 10:38:16.651 | 17,474ms | 1 | 1 | 0 | 0 |
| 10:39:19.783 | 22,324ms | 1 | 1 | 0 | 0 |

Those focused runs used `/usr/local/bin/pyry`, release/module v0.39.0, module sum
`h1:G/dTdPcdztQXiz8fUTq7ubCshd0Lvld7iCpm+ulxkig=`; tag v0.39.0 resolves to source
`518f296a82207563468cb45cfd2f26865970af32`. Each named test annotated daemon-revision
`0.39.0`. This provenance belongs to the focused executable; it does not establish the
source identity of the dispatcher's separate binary. Eleven deterministic effort
regressions passed in the verifier gates. The fake tier recorded 394 executed,
394 passed, 0 failed, 3 skipped, and excluded this live case. See
[settings observation diagnosis](development-verification-live-test-diagnosis.md#correlating-live-settings-evidence).

### Earlier October 14 history acceptance

**Preceding #1947 run, 2026-10-14 — 27 executed, 26 passed, 1 failed,
1 skipped; the repaired history-gap test passed on its first attempt.** The
supplied dispatcher per-test report records `2026-10-14T10-10-23-470Z`, testing
`feature/1947` at `fd6598e05c3f099bbb93148ae21af8b9a69a4565` integrated with
`origin/main` at `d31ee247313b`. The configured full suite exited 1 in 4m 34s;
none of its 26 passes was flaky. `PYRY_BIN` selected `/opt/pyry-test-daemon/pyry`;
daemon annotations on 9 of 28 tests identify release `0.39.0`. No source revision
or binary digest was supplied for this gate executable.

`real-daemon-history-on-open.spec.ts` →
**`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`**
was present, executed and passed in 5.4s, one attempt: 1 executed, 1 passed,
0 failed, 0 skipped within the 27-executed, 1-failed, 1-skipped run. This supplies
the merged-tree named-test acceptance for the repair. The
[verifier's five serial focused passes](https://github.com/pyrycode/pyrycode-desktop/pull/1948#issuecomment-6165945171)
at the feature revision above separately record 5 executed, 5 passed, 0 failed,
0 skipped, one worker, retries zero, each attempt zero. Those builder runs selected
`/usr/local/bin/pyry`, version 0.39.0, Go module v0.39.0, SHA-256
`a76a703551edf81a42e5b0b1112bf453ed52f08fab19c7f7cfee6ee296b2b3c8`;
that digest does not establish the identity of the dispatcher's separate binary.
See [history diagnosis and preserved recovery assertions](development-verification-history.md#known-gap-recovery-verification).

The full run's sole failure was `real-claude-effort-default.spec.ts` →
`applied effort, confirmed preference, restart, chat recall and channel creation choice`.
The dispatcher reran that test on the same integrated tree: 1 executed, 1 passed,
0 failed, 0 skipped. Its [gate record](https://github.com/pyrycode/pyrycode-desktop/issues/1947)
accepted the suite after rerun, removed `needs-real-claude` and routed the repair
to documentation. This does not change the original full-run counts. The single
skip remained `real claude picks up a saved channel system prompt at Reset session`,
with no reason recorded. The Luna scenario also executed and passed on its first
attempt in 10.0s, with release `0.39.0`, `daemon-revision` and `published-model-row`
annotations. Closure/merge of the repair and any dependent-ticket routing remain
dispatcher-owned.

### Earlier October 14 Luna acceptance

**Preceding #1809 run, 2026-10-14 — 27 executed, 26 passed, 1 failed, 1 skipped;
the named Luna scenario passed.** The supplied dispatcher report records run
`2026-10-14T09-16-23-519Z`, testing `feature/1809` at
`f87ad003c615dce3706995b6522910f9eef5c776` integrated with `origin/main` at
`c75bc69d46d6`; the configured real-* suite exited 1 in 6m 51s, with no flaky passes.
Daemon annotations identify `0.39.0` on 9 of 28 tests, including Luna;
`PYRY_BIN` was `/opt/pyry-test-daemon/pyry`. This is the supplied binary release identity,
not a daemon source revision.

The named `real-claude-codex-channel.spec.ts` scenario,
**`real GPT-6 Luna channel replies with Low effort from creation`**, was collected,
executed and passed on attempt 1 in 11.6s against daemon `0.39.0`, with both
`daemon-revision` and `published-model-row` attachments on that passing attempt.
This named evidence supersedes the October 11 unset-home skip and establishes the
live Luna reply required by #1809 and #1658 criterion 5. The named imported regression,
`real-claude-effort-default.spec.ts` →
`applied effort, confirmed preference, restart, chat recall and channel creation choice`,
was present, executed and passed on attempt 1 in 21.0s against annotated daemon `0.39.0`
in the same run (27 executed, 1 failed, 1 skipped).

That earlier full suite failed on `real-daemon-history-on-open.spec.ts` →
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`;
its same-tree rerun produced no pass. The
[dispatcher gate comment](https://github.com/pyrycode/pyrycode-desktop/issues/1809#issuecomment-6165150801)
records that this case also failed on unmerged `origin/main` and is tracked on
[#1947](https://github.com/pyrycode/pyrycode-desktop/issues/1947). The
[operator-delegated handoff](https://github.com/pyrycode/pyrycode-desktop/issues/1809#issuecomment-6165241854)
accepts this ticket's named Luna proof and leaves the shared failure with that follow-up.
That Luna acceptance did not make the earlier full suite green. The single skip was
`real claude picks up a saved channel system prompt at Reset session`, with no reason recorded.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1941#issuecomment-6109372909)
confirms the normally merged #1658 history includes preserved documentation commit
`22775f0901d19e606e3055eb365d19d783c56335`. The supplied deterministic browser report
at `f87ad003c615` records 392 executed, 392 passed, 0 failed, 3 skipped;
the Luna test did not run in that tier. Live acceptance rests on the named result above,
not these deterministic counts or a suite exit status.

The #1809 handoff asks the dispatcher to supply the October 14 named Luna pass, daemon
`0.39.0`, attachments and tested feature/main identities to #1658's documentation/PR #1720
handoff. That normal workflow reconciles the picker and documentation already imported
through `22775f09`; keep the existing causal blocker and #1809-first landing order.
See [create-channel testing](create-channel-dialog.md#testing).

### Earlier recorded runs

See [recent gate evidence](live-e2e-runbook-recent-gates.md) for the September–October
2026 runs, and [earlier gate evidence](live-e2e-runbook-history.md#earlier-recorded-runs)
for older runs and daemon/runner diagnosis. Current status is recorded only here;
other overviews link to this section.

## Automated coverage: what the pipeline runs itself, and what stays manual

[`e2e/real-claude-codex-channel.spec.ts`](../../../e2e/real-claude-codex-channel.spec.ts)
adds **`real GPT-6 Luna channel replies with Low effort from creation`**. It acknowledges
Low on the seeded Claude conversation, reads it back, then waits for fresh model-list
replies to publish the target host's real Codex GPT-6 Luna row. Publication is asynchronous;
opening Create channel before that cache is populated would omit the picker. The spec
selects the published row through the app, creates a distinct promoted Codex channel,
checks its first model/effort settings and sends without changing them. A correlated,
completed nonempty real assistant reply and the published Luna footer name before sending
and after completion are required, never Default. It attaches `daemon-revision` and
`published-model-row`; injected model lists and direct-wire creation cannot supply this proof.
The [current gate record](#current-real-claude-gate-state) contains the named live pass and
its daemon and combined-delivery identities.

On the provisioned gate machine, after the scoped fixture/picker checks and build, use:

```bash
npx playwright test --config playwright.real-claude.config.ts e2e/real-claude-codex-channel.spec.ts --reporter=json
```

The combined PR also needs the dispatcher's full real-* gate. On macOS, request approved
execution outside the sandbox before any Electron launch. Inspect the named result and
attachments, not exit status alone; a configured home does not establish a usable sign-in.

| Opted-in prerequisite or error | Meaning |
| --- | --- |
| Unset `PYRY_CODEX_CAPTURE_HOME` | Skip naming the unset variable. |
| Missing or non-directory dedicated home | Skip naming the directory prerequisite. |
| `codex` absent from PATH | Skip naming the executable. |
| Codex below 0.156.1, including a prerelease of that minimum | Skip naming the required version. |
| Protected home or symlink alias, even a missing protected target | Fail before probing, Claude credential reads or daemon use. |
| Unexpected path/probe error, unusable sign-in or no published Luna row | Fail; model publication has a bounded wait. |

The registered-fixture unit coverage uses fake executable/process boundaries and temporary
test-owned directories, including protected/dangling aliases, an isolated version home,
link-before-spawn and target preservation during normal and failed-setup cleanup. It needs
no real sign-in. Missing prerequisites remain operator/gate work, and a skipped Luna
scenario cannot satisfy live acceptance even when every other spec passes.

See [automation and operator gates](live-e2e-runbook-automation.md) for dispatcher
configuration, failure routing, `npm run e2e:real:gate` and the production-relay
`live-drive.mjs` recipe. The real-* tier uses a local test relay; production-relay
verification remains an operator check. The latest report has 28 declared tests and
27 runnable when Codex is provisioned, excluding the known system-prompt case. A count
floor alone cannot establish that the named Luna scenario passed.

## Cross-references

- [E2E harness](e2e-harness.md) / [#40](https://github.com/pyrycode/pyrycode-desktop/issues/40) — the automated fake-transport sibling this runbook is the manual counterpart of.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#252](../codebase/252.md) — aims to automate the real-daemon+real-claude half of this runbook (still a local relay, not the live one); for its current pass/fail state see § Current real-claude gate state above.
- [App shell](app-shell.md) / [#80](https://github.com/pyrycode/pyrycode-desktop/issues/80) — the launch router: fresh install → pairing screen; `onPaired` → conversation, no restart (steps 1–2).
- [Pairing input screen](pairing-input-screen.md) / [#55](https://github.com/pyrycode/pyrycode-desktop/issues/55) + [Daemon connection](daemon-connection.md) / [#82](https://github.com/pyrycode/pyrycode-desktop/issues/82) — the pair → connect path: paste → fingerprint-verify → confirm → connect-on-pair dials the live relay.
- [Composer send](composer-send.md) / [#31](https://github.com/pyrycode/pyrycode-desktop/issues/31) + [#66](https://github.com/pyrycode/pyrycode-desktop/issues/66) and [Conversation shell](conversation-shell.md) / [#69](https://github.com/pyrycode/pyrycode-desktop/issues/69) — the send → stream path: the connection-status gate (the `connected` observable) and the thread render.
- `src/main/pairingPayload.ts` / [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52) — the relay-allowlist gate (`RELAY_ALLOWLIST`, line 55), the load-bearing prerequisite.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay; the wire types match mobile field-for-field, which is why this is the desktop equivalent of mobile's live-e2e runbook.
- `scripts/live-drive.mjs` / [#480](https://github.com/pyrycode/pyrycode-desktop/issues/480) — the live-RELAY pre-ship gate: built app → production relay → live Mac daemon → vault workdir, the automated companion to this manual live-relay runbook, covering the live-relay path `e2e:real-claude` never touches.
