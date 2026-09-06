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

The load-bearing "connection reached `connected`" signal is in the composer, **not** in app logs. The send button is gated on the live connection status ([#31](https://github.com/pyrycode/pyrycode-desktop/issues/31)); it flips the moment `status` reaches `connected` ([composer send § 4](composer-send.md#4-connection-status-gate--composeravailability-31)):

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

## Current real-claude gate state

**Last run: 2026-09-04 — the tier grew to 13 specs.** `e2e/real-claude-attachment.spec.ts` ([#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055)) is the live proof that an attached file
actually reaches claude: it pairs against a real spawned daemon, creates a conversation through the UI,
drives one **cursor-stamp turn** first (an ordinary message, drained to quiesce), then stubs
`dialog.showOpenDialog` to answer a real solid-red PNG on disk, attaches it through the production upload
path, sends a message asking claude to name the image's dominant colour, and polls the assistant rows —
stripped and skip-offset past the stamp turn's own reply — for a **word-anchored** `/\bred\b/i`. The
assertion is on the reply's text, never on client state, which is the point: a client that renders the
attachment perfectly and sends no `attachment_ids` passes every other tier in this repo and fails only
this one.

**The cursor-stamp turn is load-bearing, not incidental, and was discovered by a failing live run.** An
`attachment_chunk` carries no conversation id by design — the daemon files a completing upload under its
follow-active cursor, which its `send_message` relay handler stamps only on the successful-route path;
creating a conversation does not stamp it. The first live run of this spec attached immediately after
conversation creation and died 123 polls into "The host could not store the file." (`attachment.storage_failed`), with the drive never reaching the picker stub at all. Upstream's daemon-side twin rides the identical prior-turn precondition — see `pyrycode` `docs/specs/architecture/2039-live-attachment-read.md` § Sequence step 2. **The operator hits the same wall** — attaching to a brand-new discussion is an ordinary flow and fails identically — filed separately as [#1076](https://github.com/pyrycode/pyrycode-desktop/issues/1076); not fixed here, since the remedy is an unmade UX decision and this ticket's scope is the spec, not the precondition.

The tenth interactive spec (the entry directly below, #929) still reads "11" as the prior state at the
time it landed; that count was **itself already stale by one**, since #1067's `desktop-isolation.ts`
landed between #929 and #1055 with no `real-*` spec of its own (a harness fix, not a tier addition) —
`origin/main` carried 12 `real-*.spec.ts` files by the time #1055 branched, measured directly rather than
transcribed from this section. **The
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor below (§ Automated coverage) needs bumping to 13** to match.

**Last run: 2026-09-04 — the tier grew to 11 specs and holds green.** The tenth interactive spec,
`e2e/real-claude-question-cancel.spec.ts` (#929), landed as the refusal twin of #928's answer arm on
the same question vertical: it drives a live claude into refusing its own `AskUserQuestion` batch
through Cancel, then proves the gated work left no artefact via a recursive post-quiesce walk of the
daemon's workdir, contained by an allow arm on any permission modal raised after the refusal so the
absence cannot be the permission gate's own doing. Second consumer of the `claudeModel` and
`requiredCapabilities` fixture options after #928 (see
[real-claude-liveness-e2e.md](real-claude-liveness-e2e.md)). **The untracked
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor below (§ Automated coverage) needs bumping from 10 to 11**
to match — this note is the "PR that adds a `real-*` spec must say so" the floor's own bullet asks for.

**Last run: 2026-09-02 — the tier grew to 10 specs and holds green.** The ninth interactive spec,
`e2e/real-claude-question-answer.spec.ts` (#928), landed and passed on its first live execution
against `claude-sonnet-5` — the round trip from a real `AskUserQuestion` batch through the panel back
to a resumed turn, previously proven only against a scripted `daemon.pushFrame`
([question-panel-continue-answer.md](question-panel-continue-answer.md)).

**That same run surfaced a routing bug in the tier partition itself**, unrelated to the spec's own
liveness proof. The dispatcher's gate on the landing commit came back red with 2 failures out of **66
executed**, against a tier that holds 10. Both `playwright.config.ts`'s `testIgnore` and
`playwright.real-claude.config.ts`'s `testMatch` matched `/real-.*\.spec\.ts$/` against the
**absolute** file path, and `.*` spans `/` — so the pattern matched every spec in the tree whenever
any *ancestor directory* was named `real-…`, which the dispatcher's own `real-claude-gate-<N>`
worktree always is. Both reported failures were specs that had no business being collected under this
config at all: one was a fake-tier spec caught only by the path bug and never actually broken, the
other a pre-existing failure on `real-daemon-session-settings.spec.ts` (filed as
[desktop#941](https://github.com/pyrycode/pyrycode-desktop/issues/941), reproduced against
`origin/main` and structurally unrelated to #928's change). The inverse direction was the more
dangerous half: in that same worktree the default config's `testIgnore` would have ignored all 66
specs and exited 0 on a suite that never ran. Both patterns are now
`/(^|\/)real-[^/]*\.spec\.ts$/` — anchored to a path boundary, held inside one filename segment — so
the partition depends on the filename alone, which is what both configs always claimed. Verified by
`playwright test --list` under both configs in a throwaway ordinarily-named worktree, where the fix is
a no-op: 10 tests under the real-claude config, 56 under the default, unchanged from before.

**Red from 2026-09-02 ~21:00 to 2026-09-03, owned by #975, fixed by #987.** PR #982 (issue #975) deleted
`MODEL_CATALOG`: the run-config sheet's Model rows became exactly the entries of the daemon's published
`model_list` frame, which the daemon emits only from claude's own model announcement. `real-daemon-session-settings.spec.ts` is deliberately claude-less (`spawnClaude: false`), so no announcement is ever made
and the rows could never appear — the spec failed at the first sheet read, parking the whole
all-or-nothing floor. The break was first surfaced by issue #962's gate run at 22:57 that same day (10
executed / 9 passed / 1 failed); with no baseline command configured the gate attributed it to
`feature/962` by default, but it reproduces identically on `origin/main` through the untouched trigger
\#962 later replaced. #987 re-keyed the round-trip onto the YOLO switch, the one run-config control that
takes no published rows (detailed in
[real-daemon-credential-light-e2e.md](real-daemon-credential-light-e2e.md)), restoring the floor to
10/10 with no spec change needed elsewhere.

Prior state, retained as history: the daemon's production interactive runner has been **stream-json**
since 2026-07-24 — claude is driven over a structured stdin/stdout stream, not a PTY. The four
interactive real-claude specs that existed at the time (send/stream, interrupt, permission-modal,
queue-drop) migrated onto the stream runner in
[#490](https://github.com/pyrycode/pyrycode-desktop/pull/490) (merged), first going fully green
2026-07-26 (8 passed / 0 failed) after the last red, **queue-drop**, was fixed by pyrycode#1199 (a
drain race, not a missing message). The four claude-less `real-daemon-*` specs were already green
throughout. The PTY-era diagnosis previously recorded here — `DetectModalClass` returning Unknown on
the live session buffer — is historical: it described the PTY runner's modal detection, which the
stream-json migration made moot for this gate.

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
PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED=13
```

Why each line is what it is:

- **Install and build chatter goes to stderr on purpose.** The gate reads stdout and expects Playwright's JSON report alone. Its parser skips to the first `{`, but npm output ahead of the report can still defeat it, so the chatter is routed away rather than tolerated.
- **The gate needs the per-test JSON reporter, not `e2e:real:gate`.** The repo's own gate script prints a human list. The dispatcher counts tests that ran a body, and it cannot count what it cannot read.
- **The floor must equal the exact spec count on the branch, not an approximation.** These specs are discrete and countable. Set the floor below the true count and a run in which one spec skipped still clears it and reports a pass — the false green the whole mechanism exists to catch, reintroduced through the floor. The cost is a manual bump whenever a spec is added, so a PR that adds a `real-*` spec must say so. [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) is the latest such PR: the tier is now 13 specs and the floor shown above (13) reflects that — see § Current real-claude gate state, which also records the count drifting stale by one between #929 and #1055 with no PR announcing it, the exact failure mode this bullet exists to prevent.
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
