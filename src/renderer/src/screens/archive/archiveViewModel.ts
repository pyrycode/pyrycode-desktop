// The pure view-model for the Archive screen (#348). Framework-free `.ts`, mirroring
// channelListViewModel.ts, so every derivation unit-tests without React or the store. It derives
// entirely from the already-live conversationListStore rows — no new read, store, or bridge (the
// archived rows arrive via `is_archived` in the `list_conversations` reply, pyrycode#880). The wire
// `ConversationSummary` carries NO true `archived_at` time (types.ts) — only `last_message_ts` — so
// the subtitle's honest signal is a last-activity relative time, the same posture
// channelListViewModel.ts documents. Figma's coarser "weeks/months ago" buckets and a real archived-at
// time are deferred pending a daemon + wire change.
import type { ConversationSummary } from '@shared/wire/types'
import { partitionByPromotion, formatLastActivity } from '../channels/channelListViewModel'

/**
 * Filter the store's rows to the archived ones (`is_archived === true`), then split that subset into
 * the two Figma sections by delegating to `partitionByPromotion` (channels = promoted, discussions =
 * not). Order-preserving — no sort: the daemon's array order is authoritative (AC1), so within each
 * section the archived rows keep their store order. The returned object's keys (`channels` /
 * `discussions`) ARE the `ArchiveTab` union members, so the view indexes it as `partition[tab]`,
 * welding each tab's count and body to the same key. Either section may be empty.
 */
export function partitionArchived(rows: readonly ConversationSummary[]): {
  channels: readonly ConversationSummary[]
  discussions: readonly ConversationSummary[]
} {
  return partitionByPromotion(rows.filter((r) => r.is_archived))
}

/**
 * The archived-row subtitle (AC3). Composes `"Archived " + formatLastActivity(iso, now)`. Because
 * `formatLastActivity` ALREADY embeds "ago" ("2 days ago") and falls back to a short date ("Jul 4")
 * past a week, this is `"Archived " + rel`, NEVER `"Archived " + rel + " ago"` — that would double the
 * "ago". A non-parseable timestamp makes `rel` `''`, in which case the subtitle is the bare "Archived"
 * (no trailing space). The measured signal is last-activity, not a true archived-at time (the honest-
 * signal seam above); do NOT extend `formatLastActivity` with weeks/months buckets — it is shared with
 * the Channel List, so this composition keeps the change additive to the archive screen only.
 */
export function archivedSubtitle(iso: string, now: number): string {
  const rel = formatLastActivity(iso, now)
  return rel === '' ? 'Archived' : `Archived ${rel}`
}

/**
 * A tab's label with its live archived count (AC2). `count === null` (the list is not yet loaded) →
 * the bare `base`; otherwise `` `${base} (${count})` `` — including `count === 0` → "Channels (0)", so
 * a loaded-but-empty tab shows "(0)" rather than a bare label. Keeps the null-vs-loaded tri-state in
 * one testable unit.
 */
export function tabCountLabel(base: string, count: number | null): string {
  return count === null ? base : `${base} (${count})`
}
