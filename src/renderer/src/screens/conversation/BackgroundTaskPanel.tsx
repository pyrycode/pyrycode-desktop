import { useCallback, useEffect, useMemo } from 'react'
import { CAPABILITY_STOP_BACKGROUND_TASK, type WireAgent } from '@shared/wire/types'
import { sessionStore, useSessionStore, selectStatusFor, type ConnectionStatus } from '../../store/sessionStore'
import { shouldInterruptOnKeyDown, type ComposerKeyEvent } from './composerSend'
import {
  backgroundTaskRosterStore,
  useBackgroundTaskRosterStore,
  selectPendingTaskStopsFor,
  selectRosterFor,
  selectFinishedTasksFor,
  type BackgroundTaskRosterEntry,
  type HeldBackgroundTask,
  type HeldBackgroundTaskProgress
} from '../../store/backgroundTaskRosterStore'

// #581: the background-task panel — the first reader of backgroundTaskRosterStore (#573), which has been
// shipped and unread since it landed. An openable surface listing the tasks the daemon holds alive for the
// open conversation, so work that outlives a turn has a home WITHOUT filling the chat with status rows:
// nothing here renders into the thread timeline, and nothing may (these frames carry no turn_id and
// deliberately never enter the timeline reducer).
//
// #581 shipped the shell: chrome, the three-way reading branch, and one row per task showing
// `description` + `taskType`. #582 added the two bounds the daemon reports and that shell showed neither
// of — the roster's cap (`entry.droppedTasks`) and each task's own cut fields (`task.truncatedFields`),
// so a bounded report no longer reads as a complete one. #583 added the last unread field — the held
// `latestUpdate` pair, the latest change claude reported about a task — so a long-running task shows
// progress rather than sitting there as a name. All three were already reachable on the `entry` prop,
// which is `selectRosterFor`'s return type exactly, so none needed a prop, type or store change.
//
// The update's cut report is a SECOND list, never merged with the task's own: it names a DIFFERENT
// vocabulary (`task_id` / `patch`) from the task's (`task_id` / `task_type` / `description`), which is
// why the store keeps them apart, and it is what keeps every list attributable back to the field it
// describes. Reading one for the other compiles, type-checks — both are `readonly string[] | null` — and
// never matches, which is the silent mis-wiring the crossover tests pin.
//
// It mounts NO data path. Unlike WorkspacePickerSheet (which mounts RecentWorkspacesData inside itself),
// the roster bridge is already app-wide — <BackgroundTaskRosterData /> is the seventh headless leaf in
// App.tsx — so a mount here would be a second, wrong write path. The app listener also settles stop
// waits; the separate button sends only its routing ids.
//
// #1634: the chrome is #580's drawing (Figma 565:2966): a NON-modal drawer on the right of the message
// area, with no scrim, so the thread scrolls and the composer takes input while it is open. It replaced
// the interim `.status-sheet__*` bottom sheet. Only the outermost wrapper is chrome — the rows and the
// branch copy carry their own `background-task-panel__*` classes and no positional CSS, so the list's own
// redraw can land without touching the wrapper, as this swap landed without touching the list.
//
// SECURITY: every `description` rendered here is, for `taskType: local_bash`, the literal command line
// claude ran — untrusted, model-influenced text the daemon bounds but does not sanitize. It is rendered as
// auto-escaped React children and NOTHING else: never dangerouslySetInnerHTML, never into an attribute
// (not even `title=`), never an `href`/`src`, never a React key, never parsed, never executed or re-shelled.
// The rows stay non-interactive list items. Only the separate Stop task button sends the two routing
// ids; task ids never reach a log, attribute or key beyond the existing row key. And the LIST shape is not an
// invitation: `entry.tasks` is iterated once into `<li>` children, and the only thing derived from it is
// #1635's Running / Finished partition by id — no join, no clipboard, no export, no `data-*` attribute
// carrying a task field (the obligation the store's own header names this ticket as inheriting).
//
// #583: `latestUpdate.patch` is the SAME class of untrusted text under a structured-looking shape, and is
// rendered under every rule above — and "never parsed" is load-bearing for it specifically. The wire
// states that rule in the patch's own section rather than delegating it to the sibling's
// (types.ts:479-485) precisely because a patch LOOKS like something to parse, which makes it the more
// tempting thing to feed somewhere structured. It is also not guaranteed to be valid JSON (the daemon
// truncates it at construction, so a cut object no longer parses), and any future parse must sit behind
// an error branch falling back to this inert text and must enumerate no closed key set — a mapping
// listing the keys it knew would silently discard every key claude ships next. Rendering it as plain text
// answers the ticket in full and avoids the hazard entirely.

// Client-owned copy — no daemon string reaches these. Every literal is apostrophe-free:
// renderToStaticMarkup escapes ' → &#x27; (the standing desktop lesson), which would break the
// server-render assertions.
const BACKGROUND_TASK_PANEL_TITLE = 'Background tasks'
// The two non-populated readings read as DIFFERENT sentences, not one sentence in two places: half of
// "must not collapse into one another" is the copy, the other half is the distinct class below.
const BACKGROUND_TASK_PANEL_UNOBSERVED_COPY = 'No background-task report yet'
const BACKGROUND_TASK_PANEL_EMPTY_COPY = 'No background tasks'
// #1635: each reading's support line, drawn under its heading (Figma 565:2341 and 565:2327). A sibling of
// the heading, never inside it, so the heading element still holds the heading copy alone.
const BACKGROUND_TASK_PANEL_UNOBSERVED_SUPPORT =
  'The daemon has not reported on this conversation since the app connected.'
// #1656: the observed-empty line names the conversation's agent, selected by it and never interpolated.
const BACKGROUND_TASK_PANEL_EMPTY_SUPPORT =
  'Claude has nothing running in the background for this conversation.'
const BACKGROUND_TASK_PANEL_EMPTY_SUPPORT_CODEX =
  'Codex has nothing running in the background for this conversation.'

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

/** #582: the partial-list notice, built from the entry's dropped count. The parenthesised-count shape is
 *  `tabCountLabel`'s idiom (archiveViewModel.ts:47-49) and is chosen to DODGE PLURALISATION: "1 not shown"
 *  and "3 not shown" both read correctly, so there is no singular/plural branch and the repo gains no
 *  pluralisation machinery it does not already have. Apostrophe-free, like every literal in this file.
 *
 *  `droppedTasks` is a number, so this renders no untrusted string — it is the only daemon-derived VALUE
 *  the panel shows, and numbers are inert.
 *
 *  Deliberately does NOT print the true roster size (`tasks.size + droppedTasks`): the reader can see the
 *  rows, and a derived total is a second number to keep honest for no stated need. */
function partialListCopy(droppedTasks: number): string {
  return `Partial list (${droppedTasks} not shown)`
}

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
//
// #1635: `finishedTaskIds` is `selectFinishedTasksFor`'s return type. It only splits the populated arm into
// a Running and a Finished group, so the three-way branch above is unchanged. Optional, with `null`
// meaning "nothing finished", the same reading the pill's count takes when the key is absent.
export function BackgroundTaskPanelView({
  entry,
  finishedTaskIds = null,
  agent = 'claude',
  pendingTaskIds = null,
  onStopTask,
  onClose
}: {
  entry: BackgroundTaskRosterEntry | null
  finishedTaskIds?: ReadonlySet<string> | null
  /** #1656 — the conversation's agent; absent reads Claude. */
  agent?: WireAgent
  pendingTaskIds?: ReadonlySet<string> | null
  onStopTask?: (taskId: string) => void
  onClose: () => void
}): JSX.Element {
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
          {/* #582: the partial-list notice, a SIBLING of the branch below rather than a child of any of
              its arms. That placement is the acceptance criterion, not a style choice: the count belongs
              to the ENTRY, not to the list, so a present entry reporting dropped tasks must show it
              whichever branch the list itself takes. A present entry with dropped tasks and zero carried
              tasks takes the MIDDLE arm, where a notice written inside the populated arm would be
              invisible — the daemon cannot currently produce that combination (the cap drops only beyond
              8 carried rows), but the view is a pure function of its prop and a test constructs it
              directly, so "unreachable daemon-side" is not an answer.

              A boolean comparison, never `{entry.droppedTasks && …}`: React renders the number `0` as a
              text node, so the truthiness form would print a bare `0` into the panel on every
              non-truncated roster. `0` is a value here, never consulted for truthiness
              (backgroundTaskRosterStore.ts:164-165). And `> 0` rather than `!== 0`, because
              `requireNumber` upstream does not range-check: a nonsense negative count degrades to "no
              notice" rather than to "Partial list (-1 not shown)". That is a comparison choice, not a
              validation branch — nothing has been observed producing one, so none is added. */}
          {entry !== null && entry.droppedTasks > 0 && (
            // #1635: the drawn notice — a filled chip with a dot, at the top of the body, before either
            // group. The dot is decoration, so the notice still reads as its one sentence.
            <p className="background-task-panel__partial">
              <span className="background-task-panel__partial-dot" aria-hidden="true" />
              {partialListCopy(entry.droppedTasks)}
            </p>
          )}
          {entry === null ? (
            // #1635: each reading is the drawn centred column — ring, heading, support line — and they
            // stay apart in copy, class AND ring: dashed for never reported, solid for observed empty.
            <div className="background-task-panel__reading">
              <ReadingRing variant="dashed" />
              <p className="background-task-panel__unobserved">
                {BACKGROUND_TASK_PANEL_UNOBSERVED_COPY}
              </p>
              <p className="background-task-panel__reading-support">
                {BACKGROUND_TASK_PANEL_UNOBSERVED_SUPPORT}
              </p>
            </div>
          ) : entry.tasks.size === 0 ? (
            <div className="background-task-panel__reading">
              <ReadingRing variant="solid" />
              <p className="background-task-panel__empty">{BACKGROUND_TASK_PANEL_EMPTY_COPY}</p>
              <p className="background-task-panel__reading-support">
                {agent === 'codex' ? BACKGROUND_TASK_PANEL_EMPTY_SUPPORT_CODEX : BACKGROUND_TASK_PANEL_EMPTY_SUPPORT}
              </p>
            </div>
          ) : (
            <TaskGroups tasks={[...entry.tasks.values()]} finishedTaskIds={finishedTaskIds}
              pendingTaskIds={pendingTaskIds} onStopTask={agent === 'claude' ? onStopTask : undefined} />
          )}
      </div>
    </section>
  )
}

/** #1635: the populated arm — a Running group, then a Finished group, each in roster order. A row is
 *  finished when its id is in the conversation's finished set. The partition is the only thing derived
 *  from the list: no task field is read to make it, and each count is the number of rows drawn, so a
 *  dropped task (which has no row) is counted by the partial-list notice alone. An empty group renders
 *  nothing, header included. */
function TaskGroups({
  tasks,
  finishedTaskIds,
  pendingTaskIds,
  onStopTask
}: {
  tasks: readonly HeldBackgroundTask[]
  finishedTaskIds: ReadonlySet<string> | null
  pendingTaskIds: ReadonlySet<string> | null
  onStopTask?: (taskId: string) => void
}): JSX.Element {
  const isFinished = (task: HeldBackgroundTask): boolean => finishedTaskIds?.has(task.taskId) === true
  const running = tasks.filter((task) => !isFinished(task))
  const finished = tasks.filter(isFinished)
  return (
    <div className="background-task-panel__groups">
      {running.length > 0 && (
        <TaskGroup label={BACKGROUND_TASK_PANEL_RUNNING_LABEL} tasks={running} finished={false}
          pendingTaskIds={pendingTaskIds} onStopTask={onStopTask} />
      )}
      {finished.length > 0 && (
        <TaskGroup label={BACKGROUND_TASK_PANEL_FINISHED_LABEL} tasks={finished} finished={true} pendingTaskIds={null} />
      )}
    </div>
  )
}

function TaskGroup({
  label,
  tasks,
  finished,
  pendingTaskIds,
  onStopTask
}: {
  label: string
  tasks: readonly HeldBackgroundTask[]
  finished: boolean
  pendingTaskIds: ReadonlySet<string> | null
  onStopTask?: (taskId: string) => void
}): JSX.Element {
  return (
    <section className="background-task-panel__group">
      <h3 className="background-task-panel__group-header">{`${label} · ${tasks.length}`}</h3>
      {/* A <ul>/<li>, the honest semantics for "one entry per task" — and NOT interactive rows: only the
          separate button can ask for a stop. */}
      <ul className="background-task-panel__list">
        {tasks.map((task) => (
          // key = taskId: unique by map-key construction. The description is never a key — a key is not
          // a place for untrusted text.
          <TaskRow key={task.taskId} task={task} finished={finished}
            pending={pendingTaskIds?.has(task.taskId) === true} onStopTask={onStopTask} />
        ))}
      </ul>
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
function TaskRow({ task, finished, pending, onStopTask }: {
  task: HeldBackgroundTask
  finished: boolean
  pending: boolean
  onStopTask?: (taskId: string) => void
}): JSX.Element {
  const trimmedDescription = task.description.trim()
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
        <TaskStatusTag status={task.status} />
      </div>
      {wasCut(task.truncatedFields, CUT_FIELD_TASK_TYPE) && (
        <span className="background-task-panel__cut-type">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      <span className={descriptionClass}>{task.description}</span>
      {wasCut(task.truncatedFields, CUT_FIELD_DESCRIPTION) && (
        <span className="background-task-panel__cut-description">{BACKGROUND_TASK_PANEL_CUT_COPY}</span>
      )}
      {/* #1639: the summary claude sent with the terminal status, on a finished row only — the group,
          not the held record, decides that, so a running row never shows one. An empty summary draws
          no line, and its cut chip follows it straight after, reading the SUMMARY's own list.
          Summaries repeating a non-empty description hide both the line and its chip. */}
      {finished && task.summary !== null && task.summary.text !== '' &&
        (trimmedDescription === '' || !task.summary.text.trim().includes(trimmedDescription)) && (
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
 *  of the four constants above, so the word never reaches an attribute. It chooses the tag only: which
 *  group a row sits in is `finishedTaskIds`'s call, so an unknown word stays in Running. */
function TaskStatusTag({ status }: { status: string | null }): JSX.Element {
  const known = status === null ? undefined : TASK_STATUS_TAGS.get(status)
  const className = status === null ? TASK_TAG_RUNNING_CLASS : (known?.className ?? TASK_TAG_UNKNOWN_CLASS)
  return (
    <span className={className}>
      <span className="background-task-panel__tag-dot" aria-hidden="true" />
      {status === null ? BACKGROUND_TASK_PANEL_RUNNING_LABEL : (known?.label ?? status)}
    </span>
  )
}

/** #1635: the empty readings' 28px ring, drawn inline like the close glyph so the markup carries no
 *  `<img>`. The stroke and its dashes come from the stylesheet. */
function ReadingRing({ variant }: { variant: 'dashed' | 'solid' }): JSX.Element {
  return (
    <svg
      className={`background-task-panel__ring background-task-panel__ring--${variant}`}
      viewBox="0 0 28 28"
      width="28"
      height="28"
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="11" />
    </svg>
  )
}

// #581: the panel's thin interaction container (the WorkspacePickerSheet container idiom minus its bridge
// mount; the app listener owns stop settlement). It reads the roster
// store for one conversation and attaches an Escape document-listener. In-file, exported at the foot.
//
// `conversationId` rather than the whole ConversationCreatedPayload: the id is all this needs. The `''`
// sentinel for no active conversation matches no key, so `selectRosterFor` returns null = "never observed",
// which is the correct reading and needs no extra branch (the idiom `ConversationScreen`'s own queued-backlog
// read carries, since #1009 retired the control this used to name).
function BackgroundTaskPanel({
  conversationId,
  serverId,
  turnRunning,
  agent,
  onClose
}: {
  conversationId: string | null
  serverId: string | null
  turnRunning: boolean
  agent?: WireAgent
  onClose: () => void
}): JSX.Element {
  // A useMemo-stable selector per id (`ConversationScreen`'s `selectOpenBacklog`) so a fresh closure per render does not
  // churn the subscription. The selector returns the HELD ENTRY ITSELF, never a fresh object, so a write for
  // a DIFFERENT conversation leaves this entry Object.is-identical → no re-render. Nothing here wraps,
  // copies, or derives from the result, which is what keeps that true.
  const selectRoster = useMemo(() => selectRosterFor(conversationId ?? ''), [conversationId])
  const entry = useBackgroundTaskRosterStore(selectRoster)
  // #1635: the finished ids that split the list into groups — the held set or null, so it too leaves
  // this component alone on a write for another conversation.
  const selectFinished = useMemo(() => selectFinishedTasksFor(conversationId ?? ''), [conversationId])
  const finishedTaskIds = useBackgroundTaskRosterStore(selectFinished)
  const selectPending = useMemo(() => selectPendingTaskStopsFor(conversationId ?? ''), [conversationId])
  const pendingTaskIds = useBackgroundTaskRosterStore(selectPending)
  const supported = useSessionStore(state => serverId !== null &&
    backgroundTaskStopSupported(selectStatusFor(serverId)(state), agent ?? 'claude'))
  const onStopTask = useCallback((taskId: string): void => {
    if (conversationId === null || serverId === null ||
        !backgroundTaskStopSupported(selectStatusFor(serverId)(sessionStore.getState()), agent ?? 'claude')) return
    if (!backgroundTaskRosterStore.getState().beginTaskStop(conversationId, taskId)) return
    window.pyry.sendCommand({ type: 'stopBackgroundTask', payload: {
      conversation_id: conversationId, task_id: taskId
    } })
  }, [conversationId, serverId, agent])
  useEffect(() => {
    // #1634: a CAPTURE listener on `document`, which runs before React's root listener and before any
    // bubble-phase document listener. A press the drawer takes is stopped right here, so the options
    // overlay, the type-ahead and every other Escape claimant never see it: one Escape does one thing.
    // A press it yields travels on untouched, which is how the composer's #1072 stop still works with
    // the drawer open. The panel only mounts while open, so the listener lives exactly as long as it.
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
  return <BackgroundTaskPanelView entry={entry} finishedTaskIds={finishedTaskIds} agent={agent}
    pendingTaskIds={pendingTaskIds} onStopTask={supported ? onStopTask : undefined} onClose={onClose} />
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

export { BackgroundTaskPanel }

/** Capability belongs to the owning connection ack, never another host's last-written status. */
export function backgroundTaskStopSupported(status: ConnectionStatus | undefined, agent: WireAgent): boolean {
  return agent === 'claude' && status?.type === 'connected' &&
    status.ack.capabilities.includes(CAPABILITY_STOP_BACKGROUND_TASK)
}
