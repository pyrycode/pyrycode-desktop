import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'

// The Run configuration sheet's three read-only sections (#188, Figma node 20-100 subtree
// 20:109/20:128/20:141) — Model, Effort, YOLO — reflecting the session's current snapshot held by
// #187's runConfigStore. The container/pure-view split mirrors LogDataSection: RunConfigView is
// props-in/markup-out (no store read, no window.pyry → server-renderable with no mock), and
// RunConfigSections is thin glue that reads one narrow store slice and coalesces null → default.
//
// Read-only: the sections display current state; the interactive change path (pickers / a live
// toggle writing back) is #183. Each sub-section takes its own value prop, so #183 makes it
// interactive by adding an onChange per sub-section — no restructuring.

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

/**
 * The pure section view — renders all four sections (headers + bodies) from primitive props. No
 * store read, no window.pyry, so it server-renders under renderToStaticMarkup with no mock. The
 * Context window section is the last child so it sits between YOLO and the sibling Log-data section
 * (AC1).
 */
export function RunConfigView({
  model,
  effort,
  yolo,
  usedTokens,
  windowTokens
}: {
  model: string
  effort: string
  yolo: boolean
  usedTokens: number
  windowTokens: number
}): JSX.Element {
  return (
    <>
      <ModelSection model={model} />
      <EffortSection effort={effort} />
      <YoloSection yolo={yolo} />
      <ContextWindowSection usedTokens={usedTokens} windowTokens={windowTokens} />
    </>
  )
}

function ModelSection({ model }: { model: string }): JSX.Element {
  const selected = matchedFamily(model)
  return (
    <>
      <p className="status-sheet__section-header">Model</p>
      <div className="run-config__model-list">
        {MODEL_CATALOG.map((entry) => {
          const isSelected = entry.family === selected
          return (
            <div className="run-config__model-row" key={entry.family}>
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
    </>
  )
}

function EffortSection({ effort }: { effort: string }): JSX.Element {
  return (
    <>
      <p className="status-sheet__section-header">Effort</p>
      <div className="run-config__effort">
        {EFFORT_LEVELS.map((level) => {
          const isSelected = level === effort
          // aria-current is both the a11y marker and the CSS selection hook (no modifier class); the
          // fill/outline styles key off `[aria-current='true']`.
          return (
            <span
              className="run-config__effort-segment"
              key={level}
              aria-current={isSelected ? 'true' : undefined}
            >
              {level}
            </span>
          )
        })}
      </div>
    </>
  )
}

function YoloSection({ yolo }: { yolo: boolean }): JSX.Element {
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
        {/* role="switch" + aria-checked reflects state honestly; aria-readonly says it takes no
            input (#183 makes it live by dropping aria-readonly and adding an onClick). */}
        <span
          className={yolo ? 'run-config__switch run-config__switch--on' : 'run-config__switch'}
          role="switch"
          aria-checked={yolo}
          aria-readonly="true"
          aria-label="Auto-accept tool calls"
        >
          <span className="run-config__switch-knob" aria-hidden="true" />
        </span>
      </div>
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
 * The container: reads the held snapshot once and coalesces null → the default, so AC4's two cases
 * (null first-render and a real snapshot) are literally the same code path. The default's
 * `windowTokens: 0` also folds the not-yet-loaded state into the Context window section's "usage
 * unavailable" branch (AC5). Selecting one narrow slice re-renders the view on each new snapshot
 * (AC5) and never on unrelated state; no setter is ever called → read-only, no two-way binding.
 */
export function RunConfigSections(): JSX.Element {
  const snapshot = useRunConfigStore(selectSnapshot)
  const { model, effort, yolo, usedTokens, windowTokens } =
    snapshot ?? { model: '', effort: '', yolo: false, usedTokens: 0, windowTokens: 0 }
  return (
    <RunConfigView
      model={model}
      effort={effort}
      yolo={yolo}
      usedTokens={usedTokens}
      windowTokens={windowTokens}
    />
  )
}
