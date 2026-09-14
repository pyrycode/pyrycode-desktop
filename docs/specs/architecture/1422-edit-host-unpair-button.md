# 1422 — the Edit host dialog gets an Unpair host button

## Files read

- `src/renderer/src/screens/channels/EditHostDialog.tsx` → `EditHostDialogView`, `EditHostSaveStatus`,
  `requestSetHostLabel` — the view this ticket extends, and the precedent for a non-React decision helper
  exported beside the view it serves.
- `src/renderer/src/screens/channels/EditHostDialog.test.tsx` → `renderView`, `SAVE_DISABLED`,
  `INPUT_DISABLED` — the server-render harness the new arms extend. Its header records the fact that
  drives this plan's testing strategy: `ChannelList.test.tsx` cannot render this dialog at all.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList` (the container's `editHostServerId`
  / `editHostName` / `editHostStatus` cells and the `onSave` arrow) — where the phase and the effects live.
- `src/renderer/src/screens/settings/unpairServerAction.ts` → `runUnpairServer`, `UnpairServerDeps` — the
  decision helper reused verbatim; its header states the no-`dispatch` constraint and the fail-safe rule.
- `src/renderer/src/screens/settings/ServerRow.tsx` → `UnpairPhase`, `ServerRowUnpair`, `UnpairAction`,
  `ServerRowControl` — the confirm shape and copy idiom mirrored here, and the `navigateToList: () => {}`
  this caller must *not* copy.
- `src/renderer/src/clearServerScopedState.ts` → `serverScopedClearDeps`, `ClearServerScopedStateDeps` —
  the one shared clear set, and the `Omit<…, 'navigateToList'>` that pins the member each caller binds.
- `src/renderer/src/PairedShell.tsx` → `PairedShellView` (its `<ChannelList>` render), `PairedShell`'s
  `onBack` and `onUnpaired` bindings, `exitConversationDeps` — the shell props this ticket threads down.
- `src/renderer/src/components/Modal.tsx` + `src/renderer/src/components/modal.css` → `Modal`,
  `.modal__action--cancel` — the outlined-button tokens the new button matches.
- `src/renderer/src/screens/channels/channels.css` → the `.edit-host*` block the new classes join.
- `docs/knowledge/features/edit-host-dialog.md` — the dialog's container-state and copy rules.
- `docs/knowledge/features/unpair-channel.md` § The two renderer callers — why the route flip lives in
  `runUnpairServer` and why `UnpairServerDeps` carries `clearServerScopedState`.

Codegraph was unavailable in this worktree (`.codegraph/` holds `config.json` with no index;
`codegraph_context` answered *not initialized*), so the surface above was mapped by grep and Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2078

The dialog is the shared `Modal` at 646px, unchanged. Inside the content column, below the Host name
field and above the centred Cancel/OK footer, an `Actions` frame with 8px top padding holds a single
left-aligned outlined button reading **Unpair host** — 128×40, a 1px `schemes/primary` border, 6px
radius, transparent fill, `primary` body-large-emphasized text. Those are exactly the footer Cancel
button's tokens (`.modal__action--cancel`), so the new class reuses that recipe rather than restating
literals. The confirming state is not drawn in Figma; it mirrors the Settings row's inline prompt.

## Context

The only way to forget a still-working host today is the Settings server row, which since #1162 arms an
inline confirm and then runs `runUnpairServer`. #1061's 2026-09-04 placement question asked for a
host-level home reached from the host row; this is it. Unpairing from here must behave exactly as the
Settings row does — same erase, same refresh, same route-or-clear — differing in one member only, and
the dialog must ask first because the same act also deletes that host's saved chats (Juhana, 2026-09-14).

No ADR is warranted: this adds a second caller to a decision helper whose contract is already recorded.

## Design

### The view — `EditHostDialogView` gains a slot, and the status type becomes one union

`EditHostSaveStatus` is **renamed to `EditHostStatus` and widened** to six arms rather than gaining a
sibling phase cell:

```
type EditHostStatus =
  | 'idle' | 'saving' | 'failed'                          // the rename round trip, unchanged
  | 'confirming-unpair' | 'unpairing' | 'unpair-failed'   // the unpair slot
```

One union, not two cells, because the ticket's constraint — *"saving" and "unpairing" cannot both be
true at once* — is then unrepresentable rather than maintained by a reset. That is `UnpairPhase`'s own
argument for holding one armed id for the whole Settings list. The rename is mechanical: the type has
one declaration and two consumers (`ChannelList.tsx`, `EditHostDialog.test.tsx`), and leaving a type
called `SaveStatus` holding `unpairing` is the drift this repo's naming discipline exists to avoid.

The stated consequence, rather than a hidden one: arming the confirm after a failed rename drops the
rename error line, and cancelling the confirm returns to `idle` rather than restoring it. AC2 asks that
Cancel return the slot to the idle button and says nothing about restoring an unrelated message; the
alternative — two cells that can disagree — costs the invariant above.

Derived in the view, computed inline so each disabled state is directly assertable in static markup:

- `busy` (Host name field + OK disabled) — `'saving' || 'unpairing'`. AC4.
- rename failure line — `'failed'` only; unpair failure line — `'unpair-failed'` only. Two copy
  constants, two arms, rendered in the same message slot beneath the field.
- slot arm — prompt-with-answers on `'confirming-unpair' | 'unpairing'`, the idle button otherwise
  (so `'unpair-failed'` shows the idle button *and* the failure line, which is AC4's wording).
- answers disabled — `'unpairing'` only. Footer Cancel is never disabled, in any arm, for the reason
  the view's existing docblock gives (`ipcRenderer.invoke` carries no timeout).

A new required prop object carries the effects, following `ServerRowUnpair`'s shape and its
required-not-optional rule:

```
interface EditHostUnpair { onArm: () => void; onCancel: () => void; onConfirm: () => void }
```

Nullary members, unlike `ServerRowUnpair`'s id-taking ones: there is exactly one host in this dialog
and the container already holds its id in `editHostServerId`, so there is no second row for an answer
to land on. The slot renders as a non-exported inline component inside the module, `UnpairAction`'s
posture.

### Copy

Four module-level constants beside `EDIT_HOST_ERROR_COPY`, following `UNPAIR_COPY`'s idiom —
client-owned, apostrophe-free, naming neither the label nor the server id: the verb `Unpair host`, the
prompt `Forget this host?`, the answers `Cancel` / `Confirm`, the in-flight answer `Forgetting…`, and
the failure line `Could not unpair this host`. The noun is *host*, not *server*, matching this
surface's own vocabulary.

### The container — `ChannelList` gains two props and one call

Two **required** injected nav effects, beside `onPairNewHost` and dereferencing nothing, so the
container stays server-renderable:

- `onHostUnpaired: () => void` — the route flip when the erase left nothing paired.
- `onLeaveConversation: () => void` — `navigateToList`, fired by `exitActiveConversation` only when the
  departed host owned the chat on screen.

Both are bound in `PairedShellView` from props `PairedShell` already supplies: `props.onUnpaired`
(already `applyPairingChange(pairingChangeDeps, 'unpaired')`) and `props.onBack` (already
`() => { leaveRecovery(); dispatch({ type: 'back' }) }`, byte-identical to the arrow `PairedShell`
spreads into `exitConversationDeps` at its delete and archive exits). So `PairedShell`'s container
gains **no** new prop or binding — the two arrows it needs already exist, one line each in the view's
`<ChannelList>` JSX. Copying `ServerRowControl`'s `navigateToList: () => {}` here would strand the
operator on a thread route for a host that is gone.

The deps this container builds are the Settings row's, with that one member changed:

```
{ unpairServer: window.pyry.unpairServer,
  refreshServers: () => loadServerInfo(window.pyry.serverInfo, serverInfoStore.getState().setServers),
  onLastServerUnpaired: onHostUnpaired,
  clearServerScopedState: (departed) =>
    clearServerScopedState({ ...serverScopedClearDeps, navigateToList: onLeaveConversation }, departed) }
```

No `dispatch` member — `UnpairServerDeps` has none, by the type, for the reason that helper's header
gives.

### The outcome mapping — one small exported helper, `runEditHostUnpair`

The container's glue is extracted into a framework-free exported function beside `requestSetHostLabel`
in `EditHostDialog.tsx`, not written inline. It is **not** a second decision helper: erase → refresh →
route-or-clear stays entirely inside `runUnpairServer`, which this calls. It maps that helper's
`'ok' | 'error'` onto the dialog's own two cells, and that mapping is the part with rules worth pinning:

```
runEditHostUnpair(deps: { unpair: () => Promise<'ok' | 'error'>;
                          setStatus: (s: EditHostStatus) => void;
                          close: () => void }): Promise<void>
```

- sets `'unpairing'` before awaiting;
- on `'ok'` calls `close()` and sets nothing further — the dialog is gone, and on the last-host path
  `PairedShell` unmounts with the route flip and takes it with it (a setState after unmount is a
  harmless React 18 no-op, `ServerRowControl`'s own posture);
- on `'error'` sets `'unpair-failed'` and does **not** close — the slot is back at the idle button, the
  field and OK are re-enabled, and the failure line is shown, which is the whole of AC4's failure half.

Extracting it is what makes the container's decision testable at all: `ChannelList`'s dialog branch is
unreachable under `renderToStaticMarkup` because `editHostServerId` starts `null` in every static
render — a fact `EditHostDialog.test.tsx`'s own header already records. See Testing strategy.

The `serverId` is captured in the render closure **before** the await, exactly as the save arrow fixes
it, so a late answer cannot land on another host.

**Both outcome arms are spelled as functional updaters, and that is load-bearing** (security review,
§ Concurrency). AC4 pins footer Cancel enabled during the flight, so the operator can dismiss this
dialog mid-erase and open it against a *different* host before the answer lands; the container's
arrows then hold the departed host's cells and would write host B's. The erase itself is immune by
construction — it is keyed by the captured id — but the message is not. The fix is not new machinery,
it is the correct spelling of the same two calls:

- close — `setEditHostServerId(prev => prev === serverId ? null : prev)`
- failure — `setEditHostStatus(prev => prev === 'unpairing' ? 'unpair-failed' : prev)`

Both updaters are pure, so StrictMode's double invocation is harmless. In the reopen case `prev` is
host B's id and `'idle'` respectively, so both are no-ops and B's dialog is untouched; on the ordinary
path they behave exactly as the unguarded calls would.

Phase resets to `'idle'` whenever `editHostServerId`
is cleared, which the existing `onEditHost` handler already does on every open (it sets all three
cells) — so AC2's "the dialog reopens idle" holds with no new reset code, and Cancel / OK / the close
control all clear `editHostServerId` through the one existing `onCancel`.

### Styling

New classes under the `.edit-host*` namespace in `channels.css`: `.edit-host__actions` (the
left-aligned row with 8px top padding), `.edit-host__unpair` (the outlined button, `.modal__action`'s
padding / border / radius / body-large-emphasized recipe restated against the same tokens),
`.edit-host__unpair--confirm`, and `.edit-host__unpair-prompt`. Not `.settings__server-unpair`, and no
class name shared with the workspace or conversation dialogs, for the Playwright-locator reason the
Edit host dialog knowledge page records.

## State + concurrency model

One container cell, `editHostStatus`, now spanning both round trips; no store slice is added. The
unpair's own state changes all land in stores the helper already writes: `serverInfoStore` via the
refresh, and the departed host's slices via `clearServerScopedState`. The in-flight window has no
cancellation path and deliberately does not gain one — `runUnpairServer` is a single `invoke` with no
`AbortSignal` to thread, and footer Cancel stays enabled so the operator always has an exit even if
main never answers; a Cancel mid-flight leaves the resolution writing cells on a closed dialog, which
is inert, exactly as the save path's is. No timer, no subscription, no listener is added.

## Error handling

`runUnpairServer` already coerces every failure — a `result: 'error'`, an unrecognised answer, and a
rejected invoke — to the single `'error'` outcome, and runs nothing downstream of the erase on it. This
ticket adds no new classification, only the dialog-side arm. The user-facing line is one client-owned
constant carrying no backend detail; `UnpairResult` is value-free by construction, so there is nothing
from main that could reach it even by accident. Nothing on this path logs — the same posture
`unpairHandler`, `runUnpairServer`, `clearServerScopedState` and `requestSetHostLabel` all hold, and
the only fields that would make a log line useful (server id, relay URL, label) are the ones ADR 0007
and CLAUDE.md forbid.

## Testing strategy

All of it is vitest (node environment, static server renders). No new Playwright spec: the Settings
unpair e2e already proves the erase, and this tier's `sidebar-host-edit.spec.ts` owns the click.

**`EditHostDialog.test.tsx`** — the view arms, extending the existing `renderView` harness with the new
status values and an injected `unpair` object of spies:

- idle: the outlined button renders with its verb, inside the actions row, after the field and before
  the footer; no prompt, no answers.
- `'confirming-unpair'`: prompt plus both answers replace the button in the same slot; both enabled;
  field and OK still enabled.
- `'unpairing'`: both answers disabled; field and OK disabled; footer Cancel enabled.
- `'unpair-failed'`: the idle button is back, the failure line renders, field and OK enabled.
- the two failure lines are exclusive — `'failed'` renders the rename copy and not the unpair copy, and
  `'unpair-failed'` the reverse.

**`EditHostDialog.test.tsx`, `runEditHostUnpair`** — plain spies, `unpairServerAction.test.ts`'s posture:
`'unpairing'` is set before the await; `'ok'` closes and leaves no further status write; `'error'` sets
`'unpair-failed'` and never closes.

**`ChannelList.test.tsx` gets no new assertion, deliberately.** Its `render()` helper server-renders
`ChannelListView`, and the new props are on the `ChannelList` *container*, whose dialog branch is
unreachable in a static render. An assertion there would have to mock the store module — the ceremony
`EditHostDialog.test.tsx` already declined in favour of injected props. The container's decision is
instead covered by `runEditHostUnpair` above, and its two nav bindings are required props, so a missing
one is a compile error rather than a silent `undefined`.

## Open questions

- Whether `runUnpairServer`'s import from `screens/settings/` into `screens/channels/` should instead
  move the helper to a neutral home. Resolved in favour of importing as-is: the ticket names reuse
  explicitly, and a move would touch the Settings caller and its test for no behavioural gain.
- Whether the failure line belongs in the actions slot or the existing message slot. AC4 says "rendered
  in the same message slot", so it goes beneath the field beside the rename copy.

## Revisions

**2026-09-14 — the plan's "no new Playwright spec" was wrong, and `e2e/sidebar-host-edit.spec.ts` had to
move regardless.** Two things surfaced in Phase B that the plan had not accounted for.

1. *AC2 is an interaction, and no tier above `e2e/` can answer it.* The plan leaned on the ticket's note
   that a live check is not required — true of the **erase**, which `settings-per-server-unpair.spec.ts`
   and `unpairServerAction.test.ts` already prove, but not of AC2's own claim, which is that clicking
   *Unpair host* **does not** unpair and arms instead. A static render cannot distinguish an arming click
   from a working erase, because it cannot click at all. A non-destructive spec was added to the dialog's
   existing drive: arm, assert the rows are all still there, disarm, re-arm, close by the footer, reopen
   idle. It confirms nothing, so it erases nothing and needs no second pairing.
2. *The new button lands in the middle of the dialog's tab order,* between the Host name field and the
   footer, and two existing assertions in that spec walked `field → Cancel → OK` by pressing Tab. Both
   were corrected to step through the new control, with an intermediate `toBeFocused` on it rather than a
   silent extra Tab — that is also where the button's keyboard reachability is now proven. This is a
   consequence of the design the plan chose (the Figma's placement), not a change to it.

The plan's Testing strategy should be read with these two additions; nothing else in it moved. Also
dropped, and never in the plan: a first draft of the view test invoked each button's `onClick` off the
rendered element tree. There is no precedent for that anywhere in this repo's renderer tier — CLAUDE.md
says in as many words that nothing here can click and that interaction belongs in `e2e/` — so it was
replaced with a markup assertion that the slot's Cancel and the footer's Cancel are separately
addressable, which is the property `e2e/` then needs to target them apart.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, but one decision is load-bearing and must not be undone in Phase B.
  The design crosses renderer → main exactly once, at `window.pyry.unpairServer(serverId)`, and the
  `serverId` is a **client-held** value — read from this client's own paired collection through
  `serverInfoStore` and captured by the pen click — never a daemon-asserted string. The *second*
  boundary is subtler: the departed-conversation id set inside `clearServerScopedState` comes from the
  departing daemon's own `conversationsReceived` reply. `serverScopedClearDeps` binds
  `getDepartedConversationIds` to the stricter `selectExclusiveConversationIdsFor` precisely so a
  confused or hostile paired daemon cannot name another machine's conversations and turn "forget host
  A" into "destroy host B's retained threads and close the chat the operator is reading on B" — a
  destruction with no backfill. This plan **spreads** that object and overrides `navigateToList` alone.
  Restating the deps literal at this third call site, or binding the shared `selectConversationIdsFor`,
  reintroduces exactly that. Same rule for the clear's internal ordering (ids read before the row drop,
  `clearLastReadFor` last): this ticket calls the helper, it does not re-implement it.
- **[Tokens, secrets, credentials]** No findings. Nothing here generates, reads, stores, compares or
  transports a secret. The pairing record (bearer `token`, `server_static_pubkey`) lives only behind
  `SecureStore` in main, and the renderer's whole capability on this channel is "erase the record for
  one named server": `UnpairResult` is value-free *by construction* — the type has nowhere to put a
  token, relay URL, keychain path or error detail — so no new surface can leak one. OUT OF SCOPE, named
  rather than skipped: daemon-side revocation of the device token on unpair is a protocol-level concern
  owned upstream in `pyrycode`; this ticket erases the local record only, and does not change that.
- **[File / storage operations]** No findings. No path is constructed, resolved or joined anywhere on
  this path. Exactly one effect reaches outside memory — `clearLastReadFor` → `localStorage` — and both
  of its constraints (it runs last, after the loop, so a throw aborts nothing and #777's bridge cannot
  re-mint a departed mark) live inside `clearServerScopedState`, which this design calls rather than
  re-implements. See the trust-boundary finding for why that is not a stylistic preference.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` member,
  window, protocol handler or navigation guard is added — this is a *second caller* of
  `UNPAIR_SERVER_CHANNEL`, already guarded main-side by `isUnpairServerRequest`, so a compromised
  renderer gains no capability it did not already have. The `relayUrl` this dialog displays remains a
  display string only: it is never dialled, never an attribute, URL, filename or lookup key, and the new
  button adds no sink for it.
- **[Cryptographic primitives]** Not applicable by design: nothing on this path generates randomness,
  hashes, derives a key, or compares a value against a secret. The Noise session is untouched — an
  unpair erases a record in main; it sends no daemon command and opens no socket.
- **[Network & I/O]** No findings, and one existing property is preserved deliberately.
  `ipcRenderer.invoke` carries **no timeout**, so a main side that never answers would freeze this
  dialog; the design keeps footer Cancel enabled in every arm (AC4 pins this) so the operator always has
  an exit. That is also what creates the concurrency finding below — the two are the same property seen
  from both sides, and the fix belongs there, not in disabling the exit.
- **[Error messages, logs, telemetry]** No findings. One client-owned failure constant, apostrophe-free,
  interpolating neither the label nor the server id, with no main-side text able to reach it (the
  result type is value-free). Nothing on this path logs at all — the posture `unpairHandler`,
  `runUnpairServer`, `clearServerScopedState` and `requestSetHostLabel` all hold. The trap to name
  rather than discover: the tempting diagnostic here (`sendDiagnostic({ event: 'unpair', … })`) would
  want the server id or the relay URL to be useful, which is exactly what ADR 0007's content-free rule
  and CLAUDE.md forbid, and there is no observed failure to instrument. Do not add one in Phase B.
- **[Concurrency]** SHOULD FIX — **adopted into the design above**, see § The outcome mapping. Two races
  were walked:
  1. *Double-confirm launching two erases.* Closed with different fabric on each side: the answers are
     disabled while `'unpairing'` (UI), and `clearServer` is idempotent and matches by key (main). A
     second erase could not reach a different record regardless.
  2. *A late answer writing another host's dialog.* Real, and not closed by the capture rule alone.
     Because AC4 keeps footer Cancel enabled during the flight, the operator can dismiss mid-erase and
     reopen against host B before the answer lands; the in-flight arrows then hold A's cells. The erase
     is immune — it is keyed by the id captured before the await, so nothing can be erased for B — but
     the *message* is not: unguarded, `'ok'` would close B's freshly opened dialog and `'error'` would
     show "Could not unpair this host" against B. Severity is a misleading message, not a wrong
     erase. The adopted fix adds no machinery: both arms are spelled as pure functional updaters
     (`prev === serverId` / `prev === 'unpairing'`), which no-op in the reopen case. Noted for the
     verifier: the sibling save path has the identical window and was shipped unguarded at #1299; that
     is pre-existing and out of scope here (§ Scope Discipline) — this ticket guards only its own arms.
  No long-lived async task, timer, listener or subscription is created, so there is nothing to cancel on
  teardown; a resolution landing after unmount is an inert React 18 no-op, `ServerRowControl`'s posture.
- **[Threat model alignment]** No findings. *Malicious relay* — not on this path; an unpair is a local
  erase with no socket traffic, so a hostile on-path relay can neither observe nor influence it.
  *Hostile daemon response* — the one place daemon-asserted data steers destruction is the departed-id
  set, addressed in the trust-boundary finding. *Token theft from disk* — unchanged, and this path only
  removes material. *Renderer compromise reaching the transport* — no new capability is exposed, per the
  Electron finding. OUT OF SCOPE and named: daemon-side token revocation (upstream `pyrycode`).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-14

## Documentation handoff

Owned by the documentation stage once the code has landed — pending, not done in this PR:

- `docs/knowledge/features/edit-host-dialog.md` — record the unpair slot, its arms, and the
  container-held phase (now one widened `EditHostStatus` union rather than a sibling cell).
- `docs/knowledge/features/unpair-channel.md` § The two renderer callers — gains a third. State which
  `navigateToList` each caller binds and why the three differ.
