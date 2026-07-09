import { useEffect, useReducer } from 'react'
import {
  reduceDownload,
  toDownloadAction,
  downloadView,
  initialDownloadState,
  type DownloadState
} from './logDataDownload'

// The "Log data" section of the Run configuration sheet (#72, Figma node 20-100 subtree 98:2/98:16):
// a section header plus a full-width filled-tonal Download button that triggers the debug-bundle
// download and reflects its three daemon events. The container/pure-view split mirrors
// Composer/composerSend: LogDataView is props-in/markup-out (server-renderable, no bridge), and
// LogDataSection is thin glue that owns the ephemeral state and the daemon-event subscription.

export interface LogDataViewProps {
  state: DownloadState
  onDownload: () => void
}

/**
 * The pure section view — owns both its header and its content (the shell's per-section contract).
 * `window.pyry` is never touched here, so this renders under renderToStaticMarkup with no mock.
 */
export function LogDataView({ state, onDownload }: LogDataViewProps): JSX.Element {
  const { label, busy, status } = downloadView(state)
  return (
    <>
      <p className="status-sheet__section-header">Log data</p>
      <div className="log-data">
        <button
          type="button"
          className="log-data__download"
          onClick={onDownload}
          disabled={busy}
          aria-busy={busy}
        >
          {label}
        </button>
        {/* role="status" is a polite live region: the count / saved path / error sentence is
            announced without stealing focus. Rendered only when there is something to say. */}
        {status && (
          <p
            className={status.isError ? 'log-data__status log-data__status--error' : 'log-data__status'}
            role="status"
          >
            {status.text}
          </p>
        )}
      </div>
    </>
  )
}

/**
 * The container: the ephemeral download state (idle / downloading+count / saved-path / error) is
 * useReducer-local per ADR 0006, never the session store (translateDaemonEvent already returns null
 * for all three debug-bundle events, so the store never sees them).
 */
export function LogDataSection(): JSX.Element {
  const [state, dispatch] = useReducer(reduceDownload, initialDownloadState)

  useEffect(() => {
    // One subscription for this section's mount; the returned off handle is the effect cleanup, so a
    // sheet close/reopen nets exactly one live listener (the daemonEventBridge idiom). The listener
    // only dispatches — it never throws into render.
    return window.pyry.onDaemonEvent((event) => {
      const action = toDownloadAction(event)
      if (action) dispatch(action)
    })
  }, [])

  const onDownload = (): void => {
    // Single-in-flight guard (belt): re-check the phase before sending. The button is also disabled
    // while downloading, and the #169 orchestrator drops a stray duplicate command deterministically
    // (belt-and-suspenders, the deterministic backstop being the orchestrator, not another React guard).
    if (state.phase === 'downloading') return
    // window.pyry is dereferenced only here and in the mount effect — never during render — so the
    // container server-renders the idle view without a bridge mock (Composer.handleSubmit discipline).
    window.pyry.sendCommand({ type: 'requestDebugBundle' })
    // Optimistic: the `unavailable` path emits no progress event, so the busy state must be entered
    // now rather than waiting on a daemon event that may never arrive.
    dispatch({ type: 'requested' })
  }

  return <LogDataView state={state} onDownload={onDownload} />
}
