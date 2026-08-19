# #583 — Background-task panel: show the latest change claude reported about a task

**Size:** S (held — see *Scope check*)
**Labels:** `size:s`, `security-sensitive`
**Split from:** #568. Predecessors: **#581** (the panel shell, `4d1d973`, PR #584) and **#582** (the two truncation reports, `0f410a8`, PR #585). Visual design: **#580** (open, Inbox).

## Design source

N/A — the canonical Figma file `g2HIq2UyPhslEoHRokQmHG` is the **mobile** design and has no counterpart for this surface; the background-task panel is a desktop-only surface (pyrycode#1241). Re-verified against the file for this run: still zero panel nodes. Visual design lands in **#580**, which lists the latest-patch block among the states it must cover and flags that the block has to survive holding a broken fragment.

The interim-visual-vocabulary constraint the two predecessors carry applies unchanged: **no `.status-sheet …` descendant selectors, no positional CSS, no chrome class on the new elements.** Everything added here carries its own `background-task-panel__*` class so #580 can restyle or relayout (possibly as a docked sidebar) without touching the row.

## Files to read first

> Codegraph is **not** initialized for this repo — `codegraph_status` → *"CodeGraph not initialized for this project"*, re-verified for this run. This list was built by direct reading, not by `codegraph_context`.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` (whole, 273 lines) | **The only production file this ticket touches.** The row (`:197-229`) — where the new block appends; `wasCut` (`:101-103`) and the two `CUT_FIELD_*` constants (`:81-82`) — reused as-is; the copy block (`:42-58`); the header comment (`:19-21`), which names this ticket as `latestUpdate`'s reader and **must be updated**; the SECURITY header (`:32-40`), whose obligations this slice inherits. |
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` (whole, 356 lines) | The `task(overrides)` / `entry(tasks, droppedTasks)` helpers (`:17-32`) — every state here is constructible from them unchanged. **`:75-104` is the one shipped test this ticket must revise** (see *Testing strategy*). `:136-163` and `:324-354` are the escaping-guard posture to extend. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:60-97` | **`HeldBackgroundTaskUpdate` — the authority on this field.** `patch` is opaque text, never parsed; `patch: ''` is a value distinct from `latestUpdate: null`; `truncatedFields` here is the **patch's own** cut report naming `task_id` / `patch`; latest-wins, never a history; the SECURITY paragraph. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:99-154` | `HeldBackgroundTask` — `:135-139` in particular: why `latestUpdate` is required-and-nullable and what `null` means, versus a recorded `{ patch: '', … }`. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:360-381` | `setUpdatedTask` — the only writer of `latestUpdate`. Confirms the record is replaced wholesale (never accumulated) and that its `truncatedFields` is assigned straight across with no `??`. |
| `src/shared/wire/types.ts:436-492` | `BackgroundTaskUpdatedPayload` — **where the wire string `patch` comes from** (`:490`), the three reasons the patch must not be parsed (`:450-463`), the empty-patch-is-a-value rule (`:465-466`), the `task_id` / `patch` vocabulary (`:468-472`), the do-not-reconcile rule (`:474-477`), and the SECURITY note (`:479-485`). |
| `src/renderer/src/screens/conversation/conversation.css:2235-2263` | The shipped `#582` truncation block — append here; the marker rule at `:2256-2263` is the one the patch marker joins. `.background-task-panel__row` (`:2190-2195`) is `flex-direction: column`, so each new element becomes its own line for free. `.status-sheet__body` (`:993-997`) is `overflow-y: auto`, so a long patch scrolls rather than overflowing. |
| `docs/specs/architecture/582-background-task-panel-truncation.md` | The predecessor spec. In particular *§ 2* (the wire-name discipline and the sibling-marker rule) and its *Testing strategy* precedent for revising a predecessor's now-false sentinel assertion. |

## Context

A background task can carry the most recent change claude reported about it. The store has held it since #567 as `latestUpdate: HeldBackgroundTaskUpdate | null` — `{ patch: string, truncatedFields: readonly string[] | null }` — and the panel has never read it. `BackgroundTaskPanel.tsx:19-21` names **this ticket** as the reader and says in as many words that the field is deliberately unread. This slice makes it read.

`latestUpdate` is already on the `entry` prop (`entry` is exactly `selectRosterFor`'s return type), so this is the same standing start #582 had: **no prop, type, store, selector, bridge or wire change; no new export; no consumer call site.** Purely additive display inside `BackgroundTaskPanelView`.

Three distinctions the store keeps and the panel must not collapse — all three are ACs:

1. **`latestUpdate: null`** (no update ever matched this task) vs **a recorded `patch: ''`** (claude reported no change). The field always arrives on the wire, so `''` is a value, not an absence.
2. The update's `truncatedFields` is the **patch's own** cut report over a **different vocabulary** (`task_id` / `patch`) from the task's own list (`task_id` / `task_type` / `description`). Two fields, never merged, never read for one another.
3. Latest-wins, one record per task, **never a history**. The daemon's cap is per frame, not per task, so an append-only list keyed by a model-influenced `task_id` and fed by a push stream would be unbounded growth on attacker-influenceable input.

## Design

### What changes

One production file: **`src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx`**. Plus its test file and a CSS append. Nothing else.

### 1. Render the patch as inert text (AC1)

The patch is **opaque text**. Render it as auto-escaped React children in its own element, exactly as `description` is rendered, and do nothing else to it:

```tsx
<span className="background-task-panel__patch">{update.patch}</span>
```

**Do not parse it.** `src/shared/wire/types.ts:450-463` gives three reasons and they all still hold at the render site: it provably may not parse (the daemon truncates at construction, and its own golden fixture is `{"is_backgrounded":tr`, cut mid-token); enumerating a closed key set would silently discard every key claude ships next; and it is untrusted text. **Rendering it as plain text is the answer this ticket wants** — it satisfies AC1 fully and avoids the hazard entirely. Should a future ticket want the keys, that parse sits behind an error branch falling back to inert text and enumerates nothing; it is not this ticket.

**Never `dangerouslySetInnerHTML`, never an attribute** (not even `title=`), never an `href` / `src`, never a React key, never executed or re-shelled. The panel's shipped SECURITY header (`:32-40`) states this for `description`; the patch joins it under the same rule, and the store's own docstring (`:87-93`) is explicit that the constraint is repeated for this field precisely because a patch's structured-looking shape makes it the more tempting thing to feed somewhere structured.

### 2. The three readings of the held field (AC2)

**The branch is on `latestUpdate !== null`, then on `patch === ''` beneath it.** Never a truthiness test on the patch.

`{task.latestUpdate?.patch && …}` — or any truthiness form — renders a recorded empty patch *exactly* as a never-updated task. It compiles, type-checks, and breaks no existing test. This is #582's `{entry.droppedTasks && …}` trap one field over and **quieter**: `droppedTasks` at least printed a visible bare `0`, whereas `''` renders as nothing at all, so the collapse leaves no trace in the markup for a test to catch by accident. It has to be tested for deliberately (test 2 below).

Three readings, three renderings:

| Reading | Rendering |
|---|---|
| `latestUpdate === null` — no update has ever matched this task | **no element at all** |
| `latestUpdate.patch === ''` — claude reported no change | `<span className="background-task-panel__no-change">` holding client-owned copy |
| `latestUpdate.patch !== ''` — a change was reported | `<span className="background-task-panel__patch">` holding the patch |

**Rendering nothing for the never-updated reading is deliberate, and is a deliberate divergence from #581.** The shell gave each non-populated reading its own element *because the branch was the whole panel body*, where `null` would have read as broken. A row has other content — a description and a task type are still there — so absence is legible. What AC2 forbids is the **collapse**, not the absence: the empty-patch reading renders a visible element the never-updated reading does not, so no two readings produce the same markup. Do not invent a third "not updated yet" sentence; it would be a per-row noise line on every task in the ordinary case.

### 3. The patch's own cut marker (AC3)

Reuse the shipped `wasCut` predicate unchanged. Add one constant beside the existing pair:

```ts
const CUT_FIELD_PATCH = 'patch' // wire name === held name here — coincidence, not a rule
```

**There is no casing trap on this list.** The update's vocabulary is `task_id` / `patch`, and the only field this panel could mark is `patch`, whose wire name equals the held property name — the same coincidence `description` enjoys and that `BackgroundTaskPanel.tsx:81` already flags as a coincidence rather than a rule. Keep the comment; the next field added here may not be so lucky.

**The trap available here is the other one, and AC3's scope clause is what pins it.** `wasCut(task.truncatedFields, CUT_FIELD_PATCH)` and `wasCut(update.truncatedFields, CUT_FIELD_DESCRIPTION)` both compile and type-check — both lists are `readonly string[] | null` — and neither ever matches, because neither list names the other's fields. Nothing fails. So the wiring must be:

- the description marker reads **`task.truncatedFields`** only,
- the type marker reads **`task.truncatedFields`** only,
- the patch marker reads **`task.latestUpdate.truncatedFields`** only.

Test 3 asserts both directions of the crossover.

**Marker placement: a sibling of the empty/non-empty ternary, inside the `latestUpdate !== null` guard** — not a child of the non-empty arm. Same reasoning that put #582's partial-list notice outside the three-way branch and that its AC1 scope clause pins: **the cut report is a property of the update record, not of the patch's emptiness.** A recorded `{ patch: '', truncatedFields: ['patch'] }` is daemon-unreachable today (the cap is 4 KiB, so a cut never lands at zero length) but is directly constructible against a pure view, and a marker written inside the non-empty arm would be invisible in exactly that state — leaving the panel claiming "no change reported" while the daemon said it cut the patch. That is presenting an incomplete thing as complete, which is what AC3 forbids. "Unreachable daemon-side" is not an answer for a pure function of its prop.

The marker is a **sibling element holding the shipped client-owned `BACKGROUND_TASK_PANEL_CUT_COPY`**, never text concatenated into the patch span, and **nothing about the patch is read, measured, sliced, re-joined or ellipsized to produce it.** Since the two arms are mutually exclusive and the marker follows whichever rendered, adjacency still carries the attribution — no `id` / `aria-describedby` pair built from `taskId`.

### 4. Row markup (contract sketch)

Appended after the existing task-type marker, at the foot of the `<li>`:

```tsx
{task.latestUpdate !== null && (
  <>
    {task.latestUpdate.patch === '' ? (
      <span className="background-task-panel__no-change">{BACKGROUND_TASK_PANEL_NO_CHANGE_COPY}</span>
    ) : (
      <span className="background-task-panel__patch">{task.latestUpdate.patch}</span>
    )}
    {wasCut(task.latestUpdate.truncatedFields, CUT_FIELD_PATCH) && (
      <span className="background-task-panel__cut-patch">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
    )}
  </>
)}
```

Placed **last** in the row so the identity fields stay at the top and the row remains scannable, and so the description marker keeps sitting immediately after its description. The fragment is needed because two siblings share one guard.

If TypeScript declines to narrow `task.latestUpdate` across the JSX, hoisting `const update = task.latestUpdate` at the top of the map callback is the sanctioned alternative — but the narrowing must still come from **`!== null`**, never from truthiness on `update` or on `update.patch`.

### 5. Nothing is a terminal signal (AC4)

This frame family reports **no terminal event** — `HeldBackgroundTask`'s docstring (`:144-146`) says the wire cannot support one, and absence from a later roster is the only removal path. So:

- no copy in this slice may read as completion, failure, or success;
- no class may name one, and in particular no BEM state modifier (the repo's terminal-state idiom is `--error`: `conversation.css:509` `.tool-row--error`, `:1249` `.log-data__status--error`);
- nothing may be inferred from the patch's *content* — a patch whose text happens to contain `is_backgrounded false` is still just text, and the panel must not read it.

A patch is a change report about something still alive.

### Copy

One addition to the client-owned block (`BackgroundTaskPanel.tsx:42-58`). Every literal apostrophe-free — `renderToStaticMarkup` escapes `'` → `&#x27;`, the standing desktop lesson, which would break the server-render assertions.

| name | value |
|---|---|
| `BACKGROUND_TASK_PANEL_NO_CHANGE_COPY` | `No change reported` |

Never a daemon string. Checked for the traps this file's copy has to clear: it carries no completion/failure vocabulary (AC4); it is not a substring of, and does not contain, any shipped copy constant or class name; and it contains neither `not shown` (`:212`) nor `background-task-panel__empty` (`:113`, `:133`), both of which shipped tests assert the absence of.

### CSS

Append to the `#582` block (`conversation.css:2235-2263`), token-only, no literals:

- `.background-task-panel__patch` — the patch's own line. Mono (it is structured-looking text, like the description) but **muted body-small** rather than the description's on-surface body-medium, so the identity of the task stays the primary line. `min-width: 0` + `overflow-wrap: anywhere` so a 4 KiB unbroken token wraps instead of overflowing the panel. **No height clamp and no `-webkit-line-clamp`**: `.status-sheet__body` already scrolls (`:996`), and clamping is a visual decision #580 owns (see *Open questions*).
- `.background-task-panel__no-change` — the muted body-small set `.background-task-panel__type` wears.
- `.background-task-panel__cut-patch` — **add to the existing marker selector list** at `:2256-2257`; it takes the identical declarations.

**None of the three is an error state and none takes an error colour** — the same rule the readings and the #582 markers carry.

### Class names — the substring check

Run before committing to names, the same check #582 ran when it chose `__cut-description` over `__description-cut`:

- `background-task-panel__patch` is **not** a substring of `background-task-panel__cut-patch` (`…panel__cut-patch` breaks the run), so the pair is independently assertable — the same shape as the shipped description and type pairs.
- `background-task-panel__cut-patch` shares the `background-task-panel__cut-` prefix with both shipped markers, which is deliberate: the four shipped `not.toContain('background-task-panel__cut-')` assertions (`:280`, `:293`, `:299`, `:315`) now cover the patch marker too, for free. All four fixtures carry the default `latestUpdate: null`, so all four stay green.
- `background-task-panel__no-change` is chosen **over `__empty-patch`**, which would contain `background-task-panel__empty` — the shell's "observed, nothing alive" class — and make every present/absent assertion on that class ambiguous.

### What must NOT change

- The three-way entry branch, its order, its classes and its copy; the partial-list notice and its placement; the description and task-type fields and their markers; `wasCut`'s signature and its module-private, not-directly-tested status.
- The `entry` prop type, the container, the store, the bridge, `ConversationScreen.tsx`, the wire types.
- **No `truncatedFields` element reaches the markup**, from either list. The names are daemon strings — matched, never displayed. A `join(', ')` display is the obvious first design and is forbidden on both counts.
- **No cross-check of the patch against its cut report, in either direction.** The list reports the **cap cut only**; the daemon also scrubs invalid UTF-8 by deletion, so the patch may differ from claude's bytes without appearing in the list (`types.ts:474-477`). Report what the daemon reports; never infer a cut from the text, and never infer the text is whole from an absent name.
- **No history.** One record per task, latest-wins. Do not accumulate patches into a list, a ref, or component state.

## State + concurrency model

Unchanged, and nothing is added. No new store slice, no subscription, no effect, no async work, no IPC, no `window.pyry`. The whole addition is one conditional inside an existing pure render, reading a field already on the `entry` prop.

Re-render correctness is unaffected: the container still hands `selectRosterFor`'s held entry straight through, and nothing here wraps, copies, or derives from it in a way that would break the `Object.is` identity the selector's docstring depends on (`backgroundTaskRosterStore.ts:415-418`). `wasCut` allocates nothing; the new block allocates nothing.

## Error handling

There are no failure modes to surface. No I/O, no parsing, no dispatch, no `JSON.parse` (that is the point of *Design § 1*). The new displays are **readings**, not error paths:

- A recorded empty patch is claude reporting no change — normal, not an error, and not styled or worded as one.
- A cut patch is the daemon working as designed and reporting it honestly.
- `truncatedFields: []`, `null`, and an unrecognised name all fall out of `wasCut` as `false` with no branch of their own — valid values, not errors.

**No log line on any branch.** The temptations here are "unmatched update", "unrecognised patch-cut field", and "patch failed to parse" (there is no parse). Each would write daemon-influenced, attacker-influenceable text to a file — the content-free diagnostics rule (ADR 0007 / #126). The store's own setters are silent for exactly this reason (`:366`, `:279-280`).

## Testing strategy

`npm test` (vitest, `node` env) + `npm run typecheck`. Renderer tests are `renderToStaticMarkup` + string assertions — no DOM, no clicks, no effects — so **every AC binds to the pure exported `BackgroundTaskPanelView`**, using the shipped `task(overrides)` / `entry(tasks, droppedTasks)` helpers unchanged. Fixtures stay apostrophe-free.

### One shipped test must be revised

`BackgroundTaskPanel.test.tsx:75-104` — *"renders no task field beyond description and taskType (AC3)"* — renders a fixture carrying `latestUpdate: { patch: 'SENTINELPATCH', truncatedFields: ['SENTINELPATCHCUT'] }` (`:92`) and asserts:

- `:102` `expect(markup).not.toContain('SENTINELPATCH')` — **becomes false the moment AC1 renders the patch.** Delete this line. #582 hit the identical shape with #581's `droppedTasks: 987654` guard and resolved it by deleting the one stale line rather than fighting it.
- `:103` `expect(markup).not.toContain('SENTINELPATCHCUT')` — **stays**, and is now a live AC3 guard: an unrecognised patch-cut name must mark nothing and must never be displayed. Exactly the repurposing `SENTINELTASKCUT` got in #582.

Update the test's title and its `:77` comment — both now claim `latestUpdate` is unread, which stops being true. The title becomes something like *"renders no task field beyond description, taskType and the held patch"*.

**Do not flip `:102` into a positive `toContain('SENTINELPATCH')`.** Two reasons. AC1's own test owns that proof (the #582 precedent). And more sharply: **`SENTINELPATCH` is a prefix substring of `SENTINELPATCHCUT`**, so a `toContain('SENTINELPATCH')` "proof" would also pass on a render that displayed only the forbidden cut-field name — the assertion would be satisfied by exactly the bug the neighbouring line forbids. Any fixture that asserts both a rendered patch and an absent cut-name needs **non-overlapping** values; the AC1 and AC3 tests below use their own.

No other shipped test changes, and the developer should confirm that by running the suite before writing anything new. The audit behind that claim: every other fixture takes `task()`'s default `latestUpdate: null`, so no other test renders a patch; the four `not.toContain('background-task-panel__cut-')` assertions therefore stay green; `:66`'s row count is unaffected (no new class contains `background-task-panel__row`); and `ConversationScreen.test.tsx` is untouched — the panel is closed at first paint there.

### New scenarios in `BackgroundTaskPanel.test.tsx`

Add a `#583` describe block beneath the `#582` one.

1. **A markup-shaped patch renders as inert escaped text (AC1)** — one task with a hostile patch (`'<img src=x onerror="alert(1)">'`, the fixture the file already uses for `description`). Assert the escaped form is present, that `'<img'` is absent so the tag never opens, and that the shell's **whole-markup structural guards** still hold: no `href="`, no `src="`, no `/\son[a-z]+="/`. Extend the existing net rather than writing a narrower one. **Do not** assert bare-substring absences like `not.toContain('src=')` or `not.toContain('javascript:')` — React escapes markup metacharacters, not arbitrary text, so those fail on a *correct* render (the standing lesson; the shell's comment at `:151-159` explains it).
2. **The three readings are distinct (AC2)** — three renders, and this is the test that catches the truthiness collapse:
   - `latestUpdate: null` → **no** `background-task-panel__patch`, **no** `background-task-panel__no-change`; the row still renders with its description and type.
   - `latestUpdate: { patch: '', truncatedFields: null }` → contains `background-task-panel__no-change` and the copy `No change reported`; does **not** contain `background-task-panel__patch`.
   - `latestUpdate: { patch: 'is_backgrounded true', truncatedFields: null }` → contains `background-task-panel__patch` and the patch text; does **not** contain `background-task-panel__no-change`.
   - Plus the collapse guard proper: assert the empty-patch markup **is not equal to** the never-updated markup (the `expect(observedEmpty).not.toBe(unobserved)` idiom at `:125`). Under the truthiness form these two renders are byte-identical, which is the whole failure mode.
3. **The marker reads the update's list only (AC3, the scope clause)** — five renders, using **non-overlapping** fixture values throughout:
   - `latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['patch'] }` → contains `background-task-panel__cut-patch` and the cut copy, and still contains `PATCHTEXT`. (No never-display assertion on the name `patch` itself — it is a substring of the class names, so the assertion is unwritable here; the unrecognised-name bullet below is what carries that guard.)
   - the same but `truncatedFields: null` → contains `background-task-panel__patch`, does **not** contain `background-task-panel__cut-patch`.
   - **crossover A** — `task({ truncatedFields: ['patch'], latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null } })`: the *task's* list names `patch`, which is not in the task's vocabulary. Assert **no** `background-task-panel__cut-` anywhere. Catches `wasCut(task.truncatedFields, CUT_FIELD_PATCH)`.
   - **crossover B** — `task({ truncatedFields: null, latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['description', 'task_type'] } })`: the *update's* list names the task's fields. Assert **no** `background-task-panel__cut-description` and **no** `background-task-panel__cut-type`. This is the sharpest of the five — both names are live `CUT_FIELD_*` constants, so it is exactly what fires if the description or type marker is wired to the update's list.
   - **an unrecognised name in the update's list** — `truncatedFields: ['task_id', 'SENTINELFUTURENAME']` → no marker anywhere, `SENTINELFUTURENAME` absent from the markup, the row and patch still render. The vocabulary is open; an unheard-of name is a valid value, not an error.
4. **Nothing reads as terminal (AC4)** — one populated render with a benign fixture patch carrying no such word (`'is_backgrounded true'`, and the default `npm run build` description). Assert `expect(markup).not.toMatch(/completed|complete|failed|failure|succeeded|success|finished|error/i)` across the whole markup. One regex covers both halves of the AC: a class named `__completed` or a `--error` modifier contains the word, so copy and class names are caught together. `error` is in the set precisely because the repo's terminal-state idiom is a BEM `--error` modifier. The benign fixture is what makes the assertion safe — it is why AC4 specifies one, and why this test must **not** reuse test 1's `onerror` payload.

## Scope check

| Red line | Count | Verdict |
|---|---|---|
| New files (> 3) | **0** | ✅ |
| Production `.ts/.tsx` files new+modified (≥ 5 → split) | **1** (`BackgroundTaskPanel.tsx`) | ✅ |
| Total written LOC (> ~600) | ~230 projected (see below) | ✅ |
| New exported types / components (> 5) | **0** — one module-private constant, one copy constant | ✅ |
| Consumer call sites needing simultaneous update (> 10) | **0** — no prop, type, or signature change; `latestUpdate` is already on the `entry` prop | ✅ |
| Acceptance criteria (> 5) | **4** | ✅ |
| Reject / error branches in a state machine (≥ 10) | **0** — one two-arm display branch and one marker conditional; no state machine, no reject paths, no per-branch logging | ✅ |

**LOC projection, measured against the shipped predecessors.** #581 shipped ~490 total; #582 shipped 343 total across the same file set. This slice is strictly smaller than #582: one reading branch, one field, one marker, one new constant, one new copy string, and it reuses `wasCut` and the cut copy rather than introducing them. ~60 production (constants, the row block, and comments — this file carries a high comment ratio by convention) + ~20 CSS + ~150 test (4 scenarios plus the one revision). **~230.** S is comfortable; it is not split-shaped on any axis.

**File-overlap check (2026-08-19):** `git fetch origin --prune`, then every `origin/feature/<N>` branch's diff against `main` scanned for `BackgroundTaskPanel.tsx`, `BackgroundTaskPanel.test.tsx` and `conversation.css` — **12 branches, zero overlaps.** No blocker set.

## Open questions

1. **Visual weight and height of the patch block.** Interim styling is muted mono body-small, wrapping, unclamped, inside a scrolling body. A 4 KiB patch is therefore a tall row. Clamping it (`-webkit-line-clamp` with a fade, or a max-height) is a real option and is **CSS-only, so it reprocesses no text** — but it is a design decision #580 owns, and #580 already flags that this block must survive holding a broken fragment. Not invented here.
2. **Whether a never-updated task should say so.** This spec renders nothing, on the grounds that the row has other content and a per-row "not updated yet" line would be noise on the ordinary case. If #580's design wants an explicit placeholder, it is a one-line addition — but it must remain a *third* distinct rendering, not a reuse of the empty-patch element.
3. **Reading the patch's keys.** Out of scope and deliberately not designed. If a future ticket wants `is_backgrounded` surfaced structurally, it parses behind an error branch that falls back to this slice's inert text and enumerates no closed key set. Raise it against #580 or a successor, not here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** *No findings, and the boundary is where it was.* This slice crosses none. `BackgroundTaskUpdatedPayload` was decoded and validated upstream (#565) and written to the store by `backgroundTaskRosterBridge`; the panel is a pure reader of renderer state and this ticket adds no decode, no parse, no IPC, and no new data source. What it does add is **a second untrusted string class reaching the markup** — `latestUpdate.patch`, which the store's own header (`:47-51`) classes with `description` as model-influenced text the daemon bounds but does not sanitize, and **a second list of attacker-influenceable field names being consulted**. Both dispositions are pinned: the patch is inert auto-escaped children and nothing else; the names are *matched, never displayed* (*What must NOT change*, plus test 3's `SENTINELFUTURENAME` guard).
- **[Injection / HTML sink]** *No findings — the category this ticket is about, and the one its SECURITY note singles out.* The distinctive risk here is not the same as #582's: a patch **looks structured**, so the tempting failure is to feed it somewhere structured — `JSON.parse` then render the object, or a `<pre>` fed by `innerHTML`, or a key surfaced into an attribute. *Design § 1* forbids the parse outright and gives the wire's own three reasons; the spec renders the patch as auto-escaped React children in a `<span>`, with no `dangerouslySetInnerHTML`, no attribute placement (not even `title=`), no `href`/`src`, and no key derived from it. Test 1 renders a markup-shaped patch and re-asserts the shell's **whole-markup, attribute-shaped** guards (`href="`, `src="`, `/\son[a-z]+="/`) rather than a narrower substring net — deliberately, because React escapes metacharacters and not arbitrary text, so a bare `not.toContain('src=')` fails on a correct render and would be a guard that proves nothing.
- **[Text reprocessing — the marker path]** *No findings, addressed explicitly.* A "mark this as cut" feature invites reprocessing the text it marks: slicing it, appending an ellipsis, re-joining it, or moving it into a tooltip. The marker is a **separate sibling element holding a client-owned constant**, and the patch is not read, measured, sliced, or concatenated to produce it. The CSS reinforces this — the *Open questions* entry on clamping notes that any future shortening must be CSS-only, never a substring operation on daemon text.
- **[Field names as an injection vector]** *No findings.* The update's `truncatedFields` elements are attacker-influenceable strings. The obvious design — displaying the list — would put daemon strings in the markup; it is forbidden in *What must NOT change*, the shipped `:103` assertion already fails on it, and test 3 adds a second guard. The matching itself is `Array.prototype.includes` against a module-scope constant: the daemon string is the **needle, never the index**, so no dynamic property access, selector, or regex is built from it and `wasCut` cannot become a prototype-pollution or dynamic-lookup gadget. `CUT_FIELD_PATCH` is a literal, not derived from input.
- **[Denial of service / unbounded work]** *No findings.* `patch` is capped at 4 KiB by the daemon (`maxTaskPatch`) inside a 65519-byte envelope; the roster is capped at 8 rows upstream. The patch is rendered **whole and once** — no scan, no split, no regex over it, no per-character work, nothing super-linear. Layout is bounded by `overflow-wrap: anywhere` plus the body's existing `overflow-y: auto`, so a single unbroken 4 KiB token wraps and scrolls rather than blowing out the panel. `truncatedFields` is read once per row with `includes`. **The history question is the real DoS shape here and the design refuses it**: latest-wins, one record per task, no accumulation in an array, a ref, or component state — an append-only list keyed by a model-influenced `task_id` and fed by a push stream would be unbounded growth on attacker-influenceable input (the store's `:81-83` reasoning, inherited).
- **[Tokens, secrets, credentials]** *Not applicable — by construction.* No token, key, or credential in scope. **No new storage of any kind, and no web storage in particular** — the store's header (`:53-55`) names web storage as the thing that would survive the `connected`-edge `resetRosters` and let a *previous pairing's* command lines and patches reappear. This slice persists nothing, so the invariant holds with no new code.
- **[File / storage operations]** *Not applicable.* No filesystem access, no path handling. A patch may contain path-shaped or command-shaped text; it is rendered whole and opaque and is never resolved, split, basenamed, joined, or shelled.
- **[Inter-process / Electron attack surface]** *No findings.* Renderer-only and additive: no new `contextBridge` API, no new `ipcMain` channel, no `window.pyry` dereference, no navigation, no `window.open`, no remote content. `webPreferences` untouched. The slice adds no capability and no privileged reference; the transport, keys and handshake stay in the main process, untouched.
- **[Cryptographic primitives]** *Not applicable.* No randomness, no hashing, no key material. The one comparison added is a string-membership test against a **non-secret literal** (`includes('patch')`) — not a secret compare, so `timingSafeEqual` is not indicated and would be cargo-culting. No security decision is derived from an attacker-controlled value: a wrong match shows or hides a client-owned sentence and grants nothing.
- **[Network & I/O]** *Not applicable.* No socket, no frame sent, no fetch. Inbound caps (`maxPayload`, the 4 KiB patch cap, the 8-row roster cap) are enforced upstream and already shipped; this slice inherits them and adds no unbounded read.
- **[Error messages, logs, telemetry]** *No findings — and a MUST-NOT is pinned.* *Error handling* forbids a log line on every branch and names this slice's three specific temptations: "unmatched update", "unrecognised patch-cut field", and "patch failed to parse". Each would write daemon-influenced, attacker-influenceable text — the patch itself, in the third case — to a file (ADR 0007 / #126). No error text renders a daemon string either: the one new copy constant is client-owned and interpolates nothing.
- **[Concurrency]** *No findings.* The slice adds no async resource: no effect, no listener, no timer, no promise, no store write. It is one conditional inside an existing pure render. The Escape listener's lifecycle is the shell's and is unchanged. No check-then-act, because there is no write path.
- **[Threat model alignment]** *Addressed.* **Hostile / compromised daemon or model-influenced content** is the live threat and is the subject of the four findings above; the design treats the patch text *and* the patch's field names as hostile, and treats the cut report as a claim to display rather than a fact to act on — never cross-checked against the patch in either direction, because the daemon's UTF-8 scrub means the two genuinely can disagree (`types.ts:474-477`). **Malicious relay** cannot reach this component without passing the Noise session and the transport decode — out of scope for a pure renderer reader. **Renderer compromise reaching the transport** is unchanged: no new IPC surface, no new capability. **Stale-list-presented-as-live after reconnect** remains real, named, and **out of scope — owned by #569** (it needs a daemon-side change); this slice must not paper over it, and in particular a held patch is not a place to hint at liveness. **Misreading a patch as a terminal signal** is the threat AC4 names: the wire reports no finish, so any completion/failure reading the panel invented would be a claim the protocol cannot support — forbidden in *Design § 5* and guarded by test 4.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
