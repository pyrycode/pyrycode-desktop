// The app shell's route model and the launch-status→screen mapping — framework-free and
// React-free, co-located with App and mirroring composerSend.ts: a pure, deterministic function
// tested without React, store, or Electron. The React container (App) is thin glue over this.
import type { PairingStatus } from '@shared/ipc/pairingStatus'

/**
 * Which of the two built screens the shell shows, plus `pending` for the sliver before the
 * launch-time pairing query resolves. `pending` renders neither screen (the dark canvas shows
 * through) so first paint is never the eventually-wrong screen (AC3).
 */
export type AppRoute = 'pending' | 'pairing' | 'conversation'

/**
 * Map a resolved launch-time PairingStatus to its screen. Fail-safe BY CONSTRUCTION: ONLY a
 * genuine `paired` reaches the conversation screen; every other resolved outcome — `not-paired`,
 * `error`, or any future member — routes to the pairing screen. This is AC2 ("conversation
 * reachable only on paired", ADR 0005: an unreadable record is never masked as never-paired)
 * enforced as a total function. The ternary is deliberate over a per-arm switch: it structurally
 * guarantees anything that is not exactly `paired` fails safe to `pairing`.
 */
export function routeForStatus(status: PairingStatus): Exclude<AppRoute, 'pending'> {
  return status.status === 'paired' ? 'conversation' : 'pairing'
}
