import { describe, it, expect, vi } from 'vitest'
import type { ContextMenuParams } from 'electron'
import {
  editContextMenuTemplate,
  createContextMenuListener,
  type EditContextParams,
  type EditMenuItem,
  type PoppableMenu
} from './editContextMenu'

// The decision is exercised through its real entry point with plain values — the
// windowPresentation.test.ts / relayPolicy.test.ts idiom. editContextMenu.ts imports no `electron`, so
// this whole file runs in plain Node with no harness. The one Electron import below is type-only and
// erased at runtime; it exists to make the structural match a compile error when it breaks, which no
// runtime assertion could catch.

const NO_FLAGS = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }
const ALL_FLAGS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

/** Params with the "nothing applies" defaults, so each test states only the field it is about. */
function context(overrides: Partial<EditContextParams> = {}): EditContextParams {
  return { isEditable: false, selectionText: '', editFlags: NO_FLAGS, ...overrides }
}

/** The five items an editable field always offers, with every role at `enabled`. */
function editableItems(enabled: boolean): EditMenuItem[] {
  return [
    { role: 'cut', enabled },
    { role: 'copy', enabled },
    { role: 'paste', enabled },
    { type: 'separator' },
    { role: 'selectAll', enabled }
  ]
}

/** A stand-in for `Menu.buildFromTemplate` plus the root's popup closure: a spied builder handing back
 *  a spied `popup`. Mirrors fireNotification.test.ts's fakeNotification — no Electron harness. */
function fakeMenuBuilder(): {
  buildMenu: (template: EditMenuItem[]) => PoppableMenu
  build: ReturnType<typeof vi.fn>
  popup: ReturnType<typeof vi.fn>
} {
  const popup = vi.fn()
  const build = vi.fn((_template: EditMenuItem[]): PoppableMenu => ({ popup }))
  return { buildMenu: build, build, popup }
}

describe('editContextMenuTemplate', () => {
  it('offers Copy alone for a selection outside an editable field', () => {
    expect(editContextMenuTemplate(context({ selectionText: 'a daemon reply' }))).toEqual([
      { role: 'copy', enabled: true }
    ])
  })

  it('opens nothing outside an editable field when the selection is empty or whitespace', () => {
    for (const selectionText of ['', ' ', '\t', '\n', '  \n\t ']) {
      expect(
        editContextMenuTemplate(context({ selectionText })),
        `selectionText=${JSON.stringify(selectionText)}`
      ).toBeNull()
    }
  })

  it('offers Cut, Copy, Paste and a separated Select all inside an editable field', () => {
    expect(
      editContextMenuTemplate(context({ isEditable: true, editFlags: ALL_FLAGS }))
    ).toEqual(editableItems(true))
  })

  it('opens the menu with every item disabled when the field allows nothing', () => {
    // AC2: the items are disabled rather than absent. A menu that vanished here would look identical to
    // AC3's "nothing applies" case from the outside, which is exactly the confusion the AC rules out.
    expect(editContextMenuTemplate(context({ isEditable: true, editFlags: NO_FLAGS }))).toEqual(
      editableItems(false)
    )
  })

  it('reads each role`s enabled from its own edit flag', () => {
    // A crossed wiring — paste reading canCopy, say — passes every test above, because those only ever
    // set the four flags together. This is the one that fails on it.
    const flagForRole = [
      ['canCut', 'cut'],
      ['canCopy', 'copy'],
      ['canPaste', 'paste'],
      ['canSelectAll', 'selectAll']
    ] as const

    for (const [flag, role] of flagForRole) {
      const items = editContextMenuTemplate(
        context({ isEditable: true, editFlags: { ...NO_FLAGS, [flag]: true } })
      )
      expect(items, `${flag} alone`).not.toBeNull()
      for (const item of items ?? []) {
        if (!('role' in item)) continue
        expect(item.enabled, `${flag} alone → ${item.role}`).toBe(item.role === role)
      }
    }
  })

  it('opens inside an editable field even with nothing selected', () => {
    // The editable test runs BEFORE the selection test. Reversing the two would leave a right-click in an
    // empty message box with no menu at all, losing Paste exactly where it is most wanted.
    expect(
      editContextMenuTemplate(context({ isEditable: true, selectionText: '', editFlags: ALL_FLAGS }))
    ).toEqual(editableItems(true))
  })

  it('never emits a label or a click handler in any branch', () => {
    // The security invariant, asserted rather than argued: every visible string is the OS's own, supplied
    // by the role, and no behaviour is derived from the event parameters. Key-set equality catches a
    // `label` built from `selectionText` and a `click` closure alike.
    const branches = [
      context({ selectionText: 'daemon text' }),
      context({ isEditable: true, editFlags: ALL_FLAGS }),
      context({ isEditable: true, editFlags: NO_FLAGS, selectionText: 'daemon text' })
    ]
    for (const params of branches) {
      const items = editContextMenuTemplate(params)
      expect(items).not.toBeNull()
      for (const item of items ?? []) {
        for (const key of Object.keys(item)) {
          expect(['role', 'enabled', 'type'], JSON.stringify(item)).toContain(key)
        }
      }
    }
  })

  it('accepts a real Electron ContextMenuParams', () => {
    // Compile-time only: ContextMenuParams must stay assignable to the narrow EditContextParams, or the
    // listener stops matching Electron's `context-menu` signature. An Electron field rename would fail
    // `npm run build` here rather than at the single wiring site in index.ts.
    const widen: (params: ContextMenuParams) => EditContextParams = (params) => params
    expect(typeof widen).toBe('function')
  })
})

describe('createContextMenuListener', () => {
  it('builds the decided template and pops it once for an applicable event', () => {
    const menu = fakeMenuBuilder()
    createContextMenuListener(menu.buildMenu)({}, context({ selectionText: 'a daemon reply' }))

    expect(menu.build).toHaveBeenCalledTimes(1)
    expect(menu.build).toHaveBeenCalledWith([{ role: 'copy', enabled: true }])
    expect(menu.popup).toHaveBeenCalledTimes(1)
  })

  it('neither builds nor pops when nothing applies', () => {
    // AC3. Building a menu and declining to pop it would be the subtler bug: invisible, but it hands the
    // template — and whatever a future edit puts in it — to the OS on every stray right-click.
    const menu = fakeMenuBuilder()
    createContextMenuListener(menu.buildMenu)({}, context({ selectionText: '   ' }))

    expect(menu.build).not.toHaveBeenCalled()
    expect(menu.popup).not.toHaveBeenCalled()
  })
})
