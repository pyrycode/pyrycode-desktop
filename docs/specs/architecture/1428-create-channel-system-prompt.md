# #1428 — Create channel takes a channel system prompt

The Create channel modal gains an optional **Channel system prompt:** text area under the name field.
The value is written as a *second step*: `create_conversation` first, then one `set_system_prompt` on the
confirmation for the channel this dialog asked for.

## Files read

- `src/renderer/src/screens/channels/ChannelForm.tsx` → `ChannelForm` — the shared form the field lands
  on; today the name input alone.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialogView`,
  `CreateChannelDialog`, `Pending` — the view that disables OK and the container that owns the pending
  ref, the daemon-event listener and the dismissal.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` → `SaveAsChannelDialogView` — the form's
  other consumer, which must keep rendering the name field alone.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewChannel` — trims the name before
  sending, so the matching predicate compares against the trimmed value, not the draft.
- `src/renderer/src/store/systemPromptWriteBridge.ts` → `submitSystemPrompt`, `SubmitSystemPromptDeps` —
  the shipped write path (#1249/#1250): record the in-flight marker, then send exactly one command. Its
  header pins the tri-state (`null` clears, `''` stores empty) and the record-before-send order.
- `src/renderer/src/screens/conversation/SystemPromptSection.tsx` → `deriveSystemPromptSection`, its
  hoisted `UTF8` encoder and `SYSTEM_PROMPT_OVER_LIMIT` — how the sheet counts the bound in UTF-8 bytes
  and the wording this field restates.
- `src/shared/wire/types.ts` → `MAX_SYSTEM_PROMPT_BYTES` (8192), `ConversationCreatedPayload` (`id`,
  `is_promoted`, `cwd`, `name`, `last_used_at`, `workspace_label`) — the bound and the only handles the
  confirmation offers.
- `src/renderer/src/screens/channels/channels.css` → `.create-channel__input` and its `:focus-visible` /
  `:disabled` siblings — the treatment the text area restates.
- `src/renderer/src/components/modal.css` → `.modal__content` — `gap: var(--space-3)` is already the
  drawing's 12px between the two fields, so the field adds no margin of its own.
- `e2e/sidebar-create-channel.spec.ts` → `controlled`, `event`, `open` — the request-capturing fake and
  the host-stamped injector AC5 extends.
- `e2e/real-daemon-create-channel.spec.ts` (header and assertions) → evidence that the real daemon echoes
  all three matched fields; see **Matching the confirmation**.
- `docs/knowledge/features/create-channel-dialog.md` — the dialog's guards, the draft lifetime, and the
  recorded limitation that concurrent same-host operations stay indistinguishable.
- `docs/knowledge/features/system-prompt-write.md` § Known limitation — two writes to one conversation in
  flight at once are indistinguishable; one write per create never reaches it.
- `docs/knowledge/features/daemon-connection-correlation.md` — the posture this plan inherits: state the
  residual ambiguity rather than engineer around it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2435
(text area instance `I487:2435;489:1900;500:2098`)

A **Channel system prompt:** label in label-large-emphasized (14px/20px, tracking 0.1px, weight 600 —
the name field's own `.create-channel__label`), an 8px gap, then a filled box at the modal's full content
width, 112px tall: fill `rgba(0,51,85,0.41)`, which is exactly
`color-mix(in srgb, var(--color-on-primary) 41%, transparent)` — `--color-on-primary` is `#003355` — a
6px corner (`--radius-xs`), 16px of padding on every side (Figma splits it 12+4 vertically), and
body-medium text. The block sits 12px under the name field and above the Cancel/OK actions. Every value
is the name input's, restated; only the height and the element differ.

## Context

A channel's system prompt is what makes two channels on one repository behave differently. Today it can
only be set after the fact, in the channel info sheet's `SystemPromptSection` (#1078). This ticket gives
it to the operator at creation.

The daemon's `set_system_prompt` takes an *existing* `conversation_id` and `create_conversation` carries
no prompt field, so the write cannot ride the create. The alternative — a `system_prompt` field on
`create_conversation` — would need a daemon ticket plus a wire change here and on mobile for a verb that
already exists, and was not chosen. The write therefore goes out on the confirmation, through the
shipped `submitSystemPrompt`. No new wire type, envelope or IPC arm.

That second step opens a hazard the create alone did not have. `conversationCreated` is **uncorrelated**:
main emits it on decode without matching it to a request, and a same-host confirmation for somebody
else's create is indistinguishable from this dialog's by the host stamp alone. Today that only dismisses
this dialog early. Once a prompt write rides the same path it would write the operator's text onto a
conversation they did not create. AC2 closes that by gating the *write* on a payload match.

No ADR is warranted: this adds no decision the shipped write path and the correlation doc do not already
record.

## Design

### The field on the shared form

`ChannelForm` gains **one optional bundled prop**:

```ts
prompt?: { value: string; overLimit: boolean; onChange: (next: string) => void }
```

Bundled rather than three parallel optional props, for the reason the create-channel overview already
records for `WorkspaceCreateControl`: parallel optional props permit a handler with no label, or a value
with no over-limit state. Absent → the form renders exactly as today, so `SaveAsChannelDialog.tsx` is not
touched at all and its modal keeps the name field alone (AC1's second half).

The field is a wrapping `<label>` with a visible `<span>` — the name field's own accessible-name idiom,
no `id`/`htmlFor` pair — holding a controlled `<textarea rows={4}>` disabled on `busy`. The over-limit
notice is a sibling `<p>` *after* the label, never inside it: inside, it would join the field's
accessible name. It is not `role="alert"` — it would re-announce on every keystroke past the bound, and
`SystemPromptSection` renders its own over-limit line as a plain paragraph for the same reason.

### The byte bound

`MAX_SYSTEM_PROMPT_BYTES` is imported from `@shared/wire/types` and never re-implemented: main enforces
it independently with `Buffer.byteLength(prompt, 'utf8')` and a second authority could only disagree.
A module-level `TextEncoder` is hoisted in `CreateChannelDialog.tsx` — a fresh encoder per keystroke
otherwise, the reason `SystemPromptSection` hoists its own — behind one exported pure predicate:

- `systemPromptOverLimit(text: string): boolean` — `UTF8.encode(text).length > MAX_SYSTEM_PROMPT_BYTES`,
  the same inclusive `>` main uses.

It lives in the container, not the form, because OK's disabled state needs the same answer: OK is
disabled on `busy || name.trim() === '' || promptOverLimit`.

The over-limit wording is restated verbatim as a module-level client-owned constant in `ChannelForm.tsx`
with the bound interpolated from the shared constant. It is *not* imported from `SystemPromptSection`:
that module is sheet-scoped, pulls two stores and the write bridge into its module graph, and no file in
`screens/channels/` imports from `screens/conversation/` today. The only thing that could drift
numerically — the bound itself — comes from the one shared constant on both sides.

### The two-step create

`Pending` widens to record **what was asked for**:

```ts
type Pending = { type: 'idle' } | { type: 'channel'; name: string; cwd: string; systemPrompt: string | null }
```

A ref and not state, because the daemon-event listener is installed in an effect keyed on
`[serverId, cleanup, dismiss, fail]` and deliberately does not re-subscribe on a keystroke: a captured
draft would be whatever was typed when the listener was installed. `name` is the *trimmed* value
`requestNewChannel` sends. `systemPrompt` is `null` when the draft trims to empty — the write-or-not
decision is taken once, at send time — and otherwise the draft **verbatim and untrimmed**, because the
value round-trips to the daemon as a write and any normalisation would silently change what is stored.

On a `conversationCreated` that passes the existing host and stage guards:

1. If `confirmsPending(event.conversation, pending.current)` and `pending.current.systemPrompt !== null`,
   call `submitSystemPrompt({ sendCommand: window.pyry.sendCommand, dispatch: … }, conversation.id,
   systemPrompt)` — exactly once, for that conversation's own `id`, **inside a `try`/`catch` that
   swallows without logging**. `sendCommand` can throw locally, which is why the create path already
   wraps `requestNewChannel`; here an escaping exception would abort the dismissal below, stranding the
   dialog over an already-created channel, and would carry the failed command — prompt included — out of
   the listener onto an error path this plan does not control. The `catch` is empty by design: the
   in-flight marker `submitSystemPrompt` recorded before sending is swept by the write store's
   `reconnected` arm, and there is nothing loggable here that is not forbidden.
2. Then `dismiss('confirmed')`, unchanged and unconditional, which lets the globally mounted navigation
   bridge open the channel as it does today.

Write *before* dismiss: `dismiss` runs `cleanup()`, which resets the pending ref, so the record of what
was asked for is gone afterwards. Exactly one write follows from the same turn — `cleanup` sets
`abandoned` and clears the ref synchronously, so a second confirmation reaches an abandoned draft.

The write's outcome is dispatched into `systemPromptWriteStore`, which is app-level, so the channel info
sheet's `SystemPromptSection` shows it wherever the operator looks next. The dialog does not wait for the
acknowledgement: the confirmed-channel navigation is the existing close signal. One write per create, so
the same-conversation ambiguity in `system-prompt-write.md` § Known limitation is never reached.

### Matching the confirmation

```ts
confirmsPending(conversation: ConversationCreatedPayload, pending: Pending): boolean
```

— exported and pure: `pending.type === 'channel' && conversation.is_promoted === true &&
conversation.name === pending.name && conversation.cwd === pending.cwd`.

Those three are the only handles the payload offers beyond the id itself, and each one's echo is
confirmed rather than assumed. `e2e/real-daemon-create-channel.spec.ts` drives a real daemon and asserts
that the created row's title reads the typed name (a create the daemon stored with a null name renders
"Untitled"), that the workspace label list stays a single group keyed on the requested `cwd` (a defaulted
`cwd` mints a second group), and that the promoted-row Rename control count goes to two. On the fake
tier, `conversationStateFake` mints its row *from* the request, so all three echo there as well. A gate
that never matched would silently drop every prompt write — worse than the misattribution it prevents —
so this evidence is the gate's precondition, not a footnote.

**The predicate gates the write only, never the dismissal.** Today any same-host `conversationCreated`
arriving in the `channel` stage dismisses this dialog, and AC2 requires dismissal to behave exactly as it
does today in every one of these cases. So a non-matching same-host confirmation still dismisses and
writes nothing; a foreign-host confirmation is still filtered by the existing stamp guard and writes
nothing; a rejection still shows the stage error and a disconnect still dismisses, neither writing.

**Residual ambiguity, stated rather than engineered around.** Two identical concurrent creates on one
host — same trimmed name, same `cwd` — remain indistinguishable, and the first confirmation to arrive
takes the write. That is the posture `daemon-connection-correlation.md` already takes for this reply; no
per-request identifier exists on this path to do better, and minting one is a wire change.

### Styling

`channels.css` gains `.create-channel__textarea` as a sibling of `.create-channel__input` — the file's own
idiom for a twin control — restating the fill, corner, padding and body-medium type, plus its own
`:focus-visible` and `:disabled` siblings. `rows={4}` over a 20px line-height and 16px of vertical
padding is the drawing's 112px. `resize: vertical` (never `both`, which would let a drag exceed the
modal) and `overflow-wrap: break-word`, both borrowed from `.system-prompt__input`. That sheet-scoped
rule itself stays untouched. `.create-channel__notice` carries the over-limit line in `--color-error`,
the `.create-channel__error` treatment without its alert role.

## State + concurrency model

No new store slice and no new async work. The draft lives in the container's `useState` and dies with the
unmount; the record of what was sent lives in the existing `pending` ref. The only new outbound work is
one fire-and-forget `sendCommand` inside the existing daemon-event listener, whose unsubscribe handle is
already the effect's cleanup. Cancel, the header close, a disconnect and unmount all run `cleanup`, which
sets `abandoned` and clears the ref, so nothing can write after the dialog goes away. There is no timer,
no promise and no subscription added, therefore no new cancellation path.

## Error handling

- Over the bound: OK disabled plus the notice; the command is never built. Main refuses an over-length
  value independently, and `submitSystemPrompt` records the in-flight marker before sending so that
  refusal settles into `systemPromptWriteStore` and surfaces in the info sheet.
- A rejected create: unchanged — the stage error, editing restored, no write.
- A rejected or lost *write*: the dialog has already dismissed. The outcome lands in the app-level write
  store, where the info sheet reports it; the dialog deliberately has no second failure surface.
- A *local* send failure on the write (`sendCommand` throwing): caught and swallowed, and the dismissal
  runs anyway — see the two-step create above. The dialog never reports it, because by then the channel
  exists and the dialog is closing; the stranded in-flight marker is the write store's reconnect sweep.
- A disconnect mid-flight: unchanged dismissal, no write.
- A same-host confirmation that does not match: dismissal unchanged, no write.

## Security

The prompt reaches **one sink**: the controlled `<textarea value={…}>`, which React renders as an escaped
text child server-side and sets as a DOM property in the browser — never serialized markup, never an
attribute. It is never logged, never carried on a diagnostic (no diagnostic is added, and no existing
code varies with whether a prompt was typed), never persisted — no `localStorage`, `sessionStorage`,
IndexedDB or zustand persist on this path — and never used as a key, a filename or a lookup path. Cancel
and the header close unmount the container, which discards the draft; a reopen starts empty. An operator
can paste a credential into a system prompt, so this is a hard constraint, not hygiene.

## Testing strategy

Vitest for everything static and pure; Playwright for every transition that needs a keystroke or a click.

**`CreateChannelDialog.test.tsx`** (static renders of `CreateChannelDialogView` + the two pure helpers):
- the modal renders the **Channel system prompt:** label and a textarea between the name input and the
  actions, with the shared 640px modal unchanged
- the textarea escapes operator input and is disabled while pending, alongside the name input
- the over-limit notice appears only when `overLimit`, and OK is disabled with it
- `systemPromptOverLimit`: empty, a value at the bound, a value one byte over, and a multi-byte value
  whose UTF-8 length diverges from its code-unit length (the divergence is the point)
- `confirmsPending`: a match; a name mismatch; a `cwd` mismatch; `is_promoted: false`; `idle`

**`SaveAsChannelDialog.test.tsx`** — the Save as channel modal renders no textarea and no prompt label.

**`e2e/sidebar-create-channel.spec.ts`** (extends the existing capturing fake and injector):
- create with a prompt sends `create_conversation` then `set_system_prompt`, in that wire order, whose
  `conversation_id` is the confirmed conversation's own id and whose `system_prompt` is the typed text
  verbatim and untrimmed
- create with an empty box, and with a whitespace-only box, sends no `set_system_prompt`
- a foreign-host confirmation writes nothing and does not dismiss; a same-host confirmation whose payload
  does not match writes nothing and dismisses as it does today
- text over the bound disables OK and shows the notice

Visual check per the shared visual-review recipe: the built app under the fake-transport fixture at
1280×800 and 800×600, compared against the Figma frame above.

## Open questions

None outstanding. The two that shaped the design — whether the daemon echoes the three matched fields,
and whether the predicate should gate dismissal as well as the write — are answered above from the
real-daemon spec's assertions and AC2's wording respectively.

## Security review

**Verdict:** PASS (second pass; the first failed on the unwrapped write, fixed in **The two-step create**
and **Error handling** above before this section was written)

**Findings:**

- [Trust boundaries] **Named, scoped, no fix.** This plan promotes two untrusted daemon-supplied strings
  — `ConversationCreatedPayload.name` and `.cwd` — into a security-relevant position: they decide, in
  `confirmsPending`, whether the operator's prompt is written to a conversation id the daemon also chose.
  The predicate is therefore an **attribution filter against benign concurrency, not an authorization
  check**: a hostile or impersonating daemon picks the `id` in its own confirmation and can already
  direct our write anywhere, and no client-side comparison of fields it also supplies can prevent that.
  What the filter does close is AC2's actual threat — a same-host confirmation for a create some other
  client asked for. Stated here so a later reader does not mistake it for authentication. `===` is the
  correct compare: `name` and `cwd` are opaque display/routing strings, not secrets, so
  `timingSafeEqual` is not applicable.
- [Tokens, secrets, credentials] **MUST FIX, fixed before commit.** An operator can paste a credential
  into a system prompt, so the prompt is treated as a secret. The first draft called `submitSystemPrompt`
  bare inside the daemon-event listener; `sendCommand` can throw locally — the create path in this same
  container already wraps `requestNewChannel` for exactly that — and an escaping exception would carry
  the failed command, prompt included, onto an error path this plan does not control, as well as
  aborting the dismissal. Now wrapped in a non-logging `try`/`catch`, with the dismissal unconditional.
  Otherwise: the value is held only in the container's `useState`, dies with the unmount, and touches no
  `localStorage`, `sessionStorage`, IndexedDB or zustand persist. No token, key or credential of the
  app's own is read, minted or stored on this path.
- [File / storage operations] No findings — nothing here opens, reads, writes or resolves a path. `cwd`
  is compared as an opaque string and is never passed to `path.join` / `path.resolve`, and
  `conversation.id` is a payload value and a `Map` key in the write store, never a filename, a cache key
  or a lookup path.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no new `contextBridge`
  API, no `webPreferences` change. The write rides the existing typed `setSystemPrompt` command, whose
  main-side handler enforces the byte bound independently of the renderer's pre-flight gate. No key,
  socket or raw frame comes near the window.
- [Cryptographic primitives] Not applicable, by an explicit decision rather than absence: the plan mints
  **no** correlation id for the create. A client-minted id would be the only way to make the match exact,
  and it is a wire change on this repo and on mobile, so the design takes the residual ambiguity instead.
  No randomness is introduced anywhere.
- [Network & I/O] No findings — one extra outbound frame per create, size-bounded at main. Replay
  considered concretely: a hostile on-path relay replaying `conversationCreated` cannot force a second
  write, because the first one's `dismiss` runs `cleanup`, which sets `abandoned` and returns the pending
  ref to `idle` in the same synchronous turn. A dropped or delayed write ack cannot hang anything: the
  dialog never waits on it.
- [Error messages, logs, telemetry] No findings — **no diagnostic is added**, and no existing diagnostic
  code varies with whether a prompt was typed, so the diagnostic stream cannot even reveal that the
  operator set one. The over-limit notice and the stage error are client-owned literals; the only
  interpolation is the `MAX_SYSTEM_PROMPT_BYTES` constant. Nothing on this path reaches `console`.
- [Concurrency] No findings — the listener's read of `pending.current`, the write and the dismissal are
  one synchronous run with no `await` in the gap, so there is no check-then-act window. The ref is
  populated before `create_conversation` is sent, so no confirmation can arrive ahead of it, and a local
  create failure routes through `fail`, which returns the ref to `idle` and drops the recorded prompt.
  No timer, promise or subscription is added, so no cancellation path is added either.
- [Threat model alignment] Malicious relay: addressed under Network & I/O. Hostile daemon: named above
  as beyond the predicate's reach and unchanged from this path's existing posture. Renderer compromise
  reaching the transport: unchanged — no new capability is exposed. **Accepted residual**, restated as a
  threat rather than only as a limitation: a party that can create a conversation on the same host with
  the same trimmed name and `cwd`, concurrently, could take this write. That party is already inside the
  daemon's trusted session, and `docs/knowledge/features/daemon-connection-correlation.md` takes the
  same posture for every reply on this uncorrelated path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
