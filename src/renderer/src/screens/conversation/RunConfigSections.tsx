import { useMemo } from 'react'
import type { WireModelOption } from '@shared/wire/types'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import {
  useModelListStore,
  selectModelListFor,
  type ModelListEntry
} from '../../store/modelListStore'
import {
  useAnnouncedModelStore,
  selectAnnouncedModel,
  type AnnouncedModel
} from '../../store/announcedModelStore'
import {
  useRunSettingsWriteStore,
  selectEffectiveSettings,
  selectError,
  selectPendingFields,
  type SettingsChange
} from '../../store/runSettingsWriteStore'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'
import { contextUsagePercent } from './contextUsage'

// The Run configuration sheet's Model / Effort / YOLO sections (Figma node 20-100 subtree
// 20:111/20:130/20:143). #188 rendered them read-only; #257 makes them INTERACTIVE — selecting a
// model, picking an effort, or toggling YOLO submits the change for the current session. The
// container/pure-view split mirrors LogDataSection: RunConfigView is props-in/markup-out (no store
// read, no window.pyry → server-renderable with no mock), and RunConfigSections is thin glue.
//
// This slice owns NONE of the optimistic/confirm/reject/rollback logic — that is #256's
// runSettingsWriteStore. The displayed value is #256's composed selectEffectiveSettings (pending
// overlay > client-confirmed override > snapshot base); a control just submits an intent via
// changeSetting and renders the store's composed result. Operability keys off HANDLER PRESENCE: a
// section given a handler is operable, a section given none renders exactly #188's inert markup — which
// is the whole AC5 gate at the view layer, since the container withholds the handler until a session id
// exists (sessionIdStore, #259).

// #975 — the RUNNING model's lookup, re-anchored on the daemon-published rows now that MODEL_CATALOG
// is gone. String equality only: no toLowerCase, no includes, no startsWith, no trim, no regex.
//
// The key is `value` and nothing else. It is the field the deleted catalog lookup already compared —
// `entry.family` was the token a row submitted, and `value` is the argument a row submits now — so the
// rewrite moves the lookup onto real published data without changing what it compares.
// `resolved_model` is deliberately NOT the key: the wire contract excludes it, and joining on it would
// give the exactness guard an exception, since a row's own resolved_model is routinely a superstring
// of its own `value` ('haiku' → 'claude-haiku-4-5-20251001'). That field is DISPLAYED on each row's
// second line instead, which is where an alias's current resolution reaches the operator.
//
// A MISS IS ORDINARY, NOT AN ERROR, and stays the common case: claude echoes an identifier at least as
// specific as the one it was given, so an announced identifier need not appear in any published row.
// The verbatim fallback is the correct outcome then — the operator sees the true running identifier
// rather than a display name inferred from a resemblance. Widening this into a substring match to make
// it fire more often would reintroduce exactly what #560 exists to stop.
function runningPublishedRow(
  models: ModelListEntry | null | undefined,
  model: string
): WireModelOption | undefined {
  return models?.models.find((row) => row.value === model)
}

// #975 — the Model section's two non-populated readings, which the store deliberately keeps apart and
// this section must not collapse. They read as DIFFERENT SENTENCES, not one sentence in two places
// (the BackgroundTaskPanel convention): the first is the not-yet-known reading in the sheet's existing
// vocabulary, the second a positive statement that claude offered nothing. Client-owned and
// apostrophe-free — renderToStaticMarkup escapes ' → &#x27;. Neither may contain 'Current model': the
// selection marker is asserted by COUNT at several unit sites and page-wide in e2e.
const RUN_CONFIG_MODELS_UNKNOWN_COPY = 'Model list not yet known'
const RUN_CONFIG_MODELS_EMPTY_COPY = 'No models offered'

/** #975 — the frame-level truncation report, distinct from a row's own. `models.length +
 *  droppedModels` is the list's true size; this notice states the missing half rather than the sum,
 *  the shipped `partialListCopy` shape (BackgroundTaskPanel), which also dodges pluralisation — "1 not
 *  shown" and "3 not shown" both read correctly, so the repo gains no pluralisation machinery.
 *
 *  `droppedModels` is a number, so this renders no untrusted string. */
function partialModelListCopy(droppedModels: number): string {
  return `Partial list (${droppedModels} not shown)`
}

// #560 — client-owned copy for the running-model surface, the RUN_CONFIG_ERROR_COPY convention.
// Apostrophe-free (renderToStaticMarkup escapes ' → &#x27;).
//
// Neither literal may contain 'Current model': the sheet's selection marker is asserted by COUNT at six
// unit sites and page-wide in e2e, and this copy renders in EVERY existing RunConfigView test (the prop
// is optional and its absence is the not-yet-known state).
const RUN_CONFIG_RUNNING_UNKNOWN_COPY = 'Running model not yet known'

// Deliberately echoes BACKGROUND_TASK_PANEL_CUT_COPY / UNRECOGNIZED_TRUNCATED_COPY's vocabulary so the
// app says the same thing the same way about the same daemon behaviour. #975 reuses this one sentence
// for the published rows' own cut report rather than minting a second: the sentence is identical and
// only the ATTRIBUTION differs, which position and the distinct classes already carry.
const RUN_CONFIG_CUT_COPY = 'Truncated by the daemon'

// The fixed accepted set (Figma 20:130); effort matches by exact equality, so '' / unknown marks
// none — AC4's default.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// AC4 error copy — field-scoped and client-owned. #269 strips the daemon message, so the surfaced copy
// is derived from the rejected FIELD, not daemon text. Apostrophe-free by design: renderToStaticMarkup
// escapes ' → &#x27; (the #188/#279 lesson), so keeping the strings clean keeps them readable. This map
// is the single source of the copy; each section reads its own key. The em-dash is not escaped.
const RUN_CONFIG_ERROR_COPY: Record<SettingsChange['field'], string> = {
  model: 'Could not change the model — try again.',
  effort: 'Could not change the effort — try again.',
  yolo: 'Could not change auto-accept — try again.'
}

// One field's rejection line — a role="alert" live region so a screen reader announces the failure on
// arrival, styled with the --color-error accent (the only error role token; no new theme token, per
// CLAUDE.md). Rollback itself is automatic in #256 (the pending marker is deleted, so the effective
// value stops showing the requested value); this line is only the visible surface (AC4).
function RunConfigError({ field }: { field: SettingsChange['field'] }): JSX.Element {
  return (
    <p className="run-config__error" role="alert">
      {RUN_CONFIG_ERROR_COPY[field]}
    </p>
  )
}

/**
 * The pure section view — renders all four sections (headers + bodies) from primitive props. No
 * store read, no window.pyry, so it server-renders under renderToStaticMarkup with no mock. The
 * Context window section is the last child so it sits between YOLO and the sibling Log-data section.
 *
 * `onChange` present ⇒ the Model/Effort/YOLO controls are operable and each submits a single-field
 * SettingsChange; absent ⇒ #188's read-only markup (the AC5 gate at the view layer). The three narrow
 * per-control callbacks are derived from the single `onChange` here, so the SettingsChange construction
 * lives in exactly one place. `errorField` is the last-rejected field (or null) — it flags at most one
 * section's error line (AC4).
 *
 * `pending` (#558) marks the controls of a change the daemon has not confirmed yet, so an optimistic
 * value stops rendering identically to a settled one. It is #256's selectPendingFields verbatim — typed
 * as that selector's return type so a parallel pending representation is a compile error, not a review
 * catch. NOT shaped like `errorField`: the store's `pending` is keyed by changeId so two fields can be
 * outstanding at once, and these three booleans are independent. Omitted ⇒ nothing is marked (AC5).
 *
 * `models` (#975) is the conversation's published model list — #974's HELD ENTRY, passed straight down
 * and never a derived array, which is what keeps the store's by-reference guarantees intact at the
 * render boundary. Optional, and its absence IS the `null` reading ("no frame has arrived"), the
 * `announced` prop's shape: that is what keeps this view server-renderable with no store and no mock.
 */
export function RunConfigView({
  model,
  effort,
  yolo,
  usedTokens,
  windowTokens,
  onChange,
  errorField,
  pending,
  announced,
  models
}: {
  model: string
  effort: string
  yolo: boolean
  usedTokens: number
  windowTokens: number
  onChange?: (change: SettingsChange) => void
  errorField?: SettingsChange['field'] | null
  pending?: ReturnType<typeof selectPendingFields>
  announced?: AnnouncedModel | null
  models?: ModelListEntry | null
}): JSX.Element {
  // #975: the submitted string is a published row's `value` VERBATIM — never normalised on the way out,
  // which is the half of the round-trip this line owns.
  const onModel = onChange ? (value: string): void => onChange({ field: 'model', value }) : undefined
  const onEffort = onChange ? (level: string): void => onChange({ field: 'effort', value: level }) : undefined
  const onYolo = onChange ? (next: boolean): void => onChange({ field: 'yolo', value: next }) : undefined
  // The marking is independent of operability: the view marks whatever it is told. In production the
  // combination cannot arise (the container withholds onChange until a session id exists, and without
  // one nothing can be dispatched, so `pending` is empty), so gating one on the other would be logic
  // for an unreachable state.
  return (
    <>
      {/* #560: what is running, then what you can switch to. Placed BEFORE the rows deliberately —
          reading order first, and it keeps the surface out of the last model row's open-ended
          segmentFor chunk in the tests. */}
      <RunningModelSection announced={announced} models={models} />
      <ModelSection
        model={model}
        models={models}
        onSelect={onModel}
        error={errorField === 'model'}
        busy={pending?.model}
      />
      <EffortSection
        effort={effort}
        onSelect={onEffort}
        error={errorField === 'effort'}
        busy={pending?.effort}
      />
      <YoloSection yolo={yolo} onToggle={onYolo} error={errorField === 'yolo'} busy={pending?.yolo} />
      <ContextWindowSection usedTokens={usedTokens} windowTokens={windowTokens} />
    </>
  )
}

// #560 — the running-model surface: what claude ANNOUNCED for the running turn (#587 decodes it off the
// `system` / `init` line, #588 holds it), as opposed to the daemon's persisted OVERRIDE the Model rows
// below display. On a daemon where nothing was overridden the override is '' and no row is marked, which
// is honest but indistinguishable from broken; this section answers the question the operator is
// actually asking. Header + column body, cloning the Context window idiom (Figma 20:149 / 20:151); the
// design draws no running-model surface and no not-yet-known state.
//
// SECURITY — this is the render boundary for `announced.model`. It is untrusted, model-influenced text
// that crossed the subprocess trust boundary; the daemon bounds it at 256 bytes but sanitizes nothing
// (announcedModelStore.ts:46-51), and #588 had no DOM sink so it inherited the obligation. It reaches
// exactly ONE JSX text position, where React escapes it. It is never dangerouslySetInnerHTML, never an
// attribute value, never a URL, and it selects nothing beyond which catalog display name is shown —
// nothing this app sends is derived from it, and this surface dispatches nothing at all.
//
// Three branches, and two of them are easy to get wrong:
//
//  - The MARKER branches on `truncated` ALONE, never on which path the value took. The flag is the
//    daemon's report about the identifier it delivered; suppressing it on the resolve path would let a
//    daemon hide its own cut report by sending a value that happens to equal a catalog token. The
//    hit+truncated combination is only reachable from a non-conforming daemon, and renders both readings
//    honestly rather than silently dropping one.
//  - `{ model: '', truncated: false }` takes the VERBATIM path: a real announcement the daemon emitted
//    (announcedModelStore.ts:58-65), so the value element renders present and empty rather than
//    collapsing into the not-yet-known sentinel — collapsing would erase the store's deliberate
//    null-vs-'' distinction one layer above where it was established.
//
// The cut marker is a SIBLING ELEMENT holding a client-owned constant, never text concatenated into the
// value (the BackgroundTaskPanel.tsx:236-255 / ConversationScreen.tsx:485-500 idiom):
// `{announced.model}{truncated && ' (truncated)'}` would fuse client copy and daemon text into one node,
// so an identifier ending in those same words would be indistinguishable from the sheet's own claim.
// Nothing here slices, measures, re-joins or re-sinks the identifier to produce the marker.
function RunningModelSection({
  announced,
  models
}: {
  announced?: AnnouncedModel | null
  models?: ModelListEntry | null
}): JSX.Element {
  const row = announced ? runningPublishedRow(models, announced.model) : undefined
  return (
    <>
      <p className="status-sheet__section-header">Running model</p>
      <div className="run-config__running">
        {announced ? (
          // #975: BOTH paths are now daemon-authored — the hit renders a published row's display name,
          // the miss the announced identifier verbatim. The provenance claim that used to stand here
          // (a client-owned name on one path) stopped being true when the rows stopped being the
          // client's. Both are still safe as escaped inert text in this one JSX text position, which is
          // the obligation that actually matters; what changed is only who wrote the string.
          <p className="run-config__running-value">{row ? row.display_name : announced.model}</p>
        ) : (
          <p className="run-config__running-unknown">{RUN_CONFIG_RUNNING_UNKNOWN_COPY}</p>
        )}
        {announced?.truncated ? <p className="run-config__running-cut">{RUN_CONFIG_CUT_COPY}</p> : null}
      </div>
    </>
  )
}

// #558 — the in-flight marker. aria-busy goes on the element that OWNS the field's controls (the group
// here, since the field has three of them), which is both the a11y marker and the CSS hook — the
// aria-current idiom below, and likewise OMITTED rather than rendered "false" so nothing-in-flight is
// byte-identical to #188's markup. Load-bearing: the RunConfigError <p> must stay a SIBLING of this
// wrapper, never a descendant — aria-busy on an ancestor tells assistive technology to withhold the
// subtree's announcements, which would silently suppress #269's role="alert" rejection line on the very
// field the operator was told is in flight.
//
// #975 — THE ROWS ARE THE DAEMON'S. The section renders one row per published entry, in the daemon's
// order, and derives nothing: no family is parsed out of a `value` (it is not parseable — the measured
// entries are `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`), no descriptor is
// written here, and no row is invented, reordered, deduped or dropped.
//
// THREE READINGS, NEVER TWO. `null` (no frame has arrived, a normal and permanent state under
// best-effort delivery) and a present entry holding `models: []` (claude published an empty list) are
// different sentences in different elements. Collapsing them would erase the distinction one layer
// above where the store deliberately established it, and neither renders an empty control or a stale
// menu.
//
// SECURITY — this is the render boundary for `display_name`, `value` and `resolved_model`. They are
// claude-authored, unsanitized text that crossed the subprocess trust boundary (the daemon bounds and
// does not sanitize; #972 made the SHAPE trusted and nothing more). Each reaches exactly one JSX text
// position, where React escapes it. None reaches a raw-markup sink, an attribute, a URL, a filename, a
// cache key, a lookup path or a log — and nothing on this path is logged at all.
//
// THE KEY IS THE ARRAY INDEX, and that is a security decision rather than a style one: a key is a
// lookup path, and `display_name` / `value` are exactly the claude-authored strings the store's header
// forbids using as one. There is also nothing for a stable key to preserve — each frame REPLACES the
// conversation's list wholesale, rows never reorder within a render, and claude may legitimately
// publish two rows sharing a `value`.
function ModelSection({
  model,
  models,
  onSelect,
  error,
  busy
}: {
  model: string
  models?: ModelListEntry | null
  onSelect?: (value: string) => void
  error?: boolean
  busy?: boolean
}): JSX.Element {
  const entry = models ?? null
  return (
    <>
      <p className="status-sheet__section-header">Model</p>
      {/* The frame-level truncation report, and a SIBLING of the branch below rather than a child of
          any arm: the count belongs to the ENTRY, not to the list, so an entry reporting drops beside
          zero carried rows must still show it. It is a strictly different report from a row's own
          `truncated_fields` and neither may be collapsed into the other — a sheet surfacing one and
          silently dropping the other presents a cut list as complete.

          A boolean comparison, never `{entry.droppedModels && …}`: React renders the number `0` as a
          text node, so the truthiness form would print a bare `0` into the sheet on every complete
          list. `0` is a value here, never consulted for truthiness. `> 0` rather than `!== 0` so a
          nonsense negative count degrades to "no notice" rather than to a notice claiming -1. */}
      {entry !== null && entry.droppedModels > 0 && (
        <p className="run-config__model-partial">{partialModelListCopy(entry.droppedModels)}</p>
      )}
      <div className="run-config__model-list" aria-busy={busy ? 'true' : undefined}>
        {entry === null ? (
          <p className="run-config__model-unknown">{RUN_CONFIG_MODELS_UNKNOWN_COPY}</p>
        ) : entry.models.length === 0 ? (
          <p className="run-config__model-empty">{RUN_CONFIG_MODELS_EMPTY_COPY}</p>
        ) : (
          entry.models.map((row, index) => {
            // EXACT EQUALITY, and the whole of the selection rule: no substring, no prefix, no case
            // fold, no trim, anywhere on this path. It is also the half of the round-trip this line
            // owns — the row submits its `value` verbatim, the optimistic overlay holds that same
            // string, and this comparison re-selects the row it came from. The moment either side
            // normalises, the two stop being the same string.
            const isSelected = row.value === model
            // The daemon's report that it cut this row's own text. `null` and `[]` say the identical
            // thing per the wire contract, so the test is on length rather than on presence.
            const isCut = (row.truncated_fields?.length ?? 0) > 0
            // onSelect present ⇒ the row is an operable button submitting its published `value`.
            // Absent ⇒ #188's inert row (no role/tabindex/handler). Click is the baseline affordance;
            // keyboard activation (Enter/Space) is a deliberate non-goal here.
            return (
              <div
                className="run-config__model-row"
                key={index}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(row.value) : undefined}
              >
                {isSelected ? (
                  // The filled M3 radio. Its accessible name lets a screen reader announce which model
                  // is active; the empty siblings are decorative (aria-hidden).
                  <span
                    className="run-config__radio run-config__radio--selected"
                    role="img"
                    aria-label="Current model"
                  />
                ) : (
                  <span className="run-config__radio" aria-hidden="true" />
                )}
                <div className="run-config__model-text">
                  <p className="run-config__model-name">{row.display_name}</p>
                  {/* The concrete identifier this row's `value` resolves to right now, so the operator
                      can see what an alias means BEFORE the first turn rather than inferring it from an
                      announcement after it. Rendered unconditionally: an empty one is a present, empty
                      line, inventing no distinction the wire does not carry. It is not reliably
                      populated — a row may carry the literal `<unmeasured>`, which renders escaped and
                      verbatim, because it is what the daemon said. */}
                  <p className="run-config__model-descriptor">{row.resolved_model}</p>
                  {/* The cut marker is a SIBLING ELEMENT holding a client-owned constant, never text
                      concatenated into a daemon-authored node: `{row.display_name}{isCut && ' (cut)'}`
                      would fuse the two into one node, and a label ending in those same words would
                      then be indistinguishable from the sheet's own claim. */}
                  {isCut ? <p className="run-config__model-cut">{RUN_CONFIG_CUT_COPY}</p> : null}
                </div>
              </div>
            )
          })
        )}
      </div>
      {error ? <RunConfigError field="model" /> : null}
    </>
  )
}

function EffortSection({
  effort,
  onSelect,
  error,
  busy
}: {
  effort: string
  onSelect?: (level: string) => void
  error?: boolean
  busy?: boolean
}): JSX.Element {
  return (
    <>
      <p className="status-sheet__section-header">Effort</p>
      {/* #558: the group, not a segment — the field's five controls are one field. */}
      <div className="run-config__effort" aria-busy={busy ? 'true' : undefined}>
        {EFFORT_LEVELS.map((level) => {
          const isSelected = level === effort
          // aria-current is both the a11y marker and the CSS selection hook (no modifier class); the
          // fill/outline styles key off `[aria-current='true']`. onSelect present ⇒ the segment is an
          // operable button submitting its exact level (exact-match round-trip); absent ⇒ #188's inert
          // segment.
          return (
            <span
              className="run-config__effort-segment"
              key={level}
              aria-current={isSelected ? 'true' : undefined}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? () => onSelect(level) : undefined}
            >
              {level}
            </span>
          )
        })}
      </div>
      {error ? <RunConfigError field="effort" /> : null}
    </>
  )
}

function YoloSection({
  yolo,
  onToggle,
  error,
  busy
}: {
  yolo: boolean
  onToggle?: (next: boolean) => void
  error?: boolean
  busy?: boolean
}): JSX.Element {
  return (
    <>
      <p className="status-sheet__section-header">YOLO mode</p>
      <div className="run-config__yolo">
        <div className="run-config__yolo-text">
          <p className="run-config__yolo-title">Auto-accept tool calls</p>
          <p className="run-config__yolo-caption">
            Claude runs commands without asking for confirmation. Use carefully.
          </p>
        </div>
        {/* role="switch" + aria-checked reflects state honestly. onToggle present ⇒ #257 makes it live:
            drop aria-readonly, become focusable, and toggle the current value on click (AC3). Absent ⇒
            #188's read-only switch (aria-readonly, no handler). #558's aria-busy goes on the switch
            ITSELF — unlike Model/Effort the field has exactly one control and it IS the switch, while
            .run-config__yolo also wraps the title/caption. It marks without disabling: LogDataSection
            pairs aria-busy with `disabled`, but taking that half would contradict the store's deliberate
            last-write-wins for rapid same-field changes. It contributes nothing to the accessible name,
            so the aria-label/aria-checked/aria-readonly the e2e specs assert on are untouched. */}
        <span
          className={yolo ? 'run-config__switch run-config__switch--on' : 'run-config__switch'}
          role="switch"
          aria-checked={yolo}
          aria-readonly={onToggle ? undefined : 'true'}
          aria-label="Auto-accept tool calls"
          aria-busy={busy ? 'true' : undefined}
          tabIndex={onToggle ? 0 : undefined}
          onClick={onToggle ? () => onToggle(!yolo) : undefined}
        >
          <span className="run-config__switch-knob" aria-hidden="true" />
        </span>
      </div>
      {error ? <RunConfigError field="yolo" /> : null}
    </>
  )
}

// The token-abbreviation helper (Figma "146K" / "200K"): 1000+ collapses to a K-suffixed thousands
// count; under 1000 stays a raw count (an early-session "500"). Unexported — covered through the
// section's render assertions, so the public surface stays unchanged.
function abbreviateTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

// Context window (Figma 20:149 header + 20:151 body): the session's context-window usage gauge. The
// header and the explainer always render; the usage line + fill bar render only when a real window
// size is known.
//
// #811 EXTRACTED the guard and the arithmetic into contextUsagePercent — the composer footer's reading
// is a second surface for the same number, and a second clamp beside this one is a drift waiting to
// happen. `pct !== null` is the single load-bearing branch, exactly as `windowTokens > 0` was: it
// collapses the daemon's "usage unavailable" signal (window_tokens === 0, a foreground session or no
// transcript yet), the not-yet-loaded default (the container coalesces null → windowTokens: 0) and a
// stray negative into one path, and the division only runs inside it — so there is no NaN, no Infinity,
// no divide-by-zero (AC5). #811 also added a finiteness term, which closes this gauge's `width: NaN%`
// on a daemon frame carrying an overflowing token count. The percentage is still clamped to [0, 100] so
// an over-full session reads "100% used" and the fill never overflows its track. See contextUsage.ts.
function ContextWindowSection({
  usedTokens,
  windowTokens
}: {
  usedTokens: number
  windowTokens: number
}): JSX.Element {
  const pct = contextUsagePercent(usedTokens, windowTokens)
  return (
    <>
      <p className="status-sheet__section-header">Context window</p>
      <div className="run-config__context">
        {pct !== null ? (
          <>
            <p className="run-config__context-usage">
              {`${pct}% used (${abbreviateTokens(usedTokens)} of ${abbreviateTokens(windowTokens)} tokens)`}
            </p>
            {/* role="progressbar" + the aria-value* triple names the gauge honestly for a screen
                reader; the inline width is the only per-render style (Figma 20:153/20:154). */}
            <div
              className="run-config__context-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Context window usage"
            >
              <div className="run-config__context-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="run-config__context-unavailable">Context usage unavailable</p>
        )}
        <p className="run-config__context-explainer">
          When full, oldest messages get dropped from claude&apos;s view (delimiter still shows; old
          messages stay in your scroll).
        </p>
      </div>
    </>
  )
}

/**
 * The container: reads three read-only slices — the session id (#259), the daemon snapshot (#187), and
 * the write state (#256) — and wires the controls at interaction time. The displayed Model/Effort/YOLO
 * is #256's composed selectEffectiveSettings (optimistic pending overlay > client-confirmed override >
 * snapshot base); usedTokens/windowTokens still come straight from the snapshot (coalesced null → 0)
 * exactly as #188. Unidirectional: it dispatches only via submitSettingsChange and sends one command per
 * interaction; no setter is ever called during render.
 *
 * The AC5 gate is structural: `onChange` is built ONLY when a session id is known, so under SSR (session
 * id null) the controls render inert and the window.pyry.sendCommand closure is never constructed — the
 * container server-renders with no bridge mock (the LogDataSection / composer discipline).
 *
 * #975 adds `conversationId` as a PROP rather than a fifth store read, the settled house idiom
 * (`ComposerSlot`, `BackgroundTaskPanel`, both fed from `activeConversation` one scope up). It is NOT
 * the session id already in scope: those are different identifiers, a session id keys nothing in the
 * model-list map, and reaching for it would compile clean, typecheck clean and render the
 * not-yet-known line forever.
 */
export function RunConfigSections({ conversationId }: { conversationId: string | null }): JSX.Element {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // Select the RAW write state (stable identity between dispatches). Not selectEffectiveSettings as the
  // zustand selector: it returns a fresh object every call, which would defeat Object.is and re-render on
  // every store tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)
  // #560: a fourth narrow-slice read, passed straight down — no derivation here, no setter. A repeat
  // announcement produces a fresh object identity (announcedModelStore.ts:88-95) and so re-renders this
  // section with identical output; that is anticipated by the store and needs no memoisation.
  const announced = useAnnouncedModelStore(selectAnnouncedModel)
  // #975: a useMemo-stable selector per id (the ComposerSlashCommandTypeAhead / BackgroundTaskPanel
  // idiom) — a fresh closure each render would churn the subscription. A null conversation selects
  // nothing THROUGH THE SAME PATH, with no invented key and no second branch downstream, and `null` is
  // a stable reference. The selector hands back the HELD ENTRY ITSELF, so a list published for another
  // conversation leaves this one Object.is-identical and does not re-render the sheet.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)

  const effective = selectEffectiveSettings(snapshot, writeState)
  // #558: derived from the SAME writeState reference in the SAME render pass as `effective` — that is
  // what makes the displayed value and its marking incapable of disagreeing. A second
  // useRunSettingsWriteStore subscription for pending could tear them apart, showing an optimistic
  // value with no marker, which is exactly the state this ticket exists to prevent.
  const pending = selectPendingFields(writeState)
  const errorField = selectError(writeState)

  const onChange =
    // Both null and '' withhold the handler: null is "never observed", '' is the daemon saying it
    // has no session to address. See isAddressableSessionId (#491).
    isAddressableSessionId(sessionId)
      ? (change: SettingsChange): void =>
          changeSetting(
            { sessionId, sendCommand: window.pyry.sendCommand, dispatch: writeState.dispatch },
            change
          )
      : undefined

  return (
    <RunConfigView
      model={effective.model}
      effort={effective.effort}
      yolo={effective.yolo}
      usedTokens={snapshot?.usedTokens ?? 0}
      windowTokens={snapshot?.windowTokens ?? 0}
      onChange={onChange}
      errorField={errorField}
      pending={pending}
      announced={announced}
      models={models}
    />
  )
}
