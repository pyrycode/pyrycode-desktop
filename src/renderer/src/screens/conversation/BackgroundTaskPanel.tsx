import { useEffect } from 'react'
import { CAPABILITY_STOP_BACKGROUND_TASK, type WireAgent } from '@shared/wire/types'
import { type ConnectionStatus } from '../../store/sessionStore'
import { shouldInterruptOnKeyDown, type ComposerKeyEvent } from './composerSend'
import {
  type HeldBackgroundTask,
  type HeldBackgroundTaskProgress
} from '../../store/backgroundTaskRosterStore'

// Client-owned copy — no daemon string reaches these. Every literal is apostrophe-free:
// renderToStaticMarkup escapes ' → &#x27; (the standing desktop lesson), which would break the
// server-render assertions.
const BACKGROUND_TASK_PANEL_TITLE = 'Background tasks'
// #1635: the two group headers. Running is also the tag of a task no status word has reached (#1639).
const BACKGROUND_TASK_PANEL_RUNNING_LABEL = 'Running'
const BACKGROUND_TASK_PANEL_FINISHED_LABEL = 'Finished'

// #1639: the three status words claude reports for a finished task, each with its client-owned tag
// label and class. The daemon word is the lookup NEEDLE, compared with `===` by `Map.get`, and never
// becomes a class: an unknown word falls out to the Stopped class below with the word as its text.
const TASK_STATUS_TAGS: ReadonlyMap<string, { label: string; className: string }> = new Map([
  ['completed', { label: 'Completed', className: 'background-task-panel__tag background-task-panel__tag--completed' }],
  ['failed', { label: 'Failed', className: 'background-task-panel__tag background-task-panel__tag--failed' }],
  ['stopped', { label: 'Stopped', className: 'background-task-panel__tag background-task-panel__tag--stopped' }]
])
const TASK_TAG_RUNNING_CLASS = 'background-task-panel__tag background-task-panel__tag--running'
const TASK_TAG_UNKNOWN_CLASS = 'background-task-panel__tag background-task-panel__tag--stopped'
const BACKGROUND_TASK_PANEL_UPDATE_LABEL = 'Latest update'

// #1635: the one task type whose description is a shell command, so the drawing sets it in mono. The
// daemon string is compared against this constant to choose a client-owned class; it never becomes one.
const TASK_TYPE_SHELL = 'local_bash'

// #582: the marker shown beside a field the daemon cut. Deliberately echoes UNRECOGNIZED_TRUNCATED_COPY's
// vocabulary (ConversationScreen.tsx:500) so the app says the same thing the same way about the same
// daemon behaviour. One sentence for both fields — the two classes below, not the copy, carry which.
const BACKGROUND_TASK_PANEL_CUT_COPY = 'Truncated by the daemon'

// #583: the RECORDED-EMPTY-PATCH reading. `patch: ''` means claude reported no change — a VALUE, not an
// absence, since the field always arrives on the wire — so it gets a sentence of its own rather than
// rendering as nothing, which is what the never-updated reading renders. Deliberately carries no
// completion / failure vocabulary: this frame family reports no terminal event, so "no change" is a
// report about something still alive, never a finish. Also checked for substring collisions against the
// shipped copy and the classes below, and against the two absences shipped tests assert (`not shown`,
// `background-task-panel__empty`) — it contains neither.
const BACKGROUND_TASK_PANEL_NO_CHANGE_COPY = 'No change reported'

// Distinct from STATUS_SHEET_TITLE_ID / CHANNEL_INFO_SHEET_TITLE_ID / WORKSPACE_PICKER_SHEET_TITLE_ID so
// all four surfaces can coexist without duplicate ids.
const BACKGROUND_TASK_PANEL_TITLE_ID = 'background-task-panel-title'

// #582: THE WIRE NAMES, not the held property names — the trap this slice exists to defuse. A
// `truncatedFields` list's CONTENTS cross IPC unconverted: only the field itself was camelCased
// (`truncatedFields: row.truncated_fields`, backgroundTaskRosterStore.ts:328, and again at :351 for the
// started path), while the strings inside stay as the daemon wrote them. So the panel holds
// `task.taskType` but must match `task_type`. Matching on `'taskType'` compiles, type-checks, never
// matches, and fails no other test — the same silent-collapse family as the null-vs-[] distinction, which
// is why the pairing is pinned here as named constants rather than inlined at the two call sites.
const CUT_FIELD_DESCRIPTION = 'description' // wire name === held name here — coincidence, not a rule
// …and NOT on the progress report (#1640), whose `description` is held as `currentActivity`: the same
// constant, matched against `progress.truncatedFields`, is what marks a cut activity.
const CUT_FIELD_TASK_TYPE = 'task_type' // held as `taskType`; the WIRE name is what the list carries
// #583: the UPDATE's vocabulary, not the task's — matched against `latestUpdate.truncatedFields` and
// against nothing else. No casing trap on this one (wire name === held name again, the same coincidence
// `description` enjoys), so the trap available here is the OTHER one: passing the wrong LIST. Keeping it
// beside its siblings as a named constant is what makes the three call sites read as three pairings.
const CUT_FIELD_PATCH = 'patch'
// #1639: the terminal frame's vocabulary too, matched against `summary.truncatedFields` only.
const CUT_FIELD_SUMMARY = 'summary'

/** #1640: the client-built half of a running row's meta line, after the tool name: tool count, tokens
 *  and elapsed time, e.g. `4 tools · 18k tokens · 2m 41s`. Numbers only, so no daemon string reaches it,
 *  and each counter is shown as received — never summed with or diffed against an earlier report.
 *
 *  Elapsed pads the seconds under an hour (`1m 05s`, as the drawing sets it) and drops them from an
 *  hour on (`1h 2m`). A nonsense counter (a negative, say) prints as an odd number, not an error. */
export function formatTaskProgressCounts(
  progress: Pick<HeldBackgroundTaskProgress, 'toolUses' | 'totalTokens' | 'durationMs'>
): string {
  const tools = progress.toolUses === 1 ? '1 tool' : `${progress.toolUses} tools`
  const tokens =
    progress.totalTokens < 1000
      ? `${progress.totalTokens} tokens`
      : `${Math.round(progress.totalTokens / 1000)}k tokens`
  return `${tools} · ${tokens} · ${formatElapsed(progress.durationMs)}`
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** #582: has the daemon reported cutting this wire field on this task? `null` ("nothing was cut"), `[]`
 *  and an unrecognised name all fall out as `false` without a branch of their own.
 *
 *  The vocabulary is OPEN, deliberately: a roster row names `task_id` / `task_type` / `description`, a
 *  started frame adds `tool_call_id`, and the daemon may ship a name this panel has never heard of. So
 *  this is `includes` over an open list and NOT a switch — an exhaustive switch, an `assertNever` or a
 *  closed union type would turn a valid future frame into a crash or a blank panel. The panel renders a
 *  subset of the named fields; it marks the ones it renders and ignores the rest.
 *
 *  Module-private, and NOT unit-tested directly on purpose: a predicate-level test passes whatever name it
 *  is handed and would stay green while the call site passed the held camelCase name. The trap lives at
 *  the call site, so its test does too (BackgroundTaskPanel.test.tsx, the wire-name scenario).
 *
 *  The daemon string is the NEEDLE, never the index: no dynamic property access, no selector, no regex is
 *  built from it, so this cannot become a dynamic-lookup gadget. And nothing here reads the task TEXT —
 *  the list reports the cap cut only (the daemon also scrubs invalid UTF-8 by deletion), so a cut is
 *  never inferred from the text and the text is never inferred whole from an absent name. */
function wasCut(truncatedFields: readonly string[] | null, wireFieldName: string): boolean {
  return truncatedFields !== null && truncatedFields.includes(wireFieldName)
}

export interface SuppliedBackgroundTask extends HeldBackgroundTask {
  rowKey: string
  active: boolean
  pending: boolean
  canStop: boolean
  outcomeLabel: string
}

export function BackgroundTaskPanelView({
  suppliedTasks,
  onStopTask,
  turnRunning = false,
  onClose
}: {
  suppliedTasks: readonly SuppliedBackgroundTask[]
  onStopTask?: (taskId: string) => void
  turnRunning?: boolean
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    // Capture lets one Escape close the drawer before other overlays claim it, while
    // yielding composition keys and the composer's running-turn interrupt binding.
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      const { target } = event
      const inComposerStop = target instanceof Element && target.matches(COMPOSER_STOP_BINDINGS)
      if (!drawerClosesOnKeyDown(event, { inComposerStop, turnRunning })) return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, turnRunning])
  return (
    // #1634: `role="dialog"` WITHOUT `aria-modal` — a non-modal dialog, which is what a drawer that leaves
    // the thread and the composer usable is. The role and its name are also what every spec finds it by.
    <section
      className="background-task-drawer"
      role="dialog"
      aria-labelledby={BACKGROUND_TASK_PANEL_TITLE_ID}
    >
      <div className="background-task-drawer__header">
        <h2 id={BACKGROUND_TASK_PANEL_TITLE_ID} className="background-task-drawer__title">
          {BACKGROUND_TASK_PANEL_TITLE}
        </h2>
        {/* The design's circle-xmark (the glyph `modal-close.svg` carries), drawn INLINE rather than as an
            <img>: the escaping tests below assert no `<img` anywhere in this markup, which is what proves a
            markup-shaped description stayed text. The disc and the cross cut-out take their colours from
            the stylesheet, not from literals. */}
        <button type="button" className="background-task-drawer__close" aria-label="Close" onClick={onClose}>
          <svg className="background-task-drawer__close-icon" viewBox="0 0 28 28" width="20" height="20"
            aria-hidden="true">
            <circle className="background-task-drawer__close-cutout" cx="14" cy="14" r="9.8" />
            <path d="M14 28C21.7328 28 28 21.7328 28 14C28 6.26719 21.7328 0 14 0C6.26719 0 0 6.26719 0 14C0 21.7328 6.26719 28 14 28ZM9.13281 9.13281C9.64687 8.61875 10.4781 8.61875 10.9867 9.13281L13.9945 12.1406L17.0023 9.13281C17.5164 8.61875 18.3477 8.61875 18.8562 9.13281C19.3648 9.64687 19.3703 10.4781 18.8562 10.9867L15.8484 13.9945L18.8562 17.0023C19.3703 17.5164 19.3703 18.3477 18.8562 18.8562C18.3422 19.3648 17.5109 19.3703 17.0023 18.8562L13.9945 15.8484L10.9867 18.8562C10.4727 19.3703 9.64141 19.3703 9.13281 18.8562C8.62422 18.3422 8.61875 17.5109 9.13281 17.0023L12.1406 13.9945L9.13281 10.9867C8.61875 10.4727 8.61875 9.64141 9.13281 9.13281Z" />
          </svg>
        </button>
      </div>
      <div className="background-task-drawer__rule" aria-hidden="true" />
      <div className="background-task-drawer__body">
            <div className="background-task-panel__groups">
              {[true, false].map(active => {
                const tasks = suppliedTasks.filter(task => task.active === active)
                return tasks.length === 0 ? null : <section key={String(active)} className="background-task-panel__group">
                  <h3 className="background-task-panel__group-header">{(active ? BACKGROUND_TASK_PANEL_RUNNING_LABEL : BACKGROUND_TASK_PANEL_FINISHED_LABEL) + ' · ' + tasks.length}</h3>
                  <ul className="background-task-panel__list">{tasks.map(task =>
                    <TaskRow key={task.rowKey} task={task} finished={!active} pending={task.pending}
                      suppliedOutcome={task.outcomeLabel} onStopTask={task.canStop ? onStopTask : undefined} />
                  )}</ul>
                </section>
              })}
            </div>
      </div>
    </section>
  )
}

function formatTaskType(taskType: string): string {
  if (taskType === 'local_agent') return 'Agent'
  if (taskType === TASK_TYPE_SHELL) return 'Command'
  const label = taskType.replace(/^local_/, '').replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** #1635: one task as the drawn card: the type line with its status tag, the description, then the
 *  latest update; a finished card adds its summary under the description (#1639). Every daemon field is an
 *  auto-escaped child of its own element. */
function TaskRow({ task, finished, pending, onStopTask, suppliedOutcome }: {
  task: HeldBackgroundTask
  suppliedOutcome: string
  finished: boolean
  pending: boolean
  onStopTask?: (taskId: string) => void
}): JSX.Element {
  const descriptionClass =
    task.taskType === TASK_TYPE_SHELL
      ? 'background-task-panel__description background-task-panel__description--mono'
      : 'background-task-panel__description'
  return (
    <li className={finished ? 'background-task-panel__row background-task-panel__row--finished' : 'background-task-panel__row'}>
      {/* #582: each cut marker sits IMMEDIATELY AFTER the field it describes, so position carries the
          attribution — no id / aria-describedby pair built from `taskId`, which is a daemon string. The
          type's marker follows the type-and-tag line, since the tag shares the type's line.

          The marker is a SIBLING ELEMENT holding a client-owned constant, never text concatenated into
          the field span: `{task.description}{cut && ' (truncated)'}` would fuse client copy and daemon
          text into one node, so a description ending in those same words would be indistinguishable
          from the app's own claim. The field NAMES are matched, never displayed. */}
      <div className="background-task-panel__head">
        <span className="background-task-panel__type">{formatTaskType(task.taskType)}</span>
        <TaskStatusTag status={task.status} label={suppliedOutcome} />
      </div>
      {wasCut(task.truncatedFields, 'ending.cause') && (
        <span className="background-task-panel__cut-type background-task-panel__cut-outcome">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      {wasCut(task.truncatedFields, CUT_FIELD_TASK_TYPE) && (
        <span className="background-task-panel__cut-type">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      <span className={descriptionClass}>{task.description}</span>
      {wasCut(task.truncatedFields, CUT_FIELD_DESCRIPTION) && (
        <span className="background-task-panel__cut-description">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      {/* Supplied reports remain visible independently of activity or repeated description text. */}
      {task.summary !== null && task.summary.text !== '' && (
        <>
          <span className="background-task-panel__summary">{task.summary.text}</span>
          {wasCut(task.summary.truncatedFields, CUT_FIELD_SUMMARY) && (
            <span className="background-task-panel__cut-summary">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
          )}
        </>
      )}
      {/* #1640: the running task's latest progress report, between the description and the latest
          update. The group, not the held record, decides "running", so a finished row never shows one,
          whatever it still holds. The activity's cut chip reads the REPORT's own list, with the wire
          name `description` — the task's own list names the opening description, a different field.

          The activity is one ellipsised line and there is deliberately no `title=` carrying the full
          text: it names a file on the operator's host, and an attribute is not a place for daemon text.
          The tool name is its own element, so it is never fused with the client's counts in one node. */}
      {!finished && task.progress !== null && <TaskProgress progress={task.progress} />}
      {/* #583: the latest change claude reported about this task, under its label in a code block.

          The branch is on `latestUpdate !== null`, and the empty patch is a reading BENEATH it — never
          `{task.latestUpdate?.patch && …}` or any other truthiness test on the patch. `patch: ''` is a
          VALUE ("claude reported no change"; the wire field has no omitempty), so a truthiness test
          renders it EXACTLY as a never-updated task, and `''` leaves the collapse no trace in the markup.
          A never-updated task renders no block at all (the design notes say so).

          The cut marker is a SIBLING of the block, inside the null guard rather than inside the
          non-empty arm: the cut report is a property of the update RECORD, not of the patch's
          emptiness, so a recorded `{ patch: '', truncatedFields: ['patch'] }` still shows it.

          It reads `task.latestUpdate.truncatedFields` and the markers above read
          `task.truncatedFields`, and the crossover is the silent mis-wiring here: both lists are
          `readonly string[] | null`, so either swap compiles, type-checks and never matches. Nothing
          reads the patch TEXT to produce the marker, and the text is never parsed: the block is CSS. */}
      {task.latestUpdate !== null && (
        <div className="background-task-panel__update">
          <span className="background-task-panel__update-label">{BACKGROUND_TASK_PANEL_UPDATE_LABEL}</span>
          <div className="background-task-panel__update-block">
            {task.latestUpdate.patch === '' ? (
              <span className="background-task-panel__no-change">{BACKGROUND_TASK_PANEL_NO_CHANGE_COPY}</span>
            ) : (
              <span className="background-task-panel__patch">{task.latestUpdate.patch}</span>
            )}
          </div>
          {wasCut(task.latestUpdate.truncatedFields, CUT_FIELD_PATCH) && (
            <span className="background-task-panel__cut-patch">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
          )}
        </div>
      )}
      {!finished && onStopTask !== undefined && !wasCut(task.truncatedFields, 'task_id') && (
        <button type="button" className="button-small background-task-panel__stop" disabled={pending}
          onClick={() => { if (!pending) onStopTask(task.taskId) }}>
          Stop task
        </button>
      )}
    </li>
  )
}

function TaskProgress({ progress }: { progress: HeldBackgroundTaskProgress }): JSX.Element {
  const counts = formatTaskProgressCounts(progress)
  return (
    <div className="background-task-panel__progress">
      <span className="background-task-panel__activity">{progress.currentActivity}</span>
      {wasCut(progress.truncatedFields, CUT_FIELD_DESCRIPTION) && (
        <span className="background-task-panel__cut-activity">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      <span className="background-task-panel__progress-meta">
        {progress.lastToolName === '' ? (
          counts
        ) : (
          <>
            <span className="background-task-panel__progress-tool">{progress.lastToolName}</span>
            {` · ${counts}`}
          </>
        )}
      </span>
    </div>
  )
}

/** #1635: the drawn Task status tag (Figma 563:1054), mapped from the held status word (#1639). No word
 *  yet reads Running; `completed` / `failed` / `stopped` read their own client label and style; any other
 *  non-empty word reads as itself, an auto-escaped child, in the Stopped style. The class is always one
 *  of the four constants above, so the word never reaches an attribute. It chooses the tag only: group membership comes from the supplied task's activity. */
function TaskStatusTag({ status, label }: { status: string | null; label: string }): JSX.Element {
  const known = status === null ? undefined : TASK_STATUS_TAGS.get(status)
  const className = status === null ? TASK_TAG_RUNNING_CLASS : (known?.className ?? TASK_TAG_UNKNOWN_CLASS)
  return (
    <span className={className}>
      <span className="background-task-panel__tag-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

// #1634: the two elements that carry #1072's Escape-stops-the-turn binding — the message box and the
// send button in its stop variant. The drawer defers to exactly these, and only while that binding will
// act; an options row or any other focus inside the composer does not count.
const COMPOSER_STOP_BINDINGS = '.composer__input, .composer__send'

/** #1634: does this key press close the drawer? Escape does, except while an IME composition is open
 *  (that Escape belongs to the composition) and except when focus is on one of the composer's stop
 *  bindings and `shouldInterruptOnKeyDown` — the decision those bindings consult — says it will stop a
 *  running turn. Then the composer acts and the drawer stays open. Asking the composer's own predicate
 *  rather than restating it keeps the two from disagreeing about which press is the composer's. */
export function drawerClosesOnKeyDown(
  keystroke: ComposerKeyEvent,
  focus: { inComposerStop: boolean; turnRunning: boolean }
): boolean {
  if (keystroke.key !== 'Escape' || keystroke.isComposing) return false
  return !(focus.inComposerStop && shouldInterruptOnKeyDown(keystroke, focus.turnRunning))
}

/** Capability belongs to the owning connection ack, never another host's last-written status. */
export function backgroundTaskStopSupported(status: ConnectionStatus | undefined, agent: WireAgent): boolean {
  return agent === 'claude' && status?.type === 'connected' &&
    status.ack.capabilities.includes(CAPABILITY_STOP_BACKGROUND_TASK)
}
