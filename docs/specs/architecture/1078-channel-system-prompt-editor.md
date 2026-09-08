# #1078 — the channel info sheet's System prompt section

The surface for the `set_system_prompt` / `system_prompt` vertical. The whole data path is built and
merged and nothing renders it: #1230 asks and routes the reply, #1231 holds the answer, #1249 sends the
write, #1250 holds its outcome. This ticket adds the section that reads both stores, edits the value,
shows the 8192-byte bound while typing, and submits through `submitSystemPrompt`. **No wire type, no
envelope, no IPC arm, no main-process change.**

## Files read

- `src/renderer/src/store/systemPromptStore.ts` → `SystemPromptReading`, `selectSystemPromptReading`,
  `useSystemPromptStore` — the read half. Its header carries the deny-list for `systemPrompt` and the
  `reading === null` fourth-state rule this section's loading arm rests on.
- `src/renderer/src/store/systemPromptWriteStore.ts` → `SystemPromptWrite`,
  `selectSystemPromptWriteFor`, `useSystemPromptWriteStore` — the write half. Its docblock names this
  ticket as the owner of gating a submit on the in-flight state (the two-writes ambiguity).
- `src/renderer/src/store/systemPromptWriteBridge.ts` → `submitSystemPrompt`,
  `SubmitSystemPromptDeps` — the submit entry point, and its "showing the limit before it is hit is
  \#1078's" note.
- `src/shared/wire/types.ts` → `MAX_SYSTEM_PROMPT_BYTES`, `SetSystemPromptPayload`,
  `SessionPromptStatus`, `MAX_PLAINTEXT_BYTES` — the bound, the tri-state contract, the three-value
  session status, and the frame cap the prompt sits far below.
- `src/shared/ipc/events.ts` → `SystemPromptWriteFailure` — the four client-owned refusal literals the
  section maps to copy.
- `src/main/daemonConnection.ts` → the `setSystemPrompt` arm's pre-send byte refusal — the authority
  the renderer's count mirrors but never replaces.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView`,
  `ChannelInfoSheet` — the host surface, its `.channel-info__*` row/section treatment, and the
  callback-gated-on-`conversation !== null` idiom the new slot follows.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` → `RenameConversationDialogView`
  and `channels.css`'s `.rename-conversation__field` / `__input` — the outlined-field chrome this
  section borrows for its editor, per the ticket.
- `src/renderer/src/PairedShell.tsx` → `requestConversationConfig` — the activation ask that is the
  section's whole ingress; nothing else can refill the reading.
- `e2e/workspace-picker.spec.ts` and `e2e/fixtures/launchPairedApp.ts` → the compose-over-
  `conversationStateFake` capture pattern, and the post-#448 fact that a fixture row-open records the
  clicked row as the **active** conversation (so the sheet has a non-null conversation to key on).
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md` § Channel Info sheet — the
  sheet's structure, its `conversation === null` graceful-empty rule, and the Actions ordering.
- `docs/knowledge/features/system-prompt-write-store.md` § Security properties — the inherited
  contracts this surface has to discharge rather than inherit by reference.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-595

The Channel Info Sheet: a dark bottom sheet — drag handle, title row with an × close, then muted
section headers (`About`, `Memory`, `Actions`) each followed by label-left / value-right rows, a column
of full-width tonal pills for the actions, and a dimmed monospace `Channel ID:` footer. The System
prompt section is **not drawn**; it borrows this sheet's `.status-sheet__section-header` and the
`.channel-info__row` padding rhythm, and the Rename dialog's outlined field (`19:16`) for the editor
itself, exactly as the ticket directs. No new colour, type or spacing token.

## Context

Two channels on the same repository cannot behave differently today: the workspace instructions file is
per-directory. The daemon stores a per-conversation prompt (`pyrycode/pyrycode` #2149–#2152) and this
client can already read and write it — but the value has no surface, so the whole vertical is dark.

The section lands in the channel info sheet rather than in a new home, because the 2026-09-04 ruling
combines channel info and the run configuration into one surface, and two further per-conversation
configuration sections (#1241 Session, #1251 MCP servers) are already filed against this same sheet.

**No ADR is warranted.** Every design decision here is an application of an existing one: ADR 0006
(transient UI state → `useState`), the store headers' own tri-state and deny-list rules, and the
sheet's slot idiom.

## Design

### One new file, not a fourth thousand lines in `ConversationScreen.tsx`

`src/renderer/src/screens/conversation/SystemPromptSection.tsx` — the `WorkspacePickerSheet.tsx` /
`CreateFolderDialog.tsx` precedent in this directory. Three exports:

```ts
export type SystemPromptSectionModel =
  | { state: 'loading' }
  | { state: 'ready'
      text: string          // what the editor shows
      byteLength: number    // UTF-8 bytes of `text`
      overLimit: boolean    // byteLength > MAX_SYSTEM_PROMPT_BYTES  (INCLUSIVE bound: 8192 is legal)
      canSave: boolean      // !overLimit && no write in flight
      canClear: boolean     // no write in flight
      countLine: string
      writeLine: string | null
      sessionLine: string | null }

export function deriveSystemPromptSection(
  reading: SystemPromptReading | null,
  write: SystemPromptWrite | null,
  draft: string | null
): SystemPromptSectionModel

export function SystemPromptSectionView(props: {
  model: SystemPromptSectionModel
  onTextChange: (next: string) => void
  onSave: () => void
  onClear: () => void
}): JSX.Element                       // pure; renders the section header + editor + controls

export function SystemPromptSection(props: { conversationId: string }): JSX.Element
```

**`deriveSystemPromptSection` is where the whole state machine lives**, so every arm is a plain unit
test rather than a render. `reading === null` → `loading`: no editor, **no Save and no Clear**, which is
what makes AC1's "an unanswered conversation cannot be saved blank over a stored value" structural
rather than a rule an implementer must remember.

**The editor's seed, and the one place the tri-state legitimately collapses.** `undefined` (holds none)
and `''` (holds an explicitly empty prompt) both display as an empty textarea — they are
indistinguishable *to the eye* and always will be. The collapse is written as an explicit `undefined`
branch, never `?? ''`, and it is confined to the display seed: **the tri-state survives on the write
side**, where Save always sends a `string` (`''` when the box is empty) and Clear always sends `null`.
Clear is a control the operator presses, never inferred from an empty box — that inference is exactly
what would make the clear path unreachable.

**`draft: string | null`, `null` meaning untouched.** Container-owned `useState` (ADR 0006). The
editor shows the reading's seed while `draft === null` and the operator's text once they type. This is
not a convenience: it is what stops a late reply from overwriting text already typed (see § Security
review, Concurrency).

### The slot in the sheet

`ChannelInfoSheetView` gains one optional prop, `systemPromptSection?: ReactNode`, rendered between the
About block and the Actions section header — the `StatusSheet` `children` idiom in narrow form.
`ChannelInfoSheet` supplies `<SystemPromptSection conversationId={conversation.id} />` **only in the
`conversation !== null` branch**, the same callback-gate the Rename / Archive / Delete actions use, so
the list-opened graceful-empty case grows no editor and needs no id-or-empty-string fallback.

The section owns its own `.status-sheet__section-header` ("System prompt"), so the slot is
self-contained the way `RunConfigSections` is inside `StatusSheet`.

### Copy — all client-owned literals, apostrophe-free

Module constants (the `CHANNEL_INFO_*` idiom; `renderToStaticMarkup` escapes `'`). **No daemon string
reaches any of them**: the four refusal reasons and the three session statuses are both closed,
client-owned unions.

- count: `` `${byteLength} / ${MAX_SYSTEM_PROMPT_BYTES} bytes` ``, plus a fixed over-limit line.
- write: in flight / saved / one line per `SystemPromptWriteFailure` member.
- session: `differs` names **New session** as what applies the saved prompt; `matches`, `no_session`
  and `reading === null` produce `null` — nothing of the kind is said.

### Byte counting

`new TextEncoder().encode(text).length`, encoder hoisted to a module constant. It must agree exactly
with main's `Buffer.byteLength(prompt, 'utf8')`, and does: both encode UTF-8 and both replace an
unpaired surrogate with U+FFFD. A disagreement would let the UI report "under" on a value main refuses
— the precise failure AC3 exists to remove. `MAX_SYSTEM_PROMPT_BYTES` is imported, never restated.

## State + concurrency model

Two narrow-slice reads, no new store: `useSystemPromptStore(selectSystemPromptReading)` and
`useSystemPromptWriteStore(selectSystemPromptWriteFor(conversationId))`. Both selectors return the held
object itself, so a re-render happens only on a real transition. `draft` is component-local and dies
with the sheet's unmount.

**No async work is started here at all** — no promise, no timer, no subscription, so there is nothing to
cancel. Submission is fire-and-forget through `submitSystemPrompt`; the inbound outcome arrives on the
app-lifetime `SystemPromptWriteData` mount (#1250) whether the sheet is open or not, and
`clearRunConfig` already clears both stores on every conversation seam.

## Error handling

| Condition | Behaviour |
|---|---|
| `reading === null` (never asked, or reply lost/delayed) | Loading arm: a line saying so, no editor, no Save, no Clear. Fail-closed by construction. |
| over 8192 UTF-8 bytes | Save disabled + the over-limit line. Main's refusal stays the authority; this only stops it being the operator's first news. |
| write `in-flight` | Save and Clear both withheld — the #1250 two-writes ambiguity closed behaviourally, as that store's docblock requires. |
| write `rejected` | One client-owned line per reason; the daemon's own message is never rendered. |
| write `confirmed` | A saved line that also states the running session keeps what it started with. |

## Testing strategy

**vitest — `SystemPromptSection.test.tsx`** (node, `renderToStaticMarkup`). `deriveSystemPromptSection`
directly for: the loading arm; `undefined` vs `''` vs text seeds; a typed draft winning over a
late-arriving reading; the inclusive bound at exactly 8192 and at 8193 with a multi-byte character;
each of the four refusal reasons; `differs` producing the notice and `matches` / `no_session` producing
`null`. `SystemPromptSectionView` markup for: the loading arm rendering no `<textarea>` and no Save;
prompt text arriving as an escaped textarea child (a `<script>`-bearing prompt stays inert); `disabled`
present on Save when over-limit and when in flight.

**Playwright — `e2e/channel-system-prompt.spec.ts`** (fake tier). A spec-local fake composed over
`conversationStateFake` (the `workspace-picker.spec.ts` shape) answers `request_system_prompt` with a
seeded prompt and `session_prompt_status: 'differs'`, and captures every inbound frame. Open the
overflow menu → Channel info; assert the seeded prompt and the `differs` notice; type; assert the byte
count moved; Save and assert the captured `set_system_prompt` payload carries the typed text verbatim;
Clear and assert the next captured payload carries `system_prompt: null`.

Renderer specs cannot click, so every transition above is driven in Playwright and every *state* is
asserted in vitest — the split the ticket's technical notes prescribe.

## Open questions

1. Should Clear be hidden when the conversation holds no prompt? Leaning no — a clear on an
   already-clear conversation is a well-defined no-op write, and hiding it would need a fourth arm.
   Resolve in Phase B and record here if it changes.
2. Does the confirmed line need to re-state the session story when `sessionPromptStatus` is stale after
   a save? Leaning yes, in a form true under all three statuses, since nothing re-asks after a write.

## Revisions

**2026-09-08 — the two Open Questions, resolved in Phase B.** Neither changed the design.

1. **Clear stays visible when the conversation holds no prompt.** A clear on an already-clear
   conversation is a well-defined no-op write, and hiding it would need a fourth arm on the model for no
   behavioural gain. It is withheld only while a write is in flight, alongside Save.
2. **The confirmed line does re-state the session story**, in a form true under all three statuses:
   `WRITE_CONFIRMED` reads "Saved. A running session keeps the prompt it started with until New
   session." Nothing re-asks after a write, so `sessionPromptStatus` is stale the moment a save lands —
   a line conditioned on it would be the one thing here that could tell the operator something false.

**2026-09-08 — size, measured against the § A1 estimate.** The plan sized the ticket at roughly 800
lines of total written work; the actual is ~1157 (292 + 244 + 183 new, 180 modified, 258 plan). The
overshoot is not scope drift — the design shipped is the design planned, in two production files. It is
comment density: this repo's convention runs the docblock at roughly twice the code it explains, and the
mandatory `security-sensitive` review section is 60 lines of the plan on its own. Budget was never the
constraint (the run finished well inside both caps). Recorded here so the next sizing pass on a
`security-sensitive` renderer ticket has a real multiplier rather than a line-count intuition.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, after checking each denied sink against this *new* consumer rather
  than inheriting the store's contract by reference. `reading.systemPrompt` reaches exactly one sink: a
  controlled `<textarea value={…}>`. React renders that as an escaped **text child** in server markup
  and sets it as a **DOM property** in the browser — never a serialized HTML attribute — so the store's
  "never into an attribute" clause is not violated by the `value=` spelling. There is no
  `dangerouslySetInnerHTML`, no `innerHTML`, no URL, no filename, no cache key, no lookup path, and no
  `key={}` anywhere on prompt text (the section renders no list). The inbound boundary stays
  `parseSystemPromptPayload` in main; nothing here re-validates or normalises, because a second
  authority could only disagree with the first and would silently change what the operator stored.
- **[Trust boundaries]** No findings — the two rendered *classifications* (`SystemPromptWriteFailure`,
  `SessionPromptStatus`) are closed client-owned unions narrowed at the decode boundary, so **no daemon
  string is rendered as copy**; the daemon's own `error` message is not surfaced.
- **[Tokens / secrets]** Design decision, stated so it cannot be eroded later: an operator can paste a
  credential into a system prompt, so the draft is held in `useState` only and dies with the sheet's
  unmount. Nothing on this path touches `localStorage`, `sessionStorage`, IndexedDB or zustand
  `persist`/`devtools` — both stores already forbid middleware, and this section adds no storage port
  of its own.
- **[File / storage operations]** Not applicable — the renderer writes no file and constructs no path.
  The prompt is never a filename or a path component; the only place it goes is a wire payload value.
- **[Electron attack surface]** No findings, and one assumption worth naming so a reviewer does not
  invert it: **the renderer's byte gate is a convenience, not the bound.** `daemonConnection.ts`'s
  `setSystemPrompt` arm independently refuses over-length text before the connected guard and before
  any frame is built, and keeps doing so. No new IPC arm, command type, preload API or window is added;
  `window.pyry` is dereferenced only inside interaction callbacks, so the section stays
  server-renderable.
- **[Cryptographic primitives]** Not applicable — no key, nonce, RNG or comparison is touched.
- **[Network & I/O]** No findings. An 8192-byte prompt sits far under `MAX_PLAINTEXT_BYTES` (65519), so
  the frame guard stays a backstop. The in-flight gate on Save/Clear is load-bearing here rather than
  cosmetic: without it, holding the control would emit unbounded `set_system_prompt` frames at click
  rate through an on-path relay.
- **[Error messages, logs, telemetry]** No findings — **nothing on this path logs, on any branch.** The
  byte count is rendered into the operator's own window because AC3 requires it; it is not written to
  the renderer console, a log file or telemetry, which is the sink both store headers forbid. No
  refusal line interpolates prompt text or its length.
- **[Concurrency]** SHOULD FIX, addressed in the design and to be pinned by a named test: **a late
  reading must never re-seed an edited draft.** An on-path relay can delay the `system_prompt` reply
  arbitrarily; if the section re-seeded from a reading that landed after the operator started typing,
  their in-progress text would be silently replaced by the daemon's value and the next Save would store
  that value under the operator's intent. `draft: string | null` with `null` meaning untouched closes
  it — once `draft` is non-null the reading is never read for display again. The verifier should check
  that test exists. No other concurrency surface: no async work is started, so there is nothing to
  abort, clear or unsubscribe.
- **[Threat model alignment]** No findings. Hostile relay, dropping the read reply: the section stays in
  the loading arm forever and offers no save — fail-closed, and exactly AC1. Dropping the write ack: the
  marker stays in flight and both controls stay withheld until `reconnected` sweeps it (#1250); nothing
  here retries or spins. Hostile daemon response: malformed payloads are already rejected fail-closed at
  `parseSystemPromptPayload` where no event is emitted, and an off-contract `session_prompt_status` is
  rejected at the decode rather than folded into one of the three. Renderer compromise reaching the
  transport: unchanged — no key, socket or raw frame is reachable from this file.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
