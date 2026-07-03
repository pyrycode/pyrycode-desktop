# 0005 — Secrets at rest via Electron `safeStorage`, fail-closed, over a key-domain-blind primitive

## Status

Accepted, 2026-07-03. First realized in [#42](../codebase/42.md). Consumed by the device keypair (#43) and the paired-server record (#44).

## Context

The desktop background process holds long-lived secrets: the device static private key (#43), the paired-server record (relay URL, server id, token, server static pubkey — #44), and later further pairing state. These must never touch a plaintext file or reach the renderer (CLAUDE.md "Keep the transport out of the window"; [0002](0002-remote-head-over-relay-shared-wire.md) — *the security model mirrors mobile*, keys never reach the renderer).

Mobile keeps this class of secret in Android Keystore / `EncryptedSharedPreferences` (see `pyrycode` `protocol-mobile.md`). The desktop equivalent is Electron **`safeStorage`**, which encrypts with a key held in the OS keychain — Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux.

The open architect's-call questions this ADR settles: which encryption mechanism (custom crypto vs a keychain library vs `safeStorage`)? How do we behave when the keychain is unavailable — plaintext fallback or refuse? And what is the *shape* of the storage layer — a typed per-secret API, or one generic byte store every later secret is built on?

## Decision

**One key-domain-blind primitive** — `createSecureStore` (`src/main/secureStore.ts`) — a generic `set`/`get`/`delete` over named `Uint8Array` blobs (string name → opaque bytes). It has **no** notion of "device key" or "server record"; downstream consumers serialize their own structures to bytes and store them by name. Encryption at rest is delegated to Electron **`safeStorage`** (OS keychain); nothing else is hand-rolled.

The store is **fail-closed**: `set` throws `EncryptionUnavailableError` *before* touching persistence when encryption is unavailable — plaintext **never** hits disk, and `safeStorage.setUsePlainTextEncryption(true)` is forbidden. "Unavailable" additionally includes the Linux `basic_text` backend, where `safeStorage.isEncryptionAvailable()` returns `true` but "encryption" is obfuscation with a hardcoded key.

Both effectful edges are **injected interfaces** — `SecretEncryption` (the keychain) and `SecretPersistence` (the filesystem) — so the pure core unit-tests with fakes, no keychain and no filesystem, mirroring `relayConnection`'s injected `onEvent` seam ([#21](../codebase/21.md)). The real adapters ship in their own files (`electronSecretEncryption.ts`, `fileSecretPersistence.ts`). See the [secure-store feature doc](../features/secure-store.md) for the full contract.

## Rationale

- **`safeStorage` over custom crypto or a third-party keychain library.** It is the platform-native, OS-keychain-backed mechanism (the desktop mirror of mobile's Keystore/`EncryptedSharedPreferences`), ships **with `electron`** (no new dependency — CLAUDE.md "Don't add dependencies without justification"), and means **no hand-rolled crypto and no app-side key management** — the OS owns the key. Decryption is authenticated (AEAD): a tampered or foreign blob throws rather than yielding attacker-chosen plaintext.
- **Fail-closed, never a plaintext fallback.** The module *is* the secret-at-rest boundary; degrading to plaintext when the keychain is missing would silently defeat its only reason to exist. Refusing loudly forces the failure into the open where a consumer decides recovery. The Linux `basic_text` guard is the same principle: obfuscation reported as "available" is treated as unavailable, so a secret is never written weakly.
- **A blind byte primitive, not a typed per-secret API.** Keeping one small, auditable surface carry the at-rest guarantee for *every* future secret (exactly as `relayConnection` is a "semantics-blind byte pipe") means the security properties are proved once, here, rather than re-implemented per key domain. #43/#44 own their own serialization; this layer never grows key-domain knowledge.
- **Injected effectful edges, because the AC-required tests must run without a keychain.** A pure core over two seams tests the correctness properties (fail-closed order, decrypt-failure propagation, round-trip) with in-file fakes — no Electron runtime, no real filesystem. This is the established main-side DI idiom ([#21](../codebase/21.md), [#17/#18](../codebase/17.md)), applied to the secret boundary.
- **Decrypt failure propagates, is not masked as absence.** `get` of a present-but-undecryptable blob throws rather than returning `null`. Silently forgetting a tampered/rotated secret would be a forced-downgrade path; honest propagation lets the consumer choose re-pair vs hard error.

## Consequences

- **Every desktop secret is built on this one surface.** #43 (device keypair) and #44 (paired-server record) *consume* `createSecureStore` — they serialize to bytes and store by name; they do not touch `safeStorage` or the filesystem directly. New secret classes follow the same path.
- **The composition root owns the production wiring.** The real store is constructed with `electronSecretEncryption()` and `fileSecretPersistence(join(app.getPath('userData'), 'secrets'))` by the first consumer ticket — `src/main/index.ts` stays untouched here, exactly as #21/#22 deferred their wiring.
- **Fail-closed is observable to consumers.** A consumer calling `set` on a machine with no keychain (or Linux `basic_text`) gets `EncryptionUnavailableError`, not a silent success — they must surface a "cannot store securely" state rather than assume persistence happened.
- **Recovery policy is a consumer decision.** The blind primitive propagates decrypt failures; whether a failure means "delete + re-pair" (the KitchenClaw corrupted-prefs recovery pattern) or "hard error" is decided by #43/#44, not baked in here. Auto-deleting would risk a tamper→forced-downgrade path.
- **Backup/sync capture is an accepted residual risk.** `userData/secrets` may be captured by Time Machine / cloud backup, but the ciphertext is keychain-bound and useless without the machine's keychain. No portable per-OS backup-exclusion API exists across desktop platforms; noted, not addressed.

Related: [0002](0002-remote-head-over-relay-shared-wire.md) (the security model this inherits — keys never reach the renderer), the [secure-store feature doc](../features/secure-store.md), and [#42 codebase notes](../codebase/42.md). Sibling precedent: KitchenClaw's Gateway Connection Settings secure-token storage (`kitchenclaw-docs` #23 — `EncryptedSharedPreferences`, disable-backup, no-`toString`-leak, corrupted-store recovery).
