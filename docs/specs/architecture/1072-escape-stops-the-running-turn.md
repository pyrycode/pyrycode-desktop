# #1072 — Escape stops the running turn

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` → `shouldSubmitOnKeyDown`, `ComposerKeyEvent` — the
  keystroke-intent tier this ticket adds a sibling to. Its docblock already states the rule the new predicate
  inherits: **`return` on `false` before any `preventDefault()`**.
- `src/renderer/src/screens/conversation/sendInterrupt.ts` → `sendInterrupt`, `SendInterruptDeps` — the effect,
  unchanged. Bare command, no ids, swallowed bridge failure, no local dispatch.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` (`handleKeyDown`, `handleSubmit`),
  `ComposerSendButton`, `isTurnRunning`, `INTERRUPT_LABEL` — the two mount points and the gate they share.
  `phase` is already a prop of `Composer`, so the running reading needs no new plumbing.
- `src/renderer/src/screens/conversation/ComposerSlashCommandTypeAhead.tsx` → `useSlashCommandTypeAhead`'s
  `handleKeyDown` — the first claimant. It returns `false` on a composing keystroke *even while open*, which is
  what makes `isComposing` load-bearing in the new predicate rather than decorative symmetry.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx`, `WorkspacePickerSheet.tsx`,
  `DefaultWorkspaceRow.tsx`, and the two `document` listeners inside `ConversationScreen.tsx` (the channel-info
  sheet's and the thread overflow menu's) — **all five attach on mount and detach on cleanup, and each surface
  mounts only while open**. Confirmed by reading each effect: none carries an `open` flag, none is always
  attached. That is the fact the "bind inside the composer, no ordering work" design rests on.
- `e2e/queued-backlog-interrupt.spec.ts` → `interruptFrames`, `capturingQueueInterruptFake`, `turnStateFrame` —
  the interrupt drive's shape, and the source of the two hazards § Testing strategy answers.
- `e2e/slash-command-type-ahead.spec.ts` → `slashCommandListFrame`, `captureOutbound`, `panelOf` — how a fake-tier
  spec publishes a command list and locates the type-ahead panel. AC4's leg is built from this.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `seedConversationsFrame`, `launchPairedApp` — the launch, and
  the reminder that the seeded row is the open conversation at launch.
- `docs/knowledge/features/composer-send.md` § 7 (keystroke-intent gate) and § "DOM interaction is untested" — the
  standing deferral this ticket works within: `handleKeyDown`'s wiring has no vitest coverage by construction, so
  the wiring's proof is Playwright's and the decision's proof is `composerSend.test.ts`'s.
- `docs/knowledge/features/interrupt-envelope.md` — `sendInterrupt`'s contract; nothing in it changes here.

## Design source

**Figma:** N/A — the ticket declares no `## Figma` section, and correctly: this adds two event handlers and no
element, no class and no attribute. The visual-fidelity check is intentionally skipped.

## Context

Escape does nothing while claude is responding. The only stop is the send button's stop variant (#678), whose
`onInterrupt` is `sendInterrupt`'s sole caller in the app. This ticket adds two more callers of that same helper
and changes nothing else — no new state, no optimistic "stopping", no wire change, no IPC arm.

The one design question is **ordering**: Escape is already claimed by eight surfaces, and stopping a turn must be
the last claimant, never instead of a dismiss. The answer taken here is structural rather than arranged — see
§ Design.

No ADR is warranted. This is one predicate and two bindings inside a surface whose decisions
`docs/knowledge/features/composer-send.md` § 7 already records; the documentation phase folding it into that
overview is the right home.

## Design

### The decision — `shouldInterruptOnKeyDown` in `composerSend.ts`

A fifth pure predicate in the module, placed directly after `shouldSubmitOnKeyDown` because it reads the same
axis (*did this keystroke ask for something*) and the same input record.

```
shouldInterruptOnKeyDown(event: ComposerKeyEvent, turnRunning: boolean): boolean
```

Behaviour: true iff `turnRunning && event.key === 'Escape' && !event.isComposing`.

Three shape decisions:

- **It reuses `ComposerKeyEvent`, it does not mint a second record.** A near-duplicate interface would be a new
  exported type for one dropped field and a second shape for the container to destructure at a call site that
  already builds this one.
- **`shiftKey` is deliberately not read**, even though the record carries it. Escape has no meaningful shifted
  variant, and a `!shiftKey` clause would be a defence for a failure mode nobody has observed — the same
  evidence rule that kept `keyCode === 229` out of `shouldSubmitOnKeyDown`.
- **`turnRunning` is a second positional argument, not a field of the record.** The record models *the keystroke*;
  the gate is *the app's state*. Folding the two would make the container fabricate a synthetic key-event field
  and would make the `ComposerSendButton` call site — where the value is structurally `true` — read as if the
  button knew something about the keydown that it does not.

`isComposing` is load-bearing, not symmetry: the type-ahead's own handler returns `false` on a composing keystroke
*even while its panel is open*, so the Escape that cancels a half-typed IME candidate falls straight through to
the composer's handler. Without the flag a CJK operator cancelling a candidate mid-turn would stop the turn.

No `preventDefault()` anywhere on this path. Escape has no default action in a textarea, so there is nothing to
suppress; if one were ever added it would have to sit below the predicate's `false` return, the rule
`shouldSubmitOnKeyDown`'s docblock already states.

### Binding 1 — the message box, inside `Composer`'s `handleKeyDown`

Inserted between the type-ahead's claim and the submit gate:

1. `if (typeAhead.handleKeyDown(event)) return` — unchanged, and it is the whole of AC4. A consumed Escape
   returns before the interrupt branch is reached, so the first Escape closes the panel and sends nothing; the
   second meets a closed panel, is not consumed, and stops the turn.
2. **new** — build the `ComposerKeyEvent` off the event (`key`, `shiftKey`, `nativeEvent.isComposing`, exactly as
   the line below it already does), ask `shouldInterruptOnKeyDown(…, isTurnRunning(phase))`, and on `true` call
   `sendInterrupt({ sendCommand: window.pyry.sendCommand })` and `return`.
3. `shouldSubmitOnKeyDown` — unchanged. The two predicates are disjoint by key, so this ordering is a reading
   convenience, not a behavioural dependency; Enter's path (#678 AC4) is untouched either way.

The record is built once and shared by both predicates — one destructure, two questions.

`phase` is already a `Composer` prop, and `isTurnRunning(phase)` is already computed one screenful below for
`ComposerSendButton`. The gate is `isTurnRunning(phase)` **alone**: `localSendPending` opens the working-indicator
window while `phase` is still the daemon-owned `idle` (#650), so wiring it in here would arm an interrupt for a
turn the daemon has not started — the same reason the stop button ignores it.

`window.pyry` is dereferenced inside the handler, which runs at interaction time. Never during render, the
constraint `onInterrupt` already carries.

### Binding 2 — the stop control, inside `ComposerSendButton`'s running variant

An `onKeyDown` on the running variant's `<button>` that consults the same predicate and calls the existing
`onInterrupt` prop. No new prop: the component already receives the effect it needs, and the `isRunning` branch it
sits in is structurally the running state, so the predicate's gate is `true` at this site by construction.

Why it is not optional: Chromium focuses a `<button>` on click and `handleSubmit` only clears the text, so after a
mouse send the operator's focus is on the send control. Both variants render a `<button>` at the same position in
the same parent, so React patches the node in place rather than remounting and the focus survives the flip. Without
this handler Escape does nothing in exactly the state the operator most often reaches.

The handler renders no attribute, so `ComposerSendButton`'s shipped markup assertions are untouched by
construction — the same guarantee `handlePaste` already relies on.

### Why the ordering is free

Every other Escape claimant either sees the key first by the same mechanism Enter's send does (the type-ahead), or
takes focus when it opens. All five `document`-listener surfaces attach on mount and mount only while open, so
while one is open focus is inside it and neither binding is on the event's path at all. There is no open-state to
consult and no listener to sequence.

A `document`- or `window`-level interrupt listener is rejected: `document` listeners fire in attach order, so a
screen-mounted one would run before all five dismissals and stop the turn while the operator only meant to close a
menu; making that safe means either coupling the screen to five open-states or adding `preventDefault()` to all
five and moving to `window`. Both are real work, and neither is needed for the two states this ticket covers.

**Deliberately out of scope:** Escape still does nothing when focus is neither in the message box nor on the stop
control — after a click into the thread, or onto a footer menu trigger. Closing that gap needs the window-ordering
work above and is a follow-up.

## State + concurrency model

No store slice is added, read or written. No async work, no subscription, no timer, so nothing to cancel or tear
down. `sendInterrupt` is synchronous fire-and-forget over the existing command channel; the stop affordance
retracts on the daemon's next `turn_state{idle}`, exactly as it does for the button today.

## Error handling

Unchanged and inherited whole. `sendInterrupt` swallows a bridge failure with a content-free `console.error` and
propagates nothing, so a failed Escape behaves exactly as a failed stop-button click already does: no crash, the
turn keeps running, the stop affordance stays — the honest state, because the daemon never received the interrupt.
This ticket adds no branch that can fail and no new error surface. Nothing new is logged; the interrupt frame
carries no ids and no operator text.

## Testing strategy

**vitest — `composerSend.test.ts`.** The predicate's whole matrix over plain values, no DOM, no React (AC5):

- Escape while running → `true`.
- Escape at idle → `false`.
- Escape carrying `isComposing: true`, running → `false`.
- Every other key (`Enter`, `Enter` with shift, an ordinary character, `ArrowDown`) while running → `false` — the
  clause that leaves Enter's send path untouched.
- Escape with `shiftKey: true` while running → `true`, pinning the deliberate non-read above so a later "tidy"
  that adds a `!shiftKey` clause reddens.

**Playwright — a new `e2e/escape-interrupt.spec.ts`, fake tier, one launch, one continuous drive.**

A separate file rather than legs on `queued-backlog-interrupt.spec.ts`, taking the ticket's second option. That
file's `interruptFrames(captured)` running total is pinned at `.toBe(1)`, which a second interrupt falsifies, and
its drive ends with the turn back at `idle`. Both hazards are avoidable for the price of one launch, and a spec
whose subject is one keystroke reads better alone.

Leg order, chosen so each leg's premise is established by the leg before it:

1. **AC3, idle.** At launch (`phase` idle), focus the box and press Escape. Then the mutation check: fill and
   mouse-click Send, poll the captured `send_message` frame — a later, unrelated frame from the same
   renderer→wire path — and only then read the interrupt count as `0`. The zero is never a bare count.
2. **AC2, focus on the stop control.** The click in leg 1 left focus on the send control. Push
   `turn_state{thinking}`; the control becomes the stop variant in place. **Assert it is focused before pressing
   Escape**, so a wrong premise surfaces as a red rather than as a pass for the wrong reason. Escape → poll the
   interrupt count to `1`.
3. **AC1, caret in the box.** Still running. Click the box, type a draft, press Escape → poll to `2`, then assert
   the box's value is unchanged.
4. **AC4, type-ahead over a running turn.** Still running. Push a `slash_command_list` for `SEEDED_ROW.id`, put a
   `/`-fragment in the box, wait for the panel. First Escape → assert the panel is hidden (the positive,
   auto-waiting read downstream of that same keystroke), then read the count as still `2` — not a race with
   itself, the idiom `slash-command-type-ahead.spec.ts` already uses for its negative half. Second Escape →
   poll to `3`.

The count helper is a running total and the spec says so at its declaration; every leg asserts the total it
expects at that point, never a bare `1`.

Draft text carries no `/`, and the type-ahead fragment is introduced only in leg 4, so no earlier leg can open the
panel by accident.

**No renderer test.** The renderer tier is `renderToStaticMarkup` and fires no events, so the wiring is
unobservable there by construction — `composer-send.md`'s standing deferral. Both handlers render no attribute, so
no existing markup assertion moves.

## Open questions

- Does `box.fill('/c')` drive React's controlled `onChange` reliably enough to open the type-ahead, or does leg 4
  need `page.keyboard.type` as the sibling spec uses? Resolve by running the drive; fall back to `type`.
- Does anything move focus off the send control between the mouse click in leg 1 and the variant flip in leg 2?
  Reading says no (`handleSubmit` only clears the text), and leg 2's `toBeFocused()` assertion is exactly what
  turns that reading into a measurement.

Each is resolved during implementation; anything that changes the design above is recorded in a `## Revisions`
entry in the same commit as the code that departs.
