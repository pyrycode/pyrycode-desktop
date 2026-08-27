# Host-label channel

The renderer→main IPC surface that lets the window read the operator-typed **host label** back from
the at-rest [host-label store](host-label-store.md) — **including while disconnected**.

Introduced in [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824). It is the **fourth**
member of the [pairing-status signal](pairing-status-signal.md) (#79) / [unpair
channel](unpair-channel.md) (#173) / [server-info channel](server-info-channel.md) (#339) family: same
four-layer shape (shared contract, main handler, preload bridge, composition-root registration), same
injected-target / stateless-handler / classify-don't-forward discipline. [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822)
built the store, [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) wired its write path
into pairing confirm; this ticket is the read half. Shipped with no caller;
[#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) gave it one — see
[Host-label window store](host-label-window-store.md) — and the sidebar host row that renders the value
is still open as [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834).

## Why a new channel, not `ServerInfo`

`ServerInfo` is the closer file-shape twin but the wrong template, for two independent reasons, either
alone sufficient:

- **The seal.** `src/shared/ipc/serverInfo.ts` says in terms *"do NOT add any field to the present
  arm."* A third field would be the first crack in that seal.
- **Incompatible outcome cardinality.** `ServerInfo` deliberately *collapses* not-paired and unreadable
  into one `unavailable` arm. This channel must keep never-stored and unreadable apart (see below), so
  a shared discriminant cannot serve both — the label would need a nested status field inside
  `ServerInfo`, a worse version of a separate union on a channel whose contract forbids the widening.

A dedicated channel keeps `ServerInfo` sealed and confines the new surface to a separately-reviewed
boundary — the same move `ServerInfo` itself made against `pairingStatus` one store earlier.

## What it does

One typed round trip, `window.pyry.hostLabel()` → `Promise<HostLabelResult>`, **three** arms —
modelled on [`PairingStatus`](pairing-status-signal.md), not on `ServerInfo`'s two-arm collapse,
because ADR 0005 forbids masking an unreadable record as never-stored and
[host-label store](host-label-store.md) makes the identical argument for the label directly:

- **`{ status: 'stored'; label: string }`** — [`hostLabelStore.load()`](host-label-store.md) returned a
  string, verbatim, no transformation. `''` **is** a stored label — the operator supplied an empty one
  — not absence; this is the last boundary where that distinction could be thrown away, and it is not.
- **`{ status: 'not-stored' }`** — `load()` returned `null`. The only not-stored path. Declares no
  `label` key at all (not `label: undefined`) — Electron's structured-clone IPC **preserves** an own
  `undefined` property (unlike `JSON.stringify`), so a renderer testing `'label' in result` would
  otherwise misread absence as presence.
- **`{ status: 'error' }`** — `load()` threw (`MalformedHostLabelError`, or a propagated decrypt
  failure from tamper/keychain rotation), **or** the string it returned exceeds
  `MAX_HOST_LABEL_LENGTH`. Both collapse to the same value-free arm; the error type and the over-length
  value are never surfaced, never truncated, never partially reported.

`label` is the only field on the whole union, and it lives only on `stored` — the other two arms are
value-free by construction, so the handler cannot serialize a token, a server key, a keychain path, an
error message, or a truncated label prefix onto them.

## How it works

| Piece | File | Layer |
|---|---|---|
| `HOST_LABEL_CHANNEL` + `HostLabelResult` | `src/shared/ipc/hostLabel.ts` (new) | shared contract |
| `registerHostLabelHandler(target, deps)` + `HostLabelHandleTarget` | `src/main/hostLabelHandler.ts` (new) | background handler |
| `window.pyry.hostLabel()` | `src/preload/index.ts` (mod) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod) | composition root |

### 1. The shared contract (`src/shared/ipc/hostLabel.ts`)

```ts
export const HOST_LABEL_CHANNEL = 'pyry:host-label' as const

export type HostLabelResult =
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }
```

No runtime logic, no request guard — the invoke carries zero arguments, so there is no untrusted
request field to validate. Imports nothing from `src/main`; relative imports only. Ships with **no
test file**, same as `serverInfo.ts`/`pairingStatus.ts` — correctness here is `npm run typecheck`'s
job (union exhaustiveness) plus the handler tests importing the channel constant rather than a literal.

### 2. The main-process handler (`src/main/hostLabelHandler.ts`)

```ts
export interface HostLabelHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

export function registerHostLabelHandler(
  target: HostLabelHandleTarget,
  deps: { store: Pick<HostLabelStore, 'load'> }
): () => void
```

```ts
const listener = async (): Promise<HostLabelResult> => {
  try {
    const label = await store.load()
    if (label === null) return { status: 'not-stored' }        // strict null, never truthiness
    if (label.length > MAX_HOST_LABEL_LENGTH) return { status: 'error' }
    return { status: 'stored', label }                          // verbatim
  } catch {
    return { status: 'error' }                                  // classify-don't-forward
  }
}
```

- **`Pick<HostLabelStore, 'load'>`, not the full store interface.** Structurally write-proof and
  erase-proof — the handler cannot call `save` or `clear` even by accident, so a read channel can
  never mutate at-rest state. The mirror image of [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823),
  which gave the pairing handler `Pick<HostLabelStore, 'save'>` so it could neither read the label
  back nor erase it.
- **`label === null`, never a truthiness test.** The single highest-risk line in the ticket: `''` is
  falsy, so `if (!label)` type-checks, reads naturally, and passes any test that only exercises a
  non-empty label — while silently collapsing a stored empty label into absence at the one boundary
  where #822 and #823 both paid to keep the distinction alive.
- **The bound is the exact negation of the write guard's.** `label.length > MAX_HOST_LABEL_LENGTH`,
  imported from `../shared/ipc/pairing` — the same constant, same expression polarity, same unit
  (UTF-16 code units) as `isPairingRequest`'s `label.length <= MAX_HOST_LABEL_LENGTH`. Re-declaring or
  re-measuring (byte length, code-point count) would disagree with the write bound for any non-ASCII
  label. `MAX_HOST_LABEL_LENGTH` bounds only what can be *written* through the IPC guard, not what is
  already on disk — a value stored before the bound existed, or by tampering that still decrypts — so
  this boundary re-applies it rather than trusting the write side retroactively.
- **Classify-don't-forward + log-free by construction.** Every throw — `MalformedHostLabelError` or a
  propagated decrypt failure whose message can carry a filesystem path or keychain detail — collapses
  to `error` without inspecting the error type; the caught object is dropped, never logged,
  interpolated, or returned. No `console.*` anywhere in the module, on any branch. `handle` must
  resolve to a value, so the listener never rethrows.
- **Stateless** — reads the store fresh on every invoke (no cache), so a label written at pairing
  confirm is visible on the very next invoke with no invalidation step.
- Nothing Electron-specific is imported — `ipcMain` satisfies `HostLabelHandleTarget` structurally, so
  the unit test injects a fake `{ handle: vi.fn(), removeHandler: vi.fn() }`.

### 3. Preload bridge (`src/preload/index.ts`)

```ts
hostLabel: (): Promise<HostLabelResult> => ipcRenderer.invoke(HOST_LABEL_CHANNEL),
```

`HOST_LABEL_CHANNEL` fixed at the call site so the renderer cannot address arbitrary channels; called
with no second argument — no data leaves the renderer. `PyryApi = typeof api` re-derives
`window.pyry.hostLabel` automatically — no `index.d.ts` edit. No caller wired yet.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterHostLabel = registerHostLabelHandler(ipcMain, { store: hostLabelStore })
app.on('will-quit', () => unregisterHostLabel())
```

Registered immediately after `registerServerInfoHandler`, reusing the **same** `hostLabelStore`
[#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) already constructs there — no second
store built, the same discipline as the server-info/paired-server-store pairing. Needs only the store
(no `connection`, no `did-finish-load` gate), so placement is not correctness-critical; grouped with
its store-only siblings for readability. `will-quit` teardown, symmetric with the other three.

## Data flow

```
renderer window.pyry.hostLabel()  →  ipcRenderer.invoke(HOST_LABEL_CHANNEL)   [no body]
  →  ipcMain handler listener  →  HostLabelStore.load()
       null                        →  { status: 'not-stored' }
       string, length <= 128       →  { status: 'stored', label }              [verbatim]
       string, length > 128        →  { status: 'error' }                      [dropped whole]
       throws (any error type)     →  { status: 'error' }                      [no detail]
```

## Security posture

**Verdict: PASS** (architect self-review, `security-sensitive`). Key findings:

- **No untrusted input to validate** — zero-argument invoke, same as its three siblings.
- **Exactly one field can ever cross, statically enforced.** `label` is the sole field on the sole
  arm that carries data; the other two arms are value-free by the type, not by handler care.
- **No new class of power.** A renderer that will be shown the label anyway (once #826 renders it)
  gaining read access to it now is a minimal, strictly-scoped relaxation — no route to the token, the
  server key, or any keychain detail.
- **Absence is never invented, and never confused with a stored empty string.** `not-stored` is the
  only path from `null`; `''` always yields `stored`. `error` is deliberately distinct from
  `not-stored`, mirroring `PairingStatus`.
- **A tampered or oversized blob is contained, not surfaced.** Over-length is rejected whole (no
  truncation, no prefix, no reported length); invalid UTF-8 and AEAD-decrypt failure both land on the
  same value-free `error` arm.
- **Connection-independence is structural.** The handler holds no reference to the relay connection,
  the supervisor, or any session value — there is no code path by which a live connection could affect
  the result.

## Edge cases and limitations

- **The label used to outlive an unpair; [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) closed the normal case.**
  [#173](../codebase/173.md)'s unpair used to clear only `pairedServerStore`; `unpairHandler.ts` now
  also clears the label (via a `clear`-only handle over this same store), ordered after the record's
  own erase and before the teardown trigger — see [Unpair channel § the label erase
  (#827)](unpair-channel.md). After an unpair this channel returns `{ status: 'not-stored' }` for the
  previous host. **One residual:** the two erases are not atomic, so a crash between them can still
  leave an orphan label this channel would faithfully report as `stored` — a self-healing
  interleaving (the next pairing that carries a label overwrites it; the next unpair erases it), not
  a cross-store consistency check this handler is responsible for adding.
- **`error` and over-length both mean "no usable label," and the union does not distinguish them.**
  Both call for the same recovery (re-enter the label) in #826's design; if a reason to split ever
  surfaces, the union extends additively then.
- **Single fixed store name.** `HOST_LABEL_NAME` is one constant — no per-server-id keying yet. When
  that lands (see [host-label store](host-label-store.md) § Edge cases), this query gains an argument
  and stops being body-free, and needs a request guard the way `pairing.ts` has one and this channel
  currently does not.
- **Repeated invokes are cheap** — each is an independent local `store.load()`, no amplification, no
  state mutation, no secret returned.

## Related

- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) —
  `load()`, the source of all three outcomes, and the never-stored/stored-empty/malformed distinction
  this channel exists to carry across the boundary intact.
- [Pairing IPC channel](pairing-ipc-channel.md) § Confirm carries an optional host label
  ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)) — the write half this channel
  mirrors; `MAX_HOST_LABEL_LENGTH` is declared there and imported here, not redeclared.
- [Server-info channel](server-info-channel.md) / [#339](../codebase/339.md) — the closer file-shape
  twin and the channel this ticket deliberately does **not** extend; see § Why a new channel above.
- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the three-arm,
  `error`-distinct-from-not-paired precedent this channel's union is modelled on, per ADR 0005.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the fail-closed,
  classify-don't-forward discipline the `catch` implements, and the rule that an unreadable record must
  never be masked as never-stored.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the renderer store and one-shot loader that call this channel. **Read the full hand-off there.**
- Downstream, not yet built: the sidebar host row that mounts the store's binding and renders the
  value, including the never-stored/error fallback and the escaped-text-only rendering rule (CLAUDE.md,
  operator ruling 2026-08-20) — [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834).
