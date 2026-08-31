# #877 — carry the conversation id onto the shown modal event

#870 decoded `conversation_id` off the `modal_shown` frame; #871 carried it across the IPC emit onto
the `modalShown` `DaemonEvent` arm, where it stopped. This slice carries it the last hop into the
renderer's own event vocabulary: `ModalEvent`'s `shown` arm gains a required `conversationId`, and
`translateModalEvent` fills it by name into the fresh literal it already builds.

**Two executable production lines.** Everything else is two comment corrections and a five-site
fixture cascade.

The reducer does **not** read the new field. `ModalPrompt` is untouched, no selector changes, and the
prompt `reduceModal` installs is byte-identical before and after. That posture — a field carried
across a boundary one slice ahead of its consumer — is the one `outcome`/`source` already hold on the
`dismissed` arm (`modalPrompts.ts:45-47`) and the one #871 shipped on the arm below this one. **#878
is the consumer.**

## Design source

N/A — a renderer state-plumbing slice with no rendered surface. The ticket body has no `## Figma`
section and needs none: nothing an operator sees changes, because the field is deliberately not
forwarded past `reduceModal`. The sidebar surface this chain ends in is #878's and carries its own
Figma anchor. The visual-fidelity check is intentionally skipped.

## Base — verified this pass

Measured against `4b367ba`, which is both `HEAD` and `origin/main` (`git fetch origin --prune` run
this pass). Every line number below was re-checked against the working tree, and § Measured probe was
run **live** on that commit with `npm install` + both gates. Use the citations as written.

**codegraph is wired but not indexed for this repo** — `codegraph_status` errors `CodeGraph not
initialized for this project`, re-confirmed this pass (2026-09-01); `.codegraph/` holds `config.json`
only, no DB. The reading list below was built by grep + Read + the live probe instead.

## Files to read first

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/modalPrompts.ts:29-44` | The docblock (`:29-34`, carrying **stale comment (1)** at `:31-33`) and the `shown` union arm (`:36-44`) that gains the field. **Edit site for AC1 and the comment.** |
| `src/renderer/src/store/modalPrompts.ts:132-155` | `reduceModal`'s `shown` arm. `:140-147` builds `ModalPrompt` from **six named fields** — that is why the new field lands dormant with **no reducer edit**. AC3's whole content. |
| `src/renderer/src/store/modalBridge.ts:21-52` | `translateModalEvent`. The docblock at `:21-40` explains the fresh-literal rule (**it stands unchanged** — see § Must-NOT-sweep); the `modalShown` literal at `:44-52` gains one line. **Edit site for AC2.** |
| `src/shared/ipc/events.ts:635-668` | The `modalShown` `DaemonEvent` arm #871 shipped. `conversationId: string` at `:661` is the source field; **stale comment (2)** is the "It STOPS at the renderer modal bridge … ModalEvent does not carry it" sentence at `:651-653`. **Edit site for the comment.** |
| `src/shared/ipc/events.ts:639-655` | **The prose template.** #871's shipped paragraphs — "copied BY NAME at the emit", "REQUIRED, never optional", "daemon-asserted SCOPING KEY, not rendered text", "It STOPS at …". Read before writing either comment. |
| `src/renderer/src/store/modalStore.ts:27-32` | `dispatch: (event) => set((s) => reduceModal(s, event))`. Confirms the **event object is not retained** anywhere — its lifetime is one synchronous reducer call. Load-bearing for § Security review §3. |
| `src/renderer/src/store/modalPrompts.test.ts:13-31` | The `shown()` builder. Signature at `:14-17`, literal at `:18-30`. **Fixture site 1**, and read § The builder's error message before editing — the reported type looks like it demands a signature change; it does not. |
| `src/renderer/src/store/modalPrompts.test.ts:61-76` | `expect(state.outstanding[0]).toEqual(prompt)` against a typed `const prompt: ModalPrompt`. **This existing test becomes AC3's regression guard** the moment the builder carries the field. No new test needed. |
| `src/renderer/src/store/modalStore.test.ts:9-20` | `const shown: ModalEvent`. **Fixture site 2.** |
| `src/renderer/src/screens/conversation/PermissionModal.test.tsx:199-209` | The file-local `shown()` builder. **Fixture site 3.** |
| `src/renderer/src/store/modalBridge.test.ts:27-38` | The `modalShown` `DaemonEvent` fixture. Already carries `conversationId: 'conv-7f3a'` (#871). **Read, do not edit** — and note `conv-7f3a` ≠ `mdl-7f3a`, which is what makes the two expectations below transposition guards. |
| `src/renderer/src/store/modalBridge.test.ts:43-60` | The `toEqual` on the translated event. **Fixture site 4 — vitest-forced, tsc-blind.** |
| `src/renderer/src/store/modalBridge.test.ts:261-278` | The `toHaveBeenCalledWith` on the dispatched event. **Fixture site 5 — vitest-forced, tsc-blind.** |
| `docs/specs/architecture/871-modalshown-conversation-id-arm.md` | The slice directly below this one. Same chain, same rulings, same in-file/out-of-file discipline. Its § Must-NOT-sweep names `modalPrompts.ts:32-33` as "#872's" — **that forward resolves to this ticket** (#877 is split from #872). |
| `docs/specs/architecture/870-modal-shown-conversation-id.md` | The decode slice. Establishes the fail-closed `requireString` posture the whole chain rests on. |
| `docs/knowledge/decisions/0009-modal-prompt-model.md:45, :55` | The three ADR passages this slice falsifies. **Documentation-phase edits, not the developer's** — see § For the documentation phase. |
| `CLAUDE.md` § Conventions | Sealed event shapes, unidirectional state, the daemon-text rule. |

## Context

`ModalEvent` is the renderer's own sealed vocabulary — camelCase, defined in `modalPrompts.ts`, not in
`src/shared/wire`. Its `shown` arm mirrors the wire field-for-field so `translateModalEvent` stays a
thin tag rename. The wire gained `conversation_id` on `modal_shown` in pyrycode#1065; desktop decoded
it (#870) and carried it across IPC (#871). `ModalEvent` is the one link still missing, so a desktop
client following several conversations cannot attribute a waiting permission prompt to the row that
raised it.

`conversation_id` is an **outbound scoping key only**. `modalId` remains the sole *inbound*
correlation key for **answering**: `modal_answer` / `modal_cancel` carry no conversation id and the
daemon resolves an answer against its own outstanding-modal state (ADR 0009 § "`modal_id` is the sole
correlation key", amended 2026-09-01; re-verified in #870 against `messaging.go:114-156`). Carrying
the conversation outward does not loosen that, and this ticket must not restate it as if it did.

## Design

Three production files, **two executable lines**; the third file takes a comment edit only.

### 1. The type — `src/renderer/src/store/modalPrompts.ts:36-44`

The `shown` arm gains a required `conversationId: string`, placed **first**, matching the source arm's
field order at `events.ts:659-668` and the wire order `ModalShownPayload` already uses:

```ts
| {
    type: 'shown'
    conversationId: string
    modalId: string
    …
  }
```

**Required, never optional** — the ticket's Technical Note, and #871's two settled reasons, neither to
be re-argued here:

1. The wire has it always-present (no `omitempty`) and the decode fail-closes on absence
   (`inboundMessage.ts:1236`), so an optional field invents an absence case the daemon never produces.
2. An assigned `undefined` **survives** structured clone across the IPC bridge — `emitDaemonEvent`
   calls `webContents.send`, not `JSON.stringify` — so a later `'conversationId' in event` check would
   read true on an event carrying nothing. The required type keeps that trap out of the code, and it
   is the same reasoning behind the standing `'conversationId' in event` ban at
   `timelineBridge.ts:265-268`.

`ModalPrompt` (`:20-27`) does **not** gain the field. That is #878's.

### 2. The bridge — `src/renderer/src/store/modalBridge.ts:45`

One line added to the existing fresh literal, copied **by name**:

```ts
conversationId: event.conversationId,
```

Read **bare** — no `?? ''`, no default, no `as`. The source field is already a required `string` on the
`DaemonEvent` arm, so the copy compiles clean.

Copied by name onto the existing fresh literal, **never** by spreading `event` and never by
`return event`. AC2 says this explicitly, and the docblock at `:24-25` already gives the reason the
literal exists ("so the translator stays immune to a `DaemonEvent` arm gaining an unrelated field
later"). This slice is the first thing to add a field *deliberately*, which does not change that rule —
a named copy is exactly how a deliberate field crosses.

**This line is compiler-forced.** Measured (§ Measured probe): applying the type edit alone leaves the
bridge red until the field is filled.

### 3. Why the prompt is unchanged — no reducer edit — AC3

`reduceModal`'s `shown` arm (`modalPrompts.ts:140-147`) builds `ModalPrompt` from **six named fields**.
A seventh field on the event is simply not read, so the installed prompt is byte-identical and every
same-reference no-op — the `resolved` early-out at `:139`, the match-and-replace at `:151-153` — is
untouched. **No reducer line changes, and none should.**

This is not a claim to take on trust: `modalPrompts.test.ts:61-76` compares `state.outstanding[0]`
with `toEqual` against a **typed** `const prompt: ModalPrompt`, and `toEqual` is an exact own-property
match. The moment the `shown()` builder carries `conversationId`, that existing test *becomes* AC3's
regression guard — a reducer that leaked the field into the prompt would turn it red. Verified green
with the field present in § Measured probe.

`modalStore.ts:30` (`dispatch: (event) => set((s) => reduceModal(s, event))`) does not retain the
event either, so the id's entire renderer lifetime this slice is one synchronous reducer call.

### The two stale comments — in-code, this slice's diff

Both are named in the ticket body and both are in files this slice already edits.

1. **`modalPrompts.ts:31-33`** — "`modalId` is the sole correlation key — no `conversation_id` is
   carried (the wire carries none on a modal, ADR 0009)." **Both clauses are now wrong**: the wire has
   carried one since pyrycode#1065/#870, and this slice is what carries it on `ModalEvent`. Replace
   with the `events.ts:639-655` posture prose, which must state: the id arrives on the `modalShown`
   `DaemonEvent` (#871) and is copied by name into the `shown` arm; it is REQUIRED, never optional; it
   is a **daemon-asserted scoping key, not rendered text**, so none of the untrusted-display-text
   handling that `title` / `prompt` / `options[].label` need attaches to it; it **STOPS at
   `reduceModal`**, which builds `ModalPrompt` from named fields and omits it, and the consumer that
   scopes a prompt to a row is **#878**; and `modalId` remains the sole correlation key for
   **answering** a prompt.

   The surviving half of the original sentence is the *answering* clause — keep it, narrowed. Do not
   delete the ADR 0009 reference; the ADR is amended, not retired.

2. **`events.ts:651-653`** — "It STOPS at the renderer modal bridge (#223), which rebuilds a fresh
   ModalEvent from named fields and omits it; ModalEvent does not carry it, and the consumer that
   scopes a prompt to a row is #872." **This slice is precisely what makes that false.** The stop
   relocates one hop downstream: the bridge now copies it by name onto `ModalEvent`, and the id stops
   at `reduceModal`, which builds `ModalPrompt` from named fields and omits it. The consumer is
   **#878** (#872 was split; #877 is this slice, #878 the consumer).

   **Do not weaken, reflow, or renumber the untrusted-display-text sentence at `:657-658` or the
   "No token, key, or raw frame (AC4)" clause.** They stay verbatim. Do not touch the
   `modalShown` union member itself (`:659-668`) — the type is #871's and is correct.

**`events.ts` takes a comment edit and nothing else.** No type on that file changes.

## Measured probe — run live this pass on `4b367ba`

`npm install` was run in the worktree (it had no `node_modules`), then both gates, then every edit was
reverted — `git status --porcelain` is empty. Numbers below are observed output, not projections.

**Stage 1 — the two production lines only, no fixtures:**

| Gate | Result |
| --- | --- |
| `tsc -p tsconfig.node.json` | **0 errors.** The whole cascade is web-side. |
| `tsc -p tsconfig.web.json` | **exactly 3 errors, 3 files.** |
| `npm test` (vitest) | **exactly 2 failures**, both in `modalBridge.test.ts`. |

The 3 tsc errors, at the lines tsc reports:

`PermissionModal.test.tsx(200,5)` · `modalPrompts.test.ts(18,3)` · `modalStore.test.ts(9,7)`

The 2 vitest failures, with their actual messages:

- *"translateModalEvent — the owned arms > modalShown → a ModalEvent shown with the same fields, a
  fresh object"* → `expected { type: 'shown', …(7) } to deeply equal { type: 'shown', …(6) }`
- *"subscribeModal > dispatches a translated event for an owned arm"* → `expected "spy" to be called
  with arguments: [ { type: 'shown', …(6) } ]`

**Stage 2 — all five fixtures applied on top:** `npm run typecheck` clean, `npm test` **166 files
passed, 3287 passed | 3 skipped, 0 failures**. **No wave 2.** The end state is proven, not projected.

**Why the halves are disjoint, and why one gate is not enough.** vitest strips types without checking
them, so the three tsc-forced sites are *inputs* whose tests never read the new field and stay green
at runtime with it missing. The two vitest-forced sites are *expectations* compared with `toEqual` /
`toHaveBeenCalledWith` — both exact own-property matches, so a produced object gaining a field fails
against an expectation that omits it — and neither expectation is annotated `ModalEvent`, so tsc is
silent on both. **Both gates must be green; either alone reports a false all-clear.**

### The builder's error message — read before editing `modalPrompts.test.ts`

`modalPrompts.test.ts(18,3)` reports `Type 'string | undefined' is not assignable to type 'string'`,
which reads like the `overrides` signature at `:14-17` must change. **It must not.** The signature is
`Partial<Omit<Extract<ModalEvent, { type: 'shown' }>, 'type' | 'modalId'>>`, so adding the field to the
union makes `conversationId?: string | undefined` appear in the spread — and because the literal below
does not supply it, the spread is its *only* source, hence the optional-and-undefined result type.

Adding `conversationId: \`conv-${modalId}\`` to the literal **before** `...overrides` resolves it
outright, exactly as `title`, `class` and `defaultOptionId` already resolve. Confirmed in stage 2: the
signature was left untouched and typecheck is clean. Do not widen the `Omit`, do not add a cast.

## Sites that change — the census

### Production — 3 files, 2 executable lines

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `modalPrompts.ts:36-44` | The `shown` arm gains `conversationId: string`, first. | tsc | 1 |
| `modalPrompts.ts:31-33` | Stale comment (1). Both clauses; narrow the answering half, drop the wire claim. | nothing | — |
| `modalBridge.ts:45` | The copy line, by name, bare. | tsc | 2 |
| `events.ts:651-653` | Stale comment (2). Relocate the "STOPS at" hop; retarget #872 → #878. Untrusted-text and no-token sentences stay verbatim. | nothing | — |

### Tests — 4 files, 5 sites

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `modalPrompts.test.ts:18-30` | The `shown()` builder literal gains `conversationId`, **before** the spread. Signature unchanged. | tsc | 1, 3 |
| `modalStore.test.ts:9-20` | The `const shown: ModalEvent` literal — widen. | tsc | 1 |
| `PermissionModal.test.tsx:200-207` | The file-local `shown()` builder literal — widen. | tsc | 1 |
| `modalBridge.test.ts:45-58` | The `toEqual` expectation — add `conversationId: 'conv-7f3a'`, **matching the fixture at `:29` verbatim**. | vitest | 2 |
| `modalBridge.test.ts:267-277` | The `toHaveBeenCalledWith` expectation — same value, same reason. | vitest | 2 |

**Five sites: three compiler-forced, two suite-forced, none invisible to both.**

**Value discipline — this is the security control of the slice, not cosmetics.** In `modalBridge.test.ts`
the input fixture's `conversationId: 'conv-7f3a'` is deliberately **distinct** from its
`modalId: 'mdl-7f3a'`. Because both fields are `string`, TypeScript **cannot** catch
`conversationId: event.modalId` — a transposition compiles clean. The two exact-match expectations are
the only thing that catches it, and they only catch it while the two values differ. **Keep them
distinct; never collapse both to one id.** In `modalPrompts.test.ts` use `` `conv-${modalId}` `` for the
same reason — derived from, but never equal to, the modal id.

## Must-NOT-sweep — sites that look identical and must stay untouched

Each was checked individually this pass.

| Site | Why it stays |
| --- | --- |
| `modalBridge.ts:21-40` | The translator's docblock. "Reconstructed as a fresh literal … immune to a `DaemonEvent` arm gaining an unrelated field later" and "This is a filter, NOT a rename of fields" are both **still exactly true** — the ticket body says so explicitly. Do not "update" it to mention the new field. The file's diff is **one line**. |
| `modalPrompts.ts:1-8` | The module header's Strangler-Fig introduction prose. Historical, about #122/#201, says nothing about `conversation_id`. Stale in other ways that are not this ticket's. |
| `modalPrompts.ts:19-27` (`ModalPrompt`) and `:132-200` (`reduceModal`) | **Zero edits.** The prompt does not gain the field and the reducer does not read it — that *is* AC3. A reducer edit here is the single most likely way to fail this ticket. |
| `modalPrompts.ts:45-47` | The `dismissed` arm's carried-but-unconsulted `outcome`/`source` note. The precedent this slice follows; unchanged. |
| `events.ts:659-668` | The `modalShown` union member. #871's, correct, required. **Type untouched.** |
| `events.ts:657-658` | "`title` / `prompt` / `options[].label` are untrusted `claude`-surfaced display text … No token, key, or raw frame (AC4)." Verbatim, not reflowed. |
| `modalBridge.test.ts:27-38` | The `DaemonEvent` input fixture — already carries `conversationId` (#871). **Read it; do not edit it.** |
| `interactiveRoundtrip.test.tsx:96` | Its `modalShown` `DaemonEvent` literal already carries `conversationId: 'conv-1'` (#871). No `ModalEvent` literal in the file — verified. |
| `modalResolution.ts` / `PermissionModal.tsx` | Take `ModalPrompt` in signatures and dispatch only `dismissed` / `rejectionDismissed`. No `shown` literal, no new field read — verified by grep for `: ModalEvent` and `type: 'shown'` across `src/`. |
| `src/main/**`, `src/preload/**`, `src/shared/wire/**` | Untouched. `tsc -p tsconfig.node.json` reports **0 errors** with the production edits applied — measured, not assumed. |
| `e2e/permission-modal-answer-paths.spec.ts:79` | Sends `conversation_id` on a crafted **wire** frame, not a `ModalEvent`. `e2e/` is in neither tsconfig `include`. **No e2e change**, and `npm run e2e` needs no run for this ticket. |
| `docs/knowledge/**`, incl. ADR `0009` | Documentation-phase property. See below. |

**Blast radius confirmed:** `type: 'shown'` appears at exactly seven sites across `src/` and `e2e/` —
the union declaration, the bridge, and the five fixtures. Nothing spreads a `ModalEvent`.

## State + concurrency model

Unchanged, and this slice adds nothing to either. No new store slice, no subscription, no async task,
no `AbortController`, no teardown. `translateModalEvent` is a pure function over one event;
`subscribeModal`'s listener still only translates and dispatches; `modalStore.dispatch` still threads
`reduceModal` and retains no event. The `outstanding`, `rejections` and `resolved` slices are
byte-identical before and after, so **no selector churns and no component re-renders differently** —
`PermissionModal` selects `outstanding` under `Object.is` and sees the same reference sequence it saw
before. React lifecycle is untouched: `useModalBridge`'s effect and its StrictMode double-mount
behaviour are not on this diff.

## Error handling

Unchanged in shape, deliberately. **No new reject branch, no new failure mode, no new log line.** The
only way the field can be absent is a malformed frame, which `parseModalShownPayload` already rejects
whole (`inboundMessage.ts:1236`, #870) upstream of the IPC emit — so by the time `translateModalEvent`
runs, the field is a validated `string` by type. There is nothing for this layer to handle and nothing
to surface: no banner, no dialog, no toast.

The one thing this slice must **not** do is add a recovery path at the copy. A `?? ''` (or a
`conversationId: event.conversationId ?? event.modalId`, which is worse) would turn the decoder's
fail-closed drop into a silent misattribution — a permission prompt filed against the wrong
conversation.

## Testing strategy

`npm test` (vitest, `environment: 'node'` — renderer specs are static server renders and cannot click;
not a constraint here, since nothing interactive changes) plus `npm run typecheck`. **Both gates,
every run** — § Measured probe shows each alone reports a false all-clear.

### The two inversions — AC2

- `modalBridge.test.ts:45-58` — add `conversationId: 'conv-7f3a'` to the `toEqual`. The test's own name
  ("with the same fields") stays accurate; "the same fields" is now seven.
- `modalBridge.test.ts:267-277` — the same value on the `toHaveBeenCalledWith`.

These two **are** AC2's fails-on-`main` / passes-after proof, and — because `conv-7f3a` ≠ `mdl-7f3a` —
they are also the only guard against the transposition tsc cannot see. Do **not** add a parallel new
AC2 test: the old assertions must invert, or one is left asserting the drop.

### AC1 and AC3 — no new test, and that is deliberate

- **AC1** ("required field") is enforced by the type, not by a test. A `conversationId`-absent `shown`
  event cannot be constructed, so a test for it cannot compile. Do not write one.
- **AC3** ("installs a prompt with exactly the fields it installed before") already has a guard:
  `modalPrompts.test.ts:61-76` compares the installed prompt with `toEqual` against a typed
  `const prompt: ModalPrompt` of exactly six fields. Once the `shown()` builder carries
  `` `conv-${modalId}` ``, that comparison proves the reducer does not leak the field — verified green
  in § Measured probe stage 2. The `resolved`/re-delivery no-op assertions at `:100-136` and `:219-231`
  likewise keep passing unchanged, which is the second half of AC3.

  **Adding a new AC3 test would be duplicate coverage of an assertion that already exists.** If the
  developer wants belt-and-suspenders, the cheapest honest addition is a one-line
  `expect(state.outstanding[0]).not.toHaveProperty('conversationId')` inside the existing `:61-76`
  test — not a new `it`. Optional; the `toEqual` already covers it.

### Fixtures that need no assertion

The three tsc-forced sites are inputs only. Their tests assert reducer behaviour and rendered markup
and never read the new field; the widening exists purely to satisfy the type. Add the field, add
nothing else.

**Gates:** `npm run typecheck` catches three sites, `npm test` catches two. `npm run build` (typecheck
+ build) is the salvage gate. `npm run e2e` needs no run — `e2e/` holds no `ModalEvent` literal and is
outside both tsconfigs.

## For the documentation phase — not developer deliverables

The ticket body assigns these to the documentation phase explicitly. Recorded here so that phase acts
on them and so **code review does not read their absence from the developer's diff as a miss**. ADR
0009 was already amended twice today (#870, #871); these three passages were missed then and are the
ones an architect reading ADR 0009 for *this* ticket hits first.

- **`docs/knowledge/decisions/0009-modal-prompt-model.md:45`** (§ id-addressing) — "the one-time nonce
  is the only key (**no `conversation_id` exists on a modal**)". The parenthetical has been flatly
  wrong since #870 and was never amended. **Drop the parenthetical; keep the surrounding claim** —
  `modalId` *is* the only key for **answering**, which is what that section is about and what the
  ticket's Technical Note cites. Narrow, do not delete.
- **`docs/knowledge/decisions/0009-modal-prompt-model.md:55`** (§ The wire boundary) — "decoded into
  `ModalShownPayload` and then **deliberately dropped at the `daemonConnection.ts` emit**". Stale since
  **#871**, which carried it across that emit by name. It was written into the 2026-09-01 amendment and
  describes the post-#870 / pre-#871 tree.
- **`docs/knowledge/decisions/0009-modal-prompt-model.md:55`**, same sentence — "`conversation_id` is
  **not carried on `ModalEvent`**, but as of desktop#870 that is a choice, not a wire fact". **This
  slice** is what makes that false; it is no longer a choice being declined. Rewrite the whole clause
  to the shipped chain: wire → decode (#870) → `DaemonEvent` (#871) → `ModalEvent` (#877) → stops at
  `reduceModal`, consumer #878.
- `docs/knowledge/features/*` package overviews naming the modal bridge, at that phase's discretion.
- `docs/knowledge/codebase/122.md` / `201.md` if they carry the retired claim — **frozen files, read as
  history, do not edit** (frozen 2026-08-26).

**The developer's worktree must mutate only `src/` and this spec file.** No knowledge-base doc is an AC.

## Scope rulings — stated so they are not re-litigated

**Red lines, by raw count.** 3 production files, 1 of them comment-only (gate ≥5) · **0** new files ·
**2** executable production lines · **0** new exported types, components or interfaces (the field joins
an existing arm) · **5** consumer fixture sites (gate >10) · **3** acceptance criteria (gate >5) ·
**0** new reject branches (gate ≥10). Projected total written work: 2 production lines, ~18 lines of
comment repair, 5 fixture lines, 0 new tests — **under 30 lines**, and § Measured probe's stage-2
diffstat was **6 files changed, 7 insertions(+)** for the code half. No red line is approached, so no
rationalization is needed and none is offered. `size:xs` holds; XS is already the floor.

**A further split would be incoherent.** The type does not compile until the three tsc-forced fixtures
move, so a "type first, fixtures later" child leaves `main` red. The only alternative — an intermediate
optional field — is banned by name in the ticket body and would import the structured-clone `in`-check
trap the required type exists to exclude. Same ruling as #870/#871.

**Branch-overlap check: clean.** `git fetch origin --prune` this pass, then every `origin/feature/<N>`
branch diffed against `origin/main` — **no branch touches any of the seven files this ticket edits.**
No `blockedBy` needed. #878 is natively blocked by this ticket, correctly.

## Open questions

None blocking. Three notes for the reviewer:

- **#871's spec deferred `modalPrompts.ts:32-33` to "#872".** #872 was split; **this ticket is where
  that forward lands.** Fixing it here is correct, not scope creep.
- **`modalBridge.ts` takes exactly one line and its docblock stays.** The docblock's fresh-literal
  rationale is what this change *uses*, not what it contradicts. Flagging it as stale is a false
  finding.
- **No new test is deliberate, and zero is the right number.** AC1 is type-enforced, AC2 inverts two
  existing assertions, AC3 is guarded by an existing typed `toEqual` the moment the builder carries the
  field. Verified green end-to-end this pass.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No findings — **this slice moves no boundary**. The daemon is the untrusted
  source; `conversation_id` crossed untrusted→trusted at `parseModalShownPayload`
  (`inboundMessage.ts:1236`, `requireString`, fail-closed, drops the whole frame) in #870, and crossed
  main→renderer in #871. This slice is entirely *downstream* of both, inside the renderer, translating
  one already-validated, already-renderer-visible `string` from one typed union into another typed
  union. No `unknown` is narrowed here, no parse happens here, no cast is used, and no new capability
  is granted to anything. Downstream holds `ModalEvent`, a named sealed type, exactly as it held
  `DaemonEvent` before.
  **SHOULD FIX, forwarded to #878** (re-stating #870's and #871's forward, since #878 is now the
  immediate next slice and the first to *read* the value): the id is **display-scoping input, never
  authorization**. When #878 matches it against a sidebar row, compare by equality against an existing
  keyed set (`Map.get`, a `===` scan) — **never** `obj[conversationId] = …`, which is the
  prototype-pollution shape, and never as a path segment, filename, cache key or lookup path
  (CLAUDE.md's daemon-text rule). This slice reaches none of those sinks, and § 3 records why that is
  structural rather than lucky.

- **[2. Tokens, secrets, credentials]** No findings — nothing is generated, stored, rotated or revoked,
  and no RNG, keychain, `safeStorage`, `localStorage`, `sessionStorage` or IndexedDB path is on this
  diff. The one-time `modal_id` nonce is untouched and, critically, **its role is not widened**: the
  inbound anti-forgery model is unchanged (`ModalAnswerPayload` / `ModalCancelPayload` carry `ModalID`
  only, `messaging.go:114-156`, re-verified in #870), so a client still cannot assert which conversation
  an answer targets. The arm's genuinely dangerous fields — `title`, `prompt`, `options[].label`,
  untrusted `claude`-surfaced display text, a tool title and a command line — are **not touched**, and
  their plain-text-never-HTML warning at `events.ts:657-658` must survive the comment repair two
  sentences above it **verbatim**. That is stated as an explicit instruction in § The two stale
  comments, because reflowing a paragraph is exactly how such a warning gets softened by accident.

- **[3. File / storage operations]** Not applicable by design, and **structurally rather than by luck**.
  The value's entire lifetime in this slice is: one field on a `ModalEvent` literal built by
  `translateModalEvent`, passed synchronously to `modalStore.dispatch`, threaded into `reduceModal`,
  and dropped — `reduceModal`'s `shown` arm builds `ModalPrompt` from six named fields
  (`modalPrompts.ts:140-147`) and `modalStore.ts:30` retains no event. It therefore reaches **no**
  `path.join`, `fs` call, cache key, `Map` key, object-index assignment, `localStorage` or disk, and
  **no consumer reads it at all** — verified by reading the reducer, the store, `modalResolution.ts`
  and `PermissionModal.tsx` this pass. Recorded here because §1 forwards that constraint to #878, the
  slice where it stops being automatic.

- **[4. Inter-process / Electron attack surface]** No findings, and the walk is short for a real reason:
  **this slice adds zero IPC surface**. `modalPrompts.ts` and `modalBridge.ts` are renderer-only
  modules; no `contextBridge` API, no `ipcMain.handle` / `ipcMain.on` channel, no `webPreferences`
  value, no `will-navigate` / `setWindowOpenHandler` policy, and no preload file is on this diff.
  `src/preload/index.ts` is a field-agnostic forwarder that enumerates no field and takes no edit; the
  IPC widening that carried the id was #871's and is already shipped and reviewed. Process placement is
  preserved in the strictest sense — `tsc -p tsconfig.node.json` reports **0 errors** with the
  production edits applied (measured), i.e. **nothing main-side is even reachable from this change**. No
  crypto, socket, key or token moves toward the renderer; the flow direction is inbound-to-renderer and
  the renderer gains one short string it was already receiving on the arm below.
  **The one degradation path worth naming:** replacing the by-name copy with `return event` or a spread
  of `event` would make every field a future `DaemonEvent` arm grows cross into `ModalEvent`
  automatically, including any the modal store has no business seeing. AC2 forbids it in words, the
  docblock at `modalBridge.ts:24-25` forbids it in the code's own voice, and the two `toEqual` /
  `toHaveBeenCalledWith` expectations catch it mechanically (a spread would carry `type: 'modalShown'`
  and fail both).

- **[5. Cryptographic primitives]** Not applicable by design — the change sits in the renderer, two
  process-hops downstream of the Noise session, after decryption, after decode, and after the IPC emit.
  No RNG, hashing, KDF, nonce, AEAD framing or secret comparison is added or touched;
  `Noise_IK_25519_ChaChaPoly_BLAKE2s` is not on this diff and no file under `src/main/transport/` is
  either. The `modalId` nonce is copied, not generated, compared or reused, and its per-prompt
  one-time-ness is a daemon property this slice does not touch.

- **[6. Network & I/O]** Not applicable by design — no socket option, `maxPayload`, timeout, relay URL,
  TLS setting, backoff or reconnect policy is touched, and this code never sees a frame. Adversarially:
  a hostile relay is content-blind and on-path, so it can drop, delay or reorder whole frames — all of
  which it could already do — and AEAD integrity means it cannot strip or rewrite `conversation_id` to
  steer the new field. A `modal_shown` flood's renderer-side blast radius grows by exactly one short
  string per event **with no accumulation path at all**, because nothing retains the event (§ 3). No
  per-field length cap is added: no sibling field on this union has one, the frame-level size guard at
  `parseInboundMessage` already bounds every field transitively, and adding a cap only here would be an
  inconsistent defense against an unobserved failure.

- **[7. Error messages, logs, telemetry]** No findings, verified rather than assumed — and one item is
  named because an adversarial read *should* find it. `modalPrompts.ts:88-90`'s `assertNever` throws
  ``new Error(`Unhandled modal event: ${JSON.stringify(event)}`)``, and `modalBridge.ts:17-19` does the
  same for a `DaemonEvent`. Both would serialise the new field **and, far more importantly, already
  serialise `title` and `prompt`** — the tool title and command line. Classified **pre-existing and
  unchanged in class**, not a finding against this slice, on three grounds: (a) both are typed `never`
  and unreachable for any declared arm, which is the entire point of the exhaustiveness guard; (b)
  neither is reachable *for the `shown` arm* under any input, since `shown` has an explicit `case`; (c)
  the id is strictly less sensitive than the `prompt` text already in that template, so the change
  moves no needle. This slice adds **no** log call, no `console.*`, no throw, no error message and no
  telemetry, and adds nothing to the renderer DevTools console. No new failure mode exists to report
  (§ Error handling): the only way the field can be absent is a malformed frame the decoder already
  rejected whole, upstream, in a different process.

- **[8. Concurrency]** Not applicable by design — no async task, timer, listener, subscription,
  `AbortController` or teardown is added or touched, and there is no `await` anywhere on the path.
  `translateModalEvent` is pure; `subscribeModal`'s listener is the same translate-and-dispatch body;
  `useModalBridge`'s effect and its StrictMode mount → cleanup → mount netting are not on this diff.
  No check-then-act across a suspension point, no new shared mutable state (the event is not retained),
  no shutdown-path change, no possibility of a duplicate subscription. The reducer's same-reference
  no-op discipline — the thing that keeps concurrent re-renders cheap — is explicitly preserved and
  asserted (AC3, `modalPrompts.test.ts:100-136`).

- **[9. Threat model alignment]** No findings for this slice; two items explicitly classified.
  *Malicious / compromised relay* — unchanged, per § 6. *Renderer compromise reaching the transport* —
  unchanged and untouchable from here: the transport stays main-side, this diff is renderer-only, and a
  compromised renderer that already receives `modalShown` learns nothing new from the field being
  re-copied one module further along. *Token theft from disk* — not applicable; nothing is persisted.
  *Hostile / buggy daemon response* — parsed defensively and fail-closed before it ever reaches this
  code.
  **OUT OF SCOPE, named — #878:** the id is **daemon-asserted**, so a buggy or compromised daemon could
  attribute a permission prompt to a conversation it did not come from. That trust assumption is
  pre-existing, uniform across every arm already carrying the field, and **unchanged by this slice** —
  which changes who is *told*, never who is *trusted*. It is also unreachable here, since no consumer
  reads the field, so the earliest point it can produce an operator-visible effect is #878, where the
  prompt is first scoped to a row. §1's SHOULD FIX is the concrete form it takes there.
  **OUT OF SCOPE, named — future drop-path observability:** a daemon predating pyrycode#1065 makes every
  permission prompt vanish silently. Not new (true since #870), not exploitable (it needs an old daemon,
  not an attacker), and the fix — telemetry on the shared silent-drop path at `daemonConnection.ts:490`
  — is a repo-wide change belonging to its own ticket.

**The one real risk of this slice, and its control.** The ticket names it: *"this is the copy that must
not lose or transpose the id."* Losing it is impossible — the required type makes omission a compile
error. **Transposing it is not caught by the compiler**: `conversationId: event.modalId` type-checks
cleanly, because both fields are `string`, and it would file a permission prompt against the wrong
conversation on the one arm where the operator is being asked to grant something. The control is
value-level and already in place: `modalBridge.test.ts`'s input fixture carries
`conversationId: 'conv-7f3a'` alongside `modalId: 'mdl-7f3a'`, and the two exact-match expectations
reject a swap. **That control survives only while the two values differ**, which is why § Sites that
change makes value-distinctness an explicit instruction rather than a stylistic note. Classified
SHOULD FIX-by-construction: the design as specified cannot reach the failure, and the test data as
specified catches a deviation from it.

**Non-finding stated explicitly to pre-empt it:** `conversationId` is **required, never optional**, so
there is no absent case to defend. The structured-clone trap that bites *optional* IPC fields — an
assigned `undefined` survives `webContents.send` as a present own property, because the bridge
structured-clones rather than `JSON.stringify`s — has no purchase here. It is precisely why the ticket
body specifies required, why `'conversationId' in event` stays banned at `timelineBridge.ts:265-268`,
and why a "defensive" optional field would be strictly worse than the required one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-09-01
