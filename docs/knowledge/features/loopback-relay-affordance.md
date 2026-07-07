# Loopback relay dev affordance

A deterministic, **test/dev-only** affordance that lets the built app's main process accept and dial a loopback `ws://127.0.0.1` relay — so the [#90 in-process fake relay forwarder](fake-relay-forwarder.md) can stand in for the live `wss://` relay in automated scenarios ([#93](https://github.com/pyrycode/pyrycode-desktop/issues/93) consumes it) — while a **packaged build stays byte-identical to today**: `wss:`-only + the [`RELAY_ALLOWLIST`](pairing-payload-gate.md). Introduced in [#97](../codebase/97.md), split from #93 so this security-sensitive relay-validation surface is audited in isolation rather than tangled with e2e plumbing.

It touches the internet-exposed relay-validation path (the [pairing-payload gate](pairing-payload-gate.md)), so the relaxation is expressed as **dependency injection**, quarantined to one module, and gated on three independent axes that must **all** hold simultaneously.

## What it does

The pairing-payload gate is the *single* place the relay URL is validated (`wss:`-only, host-in-allowlist); the [relay connection](relay-connection.md) then dials the validated URL **verbatim**, with no independent scheme check. So `wss:`-only enforcement lives entirely in the gate. This affordance relaxes exactly that gate — and only its scheme + host checks — to also accept a loopback `ws:` relay, but **only** on the test/dev path, and **never** in a packaged build.

The relaxation is bounded on **three independent axes, all required at once**:

1. **`!app.isPackaged`** — a deterministic code gate, checked **false-first**, so a packaged build never even reads the env flag (belt-and-suspenders "different fabric": code, not config).
2. **explicit env opt-in** — `process.env['PYRY_ALLOW_LOOPBACK_RELAY'] === '1'` (exact string).
3. **scheme + host** — scheme exactly `ws:` **and** host exactly `127.0.0.1` (loopback only, any port — the exact URL [`startFakeRelayForwarder`](fake-relay-forwarder.md) dials).

Everything else is unchanged: the `relay-not-url` and `relay-has-credentials` checks are **not** relaxed, so a `ws://user:pass@127.0.0.1/` relay is still rejected on the dev path; all eight typed reject reasons are preserved; `RELAY_ALLOWLIST` is untouched.

## How it works

The scheme+host decision is factored out of `parsePairingPayload` into an injectable `RelayPolicy` (a pure function), defaulting to today's production behavior. The **effectful** choice of which policy to run (packaged? opted in?) is made **once**, at the composition root. Three files:

| File | Change | Role |
|---|---|---|
| [`src/main/pairingPayload.ts`](pairing-payload-gate.md) | modify | Adds the `RelayPolicy` type + `productionRelayPolicy` (the default) and an optional 2nd param on `parsePairingPayload`. **No dev/loopback/env code here** — this file stays the production gate. |
| `src/main/relayPolicy.ts` | **new** (57 LOC) | Quarantines the affordance: the module-private `loopbackDevRelayPolicy`, the exported `selectRelayPolicy(...)` selector, and the `LOOPBACK_RELAY_ENV_FLAG` constant. One-way import of `productionRelayPolicy`/`RelayPolicy` from the gate (no cycle). |
| `src/main/index.ts` | modify | The effectful gate: reads `app.isPackaged` + `process.env`, calls `selectRelayPolicy`, binds the chosen policy into `parse`. The *only* place either is read. |

`relayConnection.ts`, `daemonConnection.ts`, `pairingHandler.ts`, `pairedServerStore.ts`: **no change** — the relay URL flows through them verbatim.

### The injected seam — `RelayPolicy` (in `pairingPayload.ts`)

The policy owns **exactly** the two checks that relax — scheme and host — and nothing else. Its reject arm is **type-constrained** to those two reasons, so a policy cannot invent a new reason or leak a field value:

```ts
export type RelayPolicy = (relay: URL) =>
  | { ok: true }
  | { ok: false; reason: 'relay-scheme-not-wss' | 'relay-host-not-allowed' }

/** The default — byte-identical to the inline scheme→host checks the gate always ran. */
export const productionRelayPolicy: RelayPolicy = (relay) => {
  if (relay.protocol !== 'wss:') return { ok: false, reason: 'relay-scheme-not-wss' }
  if (!RELAY_ALLOWLIST.has(relay.hostname)) return { ok: false, reason: 'relay-host-not-allowed' }
  return { ok: true }
}
```

`parsePairingPayload` gains an optional 2nd param defaulting to `productionRelayPolicy`, so its single production caller and every existing test that calls `parsePairingPayload(pasted)` are byte-identical. Inside stage 5, the inline scheme+host checks become one `const verdict = relayPolicy(relayUrl)` call, **wrapped** by the unchanged `relay-not-url` parse (before) and `relay-has-credentials` check (after) — so those two apply on **every** path. See the [pairing-payload gate doc](pairing-payload-gate.md) for the full pipeline.

### The dev affordance + selector (in `relayPolicy.ts`)

`loopbackDevRelayPolicy` is **module-private** — the affordance's guts are not importable elsewhere. It delegates to `productionRelayPolicy` and only *additionally* accepts a loopback `ws:` relay; it never re-checks the allowlist itself, so `RELAY_ALLOWLIST` stays the single source of truth:

```ts
const loopbackDevRelayPolicy: RelayPolicy = (relay) => {
  const production = productionRelayPolicy(relay)
  if (production.ok) return production
  if (relay.protocol === 'ws:' && relay.hostname === '127.0.0.1') return { ok: true }
  return production // otherwise production's (scheme-first) reject reason
}
```

`selectRelayPolicy` is the deterministic, `isPackaged`-**false-first** gate. When packaged, the env flag is **never read**:

```ts
export const LOOPBACK_RELAY_ENV_FLAG = 'PYRY_ALLOW_LOOPBACK_RELAY'

export function selectRelayPolicy(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): RelayPolicy {
  if (opts.isPackaged) return productionRelayPolicy           // env NOT consulted when packaged
  if (opts.env[LOOPBACK_RELAY_ENV_FLAG] === '1') return loopbackDevRelayPolicy
  return productionRelayPolicy
}
```

`selectRelayPolicy` takes its inputs as plain values (not reading `app`/`process` itself), so it unit-tests without stubbing Electron — mirroring the injected-seam posture elsewhere in `src/main`. It runs **once** at composition time (inside `app.whenReady().then(...)`), producing an immutable policy closure captured by `parse`. No async, timers, or shared mutable state.

### Verdict matrix (dev path, affordance-on)

| Relay | Verdict | Reason |
|---|---|---|
| `wss://pyrycode-relay.pyryco.de/…` | accept | — (production case) |
| `ws://127.0.0.1:<any port>/…` | accept | — (the affordance) |
| `ws://2130706433/`, `ws://0x7f000001/`, `ws://127.1/` | **accept** | — (canonicalize to `127.0.0.1` — genuinely loopback) |
| `ws://localhost/`, `ws://[::1]/` | reject | `relay-scheme-not-wss` (host ≠ `127.0.0.1`, scheme-first) |
| `ws://evil.example/` | reject | `relay-scheme-not-wss` (scheme-first, mirroring production) |
| `wss://evil.example/` | reject | `relay-host-not-allowed` (wss but not allowlisted) |
| `ws://u:p@127.0.0.1/` | reject | `relay-has-credentials` (credentials check still applies) |

## Data flow (dev path, affordance-on)

```
paste "ws://127.0.0.1:<port>/v1/client" payload
  → parsePairingPayload(pasted, loopbackDevRelayPolicy)   [gate accepts scheme+host; url-parse + creds still apply]
  → confirmation.prepare → confirm → pairedServerStore.save  [record.relay stored verbatim]
  → connection.reconnect → daemonConnection: url = record.relay  [verbatim]
  → createRelayConnection → new WebSocket("ws://127.0.0.1:<port>/v1/client")  [dials ws://]
```

Packaged, or dev without the flag: `parsePairingPayload(pasted, productionRelayPolicy)` → `ws://` rejected with `relay-scheme-not-wss` → byte-identical to today.

## Security properties

The architect self-review verdict is **PASS**. The affordance widens the *single* relay-substitution defense, so it got the sharpest scrutiny:

- **Bounded on three axes, all required.** A packaged build (any environment) is byte-identical to today — `app.isPackaged` short-circuits before the flag is consulted. Even on a developer machine with the flag set, the relaxed path only ever points at `127.0.0.1` — reachable only by a process already running locally; it grants **no new remote-redirection capability**. It cannot be steered to a remote attacker relay (that still requires `wss:` + allowlist).
- **Loopback-only is deliberate.** Accepting `ws:` for an arbitrary host — even on the dev path — would be a broader hole than the fake relay needs. The relaxation is constrained to the exact loopback host `127.0.0.1`. This is narrower and more honest than the mobile/binary side's `PYRY_ALLOW_INSECURE_RELAY` (which relaxes arbitrary insecure hosts); the flag name reflects that.
- **Exact-string host match, correct against IPv4 tricks.** `relay.hostname === '127.0.0.1'` accepts WHATWG-canonicalized numeric IPv4 forms (`2130706433`, `0x7f000001`, `127.1`) — genuinely loopback — while `localhost` (a name) and `[::1]` (a different address) are **not** normalized to `127.0.0.1` and are correctly rejected. No dotted-quad parsing needed.
- **The relaxation is scheme+host only.** `relay-not-url` and `relay-has-credentials` stay in `parsePairingPayload` and apply on both paths, so no userinfo ever reaches `ws`.
- **No boundary added.** The affordance lives entirely in `src/main` — no IPC channel, no `contextBridge` API, no window/preload/wire-type change. `app.isPackaged`/`process.env` are read only at the composition root.
- **Log-free preserved.** No `console.*` added; the gate's console-spy test is extended to cover the injected-policy path.
- **Crypto-orthogonal.** The affordance touches only URL scheme/host acceptance, upstream of the Noise handshake. A loopback `ws:` relay is still content-blind; the [Noise_IK session](noise-session.md) provides confidentiality/authentication end-to-end over it, and a wrong `server_static_pubkey` still fails the handshake closed.

## Edge cases and limitations

- **Opt-in is exact.** Only `'1'` enables the affordance; an unset var, `''`, `'0'`, `'true'`, `' 1'`, `'1 '` all resolve to the production policy — no ambiguity.
- **Fail-closed default.** `parsePairingPayload`'s policy param defaults to `productionRelayPolicy`; a caller that forgets to pass a policy gets production strictness, never the relaxed one.
- **Any port.** The forwarder binds an ephemeral port, so the affordance constrains only scheme + host, never the port.
- **#93 must set the exact var.** The env flag is single-sourced as `LOOPBACK_RELAY_ENV_FLAG` in `relayPolicy.ts` (a rename is one edit); the [#93](https://github.com/pyrycode/pyrycode-desktop/issues/93) e2e scenario must set `PYRY_ALLOW_LOOPBACK_RELAY=1` when driving the built app.
- **No redundant dial test.** [`relayConnection.test.ts`](relay-connection.md) already dials `ws://127.0.0.1:<port>` verbatim through `createRelayConnection`, so the "dial opens a `ws://` connection" capability is already proven; #97 does not re-test it. The full dev-path pair→dial integration is #93's e2e.

## Related

- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — the production gate this affordance injects into; it now delegates scheme+host to the `RelayPolicy` seam while keeping url-parse + credentials.
- [Fake relay forwarder](fake-relay-forwarder.md) / [#90](../codebase/90.md) — the in-process `ws://127.0.0.1:<port>` relay this affordance exists to point the built app at; its host is `127.0.0.1`, never `localhost`.
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — dials the validated URL **verbatim** (no scheme check), which is why `wss:`-only enforcement lives entirely in the gate and this affordance needs no `relayConnection.ts` change.
- [#97 codebase notes](../codebase/97.md) — implementation summary, patterns, and lessons.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model (relay substitution defense; token/keys never reach the renderer).
</content>
</invoke>
