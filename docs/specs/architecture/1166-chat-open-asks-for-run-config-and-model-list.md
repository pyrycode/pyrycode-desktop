# #1166 — Opening a chat asks the daemon for its run configuration and model list

Every activation of a conversation sends exactly one `requestSessionSettings` and exactly one
`requestModelList` naming that conversation, so the composer footer's controls are live from the moment
a chat opens instead of only after a turn has ended. It also corrects the four merged source comments
that state the model-list path has no request half, two of them as a standing prohibition.

## Files read

Production:

- `src/renderer/src/activateConversation.ts` → `activateConversation`, `ActivateConversationDeps` — the
  seam. It already clears the session id on a switch; the requests join it so the value it wipes is
  re-asked for in the same move. Its docblock's CROSS-WIRE NOTE governs how a new
  `(conversationId: string) => void` member may be added.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`, `PairedShell` — the one production deps site, and
  the two carrying nav sites (`useConversationCreatedNav`'s callback and `onOpen`).
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `requestRunConfigSnapshot` — the
  existing run-config sender and the exact shape the model-list sender mirrors, falsy guard included.
  Also `subscribeRunConfig` / `toSnapshotSessionId`, which land the reply in both stores.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `createRunConfigRefreshTrigger`,
  `subscribeRunConfigRefresh`, `RunConfigLiveData` — the two existing refresh edges AC3 must leave
  untouched, and the header's import-cycle rule (nothing under `ConversationScreen`'s graph may be
  imported from the activation path).
- `src/renderer/src/store/modelListBridge.ts` → the header's "no request half … and none may be added",
  `translateModelList`, `subscribeModelList`, `ModelListData` — the chosen home for the new sender and
  the sharpest of the four comment corrections.
- `src/renderer/src/store/modelListStore.ts` → the header's "no request half on this path and there must
  never be one", plus the second copy in the `connected`-edge paragraph.
- `src/renderer/src/App.tsx` → the `ModelListData` leaf's comment, "no gate, no request half".
- `src/renderer/src/clearPairingScopedState.ts` → the #977 paragraph whose stated reason ("blanking it
  there would blank it permanently") this slice falsifies.
- `src/shared/ipc/commands.ts` → `RendererCommand`'s `requestModelList` member,
  `isRequestModelListPayload` — #1165's boundary guard, which accepts `''` structurally and leaves the
  behavioural refusal to the sender. Its `@#1166` forward reference names this slice as the trigger.
- `src/shared/wire/types.ts` → `SessionSettingsPayload`, `RequestModelListPayload` — the reply carries
  **no** conversation id, which is what makes late-reply filtering impossible here (see § Error handling).
- `src/shared/ipc/events.ts` → the `runConfigReceived` arm — likewise carries no conversation id.

Reference:

- `docs/specs/architecture/1165-request-model-list-command.md` § "Prohibitions this slice does not
  violate" — assigns the four-file correction here in a committed spec, and states exactly what survives
  it (the no-retry rule, best-effort delivery, never block a menu on the frame).
- `docs/knowledge/features/model-list-store.md`, `run-config-store.md`, `session-id-store.md`,
  `composer-model-menu.md`, `composer-effort-menu.md`, `composer-permission-mode-menu.md` — the package
  overviews for the stores and the three footer controls this changes the arrival timing for.

E2E (the six specs that answer `request_session_settings` in `buildReplyFrames` and assert a control is
absent before pushing a turn): `e2e/composer-model-menu.spec.ts`, `e2e/composer-effort-menu.spec.ts`,
`e2e/composer-permission-mode-menu.spec.ts`, `e2e/composer-permission-mode-auto.spec.ts`,
`e2e/composer-model-announced.spec.ts`, `e2e/composer-context-severity.spec.ts`. Plus
`e2e/fixtures/launchPairedApp` → `launchPairedApp`, `SEEDED_ROW` — it navigates by CLICKING the single
seeded row, which is why activation fires at launch in every fixture-riding spec.

Checked and unaffected: `e2e/run-config-settings.spec.ts`'s envelope count is
`toBeGreaterThanOrEqual(1)`; a repo-wide sweep for `count(0)` on `.composer__context` /
`.composer__model-label` / `.composer__effort-label` / `.composer__permission-label` finds nothing
outside the six.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3660

A 328×16 single row — the composer footer, reading `Actions ⌃ · Auto ⌃ · Opus ⌃ · Max ⌃ · Context: 84%`
left to right: the actions menu, then the permission mode, model and effort triggers each with a chevron,
then the context reading. Every one of those four right-hand items is populated from the run-configuration
snapshot, which is exactly the state this slice makes exist at chat open.

**This slice emits no markup and changes no styles.** The row, its classes, its tokens and its typography
all shipped with #683 / #682 / #1062; what changes is only *when* the data behind it arrives. No
`get_design_context` fetch was made because there is no component to translate and no token to map — the
node is echoed so the verifier can see which surface the behaviour serves, and the visual-fidelity check
reduces to "the row is unchanged".

## Context

Both reads are triggered by edges a freshly opened chat does not cross.

`requestRunConfigSnapshot` fires on exactly two edges (`createRunConfigRefreshTrigger`): a rising edge to
`connected`, and each running → not-running turn transition. Opening a conversation is neither. The
`session_settings` reply is also the only thing besides the unsolicited `sessionTransition` marker that
fills `sessionIdStore`, and `activateConversation` **clears** the session id on every switch — so a chat
that has never had a turn has no addressable session id, every write is dropped, and the footer's
controls sit blank and inert. Since pyrycode#2085 the daemon answers `request_session_settings` for a
never-messaged conversation with that conversation's own bound `session_id` and its stored model, effort
and permission mode, so the ask is now worth making immediately.

`model_list` arrives unsolicited from a conversation's `initialize` reply or in the connect-time
reconcile. A chat created after this app connected gets neither, so `modelListStore` holds no entry for
it and the effort menu is inert. #1165 merged the verb to ask with — command, boundary guard, envelope
builder, connection method, routed dispatch — and shipped it with no renderer sender at all.

No ADR is warranted. This adds a third trigger to an existing request lane and a sender to an existing
command; the decisions that would deserve a record (the reply-only `session_settings` lane, the push-only
model-list lane, the no-retry rule) are already recorded and are all left standing.

## Design

### 1. `src/renderer/src/store/modelListBridge.ts` — the request half

```ts
export function requestModelList(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void
```

A faithful `requestRunConfigSnapshot` twin: fires exactly one `requestModelList` command naming
`conversationId`, and for a falsy id fires **nothing**. Fire-and-forget — `sendCommand` is `void`, so
there is nothing to await, no promise, no timer, no correlation record.

`RequestModelListPayload.conversation_id` is required end to end, so there is no unnamed variant to fall
back on: not sending is the whole of the no-conversation branch, exactly as it is for the run-config
sender. `''` takes the same branch as `null` under one falsy check — it is the same failure spelled
differently, and `isRequestModelListPayload` deliberately still accepts it structurally because refusing
an unaddressable id is a behavioural decision that belongs where a spy can reach it.

**Home:** this file, not a new module. It is the model-list path's own module, the receive half already
lives here, and it is one of the four files whose "no request half" claim this slice corrects — so the
correction and the code that makes it true land side by side rather than one file apart. It adds a
type-only import of `RendererCommand` and no runtime import; nothing here imports `ConversationScreen`'s
graph, so no cycle.

### 2. `src/renderer/src/activateConversation.ts` — one new deps member

`ActivateConversationDeps` gains a **seventh, required** member:

```ts
requestConversationConfig: (conversationId: string) => void
```

Called last, **outside** the id gate, so every activation asks — including a re-open of the chat that is
already open (AC1). Both replies are whole-value replaces, so a duplicate costs nothing and needs no gate.
After `setActiveConversation` / `stampLastRead` / `markViewed`, so the request goes out only once the
store writes have settled and the read order a reader expects (clear → activate → stamp → mark → ask) is
preserved.

**One member, not two.** The two requests are one act — re-ask for what the switch just invalidated — they
always fire together, and neither is meaningful for the footer without the other. One member also holds
the count of identical `(conversationId: string) => void` members at three rather than four. The docblock's
CROSS-WIRE NOTE is extended accordingly: a swap of this member with `stampLastRead` or `markViewed`
compiles and survives every `toHaveBeenCalledWith(conversation.id)` assertion, and what catches it is that
the three land in different places — with real deps wired, one conversation goes unstamped or unmarked
*and* no request is sent, so #777's, #786's and this slice's tests fail together.

**Required, not optional**, for the reason the two stamps are: `activateDeps` is module-private and no
renderer spec in this repo can run an effect, so the wiring itself is structurally uncoverable and `tsc`
is the whole safety net.

AC2's "no usable id" is the empty-string case and it is the only one this function can see — it takes a
conversation, so a caller with nothing to name never reaches it. The third `{ type: 'open' }` dispatch
site, the notification-activated nav (#393), carries no conversation and does not call this function at
all, so it sends nothing by construction rather than by a branch. The gate itself lives in the two
senders, each already refusing a falsy id, so `activateConversation` gains no branch of its own.

### 3. `src/renderer/src/PairedShell.tsx` — the wiring

`activateDeps` gains one arrow that calls both senders in sequence with `window.pyry.sendCommand`. It
touches `window.pyry` only inside the arrow body — the `getState()` idiom every other member already
uses — so nothing is dereferenced at module load or during render and the container stays
server-renderable and store-subscription-free. Two visibly different named calls, no branch, no local
state: the decision each one encodes is inside the sender, where a test reaches it.

Neither import closes a cycle. `runConfigSnapshot.ts` imports only types; `PairedShell` already sits above
`ConversationScreen`, which is what `runConfigLive.ts`'s header actually forbids importing *from* the
activation path.

### 4. The four comment corrections (no behaviour)

pyrycode#2125 supersedes the prohibition on *any* request half. It does not touch the reasoning underneath
— no client-side retry against a relay withholding the frame, delivery still best-effort, a conversation
with no list still a normal permanent state, no consumer may block a model menu on this frame. A one-shot
ask on activation is not a retry. **Correct the prohibition; leave the no-retry rule standing.** Deleting
both would be a security regression.

- `modelListBridge.ts` — the header's "there is NO request half … and none may be added. That is a
  security decision" and the second copy in `subscribeModelList`'s docblock ("nothing on this path can
  re-fetch"). Both become: there is a request half, it is this file's `requestModelList`, it is one-shot
  and fired only on conversation activation, and it is never a retry.
- `modelListStore.ts` — the "there must never be one" sentence and the `connected`-edge copy.
- `App.tsx` — the `ModelListData` leaf's "no gate, no request half — the list is pushed, never asked
  for". The leaf itself stays reactive-only: the sender is not mounted here.
- `clearPairingScopedState.ts` — the sharp one, and a **comment fix, not a behaviour change**. Its stated
  reason rests on "blanking it there would blank it permanently", which is now false. The
  `connected`-edge answer is still correct for a reason the comment does not yet give: the ask is
  per-conversation on activation, so a `connected`-edge clear would still blank every *background*
  conversation's list with nothing to re-assert it. Correct the stated reason; this is not licence to
  start clearing on `connected`.
- `modelListBridge.test.ts` carries the same claim in the `connected`-reset test's comment and rides the
  same sweep. That test's assertion is unchanged and stays pinned.

Neighbouring push-only paths (`slashCommandListStore` / `slashCommandListBridge`, `announcedModelStore`,
`backgroundTaskRosterBridge`, `queueBridge`, `sessionIdBridge`, `relayLinkBridge`,
`conversationActivityBridge`) carry the same sentence about their own frames and every one is still true.
They are not touched.

## State + concurrency model

No new store slice, no new state, no async task, no timer, no listener, no subscription. Both sends are
synchronous and fire-and-forget, so nothing owes an `AbortSignal` or a teardown handle and there is nothing
to cancel. The replies land through the app-lifetime subscribers already listening —
`subscribeRunConfig` inside `RunConfigLiveData`, `subscribeModelList` inside `ModelListData` — neither of
which this slice edits.

Ordering needs no designing around. Both requests are whole-value replaces on arrival, and the two frames
ride one ordered Noise session, so a request sent later is answered later. The activation path is fully
synchronous on the renderer's single thread, so the clear, the set and the two sends cannot interleave
with another activation.

AC3 is a *non-change*: `createRunConfigRefreshTrigger` and `subscribeRunConfigRefresh` are untouched, and
`RunConfigLiveData`'s edge arrow still resolves the active conversation at call time, so the two existing
edges fire exactly as they do today and still name the active conversation.

## Error handling

No new failure mode is introduced; every one is already handled by a layer this slice does not edit.

| Failure | Layer | Behaviour |
|---|---|---|
| Activation with an empty conversation id | the two senders' falsy guard | nothing sent, no throw, no log |
| Malformed command reaching main | `isRendererCommand` / `isRequestModelListPayload` | dropped at the boundary, no frame |
| Id no live connection hosts | `conversationRouter.route` | `null` having already refused and logged; nothing sent |
| Not connected when the command arrives | `daemonConnection` (`driver === null`) | inert no-op; the next activation re-asks |
| Daemon never answers either request | — | the pre-existing permanent state: `null` from the model-list selector, controls inert. No retry, no spinner, no timer |

**The late reply, and why this slice narrows rather than widens it.** `SessionSettingsPayload` carries no
conversation id and neither does the `runConfigReceived` event, so a reply cannot be attributed to the
conversation it describes without an `in_reply_to` correlation map spanning main, the event channel and
the bridge — out of scope, and not needed. Switching A → B while an A-triggered request is in flight lands
A's snapshot and A's session id in the app-singleton stores after B is active. That window is
**pre-existing** (the `connected` and turn-end edges already produce it) and today it *latches*: the
switch to B sends nothing, so the wrong session id stands until B's first turn ends. After this slice B's
own request is already in flight behind A's on the same ordered stream, so the wrong value is corrected
one round trip later. The exposure shrinks from unbounded to one round trip, and the act that opens the
window is the same act that closes it.

Nothing on either path logs. No diagnostic is added: the only value one could carry is the conversation
id, which ADR 0007's content-free rule keeps out of the renderer console.

## Testing strategy

All vitest (node environment) plus edits to six existing Playwright specs. No new renderer markup, so no
new `renderToStaticMarkup` spec; no new interaction, so no new Playwright spec.

**`src/renderer/src/store/modelListBridge.test.ts`** — `requestModelList`, against a spy:

- sends exactly one command, of type `requestModelList`, whose payload names the given id verbatim
- `Object.keys(payload)` is exactly `['conversation_id']` (no field smuggled onto the wire)
- `''` sends nothing; `null` sends nothing — the two asserted separately, so a guard that handles only
  one is caught
- the `connected`-reset test's stale comment corrected, its assertions untouched

**`src/renderer/src/activateConversation.test.ts`** — extends `spyDeps`, the ordering-literal deps object
and `realDeps` with the new member (four sites in total, counting `PairedShell`):

- a switch A → B calls `requestConversationConfig` exactly once, with B's id
- a re-open of the already-active conversation calls it exactly once, with that id — the AC1 clause the
  outside-the-gate placement exists for
- the ordering literal grows to `['reset', 'clearSessionId', 'set', 'stamp', 'markViewed', 'requestConfig']`,
  pinning that the ask follows the clear rather than preceding it (a reply arriving before the clear would
  be wiped by it)

**E2E, and the red is the proof rather than a regression.** All six specs ride `launchPairedApp`, which
navigates by clicking the single seeded row, so activation — and now the two requests — fire at launch.

- `composer-model-menu`, `composer-effort-menu`, `composer-permission-mode-menu`,
  `composer-permission-mode-auto` — the label's `toHaveCount(0)` before the pushed turn goes, and the
  comment above it (which spells out the old causal chain in full) is rewritten to say the snapshot now
  arrives on conversation open. The pushed `thinking` → `idle` pair stays: it is still the turn-end edge,
  and the assertions after it still read the inert arm, whose claim ("no list has arrived") is unchanged.
  Their footer-anchor counts are unaffected — those specs already expect the permission-mode control to be
  operable, because they already had a snapshot by that point.
- `composer-model-announced` — its two absence assertions become presence assertions of the launch state:
  the label shows the snapshot's stored model verbatim on the inert arm, and the context reading is
  mounted. That strengthens its AC1 claim rather than weakening it — the announcement is now seen
  *displacing* a stored choice instead of filling a void. Its post-announcement anchor count moves 1 → 2,
  because the permission-mode control is operable from launch now. Its AC2 step loses the context reading
  as a barrier (the fake answers every request identically, so the reading cannot move); it is replaced by
  an `expect.poll` over the captured envelopes for the second `request_session_settings`, the same capture
  idiom the spec already uses for `set_session_settings`.
- `composer-context-severity` — the hard one, because the absence is that drive's stated proof that each
  severity step was produced by the cycle preceding it. The premise is **re-established, not deleted**:
  the `usedTokens` variable is initialised to a fourth, launch-only figure whose reading text differs from
  all three steps, and the drive opens by asserting that text. The absence proof becomes a *presence*
  proof — the launch reading can only exist because the app asked on open, which is this ticket's AC1 —
  and every step still differs from what preceded it, so no cycle can pass vacuously.

The unanswered `request_model_list` falls through every fake's `default: return []` and is inert, so
`composer-model-menu`'s AC4 inert arm still holds: nothing answers it, and no `model_list` frame arrives
early.

## Open questions

1. **Does the launch-time reply reach `composer-context-severity`'s fake before its `usedTokens` variable
   is first mutated?** It must, or the drive desyncs. Expected yes — the variable is initialised before
   `launchPairedApp` is called and is mutated only inside the loop, which the launch assertion gates. To
   be confirmed by running the spec.
2. **Do any of the six specs' anchor / `aria-haspopup` counts move that this plan has not predicted?** Only
   `composer-model-announced`'s is expected to. To be confirmed by running all six.

Each is resolved in Phase B and recorded in a `## Revisions` entry if it changes the design.

## Size

Six production source files against a ceiling of five, and the overage is **entirely the four
comment-only files** (`modelListStore.ts`, `App.tsx`, `clearPairingScopedState.ts`, and the header half of
`modelListBridge.ts`). They cannot be their own ticket: prose changes nothing observable, no gate reddens,
and the correction is only *true* once the sender lands — which is precisely why #1165 declined to make it
and assigned it here in a committed spec. Splitting by request kind does not help either; whichever child
adds a sender inherits all four. The floor beats the ceiling, so this ships as one ticket with the overage
stated. Every other boundary holds: three behaviour files, one new exported function and no new type, four
consumer sites for the widened deps interface (well under ten), five acceptance criteria, one reject
branch per sender.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding. The value crossing the renderer→main boundary is one conversation
  id — daemon-asserted text held in the app's own conversation state, identical in provenance to the id
  `RunConfigLiveData` already sends, because `activateConversation` fills `activeConversationStore` from
  the same payload. It is used ONLY as a payload value: this slice adds no map, no `Set`, no object
  indexed by it, so no daemon-supplied `__proto__` reaches a prototype setter, and it is never a
  filename, a URL, an attribute, a cache key or a log field. `onOpen` hands over a `ConversationSummary`
  (a structural superset of `ConversationCreatedPayload`), and the senders take a `string`, so no
  superset field can ride along. Downstream it is re-proven by `isRequestModelListPayload` /
  `isRequestSessionSettingsPayload` at the boundary, refused by `conversationRouter.route` when no live
  connection claims it, and serialised by `buildRequestModelList` as a FRESH one-field literal — never a
  spread of the caller's object — so a field smuggled past the structural guard is dropped rather than
  sent.
- **[Tokens, secrets, credentials]** Not applicable, by construction rather than by omission: neither
  command carries or reads a credential, nothing on this path touches `safeStorage`, the device token or
  the keypair, and no value here has a lifecycle to rotate, revoke or expire.
- **[File / storage operations]** Not applicable. No filesystem access, no persistence, no path is built
  from any input. `stampLastRead`'s `localStorage` write is untouched — this slice adds a deps member
  beside it and changes neither its inputs nor its ordering.
- **[Inter-process / Electron attack surface]** No finding, and the adversarial check is worth stating:
  a compromised renderer gained the ability to call `sendCommand({ type: 'requestModelList', … })` the
  moment **#1165** merged, since the command, its guard and its main-process dispatch exist whether or
  not production code fires them. This slice adds no channel, no `contextBridge` API and no
  `ipcMain.handle`, so it expands renderer capability by exactly zero — it only exercises what already
  shipped. No window options change; the transport, keys and sockets stay in the background process.
- **[Cryptographic primitives]** Not applicable. Nothing here touches the Noise session, the key
  schedule, a nonce counter, or any comparison against a secret.
- **[Network & I/O]** Finding named, no change required. `useConversationCreatedNav` turns a
  daemon-pushed `conversation_created` into an activation, so after this slice one inbound frame
  produces two outbound ones — a 1:2 daemon-driven amplifier that did not exist before (activation used
  to write stores only). It is bounded and benign: a constant factor, linear in the daemon's own sends,
  on fixed-shape envelopes, with no retry, no timer, no queue and no pending-request map, so nothing
  accumulates. The amplifier is reachable only from inside the Noise session — the relay is on-path but
  content-blind and cannot inject `conversation_created` — so the only actor who can drive it is the
  authenticated daemon, amplifying traffic toward itself. Frame caps, TLS, timeouts and reconnect
  backoff are all inherited unchanged.
- **[Error messages, logs, telemetry]** No finding. Both senders are log-free on every branch and this
  slice adds no diagnostic anywhere: the only value one could carry is the conversation id, which ADR
  0007's content-free rule keeps out of the renderer console (readable by anything that can open
  DevTools). No new `switch` and no `assertNever`, so no daemon-controlled string can reach an exception
  message.
- **[Concurrency]** No finding. Both sends are synchronous and fire-and-forget — no promise, no timer,
  no listener, no subscription — so nothing outlives the activation and nothing owes an `AbortSignal`.
  There is no `await`, hence no check-then-act race across one. The whole activation runs to completion
  on the renderer's single thread, so two activations cannot interleave.
- **[Threat model alignment — hostile relay]** Addressed. The design makes no liveness assumption: a
  dropped, delayed or reordered request or reply produces no traffic and no state, because there is no
  retry, no timeout and nothing blocking on either frame. A conversation that never receives a
  `model_list` stays the normal permanent `null` the store already reports.
- **[Threat model alignment — hostile daemon / forged reply]** No finding, and the absence of
  correlation is inherited rather than newly decided. Both replies are accept-unsolicited by contract —
  `model_list` arrives in the connect-time reconcile burst outside any request, and `session_settings`
  is already answered on two edges — so a daemon that can forge one can push the identical frame today
  through a lane this slice does not touch. Content is defended where it matters: `ModelListPayload`
  reaches the renderer through the fail-closed narrower (#971–#973), never a bare `as`, and a model
  value sent back on `set_session_settings` is re-validated daemon-side.
- **[Threat model alignment — renderer compromise reaching the transport]** No finding. Process
  isolation is unchanged; the renderer's whole reach on both paths stays one validated string per
  command, and no raw byte, key or socket becomes reachable from the web layer.
- **[OUT OF SCOPE → #1176]** A `session_settings` reply carries no conversation id
  (`SessionSettingsPayload`), and neither does the `runConfigReceived` event, so `subscribeRunConfig`
  attributes a late reply to whatever conversation is active when it lands. Switching A → B with an
  A-triggered request in flight can therefore show A's values in B's footer and leave `changeSetting`
  addressing A's session — the hazard `activateConversation`'s docblock names. **Pre-existing** (the
  `connected` and turn-end edges already produce in-flight replies) and **not widened per occurrence**
  by this slice: before it, a switch to a never-messaged B sent nothing, so a late A reply latched until
  B's first turn ended; after it, B's own request is already in flight behind A's, so in-order replies
  correct it one round trip later and reordered ones are no worse than today. What this slice does
  change is the FREQUENCY — the scenario used to need a turn to have just ended in A, and now every
  switch produces a catchable request. Fixing it needs a daemon-side `conversation_id` on the payload or
  an `in_reply_to` correlation map spanning main, the event channel and the bridge; filed as **#1176**
  and deliberately not attempted here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
