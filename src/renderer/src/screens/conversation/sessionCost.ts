import type { ThreadItem } from '../../store/threadTimeline'
import type { ThreadSnapshot } from '../../store/threadItemStore'

// #1567: the session's running cost, shown in the channel info sheet. `costUsdTotal` is claude's own
// estimate of the WHOLE session so far, which the daemon does not verify, so the sheet attributes it to
// Claude and never presents it as the app's accounting. The caller renders the string as a React text
// child only and never logs it.

/**
 * The latest positive `costUsdTotal` among the turn boundaries, or null when none. Never a sum: each
 * value already includes the ones before it. A later boundary whose value is absent, 0, negative or not
 * finite does not replace an earlier one.
 */
export function latestSessionCostUsd(items: readonly ThreadItem[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind !== 'turnBoundary') continue
    const cost = item.costUsdTotal
    if (cost !== undefined && Number.isFinite(cost) && cost > 0) return cost
  }
  return null
}

/** Normal turn endings are hidden rows, but still supply the selected session's reported total. */
export function latestThreadSessionCostUsd(snapshot: ThreadSnapshot | null, session: string | null): number | null {
  if (!snapshot || !session) return null
  const endings = snapshot.items.filter(item => item.session === session && !item.parent && item.kind === 'turn_end')
    .sort((a, b) => Number(b.order ?? 0) - Number(a.order ?? 0))
  for (const item of endings) {
    const c = item.content
    if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
    const cost = (c as Record<string, unknown>).cost_usd_total
    if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) return cost
  }
  return null
}

/** `$0.42 est.`, rounded to cents. */
export function formatSessionCost(usd: number): string {
  return `$${usd.toFixed(2)} est.`
}
