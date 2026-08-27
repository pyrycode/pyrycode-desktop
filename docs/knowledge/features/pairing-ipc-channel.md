# Pairing IPC channel

The typed **request/response** pairing pipe between the renderer window and the background process: the renderer submits a pasted pairing payload and gets back a **display fingerprint** to confirm, then sends a confirm — carrying no record, and, as of [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823), at most an optional operator-typed host nickname — and gets back success/failure, without ever handling the token or server key. It is the seam the pairing screen (#55) drives to run validation, fingerprint display, and confirm-gated persistence entirely from the background process.

Introduced in [#54](../codebase/54.md). It is the **request/response twin** of the fire-and-forget [command channel](command-channel.md) (#17, renderer→main) and [daemon-event channel](daemon-event-channel.md) (#18, main→renderer): same three-layer shape (shared contract + boundary guard, main seam, preload bridge), but over `ipcRenderer.invoke` / `ipcMain.handle` instead of `send` / `on`, because pairing needs a reply. It composes the two upstream slices — [#52 parse](pairing-payload-gate.md) and [#53 fingerprint/confirm](pairing-confirmation.md) — and owns the composition-root wiring that first constructs the real secure-store chain.

## What it does

Gives the renderer **two typed functions** (`window.pyry.submitPairingPaste`, `window.pyry.confirmPairing`) and the background process **one typed handler** behind a single channel:

- **submit(paste)** → runs the untrusted paste through `parsePairingPayload` (#52) then `prepare` (#53). A valid paste carrying a well-formed key returns `{ ok: true, fingerprint }`; a paste that fails parse **or** carries a malformed server key returns a typed error. **Nothing is persisted** on either path.
- **confirm(label?)** → carries no record, and, as of [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823), at most one optional string: the operator-typed nickname for the host. Triggers `confirm()` on the currently-held prepared pairing and persists **exactly once**; if no valid paste was submitted first, it persists nothing and returns a typed error. A supplied label is written to the [host-label store](host-label-store.md) *after* the record persists — see [§ Confirm carries an optional host label](#confirm-carries-an-optional-host-label-823) below.

The response ever carries **only** the fingerprint (a hash) or a value-free reason — never the `token`, `server_static_pubkey`, any raw record field, or the label.

## The one way it diverges from the command/event channels

The command and event channels are **one-way, fire-and-forget** (`send` / `on`); #17 deliberately chose `send` precisely so there is **no reply channel** a handler could leak data back through. Pairing needs the opposite — a round-trip — so it uses `ipcMain.handle` / `ipcRenderer.invoke`. **Because a reply channel now exists, the "only the fingerprint or a value-free reason crosses back" invariant becomes load-bearing at exactly this seam** (ADR 0002; CLAUDE.md "keep the transport out of the window"). It is enforced **by construction**: no response arm *has* a field that could hold a secret, so a developer cannot serialize one back.

Two more consequences of `handle` vs `on`:

- **A malformed request must *resolve* to a typed error**, not be silently dropped. `handle` must return a value, so the guard-reject path returns `{ ok: false, reason: 'malformed-request' }` (and logs one fixed value-free string) rather than the command channel's silent drop.
- **The handler holds state between two round-trips.** Submit and confirm are separate invokes; the handler holds the single `confirm` closure between them (see § Held state).

## How it works

Three layers, mirroring the command channel one-for-one, plus the composition root this slice owns:

| Piece | File | Layer |
|---|---|---|
| `PAIRING_CHANNEL` + `PairingRequest` union + `PairingSubmitResponse`/`PairingConfirmResponse` + `PairingErrorReason` + `isPairingRequest` guard + `MAX_PASTE_LENGTH` + `MAX_HOST_LABEL_LENGTH` | `src/shared/ipc/pairing.ts` | shared |
| `registerPairingHandler(target, deps)` + structural `PairingHandleTarget` | `src/main/pairingHandler.ts` | background |
| `window.pyry.submitPairingPaste` / `confirmPairing` | `src/preload/index.ts` | preload bridge |
| composition chain + single `handle` registration | `src/main/index.ts` | composition root |

### 1. The shared contract (`src/shared/ipc/pairing.ts`)

Imports nothing from `src/main` (layering: `shared` is loaded by preload and renderer). Relative imports only (no `@shared` alias in preload/main — project memory `shared-alias-not-available-in-main-preload`).

```ts
export const PAIRING_CHANNEL = 'pyry:pairing' as const
export const MAX_PASTE_LENGTH = 8192
export const MAX_HOST_LABEL_LENGTH = 128   // #823 — UTF-16 code units, same unit as MAX_PASTE_LENGTH

export type PairingRequest =
  | { type: 'submit'; paste: string }
  | { type: 'confirm'; label?: string }   // label is #823's addition

export type PairingErrorReason =
  | 'malformed-request' | 'invalid-paste' | 'invalid-key' | 'no-pending-pairing' | 'persist-failed'

export type PairingSubmitResponse =
  | { ok: true; fingerprint: string } | { ok: false; reason: PairingErrorReason }
export type PairingConfirmResponse = { ok: true } | { ok: false; reason: PairingErrorReason }

export function isPairingRequest(value: unknown): value is PairingRequest
```

- **`PairingRequest` is a sealed discriminated union on `type`** — a `submit` carrying the untrusted paste and a `confirm` that carries **no record** (the #53 hand-off: the renderer sends only a confirm signal, never the fingerprinted record) plus, as of [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823), an optional `label`. That optional field is a deliberate, narrow relaxation of "bare confirm" — it does not weaken the property the bareness protects, because a display string is not the record and the record continues to be assembled in main from the paste main itself parsed. Extend additively and grow the guard's `switch` in lockstep, or a new member is silently rejected.
- **`isPairingRequest` is the untrusted renderer→main boundary guard**, mirroring `isRendererCommand`. `value` is a non-null object with a known `type`; for `submit`, `paste` must be `typeof === 'string'` **and `paste.length <= MAX_PASTE_LENGTH`**; for `confirm`, an absent `label` or a *present* `label: undefined` is accepted (see below), and a present string `label` must satisfy `label.length <= MAX_HOST_LABEL_LENGTH`; any other `type`, or a non-string/over-length `label`, → false. Accepts extra/unknown fields (structural minimum). Pure; never throws. Both length bounds are validated **here** — the IPC trust boundary — so main never runs regex / base64-decode / `JSON.parse` over an absurd paste, and the host-label store (which deliberately keeps no bound of its own) never receives an unbounded string (see § Security posture).
- **The response vocabulary is self-contained and value-free.** The handler *maps* #52's eight parse reasons and #53's two fingerprint reasons onto these five coarse categories: `shared` cannot import those main-only unions, and the operator's recovery action is per-category, not per-reason. A non-string or over-length `label` maps to the existing `malformed-request` reason — no new category was needed. **No fingerprint/token/key/label field appears on any response arm** — only `fingerprint` (on success) and a value-free `reason`.
- **Why `case 'confirm'` must accept a *present* `label: undefined`.** `label?: string` in TypeScript means exactly "absent or `undefined`" — but Electron's IPC uses the structured clone algorithm, which **preserves** an own property whose value is `undefined` (unlike `JSON.stringify`, which drops it). A renderer building `{ type: 'confirm', label }` with an undefined `label` therefore delivers a request where `'label' in request` is `true`. A guard written as `!('label' in v) || typeof v.label === 'string'` would reject that as malformed and break the no-label pairing. This is a **deliberate asymmetry** with `submit`, which *rejects* a present `paste: undefined` because `paste` is required — do not tidy the two arms into symmetry.

### 2. The main-process handler (`src/main/pairingHandler.ts`)

Mirrors [`receiveCommand`](command-channel.md), adapted for invoke/handle. **No `electron` import** — the target is injected structurally, so it unit-tests with a fake, exactly as `CommandSource` did.

```ts
export interface PairingHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) =>
    Promise<PairingSubmitResponse | PairingConfirmResponse>): void
  removeHandler(channel: string): void
}

export function registerPairingHandler(
  target: PairingHandleTarget,
  deps: {
    parse: (pasted: string) => ParsePairingResult
    confirmation: PairingConfirmation
    onPaired?: () => void  // #82: connect-on-pair trigger, fired only after a confirm persists
    hostLabel?: Pick<HostLabelStore, 'save'>  // #823: write-only handle, save() only
  }
): () => void
```

**`onPaired` (optional, added [#82](../codebase/82.md))** is a trusted in-process callback fired **once, inside the existing `try`, after the label save (see below) resolves, before `return { ok: true }`** — the [connect-on-pair](daemon-connection.md#connect-on-pair-reconnect-82) trigger. It MUST NOT throw (mirrors the `onEvent`/sink discipline in `main`) and carries **no arguments** — a bare signal, so no record/token/key/label field crosses to its caller (AC5). A failed record persist takes the `catch` instead, so `onPaired` never fires on failure (AC4 is structural); it never fires on submit. The call is guarded (`onPaired?.()`), so every existing caller that omits it is unaffected.

**`hostLabel` (optional, added [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823))** is `Pick<HostLabelStore, 'save'>` — the [host-label store](host-label-store.md)'s `save` method and nothing else, so the handler structurally cannot `load` the label back or `clear` it. Optional, mirroring `onPaired` in the same object: every pre-#823 test call site keeps compiling unchanged. See § Confirm carries an optional host label below for the full write sequence.

Imports the shared contract + guard by relative path, and the **types** `ParsePairingResult` / `PairingConfirmation` from the upstream main modules. The `IpcMainInvokeEvent` first arg (`.sender`/`.senderFrame`/`.ports`) is **stripped** — never forwarded into a composed call — exactly as `receiveCommand` strips its event. `target.handle`/`removeHandler` accept Electron's `ipcMain` structurally; the sole registration returns an unregister handle that calls `removeHandler(PAIRING_CHANNEL)`.

### 3. Preload bridge (`src/preload/index.ts`)

Two thin methods on the existing `api` object, mirroring `sendCommand`. `PAIRING_CHANNEL` is hardcoded inside each so the renderer cannot address arbitrary channels; `ipcRenderer` never crosses the bridge.

```ts
submitPairingPaste: (paste: string): Promise<PairingSubmitResponse> =>
  ipcRenderer.invoke(PAIRING_CHANNEL, { type: 'submit', paste }),
confirmPairing: (label?: string): Promise<PairingConfirmResponse> =>
  ipcRenderer.invoke(
    PAIRING_CHANNEL,
    label === undefined ? { type: 'confirm' } : { type: 'confirm', label }
  ),
```

`ipcRenderer.invoke` returns `Promise<any>`, so the narrower declared return types are typed wrappers (no unsafe cast). `PyryApi = typeof api` flows both methods to `window.pyry`; `index.d.ts` (references `PyryApi`, not the literal method set) stays **untouched** — zero cascade.

**`confirmPairing`'s optional `label` parameter ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823))** is the preload bridge's one exception to `submitPairingPaste`'s "fixed shape, no ipcRenderer crossing" pattern being otherwise identical: the omitted-label branch builds the exact same request as before, so the no-label pairing path is byte-identical. That branch is a **convenience, not a defence** — the renderer is untrusted and can invoke with any argument, so `isPairingRequest` bounds and type-checks the label on its own merits regardless of what preload sends. Because the added parameter is **optional**, a zero-argument caller (`bridge.confirmPairing()`) still typechecks, so `PairingBridge` (`src/renderer/src/screens/pairing/pairingState.ts`) and `PairingScreen.tsx:346`'s `window.pyry` assignment needed no edit at the time — `npm run typecheck` was the gate on that claim. [#825](https://github.com/pyrycode/pyrycode-desktop/issues/825) has since widened `PairingBridge.confirmPairing` and `runConfirm` to take the optional label and normalise it at the confirm boundary; see the [pairing input screen](pairing-input-screen.md#host-name-field-825) doc for that half.

### 4. Composition root (`src/main/index.ts`)

The first IPC wiring in `index.ts`. Inside `app.whenReady().then(...)` (needs `app.getPath('userData')` and a ready `ipcMain`), the secret chain is constructed first; the **handler registration itself was moved below `createDaemonConnection` in [#82](../codebase/82.md)** so its `onPaired` can reach the connection:

```ts
const secureStore = createSecureStore({
  encryption: electronSecretEncryption(),
  persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets'))
})
const pairedServerStore = createPairedServerStore({ secureStore })
const confirmation = createPairingConfirmation({ store: pairedServerStore })
const hostLabelStore = createHostLabelStore({ secureStore })   // #823: same secureStore, no `name` override
// … registerPairingStatusHandler (#79) + createWindow + createDaemonConnection here …
const unregisterPairing = registerPairingHandler(ipcMain, {
  parse: parsePairingPayload,
  confirmation,
  onPaired: () => connection.reconnect(),   // #82: dial the just-persisted pairing, no restart
  hostLabel: hostLabelStore                 // #823: handler only ever sees `save`
})
app.on('will-quit', () => unregisterPairing())
```

This is the deferred wiring the [secure-store](secure-store.md) → [paired-server-store](paired-server-store.md) → [pairing-confirmation](pairing-confirmation.md) chain handed forward. `ipcMain.handle` allows **one handler per channel** (a second throws) — this is the sole registration site, held for the app lifetime; `will-quit` removes it. [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) added `hostLabelStore`, constructed over the **same** `secureStore` instance (not a second store) with **no `name` override**, so the label stays under the fixed `HOST_LABEL_NAME`, distinct from `pyrycode.paired_server` and `pyrycode.device_static` — see [host-label store](host-label-store.md).

- **Registration order ([#82](../codebase/82.md)).** The [pairing-status handler](pairing-status-signal.md) (#79) stays **before** `createWindow` (the renderer queries it before first paint, #80). Only the `submit`/`confirm` handler moved **after** `createDaemonConnection`, so `onPaired: () => connection.reconnect()` can wire a confirm-success into the [connect-on-pair](daemon-connection.md#connect-on-pair-reconnect-82) dial. **Safe** because the whole `whenReady` callback runs to completion in one synchronous tick while `createWindow()` merely *starts* the async document load; an operator-driven pairing invoke (paste + click) arrives many ticks later, after first paint — well after the handler is up. `reconnect()` is synchronous, `void`, and non-throwing, so it satisfies `onPaired`'s must-not-throw contract and cannot corrupt the confirm response.

### Held state — at most one prepared pairing

The registered listener closes over a single `let pendingConfirm: (() => Promise<void>) | null = null` — the opaque `confirm` closure of the most-recently-fingerprinted record. Two rules make the persistence invariants **structural** rather than conventional:

- **Supersede-on-submit (unconditional, up-front).** Every submit — valid or not — first sets `pendingConfirm = null` **before** parsing. So a confirm can only ever persist a record whose fingerprint the renderer actually received; a superseded (or failed) submit leaves nothing confirmable.
- **Consume-before-await on confirm.** `confirm` reads `pendingConfirm`, sets it to `null`, **then** awaits `confirm()`. A second/concurrent confirm reads `null` → `no-pending-pairing`, so "persists exactly once" holds with no double-save race across the `await` point (single-threaded main interleaves only at awaits).

Only the closure is held — never the record/token/key, which live inside #53's frozen snapshot, never a field this module reads or returns. [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s label persist added no new held state (see below) — it needs none, because it never sits between two round-trips the way `pendingConfirm` does.

### Confirm carries an optional host label (#823)

The operator-typed nickname for a host — collected by the [paste-phase field #825 added](pairing-input-screen.md#host-name-field-825) — rides the same `confirm` request that triggers the record persist, and reaches the [host-label store](host-label-store.md)'s `save` as its one sink. Three design calls, each closing a specific gap:

- **Rides `confirm`, not `submit`.** `pairingConfirmation.prepare` snapshots the four record fields into a frozen object and binds the confirm closure to *that* snapshot — closing a TOCTOU gap between fingerprint display and persist. A label riding `confirm` never enters `prepare`, never enters the snapshot, and never reaches `pairedServerStore`; it arrives as an already-copied primitive (structured clone across `ipcRenderer.invoke` leaves no live renderer-side reference), so there is no window in which anything can swap it. Riding `submit` instead would have meant either polluting the fingerprint gate with display text or holding a second piece of pending state (`pendingLabel`) that would need clearing in lockstep with every `pendingConfirm = null` supersede — `confirm` needs none of that.
- **Persisted after the record, before `onPaired`.** After, because a label for a pairing that did not persist is meaningless — a failed `confirm()` takes the `catch` and never reaches the label write. Before `onPaired()`, because `onPaired`'s `reconnect()` flips the renderer to the paired UI; persisting the label first means nothing can read back a host with no name in between. The extra `await` introduces no new class of stall — the record save one line earlier already went through the same `secureStore` seam, so any keychain prompt has already happened.
- **A failed label save is caught and dropped, never reported as a failed pairing.** The response reports on the **record** (AC5): `secureStore.set` failures can carry an OS/keychain/filesystem detail in their message, so the caught object is never logged, interpolated, or returned — the same classify-don't-forward discipline `unpairHandler.ts` uses for its own persistence failures. **No `console.*` is added on the label path, on any branch, including this one** — the only log line the confirm arm can still reach is the pre-existing static `malformed-request` warning, which echoes nothing.

An absent `label` and a present `label: undefined` both mean "no label supplied" and write nothing (see the guard's asymmetry with `submit` above); `label: ''` is a supplied value and is saved as one — the store already keeps `''` distinct from never-stored, and this ticket does not add a clear-on-empty rule. Erasing is a different trigger entirely: [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) shipped it on **unpair**, not on an empty confirm — see [Unpair channel § the label erase (#827)](unpair-channel.md).

### Error-reason mapping (handler → shared vocabulary)

| Source | Handler result |
|---|---|
| `isPairingRequest` false (incl. non-string / over-length paste, or non-string / over-length `label`) | `{ ok: false, reason: 'malformed-request' }` (+ one fixed-string log) |
| `parse` → `{ ok: false }` (any of 8 reasons) | `{ ok: false, reason: 'invalid-paste' }` |
| `prepare` → `{ ok: false }` (any of 2 reasons) | `{ ok: false, reason: 'invalid-key' }` |
| `confirm` with `pendingConfirm === null` | `{ ok: false, reason: 'no-pending-pairing' }` |
| `confirm()` throws (`store.save`, e.g. keychain unavailable) | `{ ok: false, reason: 'persist-failed' }` (error never echoed — may carry a path; no label write is attempted) |
| `submit` valid | `{ ok: true, fingerprint }` |
| `confirm` with a held handle, record save resolves | `{ ok: true }` (label save, if any, already attempted — see above; a failed label save still resolves `{ ok: true }`) |

### Data flow

```
pairing input screen   pairing.ts          preload bridge          pairingHandler          #52 / #53 / host-label store
(#825)
paste string ────────► { type:'submit',    submitPairingPaste ───► GUARD isPairingRequest ─► parse → prepare
                         paste }            ipcRenderer.invoke        supersede pendingConfirm  hold confirm handle
   ◄── fingerprint / error ────────────────  (resolves) ◄──────────  map → value-free response ◄── { fingerprint }
confirm click ───────► { type:'confirm',    confirmPairing(label?) ► pendingConfirm? ──────────► confirm() → save (once)
                         label? }                                     consume + await             then hostLabel?.save(label)
   ◄── ok / error ──────────────────────────────────────────────── if label present, own try/catch, error dropped ◄──
                                                                      then onPaired?.()
```

The guard is the single untrusted→trusted checkpoint; only the fingerprint or a value-free reason ever travels back — never the label.

## Configuration and usage

- **Import from `src/main` / `src/preload`** by **relative** path (`../shared/ipc/pairing`) — these sides have no `@shared` alias. The renderer (#55) may use `@shared/ipc/pairing`.
- **Producer (#55):** the pairing screen calls `window.pyry.submitPairingPaste(paste)`, displays the returned fingerprint, and on operator confirm calls `window.pyry.confirmPairing()`. It never sees the token or key; response types narrow per operation.
- **Consumer (composition root):** `src/main/index.ts` constructs the real secure-store chain and calls `registerPairingHandler(ipcMain, …)` **once** (after `createDaemonConnection`, passing `onPaired: () => connection.reconnect()` — [#82](../codebase/82.md) — and `hostLabel: hostLabelStore` — [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)), tearing down on `will-quit`.

## Edge cases and limitations

- **Coarse error granularity by design.** Eight parse reasons and two key reasons collapse to `invalid-paste` / `invalid-key`. This respects layering (shared cannot import main's unions) and matches per-category operator recovery. If #55's UX wants finer messaging, the handler can later thread a *value-free* detail string alongside the category — additive, no reshape.
- **Single registration is the composition root's contract.** `registerPairingHandler` returns an unregister handle, but registering **once** is the caller's job — a second `ipcMain.handle` on the same channel throws.
- **The guard must grow with the request union.** A new `PairingRequest` member added without a matching `isPairingRequest` case is silently rejected at the boundary (mirrors the command channel's lockstep trap).
- **Shape validation ≠ authorization.** `isPairingRequest` validates structure; the fingerprint **visual compare** (a human step, #53) is the load-bearing key check that defends a tampered paste. A compromised renderer auto-confirming without a human is out of scope / inherent (the confirm signal must originate in the renderer — bounded by renderer integrity: sandbox + contextIsolation).
- **`will-quit` teardown is hygiene, not functional.** Single-registration for the app lifetime means the process exit reclaims everything; teardown is kept for symmetry with #17's "own teardown" note.
- **A rejected label leaves `pendingConfirm` intact ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)).** A malformed-request response on a labelled confirm does not consume the held prepared pairing, so the operator can retry the same fingerprint with a valid (or omitted) label — it does not burn a fingerprint they already verified.
- **The label used to be able to outlive an unpair ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) Open question 1) — closed by [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827).** [#173](../codebase/173.md)'s unpair used to clear `pairedServerStore` only, so re-pairing to a *different* server without a label would leave the previous host's stale nickname in place (AC2 still forbids a no-label confirm from writing anything, including a clear — that part is unchanged). #827 made erase-on-unpair its own case rather than an operator-driven clear: `unpairHandler.ts` now also erases the label, so by the time a no-label confirm can run there is nothing stale left for it to leave behind. See [Unpair channel § the label erase (#827)](unpair-channel.md).

## Security posture

**Verdict: PASS** (architect self-review in the spec; `security-sensitive` ticket). [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) carried its own self-review, also PASS.

- **Single explicit untrusted→trusted boundary:** `isPairingRequest`, applied as the first line of the listener. No unvalidated request field reaches a composed call — `submit` uses `request.paste` only after the guard confirms it is a bounded string; `confirm` uses `request.label` only after the guard confirms it is either absent/undefined or a bounded string.
- **AC "only the fingerprint crosses back" is enforced by construction** — no response arm has a field that could hold the `token`, `server_static_pubkey`, or the label. The token/key transit main-process memory on the submit path *inside #53's frozen snapshot* (the opaque `confirm` closure), never a field this handler reads or returns; the label transits as a plain `string | undefined` on the confirm request only, never entering that snapshot.
- **Length bound at the boundary (Electron attack surface).** `MAX_PASTE_LENGTH` (8 KiB) rejects a multi-MB paste from a compromised/buggy renderer **before** parse runs regex + base64-decode + `JSON.parse` (resource exhaustion) — validated in the guard, not downstream. `MAX_HOST_LABEL_LENGTH` (128 UTF-16 code units, [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)) is the **only** bound on the label's write path, since the [host-label store](host-label-store.md) deliberately keeps none of its own.
- **No blanket try/catch.** `parse` and `prepare` are contractually total/throw-free; the two throw sources are `confirm()`'s `store.save` (fail-closed keychain path, `EncryptionUnavailableError`), caught and mapped to `persist-failed` — its message (which may carry a filesystem path) is never echoed or logged — and, since #823, `hostLabel.save`, caught in its **own inner** try/catch that drops the error without affecting the outer `persist-failed` mapping. Declining a catch-all matches #17's no-wrap posture (evidence-based: it would defend a non-leak against an unobserved failure mode).
- **Only value-free reasons and the fingerprint reach the renderer.** The sole log is one fixed string on `malformed-request`; no `console.*` was added anywhere on the label path, on any branch, including the failing-save one ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)).
- **No new credential risk from the label ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)).** `Pick<HostLabelStore, 'save'>` means the handler structurally cannot read the label back or erase it; the composition root passes no `name` override to `createHostLabelStore`, so `HOST_LABEL_NAME` stays a distinct constant from `pyrycode.paired_server` and `pyrycode.device_static`. A compromised renderer gains exactly one new capability — writing ≤128 characters to the label store — strictly weaker than the pairing-establishing power (`submitPairingPaste`/`confirmPairing`) it already holds.

## Related

- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the fire-and-forget renderer→main twin this mirrors; read for the boundary-guard rationale and the `send`-vs-`invoke` contrast
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — the main→renderer event half; the third member of the IPC-channel family
- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — `parsePairingPayload`, the submit path's stage 1 (the untrusted-paste gate)
- [Pairing-confirmation](pairing-confirmation.md) / [#53](../codebase/53.md) — `prepare`/`confirm`, the fingerprint derivation and single persist site this handler holds between submit and confirm
- [Secure store](secure-store.md) / [Paired-server store](paired-server-store.md) — the composition-root chain this slice first constructs over the real safeStorage + file edges
- [Daemon connection](daemon-connection.md) / [#82](../codebase/82.md) — the `onPaired` consumer: a confirm-success fires `connection.reconnect()`, dialing the just-persisted pairing with no restart (connect-on-pair)
- [Host label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) — the module [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) gave its first caller: `save` only, reached from this channel's confirm arm and nowhere else
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — token/keys never reach the renderer; the reply direction of this channel upholds it
- [#54 codebase notes](../codebase/54.md) · Spec: `docs/specs/architecture/54-typed-pairing-ipc-channel.md`
- [#823 issue](https://github.com/pyrycode/pyrycode-desktop/issues/823) · Spec: `docs/specs/architecture/823-host-label-pairing-write-path.md`
