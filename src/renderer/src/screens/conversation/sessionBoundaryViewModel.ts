// The pure view-model for the session-boundary delimiter (#286). Framework-free `.ts`, mirroring
// channelListViewModel.ts, so both derivations unit-test without React or the store. Deliberately a
// LONG-FORM sibling of `formatLastActivity` (which emits the short `2h ago`): the delimiter's locked
// Figma copy (node 16-36) is the long form `2 hours ago`, so reusing that helper verbatim would diverge
// from the design. Same structure (pure, injected `now`, `Date.parse`, graceful degrade); different labels.
import type { ThreadItem } from '../../store/threadTimeline'

/** The narrowed sessionBoundary item — the only ThreadItem member this view-model reads. */
type SessionBoundaryItem = Extract<ThreadItem, { kind: 'sessionBoundary' }>

const MS_MINUTE = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000
const MS_WEEK = 604_800_000

// UTC month lookup for the older-than-a-week fallback date, so the rendering is timezone-independent (a
// locale/TZ-dependent toLocaleDateString would make the test flaky across runners) — the channel-list idiom.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

/** Compile-time exhaustiveness guard: a future fourth reason without a case is a type error here. */
function assertNever(reason: never): never {
  throw new Error(`Unhandled session boundary reason: ${JSON.stringify(reason)}`)
}

/**
 * Long-form relative time from an RFC3339(Nano) `iso`, measured against an injected `now` (ms) so the
 * function stays pure and deterministic under test (never `Date.now()` inside). `Date.parse` accepts the
 * RFC3339Nano `occurred_at` (the sub-millisecond digits truncate cleanly). Untrusted daemon input degrades
 * silently: a non-parseable timestamp yields `''` (the title then renders its label with no time), and a
 * future timestamp (clock skew) clamps to `'just now'` rather than a negative delta. Labels are spelled out
 * (`2 hours ago`, not `2h ago`) and singular at one (`1 hour ago`) to match the Figma copy.
 */
export function formatSessionBoundaryTime(iso: string, now: number): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const delta = now - ms
  if (delta < MS_MINUTE) return 'just now'
  if (delta < MS_HOUR) {
    const n = Math.floor(delta / MS_MINUTE)
    return `${n} ${n === 1 ? 'minute' : 'minutes'} ago`
  }
  if (delta < MS_DAY) {
    const n = Math.floor(delta / MS_HOUR)
    return `${n} ${n === 1 ? 'hour' : 'hours'} ago`
  }
  if (delta < 2 * MS_DAY) return 'Yesterday'
  if (delta < MS_WEEK) return `${Math.floor(delta / MS_DAY)} days ago`
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/**
 * The reason-appropriate label for a boundary. An exhaustive switch on `reason` (assertNever default) — a
 * future wire reason breaks the build here (the no-drift guard). `workspace_change` names the new path
 * verbatim (untrusted, escaped at render); if `workspaceCwd` is `null` (a wire-contract violation — the
 * field is `string | null` unconditionally) it degrades to the pathless label, never the literal `null`.
 * `clear` / `idle_evict` copy is PROVISIONAL (Figma node 16-35 draws only the workspace_change variant).
 * All labels are apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, complicating assertions).
 */
function labelFor(item: SessionBoundaryItem): string {
  switch (item.reason) {
    case 'workspace_change':
      return item.workspaceCwd !== null
        ? `Workspace changed to ${item.workspaceCwd}`
        : 'Workspace changed'
    case 'clear':
      return 'New session'
    case 'idle_evict':
      return 'New session after idle'
    default:
      return assertNever(item.reason)
  }
}

/**
 * The full delimiter title: the reason label, then the long-form relative time after a spaced em dash
 * (U+2014). The separator is dropped when the time degrades to `''` (an unparseable `occurredAt`), so the
 * title reads as the bare label rather than a dangling dash.
 */
export function sessionBoundaryTitle(item: SessionBoundaryItem, now: number): string {
  const label = labelFor(item)
  const time = formatSessionBoundaryTime(item.occurredAt, now)
  return time ? `${label} — ${time}` : label
}
