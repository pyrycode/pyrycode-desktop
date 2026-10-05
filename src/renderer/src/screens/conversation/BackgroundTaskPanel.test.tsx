import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BackgroundTaskPanelView,
  drawerClosesOnKeyDown,
  formatTaskProgressCounts
} from './BackgroundTaskPanel'
import type {
  BackgroundTaskRosterEntry,
  HeldBackgroundTask,
  HeldBackgroundTaskProgress
} from '../../store/backgroundTaskRosterStore'

// #581: the background-task panel. BackgroundTaskPanelView is the pure, exported view (the
// WorkspacePickerSheetView pattern) — server-render it with an injected `entry` (no store) to prove the
// chrome, the three selectRosterFor readings, the two rendered fields per row, and the untrusted-string
// escaping. The interaction container (the useMemo selector, the store read, the Escape effect) is
// untested reviewed glue — exactly like the WorkspacePickerSheet container — since the `node` env fires
// no clicks and runs no effects.
const noop = (): void => {}

function task(overrides: Partial<HeldBackgroundTask> = {}): HeldBackgroundTask {
  return {
    taskId: 'task-1',
    toolCallId: null,
    taskType: 'local_bash',
    description: 'npm run build',
    truncatedFields: null,
    latestUpdate: null,
    status: null,
    summary: null,
    progress: null,
    ...overrides
  }
}

// The held entry as the store builds it: a Map keyed by taskId, in the given (roster) order.
function entry(tasks: readonly HeldBackgroundTask[], droppedTasks = 0): BackgroundTaskRosterEntry {
  return { tasks: new Map(tasks.map((t) => [t.taskId, t])), droppedTasks }
}

describe('BackgroundTaskPanelView — the background-task panel (#581)', () => {
  it('renders the non-modal drawer chrome, under a title id distinct from the other three (#1634 AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([])} onClose={noop} />
    )
    // #1634: a NON-modal dialog. The role stays, so the panel is still found by role and name, but
    // aria-modal goes with the scrim: the thread and the composer stay usable while it is open.
    expect(markup).toContain('role="dialog"')
    expect(markup).not.toContain('aria-modal')
    expect(markup).toContain('aria-labelledby="background-task-panel-title"')
    expect(markup).toContain('id="background-task-panel-title"')
    // The drawer's own chrome, and none of the modal sheet's: no scrim, no handle, no status-sheet class.
    expect(markup).toContain('class="background-task-drawer"')
    expect(markup).toContain('background-task-drawer__header')
    expect(markup).toContain('background-task-drawer__rule')
    expect(markup).toContain('background-task-drawer__body')
    expect(markup).not.toContain('status-sheet')
    expect(markup).not.toContain('scrim')
    expect(markup).toContain('Background tasks')
    expect(markup).toContain('aria-label="Close"')
    // The id is distinct from the three existing ones, so all four can coexist without duplicate ids.
    expect(markup).not.toContain('channel-info-sheet-title')
    expect(markup).not.toContain('workspace-picker-sheet-title')
  })

  it('lists one row per held task in roster order, showing its description and taskType (AC3)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ taskId: 't1', description: 'npm run build', taskType: 'local_bash' }),
          task({ taskId: 't2', description: 'index the repository', taskType: 'agent_search' })
        ])}
        onClose={noop}
      />
    )
    expect(markup.match(/background-task-panel__row/g)?.length ?? 0).toBe(2)
    expect(markup).toContain('npm run build')
    expect(markup).toContain('<span class="background-task-panel__type">Command</span>')
    expect(markup).toContain('index the repository')
    expect(markup).toContain('<span class="background-task-panel__type">Agent search</span>')
    // Roster order — the held Map preserves insertion order, and the view iterates values() as-is.
    expect(markup.indexOf('npm run build')).toBeLessThan(markup.indexOf('index the repository'))
  })

  it('renders no task field beyond description, taskType and the held patch (AC3)', () => {
    // Distinctive sentinels rather than realistic values: a realistic truncated_fields entry
    // (`description`) would collide with other copy.
    //
    // #582 revised this test rather than fighting it. It was written with `droppedTasks: 987654` and an
    // assertion that the count never rendered — true of the shell, FALSE the moment #582 renders the
    // partial-list notice AC1 asks for. The fixture now passes `0` (which must render no notice) and the
    // count assertion is gone: the dropped count has its own tests below, and this test is about TASK
    // fields, which is what its name claims. `SENTINELTASKCUT` stays, and now guards AC5 as well — it is
    // an unrecognised truncated-field name, so it must render no marker AND never reach the markup.
    //
    // #583 revised it the same way, one field over. `not.toContain('SENTINELPATCH')` was true of the
    // shell — which left `latestUpdate` deliberately unread — and is FALSE the moment #583's AC1 renders
    // the patch, so that one line is gone; the patch has its own tests below. `SENTINELPATCHCUT` STAYS
    // and is now a live guard for #583's AC3: an unrecognised patch-cut name must mark nothing and must
    // never be displayed. It is deliberately NOT flipped into a positive `toContain('SENTINELPATCH')` —
    // `SENTINELPATCH` is a PREFIX SUBSTRING of `SENTINELPATCHCUT`, so that "proof" would also pass on a
    // render displaying only the forbidden cut-field name. The #583 fixtures below use non-overlapping
    // values for exactly that reason.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry(
          [
            task({
              toolCallId: 'SENTINELTOOLCALL',
              truncatedFields: ['SENTINELTASKCUT'],
              latestUpdate: { patch: 'SENTINELPATCH', truncatedFields: ['SENTINELPATCHCUT'] }
            })
          ],
          0
        )}
        onClose={noop}
      />
    )
    expect(markup).not.toContain('SENTINELTOOLCALL')
    expect(markup).not.toContain('SENTINELTASKCUT')
    expect(markup).not.toContain('SENTINELPATCHCUT')
  })

  it('keeps the three selectRosterFor readings structurally distinct (AC4)', () => {
    // (1) key absent → null: no background-task frame has ever arrived. Its own element, its own copy.
    const unobserved = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={null} onClose={noop} />
    )
    expect(unobserved).toContain('background-task-panel__unobserved')
    expect(unobserved).toContain('No background-task report yet')
    expect(unobserved).not.toContain('background-task-panel__empty')
    expect(unobserved).not.toContain('background-task-panel__row')

    // (2) a present entry holding no tasks → the daemon says nothing is alive. A DIFFERENT element and
    // a different sentence — the collapse the store's `?? null` refuses to make must not reappear here.
    const observedEmpty = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([])} onClose={noop} />
    )
    expect(observedEmpty).toContain('background-task-panel__empty')
    expect(observedEmpty).toContain('No background tasks')
    expect(observedEmpty).not.toContain('background-task-panel__unobserved')
    expect(observedEmpty).not.toContain('background-task-panel__row')
    expect(observedEmpty).not.toBe(unobserved)

    // (3) populated → rows, and neither non-populated element.
    const populated = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task()])} onClose={noop} />
    )
    expect(populated).toContain('background-task-panel__row')
    expect(populated).not.toContain('background-task-panel__unobserved')
    expect(populated).not.toContain('background-task-panel__empty')
  })

  it('renders an untrusted description and taskType escaped, as inert text (AC5)', () => {
    // For taskType local_bash the description IS the literal command line claude ran — untrusted,
    // model-influenced text. No apostrophes in the fixture: renderToStaticMarkup escapes ' → &#x27;.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ description: '<img src=x onerror="alert(1)">', taskType: 'a<b&c' })
        ])}
        onClose={noop}
      />
    )
    expect(markup).toContain('&lt;img')
    expect(markup).toContain('A&lt;b&amp;c')
    // The tag never opens: `<` is escaped, so the description cannot become an element.
    expect(markup).not.toContain('<img')
    // The structural guard — attribute-SHAPED, not substring-shaped. React escapes markup
    // metacharacters, not arbitrary text, so the escaped description still contains `src=` and
    // `onerror=` as inert characters and asserting their bare absence would fail on a CORRECT render
    // (the same trap `not.toContain('javascript:')` sets, generalised). What a task field can never
    // produce is a real ATTRIBUTE: renderToStaticMarkup always quotes attribute values and escapes
    // `"` → `&quot;`, so a quoted attribute is unforgeable from escaped text. Asserting no quoted URL
    // attribute and no quoted inline handler across the WHOLE markup therefore fails on any future
    // attribute placement anywhere in the panel — not just on the two fields fed here. The panel's one
    // inline SVG carries none of them.
    expect(markup).not.toContain('href="')
    expect(markup).not.toContain('src="')
    expect(markup).not.toMatch(/\son[a-z]+="/)
  })
})

// #582: the two bounds the daemon reports and the shell showed neither of — the roster's cap
// (`entry.droppedTasks`) and each task's own cut fields (`task.truncatedFields`). Both states are
// directly constructible from the shell's `entry(tasks, droppedTasks)` / `task(overrides)` helpers above,
// which is what they were built for; no fixture changes were needed.
describe('BackgroundTaskPanelView — a capped roster and cut task text (#582)', () => {
  it('shows how many tasks are not shown, with the list still there (AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task()], 3)} onClose={noop} />
    )
    expect(markup).toContain('background-task-panel__partial')
    expect(markup).toContain('Partial list (3 not shown)')
    // The notice is ADDITIONAL to the rows, not instead of them: a capped roster still lists what it
    // carries. The count reads as "not shown", so the true roster size stays derivable without the panel
    // printing a second number it would have to keep honest.
    expect(markup).toContain('background-task-panel__row')
  })

  it('reads the notice on droppedTasks alone, whichever branch the list takes (AC1)', () => {
    // The scope clause, and the reason the notice is a SIBLING of the three-way ternary rather than a
    // child of its populated arm. The count belongs to the ENTRY, not to the list.

    // (a) populated — the ordinary case.
    const populated = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task()], 3)} onClose={noop} />
    )
    expect(populated).toContain('background-task-panel__partial')

    // (b) a present entry carrying NO tasks but reporting dropped ones. The shipped branch order sends
    // this to the middle (`tasks.size === 0`) arm, so a notice written inside the populated arm would be
    // invisible in exactly this state. The daemon cannot currently produce the combination — the cap
    // drops only beyond 8 carried rows — but the view is a pure function of its prop and this test
    // constructs it directly, so "unreachable daemon-side" is not an answer. This assertion is what pins
    // the notice outside the ternary.
    const emptyButCapped = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([], 3)} onClose={noop} />
    )
    expect(emptyButCapped).toContain('background-task-panel__partial')
    expect(emptyButCapped).toContain('Partial list (3 not shown)')
    expect(emptyButCapped).toContain('background-task-panel__empty')

    // (c) no entry at all — there is no count, so there is no notice. The notice must not be a claim the
    // app makes on its own; it reports a number the daemon sent.
    const unobserved = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={null} onClose={noop} />
    )
    expect(unobserved).not.toContain('background-task-panel__partial')
    expect(unobserved).not.toContain('not shown')
  })

  it('renders no partial-list notice when droppedTasks is 0 (AC2)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task()], 0)} onClose={noop} />
    )
    expect(markup).not.toContain('background-task-panel__partial')
    // A notice smuggled in under some other class, or with the count rendered alone.
    expect(markup).not.toContain('not shown')
    // The `{entry.droppedTasks && …}` truthiness form, which React renders as a bare `0` text node at the
    // top of the body — silently, on EVERY non-truncated roster. `0` is a value here, never consulted
    // for truthiness (the store says so at backgroundTaskRosterStore.ts:164-165), and this is that rule
    // at a render site. Anchored on the body's opening tag rather than asserting `not.toContain('0')`,
    // which a digit anywhere in the chrome would make meaningless.
    expect(markup).not.toContain('background-task-drawer__body">0')
  })

  it('marks a rendered field the daemon names as cut, and only that field (AC3)', () => {
    const cutDescription = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ truncatedFields: ['description'] })])}
        onClose={noop}
      />
    )
    expect(cutDescription).toContain('background-task-panel__cut-description')
    expect(cutDescription).toContain('Truncated by the daemon')
    // Two distinct classes, not one shared marker class, so a test can prove WHICH field was marked.
    expect(cutDescription).not.toContain('background-task-panel__cut-type')

    // The mirror — and the WIRE name `task_type`, not the held `taskType`. See the trap test below.
    const cutType = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ truncatedFields: ['task_type'] })])}
        onClose={noop}
      />
    )
    expect(cutType).toContain('background-task-panel__cut-type')
    expect(cutType).toContain('Truncated by the daemon')
    expect(cutType).not.toContain('background-task-panel__cut-description')

    // Both at once: the list names fields independently, so the markers are independent too.
    const cutBoth = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ truncatedFields: ['description', 'task_type'] })])}
        onClose={noop}
      />
    )
    expect(cutBoth).toContain('background-task-panel__cut-description')
    expect(cutBoth).toContain('background-task-panel__cut-type')
  })

  it('matches the WIRE field name, so the held camelCase name marks nothing (AC3)', () => {
    // The trap this ticket exists to defuse, as a test. The list's CONTENTS cross IPC unconverted — only
    // the field itself was camelCased (`truncatedFields: row.truncated_fields`,
    // backgroundTaskRosterStore.ts:328, and again at :351) — so the panel holds `task.taskType` but the
    // daemon writes `task_type`. Matching on `'taskType'` compiles, type-checks, never matches, and
    // fails no OTHER test: same silent-collapse family as the null-vs-[] distinction.
    //
    // This is also why `wasCut` is module-private and is not unit-tested: a predicate-level test passes
    // whatever name it is handed and would stay green while the CALL SITE passed the held name. The trap
    // lives at the call site, so the test does too.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ truncatedFields: ['taskType'] })])}
        onClose={noop}
      />
    )
    expect(markup).not.toContain('background-task-panel__cut-')
    // And the name itself never reaches the markup — a daemon string is matched, never displayed.
    expect(markup).not.toContain('taskType')
  })

  it('treats both null and [] as nothing-was-cut, and neither as an error (AC4)', () => {
    // Two DISTINCT renders rather than one parametrised assertion: the point is that the store keeps
    // these two values apart (`null` = nothing was cut, `[]` = a list naming no fields) and that the
    // panel handles each without collapsing, throwing, or rendering an error state for either.
    const nullFields = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ truncatedFields: null })])} onClose={noop} />
    )
    expect(nullFields).toContain('background-task-panel__row')
    expect(nullFields).not.toContain('background-task-panel__cut-')

    const emptyFields = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ truncatedFields: [] })])} onClose={noop} />
    )
    expect(emptyFields).toContain('background-task-panel__row')
    expect(emptyFields).not.toContain('background-task-panel__cut-')
  })

  it('ignores a field name it has no surface for, without failing (AC5)', () => {
    // The vocabulary is OPEN. A roster row names `task_id` / `task_type` / `description`, a started frame
    // adds `tool_call_id`, and the daemon may ship a name this panel has never heard of. The panel
    // renders a SUBSET of the named fields, so it marks the ones it renders and ignores the rest — an
    // exhaustive switch or a closed union would turn a valid future frame into a crash or a blank panel.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ truncatedFields: ['task_id', 'tool_call_id', 'SENTINELFUTUREFIELD'] })
        ])}
        onClose={noop}
      />
    )
    expect(markup).not.toContain('background-task-panel__cut-')
    // Never displayed, whether or not the panel recognises it.
    expect(markup).not.toContain('SENTINELFUTUREFIELD')
    expect(markup).not.toContain('task_id')
    // The row still renders normally — an unrecognised name is a valid value, not an error.
    expect(markup).toContain('background-task-panel__row')
    expect(markup).toContain('npm run build')
  })

  it('keeps marked untrusted text inert, with the marker and the notice both live (AC3, security)', () => {
    // The risk this slice uniquely introduces: a "mark this as cut" feature invites REPROCESSING the
    // text — slicing it, appending an ellipsis, re-joining it, or moving it into a `title=` tooltip. The
    // marker is a separate sibling element holding a client-owned constant, and the description is not
    // read, measured, sliced or concatenated to produce it. Rendered here with the marker AND the notice
    // both live, so the new paths are covered by the shell's own net rather than a narrower one.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry(
          [
            task({
              description: '<img src=x onerror="alert(1)">',
              truncatedFields: ['description']
            })
          ],
          2
        )}
        onClose={noop}
      />
    )
    expect(markup).toContain('background-task-panel__cut-description')
    expect(markup).toContain('background-task-panel__partial')
    expect(markup).toContain('&lt;img')
    expect(markup).not.toContain('<img')
    // The same attribute-SHAPED structural guards the shell uses, re-asserted across the whole markup so
    // they cover the marker path too. NOT bare-substring absences like `not.toContain('src=')`: React
    // escapes markup metacharacters, not arbitrary text, so those fail on a CORRECT render.
    expect(markup).not.toContain('href="')
    expect(markup).not.toContain('src="')
    expect(markup).not.toMatch(/\son[a-z]+="/)
  })
})

// #583: the latest change claude reported about a task — the held `latestUpdate` pair the shell named as
// this ticket's seam and left deliberately unread. Every state is constructible from the shell's
// `task(overrides)` / `entry(tasks, droppedTasks)` helpers above; no fixture changes were needed.
describe('BackgroundTaskPanelView — the latest reported change (#583)', () => {
  it('renders a markup-shaped patch as inert escaped text (AC1)', () => {
    // `patch` is untrusted, model-influenced daemon-relayed text whose keys may carry command text
    // exactly as `description` does — and its structured-looking shape makes it the MORE tempting thing
    // to feed somewhere structured (backgroundTaskRosterStore.ts:87-93 states the rule for this field
    // rather than inheriting the sibling's, for that reason). The same hostile fixture the description
    // is rendered with, so the two paths are held to one standard.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ latestUpdate: { patch: '<img src=x onerror="alert(1)">', truncatedFields: null } })
        ])}
        onClose={noop}
      />
    )
    expect(markup).toContain('background-task-panel__patch')
    expect(markup).toContain('&lt;img')
    // The tag never opens: `<` is escaped, so the patch cannot become an element.
    expect(markup).not.toContain('<img')
    // The shell's structural guards, attribute-SHAPED and asserted across the WHOLE markup, extended
    // over the patch path rather than replaced by a narrower net. NOT bare-substring absences like
    // `not.toContain('src=')` or `not.toContain('javascript:')`: React escapes markup metacharacters and
    // not arbitrary text, so the escaped patch still carries `src=` inertly and those would fail on a
    // CORRECT render. A quoted attribute is unforgeable from escaped text — renderToStaticMarkup always
    // quotes attribute values and escapes `"` → `&quot;` — so these fail on any attribute placement of
    // the patch anywhere in the panel, including a `title=` tooltip.
    expect(markup).not.toContain('href="')
    expect(markup).not.toContain('src="')
    expect(markup).not.toMatch(/\son[a-z]+="/)
  })

  it('keeps the three readings of the held field distinct (AC2)', () => {
    // (1) no update has ever matched this task. The row renders nothing for it — legitimate HERE, and a
    // deliberate divergence from #581's rule that each reading gets its own element: there the branch WAS
    // the whole panel body, so null read as broken, whereas a row still shows its description and type.
    // What AC2 forbids is the COLLAPSE, not the absence.
    const noUpdate = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ latestUpdate: null })])} onClose={noop} />
    )
    expect(noUpdate).toContain('background-task-panel__row')
    expect(noUpdate).toContain('npm run build')
    expect(noUpdate).not.toContain('background-task-panel__patch')
    expect(noUpdate).not.toContain('background-task-panel__no-change')

    // (2) a RECORDED empty patch: claude reported no change. `patch` always arrives on the wire (no
    // `omitempty`), so `''` is a VALUE, not an absence — its own element and its own client-owned copy.
    const emptyPatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ latestUpdate: { patch: '', truncatedFields: null } })])}
        onClose={noop}
      />
    )
    expect(emptyPatch).toContain('background-task-panel__no-change')
    expect(emptyPatch).toContain('No change reported')
    expect(emptyPatch).not.toContain('background-task-panel__patch')

    // (3) a reported change — the patch itself, and not the empty-patch element.
    const withPatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ latestUpdate: { patch: 'is_backgrounded true', truncatedFields: null } })
        ])}
        onClose={noop}
      />
    )
    expect(withPatch).toContain('background-task-panel__patch')
    expect(withPatch).toContain('is_backgrounded true')
    expect(withPatch).not.toContain('background-task-panel__no-change')

    // The collapse guard proper, and the reason this test exists. `{task.latestUpdate?.patch && …}` —
    // or ANY truthiness test on the patch — renders a recorded empty patch EXACTLY as a never-updated
    // task: it compiles, type-checks, and breaks no other test. It is #582's `{entry.droppedTasks && …}`
    // trap one field over and QUIETER — `0` at least printed a visible bare `0`, whereas `''` renders as
    // nothing at all, so under the truthiness form these two renders are byte-identical and the collapse
    // leaves no trace for another assertion to catch by accident. The branch is on `latestUpdate !== null`.
    expect(emptyPatch).not.toBe(noUpdate)
  })

  it('marks the patch as cut from the UPDATES list only, never the task list (AC3)', () => {
    // Non-overlapping fixture values throughout: `SENTINELPATCH` is a prefix substring of
    // `SENTINELPATCHCUT`, the collision the shell's revised test above documents.
    const cutPatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['patch'] } })])}
        onClose={noop}
      />
    )
    expect(cutPatch).toContain('background-task-panel__cut-patch')
    expect(cutPatch).toContain('Truncated by the daemon')
    // The marker is a SIBLING element, not text fused into the patch span: the patch still renders whole
    // and is not sliced, measured, ellipsized or re-joined to produce the mark.
    expect(cutPatch).toContain('PATCHTEXT')
    expect(cutPatch).not.toContain('background-task-panel__cut-description')
    expect(cutPatch).not.toContain('background-task-panel__cut-type')

    // The mirror: the same patch with nothing cut is presented as complete.
    const wholePatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null } })])}
        onClose={noop}
      />
    )
    expect(wholePatch).toContain('background-task-panel__patch')
    expect(wholePatch).not.toContain('background-task-panel__cut-')

    // CROSSOVER A — the TASK's own list names `patch`, which is not in the task's vocabulary
    // (`task_id` / `task_type` / `description`). `wasCut(task.truncatedFields, CUT_FIELD_PATCH)`
    // compiles, type-checks — both lists are `readonly string[] | null` — and never matches. Nothing
    // fails, which is why the crossover is asserted in both directions rather than assumed.
    const taskListNamesPatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({
            truncatedFields: ['patch'],
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null }
          })
        ])}
        onClose={noop}
      />
    )
    expect(taskListNamesPatch).not.toContain('background-task-panel__cut-')
    expect(taskListNamesPatch).toContain('PATCHTEXT')

    // CROSSOVER B — the sharpest of the five: the UPDATE's list names the TASK's fields, and both names
    // are live `CUT_FIELD_*` constants. This is exactly what fires if the description or task-type
    // marker is wired to `latestUpdate.truncatedFields` instead of the task's own list.
    const updateListNamesTaskFields = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({
            truncatedFields: null,
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['description', 'task_type'] }
          })
        ])}
        onClose={noop}
      />
    )
    expect(updateListNamesTaskFields).not.toContain('background-task-panel__cut-')
    expect(updateListNamesTaskFields).toContain('npm run build')
    expect(updateListNamesTaskFields).toContain('PATCHTEXT')

    // An unrecognised name in the update's list. The vocabulary is OPEN — the daemon may ship a name this
    // panel has never heard of — so it is a valid value, not an error: no marker, never displayed, and
    // the row and its patch still render.
    const unknownName = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['task_id', 'SENTINELFUTURENAME'] }
          })
        ])}
        onClose={noop}
      />
    )
    expect(unknownName).not.toContain('background-task-panel__cut-')
    expect(unknownName).not.toContain('SENTINELFUTURENAME')
    expect(unknownName).not.toContain('task_id')
    expect(unknownName).toContain('background-task-panel__row')
    expect(unknownName).toContain('PATCHTEXT')
  })

  it('presents no patch as a completion, a failure or any other terminal signal (AC4)', () => {
    // This frame family reports NO terminal event — the daemon reports no finish, so absence from a LATER
    // roster is the only removal path (HeldBackgroundTask:144-146). A completion or failure reading would
    // be a claim the wire cannot support, whether it came from copy or from a BEM state modifier (the
    // repo's terminal-state idiom is `--error`: .tool-row--error, .log-data__status--error). One regex
    // over the whole markup catches both, since a class named `__completed` contains the word too.
    //
    // Both benign fixtures carry no such word themselves, which is what makes the assertion safe — and is
    // why this test must NOT reuse the AC1 `onerror` payload. Both new displays are rendered here (a
    // recorded change with its cut marker, and a recorded empty patch) so the sweep covers all of the new
    // copy and classes at once.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({
            taskId: 't1',
            latestUpdate: { patch: 'is_backgrounded true', truncatedFields: ['patch'] }
          }),
          task({ taskId: 't2', latestUpdate: { patch: '', truncatedFields: null } })
        ])}
        onClose={noop}
      />
    )
    expect(markup).toContain('background-task-panel__patch')
    expect(markup).toContain('background-task-panel__cut-patch')
    expect(markup).toContain('background-task-panel__no-change')
    expect(markup).not.toMatch(/completed|complete|failed|failure|succeeded|success|finished|error/i)
  })
})

describe('BackgroundTaskPanelView — readable task types (#1746)', () => {
  it.each([
    ['local_agent', 'Agent'],
    ['local_bash', 'Command'],
    ['local_file_watch', 'File watch'],
    ['agent_search', 'Agent search'],
    ['remote_local_agent', 'Remote local agent'],
    ['local_local_agent', 'Local agent'],
    ['local', 'Local'],
    ['local_', ''],
    ['', '']
  ])('renders %j as %j without altering the held task', (taskType, label) => {
    const heldTask = Object.freeze(task({ taskType }))
    const heldEntry = entry([heldTask])
    const before = structuredClone(heldEntry)
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={heldEntry} onClose={noop} />
    )

    expect(markup).toContain(`<span class="background-task-panel__type">${label}</span>`)
    expect(heldEntry).toEqual(before)
    expect(heldEntry.tasks.get(heldTask.taskId)).toBe(heldTask)
    expect(heldTask.taskType).toBe(taskType)
  })

  it('keeps formatted unknown types escaped and confined to the type text', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ taskType: 'local_<b>file_watch</b>' })])}
        onClose={noop}
      />
    )
    expect(markup).toContain(
      '<span class="background-task-panel__type">&lt;b&gt;file watch&lt;/b&gt;</span>'
    )
    expect(markup).not.toContain('<b>')
    expect(markup).not.toMatch(/="[^"]*file watch/)
  })
})

// #1635: #580's drawing of the list inside the drawer body. The grouping reads the conversation's
// finished ids, passed in as a prop so every reading stays a static render.
describe('BackgroundTaskPanelView — the #580 list drawing (#1635)', () => {
  const mixed = entry([
    task({ taskId: 'r1', description: 'RUNNINGONE' }),
    task({ taskId: 'f1', description: 'FINISHEDONE' }),
    task({ taskId: 'r2', description: 'RUNNINGTWO' })
  ])

  it('splits rows into Running then Finished, in roster order, counting the rows drawn (AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={mixed} finishedTaskIds={new Set(['f1'])} onClose={noop} />
    )
    expect(markup).toContain('Running · 2')
    expect(markup).toContain('Finished · 1')
    const order = ['Running · 2', 'RUNNINGONE', 'RUNNINGTWO', 'Finished · 1', 'FINISHEDONE'].map((s) =>
      markup.indexOf(s)
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(markup.match(/background-task-panel__row--finished/g)?.length ?? 0).toBe(1)
  })

  it('counts no dropped task in either group; the notice reports them, above the groups (AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task()], 3)} finishedTaskIds={null} onClose={noop} />
    )
    expect(markup).toContain('Running · 1')
    expect(markup).toContain('Partial list (3 not shown)')
    expect(markup.indexOf('background-task-panel__partial')).toBeLessThan(markup.indexOf('Running · 1'))
  })

  it('draws no header for an empty group (AC1)', () => {
    const allRunning = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={mixed} finishedTaskIds={null} onClose={noop} />
    )
    expect(allRunning).toContain('Running · 3')
    expect(allRunning).not.toContain('Finished')
    // An id that names no listed task moves nothing.
    const staleId = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={mixed} finishedTaskIds={new Set(['gone'])} onClose={noop} />
    )
    expect(staleId).toContain('Running · 3')
    expect(staleId).not.toContain('Finished')
    const allFinished = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={mixed} finishedTaskIds={new Set(['r1', 'f1', 'r2'])} onClose={noop} />
    )
    expect(allFinished).toContain('Finished · 3')
    // The header only: a finished row with no status word still wears the Running tag (#1639).
    expect(allFinished).not.toContain('Running ·')
  })

  it('tags a row Running until a status word arrives, whichever group it sits in (#1639 AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ taskId: 'r1' }), task({ taskId: 'f1', status: 'completed' })])}
        finishedTaskIds={new Set(['f1'])}
        onClose={noop}
      />
    )
    expect(markup).toMatch(/background-task-panel__tag--running"><span[^>]*><\/span>Running</)
    expect(markup).toMatch(/background-task-panel__tag--completed"><span[^>]*><\/span>Completed</)
    expect(markup.match(/background-task-panel__tag--/g)?.length ?? 0).toBe(2)
  })

  it('sets a local_bash description in mono and other types in body text (AC2)', () => {
    const bash = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ taskType: 'local_bash' })])} onClose={noop} />
    )
    expect(bash).toContain('background-task-panel__description--mono')
    const agent = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ taskType: 'local_agent' })])} onClose={noop} />
    )
    expect(agent).toContain('background-task-panel__description')
    expect(agent).not.toContain('background-task-panel__description--mono')
  })

  it('puts the latest update under its label in a code block, and shows none for a never-updated row (AC2)', () => {
    const never = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([task({ latestUpdate: null })])} onClose={noop} />
    )
    expect(never).not.toContain('background-task-panel__update')
    expect(never).not.toContain('Latest update')

    const patched = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null } })])}
        onClose={noop}
      />
    )
    expect(patched).toContain('Latest update')
    expect(patched).toMatch(/background-task-panel__update-block"><span class="background-task-panel__patch">PATCHTEXT</)

    const empty = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ latestUpdate: { patch: '', truncatedFields: null } })])}
        onClose={noop}
      />
    )
    expect(empty).toContain('Latest update')
    expect(empty).toMatch(
      /background-task-panel__update-block"><span class="background-task-panel__no-change">No change reported</
    )
  })

  it('draws each empty reading with its own ring and support line (AC2)', () => {
    const unobserved = renderToStaticMarkup(<BackgroundTaskPanelView entry={null} onClose={noop} />)
    expect(unobserved).toContain('background-task-panel__ring--dashed')
    expect(unobserved).not.toContain('background-task-panel__ring--solid')
    expect(unobserved).toContain('The daemon has not reported on this conversation since the app connected.')

    const empty = renderToStaticMarkup(<BackgroundTaskPanelView entry={entry([])} onClose={noop} />)
    expect(empty).toContain('background-task-panel__ring--solid')
    expect(empty).not.toContain('background-task-panel__ring--dashed')
    expect(empty).toContain('Claude has nothing running in the background for this conversation.')
    // The heading element holds the heading copy alone, which the e2e toHaveText reads rely on.
    expect(empty).toContain('<p class="background-task-panel__empty">No background tasks</p>')
    expect(unobserved).toContain('<p class="background-task-panel__unobserved">No background-task report yet</p>')
  })

  it('names the conversation agent in the empty support line (#1656)', () => {
    const codex = renderToStaticMarkup(<BackgroundTaskPanelView entry={entry([])} agent="codex" onClose={noop} />)
    expect(codex).toContain('Codex has nothing running in the background for this conversation.')
    expect(codex).not.toContain('Claude')
    expect(renderToStaticMarkup(<BackgroundTaskPanelView entry={entry([])} agent="claude" onClose={noop} />))
      .toBe(renderToStaticMarkup(<BackgroundTaskPanelView entry={entry([])} onClose={noop} />))
  })

  it('keeps every daemon string inert across both groups, the tags and the code block (AC3)', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry(
          [
            task({ taskId: 'r1', description: hostile, taskType: hostile }),
            task({
              taskId: 'f1',
              description: hostile,
              taskType: 'local_bash',
              truncatedFields: ['description', 'task_type'],
              latestUpdate: { patch: hostile, truncatedFields: ['patch'] }
            })
          ],
          2
        )}
        finishedTaskIds={new Set(['f1'])}
        onClose={noop}
      />
    )
    expect(markup).toContain('&lt;img')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('href="')
    expect(markup).not.toContain('src="')
    expect(markup).not.toMatch(/\son[a-z]+="/)
    // The rows stay non-interactive: the drawer close is the only control.
    expect(markup.match(/<button/g)?.length ?? 0).toBe(1)
    expect(markup).not.toContain('tabindex')
  })
})

// #1634: the drawer does not take focus, so its Escape and the composer's #1072 Escape can meet on one
// key press. This is the whole arbitration as plain values: the container's capture listener asks it and
// either closes (and stops the press there) or lets the press through to the composer untouched.
describe('drawerClosesOnKeyDown — one Escape does one thing (#1634 AC3)', () => {
  const esc = { key: 'Escape', shiftKey: false, isComposing: false }
  it('closes on Escape with focus outside the composer, turn running or not', () => {
    expect(drawerClosesOnKeyDown(esc, { inComposerStop: false, turnRunning: false })).toBe(true)
    expect(drawerClosesOnKeyDown(esc, { inComposerStop: false, turnRunning: true })).toBe(true)
  })
  it('closes on Escape from the composer while no turn is running', () => {
    expect(drawerClosesOnKeyDown(esc, { inComposerStop: true, turnRunning: false })).toBe(true)
  })
  it('yields to the composer when its Escape will stop a running turn', () => {
    expect(drawerClosesOnKeyDown(esc, { inComposerStop: true, turnRunning: true })).toBe(false)
  })
  it('ignores every other key, and an Escape that ends an IME composition', () => {
    expect(drawerClosesOnKeyDown({ ...esc, key: 'Enter' }, { inComposerStop: false, turnRunning: false }))
      .toBe(false)
    expect(drawerClosesOnKeyDown({ ...esc, isComposing: true }, { inComposerStop: false, turnRunning: false }))
      .toBe(false)
  })
})

// #1639: the status word the tag draws and the summary a finished row shows. The group still comes from
// `finishedTaskIds` alone; the word only chooses the tag, by exact match against client constants.
describe('BackgroundTaskPanelView — status tag and summary (#1639)', () => {
  const tagOf = (status: string | null, finished: boolean): string =>
    renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ taskId: 't', status })])}
        finishedTaskIds={finished ? new Set(['t']) : null}
        onClose={noop}
      />
    )

  it('maps completed, failed and stopped to their own tags, Failed in the error style (AC1)', () => {
    expect(tagOf('completed', true)).toMatch(/background-task-panel__tag--completed"><span[^>]*><\/span>Completed</)
    expect(tagOf('failed', true)).toMatch(/background-task-panel__tag--failed"><span[^>]*><\/span>Failed</)
    expect(tagOf('stopped', true)).toMatch(/background-task-panel__tag--stopped"><span[^>]*><\/span>Stopped</)
    expect(tagOf(null, false)).toMatch(/background-task-panel__tag--running"><span[^>]*><\/span>Running</)
    // Exact match only: a near miss is an unknown word, never a borrowed Completed or Failed style.
    expect(tagOf('Failed', false)).toMatch(/background-task-panel__tag--stopped"><span[^>]*><\/span>Failed</)
  })

  it('draws an unknown word raw and escaped in the Stopped style, inside the Running group (AC1)', () => {
    const markup = tagOf('<b>paused</b>', false)
    expect(markup).toContain('Running · 1')
    expect(markup).not.toContain('Finished')
    expect(markup).toMatch(
      /background-task-panel__tag--stopped"><span[^>]*><\/span>&lt;b&gt;paused&lt;\/b&gt;</
    )
    expect(markup).not.toContain('<b>')
    // The word is a text child only: never a class, never any other attribute value.
    expect(markup).not.toMatch(/="[^"]*paused/)
    expect(markup.match(/background-task-panel__tag--/g)?.length ?? 0).toBe(1)
  })

  it('shows a finished row its summary under the description, with the chip when summary was cut (AC2)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({
            taskId: 'f1',
            description: 'DESCONE',
            status: 'failed',
            summary: { text: 'SUMMARYONE', truncatedFields: ['summary'] }
          }),
          task({
            taskId: 'f2',
            status: 'completed',
            summary: { text: 'SUMMARYTWO', truncatedFields: ['patch'] }
          })
        ])}
        finishedTaskIds={new Set(['f1', 'f2'])}
        onClose={noop}
      />
    )
    expect(markup).toMatch(/DESCONE<\/span><span class="background-task-panel__summary">SUMMARYONE<\/span><span class="background-task-panel__cut-summary">Truncated by the daemon</)
    expect(markup).toContain('<span class="background-task-panel__summary">SUMMARYTWO</span>')
    // Only the summary a frame named as cut gets the chip.
    expect(markup.match(/background-task-panel__cut-summary/g)?.length ?? 0).toBe(1)
  })

  it('shows no line for an empty summary and never a summary on a running row (AC2)', () => {
    const empty = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ taskId: 'f1', status: 'stopped', summary: { text: '', truncatedFields: null } })])}
        finishedTaskIds={new Set(['f1'])}
        onClose={noop}
      />
    )
    expect(empty).not.toContain('background-task-panel__summary')
    const running = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([
          task({ taskId: 'r1', status: 'paused', summary: { text: 'SUMMARYHIDDEN', truncatedFields: ['summary'] } })
        ])}
        finishedTaskIds={null}
        onClose={noop}
      />
    )
    expect(running).not.toContain('SUMMARYHIDDEN')
    expect(running).not.toContain('background-task-panel__summary')
    expect(running).not.toContain('background-task-panel__cut-summary')
  })

  it('keeps a markup-shaped summary inert (AC2)', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry([task({ taskId: 'f1', status: hostile, summary: { text: hostile, truncatedFields: null } })])}
        finishedTaskIds={new Set(['f1'])}
        onClose={noop}
      />
    )
    expect(markup).toContain('<span class="background-task-panel__summary">&lt;img')
    expect(markup).not.toContain('<img')
    expect(markup).not.toMatch(/\son[a-z]+="/)
  })
})

describe('formatTaskProgressCounts — the meta line after the tool name (#1640)', () => {
  const counts = (toolUses: number, totalTokens: number, durationMs: number): string =>
    formatTaskProgressCounts({ toolUses, totalTokens, durationMs })

  it('says 1 tool, otherwise N tools', () => {
    expect(counts(1, 0, 0)).toBe('1 tool · 0 tokens · 0s')
    expect(counts(4, 0, 0)).toBe('4 tools · 0 tokens · 0s')
    expect(counts(0, 0, 0)).toBe('0 tools · 0 tokens · 0s')
  })

  it('prints tokens under 1000 plainly, otherwise rounded to the nearest thousand with k', () => {
    expect(counts(1, 850, 0)).toBe('1 tool · 850 tokens · 0s')
    expect(counts(1, 999, 0)).toBe('1 tool · 999 tokens · 0s')
    expect(counts(1, 1000, 0)).toBe('1 tool · 1k tokens · 0s')
    expect(counts(1, 18400, 0)).toBe('1 tool · 18k tokens · 0s')
    expect(counts(1, 18500, 0)).toBe('1 tool · 19k tokens · 0s')
  })

  it('prints elapsed as seconds, then minutes and padded seconds, then hours and minutes', () => {
    expect(counts(1, 0, 41_999)).toBe('1 tool · 0 tokens · 41s')
    expect(counts(1, 0, 161_000)).toBe('1 tool · 0 tokens · 2m 41s')
    expect(counts(1, 0, 65_000)).toBe('1 tool · 0 tokens · 1m 05s')
    expect(counts(1, 0, 3_599_999)).toBe('1 tool · 0 tokens · 59m 59s')
    expect(counts(1, 0, 3_720_000)).toBe('1 tool · 0 tokens · 1h 2m')
  })
})

describe("BackgroundTaskPanelView — a running task's progress (#1640)", () => {
  function report(overrides: Partial<HeldBackgroundTaskProgress> = {}): HeldBackgroundTaskProgress {
    return {
      currentActivity: 'ACTIVITYONE',
      subagentType: 'general-purpose',
      lastToolName: 'Bash',
      totalTokens: 18000,
      toolUses: 4,
      durationMs: 161_000,
      truncatedFields: null,
      ...overrides
    }
  }
  const render = (tasks: readonly HeldBackgroundTask[], finished: readonly string[] = []): string =>
    renderToStaticMarkup(
      <BackgroundTaskPanelView
        entry={entry(tasks)}
        finishedTaskIds={finished.length > 0 ? new Set(finished) : null}
        onClose={noop}
      />
    )

  it('shows the activity and the meta line between the description and the latest update (AC1)', () => {
    const markup = render([
      task({
        taskId: 'r1',
        description: 'DESCONE',
        latestUpdate: { patch: 'PATCHONE', truncatedFields: null },
        progress: report()
      })
    ])
    expect(markup).toContain(
      'DESCONE</span><div class="background-task-panel__progress">' +
        '<span class="background-task-panel__activity">ACTIVITYONE</span>' +
        '<span class="background-task-panel__progress-meta">' +
        '<span class="background-task-panel__progress-tool">Bash</span> · 4 tools · 18k tokens · 2m 41s' +
        '</span></div><div class="background-task-panel__update">'
    )
  })

  it('leaves an empty tool name and its separator out (AC1)', () => {
    const markup = render([task({ taskId: 'r1', progress: report({ lastToolName: '' }) })])
    expect(markup).toContain('<span class="background-task-panel__progress-meta">4 tools · 18k tokens · 2m 41s</span>')
    expect(markup).not.toContain('background-task-panel__progress-tool')
  })

  it("chips the activity from the REPORT's list only, never the task's own (AC1)", () => {
    const cut = render([task({ taskId: 'r1', progress: report({ truncatedFields: ['description'] }) })])
    expect(cut).toContain(
      '<span class="background-task-panel__activity">ACTIVITYONE</span>' +
        '<span class="background-task-panel__cut-activity">Truncated by the daemon</span>' +
        '<span class="background-task-panel__progress-meta">'
    )
    // The task's own list naming `description` chips the description, not the activity.
    const crossed = render([
      task({ taskId: 'r1', truncatedFields: ['description'], progress: report({ truncatedFields: ['task_id'] }) })
    ])
    expect(crossed).not.toContain('background-task-panel__cut-activity')
    expect(crossed).toContain('background-task-panel__cut-description')
  })

  it('shows no block on a running row without a report or on any finished row (AC2)', () => {
    const none = render([task({ taskId: 'r1', progress: null })])
    expect(none).not.toContain('background-task-panel__progress')
    const finished = render(
      [task({ taskId: 'f1', status: 'completed', progress: report({ currentActivity: 'ACTIVITYHIDDEN' }) })],
      ['f1']
    )
    expect(finished).toContain('Finished · 1')
    expect(finished).not.toContain('ACTIVITYHIDDEN')
    expect(finished).not.toContain('background-task-panel__progress')
  })

  it('keeps a markup-shaped activity and tool name inert and out of every attribute (AC3)', () => {
    const markup = render([
      task({
        taskId: 'r1',
        progress: report({
          currentActivity: '<b>ACTHOSTILE</b>',
          lastToolName: '<img src=x onerror="alert(1)">TOOLHOSTILE'
        })
      })
    ])
    expect(markup).toContain('<span class="background-task-panel__activity">&lt;b&gt;ACTHOSTILE&lt;/b&gt;</span>')
    expect(markup).toContain('<span class="background-task-panel__progress-tool">&lt;img')
    expect(markup).not.toContain('<b>')
    expect(markup).not.toContain('<img')
    expect(markup).not.toMatch(/="[^"]*(ACTHOSTILE|TOOLHOSTILE)/)
    expect(markup).not.toMatch(/\stitle="/)
  })
})
