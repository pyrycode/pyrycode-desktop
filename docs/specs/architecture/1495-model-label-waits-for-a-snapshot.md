# 1495 — the footer model label says nothing until a snapshot has arrived

## Files read

- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `ComposerModelLayers`, `firstShown`,
  `composerModelMenuModel`, `ComposerModelMenu` — the whole change lives here; the container's
  `stored: snapshot?.model ?? ''` is the line that flattens the distinction.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigState` — its header already calls `snapshot: null`
  the distinct not-yet-loaded state, and `clearSnapshot` returns to it on every activation. That
  distinction is the one this ticket threads one layer up.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `effortRowFor`, `publishedRowFor` — the
  inherited-default substitution the #1423 branch calls, and the exact-equality join under it. Neither
  changes; only whether the branch is entered.
- `src/renderer/src/screens/conversation/ComposerModelMenu.test.tsx` → `layers`, `stored` — the two
  fixture helpers every case is written through; the new null arm lands in `stored`.
- `e2e/composer-model-menu.spec.ts` → `capturingFake`, `sessionSettingsFrame` — the fake-tier idiom the new
  drive borrows: a value-discriminating reply factory, and a reply withheld so the body can push it
  correlated by an envelope id read back off the capture.
- `docs/knowledge/features/composer-model-menu.md` § Turn-end dependency, the paragraph beginning "A known,
  accepted gap since #1423" — records this exact gap, names `ComposerModelLayers.stored` as where the fix
  belongs, and rules out clearing `modelListStore` on activation as the alternative.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The model trigger is a 42×16 row: a 4px gap between the body-small model family in `--color-primary` and
the 8×4 chevron-up glyph. Nothing about that geometry moves. What widens is the arm that draws *no*
trigger at all — #988's `null` return, which #811's no-placeholder rule already leaves as an empty slot
rather than a reserved gap — so the visible outcome of this ticket is the absence of this node, not a new
rendering of it.

## Change

`ComposerModelLayers.stored` becomes `string | null`: `null` means *no snapshot has arrived for this
chat*, `''` keeps its existing meaning of *the snapshot says the model is empty, i.e. the daemon's
inherited default*. `firstShown` widens to accept `string | null` and keeps returning `string` — a null
layer is "nothing at this layer" exactly as `''` is, so both the label chain and the marking chain read
through it unchanged. The #1423 inherited-default branch in `composerModelMenuModel` gains the one guard
that tells the two apart: it resolves `effortRowFor` only when `layers.stored !== null`, so with no
snapshot the function falls through the existing `shown === '' && inherited === undefined` arm and returns
`null` — the rendering #988 already ships for an unknown model. The container supplies the distinction it
was flattening: `snapshot?.model ?? null` instead of `snapshot?.model ?? ''` (`??` does not fire on `''`,
so a real empty-model snapshot still arrives as `''`).

Nothing else moves. `effortRowFor` and `publishedRowFor` are untouched, so the lookup is still one `===`
on raw strings and `' '`, `'Default'` and `'default-x'` still miss the rows they missed. The marking's
`firstShown(layers.picked, layers.stored)` is reached only when some layer is non-empty, and a null stored
layer resolves there to `''` — which is what a missing snapshot already produced, so #1168's
"marks nothing when picked and stored are both empty" case is unchanged. The effort menu is out of scope
per the ticket: it renders nothing on an empty effort, which is the right answer for a missing snapshot
too.

## Testing strategy

- **Unit** (`ComposerModelMenu.test.tsx`): a new null arm on the `stored` helper feeding a small block in
  the #1423 describe — with a published inherited-default row and every other layer empty, a `null` stored
  layer returns `null` where `''` returns the default row; the view renders the empty string; and the pick
  and announcement layers still label normally over a null stored one, marking nothing. The existing
  #1423 cases are untouched, which is the proof AC2 did not regress.
- **e2e** (`e2e/composer-model-waits-for-snapshot.spec.ts`, fake tier): one drive for AC1 then AC2 in
  sequence. The reply factory withholds `request_session_settings` and pushes the `model_list` frame, so a
  model list including the `default` row is held with no snapshot; assert `.composer__model-label` has
  count 0. Then push a correlated `session_settings` frame whose `model` is `''`, read back by the
  envelope id captured from the request, and assert the label resolves the inherited-default row's family.
  AC3 is the same mechanism observed on a switch and is not separately driven: the activation clear is
  #1167's, already pinned in `activateConversation.test.ts`, and what AC3 adds over AC1 is only that the
  model list survives it — which the AC1 step seeds directly.
- `.composer__model-label` doubles as a settle signal elsewhere. All seven specs reading it at `c8822f3`
  (`composer-model-announced`, `offline-session-settings`, `composer-footer-overflow`,
  `question-answer-continue`, `composer-permission-mode-auto`, `composer-model-menu`, `model-refusal`)
  seed a snapshot before reading it, so none is expected to move; the ones this change could reach are run
  rather than assumed.

## Documentation handoff

**Pending for the documentation stage.** Update `docs/knowledge/features/composer-model-menu.md`, the
paragraph beginning "A known, accepted gap since #1423" under § Turn-end dependency (shared with the
context reading), to record the gap as closed and how the stored layer now separates "not yet known" from
"explicitly empty". That paragraph already names this fix as belonging to its own ticket. Not edited by
this ticket.

## Open questions

None. The feature doc prescribed this shape of fix before the ticket was written, and the store already
held the distinction being threaded.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and the new sentinel is on the safe side of the one boundary this file
  has. `models`, `layers.announced` and `layers.stored` are daemon-authored and decoded-not-sanitized;
  `null` is the only value on this path the daemon cannot produce. `parseSessionSettingsPayload` reads
  `model` through `requireString`, so a missing or non-string model fails closed as a `WireDecodeError`
  and never reaches `runConfigStore` — the snapshot is `null` only because the client received nothing or
  ran `clearSnapshot`. A hostile daemon therefore cannot forge the "no snapshot" state; the worst it can
  do is withhold a reply, whose effect under this change is that the label says nothing, which is the
  safer of the two outcomes and the point of the ticket.
- [Trust boundaries, second half] No findings on what the null reaches. It flows into `firstShown`'s
  `find` (a linear scan by `!==`) and into one `=== null` guard, then is discarded — it reaches no JSX
  text position, no attribute, no lookup argument, no object key and no log. The two claude-authored text
  positions `ComposerModelMenuView` renders are unchanged, and this change can only make them render less
  often.
- [Tokens, secrets, credentials] Not applicable by construction — no secret, token or key exists on this
  path. The transport, the Noise session and `safeStorage` are all main-process and out of this file's
  reach; the renderer holds a display string only.
- [File / storage operations] Not applicable — the change is pure renderer view logic with no `fs` call,
  no path construction and no persisted state. Nothing new is written to disk, so no traversal, TOCTOU,
  atomicity or at-rest-encryption question arises.
- [Inter-process / Electron attack surface] No findings — no IPC channel, `contextBridge` API, protocol
  handler, navigation guard or `webPreferences` value is added or touched. The renderer continues to
  receive already-typed events, and the change happens entirely downstream of that boundary in a pure
  function plus one store read.
- [Cryptographic primitives] Not applicable — no randomness, hashing, key material, nonce or comparison
  against a secret. The only comparisons added are `=== null` on a client-minted sentinel and the existing
  `!== ''`, neither of which compares attacker-controlled input to a secret, so `timingSafeEqual` does not
  apply.
- [Network & I/O] Not applicable to production — no socket, no URL, no frame handling and no timeout is
  reached from here. The new e2e drive withholds a `request_session_settings` reply, which is a timing
  liberty the fake tier already takes (`composer-model-menu.spec.ts` withholds the rejection reply for the
  same reason); it supplies no input production does not produce and changes no production timeout.
- [Error messages, logs, telemetry] No findings — nothing on this path is logged at all, which this file's
  own docblock states and the change preserves. No error is constructed, no message is surfaced, and the
  new state is an absence of rendering rather than a diagnostic.
- [Concurrency] No findings — the function is synchronous and pure, no async task, timer, listener or
  `AbortSignal` is created, and there is no check-then-act across an `await`. The container's `layers`
  object was already a fresh literal per render, so the container's subscription identity and re-render
  behaviour are unchanged; no memoisation is added or invalidated.
- [Threat model alignment] The ticket closes a small integrity defect rather than opening one: today a
  chat with no snapshot can display the *previous* chat's inherited-default row, which can mislead
  someone into sending a message believing a model is in force that is not. Two threats stay explicitly
  out of scope and are unaffected: the daemon-side `no_session` settings reply after a restart (being
  fixed upstream in pyrycode, named in the ticket's Context), and the effort menu's parallel case (the
  ticket scopes it out because an empty effort already renders nothing). A hostile relay is out of reach
  from this layer — it is content-blind and on-path, and its only leverage here is withholding, covered
  above.
- [Confused-implementer risk] SHOULD FIX — `firstShown`'s widened predicate must test the null
  explicitly, `(value) => value !== '' && value !== null`. A loose `value !== ''` passes every test in
  this ticket by accident of ordering, because `stored` is last in both chains and `?? ''` launders the
  returned null; it would silently return "nothing" for any later nullable layer added in front of it. A
  truthiness test (`if (layers.stored)`) is the opposite trap and would fold `''` into `null`, breaking
  AC2's inherited-default branch. Phase B writes the explicit form and pins the guard's exactness with
  the near-miss cases the #1423 block already established.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-16
