# #621 — Remove the `snapshotReceived` and `screenSnapshotReceived` daemon events

**Ticket:** [#621](https://github.com/pyrycode/pyrycode-desktop/issues/621) · **Size:** S · `security-sensitive`
**Base:** `16be999` (merge of #620 / PR #638). All line anchors below were re-verified against this commit.

## Design source

N/A — pure type/IPC removal. No rendered surface changes: both arms are already consumer-free
(`snapshotReceived` since #491/#500, `screenSnapshotReceived` since #619), so no pixel moves and the
visual-fidelity check is intentionally skipped.

## Files to read first

| Path | What to extract |
| --- | --- |
| `src/shared/ipc/events.ts:78-135` | The `DaemonEvent` union. The two arms to delete: `:88-95` (the 8-line `snapshotReceived` block) and `:133` (the one-line `screenSnapshotReceived`). |
| `src/shared/ipc/events.ts:55-77` | The union's header doc. `:61` and `:69-73` name both arms; `:61`'s "respectively" pairing breaks on a bare name-drop — see Decision H. |
| `src/shared/ipc/events.ts:96-113` | `runConfigReceived`'s doc — Decisions C and D live here. `:106-109` (`sessionId: ''` semantics) is live and must survive untouched. |
| `src/main/daemonConnection.ts:564-587` | The whole `case 'snapshot':` block — both `emitDaemonEvent` calls plus their two comment blocks. `:588` is the `return`. |
| `src/renderer/src/store/daemonEventBridge.ts:29-190` | The precedent citation chain. Read the *whole* switch, not just the two arms — Decision B depends on citation direction across the file. |
| `src/renderer/src/store/timelineBridge.ts:141,155,162-180` | Two fall-through labels sharing one `return null` and one long prose block. The block names both arms — two separate edits, both needing a rewrap. |
| `src/renderer/src/store/modalBridge.ts:74,92,102-112` | Same shape as timelineBridge. |
| `src/renderer/src/store/runConfigStore.ts:1-24` | Decision G — the two actively-false comment sites (`:3-5`, `:20`). The store's state, setter and selectors are live: comments only. |
| `src/renderer/src/store/announcedModelBridge.ts:26-38` | Decision A. Also carries dead `screenSnapshotBridge` references — see § Out of scope, do not fix them here. |
| `src/main/daemonConnection.test.ts:1292-1396` | The `inbound screen_snapshot decode` describe as #620 left it. Four `it`s collapse into one; `:1386`'s malformed test is #622's — do not touch. |
| `src/renderer/src/store/announcedModelBridge.test.ts:56-72` | Decision A's fourth site: the `it` **title** at `:56` claims "the two name-colliding arms". |
| `CLAUDE.md` | `npm run build` = typecheck + build is the salvage and QA gate. Test-first. Don't refactor adjacent code. |

## Context

The screen-snapshot feature answered by photographing claude's terminal. That terminal is gone
(pyrycode#1348, 2026-08-16) and the daemon wires `Snapshotter: nil`, so every request lands in the
offline arm. The operator's call is **remove**, consumer-first: #618 (surface) → #619 (store+bridge)
→ **#621 (this, IPC events)** → #622 (inbound decode). #620 removed the outbound half in parallel.

One `screen_snapshot` frame emits **two** events (#316): `snapshotReceived` (run-config fields) and
`screenSnapshotReceived` (screen text + timestamp). Both are now consumer-free — verified: the only
non-test hits outside the union declaration are the emit site, three `null` bridge arms, and two
comment-only files.

**Do not build a raw-event view.** Deliberately deferred per the ticket.

## Design

This is a pure deletion: **~50 production lines removed, zero added.** No new files, no new exported
types, no new components, no behaviour to design. The design work is entirely (a) the compile-forced
deletion set and (b) seven comment decisions that must leave every surviving comment true.

### The compile-forced deletion set — measured, not estimated

I removed the two union arms in isolation and ran both typecheck projects. Result: **22 errors across
16 files.** This list *is* the developer's work checklist — `tsc` prints it; do not go hunting.

`npm run typecheck` runs `tsconfig.node.json` **then** `tsconfig.web.json` with `&&`, so it
short-circuits. Run the web project directly (`npx tsc --noEmit -p tsconfig.web.json`) to see the
renderer half while the node half is still red.

**Node project (7 errors, 2 files)**

- `daemonConnection.ts:571`, `:584` — TS2322, the two `emitDaemonEvent` literals.
- `daemonConnection.test.ts:1319, 1331, 1347, 1360, 1376` — TS2367. Note the forcing comes from the
  `e.type === '…'` comparisons, **not** the object literals (those sit inside `toEqual`, which takes
  `any`). A literal-only sweep would leave this file red.

**Web project (15 errors, 14 files)**

- TS2678 (unreachable `case` label) ×6 — `daemonEventBridge.ts:53,133`, `timelineBridge.ts:141,155`,
  `modalBridge.ts:74,92`.
- TS2322 ×9 — the direct test files `daemonEventBridge.test.ts:106,257`, `modalBridge.test.ts:104,156`,
  `timelineBridge.test.ts:243,288`, plus the six inert-fixture files below.

**The inert-fixture fan-out.** `snapshotReceived` is this codebase's canonical "foreign event this
bridge must return `null` for" literal, sitting in a `const others: DaemonEvent[]` array in six test
files with nothing to do with snapshots: `logDataDownload.test.ts:73`,
`conversationListBridge.test.ts:71`, `queueBridge.test.ts:50`, `relayLinkBridge.test.ts:36`,
`sessionIdBridge.test.ts:44`, `announcedModelBridge.test.ts:65`. `tsconfig.web.json` includes
`src/renderer/src/**/*`, so these are **typechecked, not merely executed** — all six are compile-forced
in this same commit. Five are a clean literal drop (each array keeps ≥3 members, so the "sample of
unrelated events" property survives). The sixth is Decision A.

Unlike #620's slash-list drop, an array-literal drop **reflows for free** — no rewrap.

### Comment decisions

Nineteen comment sites, seven judgement calls. Everything not listed under a lettered decision is a
name dropped from a slash- or comma-separated list: `events.ts:69, 72-73, 125, 340, 361`,
`daemonEventBridge.ts:22, 153`, `timelineBridge.ts:173`, `modalBridge.ts:106`. Cheap to decide, but
several sit mid-paragraph in wrapped blocks — **budget for rewrapping the block, which is usually more
edited lines than the deletion itself.**

**A. "The two `model`-carrying arms" is now one.** Four sites, one decision: `events.ts:179`,
`announcedModelBridge.ts:36`, and in `announcedModelBridge.test.ts` both the `it` **title** at `:56`
(`'…INCLUDING the two name-colliding arms'`) and its in-test comment at `:57-59`. The warning still
matters for `runConfigReceived` and must **survive, re-worded** — not be deleted: `runConfigReceived.model`
is the per-session OVERRIDE (`''` = inherited default) while `modelAnnounced.model` is what claude
announced, and both are destined for the same sheet. A grep-for-symbol catches only three of the four —
the title says "two" without naming either symbol. Also: `announcedModelBridge.ts:37` cites
`events.ts:179-185`, a **line anchor this change invalidates** — re-anchor by name or drop the anchor.

**B. The precedent chain — `stallDetected` becomes the new origin.**
`daemonEventBridge.ts` runs a citation chain: 20 `null` arms carry "Present only because the assertNever
guard…", 15 append `(the X-was-a-no-op-until-#N precedent)`, 5 carry no clause. The chain is
`snapshotReceived`(#187) ← `stallDetected`(#317) ← `apiRetry`(#493) ← `compacting`(#496) ← `modelAnnounced`,
and the arm being deleted is its **origin**, cited 3× here (`:111`, `:131`, `:136`) plus once in
`events.ts:367`. `:136` goes with its own arm.

`stallDetected` (`:131`) **drops its precedent clause** and becomes the new origin, joining the five
clause-less arms. Everything citing `stallDetected-was-a-no-op-until-#317` keeps working untouched —
that claim is a fact about the arm's history, independent of whether its own comment restates it.

> **Correction to the ticket body.** The body prescribes that `:111` (sessionTransition) also
> re-points at `stallDetected-was-a-no-op-until-#317`. **Do not do that in `daemonEventBridge.ts`.**
> Every one of the file's nine citations points at an arm **above** the citing arm (verified:
> `:81→:74`, `:86→:66`, `:91→:78`, `:96→:88`, `:101→:93`, `:111→:53`, `:131→:53`, `:142→:128`,
> `:184→:128`). `sessionTransition` is at `:108` and `stallDetected` at `:128` — that citation would
> be the file's first backward reference. Once `snapshotReceived` (`:53`) goes, there is no
> `was-a-no-op-until` arm above `:108` to cite, and the clause-less arms above it are the *permanent*
> `-is-a-no-op` flavour, which asserts something different (dormancy that never resolves).
> **`:111` drops its clause too**, same remedy as `:131`.
>
> `events.ts:367` is unaffected by this correction — there, `stallDetected`'s arm (`:150`) sits above
> `sessionTransition` (`:370`), so citing `stallDetected-was-a-no-op-until-#317` is both correct and
> already idiomatic in that file (`events.ts:162` and `:534` do exactly this).

**C. `runConfigReceived` defines itself by contrast with the deleted arm.** `events.ts:96` ("Same five
fields as snapshotReceived above PLUS the `sessionId`") and the `:100-104` "Why a separate arm rather
than widening snapshotReceived" paragraph. State the shape **directly** (six fields: `sessionId` plus
model / effort / yolo / used_tokens / window_tokens). Keep — in one sentence citing #491/#500 — the
reason the sheet reads a dedicated `session_settings` reply rather than a screen photograph. **That
reason is the load-bearing part; do not let it go out with the name.** Phrase it as history ("the sheet
was moved off the screen-photograph path at #491/#500") rather than as a live comparison, so it still
reads true after #622 deletes the decode. Leave `:106-109` alone.

**D. `events.ts:111-113` deletes outright.** It says `snapshotReceived` "is left in place and is
unconsumed after this ticket; retiring it is a follow-up, deliberately not bundled here." This ticket
*is* that follow-up. The comment retires itself. No re-anchor.

**E. `events.ts:134`'s "Unlike snapshotReceived, `text` IS the render payload".** No surviving arm
carries the opposite property, so there is nothing to contrast against: drop the contrast, state the
property directly for `assistantDelta` / `turnEnd`.

**F. `events.ts:330`'s widening precedent.** `unrecognizedMessage.raw` crosses IPC "for the same reason
`screenSnapshotReceived.text` does". **Verified:** `assistantDelta.text` genuinely carries that property
— `events.ts:134-136` states it in the same words ("`text` IS the render payload … the boundary defended
upstream is the fail-closed decode, not this internal channel"). Re-anchor to `assistantDelta.text`.

**G. `runConfigStore.ts`'s two sites are actively FALSE, not merely stale.** `:3-5` says the sheet
"requests a fresh snapshot on sheet open and writes the arriving `snapshotReceived` fields here"; `:20`
says `RunConfigSnapshot` "Mirrors the `snapshotReceived` event shape". Both were true at #187/#188 and
were superseded by #491/#500. Read literally, they suggest this removal re-breaks the settings sheet —
which is the bug #500 just fixed. **Correct both to name `runConfigReceived` as the source.** Comment
change only: that store's state, setter and selectors are live and unchanged.

**H. Two "respectively" pairings break on a bare name-drop.** Not in the body's list, found while
verifying anchors. `events.ts:61` and `daemonEventBridge.ts:22` both read: *"The three debug-bundle arms
(#168) and `snapshotReceived` (#180) map to NO SessionAction — they are consumed by the download UI (#72)
and the Run configuration render bridge (#181) **respectively**."* Dropping one name leaves a dangling
"respectively" over a one-element pairing, and the surviving half of the claim ("#181 consumes
snapshotReceived") is **already false** post-#491/#500. Restructure both to a single-subject sentence
naming only the download UI. The same false "#181 consumes this" claim also appears in
`timelineBridge.ts:163` and `modalBridge.ts:103` consumer lists — drop `Run configuration bridge (#181)`
from both, and rewrap.

## State + concurrency model

Unchanged. No store slice, subscription, async task, or teardown path is touched. The three renderer
bridges keep their `assertNever` default arms, so adding a new `DaemonEvent` member remains a compile
error (AC2). `daemonConnection`'s inbound switch has **no** `assertNever` — which is why
`inboundMessage.ts` can keep decoding `screen_snapshot` into a `kind: 'snapshot'` that nothing consumes
after this slice. That compiles, and it comes out in #622.

## Error handling

No failure mode changes. The fail-closed decode path is untouched: a malformed `screen_snapshot` is
still rejected upstream in `inboundMessage.ts` and still emits nothing. After this slice a *well-formed*
frame also emits nothing — decoded, then dropped at the connection's `case 'snapshot'` removal. AC3
pins exactly that.

## Testing strategy

All of this is `npm test` (vitest) plus the two existing e2e gates. No new test file.

**Replace (AC3).** `daemonConnection.test.ts:1313-1384` — four `it`s assert the two emits and go. Fold
them into a single pin, in the `createDaemonConnection — inbound screen_snapshot decode (#180, #316)`
describe (`:1292`):

- On a `connected()` session, emit a **well-formed** `screen_snapshot` frame built from the existing
  `SNAPSHOT` fixture (`:1293`) via `snapshotPlaintext` (`:240`).
- Assert `sink.webContents.send` call count is unchanged across the emit — the same before/after idiom
  the malformed test at `:1386` already uses.
- Assert the emit does not throw.
- Name the wire type (`screen_snapshot`) in the title so the AC4 camelCase grep stays clean.

**Do not touch** `:1386`'s malformed-frame test. It still passes but is now vacuous — it is #622's, and
rewriting it means writing tests for code #622 deletes.

**No orphaned fixtures.** Verified: `SNAPSHOT`, `snapshotPlaintext`, `ScreenSnapshotPayload` (imported
at `:29`) and the describe-local `connected()` (`:1305`) all stay used by the AC3 pin and the surviving
malformed test. Nothing in this file is left dangling. Note `noUnusedLocals` is **off**, so an orphaned
import would compile clean — count usages by hand if you deviate from the plan above.

**Delete.** `daemonEventBridge.test.ts` loses two whole `it`s (`:103`, `:254`). `timelineBridge.test.ts`
and `modalBridge.test.ts` each lose one fixture and one `screenSnapshotReceived` literal.

**Literal drops.** The six inert-fixture files listed above; five are pure drops, the sixth is Decision A.

**Gates (AC5, AC6).**

- `e2e/real-daemon-session-settings.spec.ts` must pass **unchanged** — it rides `runConfigReceived`, has
  zero hits for either deleted arm, and is a liveness assertion on the round trip. It is the free proof
  that the sheet still reads model/effort/YOLO from a real daemon, not only from the fake.
- **Baseline skip count on the base commit `16be999` is `3 skipped` (2332 passed / 2335 total).** I
  measured it. All three are env-gated `describe.skipIf` blocks — the Go interop block
  (`noiseSession.interop.test.ts:292`), its live-relay block (`:458`), and
  `daemonConnection.roundtrip.test.ts:769`. None sits in a file this ticket touches, so the count should
  be **exactly 3 after the change too**. Compare against this number, not against a reading in isolation.

## Scope

**Seventeen files, ~50 production lines deleted, zero added.** No new files, no new exported types, no
state machine, no reject branches.

**The §4 ≥5-production-file gate trips: this spec prescribes 7** (`events.ts`, `daemonConnection.ts`,
`daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts`, `runConfigStore.ts`,
`announcedModelBridge.ts`). Recording that plainly, with the evidence for shipping it as one S anyway:

Removing a member from a discriminated union that three `assertNever`-guarded switches exhaust is
**compile-atomic**. I tested this rather than asserting it — the arms-only deletion leaves
`npm run typecheck` red in 16 files, and `npm run build` (typecheck + build) is the salvage *and* QA
gate per CLAUDE.md. **There is no intermediate green tree.** I evaluated three candidate splits:

1. **Strangler Fig (deprecate → remove).** Child A removes the emit only; child B removes the union
   arms and takes the *entire* 16-file fan-out. Max child size is unchanged and a throwaway ticket is
   added. Strictly worse.
2. **By arm.** Both arms live in the same five production files, so each child still trips the same
   gate — and AC3 ("a `screen_snapshot` frame produces no daemon event at all") only holds once both
   are gone.
3. **Comment sweep as a follow-on (#620 → #637's shape).** Does not transfer. #620's residue lived in
   nine files it never opened — zero overlap. Here the residue is *inside* the files being opened, in
   the hunks next to the deletion, so the interim tree would ship `runConfigReceived`'s doc reading
   "Same five fields as snapshotReceived above" three lines below the deleted arm — the exact defect
   AC4 forbids. And measured: only two of the seven files (`runConfigStore.ts`, `announcedModelBridge.ts`)
   are comment-only, so splitting them out leaves **five** — still over the gate.

The gate is a proxy for developer edit budget, and here the proxy over-reads: 15 of the 22 edits are
one-line deletions at a compiler-named `file:line`, printed by `tsc`, requiring no search and no
per-site reasoning. The genuine turn cost is the comment rewrapping — which is why all seven decisions
above are pre-decided rather than left to the developer. PO sized this `s` with a written rationale and
the operator has adjudicated the removal; this spec ships at S.

## Out of scope

- **Do not touch `runConfigReceived`, `runConfigSnapshot.ts`, or anything the settings sheet reads.**
- **Do not widen the AC4 grep.** `grep -rnE 'snapshotReceived|screenSnapshotReceived' src/ e2e/` is
  camelCase and deliberately does not match the snake_case wire verb `screen_snapshot` — that verb, its
  decode arm and `ScreenSnapshotPayload` are #622's, and AC3's new test still names the wire type.
- **Do not sweep `docs/`.** ~60 files there name these arms. `docs/specs/architecture/*` and
  `docs/knowledge/codebase/*` are frozen per-ticket records; living feature docs belong to the
  documentation phase.
- **Do not write `docs/knowledge/codebase/621.md`.** The documentation phase owns it, after the PR merges.
- **`screenSnapshotBridge` residue from #619 — flag, do not fix.** #619 deleted that module but left
  five comment references to it as a live precedent: `announcedModelBridge.ts:5, 27, 32`,
  `announcedModelBridge.test.ts:13`, `serverInfoLoader.ts:49`. These do **not** match #621's AC4 grep
  and are not this ticket's. You will see `:32`'s dead reference while editing `:36` for Decision A —
  leave it. Recommend it joins #637's tree-wide comment sweep; raised to PO separately.
- `e2e/run-config-settings.spec.ts:192`'s stale `request_snapshot` claim is #637's.

## Open questions

None blocking. One environment note: the canonical checkout's `node_modules` is stale (missing
`react-markdown@^10.1.0`, which *is* declared in `package.json`), which makes five renderer suites fail
to load and adds four spurious `AssistantMarkdown.tsx` typecheck errors. Run `npm install` first; those
errors are unrelated to this change and were absent from my control run's diff.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the change strictly *narrows* the surface. `screenSnapshotReceived.text`
  was a deliberate, security-reviewed **widening** (#316) that carried untrusted daemon-relayed screen text
  across the `contextBridge` into the renderer. Deleting it removes that crossing entirely — one fewer
  untrusted-to-trusted transition. The remaining boundary is unchanged: the fail-closed decode in
  `inboundMessage.ts` (`parseScreenSnapshotPayload`), which this ticket does not touch.
- **[Tokens, secrets, credentials]** Not applicable by construction — neither deleted arm carried a token,
  key, or credential. `snapshotReceived` carried three session-settings fields plus two context-window ints;
  `screenSnapshotReceived` carried `text` + `ts`. No storage, rotation or revocation path is in scope.
- **[File / storage operations]** Not applicable — no filesystem path, no read or write, no serialisation is
  added or removed. `runConfigStore.ts` is pure renderer state with no IPC and no disk.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, `ipcMain` channel, or
  `webPreferences` value changes. The IPC surface **shrinks** by two event shapes. Process placement is
  preserved: nothing moves out of the main process, and the deletion removes a main→renderer data path
  rather than adding one.
- **[Cryptographic primitives]** Not applicable — no RNG, no comparison, no key or nonce handling anywhere
  in the deletion set. The Noise session is untouched.
- **[Network & I/O]** No findings. No socket, timeout, frame cap, or TLS setting changes. Inbound framing is
  unchanged: `inboundMessage.ts` still decodes `screen_snapshot` under the existing `MAX_PLAINTEXT_BYTES`
  guard, and the frame is simply dropped after decode instead of being forwarded.
- **[Error messages, logs, telemetry]** No findings — and one property worth stating explicitly, because it
  is the one thing a careless deletion here could break. The deleted block at `daemonConnection.ts:578-582`
  documents *"No log call here: the content-free `screen_snapshot` diagnostic stays in `inboundMessage.ts`,
  so `text` is never written to a sink."* **Deleting the emit must not relocate, re-add, or "helpfully"
  replace that diagnostic with one that logs the dropped payload.** A well-formed frame after this change
  must be dropped **silently** — no new `console`/logger call naming `text`, `ts`, or the run-config fields.
  AC3's pin (call count unchanged) covers the IPC sink but **not** a logger, so this is the one place the
  test suite would not catch a regression. **SHOULD FIX / code-review must check**: confirm the diff adds
  zero log statements in `daemonConnection.ts`.
- **[Concurrency]** Not applicable — no async task, timer, listener, `AbortController`, or teardown path is
  created or destroyed. The emit was synchronous inside an existing handler; removing two synchronous calls
  introduces no ordering or cancellation change.
- **[Threat model alignment]** No findings. Against a **hostile daemon or on-path relay**, the change is a
  net improvement: a frame that previously pushed attacker-influenced `text` into renderer-reachable state
  now terminates at the decode. The **renderer-compromise** posture is unchanged-to-better — a compromised
  renderer had one more untrusted string to work with before, and none of the deleted state was privileged.
  Explicitly out of scope and named: the `screen_snapshot` decode itself (`inboundMessage.ts`,
  `ScreenSnapshotPayload`) survives this slice and is removed in **#622**; until then the wire verb is
  decoded and discarded, which is inert but is dead code carrying a parser — #622 picks it up.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
