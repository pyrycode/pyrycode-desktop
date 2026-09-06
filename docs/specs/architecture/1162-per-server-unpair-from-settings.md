# 1162 — Each server row unpairs its own server, and only the last one routes to pairing

## Files read

- `src/renderer/src/screens/settings/ServerRow.tsx` → `ServerRow`, `ServerRows`, `ServerRowControl` —
  the pure view / pure list view / store-bound container split this slice extends. The row already
  holds its own `serverId`, so nothing new is needed to name the server.
- `src/renderer/src/screens/settings/SettingsScreen.tsx` → `SettingsScreen` — takes `onBack` and
  `onPairAnother` today; the callback threading crosses it.
- `src/renderer/src/screens/settings/settings.css` → `.settings__server-row` and its text-column
  children — the geometry the action sits beside (`display: flex`, `align-items: center`, the text
  column is `flex: 1 1 auto`, so a trailing action needs no new layout rule).
- `src/renderer/src/PairedShell.tsx` → `PairedShellView`'s `settings` case and `PairedShell`'s
  `pairingChangeDeps` / `onUnpaired` wiring — where the route flip is bound.
- `src/renderer/src/applyPairingChange.ts` → `applyPairingChange`, `PairingChange` — the `unpaired`
  arm's clear-then-navigate, and the docblock that will otherwise go stale on a second caller.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `runUnpair`, `UnpairDeps`,
  `UNPAIR_FAILED_ERROR` — the fail-safe posture to inherit, and the `sessionStore` dispatch this
  slice must NOT inherit.
- `src/renderer/src/store/serverInfoLoader.ts` → `loadServerInfo`, `mapServerInfo`, `ServerInfoData` —
  the one-shot fetch; `loadServerInfo` is the refresh surface this slice reuses.
- `src/renderer/src/store/serverInfoStore.ts` → `setServers`, `selectServers`, `ServerInfoValue` —
  whole-list overwrite, read by reference, so one write re-renders the rows.
- `src/shared/ipc/unpair.ts` → `UnpairResult`, `isUnpairServerRequest`, `UNPAIR_SERVER_CHANNEL` — the
  value-free response and the boundary guard #1149 shipped.
- `src/shared/ipc/serverInfo.ts` → `ServerInfo` — the two-arm union; `unavailable` collapses *nothing
  paired* and *unreadable collection* together, which decides the "no records remain" read below.
- `src/preload/index.ts` → `unpairServer` — the bridge method, wired and caller-less.
- `e2e/fixtures/launchPairedApp.ts` → `secondServer`, `PairedServerHandle`, `FIRST_SERVER_ID`,
  `SECOND_SERVER_ID` — the two-daemon launch, and the two ids that share a prefix.
- `e2e/multi-server-launch.spec.ts` → the `.settings__server-row-id` **array-form** `toHaveText`
  assertion — the exact-text read AC3 needs, immune to `hasText`'s substring matching.
- `docs/knowledge/features/unpair-channel.md` § The per-server channel (#1149) — the listener order
  (guard → `clearServer` → `matched?` → `clearFor` → `reconcile()`), and that `reconcile()` drops
  exactly the departed connection and leaves the rest live.
- `docs/knowledge/features/settings-screen.md` § The Server row(s) — why the loop lives on the
  exported view rather than in the container (the container's populated branch is unreachable under
  `renderToStaticMarkup`). This slice puts the confirm-phase matrix on the same exported view for the
  same reason.
- `docs/knowledge/features/paired-shell-routing.md` — the `settings` route replaces the whole shell.

## Design source

**Figma:** N/A — echoed from the ticket. The Settings Server row (17:12) is drawn without a per-row
action, and #1090 records the Settings home as an operator-taken INTERIM decision pending Juhana's
ruling on whether the action belongs on the sidebar host row (#1070). The row itself is unchanged and
stays anchored to 17:12; only the action is new. The visual-fidelity check is therefore intentionally
skipped, and the action's appearance follows the deleted `UnpairControl`'s two-phase text-button shape
plus the screen's existing tokens rather than a drawn node.

## Context

Unpair lost its only healthy-pairing entry point when #1061 deleted `UnpairControl`. #1148 gave
Settings a row per paired server; #1149 shipped the per-server erase — `window.pyry.unpairServer`,
its own channel, its own guard — with no caller. This slice wires the caller: an action on each row,
a per-row confirm, a list refresh so the departed row goes, and a route flip to the pairing screen
that becomes **conditional on no records remaining** instead of unconditional.

No ADR is warranted. The one decision with reach beyond this ticket — that the interim home is the
Settings row rather than the sidebar host row — is already recorded on #1090 and #1061.

### Size re-count (§ A5), against this written plan

| Boundary | Limit | This plan |
|---|---|---|
| Production source files (`*.ts`/`*.tsx` under `src/`, tests excluded) | ≤ 5 | **6** — over |
| Total written work | ≤ 800 | **~880** — over |
| New exported types / interfaces / components / stores | ≤ 5 | 3 (`UnpairServerDeps`, `ServerRowUnpair`, `runUnpairServer`) |
| Consumer call sites needing simultaneous update | ≤ 10 | 4 (`ServerRowControl`, `PairedShellView`'s `settings` case, and the two test render helpers) |
| Acceptance criteria | ≤ 5 | 4 |
| Distinct error/reject branches | ≤ 10 | 2 (`unpairServer` rejects; `result: 'error'`) |

The six production files: `screens/settings/ServerRow.tsx`, `screens/settings/SettingsScreen.tsx`,
`screens/settings/unpairServerAction.ts` (new), `store/serverInfoLoader.ts`, `PairedShell.tsx`,
`applyPairingChange.ts` (comment-only). `settings.css`, the unit tests and the e2e spec are outside
the file ceiling's definition but inside the ~880.

Two boundaries are exceeded and the ticket ships anyway: **split depth is exhausted** — `gh api
graphql` reports `parent 1152 grandparent 1090` — so § A1's depth-capped path applies: do not split,
do not stop, build it. `needs-human:sizing` is already on the ticket, applied by the refiner, whose
Size Estimate section records the same measurement and the same two rejected seams. I re-derived both
independently and reach the same conclusion, including on the floor rule: splitting the route
condition out leaves a slice with nothing observable, and splitting the row action out the other way
leaves the unconditional flip standing — an intermediate that drops the operator on the pairing screen
with a server still paired.

The one place my count differs from the refiner's: it named `screens/conversation/unpairAction.ts` as
a sixth file and `ConversationScreen.tsx` as a possible seventh. This plan touches neither — see
"A sibling helper, not a widened `runUnpair`" below — and spends the file it saved on
`applyPairingChange.ts`'s docblock instead.

## Design

### The shape of the change

```
ServerRow (pure view)            ← renders the action; phase in, callbacks out
ServerRows (pure list view)      ← threads per-row phase + callbacks
ServerRowControl (container)     ← owns the ONE armed-row state; wires window.pyry at click time
   └─ runUnpairServer(deps, id)  ← NEW pure helper: erase → refresh → conditionally flip the route
SettingsScreen                   ← threads `onUnpaired` down
PairedShellView / PairedShell    ← binds it to the existing applyPairingChange(deps, 'unpaired')
```

### `runUnpairServer` — the whole decision, in one pure helper

New module `src/renderer/src/screens/settings/unpairServerAction.ts`, mirroring `unpairAction.ts`'s
posture (React-free, effects injected, tested with plain spies).

```ts
export interface UnpairServerDeps {
  unpairServer: (serverId: string) => Promise<UnpairResult>
  refreshServers: () => Promise<ServerInfoValue[]>
  onLastServerUnpaired: () => void
}

export function runUnpairServer(deps: UnpairServerDeps, serverId: string): Promise<'ok' | 'error'>
```

Behaviour, in order:

1. `await deps.unpairServer(serverId)`. A rejected invoke or `{ result: 'error' }` → return `'error'`
   having done nothing else. Fail-safe by construction, inherited from `runUnpair`: no refresh, no
   route flip, no clear on any non-`ok` outcome.
2. On `{ result: 'ok' }` → `await deps.refreshServers()`, which re-reads the collection and writes the
   store. This is AC3: the departed row leaves because the list was re-fetched, not because anything
   mutated it locally.
3. If — and only if — that refreshed list is **empty**, call `deps.onLastServerUnpaired()`. That is
   AC4. A non-empty list means records remain, so the shell stays up and nothing is cleared (AC3).
4. Return `'ok'`.

**Why the refresh is also the "no records remain" read.** #1149 refused to widen `UnpairResult` on
purpose, and `clearServer`'s `remaining` is deliberately not returned. The answer therefore has to
come from a read the renderer already has, and `serverInfo` is that read: one invoke answers both the
list refresh and the route condition, so the two can never disagree about how many servers are left.

**The one collapse this inherits, stated rather than hidden.** `ServerInfo`'s `unavailable` arm
covers *nothing paired* **and** *the collection could not be read*, and `loadServerInfo` additionally
maps a rejected invoke to `[]`. So `[]` here means "no readable record remains", not strictly "no
record remains". Both non-empty-but-unreadable cases route to the pairing screen. That is the correct
outcome for an unreadable collection — `decodeCollection` treats a malformed collection as absent, so
`pairingStatus` already answers *not paired* and the app is unpaired in every sense that matters. For
the rejected-invoke case it is a mis-route, but only on a path where the main-process bridge has gone
after having just answered an unpair a moment earlier, and it self-corrects on relaunch because
`pairingStatus` reads the disk. Widening `loadServerInfo` to distinguish them would add an
impossible-state distinction no other consumer reads — the same test `serverInfoStore` applied when it
declined `ServerInfoValue[] | null`.

### A sibling helper, not a widened `runUnpair`

`runUnpair`'s error arm dispatches `UNPAIR_FAILED_ERROR` into the one app-wide `sessionStore`. From a
Settings row that is wrong: one server's failed erase would put the whole app into a `failed` session
status while the *other* server is connected and its conversation is fine.

The constraint is met **by the type, not by a rule**: `UnpairServerDeps` has no `dispatch` member at
all, so there is no name in this module by which a session-store write could be reached. A future
edit cannot reintroduce the degradation without first widening a reviewed interface.

This also keeps `runUnpair`'s `unpair` dep nullary, so `ConversationScreen.tsx` — its one existing
caller — is untouched, and #1163 can migrate and delete the whole-collection path without unpicking a
shared dep shape first.

**How the failure surfaces:** the row returns to `idle` and stays in place. No banner, no session
degradation, no row-local error copy. Reddening any richer affordance needs a main-side throw the fake
tier cannot currently drive, so a surface with no test behind it would be a defence for an unobserved
failure. Retrying is the affordance: the action is right there, un-armed.

### The per-row confirm, and why two rows cannot cross wires

`ServerRowControl` holds **one** phase value for the whole list:

```ts
type UnpairPhase =
  | { kind: 'idle' }
  | { kind: 'confirming'; serverId: string }
  | { kind: 'unpairing'; serverId: string }
```

A single armed id makes "arming row B leaves row A armed" **unrepresentable** — there is no second
slot to hold it. That is the structural half of the ticket's constraint, and it is why the state is
one value rather than a per-row `Set` or a `useState` inside each row.

The second half — "a second row's Unpair must never fire the first row's confirmed erase" — is
belt-and-suspenders in different fabric: the Confirm button reports **the row's own `serverId`**
(`onConfirm(serverId)`), not the armed id read back out of the phase. The two agree by construction
(only the armed row renders a Confirm button), and if they ever stopped agreeing the erase would still
name the row the operator clicked.

The three phases follow the deleted `UnpairControl` (#166) verbatim in shape: idle → an "Unpair"
button; confirming → a prompt plus Cancel and Confirm; unpairing → both disabled, Confirm reading
"Forgetting…", so a double-click cannot launch a second erase.

### Props: required, not optional

`ServerRow` and `ServerRows` take a required `unpair: ServerRowUnpair` — `{ phase, onArm, onCancel,
onConfirm }` for `ServerRow`, and the list-shaped equivalent for `ServerRows`. Required follows
`PairedShellView`'s `paneKey` rule: forgetting to wire the action is the exact regression the prop
exists to prevent, so it is a compile error rather than a silent `undefined`. The existing
`ServerRow.test.tsx` absorbs this in its two render helpers, not at every call site.

The action renders only in the **populated** branch — the `null` (loading) row has no `serverId` to
name, so there is nothing for it to erase.

### Copy and accessibility

Client-owned module constants beside `SERVER_ROW_LABEL` (the SETTINGS_COPY idiom): `Unpair`,
`Forget this server?`, `Cancel`, `Confirm`, `Forgetting…`.

**No `serverId` in an `aria-label`.** `serverId` is `record.server`, which arrived in a pairing
payload — daemon-authored text, and CLAUDE.md's rule forbids it in an attribute. So the buttons carry
their own text as their accessible name and repeat across rows; the row's rendered id line is what
distinguishes them visually, and e2e selects by row position over the store's pinned order rather than
by an accessible name.

### Threading

`SettingsScreen` grows a required `onUnpaired: () => void` beside `onBack` and `onPairAnother`, passed
to `ServerRowControl`. `PairedShellView`'s `settings` case passes its existing `props.onUnpaired`
straight through — the same callback the `thread` case already hands `ConversationScreen`, already
bound in `PairedShell` to `applyPairingChange(pairingChangeDeps, 'unpaired')`.

So the route flip reuses the existing clear-then-navigate arm **unchanged**: when the last record
goes, this path ends the app's pairing exactly as the whole-collection path does, and the thirteen
stores are cleared before the pairing screen renders.

### Why `applyPairingChange.ts` is not changed behaviourally

The ticket's technical notes nominate the `unpaired` arm as the place the route flip becomes
conditional. This plan puts the condition one level out, in `runUnpairServer`, and leaves the arm
alone. Three reasons:

1. `applyPairingChange` owns *what a change does*, not *whether a change happened*. "Did this erase
   end the app's pairing?" is answered by the refreshed record count, which only the caller has.
2. Making the arm conditional would mean either a fourth `PairingChange` member whose arm does
   **nothing** (no clear, no navigate — an empty case in a union whose whole point is that each arm
   answers the clear question), or a `remaining` argument that would give the helper a gate, a return
   value and a reason to read state it deliberately does not read.
3. `'unpaired'`'s contract — a pairing ended, so clear and leave — stays exactly true, because
   `runUnpairServer` passes it only when nothing remains.

What does change there is the docblock: the `unpaired` member currently reads as though `runUnpair` is
its only trigger. A second caller that reaches it *conditionally* is precisely the kind of thing that
goes stale unnoticed in this repo, so the member's doc names it. Comment-only; no behaviour, no
signature.

### `loadServerInfo` returns what it wrote

Widen `loadServerInfo`'s return from `Promise<void>` to `Promise<ServerInfoValue[]>` — the mapped list
it just handed `setServers`. Purely additive: `ServerInfoData` calls it as `void loadServerInfo(…)`
and is unaffected, and its "always resolves, never rejects into the renderer" contract is untouched.
This is what lets the refresh be *one* function rather than a near-duplicate of it in the container.

## State + concurrency model

- **Store slices.** `serverInfoStore` only. `setServers` replaces the whole list, `selectServers`
  returns it by reference, and `ServerRowControl` subscribes through the narrow slice — so one refresh
  write re-renders exactly the rows. `serverInfoStore` is deliberately not in
  `clearPairingScopedState`'s thirteen (it self-heals on the next Settings mount); this slice does not
  change that, it just makes the self-heal fire on demand as well as on mount.
- **Confirm phase** is screen-local `useState` in `ServerRowControl` (ADR 0006), like the deleted
  control's. It resets on unmount, so leaving and re-entering Settings lands every row un-armed.
- **Async.** One `void`-ed promise chain per confirmed erase, started in the click handler. `phase:
  'unpairing'` disables both buttons for its duration, so a double-click cannot start a second one
  (`clearServer` is idempotent regardless).
- **Teardown.** No subscription, no timer, no `AbortSignal`: a one-shot invoke pair, exactly
  `ServerInfoData`'s shape. The one late-resolution case is the last-server erase, where
  `onLastServerUnpaired` unmounts the whole shell — the trailing `setPhase` after unmount is a
  harmless React 18 no-op, which is also how `UnpairControl` handled its `ok` branch.
- **`window.pyry` is dereferenced inside the click handler only**, never during render, so
  `ServerRowControl` stays server-renderable without a bridge mock.
- **Main-side concurrency is unchanged.** `clearServer` computes `{ matched, remaining }` atomically
  inside its own mutate queue, and `registry.reconcile()` drops exactly the departed connection.
  There is no check-then-act gap on this path: the renderer's refresh happens strictly *after* the
  erase resolved.

## Error handling

| Failure | Where | Result |
|---|---|---|
| `unpairServer` rejects (handler absent) | `runUnpairServer` step 1 | `'error'`; no refresh, no flip, no clear |
| `{ result: 'error' }` — guard refusal, unheld id, or `clearServer` threw | step 1 | same, indistinguishable by design (#1149) |
| `serverInfo` refetch fails after a successful erase | `loadServerInfo` swallows → `[]` | routes to pairing; see the collapse note above |
| Double-click on Confirm | `phase: 'unpairing'` disables both buttons | second click impossible |

Nothing on this path is logged. That extends `applyPairingChange`'s and `clearPairingScopedState`'s
existing no-diagnostic property, and there is no observed failure to instrument; a `serverId` in a log
line would violate ADR 0007's content-free rule anyway, and a bare count would say nothing.

## Testing strategy

**Vitest (`environment: 'node'`, static server renders + plain spies):**

- `unpairServerAction.test.ts` (new) — the helper's full matrix with spies:
  - `{ result: 'ok' }` + a refresh returning one remaining server → refreshes, does **not** call
    `onLastServerUnpaired`, returns `'ok'`.
  - `{ result: 'ok' }` + a refresh returning `[]` → calls `onLastServerUnpaired` exactly once,
    returns `'ok'`.
  - `{ result: 'error' }` → returns `'error'`; **neither** `refreshServers` nor
    `onLastServerUnpaired` is called.
  - a rejected `unpairServer` → same as above, and the promise resolves rather than rejecting.
  - the erase is invoked with **exactly the `serverId` passed in**, once.
  - the deps interface carries no dispatch — pinned as a compile-checked construction of the deps
    object in the test, so a re-added session write cannot land unreviewed.
- `ServerRow.test.tsx` — the phase matrix on the pure views, server-rendered:
  - idle → an "Unpair" button, no prompt, no Confirm.
  - confirming → prompt + Cancel + Confirm, both enabled.
  - unpairing → Confirm reads "Forgetting…", both buttons carry `disabled`.
  - a two-entry `ServerRows` with row 0 confirming → row 1 still shows its idle "Unpair" and no
    prompt (the per-row arming, provable in a static render because the phase is a prop).
  - the `null` (loading) row renders no action at all.
- `serverInfoLoader.test.ts` — `loadServerInfo` resolves to the list it wrote, on the available,
  unavailable and rejected paths.
- `SettingsScreen` / `PairedShell` specs — the `settings` case passes `onUnpaired` through (a
  wiring pin, so the prop cannot be dropped silently).

**Playwright, fake tier — `e2e/settings-per-server-unpair.spec.ts` (new).** This is where the
interaction and the two-server outcomes live; nothing in this repo can click in a unit test. One spec
on `launchPairedApp({}, { secondServer: {} })`:

1. Open Settings; baseline `.settings__server-row-id` `toHaveText([FIRST_SERVER_ID,
   SECOND_SERVER_ID])`.
2. Click row 0's Unpair → its prompt appears **and row 1 shows none** (AC2 + per-row arming).
3. Confirm → `.settings__server-row-id` `toHaveText([SECOND_SERVER_ID])` — AC3, count *and* identity
   in one exact-text array read.
4. The Settings section is still visible and `[aria-label="Pairing code"]` has count 0 — AC3's "stays
   in the paired shell", with no relaunch and no re-entry into Settings.
5. Unpair the survivor → `[aria-label="Pairing code"]` becomes visible — AC4.

**The assertion trap, handled.** `FIRST_SERVER_ID` (`'fake-daemon'`) is a substring of
`SECOND_SERVER_ID` (`'fake-daemon-2'`), and Playwright's `hasText`/`getByText` are case-insensitive
substring matches — so a filter for the first id selects **both** rows and step 3 could pass for the
wrong reason. Every identity assertion here is therefore the **array form of `toHaveText` over
`.settings__server-row-id`**, which pins the exact string of every row in store order (oldest-paired
first) and fails on a wrong count, a wrong order or a wrong survivor. Rows are addressed for clicking
by **position** (`.nth(0)`), never by a text filter. This is `multi-server-launch.spec.ts`'s own
assertion, reused deliberately.

**What this spec deliberately does not assert:** the channel list after the first unpair.
`clearPairingScopedState` does not run on that path in this slice, and whether the surviving server's
rows are re-listed depends on a session status re-assertion this slice neither owns nor drives
(#1150 scopes the clear). AC3 is worded against the Settings rows and the shell route for exactly that
reason, and pinning an outcome the app may not realize is the #440 discipline this repo already
rejects.

**Fakes over mocks:** the e2e tier drives real fake daemons through the real bridge; the unit tier
injects plain spies. No `vi.mock` of the store module anywhere — the phase matrix is on the pure view
precisely so it needs none.

## Open questions

1. **Should the failed-unpair path grow a visible affordance?** Deferred: reddening one needs a
   main-side throw the fake tier cannot drive. Resolution recorded here — the row returns to idle and
   the action is the retry. Revisit if a failure is ever observed.
2. **Does the surviving server's channel list repopulate after the first unpair?** Out of scope and
   deliberately unasserted; #1150 owns the scoped clear that makes the question answerable.
3. **Will the action stay in Settings?** #1070 may move it to the sidebar host row. The pure view /
   container split keeps the move cheap: `runUnpairServer` and the phase model are surface-agnostic.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one boundary this slice feeds is
  `UNPAIR_SERVER_CHANNEL`, and it is unchanged: `isUnpairServerRequest` is the single explicit
  renderer→main guard, applied before any store call, and it already rejects a non-object, `null`, a
  missing or non-string `serverId`, and one over `MAX_SERVER_ID_LENGTH`. This slice adds a **caller**,
  not a boundary. The value it sends is a `serverId` the renderer read back from `serverInfo`, which
  main sourced from its own at-rest record — so the renderer cannot widen what main will accept, and
  the design assumes nothing about that value's trustworthiness: it is passed through and compared
  with `===` main-side, exactly as #1149 built it.
- **[Tokens, secrets, credentials]** No findings. Nothing on this path can materialise a credential:
  `UnpairServerDeps` reaches only `unpairServer` (response is `UnpairResult`, value-free by
  construction — no member has a field beyond the discriminant) and `serverInfo` (structurally two
  non-secret fields per entry; `token` and `server_static_pubkey` are absent from the union type).
  Revocation is exactly what this ticket ships, and it is now per-device rather than all-or-nothing —
  a strict improvement on the whole-collection path. The at-rest erase and the `safeStorage`-backed
  store are #1149's and are untouched.
- **[File / storage operations]** No findings, by construction: this slice is renderer-only and
  performs no filesystem operation. `serverId` never becomes a path segment, a store name or an object
  key anywhere in the new code — it is a React `key`, a call argument and rendered text, and a React
  key never reaches the DOM. The atomicity and TOCTOU questions live in `clearServer`'s mutate queue,
  which this slice calls without changing.
- **[Inter-process / Electron attack surface]** No findings. No new `contextBridge` method, no new
  `ipcMain.handle`, no `webPreferences` change, no protocol or navigation handler. The renderer
  capability being exercised — trigger a per-server unpair — already exists in the preload bridge and
  was audited at #1149; this slice makes it reachable from the UI, which is the ticket. Worth naming
  explicitly: a compromised renderer gains **nothing** here that it did not already have, because
  `window.pyry.unpairServer` has been callable from the renderer since #1149 with or without a button.
  Availability is the residual exposure — a compromised renderer can forget pairings — and it is
  inherent to shipping an unpair feature at all, mitigated only in that the erase is idempotent and
  destroys no message content.
- **[Cryptographic primitives]** Not applicable, and the design decision that makes it so: this slice
  contains no randomness, no comparison against a secret, and no handshake code. It never sees key
  material — the transport stays in main, and `reconcile()` is triggered main-side by the handler, not
  by the renderer.
- **[Network & I/O]** Not applicable directly — no socket, no URL construction, no timeout to set.
  One second-order note: a successful erase triggers `registry.reconcile()`, which drops exactly the
  departed connection and leaves the others live and un-handshaken. That is #1149/#1117's mechanism
  and this slice neither changes it nor adds a reconnect path that could spin.
- **[Error messages, logs, telemetry]** No findings, and it is a deliberate design decision rather
  than an omission: **nothing on this path logs**, so no `serverId`, no relay URL and no caught object
  reaches a log line, a console, or a renderer DevTools sink — extending
  `unpairHandler`'s log-free-by-construction property to its first caller. User-facing copy is
  client-owned module constants only ("Unpair", "Forget this server?", "Forgetting…"); no error detail
  is surfaced, which is consistent with `UnpairResult`'s refusal to carry a reason. The failure path
  deliberately does **not** dispatch `UNPAIR_FAILED_ERROR`, so it cannot even leak "a per-server erase
  failed" into an app-wide status a screenshot would show.
- **[Concurrency]** No findings. No long-lived task, no timer, no listener, so nothing to abort or
  remove. The one check-then-act shape to name is *erase → re-read the count → maybe route*: the read
  is strictly after the erase resolves, it is a fresh read of main's own state rather than a cached
  one, and the worst outcome of a concurrent second erase (impossible from this UI — `unpairing`
  disables both buttons and only one row can be armed) would be routing to pairing one refresh early,
  which is the correct destination anyway once the last record goes.
- **[Threat model alignment]** Covered. *Malicious relay*: not on this path — the erase is
  local-only and completes with no relay involvement, so a hostile relay cannot block a user from
  forgetting a machine. *Token theft from disk*: this slice's whole purpose is to make removal
  reachable per device, which lowers the standing exposure. *Hostile daemon response*: the only
  daemon-authored value touched is `serverId`, rendered as an escaped React child and never placed in
  an attribute, a URL, a log or a lookup path — the CLAUDE.md rule, upheld explicitly by the decision
  **not** to put it in the buttons' `aria-label`. *Renderer compromise reaching the transport*:
  unchanged — no keys, sockets or raw bytes enter the renderer here.
- **[Availability / denial-of-function]** OUT OF SCOPE — a renderer bug that fires a confirmed erase
  without operator intent. Structurally bounded here (a two-phase confirm, one armed row at a time,
  the erase named by the row that rendered the Confirm), and #1150's scoped clear is the next slice
  that touches this path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
