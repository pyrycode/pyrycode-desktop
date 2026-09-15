# #1433 — real claude picks up a saved channel system prompt at New session

One new live spec, `e2e/real-claude-system-prompt.spec.ts`, joining the `real-*` tier. No production
file changes.

## Files read

- `e2e/real-claude-new-session.spec.ts` → the whole spec — the flow this one extends (pair → `Create chat`
  → turn → Actions → `New session (restarts claude)` → turn), its `nonEmptyAssistantCount` helper, its
  selector block and its timeout constants. The nearest analogue named by the ticket.
- `e2e/channel-system-prompt.spec.ts` → the fake twin — which selectors drive the section
  (`.conversation__overflow-trigger`, the `Channel info` menuitem, `.system-prompt__input`,
  `.system-prompt__save`, `.system-prompt__write`) and what it deliberately proves that this one does not
  (the tri-state write, the byte gate, the `differs` notice). Untouched by this ticket.
- `src/renderer/src/screens/conversation/SystemPromptSection.tsx` → `SystemPromptSectionView` and
  `deriveSystemPromptSection` — the `loading` arm renders `.system-prompt__empty` and **no editor and no
  controls**, so `.system-prompt__input` appearing is the only observable that the reading landed. That is
  AC4's gate.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView` (the sheet is
  `role="dialog" aria-modal="true"`, closed by `.status-sheet__close`), the `sessionBoundary` and
  `compactionBoundary` arms of the timeline switch (**both** render `.session-delimiter`; only compaction
  adds `.compaction-delimiter`), and the `data-thread-role="assistant"` bubble. A tool row carries
  `data-thread-role="tool"`, so it never enters the assistant count.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions` — `interactiveRunner`, and `requiredCapabilities`
  defaulting to `[]` (no probe dialled, the spec gated on the `pyry` binary + claude + a credential alone).
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch` — the shared unpaired-launch arrival, and its
  invariant 2 (the payload is opaque and never asserted on), which this spec inherits unchanged.
- `src/renderer/src/PairedShell.tsx` → `requestConversationConfig` and the `useConversationCreatedNav`
  callback — a conversation minted through `Create chat` is activated, and activation is what fires
  `requestSystemPrompt`. That is why the sheet has a reading to show on a freshly created chat.
- `src/main/daemonConnection.ts` → the `conversation-updated` arm that emits `systemPromptWriteConfirmed`
  — the `Saved` line requires a **correlated `conversation_updated` ack from the real daemon**, not an
  optimistic local flip. Recorded under Live-stack dependencies below.
- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state → the tier is 19 specs in
  19 files and the configured `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor is owed a bump; this makes 20.
- `docs/knowledge/features/system-prompt-write.md` → the family's upstream split
  (pyrycode#2149 storage / #2150 applied at next spawn / #2151 write verb / #2152 read verb).

## Design source

**Figma:** N/A — a live e2e spec. No production file changes and nothing rendered is new, so there is no
visual surface for the verifier to check fidelity against.

## Context

The stored-prompt family is built end to end and has never been watched working. #1078 shipped the Channel
info editor behind a green real-claude gate, but none of the tier's specs touches the prompt, so that green
said nothing about whether claude actually behaves differently after a prompt is saved. This spec is the
family's first behavioural proof, and it is the one spec in the tier where a reply's **content** is the
evidence rather than decoration.

No ADR is warranted: this adds no decision, only a proof of one already taken upstream.

## Design

### The marker, and why the negative half is sound

The saved prompt is `Begin every reply with the exact token MARKER-<run nonce>`. The nonce is per-run, so
no row from an earlier turn or an earlier run can satisfy the positive assertion (AC3).

The marker string **never enters a composer message** — it exists only inside the system prompt textarea.
That is what makes the negative half (AC2) sound rather than a timing guess: the session that was already
running was never shown the instruction, and a model cannot emit a per-run nonce it has not seen. So the
negative assertion is not "the reply happens to lack the marker", it is "the reply cannot contain the
marker unless the daemon applied the prompt to a live session", which is precisely the behaviour under
test.

### The flow

1. Pair from an unpaired launch via `pairFromUnpairedLaunch`, with the relay leg assembled the
   `real-claude.spec.ts` way (`${relay.url}/v1/client`).
2. Wait for `.channel-list__row-open` — its visibility is the connected gate. Then click the workspace
   row's `Create chat` plus (the operator flow, not a pre-bound seed) and wait for `.conversation` plus an
   enabled Send.
3. **Turn one**, cold. `Reply with the single word ready. run=<nonce>-a`. Wait for a non-empty assistant
   row, then for the streaming cursor to clear — the turn is over, not merely started.
4. Open the sheet: `.conversation__overflow-trigger`, then the `Channel info` menuitem. Gate on
   `.system-prompt__input` appearing (§ AC4 below). Fill it with the marker prompt, click
   `.system-prompt__save`, wait for `.system-prompt__write` to read `Saved`, close via
   `.status-sheet__close`. The sheet is `aria-modal` over the conversation surface, so the composer and the
   Actions menu are unreachable until it is closed.
5. **Turn two**, warm, same session. After it quiesces, **no assistant row anywhere in the thread carries
   the marker** (AC2). Asserting over the whole thread rather than only the newest row is strictly stronger
   and simpler: every row present at this point belongs to the pre-restart session.
6. **New session** through the Actions menu (`Actions` trigger, `New session (restarts claude)` menuitem).
   Exactly one session delimiter.
7. **Turn three**, cold again. The **first non-empty assistant reply following the delimiter** contains the
   marker (AC3).

### Reading a reply

Two page-context helpers, both cloning each row and dropping its `.bubble__meta` subtree and the `▎`
cursor before reading text — `nonEmptyAssistantCount`'s strip in `real-claude-new-session.spec.ts`, kept
verbatim so the two specs read a bubble the same way. The strip runs on a detached copy; the live DOM is
untouched.

- `assistantMarkerCount(page, marker)` → how many non-empty assistant rows contain the marker. A **count**,
  not the text: a failure diff then prints `0` vs `2` and never a transcript.
- `markerAfterDelimiter(page, marker)` → walks `document.querySelectorAll('<assistant>, <delimiter>')`
  (document order regardless of nesting), slices after the first delimiter, takes the **first** non-empty
  assistant row, and returns whether it contains the marker. AC3 says *the first reply following the
  delimiter*, and a turn may emit more than one text block, so reading the newest row instead would be a
  weaker claim than the AC makes.

Containment only, never position and never full text: a preamble must not redden the tier. This inverts the
siblings' deliberate "do not assert reply content" posture, and does so because here the reply **is** the
proof — stated in the spec's header so the next reader does not file it as drift.

### The delimiter selector

`.session-delimiter:not(.compaction-delimiter)`. The sibling uses the bare class, which is sound for a
count-only assertion; this spec slices rows *relative to* the delimiter, so a compaction boundary landing in
the same thread would silently move the slice point. Excluding it makes the restart's own marker the only
thing that can anchor the read.

### AC4 — the stale-daemon gate

While `request_system_prompt` is outstanding the section renders `.system-prompt__empty` and no editor at
all, so there is no disabled control to wait on. The gate is `.system-prompt__input` becoming visible within
the handshake timeout, carried by `expect(locator, message)` so the failure names a daemon that never
answered the read rather than surfacing as an unhelpful timeout three steps later. A daemon without
pyrycode#2152 never answers, and every later step would otherwise fail somewhere misleading.

### Out of scope, deliberately

- **`.system-prompt__session` is not asserted.** The reading is requested once per activation and not after
  a save, so the running-session-differs line does not appear without leaving and reopening the
  conversation.
- **The `differs` mechanics, the tri-state write and the 8192-byte gate** stay the fake tier's
  (`channel-system-prompt.spec.ts`, untouched). This spec proves spawn-time application only.
- **Which process produced the third reply** cannot be proven from the DOM over the real wire — the
  sibling's accepted limitation. Here the marker is a *stronger* signal than the sibling had: only a
  freshly spawned process could have been given the prompt.

## Testing strategy

The spec **is** the deliverable; there is no unit tier for it (`e2e/` is outside both tsconfigs and is not
type-checked, so `npm run build` cannot cover it either). Proof of correctness is the live run:

- `npm run e2e:real-claude` collects and runs the new spec green against the pinned test daemon, with its
  source revision recorded in the PR.
- `npm run e2e` still collects **no** `real-*` spec — `playwright.config.ts`'s anchored `testIgnore`.
- `npm run build` clean (the salvage gate; unchanged, since no production file moves).

The dispatcher's authenticated gate is what executes the live tier. Per § B2 and the repo's CLAUDE.md, the
builder does not run `npm run e2e:real-claude` itself.

### Live-stack dependencies — what a red here would mean

| Step | Needs | A red means |
|---|---|---|
| `.system-prompt__input` appears | pyrycode#2152 (read verb) | stale daemon; the gate names it |
| `.system-prompt__write` reads `Saved` | pyrycode#2151 answering the write with a correlated `conversation_updated` — `daemonConnection.ts`'s `systemPromptWriteConfirmed` is ack-driven, never optimistic | the write verb is absent or does not ack |
| turn three carries the marker | pyrycode#2150 (applied at spawn) | a real red, not a flake |

### Budget

Three turns — cold, warm, cold again after the restart — plus a sheet round trip. `test.setTimeout` above
the sibling's 420 s; the config's 300 s is not enough and only `test.setTimeout` overrides it.

## Documentation handoff

Pending the documentation stage; not this builder's edits.

- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state — an entry for this tier
  addition stating the new count (**20 specs in 20 files**) and that
  `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is owed a bump to **20**. The section's own discipline is that a PR
  adding a `real-*` spec must say so; that entry is where it lands. The floor lives in the fork's
  dispatcher configuration, not the repo.
- `docs/knowledge/features/system-prompt-write.md` — record that the family now has a live proof, naming
  `e2e/real-claude-system-prompt.spec.ts` and what it establishes: the prompt is applied at spawn, and a
  save does not reach the running session.

## Open questions

1. **Does haiku comply with the marker instruction reliably?** The instruction is short, literal and the
   first sentence of the system prompt, and the message prompts are trivial. Resolved in Phase B only by the
   live run; a non-compliant model would show as AC3's assertion failing immediately after a completed turn
   rather than as a timeout, which is the diagnosis the design is shaped for.
2. **Does the real daemon's `set_system_prompt` ack carry `in_reply_to`?** Required for `Saved`. Recorded in
   the table above so a red at that step is read as a daemon-contract finding rather than a spec bug.

## Security review

**Verdict:** PASS

This is a test-only change: no production file moves, no new IPC arm, no new wire type, no new trust
boundary. The categories are walked against what the spec itself does — it drives a real daemon, a real
credential and a real relay leg, so it can leak, and the review is about that.

**Findings:**

- **[Trust boundaries]** No findings. The spec adds no boundary. Every value it reads crosses the existing
  daemon → main → renderer → DOM path, and it reads that path only through the DOM. The one value the spec
  *writes* is the marker prompt, which travels the already-shipped `set_system_prompt` path through
  `SystemPromptSection`'s controlled `<textarea>` — the same sink the fake tier drives.
- **[Tokens, secrets, credentials]** SHOULD FIX, discharged by design. The pairing payload built from
  `daemon.pairFields` is secret-bearing. It is handed to `pairFromUnpairedLaunch` and referenced nowhere
  else — never asserted on by value, never interpolated into an assertion message or a `test.step` title,
  never logged. That is `pairingArrival.ts`'s invariant 2, inherited unchanged. The fixture's own no-echo
  rule (`pyry pair` stdout is never surfaced) is untouched.
- **[Secrets in the value under test]** MUST-NOT, and structurally prevented. `SystemPromptSection.tsx`'s
  header records that an operator can paste a credential into a system prompt, which is why nothing on that
  path is ever logged. This spec's prompt is a **spec-authored non-secret literal plus a numeric run nonce**
  — no credential, no daemon string, no environment value is ever composed into it. The marker is
  additionally asserted by *containment of a constant the spec itself minted*, never by printing the
  prompt back.
- **[File / storage operations]** No findings. The spec creates no file and names no path. The daemon HOME,
  the workdir and the app's `--user-data-dir` are all `realDaemon.ts`'s, created by `mkdtemp` and reaped in
  its `finally` on every exit path including a skip. `seedCwdSubdir` is left at its default, so no path is
  composed at all.
- **[Inter-process / Electron attack surface]** No findings. The spec launches the built app through
  `withIsolatedElectronApp` exactly as the nine sibling `real-*` specs do, consuming the two
  `app.isPackaged`-gated dev affordances (loopback relay, test secret backend) and relaxing no validation.
  It exposes no new IPC arm and drives only DOM controls.
- **[Cryptographic primitives]** No findings. `Date.now()` supplies the run nonce. That is a **non-security**
  use — the nonce's job is to defeat reply caching and stale rows within one run, not to be unguessable —
  which is the sibling's existing posture for the same construct, and it is the one case the checklist
  explicitly permits.
- **[Network & I/O]** No findings. The spec dials the in-process `startFakeRoutingRelay` on loopback, the
  tier's existing arrangement; it opens no socket of its own and adds no URL. It asserts nothing about the
  relay.
- **[Error messages, logs, telemetry]** No findings, and this is the category the design actively spends on.
  Every assertion reads DOM **counts and booleans**, never reply text: `assistantMarkerCount` returns a
  number and `markerAfterDelimiter` returns a boolean, specifically so a failure diff can never print a
  transcript. The spec adds no `console.*`. The real-claude config enables no trace, screenshot or video, so
  no artifact captures more than the list reporter's own output.
- **[Concurrency]** No findings. The spec launches no async task of its own; every wait is a Playwright
  locator assertion with an explicit timeout. Teardown is the fixture chain's LIFO order (page → daemon →
  relay) with the process-group reap, unchanged. `test.setTimeout` bounds the whole spec.
- **[Threat model alignment]** Named and out of scope for this ticket: a **hostile relay** (content-blind,
  on-path) and **token theft from disk** are the transport's threat model and are unchanged by a test-only
  addition. A **hostile daemon response** is in scope in one narrow sense — the daemon's reply text reaches
  a DOM sink — and is already discharged by the operator ruling of 2026-08-20 in `CLAUDE.md`: daemon text
  may be rendered, escaped and length-bounded, and the assistant bubble is exactly such a sink. This spec
  reads that text into a **string comparison in the page context** and back out as a count or a boolean, so
  no daemon string reaches an assertion message, a log, a filename or a cache key.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
