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
const CUT_FIELD_TASK_TYPE = 'task_type' // held as `taskType`; the WIRE name is what the list carries
// #583: the UPDATE's vocabulary, not the task's — matched against `latestUpdate.truncatedFields` and
// against nothing else. No casing trap on this one (wire name === held name again, the same coincidence
// `description` enjoys), so the trap available here is the OTHER one: passing the wrong LIST. Keeping it
// beside its siblings as a named constant is what makes the three call sites read as three pairings.
const CUT_FIELD_PATCH = 'patch'

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
            <p className="background-task-panel__partial">{partialListCopy(entry.droppedTasks)}</p>
          )}
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
                      the list when it stops appearing in the roster.

                      #582: each cut marker sits IMMEDIATELY AFTER the field it describes, so position
                      carries the attribution — no id / aria-describedby pair built from `taskId`, which
                      is a daemon string and is a React key (never rendered), not a rendered attribute.
                      The row is flex-direction: column, so each marker lands on its own line for free.

                      The marker is a SIBLING ELEMENT holding a client-owned constant, never text
                      concatenated into the field span: `{task.description}{cut && ' (truncated)'}` would
                      fuse client copy and daemon text into one node, so a description ending in those
                      same words would be indistinguishable from the app's own claim. And nothing here
                      slices, measures, re-joins or re-sinks the field to produce the marker — it marks
                      text that is already rendered inertly and stays inert itself.

                      The field NAMES are matched, never displayed: no `truncatedFields` element reaches
                      the markup (a `.join(', ')` display is the obvious first design and is forbidden on
                      both counts — it renders daemon strings, and it breaks the shell's sentinel test). */}
                  <span className="background-task-panel__description">{task.description}</span>
                  {wasCut(task.truncatedFields, CUT_FIELD_DESCRIPTION) && (
                    <span className="background-task-panel__cut-description">
                      {BACKGROUND_TASK_PANEL_CUT_COPY}
                    </span>
                  )}
                  <span className="background-task-panel__type">{task.taskType}</span>
                  {wasCut(task.truncatedFields, CUT_FIELD_TASK_TYPE) && (
                    <span className="background-task-panel__cut-type">
                      {BACKGROUND_TASK_PANEL_CUT_COPY}
                    </span>
                  )}
                  {/* #583: the latest change claude reported about this task. Last in the row, so the
                      identity fields stay at the top and each marker keeps sitting immediately after
                      the field it describes.

                      The branch is on `latestUpdate !== null`, and the empty patch is a reading BENEATH
                      it — never `{task.latestUpdate?.patch && …}` or any other truthiness test on the
                      patch. `patch: ''` is a VALUE ("claude reported no change"; the wire field has no
                      omitempty), so a truthiness test renders it EXACTLY as a never-updated task: it
                      compiles, type-checks, and breaks no test. That is #582's `{entry.droppedTasks &&
                      …}` trap one field over and quieter — `0` at least printed a visible bare `0`,
                      whereas `''` renders as nothing at all, leaving the collapse no trace in the markup.

                      Three readings, and the never-updated one renders NOTHING — a deliberate divergence
                      from the branch above, where each reading has its own element because the branch IS
                      the whole panel body and null would read as broken. A row still shows a description
                      and a type, so absence is legible here, and a per-row "not updated yet" line would
                      be noise on the ordinary case. What must not happen is the COLLAPSE, not the
                      absence: the empty-patch reading renders an element the never-updated one does not.

                      The cut marker is a SIBLING of the two arms, inside the null guard rather than
                      inside the non-empty arm — the same placement rule #582's notice carries, for the
                      same reason: the cut report is a property of the update RECORD, not of the patch's
                      emptiness. A recorded `{ patch: '', truncatedFields: ['patch'] }` is unreachable
                      daemon-side today (the 4 KiB cap never cuts to zero length) but is directly
                      constructible against a pure view, and a marker written inside the non-empty arm
                      would be invisible in exactly that state — the panel would claim "no change
                      reported" while the daemon said it cut the patch. Presenting an incomplete thing as
                      complete is what AC3 forbids, and "unreachable daemon-side" is not an answer for a
                      pure function of its prop.

                      It reads `task.latestUpdate.truncatedFields` and the description / type markers
                      above read `task.truncatedFields`, and the crossover is the silent mis-wiring here:
                      both lists are `readonly string[] | null`, so either swap compiles, type-checks and
                      never matches, because neither list names the other's fields. Nothing here reads the
                      patch TEXT to produce the marker either — no slice, no measure, no ellipsis, no
                      re-join — and the cut report is never cross-checked against the patch in either
                      direction: it reports the cap cut ONLY, while the daemon also scrubs invalid UTF-8
                      by deletion, so the two genuinely can disagree (types.ts:474-477). */}
                  {task.latestUpdate !== null && (
                    <>
                      {task.latestUpdate.patch === '' ? (
                        <span className="background-task-panel__no-change">
                          {BACKGROUND_TASK_PANEL_NO_CHANGE_COPY}
                        </span>
                      ) : (
                        <span className="background-task-panel__patch">
                          {task.latestUpdate.patch}
                        </span>
                      )}
                      {wasCut(task.latestUpdate.truncatedFields, CUT_FIELD_PATCH) && (
                        <span className="background-task-panel__cut-patch">
                          {BACKGROUND_TASK_PANEL_CUT_COPY}
                        </span>
                      )}
                    </>
                  )}
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
// which is the correct reading and needs no extra branch (the idiom `ConversationScreen`'s own queued-backlog
// read carries, since #1009 retired the control this used to name).
function BackgroundTaskPanel({
  conversationId,
  onClose
}: {
  conversationId: string | null
  onClose: () => void
}): JSX.Element {
  // A useMemo-stable selector per id (`ConversationScreen`'s `selectOpenBacklog`) so a fresh closure per render does not
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
