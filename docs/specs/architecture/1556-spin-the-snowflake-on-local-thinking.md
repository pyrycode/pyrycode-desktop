# #1556 — spin the snowflake when the local Thinking label appears

One guard, one call site. The status row's icon gate widens from the daemon's raw phase reading to
"the daemon is running **or** the label currently reads Thinking". Nothing else moves.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerStatusArea` — the row; its
  `isRunning` prop is the icon's turning gate and the only thing this ticket changes.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `workingIndicatorStateWithLocalSend` —
  the label's derivation, and the one place the locally-opened window (#650) is decided. The icon must
  read that decision rather than re-derive it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `workingIndicatorState`,
  `shouldShowThinking` — the supersede order that makes `'thinking'` provably imply a running turn on the
  daemon path; the property the new guard leans on.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `isTurnRunning` — the shipped gate,
  shared with `ComposerSendButton`'s stop variant. It stays the stop affordance's sole gate (AC2).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `openToolCall` —
  the container, and the `const openTool = openToolCall(items)` precedent for hoisting one derived value
  out of the JSX.
- `src/renderer/src/store/threadTimeline.ts` → the `turnState` arm — where `localSendPending` is cleared.
  Any daemon `turn_state`, `idle` included, closes the local window, which is what makes the animation
  stop at the end of the turn without a second rule.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-status__icon--spinning` and its
  `@media (prefers-reduced-motion: reduce)` guard — untouched, and the reason AC2's reduced-motion half
  needs no code change.
- `docs/knowledge/features/conversation-shell-composer-status-row.md` § "The turning state is a CSS class,
  never a resolved style" — the class is the only form of the distinction a static renderer spec can
  assert, and the reduced-motion half lives solely in the Playwright fake tier.
- `docs/knowledge/features/conversation-shell-working-indicator.md` § the #650 window — why the local
  signal lives in a scalar beside `phase` and never inside it.
- `e2e/composer-status-reduced-motion.spec.ts` — the existing reduced-motion proof. It never sends a
  message, so `localSendPending` is false throughout and its idle arms stay green under the wider gate.
- `e2e/queued-backlog-interrupt.spec.ts` — the fake daemon **no-ops `send_message`**, so a spec owns the
  timing of every server event after a send. That is what makes AC1's "delayed server events" coverage
  possible at all.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

A 741×32 end-aligned row: on the left the 14×16 snowflake mark beside `Thinking...` in body-small at the
primary tint, on the right the red-on-white `Pairing error - Re-pair` chip in the trailing slot. Both
halves ship already — the node carries no motion spec (the 1.6s spin is a client-owned constant), so this
ticket changes nothing the node draws. The design's own state *is* the state this ticket is about: mark
beside Thinking, which today renders with a still mark for the first round trip.

## Change

`ComposerStatusArea`'s `isRunning` is derived today as `isTurnRunning(phase)` — the daemon's raw phase —
while the label beside it comes from `workingIndicatorStateWithLocalSend(status, localSendPending)`, which
opens a synthetic `'thinking'` window the moment the composer accepts a submit. The two gates disagree for
exactly one round trip, and that gap is the bug.

The fix reads the label's own answer instead of re-deriving the window:

```ts
export function isStatusIconTurning(phase: TurnPhase, state: WorkingIndicatorState | null): boolean
```

`isTurnRunning(phase) || state === 'thinking'`. Three properties make this the whole change:

- **The local window is decided in one place still.** The predicate consumes
  `workingIndicatorStateWithLocalSend`'s result rather than re-reading `localSendPending`, so the #650
  window's rule is inherited, not restated — the drift this file's comments repeatedly legislate against.
- **`'thinking'` from the daemon adds nothing.** `workingIndicatorState` reaches `'thinking'` only past
  `shouldShowThinking`, which requires `isTurnRunning`. So the second clause's *only* new inhabitant is
  the locally opened window, and every daemon-sourced render is byte-identical to today.
- **The idle retry / stall / compaction renders are untouched (AC2).** Those states return their own
  label, never `'thinking'`, so a held retry or a stall at `idle` still shows its label beside a still
  mark — the converse render `ComposerStatusArea`'s docblock records as intended.

At the call site the container hoists the label state into a `const` beside the existing
`const openTool = openToolCall(items)`, and the row takes `isRunning={isStatusIconTurning(phase, state)}`
with `<ThinkingIndicator state={state}>` reading the same value. One derivation per render, not two.

`ComposerSendButton` keeps `isRunning={isTurnRunning(phase)}` verbatim, as does the Escape branch's
`shouldInterruptOnKeyDown` — stop and Esc eligibility stay daemon-phase-only (AC2). The new predicate is
not wired to either, and `phase` itself never carries the synthetic value.

No CSS change: the reduced-motion rule keys on `.composer-status__icon--spinning`, which is the same class
this widens the emission of, so suppression follows for free (AC2).

## Testing strategy

Unit, in `ConversationScreen.test.tsx`, a new block beside `isTurnRunning`'s:

- `isStatusIconTurning` — turning at `'idle'` with the locally-derived `'thinking'`; turning for both
  running phases; still at `'idle'` with `null`; still at `'idle'` for `'retrying'`, `'compacting'`,
  `'stalled'` and `'resetting'` (the AC2 regression, one case each); turning for `'working'`.
- End-to-end through the derivation rather than against a hand-written state, so the composition is what
  is proven: feed `workingIndicatorStateWithLocalSend({ phase: 'idle', … }, true)` into the predicate and
  assert `true`, and the same record with `localSendPending: false` asserts `false`.
- `ComposerStatusArea`'s two shipped spin arms stay as they are — the view is unchanged.

E2E, `e2e/status-icon-local-send.spec.ts` (fake tier), covering AC1's pre-response interval with server
events delayed under the spec's control — the fake no-ops `send_message`, so nothing arrives until the
spec pushes it:

1. Launch paired, assert the icon is present and **not** spinning (the control arm — without it every
   assertion below passes vacuously).
2. Send a real message through the composer. Assert `.composer-status__icon--spinning` appears **and** the
   label reads `Thinking…`, with no server frame pushed at all.
3. Push `turn_state{thinking}`; assert the icon is still spinning (the animation continues across the
   seam, and the label does not flicker).
4. Push `turn_state{idle}`; assert the spinning modifier is gone and the icon is still rendered.

Assertions read class names and label text only — no frame timing, no screenshot, no elapsed duration.

**Visual evidence.** No capture is warranted: the change emits an existing class in one more state and
alters no layout, token, typography or asset, so a static capture would be identical to `main` by
construction. The observable delta is the class (unit + step 2 above) and the motion it drives, which only
Playwright can read — `composer-status-reduced-motion.spec.ts` already holds that link and is unchanged.

## Documentation handoff

None stated on the ticket. The standard fold applies: the documentation stage folds this into
`docs/knowledge/features/conversation-shell-composer-status-row.md` § "The turning state is a CSS class",
which currently describes the gate as the raw phase reading. Pending for that stage; not edited here.

## Open questions

None. The one judgement call — read the label's derived state versus re-read `localSendPending` in the
icon's gate — is settled above and is the reason the predicate takes `WorkingIndicatorState | null`.
