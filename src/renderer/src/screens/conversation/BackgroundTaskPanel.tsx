import { useEffect, useMemo } from 'react'
import {
  useBackgroundTaskRosterStore,
  selectRosterFor,
  type BackgroundTaskRosterEntry
} from '../../store/backgroundTaskRosterStore'

// #581: the background-task panel — the first reader of backgroundTaskRosterStore (#573), which has been
// shipped and unread since it landed. An openable surface listing the tasks the daemon holds alive for the
// open conversation, so work that outlives a turn has a home WITHOUT filling the chat with status rows:
// nothing here renders into the thread timeline, and nothing may (these frames carry no turn_id and
// deliberately never enter the timeline reducer).
//
// This slice is the shell: chrome, the three-way reading branch, and one row per task showing
// `description` + `taskType`. The entry's `droppedTasks` and each task's `truncatedFields` are #582; the
// held `latestUpdate` patch is #583. Both are reachable from the `entry` prop and are deliberately not
// read here — the prop is `selectRosterFor`'s return type exactly, so neither successor has to widen it.
//
// It mounts NO data path. Unlike WorkspacePickerSheet (which mounts RecentWorkspacesData inside itself),
// the roster bridge is already app-wide — <BackgroundTaskRosterData /> is the seventh headless leaf in
// App.tsx — so a mount here would be a second, wrong write path. This file is a pure reader.
//
// The chrome is the shared `.status-sheet__*` overlay vocabulary, used as the INTERIM visual language:
// #580 owns the real design and may land this as a docked sidebar rather than an overlay sheet. So only
// the outermost wrapper is chrome — the rows and the branch copy carry their own `background-task-panel__*`
// classes and no positional CSS, and #580 can swap the wrapper without touching the list.
//
// SECURITY: every `description` rendered here is, for `taskType: local_bash`, the literal command line
// claude ran — untrusted, model-influenced text the daemon bounds but does not sanitize. It is rendered as
// auto-escaped React children and NOTHING else: never dangerouslySetInnerHTML, never into an attribute
// (not even `title=`), never an `href`/`src`, never a React key, never parsed, never executed or re-shelled.
// The rows are deliberately non-interactive — a `<button>` row would advertise an affordance that does not
// exist and would be the natural place for a "run this" handler to grow later. And the LIST shape is not an
// invitation: `entry.tasks` is iterated once, inline, into `<li>` children, and nothing is derived from it —
// no join, no clipboard, no export, no `data-*` attribute carrying a task field (the obligation the store's
// own header, backgroundTaskRosterStore.ts:47-55, names this ticket as inheriting).

// Client-owned copy — no daemon string reaches these. Every literal is apostrophe-free:
// renderToStaticMarkup escapes ' → &#x27; (the standing desktop lesson), which would break the
// server-render assertions.
const BACKGROUND_TASK_PANEL_TITLE = 'Background tasks'
// The two non-populated readings read as DIFFERENT sentences, not one sentence in two places: half of
// "must not collapse into one another" is the copy, the other half is the distinct class below.
const BACKGROUND_TASK_PANEL_UNOBSERVED_COPY = 'No background-task report yet'
const BACKGROUND_TASK_PANEL_EMPTY_COPY = 'No background tasks'

// Distinct from STATUS_SHEET_TITLE_ID / CHANNEL_INFO_SHEET_TITLE_ID / WORKSPACE_PICKER_SHEET_TITLE_ID so
// all four surfaces can coexist without duplicate ids.
const BACKGROUND_TASK_PANEL_TITLE_ID = 'background-task-panel-title'

// #581: the pure background-task panel view — props-in / markup-out, server-renderable, no store / no
// effects / no window.pyry (the WorkspacePickerSheetView posture). Every acceptance criterion binds here.
//
// `entry` is EXACTLY `selectRosterFor`'s return type, and that is the point: the nullable return forces the
// branch at the view, where a test can reach it. The branch is on TWO different things and in this order —
//
//   1. entry === null           no background-task frame has ever arrived for this conversation
//   2. entry.tasks.size === 0   observed: the daemon says nothing is alive (the pyrycode#1240 payoff)
//   3. otherwise                one row per held task
//
// — because the failure mode to design against is a reader that reaches for the tasks BEFORE branching and
// collapses (1) into (2). `[...(entry?.tasks.values() ?? [])].length === 0`, `(entry?.tasks.size ?? 0) === 0`
// and `entry?.tasks ?? new Map()` all compile, break no other test, and quietly undo the distinction
// `selectRosterFor` keeps with `?? null`. Each reading renders its OWN element with its OWN class and copy —
// not one shared "empty" element with different text, and not null. This deliberately diverges from
// WorkspacePickerSheetView, whose not-loaded branch renders null (WorkspacePickerSheet.tsx:139): there the
// sheet has other content, here the branch IS the whole body, so an empty panel would read as broken.
//
// Neither non-populated reading is an ERROR state, and neither is styled or worded as one. Nothing is
// logged on any branch either: a "no roster for conversation X" line is exactly where daemon-influenced
// content starts leaking into a file (the content-free diagnostics rule, #126) — which is why the store's
// own setters are silent about their misses.
export function BackgroundTaskPanelView({
  entry,
  onClose
}: {
  entry: BackgroundTaskRosterEntry | null
  onClose: () => void
}): JSX.Element {
  return (
    <div className="status-sheet-overlay">
      <div className="status-sheet-overlay__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="status-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={BACKGROUND_TASK_PANEL_TITLE_ID}
      >
        <div className="status-sheet__handle" aria-hidden="true" />
        <div className="status-sheet__header">
          <p id={BACKGROUND_TASK_PANEL_TITLE_ID} className="status-sheet__title">
            {BACKGROUND_TASK_PANEL_TITLE}
          </p>
          <button type="button" className="status-sheet__close" aria-label="Close" onClick={onClose}>
            <svg
              className="status-sheet__close-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <div className="status-sheet__body">
          {entry === null ? (
            <p className="background-task-panel__unobserved">
              {BACKGROUND_TASK_PANEL_UNOBSERVED_COPY}
            </p>
          ) : entry.tasks.size === 0 ? (
            <p className="background-task-panel__empty">{BACKGROUND_TASK_PANEL_EMPTY_COPY}</p>
          ) : (
            // A <ul>/<li>, the honest semantics for "one entry per task" — and NOT interactive rows:
            // there is no action on a task in this slice. Display order is roster order and needs no
            // sort; the held Map preserves insertion order and setRoster rebuilds it in row order.
            // A ReadonlyMap's .values() is an iterator, so spread it rather than calling .map on it.
            <ul className="background-task-panel__list">
              {[...entry.tasks.values()].map((task) => (
                // key = taskId: unique by map-key construction, and carried in the VALUE precisely so
                // this iteration needs no entry keys threaded alongside it (HeldBackgroundTask:141-142).
                // The description is never a key — a key is not a place for untrusted text.
                <li key={task.taskId} className="background-task-panel__row">
                  {/* Exactly two fields, each as auto-escaped React children. No terminal state is
                      shown or inferred: the daemon reports no finish event, so a task simply leaves
                      the list when it stops appearing in the roster. */}
                  <span className="background-task-panel__description">{task.description}</span>
                  <span className="background-task-panel__type">{task.taskType}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// #581: the panel's thin interaction container (the WorkspacePickerSheet container idiom minus its bridge
// mount and its dispatch — this surface sends nothing and has no wire traffic at all). It reads the roster
// store for one conversation and attaches an Escape document-listener. In-file, exported at the foot.
//
// `conversationId` rather than the whole ConversationCreatedPayload: the id is all this needs. The `''`
// sentinel for no active conversation matches no key, so `selectRosterFor` returns null = "never observed",
// which is the correct reading and needs no extra branch (the QueuedBacklogControl idiom).
function BackgroundTaskPanel({
  conversationId,
  onClose
}: {
  conversationId: string | null
  onClose: () => void
}): JSX.Element {
  // A useMemo-stable selector per id (QueuedBacklogControl:993-996) so a fresh closure per render does not
  // churn the subscription. The selector returns the HELD ENTRY ITSELF, never a fresh object, so a write for
  // a DIFFERENT conversation leaves this entry Object.is-identical → no re-render. Nothing here wraps,
  // copies, or derives from the result, which is what keeps that true.
  const selectRoster = useMemo(() => selectRosterFor(conversationId ?? ''), [conversationId])
  const entry = useBackgroundTaskRosterStore(selectRoster)
  useEffect(() => {
    // Index the DOM event map — the WorkspacePickerSheet Escape effect verbatim. The panel only mounts
    // while open (gated in ConversationScreen), so the listener attaches on mount / detaches on cleanup —
    // no `open` flag, no leak past close.
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return <BackgroundTaskPanelView entry={entry} onClose={onClose} />
}

export { BackgroundTaskPanel }
