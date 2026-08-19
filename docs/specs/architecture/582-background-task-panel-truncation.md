# #582 — Background-task panel: show when the roster was capped or a task's text was cut

**Size:** S (held — see *Scope check*)
**Labels:** `size:s`, `security-sensitive`
**Split from:** #568. Predecessor: **#581** (the panel shell, shipped `4d1d973`, PR #584). Successor: #583 (the latest patch + its own cut report). Visual design: #580.

## Design source

N/A — the canonical Figma file `g2HIq2UyPhslEoHRokQmHG` is the **mobile** design and has no counterpart for this surface; the background-task panel is a desktop-only surface (pyrycode#1241). Visual design lands in **#580**, which lists the capped-roster and cut-text states among the states it must cover. Ship against the written description below, extending the interim visual vocabulary the shell established.

Because #580 may still relayout this as a docked sidebar, the same constraint the shell carries applies to everything added here: **no `.status-sheet …` descendant selectors, no positional CSS, no chrome class on the new elements.** They carry their own `background-task-panel__*` classes so #580 can restyle or reposition them without touching the branch.

## Files to read first

> Codegraph is **not** initialized for this repo — `codegraph_status` → *"CodeGraph not initialized"*, re-verified for this run. This list was built by direct reading, not by `codegraph_context`.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` (whole, 173 lines) | **The file this ticket edits — the only production file it touches.** The three-way branch (`:108-133`), the row (`:124-130`), the copy constants (`:38-49`), and the SECURITY header (`:28-36`) whose obligations this slice inherits unchanged. |
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` (whole, 159 lines) | The `task(overrides)` / `entry(tasks, droppedTasks)` fixture helpers (`:17-32`) — both of this ticket's states are directly constructible from them. **Also `:75-99`, the one shipped test this ticket must revise** (see *Testing strategy*). |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:156-170` | `BackgroundTaskRosterEntry` — `droppedTasks` is the roster's only truncation report, the true roster size is `tasks.size + droppedTasks`, and `0` is a value never consulted for truthiness. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:99-154` | `HeldBackgroundTask` — `truncatedFields: readonly string[] | null`, why `null` and `[]` are distinct, and why a started frame **replaces** the list rather than unioning with it. Read `:127-133` in particular: the three frames' vocabularies. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:320-335, 345-355` | The two write paths (`truncatedFields: row.truncated_fields` `:328`, `truncatedFields: snapshot.truncatedFields` `:351`) — **the evidence for the wire-name trap below.** The array passes through by reference; only the *field* is camelCased. |
| `src/shared/wire/types.ts:494-533` | `BackgroundTask` — the roster row's four wire fields (`task_id`, `task_type`, `description`, `truncated_fields`) and `:510-512`, which states each row names its own vocabulary. **This is where the string `task_type` comes from.** |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:485-500` | The existing "the daemon cut this" idiom: a boolean-gated `<p className="unrecognized-row__truncated">` holding `UNRECOGNIZED_TRUNCATED_COPY` — client-owned copy, conditional render, nothing derived from the cut text. **The posture to clone.** |
| `src/renderer/src/screens/archive/archiveViewModel.ts:41-49` | `tabCountLabel` — the repo's count-in-copy idiom: a template literal with a parenthesised count, **no pluralisation branch anywhere**. The notice copy follows it. |
| `src/renderer/src/screens/conversation/conversation.css:2140-2149` | `.unrecognized-row__truncated` — the exact declaration set the new marker rule reuses. |
| `src/renderer/src/screens/conversation/conversation.css:2155-2235` | The shipped `.background-task-panel__*` block — append to it; note `.background-task-panel__row` is `flex-direction: column`, so a marker inserted after a field becomes its own line for free. |
| `docs/specs/architecture/581-background-task-panel-shell.md` | The predecessor spec: the branch-order rationale and the test posture this slice extends. |

## Context

The daemon bounds what it can tell this app about background tasks in **two independent ways** and reports both rather than hiding them. The shipped panel shows neither, so a bounded report currently reads as a complete one:

1. **The roster is capped** at 8 rows; the overflow count arrives as `entry.droppedTasks`.
2. **Individual strings are cut**; each held task names its own cut fields in `truncatedFields`.

These are independent — different sources, different lifetimes, no interaction — and the design keeps them independent. `droppedTasks` is a property of the *entry* (preserved across started and updated frames precisely because neither reports anything about roster truncation); `truncatedFields` is a property of *one task*.

The shell pre-built both seams: the `entry` prop is exactly `selectRosterFor`'s return type, so **no prop, type, or store change is needed** — both fields are already reachable. This slice is purely additive display inside `BackgroundTaskPanelView`.

The update's own cut report (`latestUpdate.truncatedFields`) names a **different vocabulary** (`task_id` / `patch`) and belongs to **#583**. Do not merge it into this ticket's list.

## Design

### What changes

One production file: **`src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx`**. Plus its test file and a CSS block. Nothing else — no store change, no bridge change, no `ConversationScreen.tsx` change, no wire change, no new export.

### 1. The partial-list notice (AC1, AC2)

**Placement is the AC.** The notice must render whenever a present entry reports dropped tasks, **whichever branch the task list itself takes**. So it is a **sibling of the three-way ternary, not a child of any arm** — the first child of `.status-sheet__body`, above the branch:

```tsx
<div className="status-sheet__body">
  {entry !== null && entry.droppedTasks > 0 && (
    <p className="background-task-panel__partial">{partialListCopy(entry.droppedTasks)}</p>
  )}
  {/* the shipped three-way ternary, unchanged */}
</div>
```

This is load-bearing, not stylistic. `BackgroundTaskPanelView` branches `entry === null` → `entry.tasks.size === 0` → rows, and a present entry with `droppedTasks > 0` and zero carried tasks takes the *middle* arm. The daemon cannot currently produce that combination (the cap drops only beyond 8 carried rows), but **the view is a pure function of its prop and a test constructs it directly** — so "unreachable daemon-side" is not an answer. Putting the notice inside the populated arm would make it invisible in exactly that state. Do not move it there.

**Two guard details, both of which fail silently if got wrong:**

- The guard must be a **boolean comparison**, never `{entry.droppedTasks && …}`. React renders the number `0` as a text node, so the truthiness form would print a bare `0` into the panel on every non-truncated roster. The store's own docstring (`:164-165`) says `0` is a value, never consulted for truthiness — this is that rule at a render site.
- Use `> 0`, not `!== 0`. `requireNumber` upstream does not range-check, so a nonsense negative count degrades to "no notice" rather than to "Partial list (-1 not shown)". This is a comparison choice, not a validation branch — **do not add a validation branch**; nothing has been observed producing one.

**Copy** — a module-private composer next to the other copy constants:

```ts
function partialListCopy(droppedTasks: number): string
```

Returns exactly `` `Partial list (${droppedTasks} not shown)` ``. The parenthesised-count shape is `tabCountLabel`'s idiom (`archiveViewModel.ts:47-49`) and it is chosen **to dodge pluralisation**: "1 not shown" and "3 not shown" both read correctly, so no singular/plural branch is needed and the repo gains no pluralisation machinery it does not already have. Apostrophe-free, like every literal in this file.

The count is a `number`, so rendering it introduces no untrusted string. It is the only daemon-derived *value* this slice renders, and numbers are inert.

The notice deliberately does **not** print the true roster size (`tasks.size + droppedTasks`). The AC asks for "how many tasks are not shown"; the reader can see the rows. A derived total is a second number to keep honest for no stated need.

### 2. The per-field cut marker (AC3, AC4, AC5)

**Match the WIRE names, not the held property names.** This is the trap the ticket exists to defuse. The list's *contents* cross IPC unconverted — `truncatedFields: row.truncated_fields` (`backgroundTaskRosterStore.ts:328`) and `truncatedFields: snapshot.truncatedFields` (`:351`) both hand the array over by reference, and only the *field* was camelCased at the boundary. So the panel holds `task.taskType` but must match the string **`task_type`**. `truncatedFields.includes('taskType')` compiles, type-checks, never matches, and fails no existing test.

Pin the two strings as named module-private constants so the pairing is stated once, at the only place it can be got wrong:

```ts
const CUT_FIELD_DESCRIPTION = 'description'   // wire name === held name here — coincidence, not a rule
const CUT_FIELD_TASK_TYPE = 'task_type'       // held as `taskType`; the WIRE name is what the list carries
```

**The predicate** — module-private, one expression:

```ts
function wasCut(truncatedFields: readonly string[] | null, wireFieldName: string): boolean
```

`true` exactly when the list is non-null and contains that wire name. `null` → `false`, `[]` → `false`, an unrecognised name → `false`, all without a branch of their own (AC4 and AC5 come out free). **It must not be exported and must not be tested directly**: a unit test of the predicate passes whatever name it is handed and would stay green while the call site passes `'taskType'`. The trap lives at the call site, so the test must too — see *Testing strategy*.

**Do not switch exhaustively over field names.** The vocabulary is open: the daemon may ship a name this panel has never heard of, and a `switch` with a `default: throw`, an `assertNever`, or a closed union type would turn a valid future frame into a crash or a blank panel. `includes` over an open list is the whole mechanism.

**Row markup** — each marker goes **immediately after the field it describes**, so position carries the attribution:

```tsx
<li key={task.taskId} className="background-task-panel__row">
  <span className="background-task-panel__description">{task.description}</span>
  {wasCut(task.truncatedFields, CUT_FIELD_DESCRIPTION) && (
    <span className="background-task-panel__cut-description">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
  )}
  <span className="background-task-panel__type">{task.taskType}</span>
  {wasCut(task.truncatedFields, CUT_FIELD_TASK_TYPE) && (
    <span className="background-task-panel__cut-type">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
  )}
</li>
```

**One copy constant, two distinct classes.** The sentence is the same in both places; the classes differ so a test can prove *which* field was marked and so #580 can style them apart. Same reasoning that gave the shell `__unobserved` / `__empty` two classes rather than one.

**Class names are chosen for substring safety** — `background-task-panel__cut-description` does **not** contain `background-task-panel__description`, and `background-task-panel__cut-type` does not contain `background-task-panel__type`. (The reverse naming, `__description-cut`, would have made every count-and-absence assertion on the field classes ambiguous. Same check the shell ran on `status-sheet-title`.) They *do* share the prefix `background-task-panel__cut-`, which is deliberate: one absence assertion covers both markers.

**The marker is a sibling element, never concatenated into the field.** `<span className="__description">{task.description}{cut && ' (truncated)'}</span>` would fuse client copy and daemon text into one text node, so a description ending in the same words would be indistinguishable from the app's own claim. Separate element, own class.

### Copy

Additions to the existing client-owned block (`BackgroundTaskPanel.tsx:38-49`), every literal apostrophe-free:

| name | value |
|---|---|
| `BACKGROUND_TASK_PANEL_CUT_COPY` | `Truncated by the daemon` |
| `partialListCopy(n)` | `Partial list (${n} not shown)` |

Neither is ever a daemon string. `Truncated by the daemon` deliberately echoes `UNRECOGNIZED_TRUNCATED_COPY`'s vocabulary (`ConversationScreen.tsx:500`) so the app says the same thing the same way about the same daemon behaviour.

### CSS

Append to the `.background-task-panel__*` block (`conversation.css:2155-2235`), token-only, no literals:

- `.background-task-panel__partial` — muted body-small (the `.unrecognized-row__truncated` declaration set, `:2142-2149`) plus `margin: 0` and `padding: var(--space-3) var(--space-4)` so it aligns with the rows and the branch copy beneath it.
- `.background-task-panel__cut-description, .background-task-panel__cut-type` — one rule for both: the same muted body-small token set, no padding (the row already provides it). The row is `flex-direction: column`, so each marker lands on its own line under its field with no positional CSS.

**Neither is an error state** and neither takes an error colour — the daemon reporting its own bounds honestly is not a failure. Same rule the two non-populated readings carry.

### What must NOT change

- The three-way branch, its order, its two classes, and its two copy constants. The notice goes *above* it; nothing inside it moves.
- The `entry` prop type, the container, the store, the bridge, `ConversationScreen.tsx`, the wire types.
- The row's field set: still exactly `description` and `taskType`. **No `truncatedFields` element reaches the markup** — the names are daemon-supplied strings, matched and never displayed. A `truncatedFields.join(', ')` display is the obvious first design and is forbidden on two counts: it renders daemon strings, and it breaks the shipped sentinel test at `BackgroundTaskPanel.test.tsx:75-99`.
- No `id` / `aria-describedby` pair built from `taskId` to associate a marker with its field. `taskId` is a daemon string; it is a React `key` (never rendered) and must not become a rendered attribute. Adjacency is the association.
- No cross-check of `truncatedFields` against the text. The list reports the **cap cut only** — the daemon also scrubs invalid UTF-8 by deletion, so a string may differ from claude's bytes without appearing in the list. Report what the daemon reports; never infer a cut from the text, and never infer the text is whole from an absent name.

## State + concurrency model

Unchanged from the shell, and nothing is added. No new store slice, no new subscription, no effect, no async work, no IPC, no `window.pyry`. Both new displays are pure functions of the `entry` prop already passed in.

Re-render correctness is unaffected: the container still hands `selectRosterFor`'s held entry straight through, and nothing here wraps, copies, or derives from it in a way that would break the `Object.is` identity the selector's docstring depends on (`backgroundTaskRosterStore.ts:415-418`). `wasCut` allocates nothing; `partialListCopy` builds a string from a number.

## Error handling

There are no failure modes to surface. No I/O, no parsing, no dispatch. The two new displays are *readings*, not error paths:

- A capped roster is the daemon working as designed, reported honestly.
- A cut string likewise. Neither is styled or worded as an error.
- `truncatedFields: []` and an unrecognised field name are **valid values, not errors** (AC4, AC5) — they produce no marker, no log line, and no thrown anything.

**No log line on any branch**, including the tempting "unrecognised truncated field name" diagnostic. That is precisely where daemon-influenced content would first reach a file (ADR 0007 / #126), and the field names are daemon-supplied strings. The store's setters are silent for the same reason (`:279-280`).

## Testing strategy

`npm test` (vitest, `node` env) + `npm run typecheck`. Renderer tests are `renderToStaticMarkup` + string assertions — no DOM, no clicks, no effects — so **every AC binds to the pure exported `BackgroundTaskPanelView`**, using the shipped `task(overrides)` / `entry(tasks, droppedTasks)` helpers unchanged.

### One shipped test must be revised

`BackgroundTaskPanel.test.tsx:75-99` — *"renders no task field beyond description and taskType (AC3)"* — passes `droppedTasks: 987654` (`:89`) and asserts `expect(markup).not.toContain('987654')` (`:98`). **That assertion becomes false under AC1** and will fail. The shell's own comment at `:78` anticipates it ("droppedTasks (#582) … are the successors' seams").

Fix: change that fixture's `droppedTasks` to `0` and **delete the `987654` assertion line**, leaving the test purely about *task* fields, which is what its name claims. Do not flip it to a positive assertion — AC1's own test owns the count. The four `SENTINEL*` assertions stay exactly as they are: `SENTINELTASKCUT` is an unrecognised field name, so it must still render no marker and must still never appear in the markup, which makes that test a live AC5 guard as well.

No other shipped test changes. `ConversationScreen.test.tsx` is untouched — the panel is closed at first paint there.

### New scenarios in `BackgroundTaskPanel.test.tsx`

1. **The notice shows the count and the list stays (AC1)** — `entry([task()], 3)`. Contains `background-task-panel__partial`, contains the exact string `Partial list (3 not shown)`, and still contains `background-task-panel__row`.
2. **The notice reads on `droppedTasks` alone (AC1, the scope clause)** — three renders, one per branch:
   - `entry([task()], 3)` → notice present alongside rows.
   - `entry([], 3)` → notice present **alongside** `background-task-panel__empty`. This is the case the shipped branch order made ambiguous; it is the reason the notice sits outside the ternary and it is the test that pins it there.
   - `entry={null}` → **no** notice (there is no entry, so no count).
3. **`droppedTasks: 0` renders no notice (AC2)** — `entry([task()], 0)`. Three assertions, each catching a different way of getting it wrong:
   - no `background-task-panel__partial` — the notice is absent;
   - no `not shown` substring — catches a notice rendered under some other class;
   - no `status-sheet__body">0` — catches the `{entry.droppedTasks && …}` truthiness form, which renders a bare `0` as the body's first text node. This anchors on the shipped body div's opening tag, so it is precise rather than brittle. (Do **not** assert `not.toContain('0')`: the inline SVG's `viewBox="0 0 24 24"` and its path data are full of digits.)
4. **A named renderable field is marked (AC3)** — two renders: `truncatedFields: ['description']` → contains `background-task-panel__cut-description` and the cut copy, does **not** contain `background-task-panel__cut-type`; `truncatedFields: ['task_type']` → the mirror. Then a third with `['description', 'task_type']` → both classes present.
5. **The wire-name trap (AC3, the technical note as a test)** — `truncatedFields: ['taskType']`, the camelCase *held* name. Assert **no** `background-task-panel__cut-` anywhere, and that `taskType` does not appear in the markup as text. This test is the whole reason `wasCut` is not tested directly: it fails if the call site is written against the held name, which a predicate-level test cannot detect.
6. **`null` and `[]` both render no marker and neither is an error (AC4)** — two renders, `truncatedFields: null` and `truncatedFields: []`. Both contain `background-task-panel__row` and neither contains `background-task-panel__cut-`. Distinct renders, not one parametrised assertion — the point is that the two values are not collapsed.
7. **An unsurfaced or future name is inert (AC5)** — `truncatedFields: ['task_id', 'tool_call_id', 'SENTINELFUTUREFIELD']`. No `background-task-panel__cut-` anywhere, `SENTINELFUTUREFIELD` absent from the markup (the never-display guard), and the row renders normally. Nothing throws.
8. **Marked untrusted text stays inert (security regression)** — a task with a hostile `description` (`'<img src=x onerror="alert(1)">'`) **and** `truncatedFields: ['description']`, in an entry with `droppedTasks: 2`, so the marker and the notice are both live. Assert the escaped form is present, `'<img'` is absent, and the shell's whole-markup structural guards still hold: no `href="`, no `src="`, no `/\son[a-z]+="/`. **Do not** assert bare-substring absences like `not.toContain('src=')` or `not.toContain('javascript:')` — React escapes markup metacharacters, not arbitrary text, so those fail on a *correct* render (the standing lesson, and the shell's own test comment at `:146-154` explains it).

## Scope check

| Red line | Count | Verdict |
|---|---|---|
| New files (> 3) | **0** | ✅ |
| Production `.ts/.tsx` files new+modified (≥ 5 → split) | **1** (`BackgroundTaskPanel.tsx`) | ✅ |
| Total written LOC (> ~600) | ~240 projected (see below) | ✅ |
| New exported types/components (> 5) | **0** — both additions are module-private | ✅ |
| Consumer call sites needing simultaneous update (> 10) | **0** — no prop, type, or signature change; the `entry` prop already carries both fields | ✅ |
| Acceptance criteria (> 5) | 5 | ✅ |
| Reject / error branches in a state machine (≥ 10) | 0 — two display conditionals, no state machine, no reject paths, no per-branch logging | ✅ |

**LOC projection, measured against the shipped predecessor.** #581 shipped at ~490 total (173 prod + 159 test + 51 `ConversationScreen` + 23 its test + 84 CSS). This slice adds no file, no chrome, no container, no wiring, no trigger: ~60 production (2 constants, a 1-line predicate, a 1-line copy composer, one notice element, two marker elements, comments) + ~20 CSS + ~150 test (7 new scenarios plus the one revision). **~230–250 total.** Roughly half the predecessor, for a strictly smaller surface. S is comfortable; it is not split-shaped on any axis.

**File-overlap check (2026-08-19):** `git fetch origin --prune`, then every `origin/feature/<N>` branch's diff against `main` scanned for `BackgroundTaskPanel.tsx`, `BackgroundTaskPanel.test.tsx`, `ConversationScreen.tsx`, and `conversation.css` — **12 branches, zero overlaps**. No blocker set.

## Open questions

1. **Visual weight of the two markers.** Interim styling gives both the same muted body-small treatment as `.background-task-panel__type`, so a marker under a description sits in the same visual register as a task type. It reads correctly because it is a sentence, but #580 may want a glyph (the `unrecognized-row__glyph` ⚠ idiom) or a distinct treatment. Deliberately not invented here.
2. **Whether the notice should also state the true roster size** (`tasks.size + droppedTasks`). Out here — the AC asks only for the dropped count, and a derived total is a second number to keep honest. Raise with #580 if the design wants it.
3. **`latestUpdate.truncatedFields`** — #583's, deliberately. It names a different vocabulary (`task_id` / `patch`) and must not be flattened into this list.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** *No findings.* This slice crosses no boundary. The daemon frames were decoded and validated upstream (#564/#565/#566) and written to the store by `backgroundTaskRosterBridge`; the panel is a pure reader of renderer state and this ticket adds no parse, no decode, no IPC, and no new source of data. What it does add is a **new class of untrusted value being consulted**: `truncatedFields`, whose elements are daemon-supplied strings. The spec pins the only safe disposition — *matched, never displayed* — in *Row markup*, *What must NOT change*, and test 7's `SENTINELFUTUREFIELD` guard. `droppedTasks` is a `number` and inert.
- **[Injection / HTML sink]** *No findings — the category that matters here, and the one the ticket's SECURITY note is about.* The risk this slice uniquely introduces is that a "mark this text as cut" feature invites **reprocessing the text**: slicing it, appending an ellipsis, re-joining it, or moving it into a `title=` tooltip. The spec forbids all of it — the marker is a **separate sibling element holding a client-owned constant**, and the daemon text is not read, measured, sliced, or concatenated to produce it. `description` and `taskType` remain exactly what the shell renders: auto-escaped React children, one field per element. No `dangerouslySetInnerHTML`, no attribute placement, no `href`/`src`, no `key` derived from a field. Test 8 renders a hostile description *with its marker live* and re-asserts the shell's whole-markup structural guards, so the marker path is covered by the same net rather than by a narrower one.
- **[Field names as an injection vector]** *No findings — addressed explicitly.* `truncatedFields` elements are attacker-influenceable strings arriving in a list. The obvious design — render the list of cut field names — would put daemon strings in the markup; the spec forbids it, the shipped sentinel test at `:75-99` already fails on it, and test 7 adds a second guard. The matching itself (`Array.prototype.includes` against two module constants) evaluates nothing, builds no selector, no regex, no property access, and no dynamic key: `wasCut` cannot be turned into a prototype-pollution or dynamic-lookup gadget because the daemon string is the *needle*, never the *index*.
- **[Denial of service / unbounded work]** *No findings.* `truncatedFields` is read twice per row with `includes`, over a list the daemon caps; the roster itself is capped at 8 rows upstream (`maxTaskRosterEntries`) and the 65519-byte envelope bounds the frame. Nothing here iterates the list, sorts it, joins it, or scales super-linearly with it. `droppedTasks` is rendered, never used as a loop bound or an array length — a hostile `droppedTasks: 2**53` prints a long number and allocates nothing.
- **[Tokens, secrets, credentials]** *Not applicable — by construction.* No token, key, or credential is in scope. **No new storage of any kind**, in particular no web storage — the store's header (`:53-55`) names web storage as the thing that would survive the `connected`-edge `resetRosters` and let a *previous pairing's* command lines and cut reports reappear. This slice persists nothing, so that invariant holds without new code.
- **[File / storage operations]** *Not applicable.* No filesystem access, no path handling. A `description` may look like a path or a command line; it is rendered whole and opaque and is never resolved, split, basenamed, or joined — and, new to this slice, is never sliced to produce the marker either.
- **[Inter-process / Electron attack surface]** *No findings.* Renderer-only and additive: no new `contextBridge` API, no new `ipcMain` channel, no `window.pyry` dereference anywhere in the panel, no navigation, no `window.open`, no remote content. `webPreferences` untouched. The slice adds no capability and no privileged reference.
- **[Cryptographic primitives]** *Not applicable.* No randomness, no hashing, no key material. The one comparison this slice adds is a **string membership test against a non-secret constant** (`includes(CUT_FIELD_TASK_TYPE)`), which is not a secret compare — `timingSafeEqual` is not indicated and would be cargo-culting. Nothing here is a security decision derived from an attacker-controlled value: a wrong match shows or hides a client-owned sentence and grants nothing.
- **[Network & I/O]** *Not applicable.* No socket, no frame sent, no fetch. Inbound caps are enforced upstream and already shipped; this slice inherits them and adds no unbounded read.
- **[Error messages, logs, telemetry]** *No findings — and a MUST-NOT is pinned.* *Error handling* forbids a log line on any branch, naming the specific temptation this slice creates: an "unrecognised truncated field name" diagnostic. That would write a daemon-supplied, attacker-influenceable string to a file (ADR 0007 / #126). No error text renders a daemon string either — both new copies are client-owned constants, and the notice interpolates a number.
- **[Concurrency]** *No findings.* The slice adds no async resource: no effect, no listener, no timer, no promise, no store write. It is two conditionals inside an existing pure render. The Escape listener's lifecycle is the shell's and is unchanged. No check-then-act, because there is no write path.
- **[Threat model alignment]** *Addressed.* **Hostile / compromised daemon or model-influenced content** is the live threat and is the subject of the three findings above; the design treats the task text *and now the field names* as hostile, and treats the cut report as a claim to display rather than a fact to act on (`truncatedFields` is never cross-checked against the text, in either direction). **Malicious relay** cannot reach this component without passing the Noise session and the transport's decode — out of scope for a pure renderer reader. **Renderer compromise reaching the transport** is unchanged: no new capability, no new IPC surface. **Stale-list-presented-as-live after reconnect** remains real, named, and **out of scope — owned by #569** (it needs a daemon-side change); this slice must not paper over it, and in particular the partial-list notice is **not** a place to hint at staleness, which would be a synthesised claim the wire does not support.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
