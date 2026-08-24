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

/**
 * AC3 fallback label for a row whose `cwd` yields no usable segment — the `UNNAMED_LABEL` idiom, a
 * client-owned constant standing in for unusable daemon text so no group renders blank.
 */
export const UNKNOWN_WORKSPACE_LABEL = 'Unknown workspace'

// The fallback group's grouping key. `''` is collision-proof BY CONSTRUCTION rather than by guessing an
// improbable string: a `cwd` of `''` has no usable segment, so any row that could collide with the
// sentinel is already in the fallback bucket. Module-local — nothing outside compares against it.
const UNKNOWN_WORKSPACE_KEY = ''

/** One workspace group: its exact `cwd` grouping key, its display label, and its rows in array order. */
export type WorkspaceGroup = {
  readonly key: string
  readonly label: string
  readonly rows: readonly ConversationSummary[]
}

/**
 * The last usable path segment of `cwd`, or `null` when there is none (AC2/AC3). Split on `/` and walk
 * the segments from the end, returning the first that is non-blank after trimming — one walk, which is
 * why a trailing separator, repeated separators and a whitespace-only tail all fall out of the same
 * rule rather than needing special cases.
 *
 * `cwd` is untrusted daemon text held as an opaque display string (types.ts, CLAUDE.md 2026-08-20), so
 * this is deliberately string work and nothing else: no `path`, no `fs`, no `node:*`, no `URL`. It is
 * also TOTAL over `string` — it never throws, because a thrown error would carry the offending `cwd`
 * into an error boundary, and `cwd` may never be logged or echoed. The returned segment is NOT trimmed:
 * the trim is only the usability predicate, and the client normalises nothing.
 *
 * `\` is deliberately not a separator. Treating it as one would assume the daemon's host OS — an
 * interpretation this client never makes — and would corrupt a legal Unix directory whose name contains
 * a backslash. A `\`-separated value therefore survives whole, as its own single segment.
 *
 * Returns `string | null` rather than folding the fallback in like `titleFor`, on purpose: the caller is
 * a grouper that must tell "no usable label" from "a label that happens to read like the fallback".
 * Deriving the grouping key by comparing against `UNKNOWN_WORKSPACE_LABEL` would fold a real directory
 * named `Unknown workspace` into the fallback bucket, which AC3 forbids in both directions.
 */
export function workspaceLabelFor(cwd: string): string | null {
  const segments = cwd.split('/')
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.trim() !== '') return segment
  }
  return null
}

/**
 * Group `rows` by workspace (#703), one group per distinct `cwd`. Two rows share a group only when their
 * `cwd` values are IDENTICAL strings — the key is the raw `cwd`, normalised in no way, so `/a/b` and
 * `/a/b/` honestly surface as two groups both labelled `b` rather than being silently merged (AC1).
 * Rows with no usable label all collapse into the single fallback group (AC3).
 *
 * Accumulates into a `Map`, never a plain object: object keys that look like integers enumerate FIRST in
 * numeric order regardless of insertion order, and `cwd` is arbitrary untrusted text, so a relative cwd
 * of `'2'` would jump ahead of every earlier group. `Map` preserves insertion order for all keys, which
 * is what makes AC4's "group order follows first appearance, no sort anywhere" hold — including for the
 * fallback group, which is ordered by first appearance like any other and is NOT pinned last.
 */
export function groupByWorkspace(
  rows: readonly ConversationSummary[]
): readonly WorkspaceGroup[] {
  const groups = new Map<string, { label: string; rows: ConversationSummary[] }>()
  for (const row of rows) {
    const label = workspaceLabelFor(row.cwd)
    const key = label === null ? UNKNOWN_WORKSPACE_KEY : row.cwd
    const existing = groups.get(key)
    if (existing !== undefined) {
      existing.rows.push(row)
      continue
    }
    groups.set(key, { label: label ?? UNKNOWN_WORKSPACE_LABEL, rows: [row] })
  }
  return Array.from(groups, ([key, group]) => ({ key, label: group.label, rows: group.rows }))
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
