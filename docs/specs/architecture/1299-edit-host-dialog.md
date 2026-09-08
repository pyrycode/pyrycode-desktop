# #1299 — the host row's pen opens an Edit host dialog that renames the host

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `ChannelListView`, `renderBody`,
  `renderServerTrees`, `HostRow`, `HostRowControl`, `hostRowLabel` — the container that holds every
  dialog's per-interaction state, the three-level prop path a handler travels, and the row that already
  draws the pen behind an optional handler nothing passes.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` → `EditWorkspaceDialogView`,
  `requestRenameWorkspace` — the dialog to clone: the chrome, the seeded field, the declined-sink list,
  and the "no Escape handler, no scrim onClick" ruling this one inherits.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` → `SaveAsChannelDialogView`,
  `SAVE_AS_CHANNEL_ERROR_COPY` — the only shipped dialog with a round trip: where the in-flight disable
  and the client-owned failure line come from.
- `src/renderer/src/store/hostLabelStore.ts` → `setHostLabelFor`, `selectHostLabelFor`, `HostLabelValue`
  — the keyed store this ticket becomes the second writer of, and the two comments that claim it has
  exactly one.
- `src/renderer/src/store/hostLabelLoader.ts` → `mapHostLabel`, `loadHostLabelFor` — the mapper the
  answer is fed through, and the "write key is the ARGUMENT, never a field of the response" rule.
- `src/shared/ipc/hostLabel.ts` → `HOST_LABEL_SET_CHANNEL`, `HostLabelSetRequest`, `HostLabelResult`,
  `isHostLabelSetRequest` — the write channel's contract, its boundary guard, and its statement that the
  response exists to be fed straight into the mapper with no second round trip.
- `src/preload/index.ts` → `setHostLabelFor` — the bridge method (#1186); nothing new is added to it.
- `src/shared/ipc/pairing.ts` → `MAX_HOST_LABEL_LENGTH` — the bound the field is measured against,
  imported rather than restated (`PairingScreen`'s call).
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host-edit`, the `:has()` dot-swap
  guard, `.edit-workspace*`, `.save-as-channel__error` — the pen's shipped geometry and the block this
  dialog's own is cloned from.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.test.tsx` — the unit-tier shape this ticket's
  dialog test mirrors.
- `e2e/host-row-hover-controls.spec.ts` — the spec whose premise this ticket inverts.
- `e2e/sidebar-workspace-edit.spec.ts` — the drive to mirror.
- `e2e/host-row-per-server.spec.ts` — the two-server drive: `secondServer`, the four-host-row count, and
  the document-order indexing that is the only handle on "which machine's row is this".
- `e2e/fixtures/launchPairedApp.ts` → `LaunchControl`, `PairedApp` — `hostLabel` / `secondServer` /
  `reuseUserDataDir` and the fact that the first two are inert alongside the third.
- `docs/knowledge/features/channel-list.md` § Host row, `docs/knowledge/features/host-label-store.md` —
  the prior tickets' lessons for this surface. Both belong to the documentation phase; neither is edited
  here.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-498 (the Rename dialog — the
chrome to clone) and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1366 (Host, Hover —
the pen).

No node draws an Edit host dialog; the ticket pins its chrome to the Rename one's, and that node renders
as a dark 28px-radius panel holding a headline title, one outlined field stacking a small "Name" caption
over the value, and a right-aligned blue Cancel / Save pair — which is `.edit-workspace*` exactly, minus
its path line. The Host node's two variants show the swap this ticket makes visible for the first time:
at rest a server-rack glyph, the machine's name and two connection dots at the trailing edge; on hover
the dots give way to a blue pen and a blue plus. **This ticket draws the pen only** — the plus is #1189's,
so the hovered row will show the pen in its slot and an empty one where the plus belongs.

## Context

`HostRow` has drawn the pen behind an optional `onEditHost` since #1185 and `channels.css` has carried its
geometry and the `:has()` dot-swap guard just as long, but `HostRowControl` passes no handler, so **the pen
is not drawn in the running app at all**. This ticket is its first caller: the pen opens a dialog that
renames the machine, writing through `window.pyry.setHostLabelFor` (#1186) and reaching no daemon.

Nothing here warrants an ADR: the write channel, its boundary guard and its response contract were all
decided in #1157/#1186 and are consumed unchanged.

## Design

### The dialog — `src/renderer/src/screens/channels/EditHostDialog.tsx` (new)

`EditWorkspaceDialogView`'s module shape: a pure view plus one helper, living together because this verb
has one sender.

```ts
export type EditHostSaveStatus = 'idle' | 'saving' | 'failed'

export function EditHostDialogView(props: {
  name: string
  status: EditHostSaveStatus
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

Markup mirrors `EditWorkspaceDialogView` declaration for declaration under an `.edit-host*` class family:
overlay → scrim (`aria-hidden`) → `role="dialog" aria-modal="true" aria-labelledby` panel → `<h2>` "Edit
host" → wrapping `<label>` with a "Name" span and a controlled `<input>` → the failure line → a
right-aligned Cancel / Save row. **No path line** — the server id and relay URL are #1300's.

Three departures from the sibling, each deliberate:

- **Save is enabled on blank.** `refused = status === 'saving' || name.trim().length > MAX_HOST_LABEL_LENGTH`,
  and nothing else. A blank name is a valid answer: it means "no label", main clears the entry, and the row
  falls back to the generic word. The workspace dialog refuses blank because a workspace has a folder name
  to fall back to and a host does not. The bound is measured on the TRIMMED name, which is what Save sends,
  and it is the imported `MAX_HOST_LABEL_LENGTH`, never a restated 128.
- **A round-trip status.** Save is disabled and the input frozen while `saving`, so one click is one write
  and the field cannot drift from the value the outstanding write carries. `failed` renders one client-owned
  line, `.edit-host__error`, and re-enables Save — AC3's "re-enabled" read literally.
- **Cancel is never disabled, in any status, and that is load-bearing rather than copied.** `ipcRenderer.invoke`
  carries no timeout: a main side that never answers would otherwise leave the dialog frozen with no exit.

`autoFocus` is declined for the sibling's reason — the field opens seeded, and stealing focus into a
prefilled field invites overwriting the name the user came to read. No Escape handler and no scrim
`onClick`, matching `RenameConversationDialogView` and `EditWorkspaceDialogView`: matching means adding
nothing, which keeps a sixth unconditional `document` listener off this window.

The failure copy is a module constant, apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;`),
interpolating neither the label nor the server id — the `SAVE_AS_CHANNEL_ERROR_COPY` idiom.

### The write

```ts
export function requestSetHostLabel(
  setLabelFor: (serverId: string, label: string) => Promise<HostLabelResult>,
  serverId: string,
  name: string
): Promise<HostLabelValue | null>
```

Trims the name, awaits `setLabelFor(serverId, trimmed)`, and answers what the CONTAINER should do:

- `stored` / `not-stored` → `mapHostLabel(res)`, the value to write into the store; the dialog closes.
- anything else, **including a rejection** → `null`: keep the dialog open, show the failure line, and
  write NOTHING.

**The arms are tested POSITIVELY and the conservative outcome is the unconditional fallthrough** —
`mapHostLabel`'s own shape, and it matters for a reason a negative `if (res.status === 'error')` would get
wrong. Under a negative test a structurally invalid response (a future arm, a buggy handler) would reach
`mapHostLabel`, map to `{ status: 'error' }`, land in the store and silently change the row to the fallback
word — a row moved by a response nobody understood. Written positively, an unrecognised answer keeps the
dialog open and the row untouched, which is what AC3 asks for on `error` and the only safe reading of
"unknown".

The returned promise ALWAYS resolves (`loadHostLabelFor`'s discipline), so a late main-side failure cannot
surface as an unhandled rejection in React. The caught object is dropped unread — never logged,
interpolated or stored. Nothing on this path logs at all: any useful line would carry the label or the id.

`sendCommand` is not a parameter and is not reachable from this module (AC4). No wire type, no command,
no bridge change.

### The container — `ChannelList`

Three cells beside the four dialog states already there, seeded together on open so a reopen after a
Cancel starts from what is actually stored:

```ts
const [editHostServerId, setEditHostServerId] = useState<string | null>(null)
const [editHostName, setEditHostName] = useState('')
const [editHostStatus, setEditHostStatus] = useState<EditHostSaveStatus>('idle')
```

Rendered behind an explicit `editHostServerId !== null`, never a truthiness test — and here that is not a
theoretical trap: `isHostLabelServerRequest` deliberately ACCEPTS the empty string as a server id, so an
empty id is storable and a truthy gate would collapse a real row's dialog into "none open".

Save:

```
setEditHostStatus('saving')
void requestSetHostLabel(window.pyry.setHostLabelFor, editHostServerId, editHostName).then((next) => {
  if (next === null) { setEditHostStatus('failed'); return }
  hostLabelStore.getState().setHostLabelFor(editHostServerId, next)
  setEditHostServerId(null)
})
```

**The store write is keyed by the id captured in the render closure, never by anything the response
carried.** `HostLabelResult` names no server at all, and the id in hand comes from the client's own paired
list — `loadHostLabelFor`'s stated rule, and the same failure it exists to prevent: one machine's name
landing on another machine's row. `window.pyry` is dereferenced inside the arrow alone, never during
render, so the container stays server-renderable.

### The prop path

`onEditHost: (serverId: string, seedLabel: string) => void` threads `ChannelListView` → `renderBody` →
`renderServerTrees` → `HostRowControl`, mirroring `onEditWorkspace` exactly. It is REQUIRED at every level
(a defaulted prop would let a future caller silently render a sidebar whose pen opens nothing), and on
`renderServerTrees` it is positioned BEFORE the optional `create` / `edit` objects. It is a bare handler
rather than a `{ label, onEdit }` object because the pen's accessible name is already a module constant
inside `HostRow` and is deliberately not a prop — #1185's security decision, which stands.

`HostRowControl` closes over both values and hands `HostRow` the nullary handler its header requires:

```ts
onEditHost={() => onEditHost(serverId, hostRowEditSeed(hostLabel))}
```

### The seed — `hostRowEditSeed`

A new exported pure collapse beside `hostRowLabel`, and a DIFFERENT one:

```ts
export function hostRowEditSeed(value: HostLabelValue): string {
  return value.status === 'stored' ? value.label : ''
}
```

`hostRowLabel` answers "what does the row DISPLAY" and turns every non-name outcome into the word
"Server"; seeding the field from it would put that word in an editable box and invite the user to store
it as the machine's actual name. This answers "what is STORED", so `loading`, `not-stored` and `error` all
seed EMPTY (AC1) and a stored label seeds VERBATIM — no trim, matching the store's own hold-it-verbatim
rule. Exported for `hostRowLabel`'s reason: `HostRowControl` is unreachable from the unit tier, so this is
the only seam the four-arm matrix can be proven through.

### Comments this falsifies, corrected in the same commit

The direct-map route is the one `shared/ipc/hostLabel.ts` names ("Answering with the resulting label …
lets the caller feed the response straight into the mapper the two reads already feed, with no second
round trip"), so it is taken — and it makes the renderer store's second writer real. Three claims stop
being true and are corrected, not left standing:

- `hostLabelStore.ts`'s module header — "`setHostLabelFor` is invoked only by the loader wiring".
- `hostLabelStore.ts`'s `selectHostLabelFor` docblock — the same claim restated.
- `ChannelList.tsx`'s `HostRowControl` header — "`setHostLabelFor` keeps exactly one caller, the loader".

Each becomes the true statement: the loader writes it on mount, and the Edit host dialog writes it on a
successful save; the ROW itself still only reads, and the value is still never two-way-bound from a
component. Note the name collision while editing: the store action `setHostLabelFor` and the bridge method
`window.pyry.setHostLabelFor` are different functions sharing a name.

### CSS

A new `.edit-host*` block in `channels.css`, the call `.edit-workspace*` already made rather than a reuse
of the Rename dialog's classes — a second dialog wearing `.rename-conversation*` would JOIN
`e2e/conversation-create-rename.spec.ts`'s strict-mode match set and strict-violate rather than fail an
assertion. Mirrors `.edit-workspace*` rule for rule minus `__path`, plus `__error` on
`.save-as-channel__error`'s recipe. The panel needs no `max-height` / `overflow-y` pair: those are
load-bearing on the sibling because it renders an unbounded `cwd`, and everything this panel renders is
either client-owned copy or a value bounded at `MAX_HOST_LABEL_LENGTH` inside an input. The Rename and
Edit-workspace blocks are not touched. `.channel-list__host-edit` is not touched either — its geometry
shipped with #1185 and this ticket only makes it reachable.

## State + concurrency model

Per-interaction state is component-local `useState` in `ChannelList`, the posture the four dialogs beside
it already use; no store slice is added. An open dialog's `position: fixed; inset: 0` overlay covers the
window, so no row behind it is clickable and two dialogs cannot be open at once — the existing
mutual-exclusion argument, inherited.

One async task exists: the `invoke` round trip, owned by the click that started it, `void`-ed with a
`.then` and never left floating. It needs no `AbortSignal`: `ipcRenderer.invoke` is a one-shot with no
stream to cancel, `requestSetHostLabel` always resolves, and there is no subscription, timer or listener
to tear down.

Three interleavings, each settled by the closure rather than by a guard:

- **Cancel while `saving`.** The dialog closes; the in-flight write still lands in the store for the server
  it named, which is correct — main has already persisted it — and the subsequent `setEditHostServerId(null)`
  is a no-op on an already-closed dialog. `setEditHostStatus('failed')` on a closed dialog is likewise
  inert: the next open re-seeds all three cells to `idle`.
- **Unmount while `saving`** (navigating to Settings or Archive). The store write still lands and is still
  correct; the two setState calls on an unmounted component are no-ops. Nothing leaks, because nothing was
  subscribed.
- **Double submit.** Unreachable: Save is disabled for the whole of `saving`.

No check-then-act race: every value the resolution uses — the server id and the mapped answer — was fixed
before the `await`, and none is re-read from state afterwards.

## Error handling

The write has three user-visible outcomes and one of them is not an error:

| answer | store | dialog |
| --- | --- | --- |
| `stored` | that server's slot ← `{ status: 'stored', label }` | closes |
| `not-stored` (the blank-name clear) | that server's slot ← `{ status: 'not-stored' }` | closes |
| `error`, an unrecognised arm, or a rejected invoke | untouched | stays open, failure line, Save re-enabled |

`error` collapses a guard refusal, an id naming no paired server and a throw indistinguishably — the
contract's own decision, so the client cannot and must not tell the user which. The line is generic
client-owned copy and no main-side or daemon text reaches it; `HostLabelResult`'s two value-free arms make
that true by construction rather than by discipline.

Nothing on this path throws into React, and nothing logs.

## Testing strategy

**Unit — `EditHostDialog.test.tsx`** (new, `EditWorkspaceDialog.test.tsx`'s shape: server-render the pure
view with injected props):

- The accessible modal chrome — `role`, `aria-modal`, the `aria-labelledby` / `id` pair, the "Edit host"
  title.
- The field seeds from `name`; exactly one `<input>`; no `autofocus`.
- Save DISABLED past `MAX_HOST_LABEL_LENGTH` and ENABLED at exactly it, measured on the trimmed name —
  built from the imported constant, never a restated 128.
- Save ENABLED on blank and on whitespace-only (the departure from the sibling), and Cancel never disabled
  in any of the three statuses.
- `saving` disables Save and the input; `failed` renders `.edit-host__error` and re-enables Save; `idle`
  and `saving` render no failure line.
- A hostile seeded label reaches the input's `value` escaped and opens no tag; no `title=` and no
  `aria-label=` anywhere in the markup.
- `requestSetHostLabel` against a spy: sends the TRIMMED name; answers the mapped value on `stored` and
  `not-stored`; answers `null` on `error`, on a rogue arm, and on a rejected promise; and never rejects.

**Unit — `ChannelList.test.tsx`** (extended):

- `hostRowEditSeed` over all four arms — verbatim on `stored` (including `''` and a whitespace-only
  label), empty on the other three.
- `ChannelListView` threads `onEditHost` so every host row draws the pen: the "Edit host" button count
  matches the host-row count, and the label still occurs exactly once per row (the #1185 attribute ban,
  re-asserted now that a control is actually drawn).
- The render helper gains an `onEditHost` noop default.

**E2E, fake tier — `e2e/sidebar-host-edit.spec.ts`** (new; `sidebar-workspace-edit.spec.ts` is the drive
to mirror). One launch, one continuous drive, `launchPairedApp({ buildReply: <recording> }, { hostLabel:
OLD_LABEL, secondServer: {} })` — four host rows, machine A named and machine B unnamed, addressed by
document order (`host-row-per-server.spec.ts`'s only available handle, since the id reaches no attribute):

1. Both of A's rows read `OLD_LABEL`; both of B's read the fallback word. The opening positive read.
2. Cancel writes nothing: the pen opens the dialog with the field holding `OLD_LABEL`, Cancel closes it,
   every row unchanged.
3. Blank: Save with a whitespace-only field closes the dialog and both of A's rows read the fallback word
   — proving Save is enabled on blank and that the clear reaches the row.
4. Reopen: the field is now EMPTY, which is AC1's second half and cannot be faked — it reads the store the
   step before it wrote.
5. Rename: type `NEW_LABEL`, Save, dialog closes, both of A's rows read it and **both of B's still read
   the fallback**, which is AC4's isolation.
6. No command reached the daemon: the inbound-frame count captured before Save is unchanged after the
   rows have settled — asserted only after step 5's positive read, so it is a mutation check and not a
   read of a value that was never going to move.

Then a second launch on launch 1's `userDataDir` via `reuseUserDataDir` (which makes `hostLabel` and
`secondServer` inert, so the relaunch reads back only what launch 1 persisted): A's rows read `NEW_LABEL`.

**E2E, fake tier — `e2e/host-row-hover-controls.spec.ts`** (inverted per AC5). Its premise — a production
host row draws no control — is what this ticket falsifies. Rewritten to read back the swap: at rest the pen
sits at opacity 0 and both dots are visible; hovering the row brings the pen up (the positive read) and
only then are the dots read at 0; the pen is 14 × 14, its right edge 28px in from the row's, vertically
centred, in `--color-primary`. **The two "no Add workspace button" reads stay exactly as they are** — that
half of the guard is still #1189's. The workspace-row instrument the old spec used to prove `:hover`
reached the tree is dropped: it existed because the criterion was an absence, and the pen coming up on the
same gesture is now a positive that calibrates itself.

Values in both specs are fixed spec-owned literals, so — unlike `host-label-sidebar.spec.ts` and
`host-row-per-server.spec.ts`, which compare LENGTHS because their label is typed into a field where a
mis-pasted pairing payload is an anticipated mistake — asserting by value here can print only what the
spec itself wrote. Stated in each spec's header rather than left as a silent departure.

The `error` arm and the length bound are unit-tier only: forcing a main-side failure would need a fixture
that can make `setHostLabelFor` fail, which no spec has and this ticket does not add.

## Sizing

Six boundaries, counted against this plan: **3** production source files (`EditHostDialog.tsx`,
`ChannelList.tsx`, `hostLabelStore.ts` — comments only; `channels.css` is not a `.ts`/`.tsx`); **4** new
exported symbols (`EditHostDialogView`, `EditHostSaveStatus`, `requestSetHostLabel`, `hostRowEditSeed`);
**6** call sites needing simultaneous update, all inside two files; **5** acceptance criteria; **3** reject
branches. Five of six hold.

**The line ceiling does not, and it is exceeded deliberately.** ~900 lines of total written work against a
800 ceiling — the refiner's estimate, and my own sketch agrees with it. The floor rule decides: every cut
leaves a child that changes nothing observable on its own, and #1185 already ran that experiment — it
shipped `HostRow`'s two optional handlers with no caller, and its e2e spec had to assert the ABSENCE of the
control, which is the assertion this ticket now deletes. Splitting again reproduces exactly that: a dialog
view no row opens, or a pen wired to nothing. Per the floor-beats-ceiling rule the overage is stated and
the ticket is built whole. Split depth is not the reason (parent #1187, no grandparent) — the floor is.

## Open questions

- **Does the client send unsolicited frames while the sidebar is idle?** Step 6's inbound-frame count is a
  sound detector only if it does not. Resolved empirically when the spec runs; if it flakes, the count
  comparison is replaced by a decode of the recorded frames filtered to command types, and the resolution
  is recorded under `## Revisions`.
- **Does `.edit-host` need the sibling's `max-height` / `overflow-y` pair?** Argued not, above. If the
  panel is observed to grow past a short window during the drive, the pair goes back in and the reason is
  recorded.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two boundaries, both explicit and both pre-existing: renderer → main
  on `HOST_LABEL_SET_CHANNEL`, where `isHostLabelSetRequest` bounds `serverId` against
  `MAX_SERVER_ID_LENGTH` and the RAW `label` against `MAX_HOST_LABEL_LENGTH` before the handler's trim; and
  main → renderer, where `mapHostLabel` reconstructs a fresh literal so nothing the union did not declare
  rides an IPC payload into store state. What is NEW is the direction: this is the first renderer surface
  that WRITES a persisted host label. The id it writes with can never be daemon-supplied — the pen is drawn
  only from `renderServerTrees`'s iteration over `serverIds`, which comes off `serverInfoStore`, filled from
  `window.pyry.serverInfo()` out of main's own paired records. The adversarial question this category
  actually turns on ("can machine B's answer land on machine A's row?") is answered by the id being captured
  from the render closure BEFORE the await and never re-read after it, which is `loadHostLabelFor`'s stated
  rule applied to the write.
- **[Tokens, secrets, credentials]** No MUST FIX, one thing named rather than waved past. The label is not
  a credential, but the field it is typed into at pairing sits directly below the pairing-code field, and
  `host-label-sidebar.spec.ts` records a mis-paste of the payload into it as an ANTICIPATED mistake — so a
  stored label can contain a token. This ticket widens that value's display: the sidebar row shows it
  ellipsized, and this dialog shows it whole in a field. That is the point of the dialog (it is the recovery
  affordance for exactly that mistake) and is not a new exfiltration path — the value is already on the
  operator's own screen. What must therefore hold, and does: no `console.*` anywhere on this path, the
  caught rejection dropped unread, and the label never reaching a log, an attribute or an error line. The
  e2e departure from the two sibling specs' compare-by-LENGTH posture is safe for a stated reason and not by
  oversight — every value those drives assert is a fixed spec-owned literal typed by the drive itself, so no
  failure diff can print operator or daemon text.
- **[File / storage operations]** Not applicable, with the reason rather than a shrug. This ticket adds no
  filesystem call: the write terminates at main's already-shipped `hostLabelStore` (#822/#1186), which owns
  the `safeStorage` encryption and the persistence name. Neither the untrusted `serverId` nor the label
  composes a path, a store name or an object key anywhere in the new code — composing the persistence name
  from the id is the mechanism `HOST_LABEL_NAME` explicitly rejects, and the renderer store keys a `Map` (no
  `__proto__` sink) with the id as KEY and the label as VALUE, never the reverse.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge`
  method, no `webPreferences` change — `window.pyry.setHostLabelFor` and its guard shipped in #1186 and are
  consumed unchanged. The renderer gains a CALLER for an existing capability, not a capability: a
  script-injection bug in this window could already invoke that channel before this ticket, and its blast
  radius is bounded by the guard to setting a ≤128-character label on a ≤`MAX_SERVER_ID_LENGTH` id, with no
  read-back of any other machine's label and no reach into the un-keyed slot. Nothing here touches keys,
  sockets or the Noise handshake.
- **[Cryptographic primitives]** Not applicable: no randomness, no hashing, no key material, and no
  comparison against a secret on this path. One adjacent trap named because it is the natural next edit:
  `EDIT_HOST_TITLE_ID` is a FIXED literal, not derived from the server id. Deriving it (the obvious way to
  support two dialogs at once) would interpolate untrusted text into an `id` and an `aria-labelledby`
  attribute; a single fixed id is safe because the modal overlay guarantees one open dialog.
- **[Network & I/O]** One finding, no fix required. Nothing on this path opens a socket or reaches the
  relay — that is AC4, and the e2e inbound-frame count is its deterministic detector. The real exposure is
  the other kind of I/O: `ipcRenderer.invoke` carries NO timeout, so a main side that never answers leaves
  the dialog in `saving` with Save disabled and the input frozen. The mitigation is designed in rather than
  discovered later — Cancel is never disabled in any status, so the user always has an exit. Recorded as the
  reason that decision is load-bearing and must not be "tidied" into matching the sibling dialogs' unused
  disable.
- **[Error messages, logs, telemetry]** No findings. The failure line is a client-owned module constant,
  apostrophe-free, interpolating neither the label nor the server id, and it is the ONLY thing rendered for a
  failure. No main-side or daemon text can reach it even by accident: `HostLabelResult`'s `error` arm is
  value-free BY CONSTRUCTION (no reason field, no message), which is the contract's own decision precisely so
  a coarse category cannot leak backend detail. Nothing on this path logs, including the rejection path.
- **[Concurrency]** No findings. One async task, owned by the click that started it, `void`-ed rather than
  floating, and always-resolving so no unhandled rejection can surface in React. No `AbortSignal` is needed
  or invented: a one-shot `invoke` has no stream to cancel and there is no subscription, timer or listener to
  tear down. The check-then-act question is answered above — every value the resolution uses is fixed before
  the await. Cancel-during-save, unmount-during-save and double-submit are each walked in the plan's
  concurrency section; the first two land a store write that is CORRECT (main persisted it) and two inert
  setState calls, and the third is unreachable because Save is disabled for the whole of `saving`.
- **[Threat model alignment]** No findings, and the live one for this ticket is the HOSTILE-OR-BUGGY MAIN
  RESPONSE rather than anything on the wire (a hostile relay and a hostile daemon are both off this path
  entirely, which is what AC4 asserts). A response carrying an arm this client does not recognise must not
  move a row. The design answers it structurally: `requestSetHostLabel` tests `stored` and `not-stored`
  POSITIVELY and falls through unconditionally to "keep the dialog open, write nothing", so an unknown answer
  degrades to the conservative outcome by shape rather than by a branch someone has to keep correct. Written
  the other way — a negative `if (res.status === 'error')` — a rogue arm would reach `mapHostLabel`, map to
  `error`, land in the store, and silently reset the row to the generic word. Token theft from disk and
  renderer-compromise-reaching-the-transport are unchanged by this ticket. The server id and relay URL lines
  are OUT OF SCOPE here and are #1300's.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
