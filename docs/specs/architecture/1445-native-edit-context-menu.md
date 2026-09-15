# #1445 — right-click opens the native Copy, Cut, Paste and Select all menu

## Files read

- `src/main/index.ts` → `createWindow` — the wiring site. `setWindowOpenHandler` and the `will-navigate`
  guard are the neighbours the new listener joins, and neither logs; that sets the house expectation for a
  window-shell handler.
- `src/main/fireNotification.ts` → `fireNotification`, `OsNotificationConstructor` — the injected-Electron
  main-module shape this ticket copies: a structural interface standing in for the Electron piece, no
  `electron` import anywhere in the unit.
- `src/main/fireNotification.test.ts` → `fakeNotification` — the fake-constructor idiom the fake menu
  builder mirrors.
- `src/main/windowPresentation.ts` → `selectWindowPresentation` — the pure, total, plain-values decision
  precedent; also the habit of testing the *order* of checks rather than only the happy paths.
- `src/main/windowPresentation.test.ts` — the matching test idiom: real entry point, plain values, plain
  Node.
- `node_modules/electron/electron.d.ts` → `ContextMenuParams`, `EditFlags`, `MenuItemConstructorOptions` —
  the exact field names the structural params interface must match so a real Electron listener is
  assignable with no cast, and the exact `role` union the template's roles must sit inside.
- `docs/knowledge/features/app-shell.md` — confirms the renderer shell owns no `contextmenu` path and
  learns nothing from this ticket; there is no renderer seam to collide with.

Tooling note: `codegraph_context` failed with "CodeGraph not initialized for this project" — the worktree's
`.codegraph/` holds a config but no index — so the reading list above came from Read/Grep.

## Design source

**Figma:** N/A — echoed from the ticket. The menu is the operating system's own popup, drawn by macOS and
Windows from a role template; there is no node to match and no styling to do. The visual-fidelity check is
intentionally skipped. The one app-drawn neighbour, the message bubble's `Copy message` button, is
untouched.

## Context

Right-clicking in the window does nothing today: Electron draws no context menu unless the app builds one,
and no module under `src/main/` imports `Menu`. Text is already selectable and the keyboard path
(Cmd+C/V/X/A) already works through Electron's default application menu, so only the mouse path is missing.
This ticket adds the single listener that closes it.

No ADR is warranted. This introduces no new architectural boundary — it is one more injected-Electron main
module in an established family (`fireNotification`, `windowPresentation`), and the choice it does make
(OS roles over an app-drawn menu or the `electron-context-menu` package) belongs in the package overview
the documentation stage writes, not in a decision record.

## Design

One new module, `src/main/editContextMenu.ts`, plus its wiring in `createWindow`. The module imports no
`electron`; every Electron piece arrives as a parameter, so the whole unit runs in plain Node under vitest.

**Contracts** (signatures and behaviour, not bodies):

```ts
/** The subset of Electron's ContextMenuParams the decision reads. Field names match
 *  ContextMenuParams/EditFlags exactly, so a real Electron listener is assignable with no cast. */
export interface EditContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

/** The subset of MenuItemConstructorOptions the template emits: roles and separators only.
 *  No `label`, no `click` — the union makes both structurally unrepresentable. */
export type EditMenuItem =
  | { role: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { type: 'separator' }

/** The total decision. Returns the items to show, or null for "show nothing". */
export function editContextMenuTemplate(params: EditContextParams): EditMenuItem[] | null

/** What the composition root hands back from `Menu.buildFromTemplate`. */
export interface PoppableMenu { popup(): void }

/** Builds the listener `createWindow` registers on the window's web contents. */
export function createContextMenuListener(
  buildMenu: (template: EditMenuItem[]) => PoppableMenu
): (event: unknown, params: EditContextParams) => void
```

**The three branches of `editContextMenuTemplate`**, checked in this order:

1. `params.isEditable` → `cut`, `copy`, `paste`, a separator, then `selectAll`; each role's `enabled` reads
   its own edit flag. The editable test comes **first**, so a focused-but-empty field still opens a menu
   with every item disabled (AC2: "the items are then disabled rather than absent").
2. otherwise, `params.selectionText.trim()` non-empty → `copy` alone, enabled.
3. otherwise → `null`. Nothing opens (AC3).

`createContextMenuListener` is the thin half: call the decision, return without touching `buildMenu` when it
is `null`, otherwise build and `popup()`. The `event` parameter is accepted and ignored — Electron draws no
default menu, so there is nothing to `preventDefault` — and it is typed `unknown` rather than imported, which
is what keeps the `electron` import out. Assignability holds in both directions: `Event` is assignable to
`unknown` (contravariant parameter position), and the real `ContextMenuParams` is assignable to
`EditContextParams` because it carries a superset of the fields.

**Wiring**, in `createWindow` beside `setWindowOpenHandler`:

```ts
mainWindow.webContents.on(
  'context-menu',
  createContextMenuListener((template) => {
    const menu = Menu.buildFromTemplate(template)
    return { popup: () => menu.popup({ window: mainWindow }) }
  })
)
```

The root is the only place that touches `Menu`, and it names the target window explicitly rather than
letting `popup()` fall back to the focused window — the menu belongs to the window that was clicked.
`Menu` joins the existing `electron` import list in `index.ts`.

**Why roles, not `click` handlers.** Each role acts on the focused web contents through Chromium's own edit
commands, so no renderer code, no IPC channel, and no clipboard call is needed — and, load-bearing for the
security pass, no behaviour is ever derived from the event parameters. The item labels are the operating
system's own, localized by it; the app supplies none. `electron-context-menu` is deliberately not added:
four roles cover the ticket and a dependency is a second review surface.

## State + concurrency model

No state and no async. One listener is registered for the window's lifetime on its own web contents and dies
with the window — nothing to unsubscribe, no timer, no `AbortSignal`, no store slice. Each event builds a
fresh menu and drops it; the closure holds it across the `popup()` call and Electron retains a popped menu
itself, so there is no GC-closes-the-menu path to defend against.

## Error handling

The decision is **total**: every `EditContextParams` value maps to a template or to `null`. There is no throw
path, no I/O, no parse, and therefore no result type — the module reads values already in hand and returns a
plain array.

Deliberately **no logging**. There is no lifecycle event and no classifiable error to record, a line per
right-click would be pure volume, and the neighbouring window-shell handlers (`setWindowOpenHandler`,
`will-navigate`) log nothing either. The one field that would be tempting to log — `selectionText` — is
precisely the field that must never reach a log.

## Testing strategy

`src/main/editContextMenu.test.ts`, vitest in the node environment, plain values throughout. No Electron
harness and no e2e spec (AC4).

`editContextMenuTemplate`:

- selection outside an editable field → Copy alone, enabled;
- whitespace-only selection outside a field, and empty selection outside a field → `null`;
- editable with every flag on → cut, copy, paste, separator, selectAll, all enabled;
- editable with every flag off → the same five items, all four roles disabled — the menu opens anyway;
- editable, one flag at a time → each role's `enabled` tracks *its own* flag, so a crossed wiring fails;
- editable with an empty selection → still opens, proving the editable test precedes the selection test;
- no item in any branch carries a `label` or a `click` key (the security invariant, asserted rather than
  argued).

`createContextMenuListener`, against a fake builder in the `fakeNotification` idiom — a `vi.fn()` returning
an object with a spied `popup`:

- an applicable event builds exactly once with the decided template and pops exactly once;
- an inapplicable event never builds and never pops.

Not provable here, by construction: that the native popup appears on screen. Playwright cannot see or
dismiss a native menu and the e2e harness launches the window hidden, so AC5's operator hand check is the
standing proof.

## Documentation handoff

Pending for the documentation stage, from the ticket's own handoff section: record the surface in a **new**
package overview under `docs/knowledge/features/` — the three decision branches, why the native role template
was chosen over an app-drawn menu or the `electron-context-menu` package, and that the operator hand check
stands in for an e2e spec because the native popup is invisible to Playwright. Not written by this ticket.

## Open questions

1. **Does the root's closure need to wrap the `Menu` at all?** Electron's `Menu.popup(options?)` has an
   all-optional parameter, so a bare `Menu` may already satisfy `PoppableMenu`. It would still be wrong to
   return it directly — that drops the explicit `{ window: mainWindow }` — but the answer decides whether the
   wrapper needs a comment explaining why it exists. Resolve at typecheck in Phase B.
2. **Should Copy outside an editable field read `editFlags.canCopy` instead of being unconditionally
   enabled?** Leaning no: the non-empty trimmed selection *is* the enablement test in that branch, and
   reading the flag as well would give one decision two sources of truth. Record the resolution.

## Revisions

**2026-09-15 — both open questions resolved in Phase B. The design is unchanged; these record the
answers, not departures from it.**

1. **The root's closure stays a wrapper, and now says why in a comment.** Electron's `Menu` does satisfy
   `PoppableMenu` on its own (`popup(options?)` has an all-optional parameter, so it is assignable to a
   zero-argument `popup()`), which is exactly what makes the wrapper look redundant to a later reader. It
   is not: returning the bare `Menu` would drop `{ window: mainWindow }` and let the popup land on
   whichever window happened to be focused. The wiring comment in `createWindow` now states that.
2. **Copy outside an editable field is emitted unconditionally enabled, not gated on `editFlags.canCopy`**
   — as leaned. In that branch the non-empty trimmed selection *is* the enablement test, and reading the
   flag as well would give one decision two sources of truth that could disagree. The reasoning sits on
   `editContextMenuTemplate` so the next reader does not re-open it.

One thing the plan assumed and the build has now proved rather than argued: `ContextMenuParams` is
assignable to the narrow `EditContextParams`, and the returned listener is assignable to Electron's
`'context-menu'` signature, both with no cast. The test file pins the first as a compile-time check so an
Electron field rename fails `npm run build` in the unit rather than only at the wiring site.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is deliberate rather than incidental. The
  `context-menu` params arrive from the renderer and carry daemon-supplied text, so they are untrusted.
  `EditContextParams` is the boundary: it is a *narrow* structural interface, not `ContextMenuParams`, so
  the module structurally cannot see `linkURL`, `srcURL`, `frameURL`, `pageURL`, `titleText` or
  `misspelledWord` — exactly the attacker-influenceable fields that make trouble in context-menu
  implementations that offer Copy link address or Save image as. Those features are out of scope for this
  ticket, and the type makes reaching for them a compile error rather than a judgement call.
- **[Trust boundaries]** No finding — `selectionText` is read at exactly one site, `.trim()` for an
  emptiness test whose result is a boolean. It never reaches a menu label, a log line, a path, a URL, a
  cache key or the renderer. Asserted structurally, not by convention: `EditMenuItem` has no `label`
  member, so a labelled item does not type-check, and the test file asserts no branch emits `label` or
  `click`. Every visible string in the menu is the operating system's own, supplied by the role.
- **[Trust boundaries]** No finding — `editFlags` is, by Electron's own wording, "whether the *renderer
  believes* it can cut", so a compromised renderer can lie. The consequence is bounded to an item being
  enabled that Chromium then declines to act on: the roles act on the focused web contents through
  Chromium's edit commands, and no behaviour anywhere is derived from the parameter values. There is no
  custom `click` handler to confuse.
- **[Electron attack surface]** No finding, and this is the one worth stating in full because it looks
  like one. The `paste` role puts clipboard contents into the focused editable element, where renderer
  JS can read them — seemingly a way around this app's deliberate `clipboard-read` denial in
  `setPermissionRequestHandler`. It is not a new path: the default application menu's Cmd+V accelerator
  already does exactly this, into the same field, and a renderer compromised enough to exploit it already
  holds the `window.pyry` bridge. This ticket adds a second input device to an existing capability, not a
  capability. Forward-looking note for whoever revisits it: if a future hardening ticket ever removes the
  Paste accelerator from the application menu, this menu becomes the last remaining path and must be
  reconsidered in the same breath.
- **[Electron attack surface]** No finding — the change adds no IPC channel, no `contextBridge` member, no
  `webPreferences` change, no protocol registration and no navigation change. `setWindowOpenHandler`'s
  deny and the `will-navigate` guard are untouched; `sandbox: true` / `contextIsolation: true` are
  untouched. The listener is main-process-only and exposes nothing new to the renderer. The menu applies
  to every frame of the window's contents, which is safe here because the window loads only the app's own
  document and both navigation guards keep it that way.
- **[Tokens, secrets, credentials]** No finding — nothing on this path reads or stores a secret. Copy can
  put a selected pairing payload on the clipboard, but the operator pasted that payload *from* the
  clipboard in the first place; the OS clipboard is already that value's transport, so no new exposure is
  created. No `safeStorage` interaction, no token, no disk write.
- **[File / storage operations]** Not applicable by design — no path is constructed, no file opened, no
  cache key derived. The one untrusted string never leaves its boolean test, so there is no traversal or
  TOCTOU surface to reason about.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no key,
  no Noise interaction.
- **[Network & I/O]** Not applicable — no socket, no request, no timeout, no frame.
- **[Error messages, logs, telemetry]** No finding, by the strongest available answer: the module logs
  nothing at all (see Error handling), so the question of whether `selectionText` could reach a log is
  closed by construction rather than by care. No error message exists to leak, and nothing reaches the
  renderer console.
- **[Concurrency]** No finding — one listener per window, registered in `createWindow`, living and dying
  with the web contents it is attached to; a dock-reopened window gets a fresh one on fresh contents, so
  listeners cannot accumulate. No async, no timer, no signal to abort. A destroyed-window guard of the
  `#518` kind is deliberately *not* added: those protect calls arriving from the relay at an arbitrary
  later time, decoupled from the window's life, whereas this listener runs synchronously inside an event
  emitted by the very contents in question, which cannot fire once destroyed. Defending an unobservable
  mode here would be noise.
- **[Threat model alignment]** No finding — hostile-daemon text is the live threat on this path, and the
  repo's rule for it (rendered and escaped, never into a raw-markup sink, an attribute, a URL, a filename,
  a cache key or a log) is satisfied: the text reaches a `.trim().length` test and nothing else. Chromium
  bounds `selectionText` before Electron builds the params, and a trim is bounded work regardless, so
  there is no amplification vector. A hostile relay is not on this path at all.
- **[Trust boundaries]** OUT OF SCOPE, named per the ticket: spell-check suggestions, Copy link address,
  copying an image, and a menu on the sidebar rows. Each would widen `EditContextParams` to fields this
  review just excluded, and each is its own ticket with its own review.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
