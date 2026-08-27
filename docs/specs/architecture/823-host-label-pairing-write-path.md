# #823 — Carry an operator-typed host label across the pairing boundary

**Size:** S. Four production files, one new exported name, ~30 lines of logic. Edit fan-out is two
production call sites, neither of which changes shape.

**Split from #688.** Upstream #822 (the `HostLabelStore` module) is merged and has no caller. This
slice is its **write path only**: the label crosses renderer→main on the pairing confirm and reaches
the store. The screen that collects it is #825, the read path back to the window is #824, the sidebar
row that renders it is #826, and erasing it is #827.

## Files to read first

| Path | What to extract |
|---|---|
| `src/shared/ipc/pairing.ts:22-87` | `MAX_PASTE_LENGTH`, the `PairingRequest` union, `isPairingRequest`. All three edit sites in this file. Lines 33-35 already mandate "extend additively, and grow `isPairingRequest`'s switch in lockstep" — this ticket is that mandate being exercised. |
| `src/shared/ipc/pairing.test.ts:12-46` | The guard's existing test shape. **Line 38 rejects `{ type: 'submit', paste: undefined }`** — the deliberate asymmetry with `label: undefined` explained under *Design decision 3* below. |
| `src/main/pairingHandler.ts:46-114` | `registerPairingHandler`'s deps object (`onPaired?` at 51-57 is the optional-dep precedent to copy) and the confirm arm at 92-109, where the label persist lands. |
| `src/main/pairingHandler.test.ts:1-40` | `fakeTarget()`, `listenerOf()`, `PAYLOAD`, `parseOk()`, `confirmationOf()`. Reuse these; do not reinvent them. |
| `src/main/pairingHandler.test.ts:128-144` | The "persists exactly once" test — the new label tests mirror its drive shape (register, drive submit, drive confirm, assert on spies). |
| `src/main/hostLabelStore.ts:46-53` | The `HostLabelStore` interface. Only `save` is used here. |
| `src/main/hostLabelStore.ts:70-77` | `HOST_LABEL_NAME` and the rule "the label is only ever a VALUE, never a name — no caller-supplied string reaches the persistence key." Load-bearing for this ticket. |
| `src/main/pairingConfirmation.ts:129-154` | `prepare`'s frozen snapshot and the single `store.save` site. Read this to see exactly which TOCTOU gap is closed, so the label demonstrably does not reopen it. |
| `src/main/index.ts:132-141` | Where `secureStore` and `pairedServerStore` are constructed. The `createHostLabelStore` line goes here. |
| `src/main/index.ts:215-221` | The `registerPairingHandler` call. The new `hostLabel:` dep goes here. |
| `src/preload/index.ts:54-60` and `:114` | `confirmPairing`, and `export type PyryApi = typeof api`. Widening the method flows the type to `window.pyry` automatically — **`src/preload/index.d.ts` needs no edit.** |
| `src/renderer/src/screens/pairing/pairingState.ts:99-107` | `PairingBridge`. **Do not edit** — verify only (see *Design decision 5*). |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:346` | `const target: PairingBridge = bridge ?? window.pyry` — the one assignability site the preload widening touches. |
| `src/main/unpairHandler.ts:59-68` | The classify-don't-forward catch. The label-save catch copies this discipline verbatim: the caught object is **dropped**, never logged, interpolated or returned. |
| `docs/specs/architecture/822-host-label-store.md:194-198` | #822's "Not in this ticket", which names this ticket as the owner of the composition-root wiring and the pairing-path write. |

## Design source

N/A — this ticket adds no pixel. It touches a shared IPC type, the preload bridge, a main-process
handler and the composition root. The screen that collects the label is #825 and carries the Figma
anchor; the sidebar row that renders it is #826. The visual-fidelity check is intentionally not
applicable here, not missing.

## Context

`createHostLabelStore({ secureStore })` shipped in #822 with `save` / `load` / `clear` and **no
caller**. Pairing yields `{server, relay, token, server_static_pubkey}`; the wire carries no host
name and must not grow one, so the label lives in its own store under its own name and has to be
handed to that store by whatever collects it.

This ticket is the hand-off. The operator types a label, it crosses the renderer→main boundary on
the pairing confirm, and the handler writes it through the store once the record itself has
persisted. Nothing collects a label yet (#825), so every part of this is additive and optional:
pairing without a label must behave byte-for-byte as it does today.

## Design

### Decision 1 — the label rides `confirm`, not `submit`

The ticket leaves this to the architect. It rides **`confirm`**, for three reasons.

**It cannot reopen the TOCTOU gap `prepare` closed.** `pairingConfirmation.prepare` snapshots the
four record fields into a frozen object and binds the confirm closure to *that* snapshot
(`pairingConfirmation.ts:134-153`), so a caller mutating its own record between prepare and confirm
cannot change the persisted bytes. A label riding `confirm` never enters `prepare`, never enters the
snapshot, and never reaches `pairedServerStore`. It arrives as an already-copied primitive — the
structured clone across `ipcRenderer.invoke` hands main a fresh string with no live reference on the
renderer side — so there is no window in which anything can swap it. `prepare`'s signature,
`PreparedPairing`, and the single `store.save` site are all untouched.

**It avoids a second piece of pending state.** Riding `submit` would mean either widening `prepare`
to accept display text (polluting the fingerprint gate with a value it must never hash) or holding a
`pendingLabel` beside `pendingConfirm` in the handler. That second variable would have to be cleared
in lockstep with `pendingConfirm` on every supersede path (`pairingHandler.ts:82`, `:97`) or a
submit-with-label → submit-without-label → confirm sequence persists a stale label from a superseded
pairing. `confirm` needs no new pending state at all.

**It matches when the value exists.** Confirm is the moment the operator commits to the pairing, and
in #825 it is the moment the label field's contents are final.

### Decision 2 — the bound is declared beside `MAX_PASTE_LENGTH`

Add to `src/shared/ipc/pairing.ts`, immediately after `MAX_PASTE_LENGTH`:

```ts
/** Upper bound on an accepted host label, in UTF-16 code units, enforced at the guard. */
export const MAX_HOST_LABEL_LENGTH = 128
```

**128** is generous for a human-typed display name for a sidebar row ("Pyrybox", "pyrybox — office")
including non-Latin scripts, while keeping what crosses the boundary small. The unit is UTF-16 code
units, the same unit `MAX_PASTE_LENGTH` uses, so ~64 astral characters — deliberate, and not worth a
grapheme-aware count for a bound this loose.

It is exported because #824 (the IPC read path) and #825 (the input field) must both bound against
the **same** constant. A read bound that disagrees with this write bound would let a value pass one
boundary and fail the other.

### Decision 3 — the guard must accept a *present* `label: undefined`

`PairingRequest`'s confirm arm becomes `{ type: 'confirm'; label?: string }`, and
`isPairingRequest`'s `case 'confirm'` grows from `return true` to:

- absent `label`, or `label === undefined` → **accept** (this is the no-label pairing, AC2)
- `typeof label === 'string' && label.length <= MAX_HOST_LABEL_LENGTH` → **accept**
- anything else → **reject** (AC3)

The present-undefined arm is load-bearing, not defensive padding. Electron's IPC uses the structured
clone algorithm, which **preserves an own property whose value is `undefined`** — it does not drop it
the way `JSON.stringify` would. So a renderer that builds `{ type: 'confirm', label }` with `label`
undefined delivers a request where `'label' in request` is `true` and `request.label` is `undefined`.
A guard written as `!('label' in value) || typeof value.label === 'string'` would reject that as
malformed and break AC2.

This produces a deliberate asymmetry with `submit`, which *rejects* `paste: undefined`
(`pairing.test.ts:38`), because `paste` is required and `label` is optional. `label?: string` in
TypeScript means exactly "absent or `undefined`", so the guard is being type-faithful, not lax.
**Comment the asymmetry at the guard** — a developer tidying the two arms into symmetry silently
breaks unlabelled pairing, and no type error catches it.

The `in` check is still needed before reading `value.label`: `value` is narrowed only to a non-null
object with a `type` property, so a bare property access does not typecheck.

### Decision 4 — the handler takes `save` and nothing else

`registerPairingHandler`'s deps object grows one optional member:

```ts
hostLabel?: Pick<HostLabelStore, 'save'>
```

Optional, mirroring `onPaired?` in the same object (`pairingHandler.ts:51-57`): every existing test
call site keeps compiling unchanged, and the change stays strictly additive. `Pick<…, 'save'>` rather
than the full interface follows the `PairingHandleTarget` idiom already in this module — declare the
minimal structural surface the handler needs, and let the real object satisfy it. The handler
therefore **structurally cannot** `load` or `clear` anything. `createHostLabelStore`'s returned
methods close over `secureStore` and `name` and never touch `this`, so passing the store object
whole is safe; no wrapper lambda is needed at the composition root.

This adds **no new exported type**.

### Decision 5 — the preload widening needs no renderer change

`confirmPairing` becomes `(label?: string) => Promise<PairingConfirmResponse>`, building the request
conditionally:

- `label === undefined` → `{ type: 'confirm' }` — byte-identical to today's request
- otherwise → `{ type: 'confirm', label }`

The conditional is a convenience that keeps the existing path unchanged; it is **not** a defence. The
renderer is untrusted and can call `confirmPairing` with any argument, so the guard has to accept
present-undefined on its own merits (Decision 3) regardless of what preload builds.

`PyryApi = typeof api` (`preload/index.ts:114`) flows the new signature to `window.pyry`
automatically — no `index.d.ts` edit. `PairingBridge` declares `confirmPairing(): Promise<…>`; a
source function whose extra parameter is **optional** has a minimum argument count of 0 and stays
assignable to a zero-parameter target, so `PairingScreen.tsx:346` continues to typecheck untouched.
`npm run typecheck` is the gate on that claim. **Do not widen `PairingBridge`** — that is #825's
edit, when it actually has a label to pass.

### Confirm-arm flow

The existing confirm arm is unchanged through the `await confirm()` / catch. Two steps are inserted
between the successful record persist and the reply:

```
confirm request
  └─ isPairingRequest        ─ reject → { ok:false, reason:'malformed-request' }   (pendingConfirm untouched)
  └─ pendingConfirm === null ─ yes    → { ok:false, reason:'no-pending-pairing' }  (nothing written)
  └─ pendingConfirm = null            (consume before the await — unchanged)
  └─ await confirm()         ─ throw  → { ok:false, reason:'persist-failed' }      (no label write)
  └─ NEW: label !== undefined → await hostLabel?.save(label), in its OWN try/catch that DROPS the error
  └─ onPaired?.()                     (unchanged)
  └─ { ok: true }
```

**The label persist sits after the record persist and before `onPaired()`.** After, because a label
for a pairing that did not persist is meaningless, and AC4 requires nothing to be written on the
failure path. Before `onPaired()`, because `onPaired` triggers `connection.reconnect()` and the
renderer's transition to the paired UI; persisting first makes the label durable before anything can
read it back (#824/#826), rather than leaving a window where the sidebar renders a host with no name.
The cost is one awaited local write ahead of the dial. It introduces no new class of stall: the
record save one line earlier already went through the same `secureStore` seam, so any keychain prompt
has already happened by the time this runs.

**The catch drops the error.** `secureStore.set`'s failures (`EncryptionUnavailableError`, a
filesystem error) can carry an OS or path detail in their message. The caught object is never logged,
never interpolated, never returned — `unpairHandler.ts:59-68` is the precedent. Per AC5 the response
still reports on the **record**, so a dropped label resolves `{ ok: true }`.

**No `console.*` is added on the label path**, on any branch including the failing one. AC4 forbids a
log line that names or echoes the label, and #822 keeps the store itself log-free; the cleanest way
to hold both is to add no log at all here. The existing static
`console.warn('pyry:pairing — rejected malformed request')` covers the over-long-label rejection and
echoes nothing.

### Per-file changes

| File | Change |
|---|---|
| `src/shared/ipc/pairing.ts` | Export `MAX_HOST_LABEL_LENGTH`; widen the `confirm` arm to `{ type: 'confirm'; label?: string }`; grow `isPairingRequest`'s `case 'confirm'` per Decision 3. Update the union's and the guard's doc comments. |
| `src/preload/index.ts` | Widen `confirmPairing` to take an optional `label`, building the request conditionally. Update its doc comment: the bare-signal claim now has one exception, and the reason it is not the record. |
| `src/main/pairingHandler.ts` | Add `hostLabel?: Pick<HostLabelStore, 'save'>` to deps (`import type` from `./hostLabelStore`); insert the two steps above into the confirm arm. |
| `src/main/index.ts` | `const hostLabelStore = createHostLabelStore({ secureStore })` beside `pairedServerStore`; pass `hostLabel: hostLabelStore` to `registerPairingHandler`. Comment: same `secureStore`, do not construct a second one; **no `name` override** — the store name stays the fixed constant. |

## State + concurrency model

No store slice, no stream, no timer, no listener; nothing to cancel on teardown. The handler's only
mutable state remains the single `pendingConfirm` reference, and this ticket adds none.

The new `await` sits *after* `pendingConfirm` is already consumed (`pairingHandler.ts:97`), so it
opens no new check-then-act window. Two concurrent labelled confirms: the first consumes the pending
handle, the second reads `null` and returns `no-pending-pairing` before reaching either persist — so
there is exactly one label write per successful pairing, structurally, for the same reason the record
persists exactly once.

The label is a primitive copied across the structured-clone boundary. No shared reference, no
mutation window.

## Error handling

| Condition | Response | Label store | Why |
|---|---|---|---|
| `label` is a non-string (number, object, array, `null`) | `malformed-request` | not touched | Guard-first, before the handler body — AC3 |
| `label.length > MAX_HOST_LABEL_LENGTH` | `malformed-request` | not touched | Same guard, same reason |
| `label` absent, or present and `undefined` | unchanged from today | not touched | AC2 — the no-label pairing is byte-identical |
| `label` is `''` | `{ ok: true }` | `save('')` | An empty string is a supplied value; #822's store keeps `''` distinct from absence. **No clear-on-empty rule** — erasing is #827 |
| confirm with nothing pending, label supplied | `no-pending-pairing` | not touched | The early return precedes the persist |
| record persist throws | `persist-failed` | not touched | Existing behaviour; the label persist is downstream of it |
| label persist throws | `{ ok: true }` | write lost | AC5 — the response reports on the record. Error dropped, not logged |
| `hostLabel` dep absent, label supplied | `{ ok: true }` | not wired | Optional dep; only reachable in tests, since the composition root always wires it |

A rejected label leaves `pendingConfirm` intact, so the operator can retry the same prepared pairing
with a valid label. That is deliberate: a malformed request should not burn a fingerprint the
operator already verified, and it matches the existing malformed-request behaviour.

## Testing strategy

Vitest, `npm test`. No keychain, no filesystem, no Electron harness — every seam is already faked in
the two existing test files.

**`src/shared/ipc/pairing.test.ts`** — extend the `isPairingRequest` describe:

- A confirm with a valid string label is accepted.
- A confirm with `label: ''` is accepted — an empty label is a valid supplied value.
- A confirm with **no** `label` key is accepted, and a confirm with `label: undefined` **present** is
  accepted. Assert both in one test, with the comment naming structured clone as the reason the
  second case is reachable at all.
- A confirm whose label is a number, an object, an array or `null` is rejected.
- Exactly `MAX_HOST_LABEL_LENGTH` accepted; one over rejected. Mirrors the `MAX_PASTE_LENGTH` test at
  `:42-45` and drives off the exported constant, never a literal.
- The existing `{ type: 'confirm', extra: 'ignored' }` case still passes — the structural minimum is
  unchanged.

**`src/main/pairingHandler.test.ts`** — a `fakeHostLabel()` returning `{ save: vi.fn() }`, then:

- A full submit → confirm carrying a label calls `save` exactly once with that exact string, and
  resolves `{ ok: true }`. **This is AC1's assertion at this layer** — durability itself is #822's
  round-trip test, already shipped.
- A submit → confirm with **no** label resolves `{ ok: true }` and `save` is never called (AC2).
- A confirm carrying `label: ''` calls `save('')` — empty is supplied, not absent.
- A confirm whose label is a number resolves `malformed-request`, `save` is never called, **and the
  record's `confirm` closure was never invoked** — assert the pairing did not proceed (AC3), not just
  the reason string.
- A confirm whose label is one over `MAX_HOST_LABEL_LENGTH` behaves identically.
- A confirm with a label but **nothing pending** resolves `no-pending-pairing` and never calls `save`.
- A **record** persist failure with a label supplied resolves `persist-failed` and never calls `save`.
- A **label** persist rejection still resolves `{ ok: true }`, and `onPaired` still fires (AC5).
- The label persist happens **before** `onPaired`: have the fake `save` push to an ordering array that
  `onPaired` also pushes to, and assert the order.
- A labelled confirm registered **without** the `hostLabel` dep resolves and does not throw — mirrors
  the existing "works without onPaired" test at `:235`.
- **No `console.*` on any label path.** One spy over `console.warn`/`console.error`/`console.log`
  across the success path *and* the failing-save path, asserting zero calls — and, separately, that
  the label string never appears in any response object (mirror the token/key assertion at `:247`).

**Not covered by a test, covered by the compiler:** `PairingScreen.tsx:346`'s assignability. `npm run
typecheck` is the gate.

**No e2e change.** No `e2e/` spec references `confirmPairing`; the fake-transport tier's pairing flow
passes no label and is unaffected.

## Not in this ticket

- **Do not touch `src/shared/wire/`.** The label has no wire field and must not get one. The pairing
  payload, `QrPayload`, `PairedServerRecord` and every frame stay exactly as they are (AC4).
- **Do not add the label to `PairingConfirmResponse`.** Nothing about the label crosses back.
- **Do not pass a `name` to `createHostLabelStore`.** The label is a value, never a persistence key
  (`hostLabelStore.ts:70-77`).
- **Do not touch `pairingConfirmation.ts`.** `prepare`, the frozen snapshot and the single
  `store.save` site are unchanged.
- **Do not widen `PairingBridge`** (`pairingState.ts:106`) or edit any renderer screen. Collecting the
  label is #825.
- **Do not add a clear-on-empty rule.** Erasing is #827.
- **Do not write a knowledge-base doc.** The documentation phase folds this in after code review.

## Open questions

1. **The label outlives an unpair.** #173's unpair clears `pairedServerStore` only, so after
   unpairing, `pyrycode.host_label` still holds the old label — and re-pairing to a *different* server
   without a label leaves the stale name in place. AC2 mandates that no-label confirms write nothing,
   so this ticket cannot fix it without contradicting its own acceptance criteria. **#827 owns it**,
   and it should be the erase-on-unpair case, not just an operator-driven clear. Flagged loudly here
   because this ticket is what makes the stale state reachable.
2. **`MAX_HOST_LABEL_LENGTH = 128` is a judgement call**, made here because the guard needs a number
   and no precedent exists. If #825's design (the input field) or #826's (the sidebar row width) wants
   a different number, change it **here**, in the one exported constant, and let both boundaries move
   together.
3. **What `''` renders as** is #826's decision — a blank row, or a fall back to the server id. This
   ticket only guarantees the empty string survives the round-trip distinctly from absence.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The ticket adds exactly one untrusted→trusted crossing — the
  `label` field on a `confirm` request — and it is validated in exactly one place,
  `isPairingRequest` (`src/shared/ipc/pairing.ts:73`), before the handler body runs. Downstream the
  value is typed `string | undefined` and bounded, and reaches exactly one sink: `hostLabel.save`.
  **SHOULD FIX, named owner:** #822 deliberately gives the store no bound of its own
  (`hostLabelStore.ts:165`: "No length bound, no validation"), so this guard is the *only* bound on
  the write path. Any future second writer to `hostLabelStore.save` must bring its own bound; code
  review of #825 and #827 should check for that.
- **[Tokens, secrets, credentials]** No findings. The label is not a credential. The live risk is the
  inverse — a third name in a chain that already holds a bearer token and a static private key — and
  it is closed structurally three ways: the handler's dep is typed `Pick<HostLabelStore, 'save'>` so
  it can neither read back nor erase; the store is constructed with no `name` override so
  `HOST_LABEL_NAME` stays distinct from `pyrycode.paired_server` and `pyrycode.device_static`; and the
  label never enters `prepare`'s frozen snapshot, so it cannot alter the four persisted record fields.
- **[File / storage operations]** No findings, by design rather than luck: the ticket adds **zero**
  new effectful edges and inherits #822's atomic temp+rename, `0700`/`0600` scope under
  `app.getPath('userData')`, and `safeStorage` fail-closed gate unmodified. Path traversal is
  impossible because the label is only ever a **value** passed to `save`, never a store name — hence
  the explicit "do not pass a `name`" prohibition under *Not in this ticket*. No TOCTOU: the write
  path performs no `load`, so there is no check-then-act pair.
- **[Inter-process / Electron attack surface]** No MUST FIX. No new channel, no new `contextBridge`
  method, no `BrowserWindow`, no `webPreferences` change; `ipcRenderer` still never crosses the
  bridge. One existing method widens by one optional, validated argument. `PairingConfirmResponse` is
  unchanged, so nothing about the label echoes back. A renderer can allocate an arbitrarily large
  string and pass it to `invoke` before the guard sees it — but that is the shipped
  `MAX_PASTE_LENGTH` property verbatim, exhausts the renderer's own process first, and is not a new
  class.
- **[Cryptographic primitives]** N/A — no primitive is selected, implemented or configured, and no
  comparison against a secret exists. Worth stating positively: the label arrives at **confirm**, so
  it cannot enter `deriveFingerprint`'s input and cannot influence the fingerprint the operator
  already eyeballed against pyrybox before clicking.
- **[Network & I/O]** N/A, structurally. `pairingHandler` holds no transport reference; the only
  main-side effect on the confirm path is `onPaired()` → `connection.reconnect()`, which takes no
  arguments. There is no code path by which the label can reach a socket, and the wire types are
  untouched (AC4).
- **[Error messages, logs, telemetry]** No MUST FIX; two requirements are load-bearing and stated in
  the body. The label path adds **no `console.*` on any branch**, asserted by a spy test across both
  the success and the failing-save path. The label-save catch **drops** the caught object — a
  `secureStore.set` failure can carry an OS/keychain/filesystem detail in its message, and it is never
  logged, interpolated or returned (`unpairHandler.ts:59-68` precedent). The one log line the
  over-long-label path can reach is the pre-existing static
  `console.warn('pyry:pairing — rejected malformed request')`, which echoes nothing.
- **[Concurrency]** No findings. The one added `await` sits after `pendingConfirm` is already consumed
  (`pairingHandler.ts:97`), so it opens no new check-then-act window on shared state, and a concurrent
  second confirm returns `no-pending-pairing` before reaching either persist. No timer, no listener,
  nothing to cancel. **OUT OF SCOPE, named owner:** a `save` here racing #827's `clear` is not
  reachable today (no clear caller exists) and lands with #827.
- **[Threat model alignment]** No MUST FIX. *Malicious relay:* unaffected — the label never reaches
  the wire. *Token theft from disk:* unchanged; no credential is added and no existing name is
  touched. *Hostile daemon:* this ticket adds no path by which daemon-supplied text can become a host
  label — the only producer is a renderer-typed argument at confirm time. *Renderer compromise
  reaching the transport:* a compromised renderer gains exactly one new capability, writing ≤128
  characters to `pyrycode.host_label`. It already holds `submitPairingPaste`/`confirmPairing`, i.e.
  the power to establish or overwrite the entire pairing, which is strictly greater — no new class of
  power, the same argument #173 and #339 made. *Stale-state:* the label surviving an unpair is a real
  hole this ticket makes reachable; it is named in **Open questions 1** and owned by #827.
- **[Availability / operator lockout]** **SHOULD FIX, named owner: #825.** AC3 mandates that an
  over-long label rejects the whole confirm, so an operator who types 200 characters loses a
  fingerprint they already verified and must re-confirm. That is correct behaviour at the trust
  boundary, but it is only tolerable if the input field makes it unreachable. #825 must bound its
  field against the **same** exported `MAX_HOST_LABEL_LENGTH` and show the limit, rather than letting
  an over-long label fail as an opaque `malformed-request`.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
