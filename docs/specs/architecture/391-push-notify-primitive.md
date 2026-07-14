# Spec #391 — Push notifications A: main-process delivery primitive

Fire a native OS notification when the main window is unfocused, given a `notify` command
from the renderer. Ships **dormant** — no renderer sends `notify` yet (the trigger is sibling
slice #392; click-to-focus is #393). Unit-tested in isolation, the established dormant-arm
pattern (`stallDetected`, `relayLinkChanged` shipped before their consumers).

**Size:** S. **Security-sensitive:** no (internal renderer→main IPC; no relay socket, key, Noise
handshake, or wire frame — this slice is a downstream consumer). **UI-visible:** no (OS-drawn
notification chrome; see Design source below).

## Design source

N/A — the visible surface is OS-drawn notification chrome, not in-app React UI. No Figma node,
by design (Technical Notes confirm NOT-UI-visible). The visual-fidelity / Figma check is
intentionally skipped for this slice; there is no component to match against a design.

## Files to read first

- `src/shared/ipc/commands.ts:102-235` — the `RendererCommand` union (extend additively) and the
  `isRendererCommand` switch (add one `case`). Both grow in lockstep or the new member is silently
  dropped at the boundary.
- `src/shared/ipc/commands.ts:262-278` — `isAnswerModalPayload` / `isCancelModalPayload`: the
  `is*Payload` helper shape your new guard mirrors (structural object check + per-field checks). Note
  these are **module-private** (not exported); yours is too.
- `src/shared/ipc/commands.ts:43` — `AnswerModalCommandPayload`: the precedent for a payload **type
  defined in this file** rather than imported from `../wire/types`. Your `NotifyPayload` follows it
  (this command never touches the wire — see Design §1).
- `src/main/emitDaemonEvent.ts:1-25` — the plain-function, injected-Electron-dependency module shape
  your new module copies: minimal structural interface for the Electron dependency, no `import
  'electron'`, unit-testable with a fake.
- `src/main/emitDaemonEvent.test.ts:1-54` — the test seam to mirror: a fake constructed via `vi.fn()`,
  no Electron harness, assertions on whether/with-what the dependency was called.
- `src/main/index.ts:245-356` — the single `onCommand(ipcMain, (command) => { switch … })` block.
  Add one `case 'notify':` alongside the others. Note how the root closes `mainWindow` and
  `downloadsDir` into their handlers — you close `mainWindow.isFocused()` and Electron's
  `Notification` in the same way.
- `src/main/index.ts:1` — the `import { … } from 'electron'` line; add `Notification` to it.
- `src/shared/ipc/commands.test.ts:119-237` — the `describe('isRendererCommand', …)` block and the
  bare-member / malformed-payload assertion idioms; add a parallel `notify` block.

## Context

Desktop push rides the relay socket the app already holds open — no Firebase, no push-wake path.
A backgrounded desktop app is not suspended, so turn-complete / prompt events already arrive over
the socket to a client that never disconnected. This slice is the **main-process delivery
primitive**: turn a `notify` command into an Electron `Notification`, but only when the window is
unfocused.

Two invariants are load-bearing and this slice exists to enforce both **by construction**:

1. **Focus is a main-process concept.** `BrowserWindow.isFocused()` and the Electron `Notification`
   API are both main-only, so the fire-decision and the OS call live in `src/main/`. Focus is queried
   at fire-time via a synchronous `isFocused()` — there is **no separate stateful focus tracker**.
   `isFocused()` is already `false` when the window is blurred, minimized, or hidden — exactly the
   notify condition.
2. **No daemon-relayed text can reach an OS notification.** The command carries a **closed `kind`
   enum, never free text**. The main process owns the copy table and maps `kind` → title/body. It is
   impossible by construction for a permission-prompt title, an assistant message, or a workspace path
   to ride into a notification and appear on a lock screen.

## Design

### 1. Command union member + payload type (`src/shared/ipc/commands.ts`)

Add three things, all co-located with the union:

```ts
export type NotifyKind = 'turn-complete' | 'prompt'
export interface NotifyPayload { kind: NotifyKind }
// …and in the RendererCommand union:
| { type: 'notify'; payload: NotifyPayload }
```

- Export `NotifyKind` and `NotifyPayload` — the main module imports `NotifyKind` (type-only), and
  #392 will import them to build the command.
- **This is the only member whose payload type is defined here, not imported from `../wire/types`.**
  Every other member reuses a wire payload because it is serialized to the daemon. `notify` is a
  **main-local side-effect command** that never reaches the transport — so its type is client-internal,
  like the derived `AnswerModalCommandPayload` (commands.ts:43). Add a short comment saying so, and
  extend the union's doc comment (commands.ts:50-96) with a `notify` sentence in the same style: a
  closed-enum member that carries no wire payload, no id, no secret.

### 2. Runtime guard (`src/shared/ipc/commands.ts`)

Add a module-private `isNotifyPayload` mirroring the `is*Payload` helpers, plus its `case`:

```ts
case 'notify':
  return 'payload' in value && isNotifyPayload(value.payload)
```

`isNotifyPayload` = structural object check **plus a closed-set equality on `kind`**:

- Behaviour: accept iff `value` is a non-null object with `kind` equal to one of the two literals
  (`'turn-complete'`, `'prompt'`); reject everything else.
- **Critical distinction from the sibling guards.** Every other `is*Payload` checks
  `typeof value.field === 'string'` — accepting *any* string. `isNotifyPayload` must **not**. It must
  test closed-set membership (`value.kind === 'turn-complete' || value.kind === 'prompt'`). A `typeof
  === 'string'` check here would defeat the entire by-construction guarantee: an arbitrary,
  possibly daemon-derived string would pass, and later map to nothing / undefined copy. The closed-set
  check is the security-relevant line of this slice. Call this out in the guard's doc comment.
- Extra fields are ignored (structural minimum, consistent with the other guards).

No `notifyCommand()` constructor in this slice. Several union members
(`createConversation`, `archiveConversation`, …) have no constructor and are built inline by their
callers; `notify` follows them. #392 (the trigger) builds `{ type: 'notify', payload: { kind } }`
directly, or adds a constructor then. Don't pre-build untested surface here.

### 3. Main-process module (`src/main/fireNotification.ts`, new)

Shape it like `emitDaemonEvent.ts`: a plain function, Electron dependencies injected as parameters,
**never imports `electron`**, unit-tests with fakes.

- **Injected Electron dependency** — a minimal structural interface for the `Notification`
  constructor, satisfied by the real Electron class (as `DaemonEventSink` is satisfied by
  `BrowserWindow`):

  ```ts
  export interface OsNotification { show(): void }
  export interface OsNotificationConstructor {
    new (options: { title: string; body: string }): OsNotification
  }
  ```

- **Main-owned copy table**, keyed by `kind` (AC5 — the notification text lives here, never in the
  command). Provisional client-invented copy (see Open questions):

  ```ts
  const NOTIFICATION_COPY: Record<NotifyKind, { title: string; body: string }> = {
    'turn-complete': { title: 'Pyrycode', body: 'Your turn is complete.' },
    prompt:          { title: 'Pyrycode', body: 'Waiting for your response.' }
  }
  ```

  `Record<NotifyKind, …>` makes the table exhaustive by construction — a future `kind` won't
  type-check until it has copy.

- **The function** — signature + behaviour (no body pre-written here):

  `fireNotification(kind: NotifyKind, deps: { isWindowFocused: () => boolean; Notification:
  OsNotificationConstructor }): void`

  Behaviour: if `deps.isWindowFocused()` returns true, return without firing. Otherwise construct
  `new deps.Notification(NOTIFICATION_COPY[kind])` and call `.show()` on it. Synchronous, no return
  value, no async, no logging (a log of the copy is harmless, but keep it out — the module has nothing
  to log). Import `NotifyKind` **type-only** from `../shared/ipc/commands` (relative path — `src/main`
  has no `@shared` alias; matches `emitDaemonEvent`'s relative import of `DaemonEvent`).

### 4. Wiring (`src/main/index.ts`)

- Add `Notification` to the `import { … } from 'electron'` line (index.ts:1) and
  `import { fireNotification } from './fireNotification'` beside the other main-module imports.
- Add the `case` to the single `onCommand` switch (index.ts:245-356):

  ```ts
  case 'notify':
    fireNotification(command.payload.kind, {
      isWindowFocused: () => mainWindow.isFocused(),
      Notification
    })
    return
  ```

  `mainWindow` is already in scope in the `whenReady` callback (`const mainWindow = createWindow()`).
  The focus query is a closure evaluated at fire-time — one synchronous `isFocused()` per command, no
  stateful tracker (Design invariant 1). This mirrors how the root closes `downloadsDir` into
  `saveDebugBundle` and `mainWindow` into `emitDaemonEvent`. Add a one-line comment in the same style
  as the neighbouring cases (dormant; fires only when unfocused; kind→copy owned by the module).

## State + concurrency model

None. No store, no async task, no subscription, no stream. `fireNotification` is a synchronous
main-process side-effect; focus is read at fire-time. Nothing to cancel or tear down — no new
listener is registered (the command rides the existing `onCommand` listener, already removed at
`will-quit`).

## Error handling

Minimal by design. The function is synchronous with no I/O and no failure path this slice must
surface. Two deliberate non-defences (evidence-based — no observed failure to guard):

- **No `Notification.isSupported()` gate.** Electron exposes it, but the AC doesn't require it and no
  unsupported-platform failure has been observed. Adding it now would be a defence against an
  unobserved failure mode. Defer until a platform surfaces it.
- **No try/catch around construct/`show()`.** Same reasoning; a throw here would be a genuine bug to
  surface loudly, not swallow.

The by-construction guarantees (focus gate; closed-enum copy table) are the load-bearing correctness
properties, and they are enforced by the guard + the type system, not by runtime error handling.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. No Electron harness — fakes only.

**`src/shared/ipc/commands.test.ts`** — add a `describe('isNotifyPayload / notify (#391)')` block
(mirror the existing `isRendererCommand` sub-blocks at :119-237):

- Accept a well-formed command for each kind: `{ type: 'notify', payload: { kind: 'turn-complete' } }`
  and `{ …, payload: { kind: 'prompt' } }` → `true`.
- Accept with an extra ignored field on the command (structural minimum) → `true`.
- Reject missing payload (`{ type: 'notify' }`) → `false`.
- Reject null payload → `false`.
- Reject payload without `kind` (`{}`) → `false`.
- **Reject a `kind` outside the closed set** — the AC2 keystone: `{ kind: 'evil' }`, `{ kind: '' }`,
  and a plausibly-daemon-derived string all → `false`. This is the assertion that proves free text
  cannot ride in.
- Reject a non-string `kind` (`{ kind: 42 }`, `{ kind: null }`) → `false`.

**`src/main/fireNotification.test.ts`** (new) — mirror `emitDaemonEvent.test.ts`'s fake pattern. Build
a fake `Notification` constructor (a `vi.fn()`-backed class capturing its options and exposing a
`show` spy) and a fake `isWindowFocused` returning a fixed boolean:

- **Fires when unfocused:** `isWindowFocused` → `false`; assert the constructor was called exactly once
  with the copy for the kind, and `.show()` was called exactly once.
- **Does not fire when focused:** `isWindowFocused` → `true`; assert the constructor was never called
  and `.show()` never called.
- **Each kind maps to its copy:** for `'turn-complete'` and `'prompt'`, assert the captured
  constructor options deep-equal the expected `{ title, body }` — this pins the copy table (AC5, AC7)
  and proves the text comes only from `kind`, since `kind` is the function's sole content input (no
  text field exists on the command to leak).

Type-level coverage: `Record<NotifyKind, …>` on the copy table and the `NotifyKind` param give
compile-time exhaustiveness; `npm run typecheck` covers both process sides.

## Open questions

- **Copy wording is provisional.** `'Your turn is complete.'` / `'Waiting for your response.'` are
  client-invented placeholders (no Figma, no daemon source). The architectural invariant — *static,
  main-owned strings keyed by `kind`, never sourced from the command* — is what matters; exact wording
  can be tuned when the feature goes live behind #392's trigger. Low-stakes now (dormant, nothing
  renders it). Developer may keep these as-is.
- **`Notification` structural assignability.** The real Electron `Notification` should satisfy
  `OsNotificationConstructor` structurally (its options type is a superset with all-optional fields;
  `.show()` exists), so no cast is expected at the wiring site. If `typecheck` disagrees, widen the
  injected options type to `{ title?: string; body?: string }` rather than casting — keep the fake and
  the real type honest.

## Acceptance criteria coverage

- AC1 (closed-`kind` union member, no free text/id/secret) → Design §1.
- AC2 (guard accepts well-formed, rejects malformed incl. out-of-set kind) → Design §2 + tests.
- AC3 (fires when unfocused) / AC4 (no fire when focused) → Design §3–4 + tests.
- AC5 (title/body from main-owned copy table; no command field supplies text) → Design §3 copy table.
- AC6 (routed through the single `onCommand` switch) → Design §4.
- AC7 (unit tests: fire-when-unfocused, no-fire-when-focused, each kind→copy, fakes only) → Testing
  strategy.
