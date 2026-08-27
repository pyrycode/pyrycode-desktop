# #824 — Expose the stored host label to the window

**Ticket:** [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) · **Size:** S · **Labels:** `enhancement`, `security-sensitive`

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/serverInfoHandler.ts:1-67` | **The file this ticket mirrors.** Injected `HandleTarget` interface, single registration + exact teardown, stateless read-through listener, classify-don't-forward `catch`, explicit field naming (never `...record`), log-free by construction. Copy the discipline, not the fields. |
| `src/main/serverInfoHandler.test.ts:1-161` | The test idiom to follow: `fakeTarget()` = `{ handle: vi.fn(), removeHandler: vi.fn() }`, `listenerOf(target)` pulls `target.handle.mock.calls[0][1]`, `Object.keys(response).sort()` structural pins, `JSON.stringify(response).not.toContain(SECRET)` leak assertions, a log-free loop over every branch. |
| `src/shared/ipc/serverInfo.ts:1-51` | The shared-contract file shape: channel constant + union, **no runtime logic, no request guard, no test file**. Also read the seal: *"do NOT add any field to the present arm"* — Decision 1 explains why this ticket honours it. |
| `src/shared/ipc/pairingStatus.ts:28-47` | The **three**-arm precedent, and the ADR 0005 rationale for `error` being deliberately distinct from `not-paired`. This ticket's union follows this shape, not `ServerInfo`'s two-arm collapse. |
| `src/main/hostLabelStore.ts:37-68` | `HostLabelStore` interface + `MalformedHostLabelError`. The `load()` doc is the contract this handler classifies: `null` = never stored, `''` = a stored value, throw = unreadable. |
| `src/main/hostLabelStore.ts:115-141` | `createHostLabelStore` + `load`'s implementation comment: absent is *the only null path*, and stored-empty stays distinguishable because `secureStore.get` tests the **ciphertext** for null. This is what makes AC2 achievable at all. |
| `src/shared/ipc/pairing.ts:30-41` | `MAX_HOST_LABEL_LENGTH = 128` and its doc: **UTF-16 code units**, exported precisely so this read path bounds against the same constant. Import it; do not re-declare, do not re-export. |
| `src/shared/ipc/pairing.ts:110-120` | `isPairingRequest`'s `case 'confirm'` — the exact write-side expression (`label.length <= MAX_HOST_LABEL_LENGTH`) this read path must agree with, character for character. |
| `src/preload/index.ts:72-100` | The three zero-argument invoke bridges (`pairingStatus`, `unpair`, `serverInfo`). The new method is a fourth in that row; match the doc-comment shape and the fixed-channel discipline. |
| `src/main/index.ts:143-170` | `hostLabelStore` is already constructed at :150 (by #823). The `registerPairingStatusHandler` / `registerServerInfoHandler` pair at :158-170 is the exact registration + `will-quit` teardown block to extend. |
| `docs/knowledge/features/host-label-store.md` § Security properties | *"The value `load` returns is untrusted display text — hand off, do not lose it"*, and the named obligation: **#824 must bound the length again at the IPC read boundary.** |
| `docs/knowledge/features/server-info-channel.md` | The four-layer shape (shared contract → main handler → preload bridge → composition-root registration) this ticket reproduces, and its "Why a new channel" section — the same argument, one store over. |

> Codegraph is not indexed for this repo (`codegraph_context` → *"CodeGraph not initialized"*, confirmed 2026-08-27). The list above was assembled by reading; no codegraph output backs it.

## Design source

N/A — this ticket ships an IPC read path with **no rendered output whatsoever**. Nothing in the diff reaches `src/renderer/`. The sidebar host row that displays the label, and the fallback for an empty or absent one, are [#826](https://github.com/pyrycode/pyrycode-desktop/issues/826). Code-review's visual-fidelity check is intentionally skipped here.

## Context

[#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) built the host-label store in the background process; [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) wired its write path into pairing confirm. The label now persists, and **nothing can read it back** — it sits behind the same process boundary as the bearer token, and `src/main/index.ts:148-149` says in terms that the pairing handler receives only `save`, with the read path deferred to this ticket.

This ticket adds that read path: a fourth channel in the `pairingStatus` / `unpair` / `serverInfo` family, shipped ahead of its consumer exactly as those three were.

The whole difficulty is that **three stored states reach this boundary and #822 kept them apart on purpose**. `load()` returns `null` for never-stored, returns `''` for a label the operator supplied as empty, and throws for a present-but-unreadable blob. This is the last place that distinction can be thrown away, and the two ways to throw it away are both one character wide: a truthiness test instead of `=== null`, or a two-arm union instead of three.

`#823`'s `MAX_HOST_LABEL_LENGTH` bounds what can be *written* through the IPC guard. It does not bound what is already on disk — a value written before the bound existed, or by a future second writer, or by tampering with the blob in a way that still decrypts. So the read path brings its own bound, against the same constant.

## Design

Four layers, additive throughout. **No existing type changes shape and no existing call site moves**, so there is no consumer cascade.

### Layer 1 — the shared contract: `src/shared/ipc/hostLabel.ts` (new)

A channel constant plus a sealed three-arm union. **No runtime logic**, matching `serverInfo.ts` and `pairingStatus.ts`; imports nothing from `src/main`; relative imports only.

```ts
export const HOST_LABEL_CHANNEL = 'pyry:host-label' as const

export type HostLabelResult =
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }
```

Verified free of collision against the seven existing channel constants in `src/shared/ipc/`.

The `label` field on the `stored` arm is **the only field on the whole union**. The other two arms declare no property beyond the discriminant, so the handler structurally cannot serialize a token, a server key, a keychain path, an error message, or a truncated label prefix on either of them (AC5, enforced by the type rather than by the handler's care).

**Naming.** `HostLabelResult`, not `HostLabel` — the union is the outcome of a query, and a bare `HostLabel` would read as the string itself at every call site. `stored` / `not-stored` / `error` mirror `PairingStatus`'s `paired` / `not-paired` / `error`, including the hyphenated negative and the `error` arm whose name carries the ADR 0005 precedent.

The module's doc comment must state, for the next reader:

- why the `not-stored` and `error` arms are value-free and must stay that way (no error-reason field — a coarse category still leaks backend detail, the `pairingStatus.ts:39-42` argument);
- why `not-stored` declares **no** `label` key rather than `label: undefined`. This repo has measured that structured clone across the IPC bridge **preserves** an own `undefined` property (unlike `JSON.stringify`), so `{ status: 'not-stored', label: undefined }` would arrive with `'label' in result === true` and a renderer using an `in` test would misread absence. Declaring the key only on the `stored` arm makes that unrepresentable.

### Layer 2 — the main handler: `src/main/hostLabelHandler.ts` (new)

A twin of `serverInfoHandler.ts`: same injected-target shape, same single-registration / exact-teardown discipline, same stateless read-through (holds nothing between calls, takes no request argument — the query carries no body).

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

Registers exactly one listener on `HOST_LABEL_CHANNEL`; the returned handle removes exactly that channel.

**The listener's classification, in order.** Roughly fifteen lines; the order is load-bearing and each step is asserted by a named test below.

1. `await store.load()` inside a `try`.
2. `label === null` → `{ status: 'not-stored' }`. **Strict null, never truthiness** — see Decision 3.
3. `label.length > MAX_HOST_LABEL_LENGTH` → `{ status: 'error' }`. The over-long string is dropped here and never reaches the response — no truncation, no prefix, no length (AC4). Placed after step 2 because `null` has no `.length`.
4. Otherwise `{ status: 'stored', label }` — the string passes through untouched: no trim, no normalize, no escape, no case fold, no fallback substitution (AC2).
5. `catch { return { status: 'error' } }` — classify-don't-forward. Every throw (`MalformedHostLabelError`, a propagated decrypt failure, anything else) collapses to the same arm **without inspecting the error type**, and the caught object is dropped: never logged, never interpolated, never returned. `handle` must resolve to a value, so this never rethrows.

The module is **log-free by construction**: no `console.*` anywhere, on any path including every error path (AC5). The label is an opaque local, never a named field of a logged object.

### Layer 3 — the preload bridge: `src/preload/index.ts` (modified, ~14 lines)

A fourth zero-argument invoke method beside `serverInfo`:

```ts
hostLabel: (): Promise<HostLabelResult> => ipcRenderer.invoke(HOST_LABEL_CHANNEL),
```

`HOST_LABEL_CHANNEL` is fixed here so the renderer cannot address arbitrary channels; `ipcRenderer` never crosses the bridge. `invoke` returns `Promise<any>`, so the narrower declared return type is a typed wrapper, not an unsafe cast — same as its three siblings. `src/preload/index.d.ts` needs **no edit**: it derives `PyryApi` from `typeof api`.

The doc comment should say the query is connection-independent (it reads at-rest state, never a live connection value) and that no caller is wired yet — the renderer store is #826.

### Layer 4 — composition root: `src/main/index.ts` (modified, ~12 lines)

Register immediately after the `registerServerInfoHandler` block (`:169-170`), inside the same store-only group:

```ts
const unregisterHostLabel = registerHostLabelHandler(ipcMain, { store: hostLabelStore })
app.on('will-quit', () => unregisterHostLabel())
```

Reuses the `hostLabelStore` already constructed at `:150` — **do not build a second store**, exactly as the pairing-status and server-info registrations reuse `pairedServerStore`. Registered synchronously before `createWindow()`, so the handler exists when a renderer invoke could first arrive. `will-quit` teardown, symmetric with `unregisterServerInfo`.

Update the `:143-149` comment, which currently reads *"the read path is #824"* — it now points at this handler.

## Decisions

### Decision 1 — its own channel, not a third field on `ServerInfo`

The ticket asks for a justification if the sealed arm is reused. It is not reused, for four independent reasons; the first alone is sufficient, and the second makes the reuse impossible without redesigning `ServerInfo`.

1. **The seal.** `src/shared/ipc/serverInfo.ts:44-46` says *"do NOT add any field to the present arm."* The seal is what makes it impossible by construction for that handler to serialize `token` or `server_static_pubkey`; a third field would be the first crack, and every later field would cite this one as precedent.
2. **The outcome cardinality is incompatible.** `ServerInfo` deliberately *collapses* not-paired and unreadable into one `unavailable` arm (`serverInfo.ts:38-40`). This ticket's AC3 requires those two kept apart. A shared discriminant cannot be both collapsed and split, so the label would need its own nested status field inside `ServerInfo` — a worse version of a separate union, on a channel whose contract forbids the widening.
3. **The lifetimes are independent.** A pairing created before #823 shipped has a record and no label. "Record available + label not-stored" is reachable today, and a single arm cannot express it without an optional field — precisely the widening the seal forbids.
4. **The failure domains are independent.** They read two different names through `secureStore`. Joined, an unreadable *record* would have to report the label as unavailable too, and vice versa, manufacturing a false correlation between two independent at-rest values.

This is the same argument the [server-info channel](../../knowledge/features/server-info-channel.md) § *Why a new channel, not `pairingStatus`* made one store earlier, and it resolves the same way: a dedicated channel keeps the sealed one sealed and confines the new surface to a separately-reviewed boundary.

### Decision 2 — three arms, modelled on `PairingStatus` rather than `ServerInfo`

`ServerInfo`'s two-arm shape is the wrong template despite being the closer file-shape twin, for the reason in Decision 1.2. `PairingStatus` is the right one: ADR 0005 forbids masking an unreadable record as never-paired, and `pairingStatus.ts:34-35` records that `error` is deliberately distinct from `not-paired` for exactly that reason. The same rule applies to the label, and `hostLabelStore.ts:56-58` says so directly — the malformed error exists so a consumer can branch to a re-enter-the-label recovery *"rather than treat corruption as never-stored."*

Distinct does not mean detailed: both non-`stored` arms stay value-free, exactly as `PairingStatus`'s three arms are. No error-reason field, now or later.

### Decision 3 — `label === null`, never a truthiness test

**This is the single highest-risk line in the ticket.** `''` is falsy. `if (!label) return { status: 'not-stored' }` type-checks, reads naturally, passes any test that only exercises a non-empty label, and silently violates AC2 *and* AC3 at once — collapsing a stored empty label into absence at the last boundary where the distinction still exists, after #822 and #823 both paid to preserve it (`hostLabelStore.ts:135-139`, and #823 saving `''` verbatim).

The same trap applies in the arm shape: `''` must produce `{ status: 'stored', label: '' }`, not a `not-stored` arm and not a `stored` arm with the label omitted.

Test 3 below exists solely to fail if this line ever regresses, and the handler comment should say so.

### Decision 4 — the read bound: same constant, same expression, same unit

Import `MAX_HOST_LABEL_LENGTH` from `../shared/ipc/pairing` and compare with `label.length > MAX_HOST_LABEL_LENGTH` — the exact negation of `isPairingRequest`'s `label.length <= MAX_HOST_LABEL_LENGTH` (`pairing.ts:116`).

**Do not re-declare the constant, do not re-export it through `hostLabel.ts`, and do not substitute a different measure.** `.length` is UTF-16 code units; a byte length (`TextEncoder().encode(label).length`) or a code-point count (`[...label].length` / `Intl.Segmenter`) would disagree with the write bound for any non-ASCII label, and `pairing.ts:37-39` states the consequence in terms: *"a read bound disagreeing with this write bound would let a value pass one boundary and fail the other."* The invariant to hold: for any given string, whatever the write guard accepts this must accept, and whatever it rejects this must reject. A 70-emoji label — 140 UTF-16 code units, 280 UTF-8 bytes, 70 code points — is rejected by the write guard, and only the `.length` comparison rejects it here too.

Rejected alternative: moving the constant into `hostLabel.ts` so the read path owns it. It would touch `pairing.ts`, `pairing.test.ts` and the pairing-channel knowledge doc, invalidate a comment #823 shipped days ago, and buy nothing — a cross-import between two `src/shared/ipc/` modules is not a layering violation.

Over-length takes `error`, not a fourth arm and not `not-stored`: the ticket says so (*"it takes the unreadable outcome"*), and it is the honest classification — the store yielded something, but not a usable label.

### Decision 5 — `Pick<HostLabelStore, 'load'>`

The handler is typed against `Pick<HostLabelStore, 'load'>`, not the full interface. It is structurally **write-proof and erase-proof**: it cannot call `save` or `clear` even by accident, so a read channel can never mutate at-rest state.

This is a deliberate strengthening over `serverInfoHandler`, which takes the full base `PairedServerStore`. The precedent is one ticket old and in this exact module: #823 gave the pairing handler `Pick<HostLabelStore, 'save'>` so it could neither read the label back nor erase it. This is the mirror image. Erasing is [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827).

### Decision 6 — no shared-module test, no renderer consumer, no bound in the renderer

- `hostLabel.ts` ships **no test file**. It has no runtime logic — same as `serverInfo.ts` and `pairingStatus.ts`, both of which are test-free. `pairing.ts` has one only because it ships a guard. Its correctness is enforced by `npm run typecheck` and by the handler's tests importing the constant rather than a literal.
- **No renderer store, no component, no state.** Nothing under `src/renderer/` is touched. #826 owns the store, the row, and the fallback for an empty or absent label.
- **No second bound in the renderer.** The renderer trusts main; the bound belongs at the one boundary the untrusted disk value crosses. #825 bounds the *input* field for UX on the way in — a different boundary, not a duplicate of this one.

## State + concurrency model

Stateless. No store, no cache, no memo, no timer, no listener, no `AbortController`. Each invoke reads through `hostLabelStore.load()`, so a label written by pairing confirm is visible on the very next invoke with no invalidation step.

There is deliberately **no read-modify-write** anywhere on this path: the handler only reads, and `hostLabelStore.ts:43-44` records that the store ships no read-modify-write helper precisely to keep a check-then-act race unrepresentable. Concurrent invokes are independent reads of the same at-rest name; they cannot interleave into a wrong result.

Teardown is the single `removeHandler(HOST_LABEL_CHANNEL)` call the register function returns, invoked from `will-quit`. `ipcMain.handle` permits one handler per channel, so this is the sole registration site and the removal is exact.

Connection-independence (AC1) is structural rather than defended: the handler reads the at-rest store and holds no reference to the relay connection, the supervisor, or any session value. There is no code path by which a live connection could affect the result.

## Error handling

| `store.load()` yields | Response | Notes |
|---|---|---|
| `null` | `{ status: 'not-stored' }` | The **only** not-stored path. |
| `''` | `{ status: 'stored', label: '' }` | A stored value. Never `not-stored`. |
| a string, `length <= 128` | `{ status: 'stored', label }` | Verbatim — no transformation of any kind. |
| a string, `length > 128` | `{ status: 'error' }` | Value dropped entirely; no truncation, no prefix, no length reported. |
| throws `MalformedHostLabelError` | `{ status: 'error' }` | Type never inspected, never surfaced. |
| throws anything else (propagated decrypt failure, keychain rotation) | `{ status: 'error' }` | Same arm, same drop. Its message can carry a filesystem path or keychain detail. |

The listener never rejects — `ipcMain.handle` must resolve to a value, and a rejection would cross as an Electron-serialized error carrying a main-process stack trace.

Nothing on this path surfaces to the user; #826 owns what each arm renders.

## Testing strategy

`src/main/hostLabelHandler.test.ts` (new), vitest, following the `serverInfoHandler.test.ts` idiom: a `fakeTarget()` of two `vi.fn()`s, a `listenerOf()` helper pulling `target.handle.mock.calls[0][1]`, and a fake store built per case. No Electron harness, no keychain, no filesystem.

Scenarios:

1. **Registration and teardown** — exactly one `handle` call, on `HOST_LABEL_CHANNEL` referenced as the imported constant (a rename must not silently pass); the returned handle calls `removeHandler` exactly once with that same channel.
2. **A stored label crosses verbatim** — `'Pyrybox'` → deep-equals `{ status: 'stored', label: 'Pyrybox' }`, and `Object.keys(response).sort()` is exactly `['label', 'status']`. Include one awkward-but-valid label in the same test or a sibling — leading/trailing whitespace, a leading `U+FEFF`, an emoji — asserted byte-identical, pinning "no trim, no normalize, no fallback".
3. **Stored empty is stored, not absent** — `''` → `{ status: 'stored', label: '' }`. **The Decision 3 regression test.** Name it so the intent survives: a truthiness check must fail here and nowhere else.
4. **`null` is absent, and absence carries no label key** — `null` → `{ status: 'not-stored' }`, plus `'label' in response === false` (not merely `label === undefined`, which the structured-clone note above makes a materially different assertion) and `Object.keys(response)` is exactly `['status']`.
5. **The bound agrees with the write guard** — a label of exactly `MAX_HOST_LABEL_LENGTH` (imported, never `128` as a literal) → `stored`, verbatim; one over → `{ status: 'error' }`. Mirrors the `pairing.test.ts:80-86` boundary pair.
6. **An over-long label leaves no residue** — a distinctive over-long sentinel; assert `JSON.stringify(response)` contains no prefix of it (e.g. its first 16 characters), and that the response has no `label` key. This is the "never a truncated value" half of AC4.
7. **`MalformedHostLabelError` → `error`, resolves rather than rejects** — asserted as `resolves.toEqual(...)`, so a rethrow fails the test.
8. **A propagated decrypt failure → `error`, no detail crosses** — throw a plain `Error` (not `MalformedHostLabelError`, proving no type branching) whose message embeds a keychain-path sentinel; assert the response equals `{ status: 'error' }` and that `JSON.stringify(response)` does not contain the sentinel.
9. **Log-free on every branch** — spy `console.error` / `console.log` / `console.warn`, drive all six rows of the error table above, assert none was called.
10. **Read-only at runtime** — pass a full `HostLabelStore` with `save` and `clear` spied, drive every branch, assert neither was called. The `Pick` type already makes this unrepresentable; this pins it against a future widening of the dep type.
11. **Reads through, no cache** — a `load` returning `'first'` then `'second'` across two invokes yields both in order.

Type-level coverage comes from `npm run typecheck`: the union's exhaustiveness, the `Pick`'d dep, and the preload method's declared return type are all compile-time. Gate is `npm run build` (typecheck + build) plus `npm test`.

Not covered by this ticket: no Playwright spec. There is no interactive surface, and the repo's renderer tests are static server renders with no DOM — there is nothing to click and nothing rendered. The e2e coverage arrives with #826's sidebar row.

## Files touched

| File | Change | Rough size |
|---|---|---|
| `src/shared/ipc/hostLabel.ts` | **new** — channel constant + `HostLabelResult` union + doc comment | ~55 lines, mostly comment |
| `src/main/hostLabelHandler.ts` | **new** — `HostLabelHandleTarget` + `registerHostLabelHandler` | ~70 lines, mostly comment |
| `src/main/hostLabelHandler.test.ts` | **new** — the 11 scenarios above | ~200 lines |
| `src/preload/index.ts` | modified — one `hostLabel()` method + import | ~14 lines |
| `src/main/index.ts` | modified — one registration + `will-quit`, and refresh the `:143-149` comment | ~12 lines |

Four production source files (two new, two modified) — under the five-file ceiling. No existing signature changes, so the consumer call-site count is zero. `src/preload/index.d.ts` needs no edit.

**Explicitly out of scope:** any file under `src/renderer/`, any knowledge-base doc (the documentation phase folds this in after code review), and `docs/knowledge/INDEX.md`.

## Open questions

1. **Should `error` and the over-length case ever be told apart by the renderer?** Both mean "the store did not yield a usable label" and #826's recovery is the same for each — offer to re-enter the label. The union stays sealed at three arms; if #826 discovers a reason to split, it extends additively then, with the evidence in hand.
2. **Multi-host keying.** `HOST_LABEL_NAME` is a single fixed name (`hostLabelStore.ts:70-76` calls per-server-id keying a deferred one-line change). When that lands, this query grows a server-id argument and stops being body-free — at which point it needs a request guard, the way `pairing.ts` has one and the three zero-argument channels do not. Out of scope; noted so the next reader does not mistake the missing guard for an oversight.
3. **The label outlives an unpair.** #173 clears only `pairedServerStore`, so after an unpair this channel still returns `{ status: 'stored', ... }` for the previous host. That is [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)'s gap, not this ticket's — the handler faithfully reports what is on disk, and inventing a cross-store consistency check here would couple two independent at-rest values (Decision 1.4).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. There are two, both explicit and both single-function. (a) **Disk → main memory**: `hostLabelStore.load()`, whose `fatal: true` TextDecoder (`hostLabelStore.ts:107-113`) is the sole place bytes become a string; this handler consumes its typed three-outcome result and never touches `secureStore` or the filesystem itself. (b) **Main → renderer**: the handler listener, which is where the untrusted-but-decoded string acquires its length bound before crossing. The downstream signal is the type: a renderer holding `HostLabelResult` knows from the union that a `label` exists only on the `stored` arm and is ≤ `MAX_HOST_LABEL_LENGTH`. Direction matters here — this response travels main→renderer, so there is no untrusted *request* field and therefore, correctly, no request guard (the `serverInfo.ts:11-13` argument); the query carries no body. Open question 2 names when that changes.
- **[Tokens, secrets, credentials]** No findings, and the risk is closed structurally rather than by care. The handler is typed against `Pick<HostLabelStore, 'load'>` over the label's own `HOST_LABEL_NAME`, so it has no reachable path to `pyrycode.paired_server` (bearer token) or `pyrycode.device_static` (static private key) — no name is caller-supplied, and no `secureStore` handle is in scope. The response union declares exactly one field on one arm, so no credential is *representable* in the reply. Nothing here creates, rotates, or revokes a token. The label itself is not a credential (`host-label-store.md` § Security properties); it rides `safeStorage` for AEAD integrity, which is what gives AC4/AC5's "unreadable ⇒ `error`" any teeth — a tampered blob fails decryption rather than returning a plausible string.
- **[File / storage operations]** No findings. Zero filesystem code in the diff — no path is constructed, joined, resolved, or opened, so path traversal and TOCTOU have no surface. No caller-supplied string ever reaches a persistence name: the label is only ever a *value*, and `hostLabelStore.ts:70-76` keeps the name a module constant. At-rest storage and encryption were decided in #822 (`safeStorage` under `app.getPath('userData')`) and are unchanged. No atomic-write concern: this path never writes.
- **[Inter-process / Electron attack surface]** No findings, and this is the category with real surface. The diff adds exactly one `ipcMain.handle` channel and one `contextBridge` method. The channel **accepts nothing** — zero arguments, no request body, so there is no argument to validate; the `IpcMainInvokeEvent` is typed `unknown` and never read, so `.sender` / `.ports` are unreachable. The exposed capability is minimal and non-parameterised: `hostLabel()` cannot be pointed at another name, another store, or another channel, because `HOST_LABEL_CHANNEL` is fixed at the preload call site and `ipcRenderer` never crosses the bridge. A compromised renderer gains exactly one new power: reading a display string it will be shown anyway. No window options, navigation handlers, custom protocols, or remote content are touched. Process placement is respected — nothing in `src/shared/ipc/hostLabel.ts` imports from `src/main`, and no key, socket, or raw byte moves toward the renderer.
- **[Cryptographic primitives]** Not applicable, by a design decision rather than by absence: this path performs no cryptographic operation at all. Decryption and AEAD integrity happen inside `secureStore` behind the injected seam, chosen in #822; no RNG, no comparison against a secret (so no `timingSafeEqual` question arises — the only comparison is `label.length > MAX_HOST_LABEL_LENGTH`, a length against a public constant), no key or nonce handling. Hand-rolling was never on the table.
- **[Network & I/O]** Not applicable. No socket, no WebSocket frame, no URL, no relay interaction, no timeout, no reconnect. The handler is connection-independent by construction (see § State + concurrency model) and reads only at-rest local state, so a hostile or absent relay cannot influence its result or its latency.
- **[Error messages, logs, telemetry]** No findings — this is the category the design most actively defends. Classify-don't-forward: every throw collapses to `{ status: 'error' }` **without inspecting the error type**, and the caught object is dropped rather than logged, interpolated, or returned. That matters concretely: a propagated decrypt failure's message can carry a filesystem path or OS-keychain detail, and `MalformedHostLabelError`'s existence is itself a fact about at-rest state. The module is log-free on every branch including every error branch (AC5), asserted by scenario 9 across all six rows of the error table, with scenarios 6 and 8 asserting no residue — no over-long-label prefix, no keychain-path sentinel — survives into the serialized response. No telemetry, no crash reporter, no renderer-console path: nothing is written anywhere.
- **[Concurrency]** No findings. Nothing long-lived is launched: no timer, no interval, no listener beyond the single `ipcMain.handle` registration, no in-flight request to abort — so there is no `AbortController` to thread and nothing that can outlive the window. Ownership and cancellation are the one `removeHandler` the register function returns, called from `will-quit`, removing exactly the channel it added. No check-then-act race: the handler reads across a single `await` and mutates nothing, and the store deliberately ships no read-modify-write helper (`hostLabelStore.ts:43-44`). Shutdown mid-read is safe — the read is non-destructive and leaves no partial state. Duplicate registration is prevented by `ipcMain.handle`'s one-handler-per-channel rule plus this being the sole registration site.
- **[Threat model alignment]** Addressed per applicable desktop threat. **Renderer compromise reaching the transport** — the primary threat for a new IPC surface, and it is contained: the new capability is a parameterless read of a display string, with no route to a key, the token, or the socket (see Electron attack surface above). **Token theft from disk** — unchanged; this ticket adds no new at-rest data and no new persistence path. **Malicious / compromised relay** — not on this path at all; no relay value can reach it. **Hostile daemon response** — not applicable: the label has no wire field and the daemon never sees or supplies it (`hostLabelStore.ts:2-6`), so no daemon-controlled value can reach this store. The one genuinely applicable hostile-input case is **a tampered or oversized blob on disk**, and it is exactly what AC4 and the `error` arm exist for: over-length is rejected whole rather than truncated, invalid UTF-8 fails decode, and a tampered ciphertext fails AEAD decryption — all three land on the same value-free arm. **Rendering the untrusted string safely** (escaped text only — never `dangerouslySetInnerHTML`, an attribute, a URL, a filename, or a lookup key, per CLAUDE.md and the 2026-08-20 operator ruling) is **OUT OF SCOPE**, owned by [#826](https://github.com/pyrycode/pyrycode-desktop/issues/826); this ticket discharges its own half of that hand-off by bounding the length, which is the obligation `host-label-store.md` names for #824 by number.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
