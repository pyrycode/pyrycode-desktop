// The pure view-model for the session-boundary delimiter (#286, recopied #690). Framework-free `.ts`,
// mirroring channelListViewModel.ts, so the derivation unit-tests without React or the store. It is now
// a label derivation and nothing else: #690 dropped the long-form relative time this module used to
// append (`— 2 hours ago`), because every message above and below the row already carries its own
// timestamp. `occurredAt` stays on the ThreadItem — the store owns it — it simply has no reader here.
import type { ThreadItem } from '../../store/threadTimeline'

/** The narrowed sessionBoundary item — the only ThreadItem member this view-model reads. */
type SessionBoundaryItem = Extract<ThreadItem, { kind: 'sessionBoundary' }>

/** Compile-time exhaustiveness guard: a future fourth reason without a case is a type error here. */
function assertNever(reason: never): never {
  throw new Error(`Unhandled session boundary reason: ${JSON.stringify(reason)}`)
}

/**
 * The reason-appropriate delimiter label. An exhaustive switch on `reason` (assertNever default) — a
 * future wire reason breaks the build here (the no-drift guard). The Figma (node 119-3843) draws only
 * `Session reset`; per the operator's 2026-08-22 decision the reason stays in the WORDS, so a reset the
 * operator asked for and one the host took after an idle timeout read differently. `workspace_change`
 * names the new path verbatim (untrusted, escaped at render); if `workspaceCwd` is `null` (a wire-
 * contract violation — the field is `string | null` unconditionally) it degrades to the pathless label,
 * never the literal `null`. All labels are apostrophe-free (renderToStaticMarkup escapes `'` →
 * `&#x27;`, complicating assertions).
 */
export function sessionBoundaryTitle(item: SessionBoundaryItem): string {
  switch (item.reason) {
    case 'workspace_change':
      return item.workspaceCwd !== null
        ? `Workspace changed to ${item.workspaceCwd}`
        : 'Workspace changed'
    case 'clear':
      return 'Session reset'
    case 'idle_evict':
      return 'Session reset after idle'
    default:
      return assertNever(item.reason)
  }
}
