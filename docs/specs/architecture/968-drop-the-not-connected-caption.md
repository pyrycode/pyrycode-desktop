# 968 — Drop the not-connected caption above the message box

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` → `ComposerAvailability`, `composerAvailability`,
  `CONNECTION_BANNER_COPY`, `COMPOSER_ERROR_CHIP_COPY`, `COMPOSER_REPAIR_BUTTON_COPY` — the gate whose
  `hint` member is retired, plus the three surviving copy constants whose docblocks each argue lexical
  distinctness against the three captions.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` (the `{hint && …}` render and
  the destructure), `ConnectionBanner` (its polite-live-region rationale credits the caption) — the only
  production consumer of `hint`.
- `src/renderer/src/screens/conversation/conversation.css` → the `.composer__hint` rule, and the three
  neighbouring blocks that reason from it (`.composer`, `.composer__footer`, `.conversation__banner`).
- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `ComposerActionsMenu` — its docblock
  gives the caption as the reason the trigger is never disabled.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `UNPAIR_FAILED_ERROR` — names the generic
  `Connection error` caption while making a claim about `.message` that stays true.
- `src/renderer/src/screens/conversation/composerSend.test.ts` → the `composerAvailability` describe, the
  chip-copy describe, the button-copy describe — four `.hint` property reads, all `tsc`-forced.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `ConnectionBanner` distinctness
  test, the `composer__hint` render assertion, the banner-present assertions.
- `e2e/unpair-repair.spec.ts` → `readStatusRowGeometry` and the re-pair geometry spec — two comments state
  the caption mounts on this transition; no assertion locates it.
- `docs/knowledge/features/composer-send.md` § 5, § 6 and `conversation-shell-composer.md` § footer — the
  prior tickets' record of the caption and of the footer's 4+4 spacing split. Read-only; the documentation
  phase owns them.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The node draws the whole input area as three stacked rows and nothing else: the status row (the turning
mark with its `Thinking…` label at the left, the `Pairing error - Re-pair` button right-aligned), the
message box immediately beneath it carrying the placeholder text and the round send control at its right
edge, and the footer row (`Actions`, `Auto`, `Opus`, `Max`, `Context: 84%`, the attach clip right-aligned).
There is no caption line anywhere in the frame — in particular none between the status row and the message
box, which is the whole of this ticket: the drawing's rhythm between those two rows is 8px of empty space.

`get_design_context` was deliberately not called. The change writes no new markup, no new CSS declaration
and no new token — it deletes an element and a rule — so there is no layout or typography data to adapt,
and the screenshot is the artifact that pins the intent (the absence of a row). Every geometry value AC2
names is already declared in `conversation.css` and is quoted in **Design** below.

## Context

While the composer cannot send, `Composer` renders a muted caption directly above the message box —
`Connecting…`, `Not connected` or `Connection error`, from `composerAvailability(status).hint` (#31). The
desktop drawing has no such line, and the connection state is now said twice more: #279's banner covers
every non-connected arm at the top of the thread, and the status row directly above the message box carries
#797's chip or #963's re-pair button in the `error` arm. Ruling, Juhana 2026-09-02: drop the caption.

The gate is untouched. `composerAvailability`'s `canSend` is the composer's one send path (#680), and this
ticket changes nothing about when a message sends — only what is drawn while it cannot. The `hint` member
and its three strings retire with the element so the type cannot carry a dead member.

`ComposerAvailability` stays a one-field record rather than collapsing to a bare boolean: the call site
already destructures from it, and the ruling is "drop the caption", not "redesign the gate".

No ADR. This is a design ruling already recorded in the vault's Chat Screen Design note (2026-09-02), and
it removes a surface rather than establishing a contract.

## Design

Three deletions, then comment true-ups wherever the deleted thing was used as a reason.

**The type and the gate — `composerSend.ts`.** `ComposerAvailability` loses its `hint` member and keeps
`canSend` alone; `composerAvailability` returns `{ canSend }` on each of its four arms and keeps its
`assertNever` exhaustiveness default. After the change the function reads `status.type` and nothing else,
so the docblock paragraph reserving `ConnectionError.message` for the banner has no subject left and goes
with the member — there is no string on this path to leak.

**The render — `ConversationScreen.tsx`.** The destructure in `Composer` narrows to `const { canSend } =
composerAvailability(status)`; the `{hint && (<p className="composer__hint" role="status">…)}` block and
its two-line comment are deleted. `.composer`'s remaining children are `.composer__row` and
`.composer__footer`, in that order.

**The rule — `conversation.css`.** The `.composer__hint` block and its comment are deleted. No rule is
added: AC2's 8px is already declared. `.conversation` is a flex column with no `gap`; `ComposerStatusArea`
renders unconditionally and is a sibling of `.composer` in that column, so `.composer-status` is always the
message box's upper neighbour; `.composer`'s `padding-top` is `var(--space-2)` = 8px and `.composer__row`
(whose `::before` ground at `inset: 0` is the box's visible top edge) becomes `.composer`'s first child.
Deleting the caption *is* the 8px, and nothing left between the two rows is conditional on `status`.

`.composer`'s `gap: var(--space-1)` and `.composer__footer`'s `margin-top: var(--space-1)` keep their
current values. Together they are the design's 8px between box and footer; collapsing the pair into one
8px declaration would move a settled spacing for no behavioural gain and is out of scope.

**Comment true-ups.** The caption is cited as a *reason* in five production files and one e2e file. Each
citation is reworded to the surface that actually carries the fact now; none of them changes behaviour:

- `composerSend.ts` — the `ComposerAvailability` and `composerAvailability` docblocks (the caption's
  existence and its "why" copy), and the distinctness contracts of `CONNECTION_BANNER_COPY`,
  `COMPOSER_ERROR_CHIP_COPY` and `COMPOSER_REPAIR_BUTTON_COPY`, each of which quotes all three captions.
  The distinctness set shrinks to the surfaces that remain (banner, chip, button); the ordinal each
  docblock gives itself ("the fourth/fifth string…") counts *reads of the `ConnectionStatus` slice*, and
  `composerAvailability` is still a read, so those ordinals are correct as they stand and do not move.
- `ConversationScreen.tsx` — the `.composer__footer` comment naming `__hint` as its sibling precedent, and
  `ConnectionBanner`'s polite-live-region rationale, which credits the caption both for the non-assertive
  choice and for "both remain visible while disconnected". The polite choice survives on its own reason
  (the band persists visually); the double-announce clause is what goes.
- `conversation.css` — `.composer`'s "so the status hint can sit above the row", `.composer__footer`'s
  inset and `margin-top` rationales, and `.conversation__banner`'s two contrasts against the caption.
- `ComposerActionsMenu.tsx` — the trigger stays never-disabled; the stated reason becomes the status row
  and the banner rather than the caption one row up.
- `unpairAction.ts` — only the hint clause goes. The load-bearing half ("does not read `.message`") stays
  true and gets stronger. Its "for a future banner only" clause is left verbatim: it is stale for a reason
  that is #279's, not this ticket's.
- `e2e/unpair-repair.spec.ts` — two comments assert that the row-growth transition also mounts the caption.
  Trued up to the banner alone. The recorded "moves 20px UPWARD" figure was measured with the caption
  mounting; it is marked as the pre-#968 measurement rather than replaced with an invented number, and the
  assertion the comment deliberately declines is **not** added.

## State + concurrency model

Unchanged, and that is the point. No store slice, no selector, no subscription, no async work and no
lifecycle is touched. `Composer` still selects `status` through `useSessionStore(selectStatus)` and still
re-renders on a connection change, which is what re-enables the send control reactively; it simply renders
one element fewer. `ComposerStatusArea` and `ConnectionBannerControl` keep their own reads.

## Error handling

No failure mode changes. `composerAvailability` remains total over `ConnectionStatus`'s four arms with the
`assertNever` guard, so a future fifth arm is still a compile error. The `error` arm still reaches no
string: it did surface a generic client-owned label, and now surfaces none — a strictly smaller path for
`ConnectionError.message`, which was already never read here.

## Testing strategy

vitest, node environment, static markup. No Playwright spec is added: the caption's absence is a static
render fact, and `e2e/unpair-repair.spec.ts`'s geometry reads are all relative to `.composer-status`, so no
existing assertion turns red.

RED first, in two places:

- `composerSend.test.ts` — the `connected` arm's exact `toEqual` is tightened to `{ canSend: true }`. It
  goes red against a return value that still carries `hint: null`. Exactness is retained (never relaxed to
  `toMatchObject`) on all four arms: an exact `toEqual` on the returned object *is* the proof that no
  `hint` survived, and on the `error` arm — asserted against a sentinel `ConnectionError.message` — it is
  simultaneously the proof that nothing daemon-supplied is returned.
- `ConversationScreen.test.tsx` — a `not.toContain('composer__hint')` on the server-rendered screen, red
  while the caption renders. The initial store state is `disconnected` and zustand's server snapshot is the
  state captured at creation, so `disconnected` is the only arm a container render can reach; it is also
  the arm the caption used to show in. The other three arms are covered structurally by the pure matrix
  above — a gate that returns no string cannot render one.

AC4's "no such string literal in a non-test file" is proven by the exact `toEqual` matrix rather than by a
`not.toContain('Not connected')` list, which would re-add the banned literals to the very file the AC's own
grep reads. The grep itself is run once by hand as part of § verification.

Trims, all `tsc`-forced by the member's removal and reported by the *web* project:

- `composerSend.test.ts` — the `composerAvailability` describe shrinks to the `canSend` matrix, losing its
  three-way hint-distinctness test; the chip and button distinctness tests keep their shape and lose their
  `.hint` entries (and, with no nullable member left in the set, the `filter` that narrowed it).
- `ConversationScreen.test.tsx` — "is lexically distinct from all three composer hints (AC5)" goes entirely
  (the distinctness that still matters is between banner, chip and button, and lives in
  `composerSend.test.ts`); so does the `class="composer__hint"` render assertion. The banner-present test
  keeps its banner assertions and loses the two that compare against a caption literal — the first of which
  is the one that turns red rather than dead, and is reachable by no `composer__hint` grep. The
  `composerAvailability` import goes with them; nothing else in the file uses it.

Verification: `npm test` on the two touched spec files, `npm run build`, and — because the combined
`typecheck` is `tsc node && tsc web` and short-circuits on the node side — `npx tsc --noEmit -p
tsconfig.web.json` on its own if the combined output looks too clean for a change whose errors are all
web-side.

## Open questions

- Whether the `error` arm's sentinel test ("does NOT leak `ConnectionError.message`") still earns its keep
  once the arm returns no string at all. Resolved during implementation: kept, re-expressed as an exact
  `toEqual` against a status carrying the sentinel — it now proves the stronger fact structurally, and it
  is the one test that would notice a future arm re-introducing a copy field.
- Whether `.composer`'s `gap` / `.composer__footer`'s `margin-top` split should collapse now that its
  original reason (separating the caption from the row) is gone. Resolved: no — the ticket's scope ruling
  is explicit, and the comment records the split as deliberate rather than vestigial.
</content>
