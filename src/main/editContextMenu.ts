// The native Copy/Cut/Paste/Select all menu a right-click opens (#1445). Electron draws no context menu
// unless the app builds one, and nothing did: the keyboard path (Cmd+C/V/X/A) already worked through the
// default application menu, so only the mouse path was missing.
//
// Shaped like fireNotification.ts and windowPresentation.ts: the decision is pure and total, every Electron
// piece is INJECTED as a parameter, and this module imports no `electron` — so it unit-tests with plain
// values in plain Node, with no harness. The composition root (index.ts) is the only place that touches
// `Menu`.
//
// SECURITY, and the reason the types below are narrower than Electron's own: the event parameters cross the
// renderer→main boundary carrying daemon-supplied text. `EditContextParams` is that boundary. It cannot see
// `linkURL`, `srcURL`, `frameURL`, `pageURL`, `titleText` or `misspelledWord` — exactly the
// attacker-influenceable fields that make trouble in the Copy-link-address and Save-image-as features this
// ticket leaves out — so reaching for one is a compile error rather than a judgement call. `selectionText`
// is read at exactly one site, for an emptiness test, and never reaches a label, a log, a path or a URL.

/**
 * The subset of Electron's `ContextMenuParams` the decision reads. Field names match `ContextMenuParams`
 * and `EditFlags` exactly, so Electron's real listener signature is assignable to the one
 * `createContextMenuListener` returns with no cast — `editContextMenu.test.ts` pins that structurally.
 *
 * `editFlags` is, in Electron's own wording, what the RENDERER BELIEVES it can do, so it is untrusted. That
 * is safe here because nothing derives behaviour from it: a flag only decides whether an item is greyed
 * out, and the roles themselves act on the focused web contents through Chromium's edit commands.
 */
export interface EditContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

/**
 * The subset of `MenuItemConstructorOptions` the template emits: roles and separators, nothing else.
 * Deliberately has no `label` and no `click` member — the OS supplies every visible string from the role
 * (localized, by it), and no item may derive behaviour from the event parameters. Both invariants are
 * structural here rather than conventions to remember, and the test asserts the emitted key set too, since
 * excess-property checking only fires on object literals.
 */
export type EditMenuItem =
  | { role: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { type: 'separator' }

/** What the composition root hands back from `Menu.buildFromTemplate` — the one member this module calls. */
export interface PoppableMenu {
  popup(): void
}

/**
 * Which menu items a right-click should offer, or `null` for "open nothing at all". Total: every parameter
 * value maps to one of the three branches, so there is no throw path and no result type.
 *
 * THE ORDER OF THE TWO TESTS IS LOAD-BEARING. `isEditable` is checked first, so a right-click in an empty
 * message box still opens the full menu with its items greyed out (AC2) rather than falling through to the
 * selection test and opening nothing — which would lose Paste exactly where it is most wanted. Outside a
 * field the trimmed selection IS the enablement test, which is why Copy is emitted unconditionally enabled
 * there rather than re-reading `canCopy`: one decision, one source of truth.
 */
export function editContextMenuTemplate(params: EditContextParams): EditMenuItem[] | null {
  if (params.isEditable) {
    const flags = params.editFlags
    return [
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: flags.canSelectAll }
    ]
  }
  // The only read of `selectionText` anywhere: its emptiness, as a boolean. The text itself goes nowhere.
  if (params.selectionText.trim().length === 0) return null
  return [{ role: 'copy', enabled: true }]
}

/**
 * Build the listener `createWindow` registers on the window's web contents for `'context-menu'`. Decide,
 * then either return having touched nothing, or build the menu and pop it.
 *
 * `event` is accepted and ignored: Electron draws no default menu, so there is nothing to `preventDefault`.
 * It is typed `unknown` rather than imported so no `electron` import reaches this unit — Electron's `Event`
 * is assignable to it, that being a contravariant parameter position.
 *
 * Nothing is built when the decision is `null`. That matters beyond tidiness: building a template and
 * declining to pop it would be invisible, yet would still hand the items — and whatever a later edit puts
 * in them — to the OS on every stray right-click.
 */
export function createContextMenuListener(
  buildMenu: (template: EditMenuItem[]) => PoppableMenu
): (event: unknown, params: EditContextParams) => void {
  return (_event, params) => {
    const template = editContextMenuTemplate(params)
    if (template === null) return
    buildMenu(template).popup()
  }
}
