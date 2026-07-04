# Pairing-payload gate

The desktop client's **pairing input gate**: the pure, main-process function that parses a pasted pairing payload into the four [`QrPayload`](../codebase/5.md) fields and validates its `relay` URL against an allowlist before anything downstream can use it. Desktop pairing is **paste-only** (no QR scanner), so the pasted string is the **first point where attacker-influenceable text enters the pairing flow** — this module is that gate. It does two jobs and stops: parse the payload structurally, and validate the relay (the one security-load-bearing semantic check). Its validated output is consumed by the fingerprint-confirm-and-persist step (#53) and, through that, by the [paired-server store](paired-server-store.md), which explicitly defers relay-URL / token validity to *this* gate.

Introduced in [#52](../codebase/52.md). It lives **entirely** in `src/main` — the `token` (a bearer credential) and `server_static_pubkey` (a static key) it parses must never transit the renderer ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It is a **pure, synchronous, total, log-free** function — no persistence, no crypto, no IPC, no socket, no UI. It is the only `string → QrPayload` path, so the fingerprint step (#53) cannot hold a "validated" record that skipped this gate.

## What it does

Gives the background process **one function** — `parsePairingPayload(pasted: string)` — that returns a discriminated `ParsePairingResult`:

- **Success** (`{ ok: true, payload }`) carries the four validated fields as a `QrPayload`.
- **Failure** (`{ ok: false, reason }`) carries **only** a value-free category `reason` — never a partial record, never a field value.

Rejection is an **expected, routine outcome** (the operator can paste anything), so failures are modeled as an `ok:false` **data arm**, not thrown exceptions. The function never throws and never logs.

## How it works

**One** production file in `src/main/`, a flat sibling of `pairedServerStore.ts`:

| File | Role |
|---|---|
| `src/main/pairingPayload.ts` | The whole gate: `parsePairingPayload`, the `ParsePairingResult` / `PairingRejectReason` types, and the `RELAY_ALLOWLIST` constant. Imports **only the type** of `QrPayload` (relative path — the `@shared` alias is not wired for `src/main`). No `electron`/`fs`/socket import. ~148 LOC. |

### Public surface

```ts
import type { QrPayload } from '../shared/wire/types'

/** Discriminated result. Success carries the four validated fields as a QrPayload;
 *  failure carries only a category reason — never a partial record, never a field value. */
export type ParsePairingResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: PairingRejectReason }

/** Rejection categories — each a bounded, value-free string, ordered by pipeline stage. */
export type PairingRejectReason =
  | 'not-base64url'          // outer string is empty or not the URL-safe, no-pad alphabet
  | 'not-json'               // decoded bytes are not valid UTF-8 JSON (incl. trailing garbage)
  | 'not-object'             // JSON is not a non-null, non-array object
  | 'malformed-field'        // a field is missing, not a string, or empty
  | 'relay-not-url'          // relay string does not parse as a URL
  | 'relay-scheme-not-wss'   // relay scheme is not exactly 'wss:'
  | 'relay-has-credentials'  // relay URL carries embedded userinfo (user:pass@)
  | 'relay-host-not-allowed' // relay host is not in RELAY_ALLOWLIST

/** The single source of truth for allowed relay hosts (AC4). Never payload-derived. */
export const RELAY_ALLOWLIST: ReadonlySet<string>

/** Parse + validate an untrusted pasted pairing payload. Pure, total, throw-free. */
export function parsePairingPayload(pasted: string): ParsePairingResult
```

`QrPayload` is **imported, not re-declared** — a wire-contract change flows through as a type change, never a silent divergence (CLAUDE.md "don't drift the wire types"; the same guard [`PairedServerRecord = QrPayload`](paired-server-store.md) uses).

### Wire encoding (the mobile/daemon contract)

The pasted string is **exactly what the daemon's `pair.Encode` emits** — there is **no `pyry://` URI wrapper** (the `pyry://…` in the Figma placeholder is a mockup, not the contract). Outermost to innermost:

1. **Outer envelope** — `base64url`, URL-safe alphabet, **no padding** (Go `base64.RawURLEncoding`; alphabet `[A-Za-z0-9_-]`, no `=`).
2. **JSON tuple** — `{"server":…,"relay":…,"token":…,"server_static_pubkey":…}`, four string fields (key order irrelevant).
3. **Inner `server_static_pubkey`** — itself standard-base64 of the raw 32-byte X25519 key. **This module treats it as an opaque string** (see [§ Deliberately not validated](#deliberately-not-validated-here)).

### Parse pipeline

`parsePairingPayload` runs a **linear** pipeline; the first failing stage returns its `ok:false` reason and nothing downstream runs:

| Stage | Check | Reject reason |
|---|---|---|
| 1 | `.trim()`, then require non-empty and a **strict** `^[A-Za-z0-9_-]+$` match | `not-base64url` |
| 2 | `Buffer.from(trimmed, 'base64url')` → `TextDecoder('utf-8', {fatal:true})` → `JSON.parse`, all in one try/catch | `not-json` |
| 3 | `typeof === 'object' && !== null && !Array.isArray` | `not-object` |
| 4 | each of the four fields is a **non-empty** string | `malformed-field` |
| 5a | `new URL(relay)` in a try/catch | `relay-not-url` |
| 5b | `url.protocol === 'wss:'` | `relay-scheme-not-wss` |
| 5c | `RELAY_ALLOWLIST.has(url.hostname)` | `relay-host-not-allowed` |
| 5d | `url.username === '' && url.password === ''` | `relay-has-credentials` |
| 6 | success — **pick exactly the four fields**, dropping stray keys | — |

Two of these stages restore a strictness the JS platform would otherwise lose or hand us for free:

- **The stage-1 regex is a strict pre-check** because Node's `Buffer.from(s, 'base64url')` is **lenient** — it silently drops out-of-alphabet characters. The regex restores the daemon's `RawURLEncoding` strictness so the desktop accepts exactly what the phone/daemon contract emits, nothing more. (Trimming can never drop payload bytes: whitespace isn't in the base64url alphabet, and a pasted string commonly carries a trailing newline.)
- **Trailing garbage is free in JS**: unlike Go's `json.Unmarshal`, `JSON.parse('{…}x')` throws on trailing non-whitespace, so no separate trailing-byte check is needed — the daemon's trailing-byte step is subsumed by stage 2.

### `RELAY_ALLOWLIST` — the one source of truth

```ts
export const RELAY_ALLOWLIST: ReadonlySet<string> = new Set(['pyrycode-relay.pyryco.de'])
```

- **One place, main process, not payload-derived** (AC4). Milestone-1 is a single pyrybox behind the single deployed relay `wss://pyrycode-relay.pyryco.de/v1/client`, so the set has one entry.
- **Exact `Set.has` match** — no prefix/suffix/substring matching, so `pyrycode-relay.pyryco.de.evil.example` and `evil.example` both miss. `URL.hostname` is already lowercased and userinfo-stripped, so a look-alike host misses regardless of any `user@` prefix. A future multi-relay change adds entries **here and nowhere else**.
- A `ReadonlySet`, so a consumer cannot mutate the allowlist at runtime. Exported (rather than module-private) so #53 and a test reference the canonical host without re-hardcoding the literal.

### Relay-check ordering (scheme → host → credentials)

The shipped order is **scheme, then host allowlist, then embedded credentials** — the credentials check runs *last*, on an already-allowlisted host. This is a deliberate, security-equivalent resolution of a contradiction in the spec's stage table (which listed credentials before host); see [§ Lessons learned in the ticket note](../codebase/52.md#lessons-learned). Either order rejects `wss://user:pass@allowed-host/` and hands nothing to `ws`; running host-first makes the `relay-has-credentials` branch mean exactly what its name says — "userinfo present **on the otherwise-trusted host**."

## Deliberately not validated here

The daemon's `Decode` additionally validates the **server-id** (UUIDv4) and the **`server_static_pubkey`** (base64-decodable, exactly 32 bytes). **This module does neither**, treating both as opaque non-empty strings:

- **The AC scopes the semantic check to the relay** — it is the only field whose value can redirect the connection to an attacker *before* any handshake. A wrong `server_static_pubkey` makes the Noise_IK handshake fail closed (key mismatch → no session), and the operator **visually verifies the key's fingerprint against the phone in #53** — that human check is the real MITM defense, not a format check here. A wrong `server`/`token` fails auth at the relay/daemon.
- **Evidence-based fix selection** — the ticket's test matrix lists no server-id or pubkey case; adding those branches would defend a failure mode this module doesn't own. It mirrors [`pairedServerStore`](paired-server-store.md)'s explicit structural-only posture ("not semantic").

Adding the pubkey/server-id shape-check later (belt-and-suspenders with #53's fingerprint step) is an additive change: two more reasons, two more stages after stage 4.

## Security properties

The gate owns two desktop threats; the architect security review verdict is **PASS** (embedded-credential rejection was folded in during the review pass):

- **Relay substitution** (a malicious paste pointing the client at an attacker relay) is blocked by the `wss:`-only, exact-host allowlist — single-sourced and never payload-derived. This is the security-load-bearing check: [`relayConnection`](relay-connection.md) takes the relay URL **verbatim** and never validates it, so this is the *only* place the relay is checked.
- **Malformed/hostile paste** is rejected structurally with **no partial record** and **no value leak**.
- **No field value ever reaches a reason, a log, or a thrown error** (AC5). Reasons are fixed value-free category strings; there is **no `console.*` anywhere**; caught JSON/URL errors are discarded, never echoed (a `ws`/URL error object can embed the input). A console-spy test asserts this across the happy path and all eight reject branches.
- **Token/key never cross a boundary** — the gate lives in `src/main`, adds zero renderer/preload/IPC surface, and returns the token only in the `ok:true` payload to its main-process caller.
- **Substituted server static key** is deliberately *not* defended by a format check here — Noise_IK fails closed on a key mismatch, and #53's fingerprint visual-verify is the load-bearing key check.

## Edge cases and limitations

- **Whitespace / trailing newline** — trimmed; a valid payload with surrounding spaces and a trailing `\n` still parses (`ok:true`).
- **Padded base64 (`…==`), spaces, or an empty string** — `not-base64url` (strict alphabet pre-check).
- **Truncated JSON / valid object + trailing garbage** — `not-json`.
- **JSON `null` / number / string / array** — `not-object`.
- **Missing / non-string / empty field** (any of the four) — `malformed-field`; never a partial or defaulted record.
- **Relay `ws:` / `https:` / `pyry:`** — `relay-scheme-not-wss`. Insecure-scheme opt-in (the binary side's test-only `PYRY_ALLOW_INSECURE_RELAY`) is deliberately **not** mirrored — production-strict.
- **Relay embedded credentials** (`wss://user:pass@allowed-host/`) — `relay-has-credentials`, even on the allowlisted host, so no userinfo ever reaches `ws` as a Basic-auth header.
- **Stray keys** — dropped; the success `payload` carries exactly the four fields.
- **Port not constrained** — the check matches `URL.hostname` per the AC's "host" and does not constrain the port (the relay serves 443; a payload with the allowed host but a dead port simply fails to connect downstream). A future non-default-port deployment matches `URL.host` or widens the entry — a one-line change.
- **Not wired yet** — nothing calls the gate outside its tests; composition-root wiring lands with #53 (matching the #21/#22/#42/#43/#44 defer-wiring precedent). The **hand-off requirement carried to #53:** the future IPC/command handler that feeds the pasted string must validate the argument is a `string` before calling — the renderer→main IPC arg is untrusted, and this pure function's `(pasted: string)` contract assumes the type.
- **Single relay** — `RELAY_ALLOWLIST` is milestone-1 single-entry; per-server allowlisting (or config-sourced hosts) is the same deferred multi-server change as `pairedServerStore`'s per-server-id keying, and must stay main-process-defined and never payload-derived when it lands.

## Related

- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — the downstream consumer; #53 takes this gate's validated `QrPayload` and calls `store.save(record)`. The store defers relay-URL / token validity to *this* gate.
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — takes the relay URL **verbatim**; this gate is the only place it is checked first.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the ported wire types, including the `QrPayload` this gate reuses.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model (token/keys never reach the renderer; mirror mobile) and why this lives in `src/main`.
- [#52 codebase notes](../codebase/52.md) — implementation summary, patterns, and lessons.
- Downstream consumer: the fingerprint-confirm-and-persist step (#53), which surfaces a reason to the operator and persists the validated record.
