# Spec #13 — Capstone: end-to-end round-trip (live operator runbook)

**Size: XS.** Deliverable is **one new documentation file**: an operator runbook under `docs/knowledge/features/`. **Zero** production `.ts`/`.tsx` files, **zero** new types/components, **zero** tests. The three acceptance criteria are all *operator actions on the live stack* (pair against the real daemon on pyrybox → connect → send → observe the reply → record the outcome on the ticket); none is agent-executable and none is a developer code deliverable. See [§ Why this is documentation-only](#why-this-is-documentation-only-the-manual-operator-gate).

> **This is a documentation-deliverable ticket.** The developer's worktree mutates exactly **one** file: the new runbook under `docs/knowledge/features/`. The general "developer worktree should only touch code, tests, and the spec" guidance guards against smuggling a *fixed-cost knowledge-doc AC onto a code ticket*; here the doc **is** the work (there is no code), so that rule's rationale does not fire. Do **not** add a `docs/knowledge/codebase/<N>.md` AC — that stays the documentation phase's job. Do **not** touch `docs/knowledge/INDEX.md` — the documentation phase is its sole writer (it will add the one-line index entry post-merge). This mirrors the mobile precedent exactly (mobile spec #661, `mobile-live-e2e-runbook.md`).

## Files to read first

- `docs/knowledge/features/app-shell.md` (whole) — the launch router (#80): a fresh install resolves `not-paired` and lands on the pairing screen; `onPaired` advances to the conversation screen with no restart. **The runbook's "launch → land on pairing" and "confirm → conversation" steps rest on this.** Lift the launch-outcome → screen mapping.
- `docs/knowledge/features/pairing-input-screen.md` (whole) — the paste-only pairing flow (#55): paste `pyry pair --print` payload → submit → review the derived **fingerprint** → **confirm** persists / cancel discards. The § "Fingerprint formatter" (23-char `aa:bb:…` form, spatial-only grouping) and § "Security posture" ("the fingerprint compare is the trust anchor") are the source for the runbook's byte-for-byte-compare step.
- `docs/knowledge/features/daemon-connection.md` (whole) — the background transport consumer (#62) and **connect-on-pair** (#82). § "Connect-on-pair (`reconnect()`)" is why a *fresh* pair immediately dials the live relay; § "Log-free by construction" and § "Security properties" are why the operator's observable is the **UI + pyrybox logs**, not verbose desktop transport logs (there deliberately are none around the transport).
- `docs/knowledge/features/composer-send.md:77-107` — the connection-status gate (#31): the **composer send button is disabled with a `Connecting…` / `Not connected` caption until `status === 'connected'`, then enables**. This flip is the runbook's load-bearing "connection reached `connected`" UI observable. Also § "Data flow" — the send → optimistic echo → daemon-reply-dedupe path.
- `docs/knowledge/features/conversation-shell.md:60-70` — the thread renders live store messages (#69): the sent message appears immediately as `data-message-role="user"`, the streamed daemon reply as `data-message-role="daemon"`. This is the runbook's "reply streams into the thread" observable.
- `src/main/pairingPayload.ts:1-55` — the relay-allowlist gate (#52). `RELAY_ALLOWLIST` (line 55) is a single host: `pyrycode-relay.pyryco.de` (scheme must be `wss:`). **Load-bearing operator gotcha:** a `pyry pair --print` payload whose relay host is anything else is rejected inline (`relay-host-not-allowed`) and never pairs. The runbook must state the operator's daemon/relay must sit behind this exact relay for milestone 1. Also note the wire encoding: base64url (no padding) of a four-field JSON tuple — **no `pyry://` wrapper**; `pyry pair --print` emits exactly this.
- `docs/knowledge/features/e2e-harness.md` (skim) — the **automated** fake-transport harness (#40). The runbook is its **manual sibling**; cross-reference it as a neighbor and state the boundary (this runbook is the live stack, operator-machine-only, never CI).
- Reference precedent (QMD, not in this repo): `pyrycode-docs/knowledge/features/mobile-live-e2e-runbook.md` and `pyrycode-docs/specs/architecture/661-mobile-live-e2e-transcript-resolution-runbook.md` — the mobile manual-operator-runbook shape this doc mirrors (prose + numbered runbook + observables + "operator-verified, not CI, record on the ticket").

## Context

This is the **Phase-1 milestone gate**: the full round-trip against the **live** relay and the **real** daemon on pyrybox — pair → connect → send → watch the structured reply stream back into the window. Every code slice it waited on has landed:

- Pairing screen + IPC/confirm chain (#54/#55) and the parse+allowlist gate (#52) and fingerprint-confirm (#53).
- App-shell routing that mounts the pairing screen and advances to the conversation screen (#80, blocker cleared).
- Connect-on-pair, so a fresh pairing immediately dials the live relay (#82, blocker cleared).
- Outbound send + composer (#65/#66), connection-status gate (#31), inbound decode (#68) + thread render (#69).

Both stated blockers (#78→#80 app-shell, #34→#82 connect-on-pair) are **merged**. The remaining `#34` child #83 (reload the stored record on every *automatic* reconnect) is **not** a blocker for this gate — the first fresh pair dials via #82's `reconnect()`, which re-sources the just-persisted record at dial time; #83 only concerns transient-drop re-dials mid-session (note it as a known limitation, not a prerequisite).

**Why now, and why a runbook:** the ticket cannot be executed by the pipeline — pairing against the live relay and driving a real daemon on pyrybox needs live credentials, a running daemon, and network access to real infrastructure the architect/developer/QA agents do not have. The deliverable is therefore a **manual operator runbook** an operator follows on the live stack, recording the outcome (screenshot and/or log excerpt) as a comment on the ticket. This mirrors how mobile drew the line: automated fake-harness suites in the pipeline **+** a manual live-stack runbook that "runs only on an operator machine, never under CI." Desktop reuses the same wire contract, so the same separation applies. Proving the round-trip live is deliberately what unblocks the Phase-2 hardening + automated-test batch (#35–#41), which encode this milestone as regression coverage.

## Why this is documentation-only (the manual operator gate)

The ticket body leaves no fork: "No production code is expected from this ticket." All three ACs are operator actions requiring live infra:

1. Build + launch the app, land on pairing, paste a real `pyry pair --print` payload, verify the fingerprint, confirm → the pairing persists and the app connects to the **live** relay (handshake completes; status reaches `connected`).
2. Type a message in the composer and send it → the daemon on pyrybox receives it and the structured reply streams back into the thread.
3. The full pair → connect → send → stream round-trip is observed end-to-end on the live stack; the operator records the outcome as a comment on the ticket.

None of the three is a code change; each is a live-stack action no agent can perform. The one durable, buildable artifact that reduces operator friction is the runbook. There is **no code to add**, so no `needs-rework:po` split and no developer implementation beyond writing the doc. (Any code gap the operator surfaces during the live run is a **new** ticket, not scope here — the ticket body says so explicitly.)

**§4 production-source self-check:** new/modified `*.ts` / `*.tsx` files (excluding tests, `*.md`, and this spec) = **0**. Well under the ≥5 gate. **File-overlap check:** ran `git fetch origin --prune` + branch-overlap scan for both target paths against all in-flight `feature/*` branches; no overlap (both filenames are new and ticket-unique).

## Design — the deliverable doc

**Create one new file:** `docs/knowledge/features/live-e2e-runbook.md`.

**Home rationale (architect's call).** A new file under `docs/knowledge/features/`, *not* an append to `e2e-harness.md`. `e2e-harness.md` documents the **automated** fake-transport harness (#40); this is the **manual operator runbook** for the live relay + real daemon on pyrybox — a distinct, evergreen concern. Keeping it separate keeps both scopes clean; the runbook cross-references `e2e-harness.md` as its automated sibling. The name `live-e2e-runbook.md` sits as the deliberate manual counterpart to `e2e-harness.md`, mirroring mobile's `mobile-live-e2e-runbook.md`. (If the documentation phase prefers a different filename at INDEX time, that is a rename, not a content change. The documentation phase adds the one-line `INDEX.md` entry post-merge — do **not** write it here.)

The doc is prose + a numbered runbook + one observables block. **Required sections** (the developer writes the project's house markdown style — see the existing `docs/knowledge/features/*.md` register; these are the *contract* for what must be covered, not a layout to transcribe verbatim):

1. **Title + one-paragraph purpose.** State up front: this is the manual operator gate for the Phase-1 milestone — the live round-trip against the real relay + real daemon on pyrybox — and it runs **only on an operator machine, never under CI**. Name it the manual sibling of the automated `e2e-harness.md` (#40).

2. **Prerequisites (daemon + relay side, operator-supplied).** Cover, without hardcoding operator secrets/endpoints (the ticket hardcodes neither):
   - A running `pyry` daemon on pyrybox, reachable through the relay.
   - **The relay allowlist gotcha (load-bearing).** The desktop client only accepts a pairing payload whose relay host is `pyrycode-relay.pyryco.de` over `wss:` — the single-entry `RELAY_ALLOWLIST` (`src/main/pairingPayload.ts:55`, #52). A payload naming any other relay is rejected inline (`relay-host-not-allowed`) and never pairs. So the operator's daemon must be reachable via that exact relay for milestone 1. Cite the file:line; state a future multi-relay change edits that set and nowhere else.
   - `pyry pair --print` on pyrybox mints the pairing payload (base64url, no padding, four fields: `server`, `relay`, `token`, `server_static_pubkey`; **no `pyry://` wrapper**). The operator copies it to the desktop machine.

3. **Build + launch the app (AC1, first half).** `npm install`, `npm run build` (the salvage/QA gate — CLAUDE.md), then launch. A fresh install has no stored pairing, so the app-shell router resolves `not-paired` and **lands on the pairing screen** (#80). Cite `app-shell.md`.

4. **Pair — the numbered flow (AC1, core).** Each step names the feature it leans on:
   1. **Paste** the `pyry pair --print` payload into the pairing screen's field (#55).
   2. **Submit** — main parses it, validates the relay against the allowlist (#52), derives the server-key **fingerprint** (#53), and the screen shows the fingerprint (23-char `aa:bb:cc:…` form, grouped for readability; #55 formatter).
   3. **Verify the fingerprint byte-for-byte** against what `pyry pair --print` printed on pyrybox. **This is the security trust anchor** — the runbook must state the compare is on characters/case/order verbatim (grouping is spatial only) and that a mismatch means *do not confirm*. (Cite `pairing-input-screen.md` § Security posture.)
   4. **Confirm** — the pairing persists (in main, `safeStorage`) and **connect-on-pair (#82) immediately dials the live relay**, re-sourcing the just-persisted record; the Noise_IK handshake runs. Cite `daemon-connection.md` § Connect-on-pair.

5. **Observe `connected` (AC1, end) — the UI observable.** The load-bearing signal: the composer's send button flips from **disabled with a `Connecting…` caption** to **enabled with no caption** the moment `status` reaches `connected` (#31 gate; cite `composer-send.md:77-107`). State plainly that the desktop transport is **log-free by construction** (#62 — no `console.*` around the handshake, to avoid leaking the token/keys/transcript), so the operator watches the **UI** (composer enables) and the **pyrybox daemon logs**, not verbose desktop app logs.

6. **Send + stream (AC2).** Type a message and send (button or Enter, #66): it appears immediately as a `user` bubble (optimistic echo, `data-message-role="user"`). The daemon on pyrybox receives it (#65 outbound envelope) and the structured reply streams back — decoded in main (#68) and rendered into the thread as `data-message-role="daemon"` bubbles (#69). Note the daemon's echo of the same `message_id` is deduped (one bubble, not two). Cite `conversation-shell.md` + `composer-send.md` § Data flow.

7. **Record the outcome (AC3).** State the operator records the round-trip result as a **comment on the ticket** — a screenshot of the streamed reply in the window and/or the relevant pyrybox daemon log excerpt. Mark this explicitly as **operator-verified on the live stack, not a CI gate**; the developer cannot and need not run this stack.

8. **Known limitations / gotchas.** A short list:
   - **Relay-allowlist rejection** is the most likely first-run failure — a payload naming a relay other than `pyrycode-relay.pyryco.de` rejects inline; check the payload's `relay` field.
   - **`error` and `not-paired` both route to pairing** (#80 fail-safe) — a stored-but-unreadable pairing shows the pairing screen, not the conversation; re-paste to recover.
   - **Transient-drop reconnect does not yet reload the stored record** — that's #83 (open); a fresh pair (this gate's path) dials the current record via #82, so the gate is unaffected.
   - **Single active conversation** (`MILESTONE_CONVERSATION_ID = 'default'`, #66) — no conversation selection this milestone.

9. **Cross-references.** Link, one line each: `e2e-harness.md` (the automated sibling, #40), `app-shell.md` (#80), `pairing-input-screen.md` (#55) + `daemon-connection.md` (#82) (the pair→connect path), `composer-send.md` (#31/#66) + `conversation-shell.md` (#69) (the send→stream path), and `src/main/pairingPayload.ts` (#52, the relay allowlist). Note the wire contract matches mobile (ADR 0002) — this is the desktop equivalent of mobile's live-e2e runbook.

**Constraints on the doc body:**
- No code blocks longer than a shell-command line (`npm run build`) or a reproduced inline-error label. Cite functions/modules by file:line or by feature-doc link; do not paste bodies.
- Voice/format: match the existing `docs/knowledge/features/*.md` house style.
- Keep it minimal — a setup + verification recipe, not a tour of the transport stack. Defer wire/Noise details to the feature docs and ADR 0002 by reference.
- Never hardcode an operator secret, token, or a pyrybox endpoint the ticket says is operator-supplied at run time; the one fixed value is the milestone relay host (`pyrycode-relay.pyryco.de`), which is already public in `pairingPayload.ts`.

## State + concurrency model

N/A — documentation only. For accuracy, the doc must correctly describe one concurrency-relevant fact: **connect-on-pair (#82) dials on `onPaired` after the confirm persists, re-sourcing the record at dial time** — which is why a fresh pair reaches `connected` with no restart. Source: `daemon-connection.md` § Connect-on-pair; cite, do not re-derive.

## Error handling

The "errors" the runbook documents are operator-facing and already fail-closed in code; the doc explains them so the operator can self-diagnose a first run, not add handling:
- **Paste/relay rejections** (#52) surface as inline captions on the pairing screen (`relay-host-not-allowed`, `invalid-paste`, etc.); nothing is stored. The runbook's prerequisites (correct relay) pre-empt the common one.
- **Not-connected composer** (#31) is the *expected* pre-handshake state (button disabled, `Connecting…` caption) — benign, not a failure; it clears on `connected`.
- **A failed connect** surfaces as a `failed` daemon event → the composer shows `Connection error`; the runbook notes this is where to check the pyrybox daemon logs (the desktop side is log-free by design).

## Testing strategy

- **No automated test.** The live relay + real-daemon stack runs only on an operator machine, never under CI (consistent with the milestone's Phase-1/Phase-2 split and the mobile precedent). Adding a live relay e2e is explicit scope-creep and out of bounds — the automated round-trip is the separately-tracked #39/#41, sequenced *after* this gate.
- **The existing automated coverage stands in for mechanism correctness:** the fake-transport harness (#40) plus the per-slice unit suites (#52/#53/#55/#62/#65/#66/#68/#69) already prove pair/connect/send/stream against fakes. This runbook is the operator confirmation that the **same** mechanism works against the **live** stack.
- **AC verification = the runbook itself**, executed by the operator on the live stack: follow the steps, observe the § Design step 5–6 UI observables, record the result on the ticket.

## Open questions

- **Automated live e2e is deferred by design.** #39 (automated transport round-trip) and #41 (UI-driven e2e) encode this milestone as regression coverage and are intentionally sequenced *after* the live demonstration, blocked **by** this gate. The runbook should carry a one-line "automated coverage is deferred; #40's fake harness + the per-slice suites + this runbook are the current coverage" note — not build it.
- **Doc filename.** `live-e2e-runbook.md` chosen as the manual counterpart to `e2e-harness.md`; if the documentation phase prefers another name at INDEX time, that's a rename, not a content change.
- **Operator handoff.** After this spec's runbook lands, the three ACs still require a human operator to run the live gate and record the outcome on #13 — that step is outside the agent pipeline (the ticket's core deliverable). The runbook is the architect/developer contribution; the live run and the recorded outcome are the operator's.
