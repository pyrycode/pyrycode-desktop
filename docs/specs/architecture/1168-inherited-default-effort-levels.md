# 1168 — A chat with no explicit model offers the inherited-default row's effort levels

## Files read

| Path | Symbols | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` | `publishedRowFor`, `EffortSection`, `RunningModelSection`, `ModelSection`, `EFFORT_LEVELS_FIELD` | The helper that must stay unchanged (AC4), the sheet surface that changes, the two same-file callers that must not, and the `EFFORT_LEVELS_FIELD` idiom the new constant copies. |
| `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` | `composerEffortMenuModel`, `ComposerEffortMenuView` | The footer surface that changes, and the inert-vs-menu arm split the flip is observed through. |
| `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` | `composerPermissionModeMenuModel` | AC4's sharpest guard: it reads `supports_auto_mode` off `publishedRowFor`'s result, so a branch placed inside the helper would start hiding `auto` on every inherited-default chat. |
| `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` | `composerModelMenuModel` | AC4's second guard: its `currentId` is a `publishedRowFor` join on the session model, which would start marking the inherited-default row. Its docblock also holds this control's own separate answer to the `value === ''` question, which this ticket does not reopen. |
| `src/shared/wire/types.ts` | `WireSessionSettings.model`, `WireModelOption` | `'' = inherited daemon default (never treated as absent)` — the contract sentence the whole design rests on, and the `effort_levels` absent/`null`/`[]` collapse. |
| `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` | `PUBLISHED_ROWS`, `base`, `segmentFor`, `tagWithClass` | `PUBLISHED_ROWS[0]` is already `value: 'default'` with levels and `base` is already `model: ''`, so ~30 renders in this file change what the Effort section draws. Audited render by render — see § Testing strategy. |
| `src/renderer/src/screens/conversation/ComposerEffortMenu.test.tsx` | `GRADED`, `FLAT`, `LIST`, `view` | No inherited-default row among its fixtures, so nothing here changes; its `it.each` shapes are what the new cases extend. |
| `docs/knowledge/features/composer-model-menu.md` § "The follow-up this ticket answered" | — | #988 left the inherited-default gap noted-but-not-filed and #1053 closed it for the model trigger by LAYERING, not by widening the join. This ticket answers the same question for a different field and must not import that answer. |
| `docs/knowledge/features/composer-effort-menu.md`, `docs/knowledge/features/run-config-store.md` § the `publishedRowFor` re-anchor | — | The shipped effort readings and the no-client-vocabulary ruling #976 established. |
| `e2e/real-daemon-session-settings.spec.ts` header | — | Its premise is "claude-less ⇒ no `model_list` frame at all", which survives this ticket; only its prose about *no row matched* narrows. |

## Design source

**Figma (footer effort control):** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3688

A 36×16 inline control: the session's effort in `M3/body/small` (12px, 0.4px tracking) painted
`schemes/primary`, then a 4px gap, then the 8×4 `chevron-up-solid-full` glyph in `currentColor`. This is
exactly the menu arm `ComposerEffortMenuView` already draws — the chevron is the design's mark that the
control opens a panel, which is why the inert arm withholds it. Nothing new is drawn here; an
inherited-default chat that today renders the label-only span will render this instead.

**Figma (run-configuration sheet, Effort section):** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-130

A 16px-padded row of 8px-gapped pills, each `M3/label/large` (14px medium) inside an 8px radius: the
unselected ones outlined `schemes/outline` on `schemes/on-surface-variant` text, the selected one filled
`schemes/secondary-container` with `schemes/on-secondary-container` text and no border. Again exactly the
shipped `run-config__effort-segment` strip and its `[aria-current='true']` treatment — the design source
is pinned here because the arm this ticket newly reaches is the segment arm, not because any pixel moves.

## Context

Both effort surfaces resolve the levels they offer by exact equality on the session's model against the
daemon's published rows. A session nobody has set a model on carries `''`, which the wire contract calls
the inherited daemon default and explicitly *not* absent — and `''` matches no published row, because the
daemon publishes its inherited default as an ordinary row valued `default`. So both surfaces fall into a
nothing-to-offer arm, and they fall into different ones: the footer draws an inert label with no button,
no popup and no chevron; the sheet prints the effort as plain text in `run-config__effort-current`, its
UNKNOWN reading. Measured against a live daemon on 2026-09-05 that is the state an unconfigured session
sits in permanently, so it is the common case and it is also false — the model that chat will run at does
publish levels.

The fix is a join, not a fallback list: an empty model resolves to the row the daemon publishes for its
inherited default, and that row's `effort_levels` are what both surfaces offer. Nothing else moves.

No ADR is warranted. This is the third answer in a settled family — #976 anchored the levels on the
published rows, #1053 answered the inherited-default question for the model trigger by layering — and the
reasoning belongs in the two module docblocks and the package overviews the documentation phase owns.

## Design

### The rule, and its one home

A new exported function in `RunConfigSections.tsx`, declared immediately below `publishedRowFor` and
beside it in the same file for the reason #988 recorded when it exported that helper rather than lifting
it: a co-located module would be a refactor neither ticket needs, and the export is what makes "one home"
true.

```ts
const INHERITED_DEFAULT_MODEL_VALUE = 'default'

export function effortRowFor(
  models: ModelListEntry | null | undefined,
  model: string
): WireModelOption | undefined
```

Behaviour, in one sentence: `effortRowFor` returns `publishedRowFor(models, model)` for every model
except `''`, and for `''` returns `publishedRowFor(models, INHERITED_DEFAULT_MODEL_VALUE)`. It is a
substitution of the lookup ARGUMENT, not a second matching rule — `publishedRowFor` is called unchanged,
with its `===` doing all the comparing, so no case fold, trim, prefix, substring or family derivation
exists anywhere on this path either before or after the change.

`INHERITED_DEFAULT_MODEL_VALUE` is module-private and compared only by being handed to `publishedRowFor`,
which is the `EFFORT_LEVELS_FIELD` idiom in this same file: a client-owned literal that meets
daemon strings through `===`, never through an index lookup. It is deliberately NOT exported — the tests
seed the literal `'default'` themselves, so changing the constant reddens a test rather than silently
following it.

**Precedence, stated so a cold read need not guess.** The empty-model branch resolves to
`INHERITED_DEFAULT_MODEL_VALUE` and consults no other row. A daemon publishing a row whose `value` is
literally `''` is not a case this path arbitrates — one rule, one answer — and `ComposerModelMenu`'s
docblock keeps its own separate answer for its own control, unreopened here.

**It is a join, never a vocabulary.** With no `default` row published, or no `model_list` frame received,
`effortRowFor` returns `undefined` and both surfaces render exactly what they render today. #976 deleted
the last client-side level list and nothing here re-mints one: the only client-owned string added is the
row VALUE to look up, and the levels themselves stay entirely the daemon's.

### The two call sites

- `EffortSection` (`RunConfigSections.tsx`) swaps its `publishedRowFor(models, model)` for
  `effortRowFor(models, model)`. Everything downstream of `row` — `levels`, `isCut` read per field
  against `EFFORT_LEVELS_FIELD`, the `nothingKnown` collapse, the three renderings and the cut marker —
  is untouched, so the section applies its four shipped readings to whatever the resolved row carries.
- `composerEffortMenuModel` (`ComposerEffortMenu.tsx`) swaps its `publishedRowFor(models, model)` for
  `effortRowFor(models, model)` and changes its import accordingly. The `effort === ''` early return, the
  label, the `currentId`, the `options` mapping and the view's inert-vs-menu split are untouched, so the
  footer draws the openable menu on the arm it now reaches and stays inert on the arm it does not.

### The three callers that must not change (AC4)

`RunningModelSection`, `composerModelMenuModel` (both of its lookups) and
`composerPermissionModeMenuModel` keep calling `publishedRowFor` directly, and `publishedRowFor`'s own
body is not touched. That placement is the whole of AC4 and it is not a stylistic preference: the
permission-mode menu reads `supports_auto_mode === false` off the row it resolves, so a branch inside the
shared helper would start hiding the `auto` entry on every inherited-default chat — a behaviour change to
a different control that no criterion in this ticket would catch. Two regression tests pin that
placement; see § Testing strategy.

### No new element, sentence or arm (AC2)

The diff adds one function, one constant and two docblock revisions. It adds no JSX, no CSS class, no
copy constant and no branch inside either surface. Every rendering either surface can produce after this
change is one it could already produce before, reached with a different input.

## State + concurrency model

None added. `effortRowFor` is a pure synchronous function over its two arguments, with no store read, no
effect, no timer, no subscription and no async work — so there is nothing to cancel and no teardown path.
Both call sites already run inside a render body reading `modelListStore` and `runSettingsWriteStore`
through their existing selectors, and those subscriptions are unchanged. Re-render behaviour is
unchanged: the function is called in the same place in the same render pass and returns a reference into
the same store-held array.

## Error handling

No I/O, no IPC and no parse, so no result type is introduced. The failure modes that exist are
absence-shaped and all already have shipped renderings:

- no `model_list` frame for the conversation → `models` is `null` → `publishedRowFor` returns `undefined`
  → the sheet's UNKNOWN text arm, the footer's inert arm. Unchanged from today.
- a frame with no inherited-default row → same `undefined`, same two arms. Unchanged from today.
- the inherited-default row publishing an empty list with no cut → the sheet's offers-none sentence, the
  footer inert. This is the shipped `[]` reading, newly reachable for an empty model.
- the inherited-default row publishing an empty list BESIDE a reported cut → the sheet's UNKNOWN arm plus
  its cut marker, per the wire contract's MUST that a cut list is unknowable rather than none.
- `effort_levels` arriving as `undefined` through a bare `as` → the shipped `?? []` guard at both call
  sites, untouched.

Nothing throws and nothing is logged on this path — the surfaces log nothing today and this ticket adds
no log call, which is the correct posture for a render-time lookup over claude-authored strings.

## Testing strategy

All of it is vitest under the repo's `node` environment. Nothing in this repo can click, so the footer's
arm flip is proven twice: as DATA through `composerEffortMenuModel`, and as MARKUP through
`ComposerEffortMenuView`, whose two arms render structurally different elements (the menu arm renders
`aria-haspopup` and the `composer__effort-icon` chevron; the inert arm renders neither). No Playwright
spec is added — no fake-tier spec seeds a row valued `default`, so no e2e behaviour changes and the tier
stays exactly as green or as red as it is on main.

**The existing sheet fixtures cut both ways and were audited render by render.** `PUBLISHED_ROWS[0]` is
`value: 'default'` carrying `['brisk', 'thorough']` and every `base` in that file is `model: ''`, so each
render passing `models={PUBLISHED}` without overriding `model` moves from the UNKNOWN text arm to the
segment arm. Audited: those renders assert on `run-config__model-row`, `run-config__model-name`,
`run-config__model-descriptor`, `Current model`, `run-config__model-partial` and `>0<`, none of which an
effort segment can satisfy or suppress — so they pass unchanged rather than by luck. The one render whose
Effort arm changes to the offers-none SENTENCE (a single-row list valued `default` with no levels)
asserts only on the descriptor element. These are re-read rather than trusted, and the audit is the
reason no assertion in that file is edited.

**New cases, `RunConfigSections.test.tsx`** — a new describe for this ticket:

- AC1: `model=''` with `models={PUBLISHED}` and an effort of `brisk` renders one segment per level of the
  inherited-default row, in published order, with `brisk` alone marked `aria-current="true"` and no
  `run-config__effort-current` line at all.
- AC1, the negative half in the same shape as the shipped follows-the-selected-model test: the segments
  are the `default` row's, never another row's.
- AC2, offers-none: an inherited-default row publishing `[]` with `truncated_fields: null` moves the sheet
  to `RUN_CONFIG_EFFORT_EMPTY_COPY` — not to the text arm, and with no segment.
- AC2, cut: an inherited-default row publishing `[]` beside `truncated_fields: ['effort_levels']` renders
  the UNKNOWN text arm plus the cut marker; one publishing `['brisk']` beside the same cut report renders
  one segment plus the cut marker.
- AC3, the branch is not taken without a row: `model=''` against a list holding no `default` row, against
  `null`, and against an omitted prop each render byte-identically to what they render today — the text
  arm, no segment, no offers-none sentence.
- AC3, `''` is the only input: a table of near misses — `' '`, `'DEFAULT'`, `'defaul'`, `'default-x'`,
  `'Default'`, `' default'` — against `models={PUBLISHED}` offers nothing, so a trim, case fold, prefix
  or substring introduced on this path fails a test rather than passing quietly.
- AC4, `RunningModelSection` is unmoved: an announcement of `{ model: '', truncated: false }` against
  `models={PUBLISHED}` still renders the announced value verbatim (a present, empty line) rather than the
  inherited-default row's `display_name`. This is the assertion that fails if the branch is put inside
  `publishedRowFor`.
- AC4, `ModelSection` is unmoved: `model=''` against `models={PUBLISHED}` marks no row current.

**New cases, `ComposerEffortMenu.test.tsx`** — extending the shipped `it.each` shapes with a list that
holds an inherited-default row:

- AC1 as data: an empty model resolves that row's levels, with the label and `currentId` still the
  session's effort verbatim.
- AC1 as markup: the same input renders the OPENABLE menu — the anchor, `aria-haspopup`, the trigger
  button and the chevron — where today it renders the inert `composer__footer-button` span with neither.
- AC2: an inherited-default row publishing `[]` gives `options: []` and the inert arm, label intact.
- AC3: an empty model against a list with no inherited-default row, and against `null`, gives
  `options: []` and the inert arm — the shipped rendering, unchanged.
- AC3: the near-miss table (`' '`, `'DEFAULT'`, `' default'`) resolves nothing.
- The unchanged first rendering: `effort === ''` still returns `null` even when the empty model would now
  resolve a row publishing levels.

**New cases, the AC4 guards on the two controls this ticket must not move** (test-only additions; neither
production file is touched):

- `ComposerPermissionModeMenu.test.tsx`: an empty session model against a list whose inherited-default
  row carries `supports_auto_mode: false` still offers the `auto` entry. This reddens precisely if the
  empty-model branch is placed inside `publishedRowFor`, and it is the finding the ticket's own technical
  notes call out as catchable by no other criterion.
- `ComposerModelMenu.test.tsx`: with `picked` and `stored` both `''` and an announcement shown, a
  published inherited-default row leaves `currentId` `null` rather than marking that row.

Fakes and mocks: none needed. Every function under test is pure, and every view is a static server render
over props.

## Open questions

1. **`effortRowFor` versus a longer name naming the field.** Expected answer: `effortRowFor` — it sits
   beside `publishedRowFor` and is named for its two callers' shared question, matching the naming
   rationale `publishedRowFor`'s own docblock records for being named after the rule rather than a use.
   Resolved during implementation; a change is recorded under `## Revisions`.
2. **Whether `INHERITED_DEFAULT_MODEL_VALUE` should be exported for the tests.** Expected answer: no, per
   § Design — an exported constant lets a test follow a changed value instead of catching it. Recorded
   under `## Revisions` if the tests argue otherwise.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The boundary is unmoved: `parseModelList` in the main process is
  where a daemon frame becomes a `ModelListEntry`, and `modelListStore`'s header records that #972 made
  the SHAPE trusted and the CONTENT not. `effortRowFor` sits entirely downstream of it, returns the same
  `WireModelOption` the helper it wraps returns, and hands it to two call sites whose downstream code is
  byte-identical after the change — so no daemon-authored string reaches any position it does not reach
  today. The one new client→daemon comparison is `publishedRowFor(models, 'default')`, which is
  `Array.prototype.find` with `===`: a linear scan, never an object index, so a row valued `__proto__`
  is compared rather than used as a key (a vector `RunConfigSections.test.tsx` already fires through
  this exact path).
- **[Tokens, secrets, credentials]** Not applicable by construction, and this is a placement decision
  rather than an absence. The renderer holds no token, no key and no socket — CLAUDE.md's process split
  keeps all three in the background process — and `effortRowFor` reads exactly one argument type,
  `ModelListEntry`, which carries display strings only. Nothing here is created, stored, rotated,
  revoked or compared against a secret.
- **[File / storage operations]** No findings. No path is constructed, joined, resolved or opened; no
  `fs` call, no `localStorage`, `sessionStorage` or IndexedDB write. `INHERITED_DEFAULT_MODEL_VALUE` is
  a client-owned literal that reaches exactly one position — a lookup argument compared by `===` — and
  is never a filename, a cache key or a lookup path.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel and no `webPreferences` are added or altered; no protocol handler, no navigation and no
  `window.open`. The single outbound on either surface is the shipped `changeSetting` →
  `window.pyry.sendCommand` on the footer's `onSelect`, which this diff does not touch. Checked
  specifically: the new branch does not make that call reachable in a state where the session id is
  unknown — `changeSetting`'s own gate is unchanged, and the footer's container docblock already records
  that gate as the whole gate for this control.
- **[Cryptographic primitives]** Not applicable, and the reason is worth stating rather than asserting:
  the `===` this design adds compares a client-owned published-row value against daemon display strings,
  neither of which is a secret, so `crypto.timingSafeEqual` is the wrong tool here — it is for comparing
  attacker-controlled input against a secret, and there is no secret on this path. No RNG, no hashing,
  no key derivation, nothing touching the Noise session.
- **[Network & I/O]** No findings. No frame is sent, received or parsed by this change; `maxPayload`,
  the TLS posture, the connect and idle deadlines and the reconnect backoff all live in the transport
  and are untouched. A relay that drops the `model_list` frame degrades to `models === null`, which is
  the shipped nothing-to-offer rendering on both surfaces — the same one an unconfigured chat gets today.
- **[Error messages, logs, telemetry]** **SHOULD FIX — no diagnostic log may be added on the miss path.**
  Neither surface logs anything today and this design adds no log call, which is the correct posture; but
  the miss path (`effortRowFor` returning `undefined` for an empty model) is exactly where a debugging
  instinct writes `console.warn('no inherited-default row for', model)`, and that line would put a
  daemon-authored `value` into a log — the sink CLAUDE.md's daemon-text ruling forbids outright, and
  which nothing in the acceptance criteria would catch. Phase B adds no log statement on either call
  path; the verifier should check the diff for one. A miss is ordinary and permanent under best-effort
  frame delivery, so it is not an error condition to report at all.
- **[Concurrency]** No findings, and no new race. `effortRowFor` is pure, synchronous, allocates nothing
  and owns no task, timer, listener or subscription, so there is nothing to cancel and no teardown path.
  The one shared-state question worth naming: `models` and `model` are read from two different stores in
  the same render pass and can therefore reflect different ticks, so a segment strip can momentarily
  reflect a list one tick stale. That is a pre-existing property of every model/levels pairing in both
  surfaces, is corrected on the next render, and is bounded to a display — this change neither creates
  nor widens it.
- **[Threat model alignment]** Two desktop-specific threats are in scope here and both are addressed:
  - *Hostile or buggy daemon.* It can now choose what an inherited-default chat's effort control offers,
    by publishing a row valued `default` with levels of its choosing — and the picked level is submitted
    VERBATIM in `set_session_settings.effort`, with no client-side allowlist. That is #976's shipped and
    deliberate posture for every configured chat, extended to one more set of sessions rather than
    changed in kind: the daemon is the authenticated peer inside the Noise session, its own inbound
    `validEffort` is a closed enum that refuses a level it will not run, and a refusal surfaces through
    the shipped `RunConfigError` line with #256's automatic rollback. Re-minting a client-side level
    allowlist to "fix" this would put back exactly the vocabulary #976 deleted, and is rejected.
  - *Hostile level text reaching a render boundary.* Newly reachable for an unconfigured chat, identical
    in kind to what a configured chat already renders. Every level reaches exactly one escaped JSX text
    position on both surfaces; the footer's `.composer__effort-label` caps and ellipsizes it, and the
    sheet's `.run-config__effort-segment` wraps it inside its own pill (`min-width: 0`, #976's explicit
    choice not to truncate a string the segment submits) — so an unbounded level is a layout the sheet
    absorbs rather than a denial of the reading beside it. The escaping and non-sink guards are already
    pinned by tests in both files and this ticket adds no new sink.
  - *Malicious relay* is content-blind and on-path: it can drop or delay the `model_list` frame, which
    degrades to the shipped inert readings, and it cannot forge one without the Noise session.
  - *Renderer compromise* gains nothing here — this code is already in the renderer and reads only
    display strings the renderer already holds.
- **[Out of scope]** Whether the footer's model trigger should mark the inherited-default row on an
  empty session model: a different control and a settled separate answer (`ComposerModelMenu`'s docblock,
  #1053), named here so it is visibly deferred rather than overlooked.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

## Revisions

**2026-09-06 — a third production file, comment-only.** The plan named two production files.
`ComposerPermissionModeMenu.tsx` is a third, and nothing executable in it changed: its docblock claimed
"the same rule EffortSection and both neighbouring triggers join, and this is that helper's FIFTH
caller", and this slice falsified both halves — the two effort surfaces now join through `effortRowFor`,
and `publishedRowFor` has one fewer call site. Leaving a claim this diff makes false is the divergence the
committed plan exists to prevent, so the paragraph was narrowed in place and now records why this menu
deliberately did NOT follow the two effort surfaces. Two smaller instances of the same correction:
`ComposerEffortMenu.tsx`'s file header named `publishedRowFor` as what finds the levels, and
`e2e/real-daemon-session-settings.spec.ts`'s header gave *no row matched* as the reason its section stays
inert — which is now *no frame received*, the state that claude-less tier is permanently in. That spec's
premise and its assertions are untouched.

**Open question 1 resolved as expected:** the function shipped as `effortRowFor`.

**Open question 2 resolved as expected:** `INHERITED_DEFAULT_MODEL_VALUE` stayed module-private, and all
four test files seed the literal `'default'` themselves.

**No design change.** The two call sites, the substitution-on-the-argument shape, the precedence rule and
every rendering are exactly as designed above; the security review's one SHOULD FIX was honoured — the
diff adds no log statement on either path.
