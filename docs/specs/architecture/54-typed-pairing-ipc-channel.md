# Spec — Typed pairing IPC channel and main-process handler (#54)

Request/response IPC channel for pairing: the renderer submits a pasted payload and gets back a
fingerprint to confirm, then sends a bare confirm and gets back success/failure — without ever
handling the token or server key. This slice introduces the typed channel + boundary guard
(`src/shared/ipc`), the main-process handler that composes the two upstream slices (#52 parse,
#53 fingerprint/confirm), the composition-root wiring (`src/main/index.ts`), and the preload
bridge methods. The renderer *screen* that drives it is #55.

## Files to read first

| File | Lines | What to extract |
|---|---|---|
| `src/shared/ipc/commands.ts` | 1–73 | **The pattern to mirror.** Channel constant + sealed discriminated request union + runtime boundary guard (`isRendererCommand`). Copy this shape for the pairing channel. |
| `src/main/receiveCommand.ts` | 1–43 | **The seam pattern to mirror.** Minimal injected `CommandSource` interface (so it unit-tests with a `{ on, removeListener }` fake, no Electron), single registration, exact-listener teardown, fixed-string log on drop. The invoke/handle twin does the same with `handle`/`removeHandler`. |
| `src/main/receiveCommand.test.ts` | 1–63 | The fake-source test idiom: extract the registered listener from `source.on.mock.calls[0][1]` and drive it directly. Reuse for the handler test. |
| `src/main/pairingPayload.ts` | 22–73, 145–149 | `parsePairingPayload(pasted: string): ParsePairingResult` — the submit path's stage 1. `ParsePairingResult = { ok:true; payload: QrPayload } \| { ok:false; reason }`. Pure, total, throw-free. The handler injects and calls this. |
| `src/main/pairingConfirmation.ts` | 40–53, 101–131 | `PairingConfirmation.prepare(record): PreparedPairing`, where `PreparedPairing = { ok:true; fingerprint; confirm } \| { ok:false; reason }`. `prepare` derives but persists nothing; `confirm()` is the one persist site. The handler holds the `confirm` handle between submit and confirm. |
| `src/main/pairedServerStore.ts` | 31, 39–42, 120–138 | `PairedServerRecord = QrPayload` (so `parse`'s `payload` feeds `prepare` directly), and `createPairedServerStore({ secureStore })` — a composition-root ingredient. |
| `src/main/secureStore.ts` | 78–100 | `createSecureStore({ encryption, persistence })` — the base of the composition-root chain. |
| `src/main/electronSecretEncryption.ts` | 18 | `electronSecretEncryption()` — the real encryption edge to inject at the composition root. |
| `src/main/fileSecretPersistence.ts` | 1–6, 23 | `fileSecretPersistence(dir)` — the real persistence edge. **The comment pins `dir = join(app.getPath('userData'), 'secrets')`, computed by THIS composition root.** |
| `src/main/index.ts` | 1–94 | Today has **zero IPC wiring**. Add the composition chain + single `handle` registration inside `app.whenReady().then(...)`; unregister on `will-quit`. |
| `src/preload/index.ts` | 1–43 | The `api` object exposed as `window.pyry`. Add two thin `ipcRenderer.invoke` wrappers. `PyryApi = typeof api` auto-flows the new methods; `index.d.ts` stays untouched. |
| `src/preload/index.d.ts` | 1–7 | Confirms zero cascade: `window.pyry: PyryApi` references the alias, not the literal method set. |
| `docs/knowledge/features/pairing-confirmation.md` | 67, 109 | The **#53 → #54 hand-off**: bare confirm signal (no record), only `fingerprint` may flow to the renderer, hold ≤1 live `PreparedPairing`, discard on new paste, validate the paste is a `string` first. |
| `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` | — | The token/keys-never-reach-the-renderer invariant this channel's reply direction must uphold. |

## Context

The two existing background↔window channels are **one-way, fire-and-forget**: commands
(renderer→main, `commands.ts`, `ipcRenderer.send`/`ipcMain.on`) and events (main→renderer,
`events.ts`, `webContents.send`/`ipcRenderer.on`). #17 deliberately chose `send` so there is *no*
reply channel a handler could leak data back through.

Pairing needs the opposite: a **request/response** round-trip. The renderer sends the pasted
payload and must get back either a display fingerprint or a typed error, then sends a confirm and
gets back success/failure. This slice adds that channel using Electron's `ipcMain.handle` /
`ipcRenderer.invoke`, and the main-process handler that sits behind it composing:

- **#52** `parsePairingPayload(pasted)` → `{ ok, payload | reason }` — the untrusted-paste gate.
- **#53** `createPairingConfirmation({ store }).prepare(record)` → `PreparedPairing` — derives the
  fingerprint and hands back the single `confirm()` handle bound to exactly the fingerprinted record.

Because a reply channel now exists, the **"only the fingerprint (or a typed error) crosses back"**
invariant (AC4) becomes load-bearing at exactly this seam: the token and `server_static_pubkey`
must never appear in any response. Keys, the token, and persistence stay in the background process
(ADR 0002; CLAUDE.md "Keep the transport out of the window").

## Scope & sizing — S (4 production files)

Deliverables: **2 new files** (`src/shared/ipc/pairing.ts`, `src/main/pairingHandler.ts`),
**2 edits** (`src/main/index.ts` composition root, `src/preload/index.ts` bridge), plus 2 test
files. ~450 LOC total, zero consumer cascade (`PyryApi` auto-flows, `index.d.ts` untouched),
5 reject branches. All red lines clear; S holds (the request/response twin of #17).

**Note on the preload (a deliberate 4th file, one more than the ticket body's "3 production
files").** #17 shipped its channel across **three layers** — shared (`commands.ts`), main seam
(`receiveCommand.ts`), **and** the preload sender (`window.pyry.sendCommand`) — as one slice (see
`docs/knowledge/features/command-channel.md`). Since `ipcRenderer` is never exposed to the sandboxed
renderer (contextIsolation on), the handler is **unreachable** by any renderer code until a preload
method invokes it. Omitting the preload would ship a live-but-unreachable handler and force #55 to
build both plumbing and UI. Including it makes #54 a complete, reachable channel and leaves #55 a
pure React screen. This mirrors #17 exactly and stays within S (the preload adds two thin functions,
no new types, zero cascade). This is a *downward-compatible* scope refinement, not an expansion of
behaviour: same ACs, one extra thin plumbing file.

## Design

Three layers, mirroring the command channel one-for-one, plus the composition root this slice owns.

### 1. The shared contract — `src/shared/ipc/pairing.ts` (new)

Mirrors `commands.ts`: one channel constant, one sealed discriminated **request** union, a runtime
boundary **guard**, and the typed **response** shapes. Imports nothing from `src/main` (layering:
`shared` is loaded by preload and renderer and must not pull main-only code). Relative imports only
(no `@shared` alias in preload — see project memory).

Contract (declarations, not bodies):

```ts
export const PAIRING_CHANNEL = 'pyry:pairing' as const

// Upper bound on an accepted paste, enforced at the guard. A valid pairing paste is base64url of a
// 4-field JSON (relay URL, server id, token, 32-byte base64 key) — realistically < 1 KB; 8 KiB is
// comfortably above any legitimate input while rejecting absurd sizes before parse touches them.
export const MAX_PASTE_LENGTH = 8192

// One channel, discriminated request (AC1 says "a channel constant" + "a sealed request shape"
// with a submit-paste member and a distinct confirm member — singular channel, mirroring commands.ts).
export type PairingRequest =
  | { type: 'submit'; paste: string }   // untrusted paste to parse + fingerprint
  | { type: 'confirm' }                 // bare confirm — NEVER carries a record (#53 hand-off)

// Self-contained response vocabulary. The handler MAPS #52's 8 parse reasons and #53's 2
// fingerprint reasons onto these coarse categories — shared cannot import those main-only unions,
// and the operator's recovery action is per-category, not per-reason.
export type PairingErrorReason =
  | 'malformed-request'   // guard rejected the request shape (incl. non-string paste)
  | 'invalid-paste'       // parse/validation failed (any ParsePairingResult reason)
  | 'invalid-key'         // structurally valid paste, malformed server key (any Fingerprint reason)
  | 'no-pending-pairing'  // confirm with nothing prepared
  | 'persist-failed'      // confirm's store.save threw (e.g. keychain unavailable)

// Tight per-operation response types so the preload methods narrow cleanly for #55.
export type PairingSubmitResponse =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: PairingErrorReason }

export type PairingConfirmResponse =
  | { ok: true }
  | { ok: false; reason: PairingErrorReason }

export function isPairingRequest(value: unknown): value is PairingRequest
```

- **`isPairingRequest`** is the untrusted-boundary guard (AC1). Structural minimum, pure, never
  throws, mirrors `isRendererCommand`: `value` is a non-null object with a known `type`; for
  `submit`, `paste` must be `typeof === 'string'` **and `paste.length <= MAX_PASTE_LENGTH`** (this
  is the mandated non-string-paste rejection carried from the #52/#53 hand-off, plus a length bound —
  see § Security review, category 4); for `confirm`, nothing more; any other `type` → false.
  Accepts extra/unknown fields (structural minimum). Grow the `switch` in lockstep with the union.
  The length bound is validated *here* (the IPC trust boundary) before the paste reaches
  `parsePairingPayload`, so main never runs regex / base64-decode / `JSON.parse` over an absurd input.
- **No fingerprint/token/key field anywhere in the response types** — AC4 is enforced by
  construction: no response arm *has* a field that could hold a secret, so a developer cannot
  serialize one back. Only `fingerprint` (a hash) and a value-free `reason` cross to the renderer.

### 2. The main-process handler — `src/main/pairingHandler.ts` (new)

Mirrors `receiveCommand.ts`, adapted for invoke/handle and holding one prepared pairing. Imports the
shared contract + guard by relative path, and the **types** `ParsePairingResult` / `PairingConfirmation`
from the upstream main modules. **No `electron` import** — the target is injected structurally
(unit-tests with a fake), exactly as `CommandSource` did.

Contract (declarations only):

```ts
// The minimal ipcMain surface. Electron's ipcMain satisfies it structurally (proven by
// receiveCommand's CommandSource vs ipcMain.on). Test passes { handle: vi.fn(), removeHandler: vi.fn() }.
export interface PairingHandleTarget {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) =>
      Promise<PairingSubmitResponse | PairingConfirmResponse>
  ): void
  removeHandler(channel: string): void
}

// Register the single invoke handler. Injects the two upstream operations as faked-in-tests deps.
// Returns an unregister handle (calls target.removeHandler(PAIRING_CHANNEL)).
export function registerPairingHandler(
  target: PairingHandleTarget,
  deps: {
    parse: (pasted: string) => ParsePairingResult
    confirmation: PairingConfirmation
  }
): () => void
```

**Held state — at most one prepared pairing (AC4).** The registered listener closes over a single
`let pendingConfirm: (() => Promise<void>) | null = null`. It holds only the opaque `confirm`
closure (the fingerprint was already returned; the record/token/key live inside #53's frozen
snapshot, never in a field this module reads or returns).

**Behaviour** (describe in prose; do not pre-write bodies):

1. **Guard first.** `if (!isPairingRequest(request)) return { ok: false, reason: 'malformed-request' }`
   and log one fixed value-free string (`'pyry:pairing — rejected malformed request'`, mirroring
   `receiveCommand`'s drop log; never echo `request`/`paste`). Unlike `send`/`on`, `handle` must
   *resolve* to a value, so a malformed request returns a typed error rather than being silently dropped.
2. **`submit`.** *First* clear `pendingConfirm = null` (a new submit supersedes any prior prepared
   pairing — AC4). Then `const parsed = deps.parse(request.paste)`. If `!parsed.ok` →
   `{ ok:false, reason:'invalid-paste' }` (nothing prepared, nothing persisted). Else
   `const prepared = deps.confirmation.prepare(parsed.payload)` (`parsed.payload` is a `QrPayload`
   = `PairedServerRecord`, feeds `prepare` directly). If `!prepared.ok` →
   `{ ok:false, reason:'invalid-key' }`. Else `pendingConfirm = prepared.confirm` and
   `return { ok:true, fingerprint: prepared.fingerprint }`. **Neither failure stage persists** (AC2)
   — `confirm` is never called, and a rejected key produces no `confirm` handle at all (#53).
3. **`confirm`.** `const c = pendingConfirm`. If `c === null` →
   `{ ok:false, reason:'no-pending-pairing' }` (confirm before a valid submit persists nothing — AC3).
   Else **consume before awaiting**: `pendingConfirm = null`, then `try { await c(); return { ok:true } }
   catch { return { ok:false, reason:'persist-failed' } }`. Consuming before the await makes
   "persists exactly once" (AC3) structural: a second/concurrent confirm sees `null` → `no-pending-pairing`,
   so there is no double-save race across the `await` point.
4. **Register once**: `target.handle(PAIRING_CHANNEL, listener)`; return
   `() => target.removeHandler(PAIRING_CHANNEL)`.

The IpcMainInvokeEvent first arg (`.sender`/`.senderFrame`/`.ports`) is never forwarded into the
composed calls — only the validated `request` is used, exactly as `receiveCommand` strips its event.

**Error-reason mapping (handler → shared vocabulary):**

| Source | Handler result |
|---|---|
| `isPairingRequest` false (incl. non-string paste) | `{ ok:false, reason:'malformed-request' }` (+ fixed-string log) |
| `parse` → `{ ok:false, reason: <any of 8> }` | `{ ok:false, reason:'invalid-paste' }` |
| `prepare` → `{ ok:false, reason: <any of 2> }` | `{ ok:false, reason:'invalid-key' }` |
| `confirm` with `pendingConfirm === null` | `{ ok:false, reason:'no-pending-pairing' }` |
| `confirm()` throws (save/keychain) | `{ ok:false, reason:'persist-failed' }` (error object never echoed/logged — may carry a path) |
| `submit` valid | `{ ok:true, fingerprint }` |
| `confirm` with a held handle, save resolves | `{ ok:true }` |

### 3. Composition root — `src/main/index.ts` (edit)

Construct the real chain and register the handler exactly once (AC5). Add `ipcMain` to the
`electron` import; `app` and `join` are already imported. Wire inside `app.whenReady().then(...)`
(needs `app.getPath('userData')` and a ready `ipcMain`), holding the unregister handle:

```ts
// inside app.whenReady().then(() => { ... }), alongside createWindow()
const secureStore = createSecureStore({
  encryption: electronSecretEncryption(),
  persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets'))
})
const pairedServerStore = createPairedServerStore({ secureStore })
const confirmation = createPairingConfirmation({ store: pairedServerStore })
const unregisterPairing = registerPairingHandler(ipcMain, {
  parse: parsePairingPayload,
  confirmation
})
app.on('will-quit', () => unregisterPairing())
```

- **One registration for the app lifetime** (mirrors #17's "`onCommand` registered once"). A second
  `ipcMain.handle` on the same channel *throws* — this is the only registration site.
- `fileSecretPersistence(join(app.getPath('userData'), 'secrets'))` matches the exact `dir` its own
  comment pins; the adapter takes no `app` import — the root supplies the path.

### 4. Preload bridge — `src/preload/index.ts` (edit)

Two thin methods added to the existing `api` object, mirroring `sendCommand`. `PAIRING_CHANNEL` is
hardcoded inside each so the renderer cannot address arbitrary channels; `ipcRenderer` never crosses
the bridge. Return types narrow per operation:

```ts
submitPairingPaste: (paste: string): Promise<PairingSubmitResponse> =>
  ipcRenderer.invoke(PAIRING_CHANNEL, { type: 'submit', paste }),
confirmPairing: (): Promise<PairingConfirmResponse> =>
  ipcRenderer.invoke(PAIRING_CHANNEL, { type: 'confirm' }),
```

`ipcRenderer.invoke` returns `Promise<any>`, so the declared narrower return types are typed
wrappers (no unsafe cast). `PyryApi = typeof api` flows both methods to `window.pyry`; `index.d.ts`
(references `PyryApi`, not the literal method set) stays untouched — **zero cascade**.

### Data flow

```
#55 screen (later)        pairing.ts            preload bridge              pairingHandler            #52 / #53
paste string ───────────► { type:'submit',      window.pyry.submitPairing ─► handle(listener)   ────► parse(paste) → prepare(payload)
                            paste }              ipcRenderer.invoke ──IPC──► GUARD isPairingRequest    hold confirm handle
   ◄── fingerprint / error ─────────────────────  (resolves to response) ◄─  map result → response ◄── return { fingerprint }
confirm click ──────────► { type:'confirm' } ───► window.pyry.confirmPairing ─► pendingConfirm?      ──► confirm() → store.save (once)
   ◄── ok / error ───────────────────────────────────────────────────────── ◄─  consume + await   ◄──
```

The guard in the handler is the single untrusted→trusted checkpoint; only the fingerprint or a
value-free reason ever travels back.

## State + concurrency model

- **No Zustand, no renderer state, no store slice** — a main-process service holding one nullable
  `pendingConfirm` closure in module-instance memory. `#55` owns the renderer-side state.
- **Single-threaded main, interleaving at awaits.** `submit` and `parse`/`prepare` are synchronous;
  `confirm` awaits `store.save`. The one interleaving risk is two `confirm` invokes racing across
  the `await`. **Consuming `pendingConfirm` before the await closes it**: the second confirm reads
  `null`. This is why the order is *read → null-out → await*, not *read → await → null-out*.
- **Supersede-on-submit** is unconditional and up-front: any submit (valid or not) first drops the
  prior pending, so a stale/superseded record can never be confirmed (AC4). A failed submit therefore
  leaves nothing to confirm — consistent with the renderer showing an error, not a fingerprint.
- **Teardown.** `will-quit` calls the unregister handle (`removeHandler`). `pendingConfirm` is
  in-memory and reclaimed on process exit; no timers/sockets/listeners to cancel. The token/key held
  transiently inside #53's frozen snapshot between submit and confirm live only in the trusted main
  process (inherent and acceptable; never crosses a boundary, never logged).

## Error handling

- **All failure modes resolve to a typed response — never a rejected invoke.** `parse` and `prepare`
  are contractually total/throw-free; the only throw source is `confirm()` (`store.save`), caught and
  mapped to `persist-failed`. No blanket try/catch is added (matches the codebase's precise style and
  `receiveCommand`'s no-wrap posture); the total-upstream assumption is documented here and holds
  because the composition root injects exactly the real total functions.
- **`persist-failed` covers the fail-closed keychain path**: `EncryptionUnavailableError` from
  `secureStore.set` propagates out of `confirm()`, is caught, and surfaces as `persist-failed` — the
  operator learns "couldn't store" without the error detail (which may carry a filesystem path)
  crossing the boundary or hitting a log.
- **`malformed-request`** is the only path that logs (one fixed value-free string), mirroring
  `receiveCommand`'s drop log — a well-behaved renderer never triggers it, so it is an anomaly worth a
  breadcrumb; all other reasons are normal operator-flow outcomes surfaced to the UI, not logged.
- **The renderer surfaces the reason** (banner/inline) — that is #55's concern; this slice only
  guarantees the value-free typed reason crosses back.

## Testing strategy

`npm test` (vitest), `npm run typecheck`, `npm run build`. Two test files, both electron-free via
the injected seams — no Electron harness.

**`src/shared/ipc/pairing.test.ts` — the guard matrix (AC1).** Bulleted scenarios:
- `PAIRING_CHANNEL` is pinned to `'pyry:pairing'` (both sides depend on it; a drift silently breaks).
- `isPairingRequest` **accepts** `{ type:'submit', paste:'x' }` and `{ type:'confirm' }`, including
  each with a harmless extra field (structural minimum).
- **rejects** `null`, `undefined`, a string, a number; a missing/empty/unknown `type`
  (`{ type:'connect' }`); a submit with **non-string paste** (`paste: 42`, `paste: undefined`,
  `paste` absent) — the mandated non-string rejection; a confirm is accepted with no other fields.
- **rejects an over-length paste**: a submit whose `paste` has length `MAX_PASTE_LENGTH + 1` → false;
  a paste at exactly `MAX_PASTE_LENGTH` → accepted (boundary).

**`src/main/pairingHandler.test.ts` — handler behaviour (AC2–AC5).** Use the `receiveCommand.test.ts`
idiom: `fakeTarget = { handle: vi.fn(), removeHandler: vi.fn() }`, register, pull the listener from
`handle.mock.calls[0][1]`, drive it with `(fakeEvent, request)`. Fake deps: `parse` (a `vi.fn`
returning a canned `ParsePairingResult`) and `confirmation` whose `prepare` returns a canned
`PreparedPairing` with a `confirm: vi.fn()` spy. Scenarios:
- **registers exactly one handler** on `PAIRING_CHANNEL`; the unregister handle calls
  `removeHandler(PAIRING_CHANNEL)` (AC5, single registration).
- **guard reject:** a structurally invalid request (and a non-string paste) → resolves to
  `{ ok:false, reason:'malformed-request' }`; neither `parse` nor `confirm` spy called.
- **submit valid → fingerprint, nothing persisted (AC2):** `parse` → `{ ok:true, payload }`,
  `prepare` → `{ ok:true, fingerprint:'aa:…', confirm }`; response `{ ok:true, fingerprint:'aa:…' }`;
  the `confirm` spy is **not** called.
- **submit invalid at parse stage (AC2):** `parse` → `{ ok:false }`; response
  `{ ok:false, reason:'invalid-paste' }`; `prepare` and `confirm` not called.
- **submit invalid at key stage (AC2):** `parse` → `{ ok:true }`, `prepare` → `{ ok:false }`;
  response `{ ok:false, reason:'invalid-key' }`; `confirm` not called.
- **confirm before submit (AC3):** confirm with no prior submit → `{ ok:false, reason:'no-pending-pairing' }`;
  no `confirm` spy call.
- **confirm persists exactly once (AC3):** submit-valid, then confirm → `confirm` spy called once,
  response `{ ok:true }`; a **second** confirm → `{ ok:false, reason:'no-pending-pairing' }` and the
  spy is still called only once (consume-on-confirm).
- **new submit supersedes (AC4):** submit A (confirm spy A), submit B (confirm spy B), confirm →
  only spy **B** runs, never A's — the superseded record is unpersistable.
- **persist failure (error handling):** `confirm` spy rejects (simulating `EncryptionUnavailableError`)
  → response `{ ok:false, reason:'persist-failed' }`, invoke resolves (does not reject).
- **no secret ever crosses back (AC4):** across every response above, assert no arm carries a
  `token` / `server_static_pubkey` / raw-record field, e.g. by stringifying the response and
  asserting the fake payload's token/key values are absent. Only `fingerprint` or `reason` appear.

The composition root (`index.ts`) is verified by `npm run build` + `npm run typecheck` (it needs the
real Electron runtime and keychain, the same reason `electronSecretEncryption`/`fileSecretPersistence`
are not unit-tested); the preload bridge is likewise build/typecheck-verified (mirrors #17, which
added no preload unit test).

## Open questions

- **Error granularity.** The response collapses #52's 8 parse reasons and #53's 2 key reasons into
  `invalid-paste` / `invalid-key`. This respects layering (shared cannot import main's reason unions)
  and matches per-category operator recovery. If #55's UX wants finer messaging, the handler can later
  thread a *value-free* detail string alongside the category — additive, no reshape. Defaulting to
  coarse for this slice.
- **`will-quit` teardown** is included for symmetry with #17's "own teardown" note; since the handler
  is single-registration for the app lifetime, it is hygiene rather than a functional requirement. Keep
  unless the reviewer prefers to drop it.

## Security review

**Verdict:** PASS

Adversarial self-review per `architect/security-review.md` — this ticket carries `security-sensitive`.
The new element vs the existing channels is a **reply channel** (`ipcMain.handle` / `ipcRenderer.invoke`),
which #17 deliberately avoided; the "only the fingerprint or a value-free reason crosses back" invariant
(AC4) is therefore load-bearing at exactly this seam.

**Findings:**

- **[Trust boundaries] No findings.** Single explicit untrusted→trusted boundary: `isPairingRequest`
  in `src/shared/ipc/pairing.ts`, applied as the first line of the registered listener, mirroring the
  proven `isRendererCommand`. No unvalidated request field reaches a composed call: `submit` uses
  `request.paste` only after the guard has confirmed it is a bounded string; `confirm` uses no field.
  Downstream data is a discriminated `ParsePairingResult` / `PreparedPairing` (type-system signal).
- **[Tokens/secrets] No findings.** This slice generates and stores nothing itself. The token and
  `server_static_pubkey` transit main-process memory on the submit path *inside #53's frozen snapshot*
  (the opaque `confirm` closure) — never a field this handler reads or returns. AC4 is enforced by
  construction: no response arm has a field that could hold a secret. Persistence delegates to the
  safeStorage-backed, fail-closed #42/#44/#53 chain wired at the composition root. Token rotation /
  revocation are OUT OF SCOPE (daemon-side concern; the store is last-writer-wins re-pair per #44).
- **[File/storage] No findings.** No untrusted input reaches a filesystem path: the composition root
  uses the fixed `join(app.getPath('userData'), 'secrets')` dir and the fixed `PAIRED_SERVER_NAME`;
  the paste/token/key never become a path segment. Atomic temp+rename, `0o600`/`0o700`, and structural
  path-traversal closure are inherited from the hardened #42/#44 adapters — unchanged here.
- **[Electron attack surface] One SHOULD FIX, addressed inline.** The IPC argument guard validated
  *type + shape* but not *length* — a compromised/buggy renderer could `submitPairingPaste` a multi-MB
  string that main then runs regex + base64-decode + `JSON.parse` over (resource exhaustion from the
  renderer). **Fixed:** `isPairingRequest` now bounds `paste` to `MAX_PASTE_LENGTH` (8 KiB) at the
  boundary, before parse runs (type + length + shape). Window hardening is unchanged and correct —
  `contextIsolation: true` + `sandbox: true` (index.ts:20–21, nodeIntegration off), `will-navigate`
  guard and `setWindowOpenHandler` (index.ts:30–55) are not touched by this slice; the composition
  edit lives inside `whenReady`. The exposed renderer surface is exactly two typed methods, each
  hardcoding `PAIRING_CHANNEL`; `ipcRenderer` never crosses the bridge.
  - *Reply-channel exception leak — considered, no change (evidence-based).* An exception escaping the
    listener would reject the `invoke` and serialize its message to the renderer. The only throw source
    carrying *main-originated* data is `confirm()`'s `store.save` (which may hold a filesystem path) —
    **already caught** and mapped to `persist-failed`, never echoed. `parsePairingPayload` and `prepare`
    are contractually total/throw-free; even if they threw, they would only echo the renderer's *own*
    paste (not a new secret). A blanket catch-all is therefore declined — it would defend a non-leak
    against an unobserved failure mode, and it matches #17's no-wrap receiver posture.
- **[Cryptographic primitives] No findings.** This slice introduces no cryptographic primitive: no RNG,
  no key/nonce handling, no comparison of an attacker value to a secret. The fingerprint is #53's
  BLAKE2s hash (surfaced, not computed here); at-rest encryption is #42's safeStorage.
- **[Network & I/O] No findings.** No socket, frame, or relay dial here. Relay-URL validation
  (scheme=`wss:` allowlist, host allowlist, no embedded credentials) is inherited from #52's
  `parsePairingPayload`, which this handler feeds the paste into.
- **[Errors/logs] No findings.** Only value-free `reason` constants and the fingerprint cross to the
  renderer. The sole log is a fixed value-free string on `malformed-request` (never echoing
  `request`/`paste`), mirroring `receiveCommand`; `confirm()`'s caught error is neither logged nor
  echoed (may carry a path). No secret reaches the renderer console.
- **[Concurrency] No findings.** The one check-then-act on shared state — reading/mutating
  `pendingConfirm` across the `confirm` `await` — is closed by **consume-before-await** (read → null →
  await), so a second/concurrent confirm sees `null` and cannot double-persist. **Supersede-on-submit**
  (clear `pendingConfirm` up-front on every submit) guarantees a confirm can only persist a record whose
  fingerprint the renderer actually received. No timers/sockets/listeners; `will-quit` removes the handler.
- **[Threat model] Aligned, with one named limitation.** *Malicious / tampered pasted payload* — the
  threat this flow exists for — is defended by #53's human fingerprint compare, which this channel
  surfaces (attacker key → non-matching fingerprint → operator declines). *Token theft from disk* is
  raised by safeStorage (OS keychain), wired here; keychain-unavailable fails closed
  (`EncryptionUnavailableError` → `persist-failed`, nothing persisted). *Compromised renderer
  auto-confirming without a human* is OUT OF SCOPE / inherent: the confirm signal must originate in the
  renderer, so it is bounded by renderer integrity (Electron sandbox/contextIsolation, #17/#27) — the
  same posture #17 documents ("a compromised renderer acts as the already-authenticated client"). The
  confirm gate defends paste-tampering, a distinct threat. Hostile-relay / hostile-daemon threats are
  N/A at this seam (no socket; no daemon response parsed here).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
