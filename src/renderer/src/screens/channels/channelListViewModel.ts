// The pure view-model for the Channel List home screen (#141). Framework-free `.ts`, mirroring
// messageViewModel.ts, so every derivation unit-tests without React or the store. The wire
// `ConversationSummary` carries NO message text (types.ts) — only a `last_message_ts` timestamp — so
// each row's honest signal is a last-activity relative time, not the body-preview the Figma shows
// (deferred; needs a daemon + wire change first).
import type { ConversationSummary } from '@shared/wire/types'

/** AC3 fallback for a row with no usable name — never a blank row. */
export const UNNAMED_LABEL = 'Untitled'

/**
 * The row title. Returns `name` when it is present and non-blank; otherwise `UNNAMED_LABEL`. Guards
 * `null` (the wire's literal "unnamed scratch conversation") AND empty / whitespace-only strings, so
 * a daemon-supplied blank never renders as an empty row (AC3).
 */
export function titleFor(name: string | null): string {
  if (name !== null && name.trim() !== '') return name
  return UNNAMED_LABEL
}

/**
 * Split the store's rows into the two Figma sections by `is_promoted` (`true` = a saved Channel,
 * `false` = an ad-hoc Recent discussion). Two order-preserving filters — no sort: the daemon's array
 * order is authoritative (AC2), so within each section rows keep their store order.
 */
export function partitionByPromotion(rows: readonly ConversationSummary[]): {
  channels: readonly ConversationSummary[]
  discussions: readonly ConversationSummary[]
} {
  return {
    channels: rows.filter((r) => r.is_promoted),
    discussions: rows.filter((r) => !r.is_promoted)
  }
}

/**
 * The active Channel List's row source: drop archived rows first, then split the survivors by
 * promotion via the shared primitive. The exact dual of `archiveViewModel.partitionArchived`
 * (which keeps `r.is_archived`) — the two symmetric callers of `partitionByPromotion`, which itself
 * stays the neutral shared split. Order-preserving (no sort). Fixes #469: `list_conversations`
 * returns archived rows tagged `is_archived` (pyrycode#880) and the active list never filtered them,
 * so archived conversations leaked into both the active list and the Archive screen.
 */
export function partitionActive(rows: readonly ConversationSummary[]): {
  channels: readonly ConversationSummary[]
  discussions: readonly ConversationSummary[]
} {
  return partitionByPromotion(rows.filter((r) => !r.is_archived))
}

const MS_MINUTE = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000
const MS_WEEK = 604_800_000

// UTC month lookup for the older-than-a-week short date, so the rendering is timezone-independent
// (a locale/TZ-dependent Date#toLocaleDateString would make the test flaky across runners).
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

/**
 * Relative last-activity time from an RFC3339 `iso`, measured against an injected `now` (ms) so the
 * function stays pure and deterministic under test (never `Date.now()` inside). Untrusted daemon
 * input degrades silently: a non-parseable timestamp yields `''` (the row then renders its title with
 * no time), and a future timestamp (clock skew) clamps to `'just now'` rather than a negative delta.
 * Buckets match the Figma exemplars ("2m ago", "3h ago", "Yesterday", "2 days ago").
 */
export function formatLastActivity(iso: string, now: number): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const delta = now - ms
  if (delta < MS_MINUTE) return 'just now'
  if (delta < MS_HOUR) return `${Math.floor(delta / MS_MINUTE)}m ago`
  if (delta < MS_DAY) return `${Math.floor(delta / MS_HOUR)}h ago`
  if (delta < 2 * MS_DAY) return 'Yesterday'
  if (delta < MS_WEEK) return `${Math.floor(delta / MS_DAY)} days ago`
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
