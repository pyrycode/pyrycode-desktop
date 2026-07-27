import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import {
  useRunSettingsWriteStore,
  selectEffectiveSettings,
  selectError,
  type SettingsChange
} from '../../store/runSettingsWriteStore'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'

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

interface ModelCatalogEntry {
  /** The lowercase family token matched (case-insensitive substring) against the daemon's model. */
  family: string
  /** The display name and one-line descriptor — static design content (Figma 20:116/20:117 …). */
  name: string
  descriptor: string
}

// Static renderer content from the design (Figma 20:111): the snapshot supplies only the current
// `model` string, which selects at most one row. First match wins.
const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  { family: 'opus', name: 'Opus 4.7', descriptor: 'best for complex work' },
  { family: 'sonnet', name: 'Sonnet 4.6', descriptor: 'faster, cheaper' },
  { family: 'haiku', name: 'Haiku 4.5', descriptor: 'fastest' }
]

// The daemon's `model` is a `claude --model <value>` argument: it may arrive as a short alias
// ("opus") or a full id ("claude-opus-4-7"), and drifts across model versions. A case-insensitive
// family substring match highlights the right row for all those forms and degrades to no match for
// '' / unrecognized — exactly AC4's default (no row marked), not an error.
function matchedFamily(model: string): string | null {
  const lower = model.toLowerCase()
  return MODEL_CATALOG.find((entry) => lower.includes(entry.family))?.family ?? null
}

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
 */
export function RunConfigView({
  model,
  effort,
  yolo,
  usedTokens,
  windowTokens,
  onChange,
  errorField
}: {
  model: string
  effort: string
  yolo: boolean
  usedTokens: number
  windowTokens: number
  onChange?: (change: SettingsChange) => void
  errorField?: SettingsChange['field'] | null
}): JSX.Element {
  const onModel = onChange ? (family: string): void => onChange({ field: 'model', value: family }) : undefined
  const onEffort = onChange ? (level: string): void => onChange({ field: 'effort', value: level }) : undefined
  const onYolo = onChange ? (next: boolean): void => onChange({ field: 'yolo', value: next }) : undefined
  return (
    <>
      <ModelSection model={model} onSelect={onModel} error={errorField === 'model'} />
      <EffortSection effort={effort} onSelect={onEffort} error={errorField === 'effort'} />
      <YoloSection yolo={yolo} onToggle={onYolo} error={errorField === 'yolo'} />
      <ContextWindowSection usedTokens={usedTokens} windowTokens={windowTokens} />
    </>
  )
}

function ModelSection({
  model,
  onSelect,
  error
}: {
  model: string
  onSelect?: (family: string) => void
  error?: boolean
}): JSX.Element {
  const selected = matchedFamily(model)
  return (
    <>
      <p className="status-sheet__section-header">Model</p>
      <div className="run-config__model-list">
        {MODEL_CATALOG.map((entry) => {
          const isSelected = entry.family === selected
          // onSelect present ⇒ the row is an operable button that submits its family token
          // ('opus'/'sonnet'/'haiku'); it round-trips — matchedFamily re-selects the same row from the
          // optimistic overlay, and the token is a valid `claude --model` alias. Absent ⇒ #188's inert
          // row (no role/tabindex/handler). Click is the baseline affordance (spec); keyboard activation
          // (Enter/Space) is a deliberate non-goal here.
          return (
            <div
              className="run-config__model-row"
              key={entry.family}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? () => onSelect(entry.family) : undefined}
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
                <p className="run-config__model-name">{entry.name}</p>
                <p className="run-config__model-descriptor">{entry.descriptor}</p>
              </div>
            </div>
          )
        })}
      </div>
      {error ? <RunConfigError field="model" /> : null}
    </>
  )
}

function EffortSection({
  effort,
  onSelect,
  error
}: {
  effort: string
  onSelect?: (level: string) => void
  error?: boolean
}): JSX.Element {
  return (
    <>
      <p className="status-sheet__section-header">Effort</p>
      <div className="run-config__effort">
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
  error
}: {
  yolo: boolean
  onToggle?: (next: boolean) => void
  error?: boolean
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
            #188's read-only switch (aria-readonly, no handler). */}
        <span
          className={yolo ? 'run-config__switch run-config__switch--on' : 'run-config__switch'}
          role="switch"
          aria-checked={yolo}
          aria-readonly={onToggle ? undefined : 'true'}
          aria-label="Auto-accept tool calls"
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
// `windowTokens > 0` is the single load-bearing branch: it collapses the daemon's "usage unavailable"
// signal (window_tokens === 0, a foreground session or no transcript yet) and the not-yet-loaded
// default (the container coalesces null → windowTokens: 0) into one path — the division only runs
// inside it, so there is no NaN, no Infinity, no divide-by-zero (AC5). `<= 0` (via the `> 0` guard)
// also absorbs a stray negative. The percentage is clamped to [0, 100] so an over-full session reads
// "100% used" and the fill never overflows its track.
function ContextWindowSection({
  usedTokens,
  windowTokens
}: {
  usedTokens: number
  windowTokens: number
}): JSX.Element {
  const available = windowTokens > 0
  const pct = available
    ? Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))
    : 0
  return (
    <>
      <p className="status-sheet__section-header">Context window</p>
      <div className="run-config__context">
        {available ? (
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
 */
export function RunConfigSections(): JSX.Element {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // Select the RAW write state (stable identity between dispatches). Not selectEffectiveSettings as the
  // zustand selector: it returns a fresh object every call, which would defeat Object.is and re-render on
  // every store tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)

  const effective = selectEffectiveSettings(snapshot, writeState)
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
    />
  )
}
