import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BackgroundTaskPanelView } from './BackgroundTaskPanel'
import type {
  BackgroundTaskRosterEntry,
  HeldBackgroundTask
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
    ...overrides
  }
}

// The held entry as the store builds it: a Map keyed by taskId, in the given (roster) order.
function entry(tasks: readonly HeldBackgroundTask[], droppedTasks = 0): BackgroundTaskRosterEntry {
  return { tasks: new Map(tasks.map((t) => [t.taskId, t])), droppedTasks }
}

describe('BackgroundTaskPanelView — the background-task panel (#581)', () => {
  it('renders the labelled modal dialog chrome, under a title id distinct from the other three (AC1)', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTaskPanelView entry={entry([])} onClose={noop} />
    )
    // The status-sheet chrome, reused verbatim: a modal dialog labelled by its own title id, the drag
    // handle, the static title, and the icon-only close control.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="background-task-panel-title"')
    expect(markup).toContain('id="background-task-panel-title"')
    expect(markup).toContain('status-sheet__handle')
    expect(markup).toContain('Background tasks')
    expect(markup).toContain('aria-label="Close"')
    // The id is distinct from the three existing ones, so all four can coexist without duplicate ids.
    // `status-sheet-title` is a substring of nothing else here (the chrome's class is
    // `status-sheet__title`, with an underscore pair), so the assertion is meaningful.
    expect(markup).not.toContain('status-sheet-title')
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
    expect(markup).toContain('local_bash')
    expect(markup).toContain('index the repository')
    expect(markup).toContain('agent_search')
    // Roster order — the held Map preserves insertion order, and the view iterates values() as-is.
    expect(markup.indexOf('npm run build')).toBeLessThan(markup.indexOf('index the repository'))
  })

  it('renders no task field beyond description and taskType (AC3)', () => {
    // Distinctive sentinels rather than realistic values: a realistic truncated_fields entry
    // (`description`) would collide with other copy, and a small droppedTasks could collide with an
    // SVG path number. droppedTasks (#582) and latestUpdate (#583) are the successors' seams.
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
          987654
        )}
        onClose={noop}
      />
    )
    expect(markup).not.toContain('SENTINELTOOLCALL')
    expect(markup).not.toContain('SENTINELTASKCUT')
    expect(markup).not.toContain('SENTINELPATCH')
    expect(markup).not.toContain('SENTINELPATCHCUT')
    expect(markup).not.toContain('987654')
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
    expect(markup).toContain('a&lt;b&amp;c')
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
