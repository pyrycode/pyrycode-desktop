# Save as channel takes a channel system prompt (#1429)

## Files read

- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` → `SaveAsChannelDialogView`,
  `SaveAsChannelDialog`, `requestPromoteConversation`, `isHostConnected` — the only production file
  this ticket changes. `onSave` is the single send site since #1436.
- `src/renderer/src/screens/channels/ChannelForm.tsx` → `ChannelForm` and its optional bundled
  `prompt` prop, plus the client-owned `SYSTEM_PROMPT_LABEL` / `SYSTEM_PROMPT_OVER_LIMIT` constants —
  the field, its accessible name and its notice already exist here; this ticket only passes the prop.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `systemPromptOverLimit` (the byte
  gate to reuse), `writePrompt` (the empty-`catch` precedent and its rationale), `confirmsPending`
  (the attribution gate this ticket deliberately does **not** need — see § Design).
- `src/renderer/src/store/systemPromptWriteBridge.ts` → `submitSystemPrompt`,
  `SubmitSystemPromptDeps` — record-marker-then-send, the verbatim tri-state, and the falsy-id guard
  that fails closed.
- `src/renderer/src/store/systemPromptWriteStore.ts` → the keyed write store the outcome lands in,
  read by the channel info sheet's `SystemPromptSection`.
- `src/main/daemonConnection.ts` → the `setSystemPrompt` arm's own `Buffer.byteLength` bound check —
  main is the authority on the limit; the renderer helper is a typing-time affordance.
- `src/shared/wire/types.ts` → `MAX_SYSTEM_PROMPT_BYTES`, `SetSystemPromptPayload`.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.test.tsx` → the case asserting the form
  renders no textarea, which #1428 wrote naming this ticket as the one that inverts it.
- `e2e/save-as-channel-promote.spec.ts` → `controlled`, `open`, both tests — the bare
  `getByRole('textbox')` locators that go ambiguous once a second text box exists.
- `e2e/sidebar-create-channel.spec.ts` → `nameField` / `promptField` locators and the
  capture-but-do-not-answer treatment of `set_system_prompt`; the precedent this spec follows.
- `docs/knowledge/features/save-as-channel-dialog.md` § What it does, § Requests and replies —
  both state the name field is the whole form and promote the only command; corrected by the
  documentation stage, not here.
- `docs/knowledge/features/create-channel-dialog.md` § The system prompt write (#1428) — carries the
  lesson that matters most to this ticket: the attribution gate there exists *because* that write
  rode an uncorrelated confirmation. This one does not, which is the whole difference.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2355

Under the **Save as channel** header, a filled **Channel name:** input with a **Channel system
prompt:** label and a taller filled text area directly beneath it, then the divider and the centered
Cancel/OK pair. The text area restates the name input's fill, corner radius and type at four lines of
body text; there is no counter, no helper line and no decoration. It is the same form #1428 drew for
Create channel ([node 487-2435](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2435)),
under a different title — the radio rows in the frame are hidden, #1436 having removed them. Every
token, class and rule it needs already ships in `channels.css` as `.create-channel__textarea` and
`.create-channel__notice`, so this ticket writes no CSS.

## Context

`SaveAsChannelDialog` renders the shared `ChannelForm` and passes no `prompt` prop, so it shows the
name field alone. #1428 put the field on that form behind one optional bundled prop and shipped the
byte gate, the styling and the write helper; this ticket passes the prop and sends the write.

The operator's reason is that a chat promoted to a channel should carry its instructions from the
moment it becomes one, rather than needing a second trip through the channel info sheet.

No ADR is warranted. This ticket adds no decision — it applies #1428's, and the one design question
it does answer (why no attribution gate) is a consequence of the promote flow that
`create-channel-dialog.md` and `save-as-channel-dialog.md` already describe.

## Design

**One production file: `SaveAsChannelDialog.tsx`.** Nothing else changes.

### The view

`SaveAsChannelDialogView` takes three further props, the shape `CreateChannelDialogView` already
uses: `systemPrompt: string`, `promptOverLimit: boolean`, `onSystemPromptChange: (next: string) => void`.
It passes `prompt={{ value, overLimit, onChange }}` to `ChannelForm` and widens OK's `disabled` to
`name.trim() === '' || promptOverLimit`. The prompt is optional, so an empty box never blocks OK;
only a value past the bound does. No `busy` arrives — this dialog has none, and `ChannelForm`
already disables the text area alongside the name field from the `busy` it is given, which stays
`false` here.

### The byte gate

`systemPromptOverLimit` is imported from `./CreateChannelDialog`, where #1428 exported it. **The
alternative — moving it and its `UTF8` encoder to `ChannelForm.tsx`, the module both dialogs already
import — is the tidier dependency shape and was rejected deliberately**: it is a refactor of adjacent
code, it would touch three production files and relocate a `describe` block for zero behaviour
change, and the project instruction is to touch only what the task needs. The cost of not doing it is
one import edge from this dialog to its sibling, recorded in a docblock so no later reader mistakes
it for an accident. A second byte counter is not on the table at all: it could only ever disagree
with the first, and main enforces the real bound independently with `Buffer.byteLength`.

### The container

One further state cell, `const [systemPrompt, setSystemPrompt] = useState('')`, and its derived
`promptOverLimit`. The box opens empty on every mount and is never seeded: `systemPromptStore` is a
single slot holding a value only for a chat the operator has actually opened, while a chat can be
saved from any row, so there is no prompt to seed from for most rows. An empty box sends nothing, so
a prompt the chat already holds is kept rather than cleared.

### The send

`onSave` keeps its existing guard and its existing promote, and gains the write after them:

```
guard (abandoned | not connected | blank name | over limit) → return
requestPromoteConversation(…)      // unchanged
sendDiagnostic('sidebar-promotion', 'sent')   // unchanged
writePrompt(row.id, systemPrompt)  // new
onPromoted()                       // unchanged
```

`writePrompt(conversationId: string, draft: string): void` is a module-level helper. It returns
early when `draft.trim() === ''`, so a blank or whitespace-only box sends nothing; otherwise it calls
`submitSystemPrompt` with `window.pyry.sendCommand` and a `dispatch` into `systemPromptWriteStore`,
passing the draft **verbatim and untrimmed** — the value round-trips to the daemon as a stored write,
and normalising it here would silently change what the operator saved. The blank/non-blank decision
is taken once, at send time.

**No attribution gate, and that is the ticket's substantive design decision.** #1428 needed
`confirmsPending` because its write could only ride an uncorrelated `conversationCreated`, so a
same-host confirmation for someone else's create would otherwise have carried the operator's text
onto a conversation they did not create. Here the conversation already exists and its `id` is
`row.id` — a prop this container already holds, never a value a reply supplies. Both commands leave
`onSave` synchronously, with no `await`, no event and nothing to match. Adding a gate would be
theatre over a hazard that does not exist on this path.

## State + concurrency model

No store slice is added, no subscription, no promise, no timer, no `AbortController`. The existing
`sessionStore` subscription and the `abandoned` ref are untouched, and the prompt draft is transient
`useState` in the same container — it dies with the unmount, which is what makes Cancel and the
header close discard it and a reopen start empty.

`onSave` is **fully synchronous** from guard to close: there is no `await` between the connectivity
re-check and either command, so the guard cannot go stale in a gap. That is what removes the
check-then-act race a two-step send would otherwise invite. Teardown is unchanged: effect cleanup
sets `abandoned` and removes the session subscription, and the write is fire-and-forget past that
point exactly as the promote already is — neither is undone by a dismissal, which is existing
documented behaviour.

The dialog does not wait for the write's acknowledgement and has no second failure surface. The
outcome lands in the app-level `systemPromptWriteStore`, where `SystemPromptSection` reports it when
the channel is opened. One write per promote, so `system-prompt-write.md` § Known limitation — two
writes in flight on one conversation being indistinguishable — is never reached.

## Error handling

`sendCommand` can throw locally. The `submitSystemPrompt` call is therefore wrapped in a
`try`/`catch` whose body is **empty by design**, following `writePrompt` in `CreateChannelDialog.tsx`
and for the same two reasons: an escaping exception would abort the `onPromoted()` below it,
stranding the dialog over an already-promoted chat, and it would carry the failed command — prompt
included — onto an error path this file does not control. There is nothing loggable in that catch
that is not forbidden, and the in-flight marker `submitSystemPrompt` records before sending is swept
by the write store's own `reconnected` arm.

The promote's own call stays unwrapped, exactly as today: if it throws, nothing is sent, the dialog
stays open and the operator can retry. That is pre-existing behaviour this ticket does not change.

A falsy `row.id` needs no new guard: `submitSystemPrompt` already refuses one, sending nothing and
recording nothing, so a marker can never be left for a write that cannot exist.

Rejection of the write by the daemon, or by main's own `prompt-too-long` verdict, is invisible to
this dialog — it has closed by then — and surfaces in `systemPromptWriteStore`.

## Testing strategy

**vitest — `SaveAsChannelDialog.test.tsx`** (static markup; the view is a pure function of its props):

- Invert the existing "renders the name field alone, with no system prompt field" case: the label,
  the text area and the shared `create-channel__textarea` class now render, between the name input
  and the modal actions.
- The injected prompt value renders as escaped text content, never live markup.
- The over-limit notice renders only when `promptOverLimit` is true, and OK is disabled alongside it;
  under the bound neither appears and OK is enabled for a non-blank name.
- A non-blank prompt with a blank name still leaves OK disabled.
- `systemPromptOverLimit` itself is already unit-tested by #1428 at empty, at the bound, one byte
  over and on a multi-byte value; it is not re-tested here.

**Playwright, fake-transport tier — `e2e/save-as-channel-promote.spec.ts`.** Static markup cannot
prove command order, the empty-box branch or draft discard; this tier can.

- `controlled()` captures `set_system_prompt` alongside the existing types and **leaves it
  unanswered** — this dialog never waits for the acknowledgement — and exposes a `writes()` reader
  over the captured payloads, the sibling spec's shape.
- `open()` and both existing tests move from bare `getByRole('textbox')` to `nameField` / `promptField`
  locators named by accessible name; an unscoped query is a strict-mode violation once two boxes
  exist. `open()` also asserts the prompt box is empty on every opening.
- One new test, three unpromoted rows in one launch (a promoted row loses its save affordance, so
  each successful OK consumes one row):
  - *empty* — probe the bound first: exactly `MAX_SYSTEM_PROMPT_BYTES` ASCII shows no notice and
    leaves OK enabled; two fewer bytes plus a 3-byte character shows the notice and disables OK at
    **fewer code units**, which is what separates a UTF-8 count from a `.length` one; clear the box,
    OK → one `promote_conversation`, no write.
  - *whitespace* — type a prompt, Cancel, reopen and assert the box is empty (the discard rule), then
    a whitespace-only box → promote only, no write.
  - *typed* — the drawn state captured at 1280×800 and at the 800px window minimum for the Figma
    comparison, then OK → `promote_conversation` for the row's `id` and `cwd`, then exactly one
    `set_system_prompt` for that same `id` carrying the text verbatim and untrimmed (leading and
    trailing whitespace and a multi-byte character on purpose).
  - A single ordered assertion over the captured request types closes the test: it is what pins
    "exactly one write, immediately after its own promote, and nowhere else".

Fakes, not mocks, at the transport seam throughout — the spec drives the real fake relay and decodes
real envelopes.

## Open questions

- Whether to move `systemPromptOverLimit` to `ChannelForm.tsx`. **Resolved in § Design:** no — it is
  an adjacent-code refactor with no behaviour change, and the import edge is documented instead. A
  later ticket can make the move deliberately if a third consumer appears.
- Whether the write needs its own diagnostic code. **Resolved:** no. A static code would be
  permissible, but no failure on this path has been observed, and `sidebar-promotion: sent` already
  marks the send.

## Documentation handoff

Pending for the documentation stage; not written here.

Fold the field into `docs/knowledge/features/save-as-channel-dialog.md`. Three places state the
superseded contract and all three need correcting:

- § What it does — "`ChannelForm` supplies the filled input, and nothing else" and the OK paragraph
  describing promotion as the only send.
- § Requests and replies — "`onSave` dispatches the command and calls `onPromoted` synchronously";
  a second command now precedes the close.
- The opening cross-reference — "[Create channel](create-channel-dialog.md) shares the same
  name-only form" is no longer name-only for either dialog.

Also correct the reciprocal line in `docs/knowledge/features/create-channel-dialog.md` § Related,
which says Save as channel "renders the shared `ChannelForm` with no `prompt` prop, so it never gains
the text area", and its § What it does claim that "this dialog alone (not Save as channel)" renders
the field.

## Security review

**Verdict:** PASS

The asset this ticket handles is operator-authored text that may hold a pasted credential — that is
the premise `ChannelForm`'s own security docblock already states, and every finding below is measured
against it rather than against the text being innocuous.

**Findings:**

- **[Trust boundaries]** No findings. The renderer→main hop is the only boundary the prompt crosses,
  it is pre-existing, and it is not the authority on the bound: `daemonConnection.ts`'s
  `setSystemPrompt` arm re-measures with `Buffer.byteLength(prompt, 'utf8')` before the connected
  guard and before any frame is built, and refuses independently. `systemPromptOverLimit` in the
  renderer is a typing-time affordance, and this plan adds no second counter. The **inbound**
  direction is worth naming positively: because the box opens empty and is never seeded from
  `systemPromptStore`, no daemon-supplied prompt text enters this dialog at all — a rule adopted for
  a product reason that also keeps an untrusted-text path from existing here.
- **[Tokens, secrets, credentials]** No findings. The draft lives in one `useState` cell in
  `SaveAsChannelDialog` and dies with the unmount. Nothing on this path touches `localStorage`,
  `sessionStorage`, IndexedDB, a persist middleware or disk; no token is read, minted or compared.
  `systemPromptWriteStore` records only a per-conversation in-flight marker and has **no field that
  could hold the prompt** — checked against the store's own event shapes, not assumed.
- **[File / storage operations]** Not applicable, by a design decision rather than by luck: the
  prompt reaches exactly one sink, the controlled `<textarea value={…}>`, and is never composed into
  a path, filename, cache key, React `key`, attribute or URL. `row.cwd` continues to pass verbatim to
  the promote, unchanged by this ticket, and no client-side path is constructed anywhere in the flow.
- **[Inter-process / Electron attack surface]** No findings. No new IPC arm, channel, `contextBridge`
  method or wire type. `submitSystemPrompt` builds a fresh two-field literal — never a spread of a
  caller's object — so the renderer cannot widen the wire surface. No window is created and no
  `webPreferences` touched.
- **[Cryptographic primitives]** Not applicable. No randomness, key, nonce or MAC. The only
  comparison the new code makes is `draft.trim() === ''` against a literal empty string, which is not
  a secret, so constant-time comparison does not apply.
- **[Network & I/O]** No findings. Two fire-and-forget commands over the already-established Noise
  session; no new socket, timeout, retry or unbounded read. The value is bounded twice, client-side
  for the affordance and in main for real.
- **[Error messages, logs, telemetry]** The sharpest category here, and the reason the empty `catch`
  in `writePrompt` is load-bearing rather than stylistic. An exception escaping `sendCommand` would
  carry the failed command — the prompt inside it — onto an error path this file does not control
  (a boundary, a console, a future reporter), *and* would abort the dismissal. The plan catches it
  and logs nothing, because every field that would make a log useful here (the prompt, the
  conversation id) is forbidden. The diagnostic on this path stays the static
  `sidebar-promotion: sent`, with no fields; the over-limit notice is a client-owned constant in
  `ChannelForm`, never daemon text. No finding outstanding — but this is the one place a careless
  implementation leaks, so the verifier should check the `catch` body is genuinely empty and that no
  diagnostic gained a field.
- **[Concurrency]** No findings, and the reason is structural: `onSave` runs guard → promote → write
  → close with **no `await` anywhere in it**, so the connectivity re-check cannot go stale before
  either command, and there is no second entry point that could interleave. No promise, timer,
  interval or subscription is added, so nothing new needs cancelling; the existing session
  subscription and `abandoned` ref keep the teardown they have.
- **[Threat model alignment]** Walked, with one conclusion worth stating rather than assuming.
  *Hostile or compromised relay:* content-blind, holding only Noise ciphertext; it can drop, delay or
  reorder, in which case the write is lost and reports as unsettled in `systemPromptWriteStore` —
  the same exposure the shipped write path already carries, not a new one. *Hostile or impersonating
  daemon:* it can ignore or refuse the write, but **it cannot redirect it**, because the target
  `conversation_id` is `row.id`, a value this client already holds, never one a reply supplied. That
  is exactly why #1428's `confirmsPending` gate is absent here and why its absence is safe: the
  misattribution hazard it closes is created by taking an id off an uncorrelated confirmation, and
  this path never does. *Renderer compromise:* would already own any text the operator types; process
  isolation keeps it away from keys, the token and the socket, unchanged by this ticket. Nothing is
  deferred to a future ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15

## Revisions

### 2026-09-15 — the new e2e coverage is two tests, not one with three seeded rows

§ Testing strategy planned "one new test, three unpromoted rows in one launch". That is not
buildable: `launchPairedApp` bootstraps by clicking an **unfiltered** `.channel-list__row-open` under
Playwright strict mode, so a launch seeded with more than one row fails inside the fixture before the
spec's first line runs. The plan's premise — that a promoted row frees its index for the next seed —
was right; what it missed is that the rows have to exist at launch, and only one may.

Teaching the shared fixture to seed more was rejected: 29 specs pass through it, and widening a
shared bootstrap for one spec's convenience is a blast radius far larger than this ticket.

The coverage is therefore split in two, with no case dropped:

- *a typed prompt rides the promotion, addressed to the promoted row* — one host, one row. Carries
  the byte gate (at the bound, one 3-byte character over at fewer code units, notice + disabled OK),
  the Figma captures at 1280 and at the 800px minimum, and the write.
- *an empty or whitespace-only box promotes exactly as before and sends no write* — two hosts, one
  row each, so both blank arms get a promotable row. Carries the discard-on-dismiss check too.

This made the ordered request assertions **stronger** rather than weaker. The planned single array
would have read `['promote', 'promote', 'promote', 'set_system_prompt']`, in which "the write goes
out immediately after its own promote, and nothing else goes out" is an inference about position.
Split, the typed test asserts exactly `['promote_conversation', 'set_system_prompt']` and each blank
arm asserts exactly `['promote_conversation']` — the same claim stated directly.

No production code changed as a result; § Design stands as committed.
