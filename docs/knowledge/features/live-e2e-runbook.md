# Live e2e runbook — the manual operator gate for the Phase-1 round-trip

The manual operator recipe for the **Phase-1 milestone gate** ([#13](https://github.com/pyrycode/pyrycode-desktop/issues/13)): pair the built desktop app with the **live** relay and the **real** `pyry` daemon on pyrybox, send a message, and watch the structured reply stream back into the window — the full **pair → connect → send → stream** round-trip against real infrastructure, not fakes.

This runs **only on an operator machine, never under CI**. Pairing against the live relay and driving a real daemon needs live credentials, a running daemon, and network access the pipeline agents do not have — so this gate is not agent-executable. It is the **manual sibling** of the automated fake-transport [e2e harness](e2e-harness.md) ([#40](https://github.com/pyrycode/pyrycode-desktop/issues/40)): that suite launches the built app and drives pairing/send/stream against fakes in Playwright; this runbook confirms the **same** mechanism works against the **live** stack. It is the desktop equivalent of mobile's live-e2e runbook — desktop reuses the same wire contract (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), so the same manual-vs-automated separation applies. It is a setup + verification recipe, not a tour of the transport stack; the wire/Noise details live in the feature docs and ADR 0002 by reference.

Proving the round-trip live is deliberately what unblocks the Phase-2 hardening + automated-test batch (#35–#41). The automated round-trip and UI-driven e2e (#39/#41) encode this milestone as regression coverage and are sequenced **after** this gate, blocked *by* it — see [Automated coverage is deferred](#automated-coverage-is-deferred).

## Prerequisites (daemon + relay side)

The operator supplies the daemon, the relay endpoint, and the credentials at run time; this runbook hardcodes none of them. The one fixed value is the milestone relay host, which is already public in the client.

1. **A running `pyry` daemon on pyrybox, reachable through the relay.** Its exact endpoint and credentials are operator-supplied.

2. **The relay must be `pyrycode-relay.pyryco.de` over `wss:` — this is load-bearing.** The desktop client only accepts a pairing payload whose relay **host** is in a single-entry allowlist: `RELAY_ALLOWLIST = { 'pyrycode-relay.pyryco.de' }` (`src/main/pairingPayload.ts:55`, [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52)), matched by exact host with a `wss:` scheme (the deployed relay is `wss://pyrycode-relay.pyryco.de/v1/client`). A payload naming any other relay — or any look-alike host — is rejected inline with `relay-host-not-allowed` and **never pairs**. So for milestone 1 the operator's daemon must be reachable via that exact relay. A future multi-relay change adds entries to that one set and nowhere else.

3. **Mint the pairing payload with `pyry pair --print` on pyrybox.** It emits a base64url string (URL-safe, **no padding**) of a four-field JSON tuple — `server`, `relay`, `token`, `server_static_pubkey` — with **no `pyry://` wrapper** (the wire encoding the desktop gate parses; `src/main/pairingPayload.ts:1-21`). The operator copies that string to the desktop machine.

## 1. Build + launch the app (AC1, first half)

```
npm install
npm run build
```

`npm run build` is the salvage / QA gate (typecheck, then the electron-vite build; CLAUDE.md) — it must be clean before launch. Launch the built app.

A fresh install has **no stored pairing**, so the [app-shell](app-shell.md) router ([#80](https://github.com/pyrycode/pyrycode-desktop/issues/80)) resolves `not-paired` at launch and **lands on the pairing screen** (the conversation screen is reachable *only* on a genuine `paired` — every other launch outcome falls safe to pairing).

## 2. Pair — the numbered flow (AC1, core)

Each step names the feature it leans on. See the [pairing input screen](pairing-input-screen.md).

1. **Paste** the `pyry pair --print` payload into the pairing screen's monospace field ([#55](https://github.com/pyrycode/pyrycode-desktop/issues/55)).
2. **Submit (Pair).** Main parses the payload, validates the relay against the allowlist ([#52](https://github.com/pyrycode/pyrycode-desktop/issues/52)), and derives the server-key **fingerprint** ([#53](https://github.com/pyrycode/pyrycode-desktop/issues/53)); the screen shows the fingerprint in its 23-char `aa:bb:cc:dd:ee:ff:11:22` form (8 colon-separated lowercase-hex byte-pairs, grouped for readability).
3. **Verify the fingerprint byte-for-byte** against what `pyry pair --print` printed on pyrybox. **This is the security trust anchor** — the grouping is *spatial only*; compare the characters, case, and order **verbatim**. If they do not match exactly, **do not confirm** (pairing-input-screen.md § Security posture).
4. **Confirm.** The pairing persists in main via `safeStorage`, and **connect-on-pair** ([#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)) immediately dials the live relay — re-sourcing the just-persisted record at dial time — and runs the `Noise_IK` handshake. No restart: `onPaired` advances the app-shell to the conversation screen (daemon-connection.md § Connect-on-pair).

## 3. Observe `connected` (AC1, end) — the UI observable

The load-bearing "connection reached `connected`" signal is in the composer, **not** in app logs. The send button is gated on the live connection status ([#31](https://github.com/pyrycode/pyrycode-desktop/issues/31)); it flips the moment `status` reaches `connected` (composer-send.md:77-107):

- **Before the handshake completes:** the send button is **disabled** with an inline `Connecting…` caption (a `role="status"` live region). This is the *expected* pre-handshake state — benign, not a failure.
- **On `connected`:** the caption unmounts and the send button **enables** with no caption.

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

## Automated coverage is deferred

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

**As of [#449](https://github.com/pyrycode/pyrycode-desktop/issues/449) that harness spec is red on the
live stack**, and it SKIPs cleanly in the pipeline (the `testIgnore` gate in `playwright.config.ts` — it
never runs, and is never seeded green, under the agent's `npm run e2e`). The isolated-HOME harness daemon
*delivers* the turn (claude completes it in an identical manual probe) but **no reply event ever fans back
to the app** — a separate, environment-specific gap left after #448 (PR#450) fixed the client-side
`conversation_id: 'default'` root cause. So do **not** treat `npm run e2e:real-claude` as a working
pre-ship gate until it lands an actual live green there; the live diagnosis is tracked on #449.

**The current interim operator pre-ship gate is `scripts/live-drive.mjs`** (built app → production relay →
live Mac daemon → vault workdir). `npm run build && node scripts/live-drive.mjs .` pairs a throwaway
device, creates a conversation through the UI, sends a message, waits for the real claude reply to stream
in, then revokes the pairing (first green 2026-07-15, ~4s round-trip). It prints progress lines only —
never the pairing payload or token. Run it before a ship in place of the still-red `e2e:real-claude`
harness spec.

## Cross-references

- [E2E harness](e2e-harness.md) / [#40](https://github.com/pyrycode/pyrycode-desktop/issues/40) — the automated fake-transport sibling this runbook is the manual counterpart of.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#252](../codebase/252.md) — aims to automate the real-daemon+real-claude half of this runbook (still a local relay, not the live one), but is **currently red for [#449](https://github.com/pyrycode/pyrycode-desktop/issues/449)** pending the isolated-HOME reply-fan-out diagnosis — see § Automated coverage is deferred.
- [App shell](app-shell.md) / [#80](https://github.com/pyrycode/pyrycode-desktop/issues/80) — the launch router: fresh install → pairing screen; `onPaired` → conversation, no restart (steps 1–2).
- [Pairing input screen](pairing-input-screen.md) / [#55](https://github.com/pyrycode/pyrycode-desktop/issues/55) + [Daemon connection](daemon-connection.md) / [#82](https://github.com/pyrycode/pyrycode-desktop/issues/82) — the pair → connect path: paste → fingerprint-verify → confirm → connect-on-pair dials the live relay.
- [Composer send](composer-send.md) / [#31](https://github.com/pyrycode/pyrycode-desktop/issues/31) + [#66](https://github.com/pyrycode/pyrycode-desktop/issues/66) and [Conversation shell](conversation-shell.md) / [#69](https://github.com/pyrycode/pyrycode-desktop/issues/69) — the send → stream path: the connection-status gate (the `connected` observable) and the thread render.
- `src/main/pairingPayload.ts` / [#52](https://github.com/pyrycode/pyrycode-desktop/issues/52) — the relay-allowlist gate (`RELAY_ALLOWLIST`, line 55), the load-bearing prerequisite.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay; the wire types match mobile field-for-field, which is why this is the desktop equivalent of mobile's live-e2e runbook.
- `scripts/live-drive.mjs` / [#449](https://github.com/pyrycode/pyrycode-desktop/issues/449) — the current interim operator pre-ship gate: built app → production relay → live Mac daemon → vault workdir, the automated companion to this manual live-relay runbook while `e2e:real-claude` stays red.
