# Native edit context menu

A right-click in the window opens the operating system's own Copy/Cut/Paste/Select all popup, drawn by
macOS or Windows from Electron's role templates — not an app-drawn surface. Before [#1445](https://github.com/pyrycode/pyrycode-desktop/issues/1445)
a right-click did nothing at all: Electron draws no context menu unless the app builds one, and nothing did.
The keyboard path (Cmd+C/V/X/A, through the default application menu) and the message bubble's app-drawn
`Copy message` button were already there and are untouched; this closes the mouse-only gap.

## What it does

One listener on the window's web contents, registered in `createWindow` beside `setWindowOpenHandler`,
decides from the `context-menu` event's own parameters — `isEditable`, `selectionText`, `editFlags` — whether
a menu applies and which items it carries:

1. **Inside an editable field** (the message box, a pairing input) — Cut, Copy, Paste, a separator, then
   Select all, each item's `enabled` reading its own edit flag. Checked **first**, so a right-click in an
   empty field still opens the menu with every item greyed out rather than opening nothing — losing Paste is
   exactly the failure this ordering avoids.
2. **Outside an editable field, with a non-empty trimmed selection** — Copy alone, unconditionally enabled.
   The non-empty selection *is* the enablement test here; `editFlags.canCopy` is deliberately not
   re-consulted, so there is one source of truth rather than two that could disagree.
3. **Otherwise** — `null`. No menu opens.

## How it works

`src/main/editContextMenu.ts` is the third module in the injected-Electron shape established by
`fireNotification.ts` and `windowPresentation.ts`: it imports no `electron`, takes every Electron piece as a
parameter, and is therefore plain, total, synchronous code that unit-tests in plain Node with no harness.

```ts
export interface EditContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export type EditMenuItem =
  | { role: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { type: 'separator' }

export function editContextMenuTemplate(params: EditContextParams): EditMenuItem[] | null
export function createContextMenuListener(
  buildMenu: (template: EditMenuItem[]) => PoppableMenu
): (event: unknown, params: EditContextParams) => void
```

`editContextMenuTemplate` is the total decision above. `createContextMenuListener` is the thin half: run the
decision, return without touching `buildMenu` when it is `null`, otherwise build and `popup()`. Building a
template and declining to pop it would be the subtler bug — invisible, but it hands the items to the OS on
every stray right-click — so the `null` case never reaches `buildMenu` at all.

`index.ts`, the composition root, is the only place that touches `Menu`:

```ts
mainWindow.webContents.on(
  'context-menu',
  createContextMenuListener((template) => {
    const menu = Menu.buildFromTemplate(template)
    return { popup: () => menu.popup({ window: mainWindow }) }
  })
)
```

The wrapper closure looks redundant — a bare `Menu` already satisfies `PoppableMenu`'s zero-argument
`popup()`, since Electron's `popup(options?)` takes an all-optional parameter — but it is not: returning the
bare `Menu` would drop `{ window: mainWindow }` and let the popup land on whichever window happens to be
focused, rather than the one that was actually clicked.

`event` is accepted and ignored: Electron draws no default menu here, so there is nothing to
`preventDefault`, and it is typed `unknown` rather than imported so the module stays `electron`-free
(`Event` is assignable to `unknown` in this contravariant parameter position).

## Why roles, not an app-drawn menu

Each item is one of Electron's `cut`/`copy`/`paste`/`selectAll` roles, which act on the focused web contents
through Chromium's own edit commands. That means no renderer code, no IPC channel, and no clipboard call —
and, load-bearing for the security review, no behaviour is ever derived from the event parameters. Every
visible label is the operating system's own, localized by it; the app supplies none.

`electron-context-menu` was deliberately not added as a dependency. Four roles cover the whole ticket, and a
dependency is a second review surface for no behaviour the roles don't already give for free.

## Security boundary: a narrow params type, not `ContextMenuParams`

`EditContextParams` is a hand-picked structural subset of Electron's `ContextMenuParams`, not that type
itself. It has no `linkURL`, `srcURL`, `frameURL`, `pageURL`, `titleText`, or `misspelledWord` — the
attacker-influenceable fields behind Copy-link-address, Save-image-as, and spell-check suggestions, all
deliberately out of scope for this ticket. Reaching for one of them is a compile error, not a judgement call
a later editor could get wrong.

`selectionText` — daemon-supplied text can reach it — is read at exactly one site: `.trim().length === 0`,
whose result is a boolean. It never reaches an item label, a log line, a path, a URL, or a cache key.
`EditMenuItem` has no `label` member at all, so a labelled item is unrepresentable, not just untested; the
test file additionally asserts no emitted item carries a `label` or `click` key. The module logs nothing, so
there is no log sink to leak into either.

`editFlags` is, in Electron's own wording, what the *renderer believes* it can do — a compromised renderer
could lie. The consequence is bounded: a flag only toggles whether an item is greyed out, and the roles act
on the focused web contents regardless, through Chromium's own edit commands. There is no custom `click`
handler to confuse.

**The `paste` role and the app's `clipboard-read` denial.** Paste puts clipboard contents into the focused
editable element, where renderer JS could then read them — which looks like a way around this app's
deliberate `setPermissionRequestHandler` denial of `clipboard-read`. It is not a new capability: the default
application menu's Cmd+V accelerator already does exactly this, into the same field, and a renderer
compromised enough to exploit it already holds the `window.pyry` bridge. This menu adds a second input
device to an existing capability, not a new one. If a future hardening ticket ever removes the Paste
accelerator from the application menu, this menu becomes the last remaining path and must be reconsidered in
the same breath.

## Testing

`src/main/editContextMenu.test.ts`, plain Node, no Electron harness — the `windowPresentation.test.ts`
idiom. `editContextMenuTemplate` is driven with hand-built `EditContextParams` values covering: a selection
outside a field (Copy alone); an empty or whitespace-only selection outside a field (`null`); every edit flag
on and every edit flag off inside a field (same five items either way, only `enabled` differs — proving the
menu opens even fully disabled); each flag toggled one at a time (catches a crossed role/flag wiring that an
all-on/all-off test cannot); an empty selection *inside* a field (proving the editable check runs before the
selection check); and a structural assertion that no branch's items carry a `label` or `click` key. A
type-only compile check pins that Electron's real `ContextMenuParams` stays assignable to the narrow
`EditContextParams` with no cast, so a future Electron field rename fails `npm run build` in this unit rather
than only at the `index.ts` wiring site. `createContextMenuListener` is exercised against a fake builder in
the `fireNotification.test.ts` fake-constructor idiom — a `vi.fn()` returning a spied `popup` — asserting the
applicable and inapplicable cases each build/pop the right number of times.

**Why there is no e2e spec, and what stands in for one.** Playwright cannot see or dismiss a native OS popup,
and the e2e harness launches the window hidden ([window-presentation dev affordance](window-presentation-affordance.md)),
so no automated tier can ever observe this menu actually opening on screen. The ticket's acceptance criteria
instead name an operator hand check — recorded on the ticket, not run by any test command — as the standing
proof: select text in a daemon reply, right-click, choose Copy, and confirm the pasted text lands in another
app; then right-click in the message box with clipboard content and confirm Paste is enabled and inserts it.
`npm run e2e:real:gate` does not cover this and was not intended to; no live-claude spec can reach a native
menu.

## Related

- [Push notifications](push-notifications.md) — `fireNotification.ts`, the module this one's injected-Electron
  shape and fake-constructor test idiom are copied from.
- [Window-presentation dev affordance](window-presentation-affordance.md) — `windowPresentation.ts`, the
  pure-total-decision precedent, and the reason no e2e spec can observe this menu opening (the harness
  launches the window hidden).
