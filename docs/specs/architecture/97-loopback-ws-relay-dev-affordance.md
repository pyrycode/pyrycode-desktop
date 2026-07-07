# Spec: main-process test/dev-only affordance — accept + dial a loopback `ws://` relay, inert in packaged builds (#97)

## Files to read first

- `src/main/pairingPayload.ts:73-148` — `parsePairingPayload`, the parse pipeline, and the inline scheme→host→credentials relay checks (stages 5b–5d at L118-131). **This is the function that gains the injected policy seam.** Extract: the current relay-check ordering and the exact `reject(reason)` calls to preserve.
- `src/main/pairingPayload.ts:37-55` — the eight `PairingRejectReason` members and the `RELAY_ALLOWLIST` ReadonlySet. Extract: the two reasons the policy owns (`relay-scheme-not-wss`, `relay-host-not-allowed`) and the fact that the allowlist is single-sourced here and must NOT be edited.
- `src/main/pairingPayload.test.ts` (whole file) — the test harness (`b64url`/`encode` helpers, `VALID` fixture, the per-reason matrix, the log-free console-spy test). The new dev-path cases follow this exact shape.
- `src/main/index.ts:139-152` — the composition root where `parse: parsePairingPayload` is wired into `registerPairingHandler`. Extract: this is the sole production caller and where the effectful gate (`app.isPackaged` + env) belongs.
- `src/main/index.ts:56-60` — the existing `app.isPackaged ? undefined : process.env[...]` precedent (the renderer-URL override). The relay-policy gate mirrors this exact "unpackaged + env-var" idiom.
- `src/main/daemonConnection.ts:201-221` — confirms the stored `record.relay` is passed to `createRelayConnection` **verbatim** as `url` (L214). No scheme check, no URL reconstruction — evidence the dial path needs no change.
- `src/main/transport/relayConnection.ts:34-49, 112` — `RelayConnectionConfig.url` doc ("used verbatim … does not validate or interpret the URL beyond handing it to `ws`") and the `new WebSocket(config.url, …)` dial. Confirms **no `relayConnection.ts` change**.
- `src/main/transport/relayConnection.test.ts:35-94` — the existing `startRelay` helper dials `ws://127.0.0.1:${port}` through `createRelayConnection`. Extract: the "dial opens a `ws://` connection" capability is **already proven** — do not add a redundant dial test to #97.
- `src/main/transport/fakeRelayForwarder.ts:20-38, 196` — the #90 forwarder whose `url` is `ws://127.0.0.1:<port>` (consumer appends `/v1/client`). This is the exact URL shape the affordance must accept; the host is `127.0.0.1`, never `localhost`.
- `docs/knowledge/features/pairing-payload-gate.md` (§ "Relay-check ordering", § "Security properties") — the security rationale for the current scheme→host→credentials order and the "credentials-last-on-a-trusted-host" semantics the dev path must preserve.

## Context

The pairing-payload gate (`src/main/pairingPayload.ts`) is the **single** place the relay URL is validated: `wss:`-only (`relay-scheme-not-wss`) and host-in-`RELAY_ALLOWLIST` (`relay-host-not-allowed`), alongside six other typed rejections. The dial (`relayConnection.ts`) then uses the validated URL verbatim — no independent scheme check. So `wss:`-only enforcement lives entirely in the gate.

The #90 fake-relay forwarder stands up an in-process `ws` server at `ws://127.0.0.1:<port>`. For an automated scenario (#93) to point the built app's main process at it, the gate must accept and dial that loopback `ws://` URL. This ticket introduces exactly that affordance: a **deterministic** gate that relaxes the relay policy to a loopback `ws:` relay **only** on the test/dev path, and is **unreachable** in a packaged build.

This is the security-sensitive surface #93 consumes but must not own — the affordance touches the internet-exposed relay-validation path, so it is audited here in isolation.

## Design source

N/A — main-process security affordance, no renderer/UI surface (AC5: nothing leaks into renderer, preload, or wire types). No Figma anchor required; the visual-fidelity check is intentionally not applicable.

## Design

The relaxation is expressed as **dependency injection**: the scheme+host decision becomes a pure `RelayPolicy` function injected into `parsePairingPayload`, defaulting to today's production behavior. The effectful choice of policy (packaged? opt-in?) is made once at the composition root. `parsePairingPayload` stays pure, synchronous, total, and log-free; `relayConnection.ts` is untouched.

### Module layout (3 production files)

| File | Change | Role |
|---|---|---|
| `src/main/pairingPayload.ts` | **modify** (~30 LOC) | Add the `RelayPolicy` type + `productionRelayPolicy` (the default), and an optional 2nd param on `parsePairingPayload`. **No dev/loopback/env code here** — this file stays the production gate. |
| `src/main/relayPolicy.ts` | **new** (~45 LOC) | Quarantines the dev affordance: the module-private `loopbackDevRelayPolicy`, the exported `selectRelayPolicy(...)` selector, and the `LOOPBACK_RELAY_ENV_FLAG` constant. Imports `RelayPolicy`, `productionRelayPolicy`, `RELAY_ALLOWLIST` from `pairingPayload.ts` (one-way dependency, no cycle). |
| `src/main/index.ts` | **modify** (~5 LOC) | The effectful gate: read `app.isPackaged` + `process.env`, call `selectRelayPolicy`, bind the chosen policy into `parse`. |

`relayConnection.ts`, `daemonConnection.ts`, `pairingHandler.ts`, `pairedServerStore.ts`: **no change** — the relay URL flows through them verbatim (confirmed: `daemonConnection.ts:214` → `relayConnection.ts:112`).

### The injected seam — `RelayPolicy` (in `pairingPayload.ts`)

The policy owns exactly the two checks that relax: scheme and host. On failure it returns one of the two existing scheme/host reasons; the URL-parse and credentials checks stay in `parsePairingPayload`, wrapping the policy call.

```ts
/** Decides only the relay's scheme + host. On failure returns one of the two scheme/host
 *  reject reasons; the relay-not-url and relay-has-credentials checks stay in parsePairingPayload. */
export type RelayPolicy = (relay: URL) =>
  | { ok: true }
  | { ok: false; reason: 'relay-scheme-not-wss' | 'relay-host-not-allowed' }

/** The default policy — byte-identical to today's inline scheme→host checks. */
export const productionRelayPolicy: RelayPolicy = /* wss: else scheme-not-wss; allowlist else host-not-allowed */
```

`parsePairingPayload` gains an optional 2nd param defaulting to `productionRelayPolicy`, so its single production caller and every existing test that calls `parsePairingPayload(pasted)` are byte-identical:

```ts
export function parsePairingPayload(
  pasted: string,
  relayPolicy: RelayPolicy = productionRelayPolicy
): ParsePairingResult
```

**Stage 5 refactor (order preserved).** The current inline checks (`pairingPayload.ts:118-131`) become:
1. `new URL(relay)` in try/catch → `relay-not-url` — **unchanged, runs on both paths**.
2. `const verdict = relayPolicy(relayUrl); if (!verdict.ok) return reject(verdict.reason)` — replaces the inline scheme + host checks. Production policy runs scheme-first then host, identical to today.
3. Credentials check (`username`/`password` non-empty) → `relay-has-credentials` — **unchanged, runs last on both paths**, so a `ws://user:pass@127.0.0.1/` relay is still rejected on the dev path (AC2), preserving the "credentials-last-on-a-now-accepted-host" semantics documented in the pairing-payload-gate knowledge doc.

All eight `PairingRejectReason` members are preserved unchanged (AC1).

### The dev affordance + selector (in `relayPolicy.ts`)

`loopbackDevRelayPolicy` (module-private — the affordance's guts are not importable elsewhere) accepts the production case OR a loopback `ws:` relay, and otherwise rejects with a production-shaped, scheme-first reason:

| Relay (dev path) | Verdict | Reason |
|---|---|---|
| `wss://pyrycode-relay.pyryco.de/…` | accept | — |
| `ws://127.0.0.1:<any port>/…` | accept | — |
| `ws://localhost/…`, `ws://[::1]/…` | reject | `relay-scheme-not-wss` (host ≠ `127.0.0.1`, scheme-first) |
| `ws://evil.example/…` | reject | `relay-scheme-not-wss` (scheme-first, mirroring production) |
| `wss://evil.example/…` | reject | `relay-host-not-allowed` (wss but not allowlisted) |

Host match is the **exact string** `relay.hostname === '127.0.0.1'`. This is deliberately correct against IPv4 encoding tricks: WHATWG `URL` canonicalizes numeric IPv4 hosts (`ws://2130706433/`, `ws://0x7f000001/`, `ws://127.1/` all yield `hostname === '127.0.0.1'`) — those are genuinely loopback, so accepting them is fine — while `localhost` (a name) and `[::1]` (a different address) are **not** normalized to `127.0.0.1` and are correctly rejected (AC2: "not `localhost`, not `::1`"). Any port is allowed (the forwarder binds an ephemeral port).

`selectRelayPolicy` is the deterministic, **`isPackaged`-false-first** gate — belt-and-suspenders "different fabric" (code, not config). When packaged, the env flag is **never read**:

```ts
export const LOOPBACK_RELAY_ENV_FLAG = 'PYRY_ALLOW_LOOPBACK_RELAY'

export function selectRelayPolicy(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): RelayPolicy {
  if (opts.isPackaged) return productionRelayPolicy           // gate: env NOT consulted when packaged
  if (opts.env[LOOPBACK_RELAY_ENV_FLAG] === '1') return loopbackDevRelayPolicy
  return productionRelayPolicy
}
```

Opt-in semantics are exact: `=== '1'`. An unset var, empty string, `'0'`, or `'true'` all resolve to the production policy — no ambiguity. The flag name is single-sourced in this module.

### The effectful gate (in `index.ts`)

The only place `app.isPackaged` / `process.env` are read. `process.env` satisfies `Record<string, string | undefined>` structurally.

```ts
const relayPolicy = selectRelayPolicy({ isPackaged: app.isPackaged, env: process.env })
const unregisterPairing = registerPairingHandler(ipcMain, {
  parse: (pasted) => parsePairingPayload(pasted, relayPolicy),
  confirmation,
  onPaired: () => connection.reconnect()
})
```

This mirrors the existing `app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']` idiom at `index.ts:56-60`.

### Data flow (dev path, affordance-on)

```
paste "ws://127.0.0.1:<port>/v1/client" payload
  → parsePairingPayload(pasted, loopbackDevRelayPolicy)   [gate accepts scheme+host]
  → confirmation.prepare → confirm → pairedServerStore.save  [record.relay stored verbatim]
  → connection.reconnect → daemonConnection provider: url = record.relay  [verbatim, L214]
  → createRelayConnection → new WebSocket("ws://127.0.0.1:<port>/v1/client")  [dials ws://, L112]
```

Packaged, or dev without the flag: `parsePairingPayload(pasted, productionRelayPolicy)` → `ws://` rejected with `relay-scheme-not-wss` → byte-identical to today.

## State + concurrency model

None introduced. `RelayPolicy`, `productionRelayPolicy`, `loopbackDevRelayPolicy`, and `selectRelayPolicy` are all pure and synchronous. `selectRelayPolicy` runs **once** at composition time (inside the existing `app.whenReady().then(...)` callback that runs to completion in one tick), producing an immutable closure captured by `parse`. No async, no timers, no shared mutable state, no teardown. `parsePairingPayload` remains pure/total/log-free.

## Error handling

- **All eight typed reject reasons preserved** (AC1). The policy owns `relay-scheme-not-wss` and `relay-host-not-allowed`; `relay-not-url` and `relay-has-credentials` stay in `parsePairingPayload` and apply on **both** paths (AC2 — the relaxation is scheme+host only).
- **Log-free preserved** — no `console.*` added to any of the three files. `selectRelayPolicy` returning a policy is silent; `parsePairingPayload`'s existing console-spy test (extended to the injected-policy cases) continues to assert this.
- **Fail-closed default** — the optional param defaults to `productionRelayPolicy`; any caller that forgets to pass a policy gets production strictness, never the relaxed one.
- The dev policy never surfaces a field value in a reason (reasons remain fixed value-free category strings).

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two test files; each scenario is one `it(...)` mirroring the existing `pairingPayload.test.ts` shape (`encode`/`VALID` helpers).

### `src/main/pairingPayload.test.ts` (extend)

- **Default param is production** — already covered by every existing test calling `parsePairingPayload(pasted)`; add one explicit assertion that `parsePairingPayload(encode({...VALID, relay: 'ws://127.0.0.1:5555/v1/client'}))` (no 2nd arg) rejects with `relay-scheme-not-wss` (AC4a).
- **Injected policy is honored** — passing a fake policy that returns `{ok:true}` for a `ws://127.0.0.1` relay yields `ok:true` with the four fields; passing one that returns a scheme/host reason yields that reason. Proves the seam without importing the dev policy.
- **URL-parse still applies under any policy** — `encode({...VALID, relay:'not a url'})` with an accept-all fake policy → `relay-not-url` (the policy is never reached).
- **Credentials still apply under an accepting policy** — `encode({...VALID, relay:'ws://u:p@127.0.0.1:5555/'})` with a policy that accepts loopback → `relay-has-credentials` (AC2: credentials check runs after, on both paths).
- **Log-free with an injected policy** — extend the console-spy test to include an injected-policy call.

### `src/main/relayPolicy.test.ts` (new)

Drive the affordance through `selectRelayPolicy` (do not export/test `loopbackDevRelayPolicy` directly — test the real entry point). Apply the returned policy to `new URL(relay)` inputs, or feed it through `parsePairingPayload` for end-to-end reason assertions.

- **Production policy rejects loopback `ws://`** (AC4a) — `selectRelayPolicy({isPackaged:false, env:{}})` returns a policy that rejects `ws://127.0.0.1:5555/` with `relay-scheme-not-wss`, and accepts `wss://pyrycode-relay.pyryco.de/…`.
- **Affordance-on accepts loopback `ws://`** (AC4b) — `selectRelayPolicy({isPackaged:false, env:{[LOOPBACK_RELAY_ENV_FLAG]:'1'}})` returns a policy that accepts `ws://127.0.0.1:<any port>/…` and still accepts the production `wss://` host.
- **Affordance-on still rejects non-loopback + non-wss** — the dev policy rejects `ws://localhost/`, `ws://[::1]/`, `ws://evil.example/` (`relay-scheme-not-wss`), and `wss://evil.example/` (`relay-host-not-allowed`); the IPv4-canonicalization case `ws://2130706433/` is **accepted** (genuinely loopback).
- **Credentials/non-url still rejected via the parse gate on the dev path** — `parsePairingPayload(encode({...VALID, relay:'ws://u:p@127.0.0.1:5555/'}), devPolicy)` → `relay-has-credentials`.
- **Packaged short-circuits regardless of env** (AC4c) — `selectRelayPolicy({isPackaged:true, env:{[LOOPBACK_RELAY_ENV_FLAG]:'1'}})` returns a policy that **rejects** `ws://127.0.0.1:5555/` with `relay-scheme-not-wss` — proving `app.isPackaged` wins over the opt-in and the packaged path is byte-identical to production.
- **Opt-in is exact** — env values `'0'`, `''`, `'true'`, and unset all yield the production policy (only `'1'` enables).
- **Dial coverage is not re-tested here** — `relayConnection.test.ts` already dials `ws://127.0.0.1:${port}` verbatim; the full dev-path pair→dial integration is #93's e2e, out of scope for #97.

### Type-level (`npm run typecheck`)

- `RelayPolicy`'s reject arm is constrained to the two scheme/host reasons — a policy cannot invent a new reason or return `relay-has-credentials`.
- `process.env` structurally satisfies `selectRelayPolicy`'s `env: Record<string, string | undefined>` param (no cast in `index.ts`).

## Open questions

- **Env flag name** — spec picks `PYRY_ALLOW_LOOPBACK_RELAY` (narrower and more honest than the binary side's `PYRY_ALLOW_INSECURE_RELAY`, since this only relaxes loopback, not arbitrary insecure hosts). Developer may keep it; it is single-sourced as `LOOPBACK_RELAY_ENV_FLAG` so a rename is one edit. #93 must set this exact var when driving the built app.
- **`productionRelayPolicy` export** — exported from `pairingPayload.ts` because it is both the default param and imported by `relayPolicy.ts`. `loopbackDevRelayPolicy` stays module-private. No further exports needed.

## Security review

**Verdict:** PASS

Adversarial re-read per `architect/security-review.md`. The affordance widens the single relay-substitution defense, so it got the sharpest scrutiny.

**Findings:**

- **[Trust boundaries]** No findings. The untrusted→trusted boundary stays the single `parsePairingPayload` function (the only `string → QrPayload` path). Injecting `RelayPolicy` does not scatter the check — the URL parse, the policy call, and the credentials check remain co-located in stage 5 of that one function. The policy is a pure function with a type-constrained reject arm; it cannot leak a field value or emit a novel reason.
- **[Network & I/O — relay URL validation]** The core surface. The relaxation is bounded on **three independent axes**, all required simultaneously: (1) `!app.isPackaged` — deterministic code gate, checked false-first, so a packaged build never reads the flag and is byte-identical to today (AC3); (2) explicit env opt-in `=== '1'`; (3) scheme `ws:` **and** host exactly `127.0.0.1` (loopback only, any port). The credentials and URL-parse rejections still apply on the dev path (AC2), so no userinfo reaches `ws`. `maxPayload` + connect/idle timeouts are inherited unchanged from `relayConnection.ts` (not touched). **Residual risk:** on a developer machine that is both unpackaged AND has the flag set, a pasted `ws://127.0.0.1:<port>` payload is accepted — but the target is loopback, reachable only by a process already running locally, so it grants no new remote-redirection capability. Confined to dev; zero effect on shipped builds. Acceptable.
- **[Electron attack surface]** No findings. The affordance adds no IPC channel, no `contextBridge` API, no window/preload change; it lives entirely in `src/main` (AC5). `app.isPackaged` and `process.env` are read only at the composition root, never in the renderer.
- **[Inter-process / process placement]** No findings. Token, key, and socket stay in the main process. The dev path changes only *which host the socket may dial*, never *where the socket lives*.
- **[Error messages, logs, telemetry]** No findings. No `console.*` added; the log-free property is preserved and re-asserted by the extended console-spy test. Reject reasons remain fixed value-free strings.
- **[Cryptographic primitives]** N/A — the affordance touches only URL scheme/host acceptance, upstream of the Noise handshake. A loopback `ws:` relay is still content-blind; the Noise_IK session (unchanged) still provides confidentiality/authentication end-to-end over it, and a wrong `server_static_pubkey` still fails the handshake closed.
- **[Concurrency]** N/A — all added code is pure and synchronous; `selectRelayPolicy` runs once at composition time producing an immutable closure. No async, timers, listeners, or shared mutable state introduced.
- **[Threat model — malicious relay]** The relaxed path only ever points at `127.0.0.1`; it cannot be steered to a remote attacker relay (that still requires `wss:` + allowlist). The production relay-substitution defense is unchanged for all end users.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
