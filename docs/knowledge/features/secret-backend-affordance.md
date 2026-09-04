# Secret-backend dev affordance

A deterministic, **test/dev-only** affordance that lets the built app's main process select a **keychain-free** `SecretEncryption` backend — so the pair → device-key → connect path can run in a headless, keychain-less environment ([#93](https://github.com/pyrycode/pyrycode-desktop/issues/93) consumes it) without [`secureStore.set`](secure-store.md) failing closed — while a **packaged build stays byte-identical to today**: the real, fail-closed OS-keychain backend ([`electronSecretEncryption`](secure-store.md)). Introduced in [#99](../codebase/99.md), split from #93 so this security-sensitive surface (it disables real OS-keychain encryption on a code path) is audited in isolation rather than tangled with e2e plumbing.

It is the exact **twin of the [loopback relay dev affordance](loopback-relay-affordance.md) ([#97](../codebase/97.md))** for the secret chain: same `isPackaged`-false-first gate, same quarantined-module shape, same "provably unreachable in a packaged build" security posture.

## Why it exists

Every long-lived secret the desktop client holds funnels through one auditable surface: [`createSecureStore`](secure-store.md), whose `set()` is **fail-closed** — it throws `EncryptionUnavailableError` *before touching persistence* whenever the injected `SecretEncryption.isAvailable()` is false. The real backend reports available **only** when a real OS keychain is present (and explicitly treats the Linux `basic_text` fallback as unavailable). So in any keychain-less environment — headless CI, a runner with no unlocked keychain — every secret write fails closed. Two mandatory writes on the pair → connect path hit this gate:

1. **Persisting the pasted pairing record** ([pairing handler](pairing-ipc-channel.md) → [pairing confirmation](pairing-confirmation.md) → [paired-server store](paired-server-store.md) → `secureStore.set`). On the throw the handler returns `persist-failed`, `onPaired` never fires, `connection.reconnect()` never runs, and the window never routes to `.conversation`.
2. **Generating/persisting the device static keypair** on connect ([daemon connection](daemon-connection.md) → [device keypair](device-keypair.md) `ensure()` → `secureStore.set`), same gate.

For an automated scenario (#93) to run the *built* app's main process headless, `secureStore.set` must stop failing closed — but **only** on that test/dev path. This affordance is that path.

## What it does

Selects a keychain-free `SecretEncryption` backend instead of the real OS-keychain one — **only** on the test/dev path, and **never** in a packaged build. The relaxation is bounded on **two independent axes, both required at once**:

1. **`!app.isPackaged`** — a deterministic code gate, checked **false-first**, so a packaged build never even reads the env flag (belt-and-suspenders "different fabric": code, not config).
2. **explicit env opt-in** — `process.env['PYRY_TEST_SECRET_BACKEND'] === '1'` (exact string).

On that path the selected backend's `isAvailable()` returns `true` (so `secureStore.set` no longer fails closed) and its `encrypt`/`decrypt` are a deterministic, reversible transform that round-trips within the run. Everything else is unchanged: `secureStore.ts`'s fail-closed logic, `electronSecretEncryption.ts`, and the persistence layer are **not touched** — the affordance is an additive selection at the composition root, not an edit to the existing chain.

## How it works

`SecretEncryption` is *already* an injected interface on `createSecureStore({ encryption, … })`, so the seam fully exists — no consumer file changes. The **effectful** choice of which backend (packaged? opted in?) is made **once**, at the composition root. Two files:

| File | Change | Role |
|---|---|---|
| `src/main/secretBackend.ts` | **new** (80 LOC) | Quarantines the affordance: the module-private `keychainFreeSecretEncryption`, the exported `selectSecretEncryption(...)` selector, and the `TEST_SECRET_BACKEND_ENV_FLAG` constant. Imports **only** the `SecretEncryption` **type** from [`./secureStore`](secure-store.md) — **no `electron` import**, so it unit-tests in plain Node. |
| `src/main/index.ts` | modify (~15 LOC) | The effectful gate: passes `app.isPackaged`, `process.env`, and the uncalled `electronSecretEncryption` factory into `selectSecretEncryption`; uses the result as `createSecureStore`'s `encryption`. The *only* place `app.isPackaged`/`process.env` are read for this choice. |

[`secureStore.ts`](secure-store.md), `electronSecretEncryption.ts`, `fileSecretPersistence.ts`, [`pairedServerStore.ts`](paired-server-store.md), [`deviceKeypair.ts`](device-keypair.md), [`pairingHandler.ts`](pairing-ipc-channel.md): **no change** — the chosen backend flows into `createSecureStore` through the seam that already exists.

### The selector + backend (in `secretBackend.ts`)

The real backend is **injected as an uncalled factory** `real: () => SecretEncryption`, not imported: `electronSecretEncryption.ts` is the only module that imports `electron`, so a static import here would drag `electron` into every unit test. Passing the factory also means it is never even *called* on the dev path — the keychain-free backend is chosen without constructing the real one.

```ts
export const TEST_SECRET_BACKEND_ENV_FLAG = 'PYRY_TEST_SECRET_BACKEND'

// Module-private — the affordance's guts are not importable elsewhere (mirrors
// loopbackDevRelayPolicy). A deterministic, reversible, byte-blind transform:
// a fixed marker byte (0xa9) then XOR each payload byte (0x3c), returning a FRESH
// Uint8Array. Stateless. isAvailable() === true so secureStore.set won't fail closed.
// NOT crypto; deliberately NOT the Linux basic_text fallback.
const keychainFreeSecretEncryption = (): SecretEncryption => ({ /* … */ })

export function selectSecretEncryption(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
  real: () => SecretEncryption
}): SecretEncryption {
  if (opts.isPackaged) return opts.real()                                    // env NOT consulted when packaged
  if (opts.env[TEST_SECRET_BACKEND_ENV_FLAG] === '1') return keychainFreeSecretEncryption()
  return opts.real()                                                         // default / production
}
```

The `real()` factory is called (and the real backend constructed) **only** on the paths that return it — never on the dev path.

### The effectful gate (in `index.ts`)

```ts
const secureStore = createSecureStore({
  encryption: selectSecretEncryption({
    isPackaged: app.isPackaged,
    env: process.env,                 // structurally satisfies Record<string, string | undefined>
    real: electronSecretEncryption    // the factory, uncalled — constructed only if selected
  }),
  persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets'))
})
```

`persistence` is unchanged. `electronSecretEncryption` moves from being *called* here to being *passed*; its import stays. Mirrors the existing `app.isPackaged ? … : process.env[…]` renderer-URL idiom and the #97 `selectRelayPolicy` call in the same file. `selectSecretEncryption` runs **once** at composition time (inside `app.whenReady().then(...)`), producing the immutable `encryption` object captured by the store — no async, timers, listeners, or shared mutable state.

### Selection matrix

| `isPackaged` | `PYRY_TEST_SECRET_BACKEND` | Selected backend | `isAvailable()` |
|---|---|---|---|
| `true` | anything (incl. `'1'`) | real (`electronSecretEncryption`) | keychain-gated (byte-identical to today) |
| `false` | unset / `''` / `'0'` / `'true'` / `' 1'` / `'1 '` | real (`electronSecretEncryption`) | keychain-gated |
| `false` | exactly `'1'` | keychain-free (marker + XOR) | **`true`** (writes succeed headless) |

## Data flow (dev path, affordance-on)

```
selectSecretEncryption → keychainFreeSecretEncryption()   [isAvailable() === true]
  → createSecureStore({ encryption: <keychain-free> })
  → pairedServerStore.save / deviceKeypair.ensure → secureStore.set   [encrypts, persists — no throw]
  → onPaired fires → connection.reconnect → routes to .conversation
```

Packaged (any env), or dev without the flag:

```
selectSecretEncryption → real() = electronSecretEncryption()   [OS-keychain, fail-closed without a keychain]
  → byte-identical to today
```

## Security properties

The architect self-review verdict is **PASS** (`security-sensitive` label gate). The affordance disables real OS-keychain encryption on a code path, so it got the sharpest scrutiny; the load-bearing property is *provable unreachability in a packaged build*.

- **Bounded on two axes, both required.** A packaged build (any environment) is byte-identical to today — `if (opts.isPackaged) return opts.real()` is the **first** statement, so no environment variable set to anything can reach the keychain-free branch in a packaged build. This is a code guarantee, not a config convention. AC4c pins it: packaged + flag-set still returns the real, fail-closed backend.
- **Fail-closed contract integrity — unchanged for the real backend.** `secureStore.ts`'s throw-before-persist logic is not edited, wrapped, or bypassed. On every path except the single dev-affordance path, `selectSecretEncryption` returns `real()`, whose `isAvailable()` still gates the store closed without a keychain. The keychain-free backend's `isAvailable() === true` is a property of a *separate, module-private* function selected only by the gate — it cannot alter the real backend's behavior on any other path.
- **Secret-at-rest strength on the dev path is bounded and honest.** On the affordance-on path, secrets at rest are protected only by a reversible transform (no real strength). This is the intended, ticket-sanctioned trade for headless testability, confined to an unpackaged, opt-in run whose `userData` is an isolated per-run directory. It deliberately does **not** reuse or resemble the Linux `basic_text` fallback (which the real backend rejects precisely because it *masquerades* as available in production) — this is a distinct dev-only module reachable only through the gate, never in a shipped build.
- **No boundary added.** The affordance lives entirely in `src/main` — no IPC channel, no `contextBridge` API, no window/preload/wire-type change. `secretBackend.ts` imports **no** `electron`; `app.isPackaged`/`process.env` are read only at the composition root. Keys, tokens, and ciphertext stay in the main process.
- **Log-free preserved.** No `console.*` added; selecting a backend is silent, exactly like `selectRelayPolicy`.
- **Crypto-orthogonal.** The affordance touches only secret-at-rest encoding within main. The [Noise_IK session](noise-session.md), the wire types, and the [pairing gate](pairing-payload-gate.md) are upstream/orthogonal and unchanged; a wrong `server_static_pubkey` still fails the handshake closed regardless of which secret backend is selected.

## Edge cases and limitations

- **Opt-in is exact.** Only `'1'` enables the keychain-free backend; an unset var, `''`, `'0'`, `'true'`, `' 1'`, `'1 '` all resolve to the real backend — no ambiguity.
- **Fail-closed default.** Every path except the single dev-affordance path returns `real()`; a developer machine that is *not* opted in gets the real fail-closed backend.
- **Stateless / same-run only.** The keychain-free transform holds no per-instance or module-level state, so any blob written earlier in the same run reads back byte-for-byte — including empty input and arbitrary bytes (`0x00`, `0x80`, `0xFF`), no text/encoding assumptions. It needs **no** format compatibility with the real backend: the backend is chosen once per run and the e2e `userData` is a fresh per-run directory, so no cross-backend blob is ever read.
- **`decrypt` on a foreign/corrupt blob throws.** The transform checks its marker byte and throws on a non-matching blob, which `secureStore.get` propagates (never masked as absence) — same contract as the real backend. Within an isolated per-run `userData` no foreign blob exists.
- **#93 must set the exact var.** The env flag is single-sourced as `TEST_SECRET_BACKEND_ENV_FLAG` in `secretBackend.ts` (a rename is one edit); the [#93](https://github.com/pyrycode/pyrycode-desktop/issues/93) e2e scenario must set `PYRY_TEST_SECRET_BACKEND=1` when driving the built app.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the fail-closed secret-at-rest primitive whose injected `encryption` seam this affordance selects; the affordance never edits its logic, only chooses *which* `SecretEncryption` it receives.
- [Loopback relay dev affordance](loopback-relay-affordance.md) / [#97](../codebase/97.md) — the **twin** affordance for the relay chain; identical `isPackaged`-false-first gate, quarantined-module shape, and security posture.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) and [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — the two mandatory `secureStore.set` writes on the pair → connect path that this affordance unblocks headless.
- [#99 codebase notes](../codebase/99.md) — implementation summary, patterns, and lessons.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the secret-at-rest / fail-closed decision this affordance is scoped against (and deliberately does not weaken on any shipped path).
- [Window-presentation dev affordance](window-presentation-affordance.md) / [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) — the third instance of this shape (the twin is now a trio), gating whether a non-packaged build shows its window.
- Consumer chain: [#93](https://github.com/pyrycode/pyrycode-desktop/issues/93) (pair→connected through the UI, sets `PYRY_TEST_SECRET_BACKEND=1`) → [#94](https://github.com/pyrycode/pyrycode-desktop/issues/94) (send/stream).
