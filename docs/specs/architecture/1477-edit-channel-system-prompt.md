# #1477 — the Edit channel modal holds the channel system prompt

## Files read

- `src/renderer/src/screens/channels/EditChannelDialog.tsx` → `EditChannelDialogView`, `EDIT_CHANNEL_TITLE` — the pure view #1476 shipped, and the header ruling that OK must never go dead on open.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `editChannelRow` / `editChannelName`, the `connected(...)` render gate, `canMutateHost`, `titleFor`, the local `SidebarRow` type — where this modal's open state and rename decision already live. `SidebarRow` is module-local and not exported, which is what forces the new container onto primitive props.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialog`, `systemPromptOverLimit` — the precedent for a dialog owning its own `onDaemonEvent` subscription behind an `event.serverId` gate, and the exported byte bound.
- `src/renderer/src/screens/channels/ChannelForm.tsx` → `ChannelForm` — the shipped `Channel system prompt:` label, textarea and over-limit notice. Read for its wording and its accessible-name rule; **not** adopted (finding 2 below).
- `src/renderer/src/store/systemPromptBridge.ts` → `translateSystemPrompt` (reused), `requestSystemPrompt` (reused), `subscribeSystemPrompt` (deliberately **not** reused — it gates on the open conversation). Its header carries the reply-only, never-block, never-retry invariant this plan obeys.
- `src/renderer/src/store/systemPromptWriteBridge.ts` → `submitSystemPrompt`, `SubmitSystemPromptDeps` — the write, whose tri-state (`null` clears, `''` stores empty, text stores text) crosses verbatim.
- `src/renderer/src/screens/conversation/SystemPromptSection.tsx` → `deriveSystemPromptSection`, `seedFor`, `SYSTEM_PROMPT_LOADING` — the shipped reading posture (a reply that never comes leaves the box unreadable indefinitely) and the `undefined → ''` seed spelling with no `?? ''`.
- `src/renderer/src/screens/channels/channels.css` → the `.edit-channel*` block and `.create-channel__textarea` / `__notice` — the rules to restate.
- `src/shared/ipc/events.ts` → the `systemPromptReceived` arm (`conversationId`, `systemPrompt: string | undefined`, `sessionPromptStatus`) and `DaemonEvent`'s `serverId` stamp.
- `e2e/channel-system-prompt.spec.ts` → `capturingSystemPromptFake`, `writes` — the per-spec fake handler for both verbs, reused as the new spec's precedent.
- `e2e/conversation-create-rename.spec.ts` → the two-Tab walk and its `#1438` comment; `e2e/sidebar-offline-mutations.spec.ts`, `e2e/conversation-state-fake.spec.ts`, `e2e/real-daemon-rename.spec.ts` → the four shipped drives of this modal that must keep passing.
- `docs/knowledge/features/channel-list.md`, `docs/knowledge/features/edit-channel-dialog.md` — the sidebar's package overviews; the latter already names this ticket as the owner of the field.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=500-2120 (text area instance `500:2151`)

A 640px column: the `Edit channel` title over a rule, then the `Channel name:` input, then a `Channel system prompt:` label over a filled, borderless text area of the same fill, corner and body-medium type as the input, then the centred Cancel / OK footer. The two fields sit 12px apart, which is the shared `Modal`'s own `.modal__content` gap (`--space-3`) — no new spacing rule. The text-area instance is the same `Text area large` component #1428 already translated for the create dialog, so its treatment is restated rather than re-derived. The outlined **Archive channel** button the drawing places between the text area and the footer is **#1438** and is not built here.

## Context

#1476 shipped this modal on the channel name alone. The **Channel system prompt:** field under it is what makes the modal the one place to edit both. The modal opens from any row, so it cannot read `systemPromptStore` — that store holds the open chat's reading, and `subscribeSystemPrompt` beside it drops every reply naming a different conversation. This modal therefore asks for itself and subscribes for itself, one shot per open, never a retry.

Three findings from the shipped tree moved this off its filed shape; they belong in the package overview and are recorded in the PR's Lessons learned:

1. **OK is never withheld on the read.** `systemPromptBridge`'s header forbids blocking on this reply-only frame; `EditChannelDialog`'s header forbids a dialog whose only exit goes dead on open; and `conversationStateFake` answers no `request_system_prompt`, so a withheld OK would never enable at the default tier and three shipped specs would stop passing. The hazard it reached for — an unanswered channel saved blank over a stored value — is closed by the two halves below instead: a box disabled until the reading arrives has no draft to send, and a write rule that fires only on a difference from what was read cannot fire when nothing was read.
2. **`ChannelForm` is not in this dialog's path.** `EditChannelDialogView` draws its own `.edit-channel__field` / `__label` / `__input`; two locator sets is the whole reason for two dialog files. Widening `ChannelForm`'s bundled `prompt` prop reaches nothing here, and adopting `ChannelForm` would move this dialog onto `.create-channel*` locators against that ruling.
3. **The field lands inside a pinned tab walk.** `conversation-create-rename.spec.ts` asserts two Tabs from the name field reach OK. A `disabled` control stays out of the tab order, so at the fake tier — where the reading never arrives — the shipped walk survives unchanged. A focusable spelling (`readOnly`) would break it, which is why the reading gate is spelled `disabled`.

No ADR is warranted: this adds no decision the shipped bridges have not already taken.

## Design

**A container, not more `ChannelList` state.** `EditChannelDialog.tsx` gains a container `EditChannelDialog` beside its view, the `CreateChannelDialog` shape. `ChannelList` keeps `editChannelRow` / `editChannelName` and its rename decision exactly as #1476 left them, and renders the container in the view's place. The container is mounted only while `editChannelRow` is non-null, so **its subscription's lifetime is the dialog's open lifetime and a reopen mints a fresh instance** — which is what makes AC2's "a reopen starts from a fresh ask rather than the abandoned draft" true by construction, with no reset code. `ChannelList` is past 2500 lines; three more cells and an effect there would be three more things to clear on host loss.

**The container's contract** — primitive props only, because `SidebarRow` is module-local to `ChannelList` and exporting it to hand a row across would widen a type boundary for no gain:

```ts
function EditChannelDialog(props: {
  conversationId: string
  serverId: string
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void      // #1476's rename + close, unchanged and still the container's caller's
}): JSX.Element
```

`ChannelList`'s render gate widens from `connected(editChannelRow.serverId)` to `typeof editChannelRow.serverId === 'string' && connected(editChannelRow.serverId)`. Behaviour-identical — `connected` already returns `false` for a non-string — and present only so `serverId` narrows to `string` without a `!` or an `as`.

**One state cell, a sealed union**, holding the reading and the draft together:

```ts
type PromptState =
  | { type: 'reading' }
  | { type: 'read'; seed: string; draft: string }
```

The `reading` arm has **no draft field at all**, so "a modal whose reading never arrived sends nothing whatever it shows" is a type-level fact rather than a guard. `seed` is `translateSystemPrompt`'s `systemPrompt` mapped through `SystemPromptSection`'s `seedFor` spelling — an explicit `if (systemPrompt === undefined) return ''`, never `?? ''` and never a truthiness read, so the tri-state survives the trip and the write rule below decides `null` versus text on the way back.

**The view's prompt prop mirrors that union**, so a `reading` arm cannot carry a value the box would then show:

```ts
prompt:
  | { state: 'reading' }
  | { state: 'read'; value: string; overLimit: boolean; onChange: (next: string) => void }
```

The view renders the label and a `<textarea className="edit-channel__textarea" rows={4}>` in both arms — `disabled` with an empty value in `reading`, controlled in `read`. `disabled` (not `readOnly`) for finding 3, and it also suppresses React's controlled-without-handler warning on the `reading` arm. The reading line and the over-limit notice render *outside* the wrapping label, so neither joins the field's accessible name — `ChannelForm`'s stated rule. Both are client-owned module constants restating the sheet's wording rather than importing it, for `ChannelForm`'s stated reason (that module is sheet-scoped and drags two stores and the write bridge into the module graph); only the numeric bound is shared, read from `MAX_SYSTEM_PROMPT_BYTES` on both sides.

**CSS** — `.edit-channel__textarea`, its `:focus-visible` and `:disabled`, plus `.edit-channel__notice` and `.edit-channel__reading`, restating `.create-channel__textarea` / `__notice` declaration for declaration under this namespace. The duplication is load-bearing and is the ruling the `.edit-channel*` block's own header already states. `.edit-channel__reading` takes `--color-on-surface-variant` (the sheet's `.system-prompt__empty` colour) rather than the notice's `--color-error`: it reports progress, not a failure.

## State + concurrency model

No store slice is added. The container holds `PromptState` in one `useState`; `systemPromptStore` is never written here.

- **Ask.** One `requestSystemPrompt(window.pyry.sendCommand, conversationId)` in the mount effect — a second ask site beside `PairedShell`'s activation ask, one shot per open, never a retry and never a `connected`-edge refresh.
- **Subscribe.** One `window.pyry.onDaemonEvent` listener installed by the same effect, whose returned off-handle is the effect cleanup — the whole cancellation path, since nothing here starts a promise, a timer or an interval. `[conversationId, serverId]` deps.
- **Gate, in order, on the raw event before the translator** (the `subscribeSystemPrompt` shape, with the open-conversation compare swapped for this row's id): `event.serverId !== serverId` → drop; `event.type === 'systemPromptReceived' && event.conversationId !== conversationId` → drop; then `translateSystemPrompt(event)`, and seed **only while the cell is still `reading`**. First matching reply wins, so a duplicate or late second reply can never clobber a draft the operator has started — the hazard `deriveSystemPromptSection`'s docblock names, closed here by the arm rather than by a `draft !== null` test.
- **Write.** On OK, before delegating to `onSave`: if the cell is `reading`, send nothing; if `draft === seed`, send nothing; otherwise `submitSystemPrompt({ sendCommand, dispatch }, conversationId, draft === '' ? null : draft)` inside a `try`/`catch` with a deliberately empty `catch`, `writePrompt`'s ruling verbatim (an exception escaping would abort the caller's dismissal and carry the prompt onto an error path this file does not control; the in-flight marker is swept by the write store's `reconnected` arm and there is nothing loggable here that is not forbidden). `dispatch` goes into `systemPromptWriteStore`, so the outcome is visible in `SystemPromptSection` when that channel is opened.
- **Ordering and the host re-check.** OK calls `submitSystemPrompt` *then* `onSave()`. `ChannelList`'s `onSave` opens with `canMutateHost`, so a disconnect between paint and click would suppress the rename but not the prompt write. The container therefore takes the **same live-store re-check first**, in its own OK handler, and **returns without calling `onSave` at all** when it fails — a different fabric from the React-state render gate, the pair #1476 already documents. It is the shipped `canMutateHost`, promoted from a module-local function in `ChannelList` to an export of that module, so the two decisions cannot drift; no second authority is written. The early return is what keeps the refusal path emitting **exactly one** `sidebar-mutation` / `host-unavailable` diagnostic rather than two: `onSave`'s own check is never reached. That check stays in `ChannelList` regardless — removing a shipped guard is not this ticket's to do, and it is defence in depth for a second caller this diff does not add.
- **Only `systemPrompt` is taken from the reading.** `translateSystemPrompt` returns `sessionPromptStatus` beside it; this container copies the prompt into its seed and **drops the status on the floor**. The `differs` notice belongs to `SystemPromptSection`, which has a New session control to point at; a modal with one OK has nothing to do with it, and carrying it into a cell that never agreed to hold it is the spread-versus-fresh-literal trap `translateSystemPrompt`'s own docblock names.

## Error handling

There is no failure arm to add. The read has **no error frame at all** (`requestSystemPrompt`'s docblock): an unanswered ask leaves the box disabled and the reading line up indefinitely, which is `SystemPromptSection`'s accepted posture for this reply-only frame and this ticket's AC1. The write's outcome is reported by `SystemPromptSection` through `systemPromptWriteStore`, not here — this modal closes on OK and does not wait. A local `sendCommand` throw on the write path is caught and swallowed per the ruling above; a throw on the ask path would be an unrecoverable preload fault and is deliberately not caught, matching `PairedShell`'s activation ask.

## Testing strategy

**vitest** (`EditChannelDialog.test.tsx`, extending the shipped `renderView` helper with a `prompt` argument) — the view's own markup, which is all the `node` env can reach: the label renders; the `reading` arm draws a disabled text area and the reading line and no notice; the `read` arm draws an editable box seeded verbatim; an `undefined`-sourced and an `''`-sourced seed both render an empty box; the over-limit arm draws the notice and disables OK while a blank name disables it independently; OK is **not** disabled on the `reading` arm (finding 1, asserted as a regression pin); the `.edit-channel*` namespace is worn by the textarea, notice and reading line and no `.create-channel*` token appears; and a prompt containing `&`/`<` renders as escaped text, never raw markup and never an `aria-label`.

**Playwright** (`e2e/edit-channel-system-prompt.spec.ts`, composing over `conversationStateFake` the way `channel-system-prompt.spec.ts`'s `capturingSystemPromptFake` does, with a `writes()` reader) — every transition, since no renderer spec in this repo can click: the ask goes out on open naming the row's id; the reading seeds the box; prompt-only sends one write; the name-and-prompt case sends both commands; an emptied box sends `null`; an untouched box after a reopen sends nothing; and a `systemPromptReceived` for another conversation seeds nothing (injected as an extra reply from the fake, with the box asserted still reading).

**Unchanged and re-run:** `conversation-state-fake.spec.ts`, `sidebar-offline-mutations.spec.ts`, `conversation-create-rename.spec.ts` — the last one's two-Tab walk survives because the box is `disabled` at a tier that never answers the ask; its `#1438` comment is updated to say so, since it currently claims the content slot holds nothing but the field.

**Handed off, not run here:** `npm run e2e:real:gate` — `real-daemon-rename.spec.ts` still drives this modal's OK, and the live seed from a real daemon's stored prompt is covered incidentally there. The dispatcher runs the live tier with its own credential; `needs-real-claude` stays on the issue.

## Open questions

- Whether `canMutateHost` should be exported from `ChannelList` or restated in the dialog module. Resolved in the Design above: **exported**, because a second authority could only disagree with the first — the reason `systemPromptOverLimit` is imported rather than re-derived. Recorded here so the verifier sees the alternative was weighed.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one untrusted→trusted crossing is `systemPromptReceived.systemPrompt` — operator-authored text relayed over the network. It crosses through exactly one named mapper, `translateSystemPrompt`, reused rather than re-read field by field, and the container interprets none of it: no parse, no normalisation, no truthiness read, no trim. Its two routing companions are **client-owned, not daemon-asserted**: `event.serverId` is main's own connection stamp and `event.conversationId` is resolved in the background process from the request this app itself sent, so both sides of the attribution gate are this client's own state.
- **[Trust boundaries]** SHOULD FIX — the reading carries `sessionPromptStatus` the container has no use for. Take `systemPrompt` alone; folded into § State + concurrency above, and the verifier should check no spread of the reading lands in the cell.
- **[Tokens, secrets, credentials]** No findings, but a real obligation inherited: **an operator can paste a credential into a system prompt** (`CreateChannelDialog` says so in as many words). Nothing on this path persists it — the draft lives in one `useState` inside a container mounted only while the modal is open, and nothing here touches `localStorage`, `sessionStorage`, IndexedDB, `persist` or disk. No token, key or `safeStorage` surface is added or read.
- **[File / storage operations]** Not applicable, and stated rather than assumed: `conversationId` is a payload value and a `Map` key in `systemPromptWriteStore`, never a path, filename, cache lookup or React key; the prompt never becomes any of those either. No filesystem call is added.
- **[Inter-process / Electron attack surface]** No findings. **No new IPC arm, channel, `contextBridge` API, wire type or envelope** — both verbs (`requestSystemPrompt`, `setSystemPrompt`) ship today with their own IPC-boundary payload guards, and main enforces the byte bound independently with `Buffer.byteLength`. The renderer's `systemPromptOverLimit` is a typing-time courtesy, **not an authority**, and is imported from `CreateChannelDialog` rather than re-derived so a second authority cannot disagree with the first. Nothing here touches keys, sockets, `ipcRenderer` or raw frames.
- **[Inter-process / Electron attack surface]** RESIDUAL, stated rather than engineered around (the posture `confirmsPending` already takes): the row's `id` is daemon-asserted, so a hostile or impersonating daemon that picks its own conversation id could direct this write at a conversation of its choosing. No client-side compare of a field that same party supplies can prevent that, and it is the shipped exposure of every rename in this file — not something this ticket widens.
- **[Cryptographic primitives]** Not applicable. No RNG, key, nonce or handshake is touched. The two comparisons added (`draft === seed`, `event.conversationId !== conversationId`) are over non-secret display and routing strings, so `===` is correct and `timingSafeEqual` does not apply.
- **[Network & I/O]** No findings. No socket, URL, timeout or reconnect logic is added. The security-relevant choice is the ask: **one shot per open, never a retry, no `connected`-edge refresh** — `systemPromptBridge`'s header forbids a client-side retry against a relay that withholds the frame, because that is a self-inflicted spin driven by an on-path party. Checked for an amplification path and found none: the container remounts only on a fresh open, and a `connected` flap **closes** the dialog (`ChannelList`'s subscription clears `editChannelRow`) rather than reopening it, so a flapping host cannot pump asks.
- **[Error messages, logs, telemetry]** No findings, and this is the category that binds hardest here. **Nothing on this path logs, on any branch** — no diagnostic on either drop arm (one would have to carry a conversation id to be useful, and would imply a prompt's existence), and the write's `catch` is empty by design, `writePrompt`'s ruling verbatim. The container adds **no `sendDiagnostic` of its own**, unlike `CreateChannelDialog`: every field that would make one useful here (the id, the prompt, its length) is forbidden. The one diagnostic reached is `canMutateHost`'s, verified content-free — two client-owned constants, no id and no text — and the early return above keeps the refusal path at one emission rather than two. **The container must never switch exhaustively over `DaemonEvent`**: an `assertNever` `JSON.stringify`s the whole event into an `Error` message, which for this arm is the operator's prompt text on a path that can reach a console or a crash reporter. That is the bridge header's stated security decision, and reusing `translateSystemPrompt`'s `default: null` is how this plan inherits it.
- **[Error messages, logs, telemetry]** No findings on rendering. The prompt reaches exactly one sink, a controlled `<textarea value={…}>` — an escaped text child under `renderToStaticMarkup` and a DOM property in the browser. Never a serialized attribute, `dangerouslySetInnerHTML`, URL, filename, cache key or React key, and never an `aria-label` (CLAUDE.md's outright ban). Pinned by two named vitest assertions.
- **[Concurrency]** No findings. The listener is the only long-lived thing and its off-handle **is** the effect cleanup — the whole cancellation path, since nothing here starts a promise, timer or interval, so there is no `AbortController` to thread. There is no `await`, hence no check-then-act race across one. The one ordering hazard — a reply landing after the operator has typed — is closed by seeding **only while the cell is still `reading`**, a type-level arm rather than a guard. StrictMode's dev-only double-mount nets one live listener via that cleanup (the `announcedModelBridge` idiom) and two idempotent, reply-only asks in dev; the e2e tier runs the production bundle and sees one. **Do not "fix" that with a fired-once ref** — it would also suppress the fresh ask a reopen must fire, which is AC2.
- **[Threat model alignment]** Malicious relay: it can withhold the reply, which leaves the box disabled and the reading line up indefinitely — no hang (OK is never withheld), no plaintext leak, no spin. That is `SystemPromptSection`'s accepted posture for this reply-only frame and this ticket's AC1, named here rather than treated as a gap. Renderer compromise reaching the transport: unchanged, since nothing here holds a key, a socket or a raw byte. Token theft from disk: not applicable, nothing is persisted.
- **[Threat model alignment]** OUT OF SCOPE — a hostile daemon returning a multi-megabyte `system_prompt` would seed a very large text area. The size cap belongs to the transport's frame limit and the fail-closed decode upstream (#1230), not to a renderer control, and `SystemPromptSection` already seeds the same value with the same exposure. This ticket does not widen it and does not add a second cap that could disagree with the first.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15

## Documentation handoff

**Pending — the documentation stage owns this.** Fold the read, the reading gate, the never-withheld OK and the write rule into `docs/knowledge/features/edit-channel-dialog.md` (the page #1476 created, which already names this ticket as the owner of the **Channel system prompt:** field). The three findings in § Context are repeated in the PR's Lessons learned so the reasoning survives into that page. No file under `docs/knowledge/` is touched by this ticket.
