// The debug-bundle download's state machine — framework-free and React-free, co-located with the
// section and mirroring composerSend.ts / pairingState.ts: a pure, total reducer plus a couple of
// pure derivers, all tested with plain functions (no React, no store, no Electron). The React
// container (LogDataSection) is thin glue over this.
//
// This is the sole user-facing entry point for the debug-bundle download (#72). The three daemon
// events it consumes (debugBundleProgress / debugBundleSaved / debugBundleFailed) map to NO
// session-store action — translateDaemonEvent returns null for them — so this section owns their
// state locally (ADR 0006: ephemeral screen-local view-state, a useReducer over this pure reducer).
import type { DaemonEvent, DebugBundleFailure, StampedDaemonEvent } from '@shared/ipc/events'

/**
 * The four visible phases of one download attempt. `downloading` carries a running chunk count (the
 * only progress the daemon reports — no total, no percentage, AC3); `saved` carries the local path
 * the archive was written to (AC4); `failed` carries only the closed failure category (AC5) —
 * never a code, errno, or stack.
 */
export type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; chunks: number }
  | { phase: 'saved'; path: string }
  | { phase: 'failed'; reason: DebugBundleFailure }

/**
 * The sealed set of transitions. `requested` is the user's press (optimistic — the `unavailable`
 * path emits no progress, so the busy state cannot wait on an event); the other three are the
 * translated daemon events.
 */
export type DownloadAction =
  | { type: 'requested' }
  | { type: 'progress'; chunks: number }
  | { type: 'saved'; path: string }
  | { type: 'failed'; reason: DebugBundleFailure }

/** A single status caption line. `isError` drives the attention-colored treatment. */
export interface DownloadStatusLine {
  text: string
  isError: boolean
}

/**
 * The presentation the view renders — the one place download strings are derived (the
 * composerAvailability analogue). `busy` drives the button's disabled/aria-busy; `status` is the
 * caption (null when idle).
 */
export interface DownloadViewModel {
  label: string
  busy: boolean
  status: DownloadStatusLine | null
}

export const initialDownloadState: DownloadState = { phase: 'idle' }

/** Compile-time exhaustiveness guard: a new arm without a case is a type error. */
function assertNever(value: never): never {
  throw new Error(`Unhandled download variant: ${JSON.stringify(value)}`)
}

/**
 * Total and phase-agnostic: each action fully determines the next state, without branching on the
 * prior phase. The single-in-flight guard lives in the container (button disabled + a phase re-check)
 * and, deterministically, in the #169 orchestrator — not here. Keeping the reducer phase-agnostic is
 * what lets a bare `progress` re-hydrate the view cleanly (idle → downloading) after a mid-download
 * sheet close/reopen (the accepted-ephemerality path, ADR 0006).
 */
export function reduceDownload(state: DownloadState, action: DownloadAction): DownloadState {
  switch (action.type) {
    case 'requested':
      return { phase: 'downloading', chunks: 0 }
    case 'progress':
      return { phase: 'downloading', chunks: action.chunks }
    case 'saved':
      return { phase: 'saved', path: action.path }
    case 'failed':
      return { phase: 'failed', reason: action.reason }
    default:
      return assertNever(action)
  }
}

/**
 * The translateDaemonEvent analogue: map the three debug-bundle events to their action, and every
 * other DaemonEvent member to `null` (the filter). Pure, so the "ignores unrelated events" behavior
 * is unit-testable without React. A `default: null` — not an assertNever — because ignoring the rest
 * is the intended, permanent behavior here (this section deliberately consumes only its three events).
 */
export function toDownloadAction(event: DaemonEvent): DownloadAction | null {
  switch (event.type) {
    case 'debugBundleProgress':
      return { type: 'progress', chunks: event.chunksReceived }
    case 'debugBundleSaved':
      return { type: 'saved', path: event.path }
    case 'debugBundleFailed':
      return { type: 'failed', reason: event.reason }
    default:
      return null
  }
}

/**
 * #1692: the per-server filter over `toDownloadAction`. With two hosts paired, bundle events arrive
 * stamped with the server that emitted them, and only the host this section asked may move it — so
 * nothing before a request, and never another host's download.
 */
export function bundleActionFor(
  event: StampedDaemonEvent,
  requestedServerId: string | null
): DownloadAction | null {
  if (requestedServerId === null || event.serverId !== requestedServerId) return null
  return toDownloadAction(event)
}

/**
 * The closed failure→sentence map (AC5): the ONLY place a DebugBundleFailure becomes user-facing
 * text. Each value is a plain sentence — never the raw reason token, an errno, or a stack. A
 * Record keyed on the enum makes a new failure category a compile error until it has copy.
 */
const FAILURE_MESSAGE: Record<DebugBundleFailure, string> = {
  unavailable: "Debug data isn't ready right now. Try again in a moment.",
  'stream-corrupt': 'The download was interrupted. Please try again.',
  'write-failed': "Couldn't save the download. Check that there's disk space and try again."
}

/**
 * Derive the view model from the state — the composerAvailability analogue, the one presentation
 * seam. `label`/`busy` govern the button; `status` is the caption. The count appears in the caption
 * (keeping the button width stable) and must be present while downloading (AC3).
 */
export function downloadView(state: DownloadState): DownloadViewModel {
  switch (state.phase) {
    case 'idle':
      return { label: 'Download', busy: false, status: null }
    case 'downloading':
      return {
        label: 'Downloading…',
        busy: true,
        status: {
          text: `Downloading… ${state.chunks} chunk${state.chunks === 1 ? '' : 's'} received`,
          isError: false
        }
      }
    case 'saved':
      return {
        label: 'Download',
        busy: false,
        status: { text: `Saved to ${state.path}`, isError: false }
      }
    case 'failed':
      return {
        label: 'Download',
        busy: false,
        status: { text: FAILURE_MESSAGE[state.reason], isError: true }
      }
    default:
      return assertNever(state)
  }
}
