# Spec — Pairing fingerprint digest that works under Electron's BoringSSL (#101)

**Size:** S (1 production file, 1 new build/QA script, 1 dependency; test-first)

## Context

`deriveFingerprint` (`src/main/pairingConfirmation.ts:84`) computes the server-key fingerprint with
`createHash('blake2s256')` from `node:crypto`. Node ships OpenSSL, which has `blake2s256`; **Electron
ships BoringSSL, which has no BLAKE2 family at all**, so this call throws `Error: Digest method not
supported` in the built app. The throw escapes `ipcMain.handle`, the `pyry:pairing` invoke rejects,
and the renderer wedges forever in `submitting` (`pairingState.ts` `submitting` phase never advances).
Pairing is completely broken in the real app; vitest passes because it runs under full-OpenSSL Node.

The fingerprint is a **security primitive**: `BLAKE2s-256(server_static_pubkey)[:8]`, colon-separated
lowercase hex, byte-identical to the daemon's `internal/pair.Fingerprint`. The operator eyeball-compares
it against `pyry pair` / the phone to detect a tampered key. The 64-bit (8-byte) truncation width is
load-bearing (a 32-bit fingerprint is brute-forceable) and must not change.

This is a pure digest-mechanism swap: replace the BoringSSL-absent `node:crypto` digest with a
synchronous, environment-independent BLAKE2s that produces the **same bytes**, and make the digest
step return a typed reject reason instead of throwing.

## Spike result — which BLAKE2s, and why synchronous

The ticket flagged the digest mechanism as a spike. Findings from the code surface:

- **`noise-c.wasm` does NOT expose a standalone "BLAKE2s-256 of arbitrary 32 bytes."** Its wrapper
  (0.4.0) surfaces only `HandshakeState` / `CipherState` / `CreateKeyPair` / constants
  (`src/main/transport/noise-c.wasm.d.ts:7-76`). `GetHandshakeHash()` hashes a handshake transcript,
  not arbitrary input — not usable here. Reaching Emscripten internals for a raw hash op is undeclared,
  fragile, and **async** (see next point).
- **`loadNoiseLib()` is async and memoized** (`noiseLib.ts:42-71`). `deriveFingerprint` and `prepare`
  are **synchronous today**, and the confirm-gate architecture (one persist site, sync `prepare`
  returning a `confirm` closure) leans on that. Threading the wasm in would make `prepare` async and
  ripple through `PairingConfirmation.prepare` → `pairingHandler.ts:85` (`confirmation.prepare(...)`
  would need `await`) → every test's sync assertion. That is the ticket's named main design risk.
- **WebCrypto (`crypto.subtle`) has no BLAKE2** either — SHA family only. There is no built-in BLAKE2s
  reachable under Electron.

**Decision: use a small, vetted, pure-JS synchronous BLAKE2s — `@noble/hashes`.** It is audited,
zero-dependency, and pure JavaScript: it never calls `node:crypto` or BoringSSL, so it computes the
identical BLAKE2s-256 bytes under vitest/Node **and** Electron. Because it is synchronous, `prepare`
stays synchronous and the async ripple vanishes. This satisfies CLAUDE.md "never hand-roll crypto"
(it is a vetted library, the same rationale that justifies `noise-c.wasm`) and "don't add dependencies
without justification" (justification: BoringSSL lacks BLAKE2; `noise-c.wasm` exposes no standalone
hash; WebCrypto has no BLAKE2; hand-rolling is disallowed — a dependency is unavoidable).

A pure-JS digest also **eliminates the "crypto backend unavailable" failure mode** the ticket's
Technical Notes worried about: `@noble/hashes` `blake2s` on a validated 32-byte input is deterministic
pure computation with no environment dependency — it cannot fail at runtime the way the wasm loader or
`node:crypto`-under-BoringSSL can. AC4 still requires `deriveFingerprint` to *return a typed reason
rather than throw*; we satisfy that with a targeted `try/catch` around the digest (a deterministic
safety net), but the branch is effectively unreachable — which shapes the reason-mapping decision below.

## Files to read first

- `src/main/pairingConfirmation.ts:22` — the `createHash` import to replace; `:30-32`
  `FingerprintRejectReason` (add a member here); `:66` `DerivedFingerprint`; `:76-89`
  `deriveFingerprint` (the throwing digest at `:84`); `:91-94` `reject`; `:101-131` `createPairingConfirmation`.
  **The single production file that changes.**
- `src/main/pairingConfirmation.test.ts:41-80` — existing behaviour to preserve, incl. the **parity
  vector** at `:60-69` (`32:0b:5e:a9:9e:65:3b:c2` for the all-zero key — must stay green under the new
  digest); `:120-141` the malformed-key reject pattern (mirror it for the new reason); `:170-206`
  the "never returns token/key" and **log-free** invariants (must survive the catch you add).
- `src/main/pairingHandler.ts:83-89` — the submit branch maps `!prepared.ok → 'invalid-key'` with no
  switch on the specific `FingerprintRejectReason`. Confirms: **adding a member to
  `FingerprintRejectReason` ripples nowhere in the handler, and the wedge closes through this existing
  typed path** (no handler change needed — see Design).
- `src/shared/ipc/pairing.ts:45-51` — the shared `PairingErrorReason` vocabulary. Confirms we do **not**
  add a member here (Design § reason mapping explains why).
- `src/renderer/src/screens/pairing/PairingScreen.tsx:28` — `ERROR_COPY: Record<PairingErrorReason,
  string>` is an **exhaustive** map: adding a shared reason would force a copy edit + a 4th production
  file. Reinforces the collapse decision.
- `src/renderer/src/screens/pairing/pairingState.ts:28,42-45,72-90` — the reducer surfaces a
  `submit-failed` reason on the `editing` phase; confirms a typed reject reason unwedges the screen.
- `src/main/transport/noiseLib.ts:42-71` — why the wasm is not reused here (async/memoized).
- `src/main/transport/noise-c.wasm.d.ts:7-76` — the wasm wrapper surface (no standalone hash) — spike evidence.
- `src/main/transport/noiseSession.test.ts:208-220` + `src/main/transport/noiseSpike.vectors.json` —
  golden-vector fixture precedent for a parity assertion (reuse the pattern for the Electron check).
- `package.json` — `dependencies` (noise-c.wasm, ws, zustand); add `@noble/hashes` here (runtime dep,
  used in main), not devDependencies.

## Design

### Change 1 — swap the digest, keep it synchronous (`pairingConfirmation.ts`)

Replace the `node:crypto` import and the digest line. Contract (not implementation):

- Import: `import { blake2s } from '@noble/hashes/blake2s'` (replaces `import { createHash } from 'node:crypto'`).
- In `deriveFingerprint`, after the two existing base64 / length guards, compute the digest as
  `blake2s(keyBytes, { dkLen: 32 })` (BLAKE2s-256 → a 32-byte `Uint8Array`). `Buffer` is a
  `Uint8Array`, so `keyBytes` passes directly; the existing `.subarray(0, FINGERPRINT_BYTES)` +
  `Array.from(...).map(b => b.toString(16).padStart(2,'0')).join(':')` formatting is unchanged
  (works identically on a `Uint8Array`).
- `FINGERPRINT_BYTES = 8` and `PUBKEY_BYTES = 32` are unchanged — the width is load-bearing.

**Dependency pin.** Install `@noble/hashes` pinned to the **v1 line** (`npm install @noble/hashes@^1.7.1`)
so the import subpath `@noble/hashes/blake2s` and the `blake2s(msg, { dkLen })` signature are the
documented v1 API. External docs are unavailable in this environment — the **parity vector is the
acceptance oracle**: if the installed API differs (e.g. a v2 subpath change), the parity unit test
below fails loudly and the developer adjusts the import. If v1 pinning is somehow unavailable, `blakejs`
is an acceptable pure-JS drop-in (`blake2s(bytes, undefined, 32)` → `Uint8Array`); the same vector gates it.

### Change 2 — the digest returns a typed reason, does not throw (AC4)

Add `'fingerprint-unavailable'` to `FingerprintRejectReason` (`pairingConfirmation.ts:30-32`) — a
value-free category meaning "the digest primitive failed," distinct from the two malformed-key reasons.

Wrap **only the `blake2s(...)` call** in `deriveFingerprint` in a `try/catch`; on any throw, return
`{ ok: false, reason: 'fingerprint-unavailable' }`. Requirements on the catch:

- **Log-free and value-free**: return the static reason only — no `console.*`, never the caught error's
  message (it could echo internals). This preserves the module's log-free-by-construction property and
  the "never returns token/key" invariant (`pairingConfirmation.test.ts:170-206`).
- The base64 / length guards keep returning their existing typed reasons; only the digest is newly guarded.

Downstream is automatic and needs **no other production change**: a `fingerprint-unavailable` derive
result makes `deriveFingerprint` return `{ ok:false }`, so `prepare` returns `reject(reason)` (an
`ok:false` `PreparedPairing` with **no `confirm` handle** → structurally unpersistable), the handler's
existing `if (!prepared.ok) return { ok:false, reason:'invalid-key' }` (`pairingHandler.ts:87`) fires,
the renderer receives `submit-failed`, and the reducer moves `submitting → editing` with the error.
**Wedge closed through the existing typed path** — no unhandled `ipcMain.handle` rejection.

### Reason mapping — collapse to `invalid-key`, do NOT add a shared `PairingErrorReason`

The handler currently maps every `FingerprintRejectReason` to the shared `invalid-key`. The ticket
asked whether a digest failure warrants a *distinct* crossing reason (`fingerprint-unavailable` in
`src/shared/ipc/pairing.ts`) so the operator isn't told to re-paste a good key — a design call, not a
mandate. **Decision: no distinct shared reason. Keep the handler's existing collapse.**

Rationale (Evidence-Based Fix Selection + Simplicity First):

1. Choosing pure-JS `@noble/hashes` **eliminates the failure mode** the distinct reason describes —
   the digest cannot fail for a validated 32-byte key. Surfacing a distinct operator message (and the
   copy for it) defends an unobservable path.
2. `PairingErrorReason` is consumed by `PairingScreen.tsx:28`'s exhaustive `Record<PairingErrorReason,
   string>`; adding a member forces a renderer copy edit → a 4th production file (the ticket's own split
   trigger) for a branch that cannot fire.
3. Security-safe: on any derive failure there is no `confirm` handle and no fingerprint is shown, so the
   confirm-gate holds regardless of which value-free reason surfaces. `invalid-key` is a value-free
   `PairingErrorReason`, satisfying AC4's "surfaces as a value-free `PairingErrorReason`."

The typed `fingerprint-unavailable` still exists at the **main-only** `FingerprintRejectReason` layer to
satisfy AC4's structural "returns a typed reason, does not throw" guarantee. Per the ticket's guidance:
the chosen mechanism does **not** reintroduce a throw the typed-reason path cannot absorb (the single
targeted `try/catch` absorbs any digest throw into the typed path), so **no route-back is warranted**.
If a future digest swap ever reintroduces a genuinely reachable runtime-failure mode, add the distinct
crossing reason then — not now.

### Change 3 — validate under the real Electron runtime (AC3)

vitest runs under full-OpenSSL Node and **structurally cannot** catch the BoringSSL divergence, so a
vitest-only test does not satisfy AC3. Provide a standalone check that runs under Electron's runtime.

**Do NOT use the `e2e/pair-to-conversation.spec.ts` path for this ticket.** That file exists only on the
unmerged `feature/93` branch — it is not on `main` and not in this worktree. Editing/creating it here
would collide with #93 at merge. Ownership: the e2e belongs to #93; once #101 merges, #93 does
`git merge main` (picking up the fixed digest) and un-`fixme`s its own e2e as part of *its* remaining
work. #101 uses the sanctioned alternative from AC3: the `ELECTRON_RUN_AS_NODE=1 electron` digest check.

Add `scripts/electron-digest-check.mjs` (a build/QA script — **not** a `.ts` production file, **not** a
vitest test) and an npm script to run it. Contract:

- Runs under `ELECTRON_RUN_AS_NODE=1 electron scripts/electron-digest-check.mjs`.
- **Informational** (documents *why* `node:crypto` is unusable here): log whether
  `require('crypto').createHash('blake2s256')` throws and print `crypto.getHashes().filter(h =>
  h.includes('blake'))`. Under Electron this shows the throw and an empty blake list — the reproduction
  from the issue body, now proving the fix's premise in-runtime.
- **Gating**: compute the fingerprint of a 32-zero-byte key via `@noble/hashes/blake2s` using the *same*
  derive+format as `deriveFingerprint` (`blake2s(keyBytes, { dkLen: 32 })` → `.subarray(0,8)` → colon-hex)
  and assert it equals `32:0b:5e:a9:9e:65:3b:c2`. `process.exit(1)` on mismatch or any throw; exit 0 on match.
- Add `"check:electron-digest": "ELECTRON_RUN_AS_NODE=1 electron scripts/electron-digest-check.mjs"` to
  `package.json` scripts (developer confirms the electron binary invocation for this repo — the
  installed `electron` bin under `node_modules/.bin/electron`).

Coverage split (state this honestly): the **vitest parity test** exercises the real `deriveFingerprint`
for value-correctness (AC2); the **Electron check** proves the chosen BLAKE2s primitive is BoringSSL-safe
and reproduces the daemon vector under Electron (AC3), and documents that `node:crypto`'s `blake2s256`
throws there. Together they cover "correct bytes" and "works in the real runtime."

## State + concurrency model

No change. `deriveFingerprint` and `prepare` stay **synchronous** (the whole point of choosing a sync
digest). No new async task, timer, socket, or store slice. `createPairingConfirmation`'s composition-root
signature (`{ store }`) is unchanged — the digest is a module-level pure function, not an injected seam
(injecting it would ripple the composition root and every test's construction for no benefit; the catch
branch is tested with `vi.mock`, below).

## Error handling

| Failure | Result at `deriveFingerprint` | Result at `prepare` | Crosses IPC as | UI |
|---|---|---|---|---|
| not canonical base64 | `{ok:false, reason:'pubkey-not-base64'}` | `reject(...)`, no confirm | `invalid-key` | `editing` + inline error |
| wrong length (≠32B) | `{ok:false, reason:'pubkey-wrong-length'}` | `reject(...)`, no confirm | `invalid-key` | `editing` + inline error |
| digest throws (new, ~unreachable) | `{ok:false, reason:'fingerprint-unavailable'}` | `reject(...)`, no confirm | `invalid-key` | `editing` + inline error |
| valid key | `{ok:true, fingerprint}` | `{ok:true, fingerprint, confirm}` | `fingerprint` | `reviewing` |

No path throws out of `deriveFingerprint`/`prepare`; no path shows a fingerprint without a matching
`confirm` handle; no reason carries a field value. Out of scope per the ticket: a generic `try/catch`
around `parse`/`prepare` in the handler and a `catch` in `runSubmit` — the typed path above closes the
observed wedge without them; do not add generic guards.

## Testing strategy

Test-first, vitest (`npm test`) + the Electron check (`npm run check:electron-digest`), typecheck (`npm run typecheck`), build (`npm run build`).

**`pairingConfirmation.test.ts` (extend; keep every existing test green):**

- **Parity vector unchanged** — the existing `:60-69` test (`32:0b:5e:a9:9e:65:3b:c2` for the all-zero
  key) must pass with the new digest. This is the byte-identity oracle for AC2; do not weaken it. Add,
  if useful, one more pinned vector (a non-zero known key) computed the same way, following the
  `noiseSession.test.ts` golden-vector precedent.
- **Determinism / field-independence** — the existing `:41-58` test stays green (same key → same
  fingerprint; token/server don't affect it; different key → different fingerprint).
- **New: digest failure returns a typed reason, does not throw (AC4)** — with the digest forced to throw
  (`vi.mock('@noble/hashes/blake2s', () => ({ blake2s: () => { throw new Error('boom') } }))`),
  `prepare(validRecord)` returns `{ ok:false, reason:'fingerprint-unavailable' }`, exposes **no**
  `confirm` handle, calls `store.save` **zero** times, and does not throw. Mirror the malformed-key
  reject assertions at `:120-141`.
- **Log-free preserved (AC5)** — extend the log-free assertion (`:183-206`) to also drive the
  digest-failure path under the mock and assert no `console.*` call.
- **No token/key leak preserved (AC5)** — the `:170-181` assertions still hold (success arm exposes only
  `confirm`/`fingerprint`/`ok`; reject arm is value-free).

**`scripts/electron-digest-check.mjs` (AC3)** — asserts the parity vector via `@noble/hashes/blake2s`
under `ELECTRON_RUN_AS_NODE=1 electron`; exits non-zero on mismatch; logs the `node:crypto` blake2s
absence for context. This is the criterion vitest cannot satisfy.

**No handler / shared / renderer test changes** — the collapse decision means `pairingHandler.ts`,
`pairing.ts`, and `PairingScreen.tsx` are untouched, so their tests are unaffected.

## Scope / non-goals

- Production files changed: **`src/main/pairingConfirmation.ts` only** (1). Plus `package.json` (dep +
  script), `src/main/pairingConfirmation.test.ts` (tests), and `scripts/electron-digest-check.mjs` (build
  script). Well under the S red lines; no new exported type crossing a module boundary; no sync→async ripple.
- Do **not** touch `e2e/pair-to-conversation.spec.ts` (it is #93's, unmerged — see Change 3).
- Do **not** add a generic handler/`runSubmit` guard (ticket non-goal).
- Do **not** change `FINGERPRINT_BYTES` (load-bearing 64-bit width).
- Do **not** add a `docs/knowledge/codebase/101.md` deliverable — the documentation phase writes it after merge.

## Open questions

- **`@noble/hashes` major/API subpath.** Pin `^1.7.1` for the v1 `@noble/hashes/blake2s` API; the parity
  vector is the oracle if the installed API differs. `blakejs` is a sanctioned fallback. (Resolved by
  the test — noting for the developer since external docs are unavailable here.)
- None blocking.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the digest mechanism runs inside `deriveFingerprint` **after** the
  base64-canonicality and 32-byte-length guards (`pairingConfirmation.ts:77-82`), so `blake2s` only ever
  receives an already-validated fixed 32-byte input. No new IPC channel, `contextBridge` API, or accepted
  request field is added; the renderer→main guard (`isPairingRequest`, `pairingHandler.ts:74`) is unchanged.
- [Tokens/secrets] No findings — `deriveFingerprint` receives only `server_static_pubkey`; the token is
  untouched. Success returns only the fingerprint (a hash of the **public** key); the new reject arm is a
  static value-free string. The "never returns token/key" invariant (`pairingConfirmation.test.ts:170-181`)
  is preserved and the log-free test extended to the new path.
- [Cryptographic primitives] No findings (positive) — BLAKE2s-256 via `@noble/hashes` is a **vetted,
  audited** library, not hand-rolled; it is the correct standard substitute because the daemon protocol
  mandates BLAKE2s (`Noise_IK_..._BLAKE2s`) and Electron/BoringSSL lacks it. **Byte-identity to the
  daemon's `internal/pair.Fingerprint` is gated** by the existing parity vector `32:0b:5e:a9:9e:65:3b:c2`
  (verified a genuine `BLAKE2s-256(0³²)[:8]`), which also acts as a canary against a subverted hash impl.
  The load-bearing **64-bit truncation width** (`FINGERPRINT_BYTES = 8`) is explicitly preserved (a
  32-bit fingerprint is brute-forceable). No RNG, key, or nonce is involved. Fingerprint comparison is
  performed **visually by the operator**, not by attacker-facing code, so `timingSafeEqual` is N/A.
- [Electron attack surface] No findings — the digest computes in the **main** process; the renderer never
  imports `@noble/hashes` and still receives only the fingerprint/reason (process-placement invariant
  holds). No `webPreferences`, protocol, or navigation change. `scripts/electron-digest-check.mjs` is a
  developer-only build/QA script (not shipped, not attacker-reachable) and opens no window or IPC.
- [Error messages / logs] No findings — the new `try/catch` returns a fixed value-free reason and never
  the caught error's message; the module stays log-free (no `console.*`). The check script logs only
  `crypto.getHashes()` output and a hardcoded-zero-buffer digest — no real key or token.
- [Network & I/O] No findings — no socket, relay URL, frame, or filesystem operation is introduced; the
  digest is pure constant-work computation over a fixed 32-byte input (no size amplification / DoS vector).
- [Concurrency] No findings — `deriveFingerprint`/`prepare` stay **synchronous**; no async task, timer,
  listener, or shared-state mutation added; the handler's single-slot `pendingConfirm` logic is untouched.
- [Threat model alignment] No findings — the change **restores** the anti-tampering fingerprint (fully
  broken by the BoringSSL throw) with byte-parity and width intact, so the operator's visual
  key-verification against `pyry pair`/the phone works again. Hostile-paste input is validated upstream;
  renderer-compromise isolation is unchanged. No threat posture is weakened.
- [Dependency hygiene] SHOULD FIX (recoverable in code-review) — commit the `package-lock.json` change so
  `@noble/hashes` is integrity-pinned; the parity vector additionally fails loudly if the resolved
  implementation is incorrect or tampered. Not a gate — the lockfile is written by `npm install`.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
