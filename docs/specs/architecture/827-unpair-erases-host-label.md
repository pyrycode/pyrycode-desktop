# #827 — Unpairing erases the stored host label

**Size:** XS · **Slice of:** #688 (the last one) · **Labels:** `security-sensitive`

## Design source

N/A — main-process only. This ticket adds one erase call to an IPC handler and one wiring line at
the composition root. No renderer file changes, no new rendered surface, no token consumed. The
visual-fidelity check is intentionally skipped; the label's *rendering* is #834's ticket.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/unpairHandler.ts:1-87` | The whole module — it is short. Header comment 1-16 is the fail-closed rationale you extend; the listener 55-83 is where the change lands; **69-81 is the `onUnpaired` block whose exact shape the label erase copies**. |
| `src/main/hostLabelStore.ts:46-53` | The `HostLabelStore` interface. The new dep is typed off line 52 (`clear`). |
| `src/main/hostLabelStore.ts:142-148` | `clear()`'s contract: idempotent (absent name → no-op) and fail-closed (a delete failure propagates). Both properties are load-bearing here — they are why AC2 needs no guard. |
| `src/main/hostLabelHandler.ts:40-48` | The `Pick<HostLabelStore, 'load'>` precedent: a narrowed store handle at a single-purpose seam. Mirror it in the other direction. |
| `src/main/pairingHandler.ts:107-128` | The **write path's identical decision** — the label save sits outside the record's result-determining path, its throw is dropped, and it is ordered after the record and before `onPaired`. Your ordering argument is the mirror image of this comment. |
| `src/main/index.ts:144-151` | Where the one `hostLabelStore` is constructed. Its comment ends `(erasing is #827)` — a forward reference this ticket makes stale. |
| `src/main/index.ts:173-182` | The `#824` registration comment, carrying the same stale `(erasing is #827)` forward reference. |
| `src/main/index.ts:245-263` | The `registerUnpairHandler` call site the one wiring line joins. |
| `src/main/unpairHandler.test.ts:1-38` | The helpers your new cases reuse verbatim: `fakeTarget`, `listenerOf`, `storeWithClear`, and the `SECRET_PATH` constant. |
| `src/main/unpairHandler.test.ts:109-197` | The log-free case to extend, and the `onUnpaired` describe block whose three cases your label cases mirror one-for-one. |
| `src/renderer/src/screens/conversation/unpairAction.ts:33-49` | `runUnpair`'s fail-safe contract: `ok` flips the route, `error` **and** a rejected invoke both stay on the conversation screen. This is *why* a throw after the record is gone must not become `error`. |
| `src/main/daemonConnection.test.ts:1021-1025` | The third `registerUnpairHandler` call site. Confirm it stays untouched — the new dep is optional. |
| `docs/knowledge/features/host-label-store.md` | The shipped store contract and the #822–#834 slice map. Read-only; the documentation phase owns it. |

## Context

#822 shipped the host-label store; #823 writes it at pairing time, #824 reads it back over IPC,
#825 collects it, #833 holds it in the window. Nothing erases it. `unpairHandler.ts` already erases
the paired-server record and fires the teardown trigger — the label has to go at the same moment,
or it outlives the record it described.

This is not merely tidy. `pairingHandler.ts:118` gates the label save on `request.label !== undefined`,
so **re-pairing without typing a label leaves the previous machine's name on disk and in the UI**.
The user story's failure is reachable today, not hypothetical.

## The decision: which erase gates the `ok` result

**The record erase gates `ok`. The label erase never does.**

`UnpairResult` reports on exactly one thing: whether the credential is gone. `runUnpair`
(`unpairAction.ts:33-40`) reads it as exactly that — `ok` flips the route to the pairing screen,
while `error` *and* a rejected invoke both mean "stay on the conversation screen." So `error` is
only a truthful answer while the record may still be on disk. Once `store.clear()` has resolved,
the record **is** gone, and any later `error` produces a paired-looking UI over an erased record —
the precise inverse half-state that guard exists to prevent.

The two failures are not the same severity and must not collapse into one result value:

- A surviving **record** is a live bearer token. Reporting it erased is the failure the fail-closed
  catch exists to prevent.
- A surviving **label** is stale display text. It is overwritten by the next pairing that carries a
  label, erased by the next unpair, and visible only as a wrong nickname. It is recoverable by
  re-entering the label — never by anything the user cannot see.

Therefore the label erase sits **outside** the fail-closed catch, in the same "the record is gone"
region as `onUnpaired`, with its own catch that drops the throw.

This is the third site under one rule, not a new pattern: `pairingHandler.ts:121-127` already
decided the write-path half (a lost nickname must not be reported as a failed pairing), and
`unpairHandler.ts:77-81` already decided the callback half. **The result reports on the record.**

## Erase ordering

```
store.clear()          ← record (the credential) — inside the existing fail-closed try/catch
  ↓ (only on success)
hostLabel?.clear()     ← label (display text)    — own try/catch, throw dropped
  ↓ (unconditionally)
onUnpaired?.()         ← teardown trigger        — own try/catch, unchanged
  ↓
return { result: 'ok' }
```

**Record before label.** If the label went first and threw, the handler would either abort — leaving
a live token behind on an unpair request, the worst available outcome — or continue anyway, which
gains nothing from having gone first. Record-first also keeps the existing try/catch byte-identical:
everything new is additive and sits below the catch.

The crash-interleaving argument points the same way. A process kill between the two erases leaves
*no record + orphan label*, which is benign and self-healing (the next confirm carrying a label
overwrites it; the next unpair erases it). Label-first would risk the inverse — *record present,
label gone* — a live credential whose display name vanished, which is strictly worse.

**Label before `onUnpaired`.** All at-rest erasure completes before anything observable is signalled,
so the teardown trigger can never fire over a half-erased at-rest state. This costs nothing and the
alternative has no argument for it.

## Design

### The new dependency

Add one optional field to the existing `deps` object of `registerUnpairHandler`:

```ts
hostLabel?: Pick<HostLabelStore, 'clear'>
```

Three properties, each load-bearing:

- **Optional**, mirroring `onUnpaired?` here and `hostLabel?` in `pairingHandler.ts:66`. Every
  existing call site — `daemonConnection.test.ts:1025` and the ten registrations in
  `unpairHandler.test.ts` — keeps compiling untouched. No fixture cascade.
- **`Pick<…, 'clear'>`, not the full interface**, mirroring `hostLabelHandler.ts:46`'s
  `Pick<HostLabelStore, 'load'>` in the other direction. This is the AC4 mechanism: **without `load`
  on the handle, the label string is never materialised in this module at all.** "No label text
  reaches the result or any log" is then held by the type, not by a convention someone must keep.
- **Named `hostLabel`**, matching `pairingHandler`'s dep name and `index.ts:241`.

No new exported type. No change to `UnpairHandleTarget`, to `UNPAIR_CHANNEL`, or to `UnpairResult` —
the response stays the value-free enum, and the request still carries no body.

### The listener change

One `await` inside its own try/catch, placed between the existing catch and the `onUnpaired` block.
The catch is empty and drops the caught object, exactly as the two catches around it do:
`SecureStore.delete`'s failure can carry an OS-keychain or filesystem path in its message, so it is
never logged, interpolated, or returned. No `console.*` is added on any path — the module stays
log-free by construction.

Comment the block with *why* it sits outside the fail-closed catch (the section above), not with
what it does. The surrounding comments set the density: this module explains its reasoning.

### Wiring

`index.ts:259-262` gains `hostLabel: hostLabelStore` — **the same instance constructed at line 151**
and already threaded into `registerPairingHandler` (241) and `registerHostLabelHandler` (181). Do
not construct a second store.

Two comments in the same file carry a now-stale forward reference and should be corrected as part of
this change (not adjacent refactoring — they are direct statements about the code this ticket
changes):

- `index.ts:150` — "the read path is the host-label handler registered below, which gets a
  `load`-only handle (erasing is #827)".
- `index.ts:179-180` — "…and never a truncated label; never-stored and unreadable stay distinct. No
  caller races it — the consumer is #826."(the `erasing is #827` framing at 173-182).

Both should now read that the unpair handler holds a `clear`-only handle, closing the write / read /
erase triangle over one store: three seams, three disjoint `Pick`s, none able to do another's job.

## State + concurrency model

No store slice, no renderer state, no async task, no timer, no listener, no `AbortController`. The
handler stays stateless — it holds nothing between calls, and each invoke reads through to the
stores.

Two concurrent unpair invokes cannot race: both erases are idempotent deletes of fixed, distinct
names, so any interleaving lands on the same final state (both absent) and both invokes resolve
`ok`. Compare `pairingHandler.ts:105`, which needed a consume-before-await guard precisely because
it *has* shared state (`pendingConfirm`); this handler has none, so it needs none.

## Error handling

| Failure | Handler behaviour | Result |
|---|---|---|
| record `clear()` rejects | caught, object dropped; label erase and teardown both skipped — nothing was erased, so nothing must follow up | `error` |
| label `clear()` rejects (keychain gone, delete failure) | caught, object dropped; teardown still fires | `ok` |
| `onUnpaired()` throws | caught, dropped — unchanged | `ok` |
| no `hostLabel` dep wired | optional chain no-ops | `ok` |
| nothing was ever stored | `SecureStore.delete` no-ops in both stores; no guard needed | `ok` |

The renderer surfaces nothing new. A `result: 'ok'` over a failed label erase flips the route
exactly as today; the stale label is corrected by the next pairing that carries one.

## Testing strategy

Test-first, per CLAUDE.md. All cases go in `src/main/unpairHandler.test.ts` and reuse the existing
`fakeTarget` / `listenerOf` / `storeWithClear` / `SECRET_PATH` helpers (lines 1-38). Add a small
label-handle factory alongside `storeWithClear` returning `{ clear: vi.fn(...) }`. No keychain, no
filesystem, no Electron harness — the same plain-spy shape the file already uses.

New cases, mirroring the existing `onUnpaired` describe block one-for-one:

- **The label is erased on the success path.** Record `clear()` resolves ⇒ `hostLabel.clear` called
  exactly once, with no arguments, and the result is `{ result: 'ok' }`. *(AC1. Also covers AC2: the
  shipped `clear()` is idempotent on an absent label, so "never stored" is the same code path — no
  separate case, and no guard in production.)*
- **The label erase is not attempted when the record erase throws.** Record `clear()` rejects ⇒
  `hostLabel.clear` never called, result is `{ result: 'error' }`.
- **A throwing label erase still resolves `ok`.** Record `clear()` resolves, `hostLabel.clear()`
  rejects with a `SECRET_PATH`-carrying message ⇒ the listener **resolves** (never rejects) to
  `{ result: 'ok' }`. *(AC3.)*
- **No detail crosses back from a throwing label erase.** Same setup ⇒ `JSON.stringify` of the
  result contains neither `SECRET_PATH` nor any label-shaped substring, and equals exactly
  `{"result":"ok"}`. *(AC4.)*
- **Ordering is pinned.** Record `clear`, `hostLabel.clear` and `onUnpaired` each record into one
  shared array (or compare `mock.invocationCallOrder`) ⇒ record → label → callback. This makes the
  ordering decision above a test failure if reordered, not a silent regression.
- **A handler wired without `hostLabel` still resolves `ok`.** The optional-dep path — one explicit
  assertion so the shape is pinned rather than merely implied by the untouched existing cases.

Extend one existing case:

- **`logs nothing on the ok, the error, or the throwing-callback path`** (line 109) gains a fourth
  target: a throwing **label** erase. Same three `console` spies, same `not.toHaveBeenCalled()`
  assertions. *(AC4 — "on every path including each failure path" is now four paths.)*

Type-level coverage comes from `npm run typecheck`: the `Pick<HostLabelStore, 'clear'>` dep makes
`load` inaccessible in this module, so any attempt to read the label back is a compile error rather
than a review catch.

Gates: `npm test` and `npm run build`. No new e2e spec — there is nothing to click, and the
renderer's behaviour is unchanged.

## Out of scope — named, not silently dropped

- **The renderer's host-label store is not cleared on unpair.** `clearPairingScopedState`
  (`src/renderer/src/clearPairingScopedState.ts:141-158`) resets the timeline, session, active
  conversation, announced model and last-read state, but not #833's host-label store. An
  unpair-then-repair *inside one app run* would therefore leave the window holding the previous
  label. This is unobservable today — `hostLabelLoader` has no non-test consumer yet, and #834's
  sidebar row is the first — and this ticket is scoped to at-rest state with no renderer change.
  **Recommend PO file it as a follow-up alongside #834**, where the consumer that makes it visible
  lands.
- **The two erases are not atomic** and cannot be — they are two independent secure-store names.
  The surviving interleaving is named and argued benign under *Erase ordering* above. No journal, no
  two-phase commit: the failure has not been observed, the state is self-healing, and the machinery
  would cost more than the wart.
- **Surfacing a failed label erase** (a diagnostic counter, a retry at next launch) is deliberately
  not designed. The module is log-free by construction, no such failure has been observed, and the
  recovery path already exists.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The change adds no boundary. The unpair channel takes **no
  request argument** (`unpairHandler.ts:28` — the listener signature has no request param), so no
  renderer-supplied value exists on this path to validate. The one value that could cross outward is
  the label, and the `Pick<HostLabelStore, 'clear'>` dep withholds `load`, so the label string is
  never materialised in this module.
- **[Tokens, secrets, credentials]** No findings. The design's central decision keeps `ok` gated on
  the record erase, so `ok` still never over-reports a live bearer token as erased. The new code is
  reachable only *after* `await store.clear()` has resolved and can only drop a throw — it has no
  path to turn a resolved record erase into `error`, nor a resolved-`error` into `ok`. Separately,
  the label erase structurally cannot delete a credential: `hostLabelStore.clear()` deletes by the
  store's own `name`, defaulting to `HOST_LABEL_NAME = 'pyrycode.host_label'`, explicitly distinct
  from `pyrycode.paired_server` and `pyrycode.device_static` (`hostLabelStore.ts:70-77`), and
  `index.ts:151` passes no `name` override, so no caller-supplied string reaches a persistence key.
  Revocation propagation to the daemon is `onUnpaired`'s pre-existing #504 concern, unchanged.
- **[File / storage operations]** No findings; one accepted residual. No path is constructed here —
  both erases go through `SecureStore.delete` keyed by a module constant, so there is no traversal
  surface. No TOCTOU: `delete` is idempotent, so there is no existence check to race and no
  check-then-open gap. Encryption at rest is `safeStorage` via the existing `SecureStore` seam,
  untouched. **Accepted residual:** the two erases are not atomic across a process kill; the
  surviving interleaving (no record + orphan label) is the benign, self-healing one by the ordering
  argument above, and is named in *Out of scope*.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` method, no preload change, no `webPreferences` touch, no protocol handler, no
  navigation surface. `UNPAIR_CHANNEL` gains no argument and its response stays the value-free
  `UnpairResult` enum, so the exposed capability is not widened. Process placement is unchanged:
  every secret, socket and key stays in the main process; nothing new reaches the renderer.
- **[Cryptographic primitives]** No findings — none are added, removed, or reconfigured. No RNG, no
  comparison of an attacker-controlled value against a secret, no key, no nonce. The Noise session is
  not on this path; `onUnpaired` → `connection.reconnect()` is unchanged.
- **[Network & I/O]** No findings — no socket, no frame, no relay URL, no timeout, no reconnect
  policy is added or changed. The path is entirely local and synchronous apart from two keychain
  deletes.
- **[Error messages, logs, telemetry]** No findings — this is the category the ticket turns on (AC4),
  and it is held three ways. (1) The module stays log-free by construction: all three catch blocks
  are empty, the caught object is dropped, and no `console.*` is added on any path. (2) The result
  union has no payload field, so nothing can ride out on it; the existing test already asserts the
  `ok` path stringifies to exactly `{"result":"ok"}`. (3) The label text specifically is
  *unreachable*, not merely unlogged — `Pick<…, 'clear'>` withholds `load`. The spec mandates
  extending `unpairHandler.test.ts:109` with a throwing-label-erase target plus a `JSON.stringify`
  non-containment assertion, so all four paths are pinned by test.
- **[Concurrency]** No findings. No timer, listener, `AbortController`, or long-lived task is
  introduced. The listener remains stateless with no module-level mutable state, so two concurrent
  invokes have nothing to race; both erases are idempotent deletes of fixed distinct names, so every
  interleaving converges on the same final state and both invokes resolve `ok`. The
  `pendingConfirm`-style consume-before-await guard is unnecessary here precisely because this
  handler holds no shared state.
- **[Threat model alignment]** No findings; one pre-existing threat named. *Malicious relay* — not
  on this path; unpair is entirely local. *Token theft from disk* — unchanged and marginally
  improved: this ticket removes a value from disk and adds none. *Hostile daemon response* — not on
  this path; no daemon-sourced value is read or written. *Renderer compromise reaching the
  transport* — a compromised renderer can invoke `UNPAIR_CHANNEL` and cause a denial-of-pairing.
  That capability is **pre-existing (#173) and unchanged**; what this ticket adds to it is "also
  erases non-secret display text," strictly less than the credential erase it could already trigger.
  No boundary is widened. Out of scope for this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27

## Open questions

- None blocking. The one judgment call — which erase gates `ok` — is decided outright above with its
  reasoning, per the ticket's Technical Notes. The developer implements it as stated rather than
  re-deriving it.
