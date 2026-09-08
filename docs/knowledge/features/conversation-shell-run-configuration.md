# Conversation shell — run configuration

The Run configuration sheet: model, effort, YOLO mode, context-window usage, and the log-data download.

Part of [Conversation shell — workspace and run configuration](conversation-shell-workspace-and-run-config.md); see that document for the workspace chip and picker.

## Run configuration sheet (#177)

The host modal for the session's Model / Effort / YOLO controls, context-window state, and
Log-data download — each section is a follow-up ticket (#181 — since split into #187/#188, #182,
\#72) that owns both its header and its content. This ticket ships only the chrome: the trigger and
the empty, dismissible sheet.

`StatusRow` was originally a full-width icon-only `<button aria-label="Run configuration"
aria-haspopup="dialog">` between `MessageThread` and `Composer` (Figma node `16-57`), with a top border
separating it from the thread. Its left summary region (`model · effort · context%`) was intentionally
empty at shell-landing time — that live text was meant as the collapsed mirror of the sheet's read
sections, owned by #188/#182 — and [#330](../codebase/330.md) turned `.status-row__summary` into a flex
row and mounted the two-dot connection indicator as its first child instead; the `model · effort ·
context%` text itself was never built.

**[#962](https://github.com/pyrycode/pyrycode-desktop/issues/962) retired `StatusRow` outright** — the
desktop design (Figma `102:4`) draws nothing in the region between the thread and the composer, and by
then the row's three jobs had all been re-homed elsewhere (permission mode and model/effort to the
input footer, #682/#683; the context gauge to the footer's reading, #811; the connection dots to the
sidebar host row, #672/#718). The trigger is now the `Run configuration` item in the thread's overflow
menu — see [Run-configuration row and background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962).
Clicking it calls `onRunConfiguration`, which flips `sheetOpen` — the same `useState(false)` in
`ConversationScreen` that `StatusRow`'s `onExpand` used to flip (the "trivial single-value local UI state"
case carved out by [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), not its
`useReducer` phase-machine case), untouched by the retirement. It resets to closed on remount for free —
a guarantee [#670](../codebase/670.md) had to restore explicitly via `ConversationScreen`'s `key` once a
sidebar-driven conversation switch could otherwise leave the route on `thread` with no remount at all;
see [the paired shell's `paneKey`
fix](paired-shell-routing.md#the-conversation-switch-remount-bug-and-the-panekey-fix).

`StatusSheet` (Figma node `20-100`) renders as the screen's last child when `sheetOpen` is true:

```
.status-sheet-overlay          absolute, inset: 0, flex column, justify-content: flex-end
├── .status-sheet-overlay__scrim   absolute, inset: 0, --color-scrim @ opacity 0.4, onClick=onClose
└── .status-sheet                 role="dialog" aria-modal="true" aria-labelledby=<title id>
    ├── .status-sheet__handle       32×4 decorative drag bar, aria-hidden
    ├── .status-sheet__header       title (left) + × close control (right, aria-label="Close")
    └── .status-sheet__body         empty, flex:1 1 auto; min-height:0; overflow-y:auto
```

It is an **absolutely-positioned overlay inside `.conversation`** (which gained `position: relative`
for this), not a React portal — no App-level z-index coordination, fully self-contained in the
screen. The scrim is a **separate element**, not the overlay's own background, so the opaque panel
sibling is never dimmed and no bare `rgba()`/`color-mix` literal is needed; it doubles as a
near-free backdrop-click dismissal. The `×` close control is the **authoritative** dismissal path
(clicking it or the scrim both call `onClose`, which flips `sheetOpen` back to `false`); Esc-to-close
was left out (optional per spec, unobservable under the server-render harness).

Two M3 dark-scheme tokens were ported into `tokens.css` ahead of their other consumers (sanctioned
by that file's header comment): `--color-surface-container-low` (the panel fill) and
`--color-scrim` (applied only via `opacity`, never as a raw color-with-alpha literal). Icons are
inline `currentColor` SVGs, the `.composer__send` precedent — no remote asset fetch (CSP blocks it).

Not wired yet at shell-landing time: no live summary text in `StatusRow`, no focus trap/restore on
open-close (accepted for a shell with a single focusable control; worth adding once more than one
section is interactive — see [#177 codebase notes](../codebase/177.md) for the full code-review
record). `StatusRow`'s summary slot gained its first content in [#330](../codebase/330.md) — the
two-dot connection indicator, not the run-config text this paragraph originally meant — and both `StatusRow`
and that indicator were retired by #962 (above); the trigger and the focus-trap gap moved with it onto
`ThreadOverflowMenu`'s `Run configuration` item, which has no focus trap either. The sheet
body itself gained its first section in [#72](#log-data-section-72) below; all
four read-only sections (Model/Effort/YOLO, #188, and Context window, #192) have since landed. See
[#177 codebase notes](../codebase/177.md) for the shell's full design and lessons learned.

A **headless data path** for the Model/Effort/YOLO/Context-window sections landed in
[#187](../codebase/187.md): `<RunConfigData/>`, mounted as the sheet body's first child (ahead of
`<RunConfigSections/>` and `<LogDataSection/>`), requests a fresh `screen_snapshot` on every sheet
open and holds `model`/`effort`/`yolo` (and, since [#192](../codebase/192.md), `usedTokens`/
`windowTokens`) in a dedicated [Run configuration store](run-config-store.md). The Model/Effort/YOLO
render landed in [#188](../codebase/188.md); the Context window render landed in
[#192](../codebase/192.md). See [Run configuration data path](#run-configuration-data-path-187),
[Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), and
[Run configuration Context window section](#run-configuration-context-window-section-192) below.

## Run configuration data path (#187)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

`RunConfigData` is a headless container (`(): null`) — no markup, no header, no rows; it exists
purely to drive the fetch-and-hold data path the moment the sheet opens, ahead of #188 rendering
anything from it. Because the sheet body is conditionally mounted
(`{sheetOpen && <StatusSheet>…}`), `RunConfigData`'s own mount **is** the sheet's open transition,
so "request once per open" reduces to "request once per mount" — a `useRef(false)` guard makes that
hold even under React StrictMode's dev double-invoke. A second effect subscribes to
`window.pyry.onDaemonEvent` (off-handle cleanup, the `daemonEventBridge` idiom) and writes each
arriving `runConfigReceived` verbatim into the [Run configuration store](run-config-store.md)'s
single setter (originally `snapshotReceived`, moved onto the dedicated reply at #491/#500 — see [Run
configuration store § Moved off screen_snapshot](run-config-store.md#moved-off-screen_snapshot-491500)).
See [Run configuration store](run-config-store.md) for the full data-path design and
[#187 codebase notes](../codebase/187.md) for patterns established.

## Run configuration Model/Effort/YOLO sections (#188)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188)
│   └── RunConfigView                  (pure: three primitive props in, markup out)
│       ├── ModelSection                .status-sheet__section-header "Model" + 3-row radio list
│       ├── EffortSection                .status-sheet__section-header "Effort" + 5-segment control
│       └── YoloSection                  .status-sheet__section-header "YOLO mode" + labelled switch
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The three sections the sheet's Model/Effort/YOLO controls needed, mounted between `RunConfigData`
and `LogDataSection`. `RunConfigView` is the exported pure view — three primitive props
(`model`/`effort`/`yolo`) in, markup out, no store read and no `window.pyry`, so it
server-renders with no mock, the same seam `LogDataView`/`RunConfigData` use. `RunConfigSections` is
the thin exported container: `useRunConfigStore(selectSnapshot)` reads one narrow slice and
coalesces `snapshot ?? { model: '', effort: '', yolo: false }` before handing the triple to
`RunConfigView` — so the store's pre-load `null` and a real all-defaults `screen_snapshot` render
through the identical code path (both are AC4's blessed default: no radio filled, no segment marked,
switch off).

- **Model** — shipped at #188 as a static catalog (Opus 4.7 / Sonnet 4.6 / Haiku 4.5, each with a
  one-line descriptor) matched against the snapshot's `model` string via `matchedFamily`, a
  case-insensitive substring match against each catalog entry's family token. [#590](../codebase/590.md)
  added a fourth entry, `Fable 5` (family token `fable`), between Sonnet and Haiku. **Deleted outright
  by #975** — the catalog, `matchedFamily` and all four hardcoded rows are gone; see § Run
  configuration Model section, daemon-published rows (#975) below.
- **Effort** — shipped at #188 as five fixed segments (`low`/`medium`/`high`/`xhigh`/`max`) matched by
  exact equality; the current level carried `aria-current="true"`, both the accessibility marker and
  the CSS hook (`[aria-current='true']`) for the filled-pill style — no parallel modifier class.
  **Rewritten by #976** to offer the selected model's published levels instead — the five-value
  constant is gone; see § Run configuration Effort section, daemon-published levels (#976) below. The
  `aria-current` selection mechanism and its CSS hook are unchanged.
- **YOLO** — a between-justified "Auto-accept tool calls" row with a switch rendered `role="switch"
  aria-checked={yolo} aria-readonly="true"`: honestly read-only (not focusable) until
  [#183](https://github.com/pyrycode/pyrycode-desktop/issues/183) drops `aria-readonly` and wires an
  `onClick`. Figma pins only the off state; the on state (`--color-primary` track, `--color-surface`
  knob) mirrors M3 on-switch semantics with tokens already in the palette — no new token, and
  low-risk since production data is always `yolo: false` until #183 lands the write path.

One more M3 token landed: `--color-surface-container-highest` (the switch's off-track fill; reused by
[#192](../codebase/192.md)'s context-window track below). See [#188 codebase notes](../codebase/188.md)
for the full design and patterns established.

An unconfirmed in-flight change to any of the three ([#558](../codebase/558.md)) no longer renders
identically to a settled one: the owning wrapper (the model list, the effort row, or the switch itself)
carries `aria-busy="true"` plus a dashed `--color-warning` ring/border, sourced from
[#256](../codebase/256.md)'s `selectPendingFields`, clearing through the same reject/confirm/reconnect
paths [Run configuration write store](run-settings-write-store.md) already converges on.

## Run configuration Context window section (#192)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188/#192)
│   └── RunConfigView                  (pure: five primitive props in, markup out)
│       ├── ModelSection
│       ├── EffortSection
│       ├── YoloSection
│       └── ContextWindowSection         .status-sheet__section-header "Context window" + usage gauge
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The fourth and last section of the read-only surface, mounted between `YoloSection` and the sibling
`LogDataSection` per Figma order. Widens the [Run configuration store](run-config-store.md)'s held
`RunConfigSnapshot` (and the `toRunConfigSnapshot` copy) by the two usage figures [#191](../codebase/191.md)
already carries on the transport event (originally `snapshotReceived`, now `runConfigReceived`,
\#491/#500) — `usedTokens`/`windowTokens` — and renders them as:

- **Available (`windowTokens > 0`):** a usage line — `` `${pct}% used (${abbreviateTokens(usedTokens)}
  of ${abbreviateTokens(windowTokens)} tokens)` `` — above a `role="progressbar"` track/fill whose fill
  width is set inline per render (`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label`
  complete the honest a11y contract). `pct` is `used/window` rounded and clamped to `[0, 100]`, so an
  over-full session reads "100% used" with a full (not overflowing) bar, while the raw abbreviated
  figures stay honest about the overflow (e.g. "210K of 200K tokens").
- **Unavailable (`windowTokens <= 0`):** a single muted "Context usage unavailable" line in place of
  the usage line and bar — no progressbar role, no division ever runs.

The container's null-default gained `usedTokens: 0, windowTokens: 0` — the same move [#188](../codebase/188.md)
made for `model`/`effort`/`yolo`, one step further: **the not-yet-loaded default and the daemon's
`window_tokens == 0` "usage unavailable" signal collapse into the identical `windowTokens > 0` branch**,
so there is exactly one guard, not two, and the division genuinely never executes on either falsy
path (AC5 — no NaN, no Infinity, no divide-by-zero). `abbreviateTokens` (1000+ → `"146K"`, else a raw
count) stays an in-file, unexported one-liner; zero new public exports, zero new theme tokens (reuses
`--color-success` and #188's `--color-surface-container-highest`). See
[#192 codebase notes](../codebase/192.md) for the full design and patterns established.

**The percentage itself moved out to a shared function, `contextUsagePercent` (#811).** This section's
own inline expression — `Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))`
behind `windowTokens > 0` — is now `contextUsagePercent(usedTokens, windowTokens)`, in the new
`src/renderer/src/screens/conversation/contextUsage.ts`, so this gauge and the
[composer footer row](conversation-shell-composer-message-box.md#composer-footer-row-811)'s "Context: N%" reading share one guard and one clamp
rather than two that could drift apart. `#1062` added a severity ladder (`contextUsageStep`, in the same
file) to the footer reading alone — `.run-config__context-fill` stays `--color-success` at every value on
purpose, so this gauge and that reading can show different colours for the same number today; the shared
function is what leaves the bar one class away from following the ladder in a later ticket.
`ContextWindowSection` calls it and derives nothing itself —
`pct !== null` replaces the old `available` ternary — and every other line in the section (the usage
string, the `role="progressbar"` triple, the inline fill width, the unavailable line) is byte-identical
to before the extraction; `RunConfigSections.test.tsx`'s existing assertions pass unedited, which is the
extraction's own behaviour-preservation proof. **The guard also gained `Number.isFinite(windowTokens)`**,
closing a real hole the old clamp had: `used_tokens`/`window_tokens` cross the wire through a bare
`typeof === 'number'` check with no range test (`inboundMessage.ts:611-622` rules that deliberately —
a client-invented bound would drop valid future frames, so *"the render slice formats the counter
defensively instead"*), so a daemon frame carrying `used_tokens: 1e999, window_tokens: 1e999` parsed to
`Infinity`/`Infinity` and the pre-#811 clamp rendered `NaN% used` with a `width: NaN%` fill. `windowTokens
<= 0` and non-finite now collapse into the identical unavailable branch — an architect self-review
security finding (MUST FIX), closed in the same extraction rather than as a follow-up.

## Run configuration Model section, daemon-published rows (#975)

The Model section stops guessing. `MODEL_CATALOG`, `ModelCatalogEntry`, its family tokens, its
hand-written descriptors and the `matchedFamily` substring matcher are deleted outright — no model
name and no family token is hardcoded in `RunConfigSections.tsx` anywhere. `ModelSection` renders
one row per entry in [Model-list store](model-list-store.md)'s held [`ModelListEntry`](model-list-store.md)
for the active conversation, in the daemon's published order, deriving nothing: `value` is not
parseable (measured entries: `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`) and no
family is split out of it.

**`RunConfigSections` takes the conversation id as a prop, not a store read.** The container
previously had only `sessionIdStore`'s *session* id in scope — a different identifier that keys
nothing in `modelListStore`'s per-conversation map, so reaching for it would compile clean,
typecheck clean, and render the not-yet-known line forever. `ConversationScreen` now passes
`conversationId={activeConversation?.id ?? null}` at the existing `<RunConfigSections />` mount, the
same `activeConversation`-sourced prop `ComposerSlot` and `BackgroundTaskPanel` already take. The
container memoises the selector factory on the id (`useMemo`, the `useSlashCommandTypeAhead` idiom)
and short-circuits a `null` id through the identical path rather than an invented key.

**Three readings, not two.** `selectModelListFor` returns `null` for "no frame has arrived yet" and
a present entry holding `models: []` for "claude published an empty list" — the Model section keeps
them apart as two different sentences in two different elements (`RUN_CONFIG_MODELS_UNKNOWN_COPY` /
`RUN_CONFIG_MODELS_EMPTY_COPY`), the [`BackgroundTaskPanel`](conversation-shell-question-panel.md)
convention for the identical pair. Neither renders an empty control or a stale menu.

**Selection is exact equality on `value`, full stop** — no `toLowerCase`, `includes`, `startsWith`,
`trim` or regex anywhere on the path — and it round-trips: a row's `onClick` submits its `value`
verbatim, the optimistic overlay ([Run configuration write store](run-settings-write-store.md))
holds that same string, and the identical comparison re-selects the row it came from. The moment
either side normalises, the two stop being the same string, which is why the guard `RunConfigSections.test.tsx:563`
existed for (an announced identifier that is a *superstring* of a published `value` must not select
that row) is re-anchored on a published row rather than dropped with the `matchedFamily` matcher it
used to name.

**The React `key` is the array index, deliberately.** `display_name` and `value` are both
claude-authored text a key would turn into a lookup path — the store's own header assigns this slice
that obligation. There is also no cross-frame identity to preserve: each frame replaces the
conversation's list wholesale, rows never reorder within a render, and claude may legitimately
publish two rows sharing a `value`.

**Both of the frame's truncation reports reach the operator, kept apart.** A row whose
`truncated_fields` is non-empty renders the sheet's existing cut copy (`RUN_CONFIG_CUT_COPY`,
renamed from `RUN_CONFIG_RUNNING_CUT_COPY` and now shared by both this section and
`RunningModelSection`) in a sibling element inside its text column — `null` and `[]` say the
identical thing per the wire, so the check is on length, not presence. A frame reporting
`droppedModels > 0` renders a partial-list notice as a **sibling of the three-way branch**, not a
child of any arm, so an entry reporting drops beside zero carried rows still shows it; `> 0`, never
truthiness, since React renders a bare `0` as a text node.

**The running-model lookup ([§ Running model section](run-config-store.md#running-model-section-560-resolved-onto-the-published-rows-by-975))
moves onto these same rows.** `runningPublishedRow` (renamed `publishedRowFor` by
[#976](https://github.com/pyrycode/pyrycode-desktop/issues/976), which gave it a second caller — see
§ Run configuration Effort section, daemon-published levels below, and exported by
[#988](composer-model-menu.md) for a third, the composer footer's model menu) joins claude's per-turn announcement
(`announcedModelStore`) against a published row's `value` by exact equality — not `resolved_model`,
which the wire contract's join prose excludes and which would give the exactness guard above an
exception (Haiku's `resolved_model` is a superstring of its own `value`). The lookup stays mostly
dormant in practice, the same outcome [#560](../codebase/560.md) already documented and accepted —
claude echoes an identifier at least as specific as the one it was given, so it rarely equals a bare
`value` — but it now joins against real published data instead of four hardcoded family tokens.

**Untrusted text, one boundary.** `display_name`, `value`, `resolved_model` and every
`truncated_fields` element are claude-authored strings that crossed the subprocess trust boundary,
bounded by the daemon and not sanitized by it (the tier [Model-list wire types](model-list-wire-types.md)
declares). Each reaches exactly one JSX text position, escaped by React's default; none reaches an
attribute, a URL, a filename, a cache key, a lookup path, or a log line — and nothing on this path is
logged at all. Each row's second line renders `resolved_model` unconditionally (even an empty or a
`<unmeasured>` value), which is the honest mitigation for the one risk that is *not* client-closable:
a `value` cut mid-token by the daemon (`opus[1m]` → `opus`) still passes the daemon's inbound
`validModel` charset check and silently runs a different model, so showing the concrete resolution
before the first turn is the only defense available here.

CSS gained `.run-config__model-unknown`, `.run-config__model-empty`, `.run-config__model-partial` and
`.run-config__model-cut` on the shipped muted body-small tokens (none is an error state), and paired
`overflow-wrap: anywhere` onto `.run-config__model-name`/`.run-config__model-descriptor` now that both
lines carry unbounded daemon text instead of short static labels — the `.run-config__running-value`
precedent. See [#975 codebase notes](../codebase/975.md) for the full design, the security review,
and why the join key is `value` rather than `resolved_model`.

## Run configuration Effort section, daemon-published levels (#976)

The last hardcoded vocabulary in the sheet goes. `EFFORT_LEVELS`, the five-value constant
(`low`/`medium`/`high`/`xhigh`/`max`) `EffortSection` rendered for every model, is deleted; the
segments offered are now the *selected model's* published `effort_levels`, read off the same
[Model-list store](model-list-store.md) entry the Model section reads. Reasoning-effort support is
per model — measured live against claude 2.1.220 on 2026-08-21, Haiku publishes no levels at all while
the other rows publish all five — so the fixed strip used to offer Haiku five choices it could not use
and ask the daemon for something it would refuse.

**The row is the session's model, not the running one.** `EffortSection` takes `model` and `models`
props and resolves its row via `effortRowFor(models, model)` (`publishedRowFor` before #1168) — the same
exact-equality-on-`value` rule `ModelSection` marks a row selected by. `RunningModelSection` joins a
**different string** through the unwrapped `publishedRowFor`: `announced.model` (what claude announced
for the running turn), never the session's `model`. Conflating the two inputs is the mistake the two
names are meant to make visible.

**Since #1168, an empty `model` — the wire's inherited daemon default, not an absence — resolves onto
the row the daemon publishes for that default (`value: 'default'`) instead of matching nothing.**
`effortRowFor` is `publishedRowFor` with only that lookup argument substituted; every other model, and
every other `publishedRowFor` caller (`RunningModelSection`, `ModelSection`, both composer menus except
the effort one), is unmoved. See [Composer effort
menu](composer-effort-menu.md#composereffortmenumodel-one-pure-function-deciding-all-three-renderings)
for the shared wrapper both effort surfaces now call.

**Four inputs, three renderings** — the section's own `nothingKnown` guard is the one place this table
is written down in code:

| matched row | `effort_levels` | cut reported | renders |
|---|---|---|---|
| none (no list yet, or `model` matches no published row) | — | — | the session's current `effort` value, as plain text |
| yes | non-empty | either | one segment per level, in published order |
| yes | `[]` | no | `RUN_CONFIG_EFFORT_EMPTY_COPY`, "No effort levels offered" |
| yes | `[]` | yes | the current-effort text — **not** the offers-none copy |

The first and fourth rows render identically and that collapse is deliberate — the opposite posture to
`ModelSection` directly above, which keeps "no frame has arrived" and "claude published an empty list"
as different elements with different copy because it is arguing about a different field
(`models: []` there is a *positive statement*). Here, no-list-yet and no-matching-row mean the
identical thing to the client: it has not been told any level is accepted, so it offers none and
states what the session is actually running instead of guessing. **The fourth row is a written
contract MUST, not an invented distinction**: `effort_levels` collapses absent/`null`/empty into one
`[]` (see [Model-list wire types](model-list-wire-types.md)), so a `truncated_fields` naming
`effort_levels` is the *only* signal separating "cut to nothing, or shortened" from "this model exposes
no effort control" — read as *none*, a cut list would silently remove a control the model actually
supports. `modelListStore`'s header named this ticket as the reader that owed that distinction.

**No fallback, ever.** An absent, `null` or unmatched `models` never means "offer all five" — that is
the single failure the four-input table exists to forbid, and it would have re-minted the vocabulary
this ticket deletes in the one place it is being deleted from.

**The cut marker is a sibling, in every reading.** Whenever the matched row's `truncated_fields`
includes `'effort_levels'` (`Array.prototype.includes`, a linear scan by `===` against a client-owned
literal — not an index lookup, so no object is ever keyed by daemon text here), the section renders
the sheet's shared `RUN_CONFIG_CUT_COPY` ("Truncated by the daemon") in its own sibling `<p>` — so a
shortened non-empty list is not presented as complete, and an empty-because-cut one says why it is
offering nothing.

**Selection, keys and the round trip are unchanged in kind.** A segment is marked by exact equality
against the session's `effort` value — no substring, prefix, case fold or trim; `high` is a substring
of `xhigh` and a row can publish both, which is why the guard is exact equality and nothing looser.
Pressing a segment submits the published level **verbatim**, never repaired, so the optimistic overlay
holds the same string the next render compares against — the existing pending/rejection/rollback
behaviour of the effort field (`aria-busy` on `.run-config__effort` in **all three** readings, the
`RunConfigError` line staying a sibling of the busy wrapper, never a descendant) is untouched. The
React `key` is the array index, not the level string, for the Model section's reason unchanged: a key
is a lookup path, these are claude-authored strings, and a row may legitimately publish a repeated
level.

**Untrusted text, same boundary as the Model section.** Every string in `effort_levels` is
claude-authored text that crossed the subprocess trust boundary, bounded by the daemon and not
sanitized by it. Each level reaches exactly one JSX text position, escaped by React's default; none
reaches an attribute, a URL, a filename, a cache key, a lookup path, or a log. **This ticket also
changes what the client *sends*:** `set_session_settings.effort` stops carrying a client-owned constant
and starts carrying a claude-authored string echoed back verbatim — the Model section's shipped
posture applied to a second field. No client-side allowlist is added, deliberately: it would put a
second copy of the vocabulary in the very place this ticket deletes one from. The daemon's inbound
`validEffort` is a **closed** enum at the five measured levels while `validModel` was widened for these
rows, so a level claude adds later, or one cut mid-token, is published and then **refused** on the way
back — an asymmetry that is upstream's, surfaced honestly through the existing `RunConfigError`
rejection line and the store's automatic rollback, never repaired or allow-listed client-side.

CSS: `.run-config__effort` gained `flex-wrap: wrap` (a published level list is unbounded daemon text
of unknown count, unlike the five short static words it used to hold, so it wraps inside the 400px
sheet instead of overflowing it); `.run-config__effort-segment` gained `min-width: 0` and
`overflow-wrap: anywhere` for the same reason. Three new classes —
`.run-config__effort-current` (the current-effort line), `.run-config__effort-empty` (the offers-none
copy) and `.run-config__effort-cut` (the cut marker) — join the shipped muted body-small group beside
`.run-config__model-unknown`; none takes `--color-error`, since none of the three is an error state.

The pre-#976 tests were written against the fixed five and correctly went red: one
(`'always renders all five level labels'`) stated the removed contract and was deleted outright rather
than repaired; the rest gained fixtures that publish real per-row levels (`PUBLISHED_ROWS` now carries
the measured five on one row, a shorter distinct set on another, and `[]` on the Haiku-shaped row) so
one fixture set serves all three readings. Two tests outside the ticket's own cascade went red for a
reason worth remembering: `'leaves a marked control fully operable'` and `'alters no existing
accessible name…'` drew their only `role="button"` and their only `aria-current` from the effort
segments, so once the section stopped rendering unconditionally, both started depending on which
fixture was passed — a class-name grep would not have found them, a `role="button"` grep would. See
`docs/specs/architecture/976-effort-segments-from-published-levels.md` for the full design and the
security review; the "no hardcoded label survives" assertion is written as a count rather than a list,
to avoid re-typing the deleted five levels into the file that proves they are gone.

## Log data section (#72)

The sheet's **first populated section** — the sole user-facing entry point for the client debug-bundle
download (the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) family, whose background
chain — request/reassemble/save/[orchestrator](debug-bundle-orchestrator.md) — was already merged and
inert for want of a UI driver). Mounted as `<LogDataSection/>`, the sheet body's last child (`<RunConfigSections/>`, #188, now
precedes it), last in document order ("beneath Context-window" per Figma node `20-100` subtree
`98:2`/`98:16`):

```
.status-sheet__body
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription)
    └── LogDataView                    (pure: props in, markup out)
        ├── .status-sheet__section-header   "Log data" (reused across future sections)
        └── .log-data
            ├── button.log-data__download   full-width filled-tonal pill, "Download"/"Downloading…"
            └── p.log-data__status[role=status]   count / saved path / mapped error (only when non-null)
```

The download state (`idle` / `downloading{chunks}` / `saved{path}` / `failed{reason}`) is a small,
**pure, total, phase-agnostic** reducer (`logDataDownload.ts`, the `composerSend.ts`/`pairingState.ts`
idiom) driven by `useReducer` per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
— never the session store, since [`translateDaemonEvent`](daemon-event-bridge.md) already returns
`null` for all three `debugBundle*` events. The container's single `onDaemonEvent` subscription filters
those three events via `toDownloadAction` (the `translateDaemonEvent` analogue) and is torn down on
unmount, so a sheet close/reopen nets exactly one live listener. Pressing Download sends the bare
`requestDebugBundle` command and **optimistically** dispatches `requested` (not gated on the first
daemon event — the `unavailable` failure path emits no progress at all). Single-in-flight is
belt-and-suspenders: the button disables while busy and `onDownload` re-checks the phase, with the
deterministic backstop being the [#169 orchestrator](debug-bundle-orchestrator.md)'s own `active`
flag, not a second authoritative guard here. Failure text is drawn from a closed `reason → sentence`
map — never the raw `DebugBundleFailure` token, an errno, or a stack (AC5).

Two more M3 tokens landed for the button: `--color-secondary-container` / `--color-on-secondary-container`
(filled-tonal fill/text). See [#72 codebase notes](../codebase/72.md) for the full design, patterns,
and the one copy-only deviation from spec.
