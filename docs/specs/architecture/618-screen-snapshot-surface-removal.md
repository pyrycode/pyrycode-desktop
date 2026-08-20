# #618 — Remove the screen-snapshot control from the conversation surface

**Size:** S · **Security-sensitive:** no · **Branch:** `feature/618` · **Split from:** #604

A pure deletion. Roughly 215 lines come out, none go in. No new file, no new exported symbol, no
behaviour added. The one piece of real design work is the **comment re-anchoring** (§ Re-anchors),
where the ticket body's enumeration is incomplete and one of its claims is wrong.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The locked Conversation Thread Screen is a 412×892 column of exactly four regions — Top App Bar
(`16:9`), Message list (`16:21`), Status row (`16:57`, the `Opus 4.7 · high · 73% used` strip with its
`expand_less` chevron), and Composer (`16:61`) — and holds **no screen-snapshot affordance anywhere**:
no "Show daemon screen" button, no bounded terminal panel, no placeholder. Verified against both the
node metadata (four direct children, no fifth) and the rendered frame.

**Nothing is added.** This removal moves the implementation *toward* the locked design, so there is no
new visual to reproduce and no design context to fetch. The developer does not need to open Figma.

---

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:185-227` | The between-thread-and-composer mount order. `<ScreenSnapshotControl />` sits at `:218`, between `BackgroundTaskTrigger` and `InterruptControl`. Preserve every sibling and their order. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:51-56` | The import lines that go. Only these; see § No orphaned imports. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1021-1101` | The two copy constants, `ScreenSnapshotView`, `ScreenSnapshotControl`, and all four of their comment headers — one contiguous run. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1875-1884` | `ConnectionStatusIndicatorControl` — re-anchor site 1. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1186-1195` | `QueuedBacklogControl` — the surviving two-store container that re-anchor site 1 points at. |
| `src/renderer/src/screens/conversation/conversation.css:787-860` | The `.screen-snapshot*` block and its `#324` section comment. All of it goes. |
| `src/renderer/src/screens/conversation/conversation.css:365-375` | Re-anchor site 2 — #609's comment, **not named in the ticket body**. |
| `src/renderer/src/screens/conversation/conversation.css:2225-2241` | Re-anchor site 3 — `.unrecognized-row__raw`, the surviving bounded-scroll `<pre>`. |
| `src/renderer/src/screens/conversation/conversation.css:2259-2272` | Re-anchor site 4 — `.background-task-trigger`. |
| `src/renderer/src/screens/conversation/conversation.css:33-41` | `.conversation__back` — the surviving `flex: 0 0 auto; align-self: flex-start` idiom that site 4 points at. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:24` · `:805-877` · `:1681-1697` | The import, the six-`it` `ScreenSnapshotView` describe, and the standalone container-mount `it`. Three separate edits. |
| `src/renderer/src/screens/conversation/requestScreenSnapshot.ts` (48 lines) · `.test.ts` (43 lines) | Read once to confirm no other export, then delete both. |
| `e2e/stall-snapshot-bundle.spec.ts` (201 lines) | Whole file. The snapshot strands reach into the header, the imports, three helpers and a fake arm. |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts:54` | Sends `requestSessionSettings`. This is the proof the e2e overwrite-trap paragraph is stale. |

Not in scope, do not open except to confirm: `docs/specs/architecture/428-*.md`,
`docs/knowledge/codebase/428.md` (historical records), and `screenSnapshotStore.ts` /
`screenSnapshotBridge.ts` (#619's work — they stay and keep compiling).

---

## Context

The screen-snapshot feature answered by photographing claude's terminal. That terminal was deleted
upstream on 2026-08-16 (pyrycode#1348) and the daemon now wires `Snapshotter: nil`, so every request
lands in the offline arm: the button renders, is enabled, and silently does nothing. The operator's
call on 2026-08-20 is **remove**.

This is the first of five slices and takes **only the visible surface**. The store, the bridge, the
IPC command, the transport and the wire types all stay and keep compiling; #619–#622 take them out
consumer-first. A raw-event view to replace this was discussed and deliberately deferred — do not
build one.

---

## Design

### What comes out

Six files, one direction, zero fan-out.

**`ConversationScreen.tsx`** — five excisions:
1. `:51-56` — the `requestScreenSnapshot` import and the three-name `screenSnapshotStore` import.
2. `:214-218` — the `#324` mount comment and `<ScreenSnapshotControl />`.
3. `:1021-1031` — `SCREEN_SNAPSHOT_REQUEST_LABEL` and `SCREEN_SNAPSHOT_EMPTY_COPY` with their headers.
4. `:1033-1077` — the `ScreenSnapshotView` header comment and the exported view.
5. `:1078-1101` — the `ScreenSnapshotControl` header comment and the container.

Items 3–5 are one contiguous run (`:1021-1101`); they are listed apart only because each carries its
own comment block that must go with it.

**`conversation.css`** — one excision: `:787-860`, the `#324` section comment plus `.screen-snapshot`,
`.screen-snapshot__request` (and its `:hover` / `:focus-visible` / `:disabled`),
`.screen-snapshot__screen`, `.screen-snapshot__empty`. Nothing else in the file uses these selectors.

**`requestScreenSnapshot.ts` and `requestScreenSnapshot.test.ts`** — deleted outright. The module's
sole export has exactly one caller (`ScreenSnapshotControl`), which is also going.

**`ConversationScreen.test.tsx`** — three excisions: the `ScreenSnapshotView` name from the import
list at `:24`; the `describe('ScreenSnapshotView …')` block at `:805-877` including its header comment
(six `it`s); and the standalone `it('mounts the disconnected, no-snapshot stores …')` at `:1681-1697`
including its header comment. That last one **is its own test case**, not an assertion inside a wider
composition test — there is no single "surface composition" test in this file, only one `it` per
element each running its own `renderToStaticMarkup(<ConversationScreen />)`.

**`e2e/stall-snapshot-bundle.spec.ts`** — see § The e2e third.

### What stays

`screenSnapshotStore` and `screenSnapshotBridge` stay and go reader-less. **That is expected and
correct** — they are #619's work. Do not delete them, do not mark them deprecated, do not add a
"dormant" note. The IPC command `requestSnapshot` (`src/shared/ipc/commands.ts:130`), its `main`
handler (`src/main/index.ts:301`) and the wire types all stay untouched; they are #620–#622.

### No orphaned imports fall out

`composerAvailability`, `useSessionStore`, `selectStatus` and `useActiveConversationStore` all have
other users in `ConversationScreen.tsx` — verified. Only the `:51-56` block goes. In the e2e spec,
`isDeepStrictEqual`, `Envelope`, `decodeEnvelope` and `encodeEnvelope` all keep live users — keep
them (§ The e2e third).

---

## Re-anchors

The ticket body says three live comments cite the removed control as precedent. **There are four.**
Scope this by grepping the tree for the removed names, not by working the body's list.

The rule for all four: **re-anchor the name, do not rewrite the rationale, do not delete the
paragraph.** Deleting them would strip design rationale off four healthy call sites.

### 1. `ConversationScreen.tsx:1877` — the two-store container precedent

`ConnectionStatusIndicatorControl` calls itself "the ScreenSnapshotControl two-store precedent".
Re-anchor to **`QueuedBacklogControl` (`:1186`)** — the surviving container in this file that reads two
stores through narrow single-slice selectors (`useActiveConversationStore` + `useQueueStore`) and
passes mapped props to a pure exported view. Same shape, same file, still live.

### 2. `conversation.css:365-372` — **not named in the ticket body**

#609's `.bubble__markdown pre` comment cites `.screen-snapshot__screen` as the **ANTI-precedent**:

> No max-height and no overflow either: `.screen-snapshot__screen` below is the ANTI-precedent — it
> bounds and scrolls because a terminal grid must not reflow, whereas source code in a chat bubble must.

Re-anchor to **`.unrecognized-row__raw` (`:2229`)**, which carries the identical treatment
(`max-height: 240px; overflow: auto; white-space: pre`) and survives. The contrast the sentence draws
is structural — a block that bounds-and-scrolls versus one that reflows — so it survives the swap; only
the clause naming *the terminal* needs to follow the new subject. Note this comment sits **above** the
deleted block in the file and says "below", which stops being true after the swap — the direction word
needs to go or flip.

### 3. `conversation.css:2225` — `.unrecognized-row__raw` becomes the origin

`.unrecognized-row__raw` is written as "`.screen-snapshot__screen`'s treatment". **The ticket body is
wrong that this has a live sibling to point at.** After the removal, `.unrecognized-row__raw` is the
*only* bounded-scroll `<pre>` left in the file — the other `max-height` rules (`:979`, `:1090`, `:2044`)
are `90%` dialog and sheet bodies, a different pattern. So there is nothing to re-anchor *to*: this
comment must **state the treatment directly** and stop citing a precedent. It becomes the canonical
statement, and re-anchor 2 points at it. That ordering is what leaves no dangling name.

> **Scope guard.** This paragraph also carries the claim that a bounded height keeps a large dump from
> "shov[ing] the composer off screen". That claim is provably wrong — `.conversation__thread` (`:233`)
> is its own scroll region and `.composer` is its sibling, as #609's comment at `:371-372` already
> records. **Fixing it is not this ticket.** Carry the rationale across as-is; just do not let the
> rewrite *re-assert* it more strongly than the original did.

### 4. `conversation.css:2260` — `.background-task-trigger`

Cites "the `.screen-snapshot__request` treatment" for being "self-aligned to the start so it does not
stretch full-width". **Do not re-anchor this to `.conversation__unpair`.** That is the tempting move —
`.screen-snapshot__request`'s own comment credits `.conversation__unpair` — but `.conversation__unpair`
(`:79`) carries **no `align-self` at all**; it is the precedent for the de-emphasized text-button
*look*, not for the self-align. Pointing there would swap a dead name for a false one.

Re-anchor to **`.conversation__back` (`:38`)**, the surviving instance of the same
`flex: 0 0 auto; align-self: flex-start` idiom in this file — and a closer match besides, since both it
and `.background-task-trigger` are icon-only affordances where `.screen-snapshot__request` was a text
button. If the developer judges the postures too far apart, the acceptable fallback is to drop the
parenthetical entirely: the sentence already carries its own rationale ("so it does not stretch
full-width"), which stands without a citation. What is **not** acceptable is leaving the dead name.

### Explicitly out of scope: three prose hits on the surviving store

Grepping `screen-snapshot` also finds `App.tsx:109`, `modalBridge.test.ts:154` and
`timelineBridge.test.ts:286`. All three describe `screenSnapshotReceived` and the **store**, both of
which survive this slice, and all three are deleted by #619 when the store goes. **Leave them alone.**
They name no removed symbol, so they do not trip the no-dead-symbols criterion. This is the mirror of
the ticket's own warning: scope by call site, not by the word `snapshot`.

---

## The e2e third

`e2e/stall-snapshot-bundle.spec.ts` covers three affordances in one `test()`; the middle one goes.

**Rename the file to `e2e/stall-bundle.spec.ts`** (`git mv`, so the history follows). The file name
advertises the snapshot as loudly as the test name does. Safe: Playwright globs `testDir: './e2e'`,
and the only other references are prose in the two `#428` history docs, which stay untouched.

Removing the `AC2 — SCREEN SNAPSHOT` block (`:177-187`) strands exactly five named things — remove each:

| Stranded | Lines |
|---|---|
| `ScreenSnapshotPayload` from the type import | `:7` |
| `SNAPSHOT` fixture | `:60-69` |
| `screenSnapshotFrame` builder | `:95-99` |
| `case 'request_snapshot':` arm of `capturingReliabilityFake` | `:136-137` |
| `capturedSnapshotRequests` | `:146-152` |

**Keep** `isDeepStrictEqual` (used by `capturedBundleRequests:158`), `Envelope` (used by
`capturingReliabilityFake` and `capturedBundleRequests`), both codec imports, `StallPayload` and
`DebugBundleChunkPayload`.

Four prose sites also need work, and three of them are easy to miss:

- **The header (`:11-26`) is written around three affordances** — the opening sentence, the
  three-bullet distinct-shapes list at `:18-21`, and the one-`test()` rationale at `:23-26` which
  reasons about "the screen-snapshot store is most-recent-wins". Rewrite to two. This is a rewrite,
  not a deleted bullet.
- **The overwrite-trap paragraph (`:36-39`) must not be carried forward.** It claims `RunConfigData`
  fires its own `request_snapshot` on mount. `requestRunConfigSnapshot` has sent
  `requestSessionSettings` since #491 — verified at `runConfigSnapshot.ts:54`. There is no trap left to
  defuse, and with the snapshot third gone there is nothing for it to describe either. Delete it.
- **`capturingReliabilityFake`'s docstring (`:120-128`)** describes the `request_snapshot` arm and
  "defeats the overwrite trap". Trim to the two surviving arms.
- **AC1's comment (`:169-172`)** reasons that "screen_snapshot / debug_bundle_* are not timeline
  events, so the indicator persists through the later steps". Trim to `debug_bundle_*`; the argument
  still holds with one fewer step.

**The test name** — `'reliability affordances: stall push, screen snapshot, debug-bundle download'` —
drops its middle clause. Renumber the surviving comment markers so `AC3` does not follow `AC1` with a
hole.

---

## State + concurrency model

Nothing changes. This slice removes two store *reads* (`useScreenSnapshotStore`, and one of the
`useSessionStore` / `useActiveConversationStore` call sites) and one fire-and-forget outbound command
sender. No store is created, mutated, or torn down; no subscription, effect or async task is touched.
`screenSnapshotStore` keeps receiving `screenSnapshotReceived` from its bridge and simply holds a value
nobody reads until #619.

## Error handling

No failure mode is added or removed. `requestScreenSnapshot`'s `try/catch` around `sendCommand` goes
with the module — it guarded a send path that no longer exists. No user-visible error surface changes:
the button being removed is precisely the removal of a control that failed silently.

## Testing strategy

No new test is written. This is a deletion, and the gate is that the surviving suites still pass.

- **`npm test`** — green, nothing skipped. `ConversationScreen.test.tsx` loses seven `it`s (six in the
  `ScreenSnapshotView` describe, one container mount) and no other test in the repo asserts on the
  removed markup — verified repo-wide.
- **`npm run typecheck`** — the real proof that the excision is complete and that nothing else imported
  the deleted module. Note `e2e/` is outside both tsconfigs, so typecheck will **not** catch a mistake
  in the spec file; that one is caught only by running it.
- **`npm run build`** — the salvage gate.
- **Fake-daemon e2e** — `stall-bundle.spec.ts` must still pass on both surviving thirds. Run it; a
  green unit suite proves nothing about this file.

Two things to verify by reading rather than by a green run, because no gate covers them:

- No comment left in `src/` or `e2e/` names `ScreenSnapshotView`, `ScreenSnapshotControl`,
  `requestScreenSnapshot`, `SCREEN_SNAPSHOT_*`, or any `.screen-snapshot*` class. Grep for each.
- The mount region still renders, in order: thinking indicator, api-retry status, compaction status,
  stall indicator, queued backlog, status row, background-task trigger, interrupt control, composer,
  repair control. Ten siblings, one removed from between the seventh and eighth.

## Open questions

- **Re-anchor 4's fallback.** § Re-anchors 4 gives `.conversation__back` as the anchor and "drop the
  parenthetical" as the acceptable fallback. Either satisfies the criterion; the developer picks.
- **`SNAPSHOT.text`'s literal** (`'DAEMON SCREEN 428'`) disappears from the e2e spec. Nothing else uses
  it. Noted only so its absence does not read as an oversight in review.
