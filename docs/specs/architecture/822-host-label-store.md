# Spec #822 — persist a host label in the background process

**Size:** S — one main-process module over the existing injected persistence seam. One new
production file, one new test file, four new exports, **zero consumer call sites**.

## Design source

N/A — main-process persistence only. This ticket ships no renderer surface and no IPC channel; the
sidebar host row that renders the label is #826 and carries its own Figma anchor (node `106:3094`).
The visual-fidelity check is intentionally skipped here.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/secureStore.ts:47-61` | The `SecureStore` contract — `set` / `get` / `delete`. This is the one injected seam; the new module imports its **type** only. |
| `src/main/secureStore.ts:90-95` | `get`'s absent check is on the **ciphertext**, not the plaintext. This single line is what makes a stored empty label distinguishable from absence (AC2). |
| `src/main/pairedServerStore.ts:1-22` | The module-header discipline to mirror: pure core, injected seam named, log-free-by-construction stated. Copy the shape, not the words. |
| `src/main/pairedServerStore.ts:57-77` | `MalformedPairedServerRecordError` (static message, no value interpolated) + the milestone-1 store-name constant pattern with the deferred per-server-id note. |
| `src/main/pairedServerStore.ts:126-159` | `createPairedServerStore` — the exact `save` / `load` / `clear` body shape to follow. `clear` deletes by the injected `name`, never a literal. |
| `src/main/deviceKeypair.ts:53-92` | The **byte**-encoding precedent: a fixed blob with no JSON envelope, and its matching `Malformed…Error`. The closer precedent for this ticket than the JSON record. |
| `src/main/pairedServerStore.test.ts:15-60` | The `fakeSecureStore()` helper (Map-backed, `control.{setError,getError,deleteError}` toggles) and the `seed()` helper. Copy both into the new test file. |
| `src/main/pairedServerStore.test.ts:227-272` | The log-free test shape — spy all six `console` methods, drive every happy and error path, assert none was called. Mirror it. |
| `src/main/electronSecretEncryption.ts:35-42` | Why an empty plaintext still produces a **non-empty** ciphertext (safeStorage's version header), which is the production half of AC2. |
| `src/main/fileSecretPersistence.ts:29-38` | `ENOENT → null` is the only absence path on disk; every other read error throws. |
| `src/main/index.ts:132-140` | The composition root. **Read it to confirm you must not touch it** — wiring the store is #823's job, not this ticket's. |
| `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md` | The fail-closed at-rest rule this module inherits unchanged. |
| `docs/knowledge/features/secure-store.md`, `docs/knowledge/features/paired-server-store.md`, `docs/knowledge/features/device-keypair.md` | The injected primitive and its two shipped consumers — the shape this module becomes the third of. |
| `CLAUDE.md` | "Keep the transport out of the window"; the wire-types-don't-drift rule that forces the label out of `PairedServerRecord`. |

> `codegraph` is wired but **not indexed** for this repo (`codegraph_status` → "CodeGraph not
> initialized", confirmed 2026-08-27). The reading list above is from `Read`/`Grep`. Do not burn a
> turn re-probing it.

## Context

Pairing yields `{server, relay, token, server_static_pubkey}` — the wire carries **no host name**.
The desktop sidebar puts a human name on the host row, and the operator types that name at pairing
time. Before it can be collected (#825), written (#823), read back (#824), rendered (#826) or erased
(#827), it needs somewhere to live in the background process. This ticket ships that storage and
nothing else.

The label cannot ride inside `PairedServerRecord`: that type is a deliberate **alias** of
`QrPayload` (`src/main/pairedServerStore.ts:31`), so drift from the mobile contract is a compile
error rather than a silent divergence. Adding a field the daemon never sees would drift a wire type,
which `CLAUDE.md` forbids.

## Design

### Decision 1 — a new module, not a second name inside `pairedServerStore`

New file `src/main/hostLabelStore.ts`. The ticket left this to the architect; a separate module wins
on four counts:

1. **Contract integrity.** `pairedServerStore.ts:17-20, 28-29` states, load-bearingly, that nothing
   it holds ever crosses to the renderer — `token` is a bearer credential. The label's whole purpose
   is to cross (via #824). Folding it in would falsify a comment that code-review relies on.
2. **`clear()` semantics.** `unpairHandler` already calls `pairedServerStore.clear()`
   (`unpairHandler.ts:60`). If the label lived inside, unpair would erase it as a *side effect* —
   but erase-on-unpair is #827's explicit decision, not an accident of colocation. Separate modules
   keep #827 a real ticket with a real seam.
3. **Lifetime.** The record is required wire data written once at pairing. The label is optional
   user text that #825 may later let the operator re-edit without re-pairing.
4. **No file saved.** A second name inside `pairedServerStore` still needs its own encode, decode,
   error type and tests. Colocating buys nothing and costs the two properties above.

`PairedServerRecord` keeps aliasing `QrPayload`. `pairedServerStore.ts` is **not modified** by this
ticket.

### Decision 2 — persist through the same `SecureStore` seam

The store takes `SecureStore` by type and nothing else. It adds **zero new effectful edges**: no
`electron`, no `fs`, no `safeStorage`. Everything at-rest — OS-keychain encryption, the
`isEncryptionAvailable` fail-closed gate, the `0700` secrets dir, `0600` files, atomic temp+rename,
`ENOENT → null` — is inherited unchanged from the shipped chain.

**Does display text need `safeStorage`?** Not for confidentiality — the label is a nickname, not a
credential. It goes through it anyway, for three reasons that are not about secrecy:

- **Integrity is what gives AC3 teeth.** safeStorage's AEAD makes a tampered blob fail *decryption*,
  surfacing as a throw from `SecureStore.get` rather than as a plausible-looking string. Without it,
  AC3's "unreadable ⇒ failure" would only catch invalid UTF-8.
- **One at-rest surface.** A second persistence path (raw `SecretPersistence`, or a JSON file
  elsewhere) would double the audited storage surface for zero benefit and diverge from both shipped
  consumers.
- **Uniform discipline.** Fail-closed on write and log-free on every path come for free by staying
  on the seam. The ticket asks for both regardless of where the bytes go.

The one cost: with no keychain, `save` rejects with `EncryptionUnavailableError` even though the
label isn't secret. That is correct and non-blocking — on that machine pairing itself already fails,
so there is no state where the record persists but the label can't.

### Decision 3 — encoding is bare UTF-8 bytes, not a JSON envelope

`save` writes `new TextEncoder().encode(label)`. `load` reads it back with

```ts
new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
```

Both options are load-bearing and neither is the default:

- **`fatal: true`** — the default decoder is *lossy*: it silently rewrites invalid byte sequences to
  U+FFFD and returns a string. That would make AC3 unreachable — a corrupt blob would come back as a
  plausible label. With `fatal: true` an invalid sequence throws `TypeError`, which the module
  converts to `MalformedHostLabelError`.
- **`ignoreBOM: true`** — the default decoder *strips* a leading U+FEFF. Without this, a label that
  begins with a BOM would not round-trip (`'﻿x'` saves and loads back as `'x'`), breaking AC1
  for that input.

**What counts as unreadable under this encoding:** exactly one thing — the stored plaintext bytes
are not a valid UTF-8 sequence. That is the smallest malformation surface available, and it is why
bare UTF-8 beats a JSON envelope here: a `{"label": "..."}` envelope would additionally admit
non-JSON, JSON-not-an-object, JSON-null, a missing key and a non-string value — five extra reject
branches and five extra tests, for a payload that is a single string. The record store pays for a
JSON envelope because it carries four fields; this one carries none.

The malformed branch is **unreachable through `save`**: `TextEncoder` always emits valid UTF-8 (it
substitutes U+FFFD for unpaired surrogates before encoding). Like `MalformedDeviceKeypairError`, it
exists for tamper and format drift only.

**Accepted round-trip caveat — state it in the module doc, do not "fix" it.** A label containing an
unpaired surrogate (`'\uD800'`) round-trips as U+FFFD, not byte-identically. This is inherent to
UTF-8 and cannot be produced by a text input; the ticket says the store takes what it is given, so
there is **no validation and no rejection** for it. Do not add a surrogate check — and do not write
a test asserting exact round-trip for a lone surrogate.

### Decision 4 — absence is `null`, stored-empty is `''` (AC2)

`load(): Promise<string | null>`. `null` means never stored; `''` means stored empty. This holds
end-to-end, not just against the test fake — the chain is worth stating because it hinges on one
shipped line:

| Step | Empty label `''` | Never stored |
|---|---|---|
| `encode` | `Uint8Array(0)` | — |
| `SecureStore.set` → `encrypt` | non-empty ciphertext (safeStorage prepends a version header — `electronSecretEncryption.ts:36`) | — |
| `fileSecretPersistence.read` | non-empty bytes | `ENOENT` → `null` |
| `SecureStore.get` | ciphertext non-null ⇒ `decrypt(...)` → `Uint8Array(0)` | `null` |
| `decode` | `''` | not reached |

The pivot is `secureStore.ts:94`: the null test is on the **ciphertext**, before decryption. A
zero-length *plaintext* therefore never collapses into absence. If that line ever moves to test the
plaintext, AC2 breaks silently — worth a comment pointing at it.

Corollary: a truncated-to-zero-bytes file is *not* absence either — `read` returns `Uint8Array(0)`,
`decrypt` throws on a missing version header, and the throw propagates. Consistent with AC3.

### Decision 5 — one flat interface, `clear()` included

`pairedServerStore` splits `PairedServerStore` / `ClearablePairedServerStore` because three shipped
consumers type against the base and would need a `clear` stub in their fakes. There are **no
consumers here at all**, and #827 needs `clear`. One interface; no second type.

### Module contract

`src/main/hostLabelStore.ts` — four exports:

```ts
export const HOST_LABEL_NAME = 'pyrycode.host_label'

export class MalformedHostLabelError extends Error {}

export interface HostLabelStore {
  /** Persist the label verbatim. A second save overwrites. No length bound, no validation. */
  save(label: string): Promise<void>
  /** The stored label, or null when none was ever stored. `''` is a stored value, not absence. */
  load(): Promise<string | null>
  /** Erase the stored label. Idempotent; fail-closed. */
  clear(): Promise<void>
}

export function createHostLabelStore(deps: {
  secureStore: SecureStore
  name?: string
}): HostLabelStore
```

Two module-private helpers, `encodeLabel` / `decodeLabel`, mirroring `pairedServerStore`'s pair.
`decodeLabel` is the module's **only** trust boundary: disk bytes → in-memory string.

The `name?` override exists for the same reason as in both shipped stores — the deferred
per-server-id keying (`pyrycode.host_label.<server-id>`) is a one-line change later. Today
`HOST_LABEL_NAME` is a fixed constant and **the label is only ever a value, never a name**: no
caller-supplied string reaches the persistence key, so nothing untrusted can steer which blob is
read, written or deleted.

`createHostLabelStore` returns a fresh object literal with no cache, no memo, no timers and no
listeners. `load` reads through on every call, so a `save` from another code path is observed
immediately, and there is nothing to tear down on window close. Deliberately **no** `update` /
read-modify-write method: a `load`-then-`save` pair across an `await` would be a check-then-act race
this module currently cannot have.

### Not in this ticket

Do **not** touch `src/main/index.ts`, do **not** add an IPC channel or a preload binding, and do
**not** add a `console` statement anywhere. This module ships with no caller by design. Composition-
root wiring plus the pairing-path write is #823; the read path to the window is #824.

## State + concurrency model

No store slice, no async task, no stream. `save` / `load` / `clear` are each a single `await` on the
injected seam. Two concurrent `save`s are last-writer-wins, and cannot tear a file:
`fileSecretPersistence.write` writes to a randomly-suffixed temp and `rename`s atomically
(`fileSecretPersistence.ts:44-51`). Nothing to cancel; no `AbortController`; teardown is a no-op.

## Error handling

| Condition | Behaviour | Why |
|---|---|---|
| `save` with keychain unavailable | `EncryptionUnavailableError` propagates; nothing written | Inherited fail-closed gate (`secureStore.ts:87`) — checked before any persistence call |
| `save` with a persistence failure | propagates | Reporting a save that did not land would make the label silently non-durable |
| `load`, nothing stored | resolves `null` | The **only** `null` path (AC2) |
| `load`, stored `''` | resolves `''` | Distinct from `null` (AC2) |
| `load`, decrypt fails (tamper / key rotation) | the decrypt error propagates | Never masked as absence (AC3); mirrors `pairedServerStore.load` |
| `load`, plaintext is not valid UTF-8 | `MalformedHostLabelError` | The one malformation this encoding admits (AC3) |
| `clear`, nothing stored | resolves | `SecureStore.delete` is idempotent (AC4) |
| `clear`, delete fails | propagates | Fail-closed; reporting success while the value is still on disk is the behaviour to avoid |

Two requirements on the error surface:

- **`MalformedHostLabelError`'s message is a static string** and interpolates nothing — not the
  offending bytes, not a partially-decoded prefix, not the store name. Same rule as both precedent
  errors.
- **The fatal decoder's `TypeError` is caught and replaced**, never propagated. Two reasons: AC3
  wants one typed branch a caller can switch on, and the decoder's own message is an implementation
  detail that should not escape the module.

No path in this module catches-and-swallows. Everything either resolves a value or throws.

## Testing strategy

`src/main/hostLabelStore.test.ts`, vitest, no keychain and no filesystem — the single injected seam
is faked in-file. Copy `fakeSecureStore()` and `seed()` from `pairedServerStore.test.ts:15-60`
rather than re-inventing them; the shared `store` Map is what a "restart" re-reads.

Scenarios (bullets, not pre-written code):

- **Survives the instance (AC1).** Save through store A; build store B over the *same* fake `store`
  Map; B's `load` returns the value. Assert the round-trip against the shared Map, not against A —
  that is what models a restart.
- **Round-trips non-ASCII.** A label with accents and an emoji comes back byte-identical, and the
  stored blob decodes as the same UTF-8 text. Guards the encoder choice.
- **A BOM-leading label round-trips exactly.** `'﻿Pyrybox'` loads back with the BOM intact.
  This is the test that pins `ignoreBOM: true`; it fails against a default decoder.
- **Absence is `null` (AC2).** A fresh store's `load` resolves `null`.
- **Stored empty is `''`, not `null` (AC2).** Save `''`, then `load` resolves `''`. Assert
  `toBe('')` and explicitly `not.toBeNull()` — the pair is the point.
- **Invalid UTF-8 is `MalformedHostLabelError` (AC3).** Seed the fake with a raw
  `Uint8Array([0xff, 0xfe, 0xfd])` — note these bytes must be seeded **directly**, not via the
  `seed()` text helper, which can only produce valid UTF-8. Assert `rejects.toBeInstanceOf`, and
  assert it is *not* resolving `null`.
- **A decrypt failure propagates, never as absence (AC3).** Seed a blob, set `control.getError`,
  assert the rejection surfaces rather than a `null`.
- **Overwrite.** A second `save` wins and exactly one blob is kept.
- **Erase (AC4).** Save, `clear`, then `load` is `null` and the Map is empty.
- **Erase is idempotent (AC4).** `clear` on a never-stored store resolves and stays absent.
- **Erase touches only this name.** Seed `pyrycode.paired_server` and `pyrycode.device_static`
  alongside the label, `clear`, and assert both neighbours survive. Mirrors
  `pairedServerStore.test.ts:189-201` — this is the test that proves a name collision can't erase a
  credential.
- **Honours an injected name.** With `name` overridden, the blob lands under it and *not* under
  `HOST_LABEL_NAME`; `clear` deletes the injected name, not a literal.
- **Fails loud with no keychain.** `control.setError = new EncryptionUnavailableError()` ⇒ `save`
  rejects and `writes` is empty.
- **Fails closed on a delete failure.** `control.deleteError` ⇒ `clear` rejects.
- **Log-free across every path (AC5).** Spy all six `console` methods; drive save, load, clear, plus
  each of the four error paths above; assert none was called. Mirror
  `pairedServerStore.test.ts:227-272`, including the `finally` that restores the spies.

Type-level coverage rides on `npm run typecheck` — `load`'s `string | null` return forces every
future caller to handle absence explicitly.

## Open questions

- **Store name.** `pyrycode.host_label` is proposed, matching the `pyrycode.<domain>` convention of
  the two shipped names. Nothing downstream depends on the literal yet (no caller), so #823 may
  rename it at zero cost if a better fit appears — but it must move as a constant, never as a
  literal at two sites.
- **Multi-host keying.** Milestone 1 is single-pyrybox, so one label. The `name?` seam is the
  intended extension point; the sidebar's host-grouping design will decide whether the key becomes
  `<name>.<server-id>` or the label moves into a per-host record. Out of scope here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX — the module has exactly one untrusted→trusted crossing,
  `decodeLabel` (disk bytes → string), and it is a single named function with `fatal: true`, so a
  corrupt blob throws instead of yielding a lossy string. **SHOULD FIX, handed off with named
  owners:** the string `load` returns is *untrusted display text* — it comes off disk, it is
  unbounded, and this ticket deliberately imposes no length limit. #824 must bound it at the IPC
  boundary and #825 at the input field; #826 must render it as escaped text only (React's default),
  never into `dangerouslySetInnerHTML`, an attribute, a URL, a filename or a lookup key
  (`CLAUDE.md`, operator ruling 2026-08-20). The module doc comment must state the value is
  untrusted so the hand-off is not lost between tickets.
- **[Tokens, secrets, credentials]** No MUST FIX — the label is not a credential and this module
  handles no token, generates no randomness and compares nothing. The live risk is the *inverse*:
  adding a third name to a chain that already holds a bearer token and a static private key. It is
  closed structurally — `HOST_LABEL_NAME` is distinct from both `pyrycode.paired_server` and
  `pyrycode.device_static`, `clear()` deletes by the injected `name` rather than a literal, and the
  "erase touches only this name" test asserts both neighbours survive.
- **[File / storage operations]** No findings, and the reason is a design decision rather than luck:
  the module adds **zero** new effectful edges. Path traversal is impossible because the label is
  never a path component — the store name is a fixed constant, and `fileSecretPersistence`
  base64url-encodes names anyway (`fileSecretPersistence.ts:24-27`). TOCTOU, the `0700`/`0600`
  scope under `app.getPath('userData')`, atomic temp+rename, and the `safeStorage` fail-closed gate
  are all inherited unmodified.
- **[Inter-process / Electron attack surface]** No findings — this ticket adds no IPC channel, no
  `contextBridge` binding, no `BrowserWindow` and no composition-root wiring; the spec forbids all
  four explicitly. The renderer cannot reach this module at all. #824 owns the IPC surface and
  inherits the argument-validation obligation; its handler must also drop the caught error object
  rather than forward it (see Errors below), exactly as `unpairHandler.ts:61-68` does.
- **[Cryptographic primitives]** N/A by design — no primitive is selected, implemented or
  configured here. Encryption is `safeStorage` via the injected seam; there is no key material, no
  nonce, and no secret comparison, so no `timingSafeEqual` site exists.
- **[Network & I/O]** N/A — the module never opens a socket and never touches the relay.
- **[Error messages, logs, telemetry]** No MUST FIX, but two requirements are load-bearing and are
  stated in Error handling above: `MalformedHostLabelError`'s message is static and interpolates
  nothing, and the fatal decoder's `TypeError` is replaced rather than propagated. AC5's no-
  `console.*` is asserted directly by the log-free test across all four error paths, not just the
  happy path. **SHOULD FIX, named owner:** a `secureStore.get` decrypt failure propagates an
  OSCrypt-originated error whose message can carry OS/keychain detail — that is the shipped
  fail-closed precedent, and the obligation to drop it lands on #824's handler.
- **[Concurrency]** No findings — no cache, no memo, no timer, no listener, nothing to cancel. The
  category is closed by the *absence* of a read-modify-write method: the spec deliberately omits an
  `update`, so there is no check-then-act gap across an `await`. Concurrent `save`s are
  last-writer-wins and cannot tear a file (atomic rename). A developer adding an `update` helper
  would reopen this category.
- **[Threat model alignment]** No MUST FIX. *Disk-write attacker:* can set an arbitrary label and
  spoof the sidebar host name — but the same access replaces the paired-server record wholesale,
  which is strictly worse, so the label grants no new capability. *Token theft from disk:*
  unchanged; no credential is added. *Hostile daemon:* the daemon never sees the label — it is not a
  wire field, which is the ticket's premise and is also a security property: the value cannot be
  influenced from the daemon side. **OUT OF SCOPE:** an attacker-planted multi-gigabyte blob would
  be fully buffered by `fileSecretPersistence.read` — a pre-existing property of the shared
  persistence adapter that applies identically to the two shipped consumers, gated behind disk-write
  access, and not introduced here.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
