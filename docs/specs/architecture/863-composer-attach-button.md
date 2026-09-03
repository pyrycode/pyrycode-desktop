# #863 — the attach button in the input footer

The fifth and last control on `.composer__footer`, and the renderer half of the attach flow #862 shipped
headless: an icon button right-aligned past the four menus and the context reading, and — beneath the row —
one line of client-owned copy stating the latest outcome the upload channel delivered.

Split from #685. The flow behind the button is [#862](https://github.com/pyrycode/pyrycode-desktop/issues/862);
its overview is `docs/knowledge/features/attachment-upload.md`.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/shared/ipc/attachmentUpload.ts` | `AttachmentUploadEvent`, `AttachmentUploadFailure` | The whole input surface. Its docblocks carry the two rulings this plan inherits rather than re-derives: content-free by construction, and the two retrieval codes are representable-but-unreachable |
| `src/preload/index.ts` | `requestAttachmentUpload`, `onAttachmentUploadEvent` | The two bridge members — a no-argument fire-and-forget, and an unsubscribe-returning push subscription |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `Composer` | The mount site: the footer row's five children and the composer column they sit in |
| " | `ComposerErrorChip`, `ComposerErrorSlot` | The live-region rulings this plan departs from, and *why* the departure holds; also the `<div>`-not-`<p>` ruling on a UA margin in a hard-height region |
| " | `ContextUsageReading`, `ContextUsageControl` | The pure-view / store-container split and the exact-empty absent arm this outcome view copies |
| " | `ComposerSendButton` | The repo's only other icon-only button: `aria-label` + an `aria-hidden` inline `<svg>` at `fill="currentColor"` |
| `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` | `ComposerActionsMenu` | The two-class-mix trigger (`composer__footer-button composer__actions`) and the glyph idiom |
| `src/renderer/src/screens/conversation/LogDataSection.tsx` | `LogDataView`, `LogDataSection` | The exact precedent for this ticket's shape: pure view + a container whose `useEffect` returns the bridge's own unsubscribe, and a `role="status"` line rendered only when there is something to say |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer`, `.composer__footer`, `.composer__footer-button`, `.composer__actions`, `.composer__context` | The column, the hard-height row, the shared reset to wear, and the `margin-left: auto` the row's comment has reserved for this control since #811 |
| `src/renderer/src/PairedShell.tsx` | `paneKey` | The chat pane is keyed on the conversation id, so `Composer` remounts on a switch — the outcome resets for free, with no clearing effect to get wrong |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` | `ACTIONS_TRIGGER_CLASS_RUN`, the footer describes | The mount-proof idiom and the `getInitialState` spy that makes the context reading appear in a static render |
| `e2e/assistant-link-opens-externally.spec.ts` | the `app.evaluate` stub of `shell.openExternal` | The seam that keeps a native OS dialog out of the fake tier |
| `e2e/composer-options-clamp.spec.ts` | the footer locators | How a footer-level element is located, and the anchor geometry this ticket must not disturb |
| `docs/knowledge/features/attachment-upload.md` | § Composition root, § Error handling | The `pickerOpen` dialog guard (why no disabled state), and the one-terminal-or-none contract |

Codegraph is **not initialized in this worktree** (`codegraph_context` answers "CodeGraph not initialized for
this project"), so the reading list above was built with grep and Read. Recorded as a gap, not worked around.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3654

Node `115:3654` ("Attachment") is an 11 × 12 frame (10.9989 × 11.9678) holding a single vector `115:3655` —
a paperclip glyph, one closed path, no fill rule and no stroke. Its export fill is `#9DCBFC`, byte-identical
to `--color-primary` in `tokens.css`, so an `<svg fill="currentColor">` inheriting the token off the button is
the correct translation (unlike the Actions chevron, whose export carried the *light* scheme's `#32628D`). It
sits at x=714, y=4 in the 741-wide footer `110:3494` — 714 + 11 = 725, exactly the right edge of the content
box under the row's 16px inset — and it is a **sibling** of the `Info and buttons` group `115:3660`, not a
member of it, which is what makes it right-aligned rather than the next item in the group's 20px rhythm.

**The outcome surface has no Figma node.** `110:3494` holds only that group and this icon. The criteria bound
the outcome by behaviour and layout constraint instead, and this plan chooses the element; a visual treatment
is a Figma-side ticket, ideally one settling this surface and #864's progress indicator together.

## Context

#862 landed the attach flow with nothing on screen: `requestAttachmentUpload` and `onAttachmentUploadEvent`
sit on `window.pyry` with no caller and no consumer. This slice wires both and closes the family's
user-facing loop.

Three facts from that flow are load-bearing and are inherited rather than re-argued:

- **Every field on `AttachmentUploadEvent` is client-owned by construction.** No member can hold the file's
  bytes, its host path, or its name; `reason` is a literal written in this repo and `limitBytes` is a
  client-owned constant. The copy this slice renders is therefore a **selection over a sealed union** — there
  is no daemon string, so no escaping obligation, no length bound and no truncation chain to design.
- **The renderer cannot correlate a click to an outcome.** `requestAttachmentUpload()` returns `void`, so the
  window never learns the `uploadId` its click minted, and the main-side guard is scoped to the *dialog*, not
  the transfer — two transfers with distinct ids can be live at once. So the composer states the **latest
  outcome to arrive**, which is the only rule the bridge supports.
- **The button needs no disabled or in-flight state.** `pickerOpen` in the composition root already drops a
  second intent while a picker is open, so a double click is handled below the bridge. Drawing an in-flight
  state here would pre-empt #864 and be exactly the placeholder #811 forbade.

No ADR is owed. The state choice is ADR 0006 applied as written (see below); the copy map introduces no new
architectural rule. Nothing here changes a wire type, a store, or an IPC contract.

**Size, re-counted against this written plan.** Five of the six size-S lines hold with room: **3** production
`.ts`/`.tsx` files against 5 (two new, plus `ConversationScreen.tsx`), **0** new exported types and 2 new
components against 5, **0** consumer call sites against 10, **5** acceptance criteria against 5, and **0**
state-machine reject branches — the failure copy is a lookup over a sealed union, not a machine. The
total-written-work line is **exceeded deliberately and stated**, at roughly 1150 lines including this plan, the
CSS and the e2e spec: the ticket's own estimate line records that all five shipped siblings on this row landed
over it (854 / 854 / 1137 / 1143 / 1515 measured from their merge commits) with none needing a resume leg. The
floor rule also binds here — splitting the button from its outcome would ship a control whose every effect is
invisible, since a stored file, a refusal and a cancelled picker all look identical until #815 lands.

## Design

Three production files: two new, one edited. No new dependency, no new store, no new IPC channel.

### 1. `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` — new, pure

The whole copy decision, with no React and no bridge, so the third acceptance criterion is provable by calling
a function.

```ts
export const ATTACHMENT_UPLOAD_FAILURE_COPY: Record<AttachmentUploadFailure, string>
export function attachmentUploadOutcomeCopy(event: AttachmentUploadEvent): string
export function formatByteLimit(bytes: number): string   // module-internal helper, exported for its own tests
```

- `attachmentUploadOutcomeCopy` switches on `event.type` with an explicit return type and **no `default`**, so a
  fourth member (#864's progress) trips TS2366 rather than falling through — the `relayLeg` / `daemonLeg`
  discipline one file over.
- `refused` is the only arm that composes: its sentence names the limit through `formatByteLimit(limitBytes)`.
  It reads the event's own field and never a constant of its own, so the copy cannot drift from the bound the
  main side actually enforced. **The sentence names the limit as this app's own**, never the host's: the union's
  docblock is explicit that a file under this bound can still come back `attachment-too-large`, so wording it as
  the daemon's limit would state a fact the client does not have (§ Security review, finding 2).
- `failed` is a **lookup** keyed on `event.reason`. The declaration is
  `Record<AttachmentUploadFailure, string>`, which is what makes the third criterion compiler-forced: a member
  added upstream fails to typecheck here rather than silently rendering blank. **No count of the union is
  written anywhere** — in code, in a comment, or in a test.
- **The runtime lookup goes through a `Map` derived from that `Record`, not through the object literal**
  (§ Security review, finding 1). `Object.entries` is prototype-safe, and a `Map` `get` cannot reach
  `Object.prototype` — so a `reason` of `'constructor'` or `'toString'` returns `undefined` rather than a
  function that `??` will not fall through and that React then throws on. The `Record` keeps the compiler-forced
  exhaustiveness; the `Map` makes the runtime read total. Two different fabrics: a type check and a data
  structure. This is #862's own mime-table reasoning ("a `Map` rather than an object literal so a lookup key can
  never reach `Object.prototype`") applied one process over, in the read direction.
- **No arm interpolates `event.reason` into the sentence.** `` `Upload failed: ${reason}` `` would compile, read
  fine, and make the rendered string *daemon-selected* rather than client-authored. The exact-equality test
  against the mapped constant is what forbids it.
- `attachment-not-found` and `attachment-stream-aborted` map to **one shared non-committal sentence**, per the
  shipped docblock's ruling that no composer copy should be written for them while they stay representable
  because a hostile daemon can correlate either code to a pending chunk.
- `formatByteLimit` picks the largest unit at which the value reaches 1 (MB, then kB, then bare bytes) and
  prints at most one decimal. Decimal units, not binary: the figure is user-facing and macOS states file sizes
  the same way. The unit chain exists so the function cannot print `0 MB` for a small bound — the current bound
  is ~23 MB, but the function must not lie for a value it may be handed later.

### 2. `src/renderer/src/screens/conversation/ComposerAttach.tsx` — new

Two pure views and one thin container hook, the `LogDataSection` split.

```tsx
export const COMPOSER_ATTACH_LABEL = 'Attach file'
export function ComposerAttachButton({ onAttach }: { onAttach: () => void }): JSX.Element
export function ComposerAttachOutcome({ outcome }: { outcome: AttachmentUploadEvent | null }): JSX.Element | null
export function useAttachmentUpload(): { outcome: AttachmentUploadEvent | null; requestAttach: () => void }
```

- **`ComposerAttachButton`** — a `<button type="button">` wearing `class="composer__footer-button composer__attach"`
  with `aria-label={COMPOSER_ATTACH_LABEL}`, holding one `aria-hidden` inline `<svg fill="currentColor">` whose
  single `<path>` is node `115:3655`'s. An `aria-label` is correct here and prohibited on the chip one component
  over: `<button>` is not on ARIA's name-prohibited list, and `.composer__send` already names itself this way.
  The Figma clip-path is dropped — its rect is the full viewBox, so it clips nothing.
- **`ComposerAttachOutcome`** — `null` when there is no outcome, and a `<div className="composer__attach-outcome"
  role="status">` holding `attachmentUploadOutcomeCopy(outcome)` when there is. `null`, not an empty element, is
  the fifth criterion's second half.
  - **A `<div>`, not a `<p>`.** This repo ships no margin reset, and the element is a flex item in the composer
    column — `ComposerErrorChip`'s ruling verbatim, for the same layout reason.
  - **It *is* a live region, departing from its two neighbours, and the departure is the point.** Both
    `ComposerErrorChip` and `ContextUsageReading` decline one because something else already announces the fact
    (#279's banner) or because the cadence is every turn. Neither holds here: this line is the **only** evidence
    an upload produced anything until #815 lands, it appears asynchronously after an operator gesture, and it
    fires at most once per attach. `role="status"` is polite — announced without stealing focus —
    `LogDataSection`'s exact idiom for an operator-initiated outcome, and not `role="alert"`, which would also
    collide with `permission-modal-answer-paths.spec.ts`'s bare `getByRole('alert')`.
- **`useAttachmentUpload`** — `useState<AttachmentUploadEvent | null>(null)` plus a `useEffect` that returns the
  bridge's own unsubscribe handle as its cleanup, `[]` deps. `requestAttach` clears the held outcome and *then*
  sends the intent, which is the fourth criterion in one line: a cancelled pick reports nothing, so the clear
  must happen on the click rather than on an event that may never come.
  - `window.pyry` is dereferenced **only** inside the effect and inside `requestAttach` — never during render —
    so every static render of the composer still touches no bridge (`Composer.handleSubmit`'s standing rule).

### 3. `src/renderer/src/screens/conversation/ConversationScreen.tsx` — edited

`Composer` calls `useAttachmentUpload()` once and gains two children: `<ComposerAttachButton>` as the footer
row's sixth and last child, and `<ComposerAttachOutcome>` as the composer column's third and last child,
beneath the row. The JSX comment above the footer is corrected where it still says *"#685 attach remains
blocked on daemon work that does not exist"* — the one sentence #862 falsified, in the block being edited. No
other comment is hunted down.

**The state lives in `Composer`, not in a store, and this plan confirms ADR 0006's reading against the one
wrinkle the ADR does not cover.** The ADR's rationale rests on the pairing screen having no display-lifetime
subscription; this state has one. It still stays component-scoped: the subscription is a single `useEffect`
feeding one nullable value that nothing outside the composer reads, its cleanup is the bridge's own unsubscribe
handle, and the reset-on-remount the ticket asks for comes free — `PairedShellView` keys the chat pane on the
conversation id, so a switch destroys and rebuilds `Composer` with a fresh `null`. A store plus its bridge would
add a module singleton that must then be *explicitly* cleared on conversation switch and on unpair — more code
and one more clearing arm to get wrong, for no reader outside this component.

**Why the outcome is not inside `.composer__footer`.** The row has a hard `height: 20px`; a sentence in it would
overflow rather than grow it. Four shipped e2e specs also assert `.composer__footer [role="alert"]` has count 0,
and a live region inside the row invites exactly that collision. The status row's trailing slot is ruled out by
the ticket (owned by `ComposerErrorSlotControl`, and `.composer-status` is `min-height: 24px` sized by that
occupant). The composer column's own foot is what is left, and it is also the closest surface to the button.

### 4. `conversation.css` — edited

Two rules, written beside `.composer__actions` / `.composer__permission`.

- `.composer__attach` — the operable half only, worn as a two-class mix with `.composer__footer-button`, which
  is #963's `.button-small` shape and the idiom every other footer control already wears. **The shared class
  fits and is worn:** its reset (padding, border, background off), its `display: flex` / `align-items: center`
  and its `color: var(--color-primary)` are exactly what an icon-only button needs; its type block and its
  `gap` are inert for a button with no label, which is harmless and consistent with the rule's own note that it
  is "named for the row rather than for either consumer". This rule adds `margin-left: auto` (the
  right-alignment the row's comment has named since #811), `cursor: pointer` (the shared class deliberately
  omits it) and `flex: 0 0 auto` (the `.composer__actions-icon` reason — the row must not squeeze the glyph).
  **No shipped element is re-classed.**
- `.composer__attach-outcome` — body-small in `--color-primary`, the `.composer__context` treatment, with no
  height and no `min-height` so it occupies space only while it is rendered. It does **not** get
  `white-space: nowrap`: it is a sentence rather than a 13-character reading, it is not in a hard-height row,
  and wrapping is the correct behaviour for it.

## State + concurrency model

| Concern | Answer |
|---|---|
| Store slices touched | **None.** No Zustand store is read or written by this slice |
| Held state | One `useState<AttachmentUploadEvent \| null>` in `Composer`, via `useAttachmentUpload` |
| Subscription | One `window.pyry.onAttachmentUploadEvent` per `Composer` mount |
| Cancellation / teardown | The `useEffect` returns the bridge's unsubscribe handle directly, so a remount nets exactly one live listener — the `LogDataSection` / `daemonEventBridge` idiom |
| Reset | Free on conversation switch (`paneKey` remount) and explicit on each new attach (`requestAttach` clears first) |
| Async work owned here | None. No promise, no timer, no `AbortController` — the bridge push is the only inbound edge |
| Two concurrent uploads | Latest-wins by construction: the listener assigns, it does not merge or queue. `uploadId` is deliberately unread — the renderer cannot correlate it to a click, so reading it could only invite a correlation that does not exist |
| Re-render cost | An outcome arriving re-renders `Composer` (textarea included) at most once per attach. Acceptable, and unlike `ContextUsageControl` — extracted to its own container precisely because its figure ticks every turn — this one does not tick |

## Error handling

There is no failure path this slice can *introduce*: it makes no I/O call, parses nothing, and returns no
result type. What it does is **render** the failure vocabulary the channel already delivers.

| Inbound | Rendered |
|---|---|
| `refused` (`reason: 'too-large'`) | A sentence naming the limit, formatted from the event's own `limitBytes` |
| `failed` | `ATTACHMENT_UPLOAD_FAILURE_COPY[reason]` — a compiler-forced exhaustive lookup, no arm blank |
| `failed`, either retrieval-leg code | One shared non-committal sentence, per the union's shipped ruling |
| `completed` | An acknowledgement, so a stored file is distinguishable from a cancelled picker before #815 lands |
| Nothing at all (cancelled picker) | Nothing. The previous outcome was already cleared on the click |
| A malformed value that satisfies no arm | Unreachable through the bridge's declared type; `attachmentUploadOutcomeCopy`'s `default`-free switch is what makes a *future* member a compile error rather than a blank line |

`requestAttach` is fire-and-forget with no reply and nothing to catch: `ipcRenderer.send` does not throw for a
registered channel, and the main side's two entry functions never reject (#862's overview § Error handling).

## Testing strategy

**vitest — `attachmentUploadCopy.test.ts`** (pure, no render):

- Every value in `ATTACHMENT_UPLOAD_FAILURE_COPY` is a non-empty, non-whitespace string — walked over
  `Object.values`, which enumerates the *actual* union because the `Record` literal is compiler-forced to be
  complete. **No count and no restated member list**, either of which would go stale silently the next time the
  union grows.
- The two retrieval-leg codes map to the same string as each other, and to a string no other member uses.
- A `failed` whose `reason` is `'constructor'`, `'__proto__'` or `'toString'` — values the declared type forbids
  and a non-conforming sender could still put on the wire — renders a non-empty client-owned string, never a
  function and never `[object Object]`. The `Map` indirection is what this proves; against the object literal it
  reddens (§ Security review, finding 1). Cast at the call site, the one place the type is deliberately lied to.
- `refused` names the limit it was handed, and a different `limitBytes` produces a different sentence — so the
  figure is read from the event rather than baked in.
- `completed` returns a non-empty acknowledgement.
- A representative `failed` reason round-trips to its mapped string exactly (equality, not `toContain`).
- `formatByteLimit`: MB, kB and bare-bytes arms; the current bound reads as a sane MB figure; a small value
  never prints `0 MB`.

**vitest — `ComposerAttach.test.tsx`** (static server render):

- The button renders as one `<button type="button">` carrying the exact `class="composer__footer-button
  composer__attach"` run and the accessible name, with no `disabled` — the whole-attribute-run idiom the four
  sibling specs use, extracted to one constant so the assertions cannot drift apart.
- Its glyph is `aria-hidden` and `fill="currentColor"`, and the markup carries **no hex literal** — the AC1
  colour requirement stated as a property rather than as a value.
- `ComposerAttachOutcome` with `null` renders the **exact empty string** — `ContextUsageReading`'s strictness,
  which is what proves "not an empty element holding the slot".
- Each of the three arms renders `role="status"` and its mapped copy, and the rendered text equals the copy
  module's own output for that event (so the view is proven to *select*, never to compose).
- A `failed` event whose `reason` is one of the retrieval-leg codes still renders a non-empty line.

**vitest — `ConversationScreen.test.tsx`** (mount proofs; every assertion above passes on an unmounted
component):

- The button is mounted inside `.composer__footer`, and with a `getInitialState`-spied run-config snapshot
  making the reading appear, it renders **after** `composer__context` — the row's last item.
- The initial render carries no `composer__attach-outcome` at all.

**Playwright — `e2e/composer-attach.spec.ts`** (fake tier, one launch, one continuous drive):

The tier launches the *built* app, so its main process is the production one and a click would open a real
native `dialog.showOpenDialog` and hang the run. The spec stubs `dialog.showOpenDialog` through `app.evaluate`
before the first click — `assistant-link-opens-externally.spec.ts`'s `shell` stub, verbatim in shape —
recording each call and answering `{ canceled: true, filePaths: [] }`.

- **AC1 geometry:** the button's right edge sits at the footer's content-box right edge (the row's 16px inset),
  and it is to the right of every other footer item. That is what actually reddens if `margin-left: auto` is
  dropped; the row's `height` cannot redden, because it is a hard 20px, so it is asserted only as a
  containment check (the glyph does not overflow the row).
- **AC2:** clicking dispatches the intent — the main-process recorder fires — and no native window opened.
- **AC4, both halves:** a cancelled pick leaves nothing on screen; then an `AttachmentUploadEvent` pushed on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` through the same `app.evaluate` seam renders its copy; a second, different
  event replaces it; a further click on the button clears it.
- **AC5:** with no outcome showing the element has count 0, and the message box's `y` is identical before the
  first outcome and after the clear.

No `needs-real-claude`: both halves drive through `app.evaluate` with no live daemon and no live claude.

## Open questions

1. **Does the shared `.composer__footer-button` fit an icon-only button, or does the attach button declare its
   own rule?** Resolved in this plan: it fits and is worn. Half its declarations are inert for a label-less
   button, which is harmless; the alternative duplicates a six-declaration reset for nothing.
2. **`role="status"` or no live region?** Resolved in this plan: a live region, departing from the two
   neighbouring rulings with the reason stated inline. Revisit only if #815 lands a second announcement of the
   same fact — at which point the neighbours' argument would apply here for the first time.
3. **Does `formatByteLimit` need a binary-unit (MiB) arm?** Decided against, in this plan, on the grounds that
   the figure is user-facing. If the daemon's own bound is ever surfaced beside it, the two must agree on units;
   that is #815/#864 territory, not this slice's.

## Security review

**Verdict:** PASS (first walk found two SHOULD FIX and no MUST FIX; both are folded into the Design above
rather than left for Phase B to remember).

**Findings:**

**1. [Trust boundaries / Error messages] SHOULD FIX — a union-keyed object lookup is a prototype read.**
`event.reason` arrives off `ipcRenderer.on`, where the declared type is the compile-time half only; nothing
validates the runtime value. Against a bare object literal, `FAILURE_COPY['constructor']` returns a *function*
off `Object.prototype`, `?? fallback` does not fall through because a function is not nullish, and React throws
"Objects are not valid as a React child" out of the composer's render — a renderer crash from a one-word value.
`'__proto__'`, `'toString'` and `'valueOf'` are the same shape. Reachability is a **non-conforming main
process**, not an external adversary — `driveUpload` assigns from a closed union — which is what keeps this
SHOULD rather than MUST. The fix is two lines and has an in-family precedent: #862's own mime-type table chose a
`Map` over an object literal for exactly this reason, in the write direction. **Folded in:** the `Record` stays
for compiler-forced exhaustiveness, the runtime read goes through a `Map` built from `Object.entries` of it, and
a test drives the three hostile keys through a cast.

**2. [Network & I/O / Error messages] SHOULD FIX — the refusal must not claim a limit the client does not
know.** `limitBytes` is `ATTACHMENT_MAX_UPLOAD_BYTES`, the *client's* own bound; the shipped docblock is
explicit that a file under it can still come back `attachment-too-large` from the daemon. Copy reading "the host
will not accept files over N" would state a fact the renderer does not have, and would mislead exactly when a
user is trying to work out why an upload failed. **Folded in:** the `refused` sentence names the limit as this
app's, and the `attachment-too-large` failure sentence is the one that speaks for the host.

**3. [Trust boundaries] The interpolation shortcut, named so it is not taken.** `` `Upload failed: ${reason}` ``
compiles and renders a client-owned literal, so it is neither an injection nor a length hazard — but it makes
the rendered sentence *daemon-selected* rather than client-authored, which is the property AC3 is about. Guarded
by an exact-equality test against the mapped constant, not by discipline.

**4. [Electron attack surface] This slice widens no capability.** It adds no channel, no `contextBridge` member
and no `ipcMain` handler; it is a consumer of two members #862 shipped. A compromised renderer could already
call `requestAttachmentUpload()` with no caller wired — the button is an affordance for an existing capability,
not a new one. Repetition is bounded below the bridge by the composition root's `pickerOpen` flag, so a
click-spammed button cannot stack native dialogs.

**5. [File / storage] Not applicable, by a property rather than by care.** This slice performs no filesystem
operation and constructs no path, and **nothing that could name a file exists in the renderer to send**: the
intent takes no argument, and no member of `AttachmentUploadEvent` can carry a path, a name or bytes. The only
way to violate it is to widen the intent — which is #890 (drag-and-drop), and that widening owes its own request
guard, as `attachmentUpload.ts`'s header already records. Nothing is persisted either: the outcome is component
state that dies with the mount, and never reaches `localStorage`, IndexedDB or disk.

**6. [Tokens / Cryptography] Not applicable, with the decision named.** No token, key, nonce or comparison
against a secret exists on this path. `uploadId` does cross the bridge and is **deliberately unread** — the
renderer cannot correlate it to a click (`requestAttachmentUpload` returns `void`), so reading it could only
invite a correlation that does not exist; the union's docblock separately rules it is not a capability.

**7. [Logs] This slice logs nothing, and that is a decision.** #862 already logs the whole flow content-free in
the main process. A renderer-side log would add no fact and would be the first place a rendered sentence could
reach a log file. Declined explicitly.

**8. [Concurrency] One interleaving, named and accepted.** `requestAttach` clears the held outcome and then
sends; an outcome from a *previous* upload arriving in that gap re-populates the line. That is the honest state
— an outcome that genuinely just arrived — and AC4 is satisfied (the one before it *was* cleared). It cannot be
designed away at this layer: with a `void`-returning intent the renderer has no click-to-outcome correlation to
suppress it with. #864's progress member is where a correlation would be built, if one is ever wanted.
Listener lifecycle is exact — one subscription per mount, the bridge's own unsubscribe as the effect cleanup —
and there is no promise, timer or `AbortController` to leak.

**9. [Threat model] Hostile daemon: blast radius is one misleading sentence.** It can choose which failure
literal arrives (the two retrieval-leg codes included), and can cause a `completed` for an upload that failed or
the reverse. It cannot inject text (every sentence is a module constant), cannot produce a blank line (exhaustive
`Record` plus the total `Map` read), and cannot move layout unboundedly (no daemon-length string reaches the DOM
— the property `.composer__model-label`'s `max-width` exists to enforce for a *claude-authored* label does not
arise here, because there is no claude-authored text on this path). A hostile **relay** is on-path and
content-blind: it can drop or delay an outcome, which shows as nothing or as a stale line — the same surface a
cancelled picker already produces, with no hang, since this slice holds no pending work. **Out of scope, with
its owner named:** distinguishing "the daemon stored it" from "the daemon says it stored it" needs evidence in
the timeline, which is #815.
