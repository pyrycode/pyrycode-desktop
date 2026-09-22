import type { ThreadItem } from '../../store/threadTimeline'

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

/** `$0.42 est.`, rounded to cents. */
export function formatSessionCost(usd: number): string {
  return `$${usd.toFixed(2)} est.`
}
