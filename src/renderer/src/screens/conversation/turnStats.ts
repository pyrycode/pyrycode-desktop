import type { TurnEndMetrics } from '@shared/ipc/events'
import type { ThreadItem } from '../../store/threadTimeline'

// #1566: a turn's tokens and wall time, shown on hover of the meta row of the turn's last assistant
// bubble. The numbers are daemon-supplied: the caller renders the string as React text children only,
// never into an attribute (including `title`) and never into a log (CLAUDE.md's daemon-text rule).

/** A reported value counts only when it is a finite number above 0; absent, 0 and negatives do not. */
function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}

function formatCount(count: number): string {
  return count < 1000 ? String(Math.round(count)) : `${(Math.round(count / 100) / 10).toFixed(1)}k`
}

function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * `12.4k in · 800 out · 41s`, or null when every segment is omitted. `in` is the turn's WHOLE input:
 * `inputTokens` is the uncached part alone and badly understates a turn by itself. A segment whose value
 * is non-positive or absent is omitted; a duration under one second counts as non-positive.
 * `costUsdTotal` is not read here.
 */
export function formatTurnStats(metrics: TurnEndMetrics): string | null {
  const input = positive(metrics.inputTokens) + positive(metrics.cacheReadTokens) +
    positive(metrics.cacheCreationTokens)
  const output = positive(metrics.outputTokens)
  const seconds = Math.floor(positive(metrics.durationMs) / 1000)
  const segments = [
    input > 0 ? `${formatCount(input)} in` : null,
    output > 0 ? `${formatCount(output)} out` : null,
    seconds > 0 ? formatDuration(seconds) : null
  ].filter((segment) => segment !== null)
  return segments.length === 0 ? null : segments.join(' · ')
}

/**
 * Item index of each closed turn's last `assistantText` → that turn's stats string. The tracker resets
 * on `turnBoundary` only: tool rows between the bubble and the boundary leave it alone, and so does a
 * `userText` echoed while the turn runs, which lands before that turn's boundary. An open turn has no
 * boundary yet and maps nothing; neither does a turn with no assistant text or no numbers.
 */
export function turnStatsByItemIndex(items: readonly ThreadItem[]): ReadonlyMap<number, string> {
  const stats = new Map<number, string>()
  let lastAssistant = -1
  items.forEach((item, index) => {
    if (item.kind === 'assistantText') lastAssistant = index
    if (item.kind !== 'turnBoundary') return
    const text = lastAssistant === -1 ? null : formatTurnStats(item)
    if (text !== null) stats.set(lastAssistant, text)
    lastAssistant = -1
  })
  return stats
}
