import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BackgroundTaskPanelView,
  drawerClosesOnKeyDown,
  formatTaskProgressCounts
  , type SuppliedBackgroundTask
} from './BackgroundTaskPanel'
import type {
  HeldBackgroundTask,
  HeldBackgroundTaskProgress
} from '../../store/backgroundTaskRosterStore'

// Supplied-task rendering is props-in/markup-out; interaction runs in Playwright.
const noop = (): void => {}

function task(overrides: Partial<SuppliedBackgroundTask> = {}): SuppliedBackgroundTask {
  return {
    rowKey: overrides.taskId ?? 'task-1', active: true, pending: false, canStop: true,
    outcomeLabel: overrides.status === 'completed' ? 'Completed' : overrides.status === 'failed' ? 'Failed' : overrides.status === 'stopped' ? 'Stopped' : overrides.status ?? 'Running',
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


describe('BackgroundTaskPanelView — the background-task panel (#581)', () => {

  it('lists one row per held task in roster order, showing its description and taskType (AC3)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[
          task({ taskId: 't1', description: 'npm run build', taskType: 'local_bash' }),
          task({ taskId: 't2', description: 'index the repository', taskType: 'agent_search' })
        ]}
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

  it('renders an untrusted description and taskType escaped, as inert text (AC5)', () => {
    // For taskType local_bash the description IS the literal command line claude ran — untrusted,
    // model-influenced text. No apostrophes in the fixture: renderToStaticMarkup escapes ' → &#x27;.
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[
          task({ description: '<img src=x onerror="alert(1)">', taskType: 'a<b&c' })
        ]}
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

  it('marks a rendered field the daemon names as cut, and only that field (AC3)', () => {
    const cutDescription = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ truncatedFields: ['description'] })]}
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
        suppliedTasks={[task({ truncatedFields: ['task_type'] })]}
        onClose={noop}
      />
    )
    expect(cutType).toContain('background-task-panel__cut-type')
    expect(cutType).toContain('Truncated by the daemon')
    expect(cutType).not.toContain('background-task-panel__cut-description')

    // Both at once: the list names fields independently, so the markers are independent too.
    const cutBoth = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ truncatedFields: ['description', 'task_type'] })]}
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
        suppliedTasks={[task({ truncatedFields: ['taskType'] })]}
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
      <BackgroundTaskPanelView suppliedTasks={[task({ truncatedFields: null })]} onClose={noop} />
    )
    expect(nullFields).toContain('background-task-panel__row')
    expect(nullFields).not.toContain('background-task-panel__cut-')

    const emptyFields = renderToStaticMarkup(
      <BackgroundTaskPanelView suppliedTasks={[task({ truncatedFields: [] })]} onClose={noop} />
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
        suppliedTasks={[
          task({ truncatedFields: ['task_id', 'tool_call_id', 'SENTINELFUTUREFIELD'] })
        ]}
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
        suppliedTasks={[
            task({
              description: '<img src=x onerror="alert(1)">',
              truncatedFields: ['description']
            })
          ]}
        onClose={noop}
      />
    )
    expect(markup).toContain('background-task-panel__cut-description')
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
        suppliedTasks={[
          task({ latestUpdate: { patch: '<img src=x onerror="alert(1)">', truncatedFields: null } })
        ]}
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

  it('marks the patch as cut from the UPDATES list only, never the task list (AC3)', () => {
    // Non-overlapping fixture values throughout: `SENTINELPATCH` is a prefix substring of
    // `SENTINELPATCHCUT`, the collision the shell's revised test above documents.
    const cutPatch = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['patch'] } })]}
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
        suppliedTasks={[task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null } })]}
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
        suppliedTasks={[
          task({
            truncatedFields: ['patch'],
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null }
          })
        ]}
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
        suppliedTasks={[
          task({
            truncatedFields: null,
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['description', 'task_type'] }
          })
        ]}
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
        suppliedTasks={[
          task({
            latestUpdate: { patch: 'PATCHTEXT', truncatedFields: ['task_id', 'SENTINELFUTURENAME'] }
          })
        ]}
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
        suppliedTasks={[
          task({
            taskId: 't1',
            latestUpdate: { patch: 'is_backgrounded true', truncatedFields: ['patch'] }
          }),
          task({ taskId: 't2', latestUpdate: { patch: '', truncatedFields: null } })
        ]}
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
    const heldEntry = [heldTask]
    const before = structuredClone(heldEntry)
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView suppliedTasks={heldEntry} onClose={noop} />
    )

    expect(markup).toContain(`<span class="background-task-panel__type">${label}</span>`)
    expect(heldEntry).toEqual(before)
    expect(heldEntry[0]).toBe(heldTask)
    expect(heldTask.taskType).toBe(taskType)
  })

  it('keeps formatted unknown types escaped and confined to the type text', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ taskType: 'local_<b>file_watch</b>' })]}
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
  it('sets a local_bash description in mono and other types in body text (AC2)', () => {
    const bash = renderToStaticMarkup(
      <BackgroundTaskPanelView suppliedTasks={[task({ taskType: 'local_bash' })]} onClose={noop} />
    )
    expect(bash).toContain('background-task-panel__description--mono')
    const agent = renderToStaticMarkup(
      <BackgroundTaskPanelView suppliedTasks={[task({ taskType: 'local_agent' })]} onClose={noop} />
    )
    expect(agent).toContain('background-task-panel__description')
    expect(agent).not.toContain('background-task-panel__description--mono')
  })

  it('puts the latest update under its label in a code block, and shows none for a never-updated row (AC2)', () => {
    const never = renderToStaticMarkup(
      <BackgroundTaskPanelView suppliedTasks={[task({ latestUpdate: null })]} onClose={noop} />
    )
    expect(never).not.toContain('background-task-panel__update')
    expect(never).not.toContain('Latest update')

    const patched = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ latestUpdate: { patch: 'PATCHTEXT', truncatedFields: null } })]}
        onClose={noop}
      />
    )
    expect(patched).toContain('Latest update')
    expect(patched).toMatch(/background-task-panel__update-block"><span class="background-task-panel__patch">PATCHTEXT</)

    const empty = renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ latestUpdate: { patch: '', truncatedFields: null } })]}
        onClose={noop}
      />
    )
    expect(empty).toContain('Latest update')
    expect(empty).toMatch(
      /background-task-panel__update-block"><span class="background-task-panel__no-change">No change reported</
    )
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

describe('BackgroundTaskPanelView — repeated finish summaries (#1754)', () => {
  const renderFinished = (held: SuppliedBackgroundTask): string =>
    renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[{ ...held, active: false }]}
        onClose={noop}
      />
    )

  it('shows different failure and stop reasons and preserves case-sensitive comparison', () => {
    for (const text of ['  Exited with code 1: port already in use.  ', 'Stopped by user', 'NPM RUN BUILD finished']) {
      const markup = renderFinished(task({
        description: 'npm run build',
        status: 'failed',
        summary: { text, truncatedFields: ['summary'] }
      }))
      expect(markup).toContain(`<span class="background-task-panel__summary">${text}</span>`)
      expect(markup).toContain('background-task-panel__cut-summary')
    }
  })

  it('shows a non-empty summary for an empty or whitespace-only description', () => {
    for (const description of ['', ' \n\t ']) {
      const markup = renderFinished(task({
        description,
        summary: { text: 'Task finished', truncatedFields: null }
      }))
      expect(markup).toContain('<span class="background-task-panel__summary">Task finished</span>')
    }
  })

  it('shows no summary or cut marker for empty summaries with empty or non-empty descriptions', () => {
    for (const description of ['', 'npm run build']) {
      const markup = renderFinished(task({
        description,
        summary: { text: '', truncatedFields: ['summary'] }
      }))
      expect(markup).not.toContain('background-task-panel__summary')
      expect(markup).not.toContain('background-task-panel__cut-summary')
    }
  })
})

// #1639: the status word the tag draws and the summary a finished row shows. The group still comes from
// `finishedTaskIds` alone; the word only chooses the tag, by exact match against client constants.
describe('BackgroundTaskPanelView — status tag and summary (#1639)', () => {
  const tagOf = (status: string | null, finished: boolean): string =>
    renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={[task({ taskId: 't', status, active: !finished })]}
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
  const render = (tasks: readonly SuppliedBackgroundTask[], finished: readonly string[] = []): string =>
    renderToStaticMarkup(
      <BackgroundTaskPanelView
        suppliedTasks={tasks.map(task => ({ ...task, active: !finished.includes(task.taskId) }))}
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

describe('Stop task button', () => {
  it('groups supplied activity independently of outcomes and disables only the pending raw target', () => {
    const raw = '<raw-task-id>'
    const html = renderToStaticMarkup(<BackgroundTaskPanelView suppliedTasks={[
      task({ taskId: raw, description: 'first active', pending: true }),
      task({ taskId: 'done', description: 'finished task', active: false, canStop: false, status: 'completed' }),
      task({ taskId: 'active', description: 'second active' }),
      task({ taskId: 'ineligible', description: 'no action', canStop: false })
    ]} onStopTask={noop} onClose={noop} />)
    expect(html).toContain('Running · 3')
    expect(html).toContain('Finished · 1')
    expect(html.indexOf('first active')).toBeLessThan(html.indexOf('second active'))
    expect(html.indexOf('second active')).toBeLessThan(html.indexOf('finished task'))
    expect(html.match(/>Stop task<\/button>/g)).toHaveLength(2)
    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html).not.toContain(raw)
    expect(html).not.toContain('&lt;raw-task-id&gt;')
  })

  it('follows progress, latest update and its cut marker without exposing identity', () => {
    const id = '<hostile-task-id>'
    const markup = renderToStaticMarkup(<BackgroundTaskPanelView
      suppliedTasks={[task({ taskId: id, progress: { currentActivity: 'Working', subagentType: '', lastToolName: '', totalTokens: 1, toolUses: 1, durationMs: 1, truncatedFields: null }, latestUpdate: { patch: 'Synthetic patch', truncatedFields: ['patch', 'task_id'] } })]}
      onStopTask={noop} onClose={noop} />)
    expect(markup).toContain('>Stop task</button>')
    expect(markup.indexOf('background-task-panel__stop')).toBeGreaterThan(markup.indexOf('background-task-panel__cut-patch'))
    expect(markup).not.toContain(id)
    expect(markup).not.toContain('&lt;hostile-task-id&gt;')
    expect(markup).not.toContain('disabled=""')
  })
})
