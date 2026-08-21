# #619 — Remove the screen-snapshot renderer store and bridge

**Size:** XS · **Security-sensitive:** no · **Branch:** `feature/619` · **Split from:** #604

A pure deletion. Four files go (396 lines), seven lines come out of `App.tsx`, and two words in
`App.tsx` change. Nothing is written. No new file, no new exported symbol, no behaviour added or
removed.

There are exactly two pieces of real work beyond the deletion itself:

1. **The two broken ordinals** (§ The ordinal chain) — the deletion falsifies two surviving comments
   by the very method those comments prescribe.
2. **Knowing where to stop** (§ The residual census) — grepping the tree for `screenSnapshot*` after
   the deletion returns twelve live hits, and all twelve are *supposed* to survive. The census below
   is the exact expected output, so "did I finish?" is a diff against a fixed list rather than a
   judgment call.

---

## Design source

N/A — headless state-layer deletion, zero visual change. `ScreenSnapshotData` renders `null` and the
last rendering consumer was removed by #618, so there is no surface for a Figma node to describe. The
visual-fidelity check is intentionally skipped, not overlooked. The ticket body's omission of a
`## Figma` section is correct here, not a PO gap.

---

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/App.tsx:1-15` | The import block. Line `:11` is the only line that goes; every other import keeps a live user. |
| `src/renderer/src/App.tsx:92-126` | The headless-leaf comment run — one contiguous block of `//` lines, no blank separators. `:108-112` (five lines) goes; `:113` and `:120` each carry an ordinal that must change. |
| `src/renderer/src/App.tsx:127-143` | The JSX. `:133` goes; the seven survivors keep their relative order. This is the list the corrected ordinals are counted against. |
| `src/renderer/src/store/screenSnapshotStore.ts` (67 lines) | Read once to confirm the export surface — `ScreenSnapshot`, `ScreenSnapshotState`, `ScreenSnapshotStore`, `initialScreenSnapshotState`, `createScreenSnapshotStore`, `screenSnapshotStore`, `useScreenSnapshotStore`, `selectScreenSnapshot`. Then delete. None has an external reference. |
| `src/renderer/src/store/screenSnapshotBridge.ts` (75 lines) | Same — `translateScreenSnapshot`, `subscribeScreenSnapshot`, `ScreenSnapshotData`. `App.tsx:11` is the only import of any of them. Then delete. |
| `src/renderer/src/store/screenSnapshotStore.test.ts` (77 lines) · `screenSnapshotBridge.test.ts` (177 lines) | Delete outright. Both import only from the two modules above plus vitest/react. |
| `src/renderer/src/App.test.tsx:69-80` | The `<App />` neutral-paint test. It renders the real `App` with every leaf mounted, so it is a live regression gate against a *broken* edit — but it asserts `''` identically with or without the leaf, which is why AC3's ordering half is review-tier (§ Testing strategy). |
| `src/renderer/src/store/daemonEventBridge.ts:133-137` · `timelineBridge.ts:155-159` · `modalBridge.ts:92-96` | The three `screenSnapshotReceived` no-op arms. Read to confirm they reference the *event member*, never the deleted modules. They stay — compile-forced by `assertNever` until #621. |
| `docs/specs/architecture/618-screen-snapshot-surface-removal.md:172-178` | The sibling slice's forward prediction about this ticket. Two-thirds of it is stale — see § Correction to #618's spec. Read it so the stale half is not acted on. |

Not in scope, do not open except to confirm: `src/renderer/src/store/runConfigStore.ts`,
`src/renderer/src/screens/conversation/runConfigSnapshot.ts` (a different snapshot, live),
`src/main/transport/requestSnapshotEnvelope.ts` (#620), `src/shared/ipc/events.ts` (#621).

---

## Context

The screen-snapshot feature answered by photographing claude's terminal. That terminal was deleted
upstream on 2026-08-16 (pyrycode#1348) and the daemon now wires `Snapshotter: nil`, so every request
lands in the offline arm. The operator's call on 2026-08-20 is **remove**, consumer-first.

This is the second of five slices. #618 (PR #626) took the visible surface, which left
`screenSnapshotStore` with no reader and `ScreenSnapshotData` writing state nobody can observe. This
slice takes the state layer. The IPC command, the outbound transport half and the wire types all stay
and keep compiling — #620–#622. A raw-event view to replace the feature was discussed and deliberately
deferred; do not build one.

---

## Design

### What comes out

Four whole files and three excisions in one. Zero fan-out — verified by `codegraph_context` and by a
repo-wide grep of every exported name in both deleted modules: outside their own two test files, the
sole import site anywhere in `src/` or `e2e/` is `App.tsx:11`.

**Deleted outright:**

| File | Lines |
|---|---|
| `src/renderer/src/store/screenSnapshotStore.ts` | 67 |
| `src/renderer/src/store/screenSnapshotStore.test.ts` | 77 |
| `src/renderer/src/store/screenSnapshotBridge.ts` | 75 |
| `src/renderer/src/store/screenSnapshotBridge.test.ts` | 177 |

`src/renderer/src/store/` has no barrel file, `vitest.config.ts` selects tests by the glob
`src/**/*.{test,spec}.{ts,tsx}` rather than by a file list, and the project configures no coverage
thresholds — so the two test deletions strand nothing and need no config edit.

**`App.tsx`** — three excisions, seven lines:

1. `:11` — `import { ScreenSnapshotData } from './store/screenSnapshotBridge'`.
2. `:108-112` — the five-line `ScreenSnapshotData (#323)` comment paragraph. The ticket body is right
   that this is **five lines, not three**: it runs from `// ScreenSnapshotData (#323) is a fifth …`
   through `// gate. Ships dormant — it populates the store, but nothing renders it yet (#324).` The
   surrounding block has no blank separators, so removing those five leaves QueueData's paragraph
   (ending `:107`) directly abutting BackgroundTaskRosterData's (starting `:113`) — which is the
   correct result, not a formatting slip.
3. `:133` — `<ScreenSnapshotData />`.

No import besides `:11` goes: every other name in `:1-15` keeps a live user in this file.

### The ordinal chain

`App.tsx`'s leaf comments number themselves against the JSX, and `:113` tells the reader to *"count
the JSX below, not these comments"* because `RelayLinkData` landed without a comment. Deleting the
fifth leaf therefore falsifies the two comments that state an ordinal above it — by the very method
they prescribe. They are in the file this ticket already edits; correct them.

Post-deletion the JSX mounts seven leaves in this order:

| # | Leaf | Comment ordinal | Action |
|---|---|---|---|
| 1 | `ConversationListData` | *(states none)* | — |
| 2 | `SessionIdData` | *(states none)* | — |
| 3 | `RunSettingsWriteData` | "a third sibling" | **correct already** |
| 4 | `QueueData` | "a fourth sibling" | **correct already** |
| 5 | `RelayLinkData` | *(no comment at all)* | — |
| 6 | `BackgroundTaskRosterData` | `:113` "the SEVENTH" | → **SIXTH** |
| 7 | `AnnouncedModelData` | `:120` "the EIGHTH" | → **SEVENTH** |

Two things this table is meant to prevent:

- **Do not touch "third" or "fourth."** They precede the deleted leaf, so they are unaffected. A
  sweep that renumbers the whole chain is out of scope and would churn two healthy comments.
- **Do not touch the parenthetical at `:113`** — *"(count the JSX below, not these comments —
  RelayLinkData landed without one)"*. It stays true and stays load-bearing: after the deletion
  `RelayLinkData` is still the only comment-less leaf, and the chain still skips exactly one ordinal
  (`fourth → SIXTH`), which is exactly what the parenthetical exists to explain. The comment's shape
  is preserved by the change, not broken by it.

Keep the existing ALL-CAPS convention on both replaced words — the surrounding comments capitalise a
stated ordinal only where the number is the point, and both of these are.

`AnnouncedModelData`'s *"Unlike its roster neighbour above"* (`:123`) survives untouched: the roster
leaf is still its immediate predecessor in both the comment chain and the JSX.

### The residual census

AC4 reads *"no module under `src/` **imports** either deleted module."* It is an import criterion, not
a word criterion — the distinction matters, because after the deletion a grep for the deleted module
names still returns **twelve** live hits and **every one of them is supposed to stay**. They are
comment citations that use the deleted modules as a design precedent, carved out to #635, which sweeps
once at the tail of the series so #620–#622's stranded citations land in the same pass rather than in
four partial ones.

This is the exact expected residual. After the deletion,
`grep -rn 'screenSnapshot\|ScreenSnapshot' src/ --include='*.ts' --include='*.tsx'` filtered to the
module names — `screenSnapshotStore`, `screenSnapshotBridge`, `ScreenSnapshotData` — must return these
twelve lines and nothing else:

| File | Lines | Count |
|---|---|---|
| `src/renderer/src/store/announcedModelStore.ts` | `:7`, `:76`, `:103` | 3 |
| `src/renderer/src/store/announcedModelStore.test.ts` | `:10` | 1 |
| `src/renderer/src/store/announcedModelBridge.ts` | `:5`, `:27`, `:32`, `:70` | 4 |
| `src/renderer/src/store/announcedModelBridge.test.ts` | `:13`, `:215`, `:218` | 3 |
| `src/renderer/src/store/serverInfoLoader.ts` | `:49` | 1 |

Line numbers are stable: none of these five files is edited by this ticket.

A thirteenth hit and a hit in `App.tsx` would both be defects — the first means a citation was missed
in the census, the second means the excision is incomplete.

`announcedModelBridge.ts:70` is the one that will most tempt an edit: it says the announced-model
binding is *"mounted app-level in App.tsx, alongside ScreenSnapshotData"*, and after this ticket that
neighbour no longer exists — a positional claim, not just a stale name. **Leave it.** #635 owns it.
Fixing it here means re-anchoring it to a surviving neighbour, which is precisely the judgment call
#635 exists to make once, with #620–#622's strandings visible at the same time.

### Scope by call site, not by the word `snapshot`

Three further families of `snapshot` hits survive, and none is this ticket's:

- **The event member.** `screenSnapshotReceived` stays everywhere — `src/shared/ipc/events.ts`,
  `src/main/`, and the three exhaustive renderer bridges' `null`-returning arms
  (`daemonEventBridge.ts:133`, `timelineBridge.ts:155`, `modalBridge.ts:92`, each with its explanatory
  comment). Those arms are compile-forced by their `assertNever` guards; deleting one is a type error
  today. #621 removes the member and the arms together. The `screenSnapshotReceived` fixture entries
  and their comments in `modalBridge.test.ts:154` and `timelineBridge.test.ts:286` stay for the same
  reason — #621 takes the fixture entry and its comment in one move, so rewriting them here is thrown
  away one slice later.
- **The outbound half.** `src/main/transport/requestSnapshotEnvelope.ts` and its test are
  screen-snapshot code, but they belong to #620.
- **A different snapshot entirely.** `runConfigStore.ts` and `runConfigSnapshot.ts` are the settings
  sheet's own state and data path, named for an unrelated snapshot, and live. Do not touch them.

### Correction to #618's spec

`docs/specs/architecture/618-screen-snapshot-surface-removal.md:172-178` predicts that three prose
hits — `App.tsx:109`, `modalBridge.test.ts:154`, `timelineBridge.test.ts:286` — are "all three deleted
by #619 when the store goes." **Only the first is.** The other two describe the event member, not the
store, and belong to #621 per this ticket's body. Do not act on that sentence; it was written before
the #619/#621 boundary was drawn. Nothing needs editing in #618's spec — it is a merged historical
record — but the prediction should not be followed.

---

## State + concurrency model

One app-lifetime subscription is removed. `ScreenSnapshotData`'s `useEffect` subscribed to
`window.pyry.onDaemonEvent` on mount and returned the off-handle as its cleanup; removing the mount
removes both. That listener is one of several independent subscribers on the single daemon-event
channel (#202) — the remaining subscribers (`useDaemonEventBridge`, `useTimelineBridge`,
`useModalBridge`, and six sibling leaves) are unaffected, because each holds its own handle and none
shares state with the removed one.

No other store is created, mutated, or torn down. `screenSnapshotStore` is a module-level singleton
with no cross-store wiring: it is **not** a member of `clearPairingScopedState`'s dependency set
(verified — `clearPairingScopedState.ts` never references it), so no clear path, no test fixture and
no `ClearPairingScopedStateDeps` field changes.

`screenSnapshotReceived` events keep arriving from the transport and are now dropped by every
subscriber — which is the intended end state until #621 stops them at the wire.

## Error handling

No failure mode is added or removed. The deleted bridge never threw into React (its listener only
translated and dispatched) and the deleted store had no validation, no coercion and no async path. No
user-visible error surface changes.

## Testing strategy

No test is written. This is a deletion; the gate is that the surviving suites still pass.

- **`npm test`** — green, nothing skipped. The suite loses the two deleted files' cases and nothing
  else: no other test in the repo imports either module or asserts on screen-snapshot state (verified
  repo-wide).
- **`npm run typecheck`** — the real proof the excision is complete. A leftover import of either
  deleted module is a compile error here.
- **`npm run build`** — the salvage gate.
- **Fake-daemon e2e** — green, nothing skipped. **No `e2e/` spec is edited.** #618 took the last
  reference when it renamed `stall-snapshot-bundle.spec.ts` to `stall-bundle.spec.ts`; a grep of
  `e2e/` for `screensnapshot`/`screen-snapshot` returns zero. AC5's e2e half is a regression gate
  here, not a file to change. Note `e2e/` sits outside both tsconfigs, so typecheck proves nothing
  about it — it must actually run.

Three things are **verified by reading the diff**, because no gate covers them:

- **AC3's ordering half.** `App.test.tsx:70-79` renders the real `<App />` and asserts `''`. Every leaf
  renders `null` and renderer tests are server-render only (node env, no DOM, no
  `@testing-library`), so that assertion yields `''` identically with or without the leaf — and with
  the leaves in any order. It *is* a live gate against a broken edit (a dangling import or a syntax
  error makes it throw), but it cannot distinguish present from absent or ordered from reordered. Do
  not try to build a test that can; read the JSX block and confirm the seven survivors are in their
  original relative order.
- **The corrected ordinals.** Count the JSX, confirm `BackgroundTaskRosterData` is sixth and
  `AnnouncedModelData` seventh, and confirm the comments now say so.
- **The residual census.** Run the grep from § The residual census and diff it against the
  twelve-line table. Twelve hits in five files, zero in `App.tsx`.

## Open questions

None. Every call site is enumerated above and every boundary with #620/#621/#635 is drawn by the
ticket body.
