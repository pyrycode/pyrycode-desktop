# #1095 — Input footer: show the model family only

## Files read

- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`, `firstShown`,
  `ComposerModelMenuView` — the whole change lands here; `firstShown` is the composition the source chain reuses.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `publishedRowFor` — the exact-equality join,
  unchanged; `effortRowFor` beside it is the precedent for adding a rule NEXT TO a shared helper rather than inside it.
- `src/renderer/src/screens/conversation/ComposerModelMenu.test.tsx` → the invented-identity fixture (`alpha` /
  `beta[1m]` / `gamma`, `resolved_model` = value + `-resolved`) whose two halves both move.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the three footer mount proofs; the first
  asserts `>seeded-session-model<` through the mounted container and my change moves it.
- `e2e/composer-model-menu.spec.ts`, `e2e/composer-model-announced.spec.ts` → `MODEL_ROWS` and both drives —
  each drive's miss→hit step goes vacuous under this change and is re-anchored.
- `e2e/composer-permission-mode-auto.spec.ts` → `REFUSING` / `RELENTED` and the two `modelLabel` reads — that spec
  uses the model trigger as its SETTLE SIGNAL for a `model_list` tick, and this change silences it. Not on the
  ticket's "tests that change" list; found by grepping `.composer__model-label` across `e2e/`.
- `src/shared/wire/types.ts` → `WireModelOption` docblock — the `<unmeasured>` `resolved_model` measurement that
  makes AC2's `value` step an ordinary second source rather than a guard.
- `src/renderer/src/store/modelListStore.ts` header, `src/shared/ipc/events.ts` model-list arm — the two other
  absolute "IS NOT PARSEABLE" claims this change falsifies.
- `docs/knowledge/features/composer-model-menu.md` — #988/#1053's settled reasoning: `''` means "nothing at this
  layer" uniformly, and the label and the marking are two lookups rather than one. Both survive intact.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The footer's model trigger renders as a 42×16 row reading `Opus` followed by the 8×4 up-chevron — the family name
alone, no version, no date, no context marker. Geometry, treatment, glyph, the `--color-primary` inheritance and
`.composer__model-label`'s 120px cap with ellipsis are all unchanged; the only thing this ticket moves is which
string that existing `<span>` carries, and which string each `role="menuitem"` row carries.

## Context

Since #1053 the trigger's label is the first non-empty of pick / announcement / stored choice, resolved through
`publishedRowFor` on exact `value` equality and rendered as the matched row's `display_name`, verbatim on a miss.
A miss is the common case for an announcement, so in practice the operator reads a raw dated identifier
(`claude-haiku-4-5-20251001`); on a hit they read published prose (`Opus (1M context)`). Juhana ruled on 2026-09-05
that this surface shows the family and nothing else, and that the menu rows shorten the same way. The version and
the context window are always the newest, so they carry no information here. The full identifier stays in the
run-configuration sheet's Running model section, which this ticket does not touch.

No ADR is warranted: this narrows one control's display rule and introduces no new contract, store or boundary.

## Design

### The family rule — one module-private pure function

`modelFamily(identifier: string): string`, beside `firstShown` in `ComposerModelMenu.tsx`. Not exported: the unit
suite already drives every rule in this file through `composerModelMenuModel` as data, so an export would add a
second public surface for no coverage. Contract:

> Strip ONE leading `claude-` if present; take the leading run of ASCII letters; upper-case its first letter and
> hold the rest as claude sent them. `''` when there is no leading run — this file's uniform "nothing here".

`''` rather than `null` is deliberate — it is the same "nothing at this layer" `firstShown` already consumes, so
the source chain composes with the existing helper instead of a second nullability idiom.

Implementation shape: `startsWith('claude-')` + `slice`, an anchored `/^[A-Za-z]+/` match, then
`charAt(0).toUpperCase() + slice(1)`. `charAt` rather than `[0]` so no `!` is needed. `toUpperCase` rather than
`toLocaleUpperCase`: the head is `[A-Za-z]`, so the fold is locale-invariant by construction and the Turkish-ı
hazard cannot arise.

`claude-` is the ONE client-owned literal this path adds, and AC1 names it. It is a vendor prefix strip, not a
family vocabulary: there is no allow-list, so an unheard-of `claude-newname-6` derives to `Newname` through the
same rule. That is what keeps #988's AC2 ("no client copy naming a model concept") intact.

Non-ASCII heads fall through to `''` and thus to today's verbatim fallback — deliberate, per the ticket.

### The trigger's source chain (AC2)

Inside `composerModelMenuModel`, after today's `publishedRowFor` lookup, unchanged:

```
family  = row ? firstShown(modelFamily(row.resolved_model), modelFamily(row.value))
              : modelFamily(shown)
verbatim = row ? row.display_name : shown          // today's expression, moved not rewritten
label    = family === '' ? verbatim : family
```

`verbatim` names the exact `row ? row.display_name : shown` #988 defended, so AC4's "exactly what it is today"
is a fallback of a preserved expression rather than a re-derivation. `resolved_model` before `value` because the
trigger's job is to name what RUNS; the `value` step is an ordinary second source, not a guard — the captured
fixture the `WireModelOption` docblock cites carries the literal `<unmeasured>` on four of its five rows, whose
head is `<` and therefore yields `''`.

### Each row's label (AC3)

Each option's `label` becomes `modelFamily(published.value)`, falling back to `published.display_name`. From
`value`, never `resolved_model`: a row's job is to name a CHOICE, and `default` is its own choice — derived from
`resolved_model` it would wear the label of the row it resolves to and the panel would show two identical rows
submitting different values. Two rows deriving to the same label are both shown and each still submits its own
`value`; that is #988's "exactly the published rows" rule, untouched.

### Explicitly unchanged

`ComposerModelLayers`, `firstShown`, the four-layer precedence, `publishedRowFor`'s exact equality, the
`sessionRow` marking lookup, `currentId`, `id = row.value`, the single-field write, the inert arm, the
draw-nothing arm, `ComposerModelMenuView`'s markup and every CSS rule. `composerModelMenuModel`'s signature and
return type do not move, so no call site changes. The run-configuration sheet is not touched at all.

## State + concurrency model

None. `modelFamily` is a pure string→string function; `composerModelMenuModel` stays a pure function of its two
existing arguments. No store, no effect, no subscription, no async work, no new re-render seam.

## Error handling

No failure mode exists to classify: every branch returns a string. The three degenerate inputs and their answers:
a head that is not an ASCII letter → `''` → today's fallback; an empty identifier → `''` → today's fallback; a
row whose `display_name` is also empty → the empty string, which #988 pinned as a HIT rather than a miss and
which stays a hit.

## Comment re-scope — four sites, and eight that must not move

The standing "`value` IS NOT PARSEABLE" claim is sound about MATCHING, INDEXING and KEYING; deriving a display
label is none of those, and no derived label is ever fed back into a lookup. Re-scope, do not delete, in:
`modelListStore.ts`'s header, `src/shared/ipc/events.ts`'s model-list arm, `src/shared/wire/types.ts`'s
`WireModelOption` docblock, and `e2e/composer-model-menu.spec.ts`'s `MODEL_ROWS` note.

Path-scoped claims that stay true and must NOT be touched: the two in `RunConfigSections.tsx`, and those in
`ComposerEffortMenu.tsx`, `modelListBridge.ts`, `composer-effort-menu.spec.ts`, `run-config-settings.spec.ts`,
`modelListStore.test.ts` and `types.test.ts`. Also left alone: `inboundMessage.test.ts`'s decode-scoped claim,
which is about the DECODER not stripping brackets and is unaffected.

## Testing strategy

**`ComposerModelMenu.test.tsx` (vitest, static render).** The invented-identity discipline the file states is now
MORE load-bearing, not less: an allow-list bug is caught by an invented family and hidden by a real one. So AC1's
shape table is asserted with invented tokens carrying each shape AC1 names (`claude-alpha-5`, `claude-alpha-5[1m]`,
`claude-alpha-4-5-20251001`, `alpha[1m]`, `alpha`), plus `default` — the one real literal, the daemon's own word,
already seeded here by #1168. New and moved cases:

- the derivation table, as data through `composerModelMenuModel`
- the trigger prefers `resolved_model` over `value`: a row whose two fields name different families
- the `resolved_model` → `value` fall-through: a row carrying the measured `<unmeasured>`
- a row's label comes from `value`, never `resolved_model` (the same fixture, read the other way)
- AC4's no-letters arm on both sides: a trigger hit falls to `display_name`, a trigger miss to the shown string,
  a row to its `display_name`
- the existing four near-miss cases and the empty-`display_name` hit, re-expressed against derived labels
- the attribute-absence assertion kept AND extended to the derived labels

**`ConversationScreen.test.tsx`.** The model-menu mount proof's `>seeded-session-model<` becomes `>Seeded<` — still
a mount proof, since only a container that read the snapshot can produce it, and now also a proof the derivation
runs mounted. One assertion plus its comment.

**`e2e/composer-model-menu.spec.ts`** and **`e2e/composer-model-announced.spec.ts`.** Each drive's miss→hit step
goes vacuous, because both sides of a same-family pair now render identically. `default` is the ONLY published
value whose `value` and `resolved_model` name different families — every other alias matches its own family by
construction — so it is the only possible re-anchor. In each spec one row is replaced by
`default` / `Inherited default` / `claude-sonnet-5`, and it becomes the baseline (menu spec) / the announced value
(announced spec): the label reads `Default` before the list and `Sonnet` after. The other two rows stay
`opus[1m]` and `haiku`, so families in play are `Default`/`Sonnet`/`Opus`/`Haiku` — mutually non-substring, and no
row label collides with any trigger family. Every assertion reading a `display_name` or a `value` off the trigger
or a row moves to the derived family; the `set_session_settings` payload assertions keep the raw `value` and must
not move.

**`e2e/composer-permission-mode-auto.spec.ts`** (not on the ticket's list). That drive uses the model trigger as
its settle signal for a `model_list` tick, twice. Under the new rule `refuser` and `refuser-resolved` derive to the
same family, and `RELENTED` shares `REFUSING`'s `value`, so BOTH reads go vacuous and the last step loses its
barrier. Fix: give the two rows `resolved_model` values deriving to distinct families (`Refusing` / `Relenting`),
which restores an observable change at each tick. No production behaviour is involved.

Not touched, and must stay green unmoved: `run-config-settings.spec.ts`, `RunConfigSections.test.tsx`,
`modelListStore.test.ts`, `types.test.ts`, `inboundMessage.test.ts`, `ComposerEffortMenu.test.tsx`.

## Open questions

1. Does the announced-spec's `default` announcement stretch the "a fake-tier spec may not supply an input
   production does not produce" rule? Resolve in Phase B by stating the reasoning in the spec's own comment: the
   frame and its shape are the daemon's, only the value is chosen, and the spec already chose a published alias
   (`sonnet`) for the same reason. If the reasoning does not hold up, record it under `## Revisions`.
2. Whether `>Seeded<` remains unambiguous in `ConversationScreen.test.tsx`'s markup. Confirm in Phase B.

## Revisions

**2026-09-08 — both Open Questions resolved, neither changed the design.**

1. The `default` announcement holds. The frame, its shape and its unsolicited arrival are all the daemon's;
   only the value is the test's, which is the same liberty the spec already took by announcing the alias
   `sonnet` rather than a dated identifier. The reasoning is recorded in the spec's own `MODEL_ROWS` note,
   alongside the fact that `default` is the ONLY published value whose `value` and `resolved_model` name
   different families — so it is not a convenient choice, it is the only possible anchor.
2. `>Seeded<` is unambiguous in `ConversationScreen.test.tsx`'s markup; the seeded effort renders verbatim
   as `seeded-session-effort` and collides with nothing. The assertion is paired with a negative on the old
   string so the derivation is pinned from both sides.

**One file was added to the plan's scope during Phase B, and it is a test file.**
`e2e/composer-permission-mode-auto.spec.ts` was already named in the plan's Files read and Testing strategy
(found by grepping `.composer__model-label` across `e2e/`, not from the ticket's list). No production
behaviour is involved: that drive used the model trigger as its settle signal for a `model_list` tick, and
under the new rule `refuser` / `refuser-resolved` derive to one family while `RELENTED` shares `REFUSING`'s
`value`, so both reads went vacuous. The two rows now carry `resolved_model` values naming families of
their own.

**Mutation-checked rather than assumed.** Dropping the `resolved_model` step from the trigger's source
chain reddens all three e2e specs, which is the evidence that each re-anchored miss→hit step is a real
detector rather than an assertion that passes either way.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary and no boundary moved. `resolved_model`, `value`, `display_name` and the
  announced identifier are untrusted, model-influenced text that crossed the subprocess boundary; they arrive
  already narrowed by `#972`'s fail-closed decoder, which makes the SHAPE trusted and nothing more. `modelFamily`
  is a view-side transform ON A HELD-VERBATIM VALUE, the same tier as the CSS ellipsis one element up — it does
  not sanitize, does not claim to, and does not re-tier its input. The store's three obligations (held verbatim,
  never a lookup path, never logged) are untouched because the store is not touched.
- **[Injection / render sinks]** No findings, and this is the category that had to be checked rather than assumed.
  The derived label reaches the SAME two JSX text positions the label reaches today (the trigger's
  `.composer__model-label` span, and each `menuitem`'s text through `ComposerOptionsPanel`), where React escapes
  it. It reaches no `dangerouslySetInnerHTML`, no attribute, no URL, no filename, no cache key and no log.
  Verified against the memory that an inherited "never used as X" contract can be FALSE in a new consumer: the
  new sink here is a letters-only prefix of `value` reaching a TEXT position, and `value` already reaches that
  position today as a row label — same trust tier, same escaping, strictly less content.
- **[Feedback into lookups]** No findings, and this is the sharpest question the change raises. A derived label is
  never fed back: `publishedRowFor` is still called with the RAW `shown` and the RAW session model, `currentId` is
  still `sessionRow.value`, `id` is still `published.value`, and `onSelect` still dispatches a `value` a published
  row carries. A hostile daemon cannot make this control send a string it did not itself publish. Nothing branches
  on a derived label; the only branch added is `family === ''`, on the CLIENT's own derivation.
- **[Object-prototype pollution]** No findings. No plain object is keyed by daemon text on this path, and the
  change adds no index of any kind. `key={option.id}` stays React's own keyed reconciliation.
- **[Algorithmic complexity / ReDoS]** No findings. The one regex is `/^[A-Za-z]+/` — anchored, a single character
  class, one greedy quantifier, no alternation and no nesting, so it is linear with no backtracking. Input is
  bounded upstream at 256 bytes per field by the daemon and by `MAX_PLAINTEXT_BYTES` before any parse.
- **[Case folding as a security operation]** No findings, stated because case folding is a classic normalisation
  trap. `toUpperCase` is applied to exactly one character already proven to be `[A-Za-z]`, so it is
  locale-invariant; `toLocaleUpperCase` is deliberately NOT used. The fold is display-only and its output is
  never compared, matched or looked up — the "no case fold on this path" rule survives where it mattered, in the
  MATCHING, which is still `publishedRowFor`'s single `===` on raw strings.
- **[Control characters / terminal escapes]** No findings, and the change strictly IMPROVES this posture. The
  daemon bounds these strings without sanitizing, so a control byte is permitted by contract. Today the whole
  string reaches the DOM; after this change the trigger and the rows carry a `[A-Za-z]+` prefix ONLY whenever a
  family derives, so a control byte can reach the DOM only through the unchanged verbatim fallback — the exact
  path that carries it today.
- **[Length bounding]** No findings. `.composer__model-label`'s 120px cap and ellipsis are unchanged and still
  bound the fallback arm. A derived label is a prefix of an already-bounded string, so it can only be shorter.
- **[Tokens, secrets, credentials]** Not applicable — this path touches no token, key, credential or pairing
  payload, and adds no storage of any kind.
- **[File / storage operations]** Not applicable — no filesystem access, no persistence. Nothing derived is
  written anywhere; the label is recomputed per render from store state.
- **[Electron attack surface / process placement]** Not applicable, and confirmed rather than assumed: the change
  is entirely inside one renderer component. It adds no IPC channel, no `contextBridge` surface, no preload
  export, and moves nothing toward the transport. No socket, key or Noise state is reachable from this file.
- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no comparison against a secret. The
  one equality on this path is the pre-existing display-only `===` inside `publishedRowFor`, which compares two
  daemon-authored strings and neither is a secret, so `timingSafeEqual` is not indicated.
- **[Network & I/O]** Not applicable — no frame, socket, URL or timeout is touched; the write half of this control
  is unchanged and still sends only a published `value`.
- **[Error messages, logs, telemetry]** No findings. Nothing on this path is logged, before or after — there is
  deliberately no diagnostic in this file — and the change adds none. A derived label never reaches a log.
- **[Concurrency]** Not applicable — no async work, no listener, no timer, no cancellation path is added or
  changed. `modelFamily` is pure and synchronous.
- **[Threat model — hostile daemon]** Addressed. The hostile input here is a crafted `value` / `resolved_model` /
  announcement. The worst reachable outcome is a MISLEADING but inert label: a daemon publishing
  `value: "opus-but-actually-haiku"` renders `Opus`. That is a truthfulness limit of the display rule the operator
  ruled for, not a new capability — the same daemon can already publish `display_name: "Opus"` on a haiku row and
  is rendered verbatim today. The write is unaffected: the operator still submits that row's own `value`.
- **[Threat model — malicious relay]** Not applicable — the relay is content-blind and on-path only; this change
  is downstream of decode and adds no timing, retry or resource behaviour a relay could drive.
- **[Threat model — renderer compromise]** Unchanged. A compromised renderer already holds this state; the change
  gives it no new reach and exposes no new API.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
