# #581 — Background-task panel: an openable surface listing the tasks held for the conversation

**Size:** S (held — see *Size check*)
**Labels:** `size:s`, `security-sensitive`
**Split from:** #568. Successors: #582 (truncation + cap reports), #583 (latest patch), #580 (visual design).

## Design source

N/A — the canonical Figma file `g2HIq2UyPhslEoHRokQmHG` is the **mobile** design and has no counterpart for this surface (verified against its node inventory during #568's refinement; the panel is a desktop-only surface per pyrycode#1241). Visual design lands in **#580**. Ship against the written description below, reusing the existing overlay chrome as the interim visual vocabulary.

Because #580 may land this as a docked sidebar rather than an overlay sheet, the **row and branch markup must not depend on the chrome**: no `.status-sheet …` descendant CSS selectors, no positional CSS on the rows, no `.status-sheet__*` class on a row or on the branch copy. Only the outermost wrapper is chrome. #580 then swaps the wrapper without touching the list.

## Files to read first

> Codegraph is not initialized for this repo (`codegraph_status` → *"CodeGraph not initialized"*, confirming the standing note). This list was built by direct reading, not by `codegraph_context`.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/backgroundTaskRosterStore.ts:395-424` | `selectRosterFor` — the three readings and *why* `?? null` instead of an `EMPTY_*` sentinel. **The authority.** Read the docstring, not the ticket table. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:99-170` | `HeldBackgroundTask` + `BackgroundTaskRosterEntry` — the exact field set this panel may read (`taskId`, `taskType`, `description`) and the ones it may not (`toolCallId`, `truncatedFields`, `latestUpdate`, `droppedTasks`). |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:47-55` | The store's SECURITY header — the obligation this ticket inherits, stated in the store because the store has no DOM sink. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:386-393` | `backgroundTaskRosterStore` singleton + `useBackgroundTaskRosterStore` — the read binding. Note the selector's param type is `BackgroundTaskRosterState`, assignable to the hook's `BackgroundTaskRosterStore` selector slot. |
| `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx` (whole, 277 lines) | **The precedent to clone.** Pure exported view + in-file container + `export { … }` at the foot; the `.status-sheet__*` chrome verbatim (`:107-133`); the distinct-title-id comment (`:39-41`); the three-way branch posture (`:136-175`); the Escape effect (`:224-233`). Clone the *posture*, not the shapes. |
| `src/renderer/src/screens/conversation/WorkspacePickerSheet.test.tsx` (whole, 181 lines) | The test idiom this file's tests must match: `renderToStaticMarkup` + string assertions, `noop`, a fixture factory with `Partial<>` overrides, the tag-isolating regex helper, the escaping test at `:151-165`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:127-145` | The three existing sheet-open `useState` booleans (`:131`, `:136`, `:141`) — the fourth is their twin, with the same ADR-0006 comment shape. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:188-201` | The mount region between the queued backlog and the composer — where the trigger goes. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:203-242` | The three existing `{open && <Sheet …/>}` mounts — the fourth joins them, before `<PermissionModal />`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:991-1009` | `QueuedBacklogControl` — **the conversation-id read to clone**: `useActiveConversationStore((s) => s.activeConversation?.id ?? null)` + a `useMemo`-stable selector-per-id. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1011-1043` | `StatusRow` — the icon-only trigger idiom (`aria-label`, `aria-haspopup="dialog"`). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1046, 1113-1114` | The two in-file title-id constants the new one must differ from. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1407-1420, 1540-1548` | The container smoke-test shape **and the zustand v5 server-snapshot note** — `useStore` reads `getInitialState()` under server render, so `setState` is invisible. This rules out one obvious test shape; see *Testing strategy*. |
| `src/renderer/src/screens/conversation/conversation.css:808-844` | `.status-row` — the trigger's CSS neighbour and token vocabulary. |
| `src/renderer/src/screens/conversation/conversation.css:1780-1900` | The `.workspace-picker__*` block — the row / empty-line CSS to clone (all token-based, zero literals). Append the new block after it. |
| `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` | The open/closed-state rule: a single screen-local boolean is `useState`, never the store. |

## Context

`backgroundTaskRosterStore` has been shipped and **unread** since #573 — nothing outside its own tests reads `selectRosterFor` or `useBackgroundTaskRosterStore`. This ticket is its first reader, and the first slice of #568's panel.

The problem it solves: work that outlives a turn has no home. The daemon reports `turn_end` with `end_turn` and `turn_state` flips to `idle` while a command claude started is provably still running (pyrycode#1240). The panel is that home — **not** timeline rows; the chat stays exactly as clean as it is today.

This slice is deliberately the *shell*: chrome, trigger, the three-way branch, and one row per task showing `description` + `taskType`. `droppedTasks` and per-task `truncatedFields` are #582; `latestUpdate` is #583.

## Design

### Module structure

One new file, cloning `WorkspacePickerSheet.tsx`'s three-part shape (pure view exported, container in-file, `export { … }` at the foot):

```
src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx
  ├─ module-level copy constants + the title id      (client-owned, apostrophe-free)
  ├─ export function BackgroundTaskPanelView(props)  pure, props-in / markup-out — every AC binds here
  └─ function BackgroundTaskPanel({ conversationId, onClose })   in-file container; exported at the foot
```

`ConversationScreen.tsx` gains: an in-file `BackgroundTaskTrigger`, a fourth open-state boolean, and the mount. `conversation.css` gains a `.background-task-panel__*` / `.background-task-trigger` block.

**No bridge mount.** `<BackgroundTaskRosterData />` is already the seventh headless leaf in `App.tsx:127`. Mounting one here would be a second write path — the one structural difference from the `WorkspacePickerSheet` precedent, which *does* mount `RecentWorkspacesData` inside itself.

### Key types

```ts
export function BackgroundTaskPanelView(props: {
  entry: BackgroundTaskRosterEntry | null   // exactly selectRosterFor's return type
  onClose: () => void
}): JSX.Element
```

The prop type **is** the selector's return type — that is what forces the branch at the view, where the tests can reach it. Do not narrow it to `ReadonlyMap | null` in the container: `#582` extends this same prop with `entry.droppedTasks`, and narrowing would have to be undone.

```ts
function BackgroundTaskPanel(props: {
  conversationId: string | null   // not the whole ConversationCreatedPayload — the id is all this needs
  onClose: () => void
}): JSX.Element
```

### The three-way branch — the ticket's hardest AC

The branch is on **two different things** and must be written in this order:

1. `entry === null` → the *never-observed* reading.
2. `entry.tasks.size === 0` → the *observed, nothing alive* reading.
3. otherwise → one row per `entry.tasks.values()`, in iteration (= roster) order.

The failure mode to design against, named by the ticket: a reader that reaches for the tasks *before* branching and collapses (1) into (2). It produces no type error and fails no test unless one is written for it. Concretely, **these are the wrong shapes** and none of them compiles to a distinguishable output:

- `const tasks = [...(entry?.tasks.values() ?? [])]` then `tasks.length === 0`
- `(entry?.tasks.size ?? 0) === 0`
- `entry?.tasks ?? new Map()`

Test scenario 4 below is the whole defence.

Each non-populated reading renders **its own element with its own class and its own copy** — not a shared "empty" element with different text, and not `null`. Two distinct classes is what makes "structurally distinct" (AC4) assertable as a string test and keeps #580 free to style them differently:

| reading | element | copy |
|---|---|---|
| never observed | `<p className="background-task-panel__unobserved">` | `No background-task report yet` |
| observed, nothing alive | `<p className="background-task-panel__empty">` | `No background tasks` |
| populated | one `<li className="background-task-panel__row">` per task | — |

Note this deliberately diverges from the `WorkspacePickerSheetView` precedent, whose not-loaded branch renders `null` (`WorkspacePickerSheet.tsx:139`). There, the sheet has other content and a bare header reads fine; here the branch *is* the whole body, so an empty panel would read as broken. Clone the posture (branch first, distinct output per reading), not the literal `null`.

### Row shape

One row per `HeldBackgroundTask`, rendered from `[...entry.tasks.values()]` (a `ReadonlyMap` `.values()` is an iterator — spread it; do not call `.map` on it). React `key={task.taskId}` — unique by map-key construction, and carried in the value precisely so the reader need not thread entry keys (`HeldBackgroundTask` docstring, `:141-142`).

Each row renders **exactly two fields**: `description` (primary line) and `taskType` (muted secondary line), both as auto-escaped React children. Nothing else. `toolCallId`, `truncatedFields`, `latestUpdate`, and the entry's `droppedTasks` are **not rendered, not derived from, and not used as a key or an attribute** — they are #582/#583's seams.

Ordering is roster order and requires no sort: the held `Map` preserves insertion order by construction and `setRoster` rebuilds it in row order (`backgroundTaskRosterStore.ts:313`).

Use a `<ul>` / `<li>` list for the rows. It is the honest semantics for "one entry per task", and it gives the tests a class to count. Do **not** make rows interactive — there is no action on a task in this slice, so a `<button>` row would advertise an affordance that does nothing.

### Chrome

Clone `WorkspacePickerSheetView`'s wrapper verbatim (`WorkspacePickerSheet.tsx:107-133`): `.status-sheet-overlay` → scrim (`aria-hidden`, `onClick={onClose}`) + `.status-sheet` with `role="dialog"`, `aria-modal="true"`, `aria-labelledby={…}`, the `.status-sheet__handle`, the `.status-sheet__header` with the title `<p id={…}>` and the icon-only `aria-label="Close"` button carrying the same close glyph, then `.status-sheet__body`.

New title id, distinct from the three existing ones (`status-sheet-title` `:1046`, `channel-info-sheet-title` `:1114`, `workspace-picker-sheet-title` `WorkspacePickerSheet.tsx:41`):

```ts
const BACKGROUND_TASK_PANEL_TITLE_ID = 'background-task-panel-title'
```

Carry the same "distinct from … so all four can coexist without duplicate ids" comment the other three carry.

### Copy

Client-owned module-level constants, **every literal apostrophe-free** (`renderToStaticMarkup` escapes `'` → `&#x27;`, breaking string assertions — the standing lesson, noted at `WorkspacePickerSheet.tsx:23-24`). None is ever a daemon string.

| constant | value |
|---|---|
| `BACKGROUND_TASK_PANEL_TITLE` | `Background tasks` |
| `BACKGROUND_TASK_PANEL_UNOBSERVED_COPY` | `No background-task report yet` |
| `BACKGROUND_TASK_PANEL_EMPTY_COPY` | `No background tasks` |
| `BACKGROUND_TASK_TRIGGER_LABEL` | `Background tasks` |

The two branch copies must read as different sentences — that is half of AC4's "must not collapse into one another".

### Trigger

An in-file `BackgroundTaskTrigger({ onOpen })` in `ConversationScreen.tsx`: an icon-only `<button className="background-task-trigger" aria-label={…} aria-haspopup="dialog" onClick={onOpen}>` carrying a decorative `aria-hidden` 24px inline SVG glyph, mounted as a sibling directly after `<StatusRow …/>` (`:191`).

The `StatusRow` idiom, chosen over the other two the ticket names:

- **Overflow menu** — rejected on the ticket's own costing note: `ThreadOverflowMenuView` (`:1688`) is hardcoded to one item with one `onSelect`, so routing through it means generalising the menu, its container, and its tests. That cost buys nothing this slice needs.
- **Control-owned button** (`WorkspaceChip`'s "Change") — rejected because `WorkspaceChip` self-gates to `null` unless the thread is empty and the conversation is unpromoted (`:559-563`). A trigger hosted there would vanish the moment a message is sent, which is exactly when background tasks exist.

**Rendered unconditionally**, not gated on tasks existing. Gating would make both non-populated readings unreachable through the UI and turn AC4 into a claim about code no user can exercise. It also keeps AC2 a plain markup assertion on the default screen render.

**No count badge.** A badge would require the trigger to subscribe to the roster store, which is the panel's job and #580's design call. Deliberately out.

### State + concurrency model

- **Open/closed** — a fourth screen-local `useState` boolean in `ConversationScreen`, the twin of `sheetOpen` / `channelInfoOpen` / `pickerOpen` (`:131` / `:136` / `:141`). ADR 0006: a single-value ephemeral screen-local boolean is `useState`, never the store. It resets to closed on remount for free. The panel mounts only while open (`{panelOpen && <BackgroundTaskPanel …/>}`), so the Escape listener attaches on mount and detaches on cleanup — no `open` flag, no leak past close.
- **Store read** — the container clones `QueuedBacklogControl` (`:991-997`):
  - `useActiveConversationStore((s) => s.activeConversation?.id ?? null)` at the *mount site* in `ConversationScreen` (the slice is already read there as `activeConversation` at `:126` — derive `activeConversation?.id ?? null` inline and pass it down; do not add a second subscription).
  - inside the container: `const selectRoster = useMemo(() => selectRosterFor(conversationId ?? ''), [conversationId])`, then `useBackgroundTaskRosterStore(selectRoster)`.
  - The `''` sentinel matches no key, so **no active conversation reads `null` = never observed**, which is the correct reading and needs no extra branch.
- **Re-render correctness** — `selectRosterFor` returns the held entry itself (never a fresh object), and a write for a *different* conversation leaves this entry `Object.is`-identical, so no churn. This is documented at `backgroundTaskRosterStore.ts:415-418`; do not wrap the result in `useMemo`, `Array.from` at the container, or any derivation that would defeat it.
- **Async / cancellation** — none. No effects beyond the Escape `keydown` listener, no IPC, no `window.pyry`, no timers. This slice sends nothing.

### Error handling

There are no failure modes to surface. The panel performs no I/O, no parsing, and no dispatch; every value it reads is already-validated renderer state written by the bridge. The three-way branch is a *reading* distinction, not an error path — in particular, **"never observed" is not an error state and must not be styled or worded as one**. `selectRosterFor` cannot throw; the store's setters are the only writers and every one is total.

The one thing that could reasonably be called a failure — a conversation the daemon has never reported on — is exactly reading (1) and is displayed, not logged. Do **not** add a log line on any branch: a "no roster for conversation X" line is where daemon-influenced content starts leaking into a file (the content-free diagnostics rule, ADR 0007 / #126), and the store's own setters are deliberately silent for the same reason (`backgroundTaskRosterStore.ts:279-280`).

## Testing strategy

`npm test` (vitest, `node` env) + `npm run typecheck`.

**The posture, stated so nobody hunts for a gap.** There is no DOM environment and no `@testing-library` in this repo; renderer tests are `renderToStaticMarkup` string assertions. Clicks cannot be fired and effects do not run. So:

- **`BackgroundTaskPanelView` is where every AC binds** — pure, injected props, no store.
- **`BackgroundTaskPanel` (the container) is untested reviewed glue** — the open-state wiring, the `useMemo` selector, the Escape effect. This is the established #365 / #383 posture, not a gap.

**A trap to skip, not discover.** Do **not** try to prove the populated path through `<ConversationScreen />` by writing to the `backgroundTaskRosterStore` singleton and server-rendering. zustand v5's `useStore` reads `getInitialState()` under server render and never sees `setState` — the assertion would be silently vacuous. This is already documented at `ConversationScreen.test.tsx:1543-1546`.

### `BackgroundTaskPanel.test.tsx` — `BackgroundTaskPanelView`

Add a fixture factory `task(overrides: Partial<HeldBackgroundTask> = {}): HeldBackgroundTask` and an `entry(tasks, droppedTasks)` helper, mirroring `WorkspacePickerSheet.test.tsx:16-18`.

1. **Chrome (AC1)** — render with an observed-empty entry. Assert `role="dialog"`, `aria-modal="true"`, `aria-labelledby="background-task-panel-title"`, `id="background-task-panel-title"`, the title copy, `aria-label="Close"`, and `status-sheet__handle`. Also assert the title id differs from all three existing ones by asserting the markup does *not* contain `workspace-picker-sheet-title`, `channel-info-sheet-title`, or `status-sheet-title` — note the last is a substring of nothing else here, so the assertion is meaningful.
2. **Populated rows, roster order (AC3)** — two tasks with distinct descriptions and task types. Assert all four strings present, and assert order via `markup.indexOf(first) < markup.indexOf(second)`.
3. **No other task field (AC3)** — one task whose `toolCallId`, `truncatedFields`, and `latestUpdate.patch` carry *distinctive sentinel strings*, in an entry with `droppedTasks: 987654`. Assert each sentinel and `'987654'` are absent from the markup. (Sentinels, not realistic values — a realistic `truncated_fields: ['description']` would collide with other copy; a small `droppedTasks` could collide with an SVG path number.)
4. **The three readings are distinct (AC4)** — three renders, one per reading, each asserting the presence of *its own* class/copy and the absence of the other two:
   - `entry={null}` → contains `background-task-panel__unobserved` + its copy; does **not** contain `background-task-panel__empty` or `background-task-panel__row`.
   - `entry={{ tasks: new Map(), droppedTasks: 0 }}` → contains `background-task-panel__empty` + its copy; does **not** contain `background-task-panel__unobserved` or `background-task-panel__row`.
   - populated → contains `background-task-panel__row`; does **not** contain either non-populated class.
5. **Untrusted text renders inert (AC5)** — a task with `description: '<img src=x onerror="alert(1)">'` and `taskType: 'a<b&c'`. Assert: the escaped forms are present (`&lt;img`, `a&lt;b&amp;c`); `'<img'` is absent; `'onerror='` is absent; and — the strong structural guard — the whole markup contains no `href=` and no `src=` (the panel has exactly one inline SVG, which carries neither). Do **not** assert `not.toContain('javascript:')` for a `javascript:` description: React escapes markup metacharacters, not the literal scheme text, so a *correct* render still contains that substring as inert text and the assertion would fail spuriously.

### `ConversationScreen.test.tsx` — additions

6. **The trigger renders with an accessible name (AC2)** — server-render `<ConversationScreen />`; assert `aria-label="Background tasks"` and `class="background-task-trigger"` present.
7. **Closed by default; nothing task-shaped in the thread (AC5, the regression clause)** — same render; assert `background-task-panel-title` and `background-task-panel__row` are both absent. This is the assertable half of "no background-task information appears in the chat timeline": it fails if anyone mounts the list inline instead of behind the trigger. The other half is structural and needs no test — `ThreadItem` (ADR 0008) has no background-task arm, and the bridge writes only `backgroundTaskRosterStore`, never the timeline reducer, so there is no code path to assert against and a test would be vacuous.

## Scope check

| Red line | Count | Verdict |
|---|---|---|
| New files (> 3) | 2 (`BackgroundTaskPanel.tsx`, `BackgroundTaskPanel.test.tsx`) | ✅ |
| Production `.ts/.tsx` files new+modified (≥ 5 → split) | 2 (`BackgroundTaskPanel.tsx`, `ConversationScreen.tsx`) | ✅ |
| Total written LOC (> ~600) | ~500 projected (see below) | ✅ |
| New exported types/components (> 5) | 2 (`BackgroundTaskPanelView`, `BackgroundTaskPanel`) | ✅ |
| Consumer call sites needing simultaneous update (> 10) | **0** — purely additive; no signature, type, or union member changes | ✅ |
| Acceptance criteria (> 5) | 5 | ✅ |
| Reject / error branches in a state machine (≥ 10) | 0 — one 3-way *display* branch, no state machine, no reject paths, no per-branch logging | ✅ |

**LOC projection, measured against the precedent rather than judged.** `WorkspacePickerSheet` (#383) shipped at **277 production + 181 test = 458 total** for a strictly larger surface: a bridge mount, a nested `CreateFolderDialog`, a wire-dispatch helper, relative-time formatting, two gating props, a "default" pill, section headers, and two icon components — none of which this slice has. What this slice keeps is the chrome, the row list, and the branch. Projection: ~170 panel + ~35 `ConversationScreen` wiring + ~70 CSS = **~275 production**; ~200 panel tests + ~25 screen tests = **~225 test**; **~500 total**, with the precedent as the falsifiable upper anchor.

**File-overlap check (2026-08-19):** `git fetch origin --prune` then a scan of every `origin/feature/<N>` branch's diff against `main` for `ConversationScreen.tsx`, `ConversationScreen.test.tsx`, `conversation.css`, and `BackgroundTaskPanel.tsx` — **no overlaps**. No blocker set.

## Open questions

1. **Panel placement in the DOM order** — spec says "after the three existing sheet mounts, before `<PermissionModal />`", matching the established stacking. If #580 makes it a docked sidebar this moves; not a decision this slice needs to get right.
2. **Whether the trigger should eventually carry a live count** — deliberately out here (it would need a second store subscription). Raise with #580, which owns whether the affordance is a row, a chip, or a rail button.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** *No findings.* The one boundary this slice touches is already crossed upstream: the daemon frames are decoded and validated by the transport (#564/#565/#566) and written to the store by `backgroundTaskRosterBridge`. This panel is a **pure reader** of renderer state — it adds no parse, no decode, no boundary. The values it renders (`description`, `taskType`) remain untrusted *content*, and the spec pins the only correct disposition: auto-escaped React children, one field per element, nothing else. The store's own header (`backgroundTaskRosterStore.ts:47-55`) names this ticket as the inheritor of that obligation, and the *Row shape* + test 5 sections are where it is discharged.
- **[Injection / HTML sink]** *No findings — and this is the category that matters here.* For `taskType: local_bash`, `description` **is the literal command line claude ran**. The spec forbids every sink by construction: no `dangerouslySetInnerHTML`, no `innerHTML`, no attribute placement (not even `title=`), no `href`/`src`, no use as a React `key` (the key is `taskId`), no `JSON.parse`, no `new Function`, no template concatenation into markup. The rows are deliberately **non-interactive** — no `<button>`, no `onClick` — so there is no handler that could be grown into a "run this" affordance later without a visible design change. Test 5's `no href= / no src=` assertion is a whole-markup structural guard, not a per-field spot check, so it fails on any future attribute placement anywhere in the panel.
- **[The list-shape temptation]** *No findings — addressed explicitly.* The ticket's sharpest observation is that a rendered **list** of command lines is a more tempting shape to feed somewhere structured than a single one. The spec renders `[...entry.tasks.values()]` **once, inline, into `<li>` children** and derives nothing from it: no join into a single string, no copy-to-clipboard, no "run all", no export, no `data-*` attribute carrying a task field, no serialisation. `tasks` stays a display set. The `<ul>`/`<li>` choice is semantic markup, not a work list.
- **[Tokens, secrets, credentials]** *Not applicable — by construction.* No token, key, or credential is in scope: the panel reads one renderer store slice and holds nothing. No new storage of any kind — in particular **no web storage**, which the store's header calls out (`:53-55`) as the thing that would survive the `connected`-edge reset and let a *previous pairing's* command lines reappear. This slice adds no persistence, so that invariant is preserved without new code.
- **[File / storage operations]** *Not applicable.* No filesystem access, no path handling. `description` may *look* like a path or a command line; the spec renders it whole and opaque and never resolves, splits, basenames, or joins it (the established `RecentWorkspace.path` / `WorkspaceChip` posture).
- **[Inter-process / Electron attack surface]** *No findings.* Renderer-only, additive: no new `contextBridge` API, no new `ipcMain` channel, no `window.pyry` dereference anywhere in this slice (unlike `WorkspacePickerSheet`, which dereferences it inside a click closure — this panel has no dispatch at all). No navigation, no `window.open`, no remote content. `webPreferences` untouched.
- **[Cryptographic primitives]** *Not applicable.* No randomness, no comparison against a secret, no hashing. React keys come from `taskId`, a daemon-supplied identifier used only as a list key — never compared to anything and never security-relevant.
- **[Network & I/O]** *Not applicable.* The panel opens no socket and sends no frame. Inbound frame caps (roster ≤ 8 rows via `maxTaskRosterEntries`, the 65519-byte envelope) are enforced upstream in the transport and already shipped; this slice inherits them and adds no unbounded read.
- **[Error messages, logs, telemetry]** *No findings — and a MUST-NOT is pinned.* The spec's *Error handling* section explicitly forbids adding a log line on any branch, including the tempting "no roster for this conversation" diagnostic, because task text is daemon-influenced content and a log line is where it would first reach a file (ADR 0007 / #126). The store's setters are silent for exactly this reason (`:279-280`). No error text renders a daemon string either — the two branch copies are client-owned constants.
- **[Concurrency]** *No findings.* The only async resource is the Escape `keydown` listener, and it is owned by an effect whose cleanup removes it; the panel mounts only while open (`{panelOpen && …}`), so mount/unmount *is* the lifecycle — no `open` flag to desync, no listener leak, no double-fire. No timers, no promises, no `AbortController` needed because nothing is in flight. No check-then-act: the store read is synchronous and there is no write path at all, so there is no shared-state race to guard.
- **[Threat model alignment]** *Addressed.* **Hostile/compromised daemon or model-influenced content** is the live threat and is the whole subject of the injection finding above — the panel treats every task field as hostile display text. **Malicious relay** is out of scope for a pure renderer reader: it cannot reach this component without first passing the Noise session and the transport's decode. **Renderer compromise reaching the transport** is unchanged — this slice adds no capability, no IPC surface, and no privileged reference. **Stale-list-presented-as-live after reconnect** is a real, named limitation (the app advertises no `last_event_id`, so `resetRosters` clears to "nothing observed" and nothing repopulates until claude next emits) — **explicitly out of scope, owned by #569**, which needs a daemon-side change. This slice must not paper over it by retaining or synthesising state.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
