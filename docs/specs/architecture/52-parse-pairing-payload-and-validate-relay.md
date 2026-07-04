# Spec — Parse the pairing payload and validate the relay against an allowlist (#52)

**Size:** S (architect-confirmed; a comfortable S bordering XS). One new pure `src/main/` module (`pairingPayload.ts`) plus its test file. **4 new exported names** (`parsePairingPayload`, `ParsePairingResult`, `PairingRejectReason`, `RELAY_ALLOWLIST`); the success payload reuses `QrPayload` (no new type — no wire drift). **Zero consumer cascade** — nothing existing calls the new surface; composition-root wiring lands with #53. No effectful dependency (no keychain, filesystem, socket, IPC, or crypto). Within all S red lines (≤3 new files, ≤~600 total LOC, ≤5 new exports, 0 call sites, 8 linear reject branches).

**Status:** ready for development.

**No UI surface.** This is a pure main-process logic module ("no persistence, no crypto, no IPC, no UI" per the ticket). There is no `## Figma` section in the ticket body and none is needed — nothing here renders. The paste *field* that feeds this parser is a later renderer ticket; this module only receives the already-pasted string over a future IPC/command boundary (#53's concern).

## Files to read first

The developer's turn-1 data load. Page each in deliberately — don't grep for them.

- `src/shared/wire/types.ts:119-125` — the `QrPayload` interface (`server`, `relay`, `token`, `server_static_pubkey`). **The success result reuses this type verbatim** — import it, do not re-declare the shape (CLAUDE.md "don't drift the wire types"; mirrors `pairedServerStore`'s `PairedServerRecord = QrPayload`).
- `src/main/pairedServerStore.ts:83-138` — the **structural-decode pattern to mirror**: `decodeRecord` does `JSON.parse` in a try/catch → non-null-object check → per-field `typeof === 'string'` check → **re-pick the four fields explicitly** (drops stray keys). This module does the same shape one layer earlier (on the untrusted paste) and adds the base64url outer decode + the relay semantic check. Also note its **log-free / static-error posture** — copy it exactly.
- `src/main/pairedServerStore.test.ts:1-58` — the in-file fake + table-driven idiom and the `RECORD` fixture shape. This module's tests need no fake at all (pure function), but mirror the `describe`/`it`, the AC-tagged test names, and the console-spy log-free assertion.
- `src/main/index.ts:30-76` — the **URL-validation shape reference only** (`new URL()` in a try/catch, deny on parse failure, filter by `protocol`, compare against an allowed value, any parse failure denies). That code guards window navigation, not the relay — do **not** hang the relay allowlist there; it is a pattern to imitate, not a place to edit.
- `src/main/transport/relayConnection.ts:29-49` — confirms the relay URL is taken **verbatim** and never validated by the transport (`RelayConnectionConfig.url`, "does not validate or interpret the URL beyond handing it to `ws`"). This module is the *only* place the relay is checked before it reaches that socket.
- `docs/knowledge/features/paired-server-store.md` — the downstream consumer contract: #53 takes this module's validated `QrPayload` and calls `store.save(record)`; the store explicitly defers "relay-URL / token validity" to *this* ticket (structural-only there, "not semantic").
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the wire contract is the mobile source of truth; the security model mirrors mobile (keys/token never reach the renderer). This module lives in `src/main` for that reason.
- **Encoding source of truth (mobile/daemon contract), summarized in § "Wire encoding" below so you don't need cross-repo access:** the daemon's `internal/pair` package (`pyrycode` repo, specs #211/#432; feature doc `knowledge/features/pair-package.md`). The desktop parser is the TypeScript mirror of that package's `Decode`.

## Context

Desktop pairing is **paste-only** (no QR scanner). The operator pastes the pairing payload the daemon minted (`pyry pair`). That pasted string is **the first point where attacker-influenceable text enters the pairing flow** — this module is that input gate. It does two jobs and stops:

1. **Parse** the pasted string into the four `QrPayload` fields, rejecting any malformed input with a typed rejection (never a partial or defaulted record).
2. **Validate the relay** — the one semantic check the gate owns, and the security-load-bearing one: the `relay` URL's scheme must be `wss:` and its host must be in an explicit main-process allowlist. Without this, a pasted payload could point the client at an attacker-controlled relay before the transport dials it verbatim.

Its validated output (`QrPayload`) is consumed by #53 (fingerprint-confirm-and-persist over the paired-server store) and, through that, the transport. This ticket **stops at producing a validated record** — no persistence, no IPC wiring, no connect.

### Wire encoding (confirmed against the mobile/daemon source of truth)

The pasted string is **exactly what the daemon's `pair.Encode` emits** — there is **no `pyry://` URI wrapper** (the `pyry://…` in the Figma placeholder is a mockup, not the contract). The encoding, outermost to innermost:

1. **Outer envelope:** `base64url` with the **URL-safe alphabet and no padding** (Go `base64.RawURLEncoding`; alphabet `[A-Za-z0-9_-]`, no `=`). Decode it to get the JSON bytes.
2. **JSON tuple:** `{"server":"…","relay":"…","token":"…","server_static_pubkey":"…"}` — four string fields (JSON key order is irrelevant to parsing).
3. **Inner `server_static_pubkey`:** itself `base64` **standard** alphabet *with* padding (Go `base64.StdEncoding`) of the raw 32-byte X25519 key. **This module treats it as an opaque string** (see § "Scope: what is NOT validated here").

The desktop parser mirrors the daemon's `Decode` for the **structural** layer and adds the relay check. The daemon `Decode` reference has seven categories; the deliberate scoping below keeps this module to structural + relay.

## Design

### Module placement

One new file: `src/main/pairingPayload.ts`. Flat under `src/main`, a sibling of `pairedServerStore.ts` — same "pure core, main-process only, imports only the *type* of `QrPayload`" shape. It lives in `src/main` (not `src/shared`/`src/renderer`) because validating transport-facing untrusted input is a background-process concern (CLAUDE.md "Keep the transport out of the window"); the token and key bytes it parses must never transit the renderer.

No changes to `src/main/index.ts`, `relayConnection.ts`, `pairedServerStore.ts`, or any existing file. Composition-root wiring is #53's job (matching how #21/#22/#44 all deferred their wiring).

### Exported surface (contract sketch — signatures only)

```ts
import type { QrPayload } from '../shared/wire/types'

/** Discriminated result. Success carries the four validated fields as a QrPayload;
 *  failure carries only a category reason — never a partial record, never a field value. */
export type ParsePairingResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: PairingRejectReason }

/** Rejection categories. Each is a bounded, value-free string — safe to surface/log.
 *  Ordered by the pipeline stage that produces it. */
export type PairingRejectReason =
  | 'not-base64url'          // outer string not URL-safe base64 (no-pad alphabet)
  | 'not-json'               // decoded bytes are not valid UTF-8 JSON (incl. trailing garbage)
  | 'not-object'             // JSON is not a non-null, non-array object
  | 'malformed-field'        // a field is missing, not a string, or empty
  | 'relay-not-url'          // relay string does not parse as a URL
  | 'relay-scheme-not-wss'   // relay scheme is not exactly 'wss:'
  | 'relay-has-credentials'  // relay URL carries embedded userinfo (user:pass@)
  | 'relay-host-not-allowed' // relay host is not in RELAY_ALLOWLIST

/** The single source of truth for allowed relay hosts (milestone-1: one pyrybox, one relay).
 *  Hostnames only, lowercase (URL normalizes case). NEVER derived from the pasted payload. */
export const RELAY_ALLOWLIST: ReadonlySet<string>

/** Parse + validate an untrusted pasted pairing payload. Pure, total, throw-free:
 *  every failure is an `ok: false` arm, every success a fully-validated QrPayload. */
export function parsePairingPayload(pasted: string): ParsePairingResult
```

`QrPayload` is imported, not re-declared — a wire-contract change flows through as a type change, never a silent divergence.

### `RELAY_ALLOWLIST` — the single source of truth

```ts
export const RELAY_ALLOWLIST: ReadonlySet<string> = new Set(['pyrycode-relay.pyryco.de'])
```

- **One place, main process, not payload-derived** (AC4). The deployed relay is `wss://pyrycode-relay.pyryco.de/v1/client` (server side `/v1/server`; confirmed live at desktop bring-up, `pyrycode-mobile` v0.15.0 running the v2 relay cutover). Milestone-1 is a single pyrybox behind a single relay, so the set has one entry.
- **Exact hostname match via `Set.has`** — no prefix/suffix/substring matching, so `pyrycode-relay.pyryco.de.evil.example` and `evil.example` both miss. A future multi-relay change adds entries here and nowhere else.
- Exported (rather than module-private) so #53 and a test can reference the canonical host without re-hardcoding the literal; it is a `ReadonlySet` so a consumer cannot mutate the allowlist at runtime.

### Parse pipeline (behavior summary — not the implementation)

`parsePairingPayload` runs a **linear** validation pipeline; the first failing stage returns its `ok:false` reason and nothing downstream runs. Stages, in order:

1. **Normalize + base64url alphabet.** `.trim()` the input (a pasted string commonly carries a trailing newline; whitespace is not part of the base64url alphabet so trimming can never drop payload bytes). Then require the trimmed string to be non-empty and match `^[A-Za-z0-9_-]+$`. Anything else → `not-base64url`. This is a **strict** pre-check because Node's `Buffer.from(s, 'base64url')` is *lenient* (it silently drops out-of-alphabet characters) — the regex restores the daemon's `RawURLEncoding` strictness so the desktop accepts exactly what the phone/daemon contract accepts.
2. **Base64url decode → UTF-8 text → JSON.** Decode with `Buffer.from(trimmed, 'base64url')`; decode the bytes with `new TextDecoder('utf-8', { fatal: true })` (rejects invalid UTF-8 rather than emitting replacement chars); `JSON.parse` the text. Any throw in this stage → `not-json`. **Trailing garbage is free in JS**: unlike Go's `json.Unmarshal`, `JSON.parse('{...}x')` throws on trailing non-whitespace, so no separate trailing-byte check is needed (the daemon's step 3 is subsumed).
3. **Object shape.** Require `typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)` → else `not-object`.
4. **Field presence + type.** For each of the four field names, require a **non-empty string** (`typeof v === 'string' && v.length > 0`) → else `malformed-field`. Non-empty mirrors the daemon's `Decode` (an empty `relay`/`token`/`server`/`pubkey` is not "well-formed"; the AC's "never a partial or defaulted record" wants this).
5. **Relay semantic validation** on the (now known non-empty string) `relay`:
   - `new URL(relay)` in a try/catch → catch returns `relay-not-url`.
   - `url.protocol !== 'wss:'` → `relay-scheme-not-wss` (rejects `ws:`, `https:`, `pyry:`, etc.).
   - `url.username !== '' || url.password !== ''` → `relay-has-credentials`. The canonical relay URL never carries userinfo; a pasted `wss://user:pass@host/` is anomalous and is rejected **even when the host is allowlisted**, so no embedded credential is ever handed to `ws` (which would send it as a Basic-auth header). This closes the security-review "no embedded credentials" item; without it, `wss://x@pyrycode-relay.pyryco.de/` would slip through the host check below (see § Security review, Network & I/O).
   - `!RELAY_ALLOWLIST.has(url.hostname)` → `relay-host-not-allowed`. `URL.hostname` is already lowercased and strips any `user@` userinfo, so `wss://evil@pyrycode-relay.pyryco.de.evil.example/` correctly resolves `hostname === 'pyrycode-relay.pyryco.de.evil.example'` and misses.
6. **Success.** Build the result by **picking exactly the four fields** (`{ server, relay, token, server_static_pubkey }`) — dropping any stray keys the JSON carried, exactly as `pairedServerStore.encodeRecord`/`decodeRecord` re-pick. Return `{ ok: true, payload }`.

### Scope: what is NOT validated here (deliberate architect call)

The daemon's `Decode` additionally validates the **server-id** (`ParseServerID`, UUIDv4) and the **`server_static_pubkey`** (base64-decodable, exactly 32 bytes). **This module deliberately does neither**, treating both as opaque non-empty strings. Rationale:

- **The AC scopes the semantic check to the relay** — it is the only field whose value can redirect the connection to an attacker before any handshake. The other three are neutralized downstream: a wrong `server_static_pubkey` makes the Noise_IK handshake fail closed (key mismatch → no session), and the operator **visually verifies the key's fingerprint against the phone in #53** — that human check is the real MITM defense, not a format check here. A wrong `server`/`token` fails auth at the relay/daemon.
- **Evidence-based fix selection** — the ticket's own test matrix lists no server-id or pubkey case; adding those branches defends a failure mode this module doesn't own. It mirrors `pairedServerStore`'s explicit structural-only posture ("not semantic") and the daemon's own deferral of relay validation to "whoever dials."
- This keeps the reject taxonomy at **8 categories** (well under the 10-branch red line) and the module genuinely small.

If a later ticket wants the pubkey/server-id shape-checked at the gate (belt-and-suspenders with #53's fingerprint step), it is an additive change: two more reasons, two more stages after stage 4. Named in Open questions.

## State + concurrency model

**None.** `parsePairingPayload` is a pure, synchronous, total function: string in, `ParsePairingResult` out. No store slice, no Zustand, no async, no `AbortController`, no timers, no listeners, no shared mutable state (`RELAY_ALLOWLIST` is a module constant, frozen-by-`ReadonlySet`-typing, read-only). Concurrent calls are trivially safe; nothing to cancel on teardown. This is intentional — the gate is a decision function, not a lifecycle owner.

## Error handling

Rejection is an **expected, routine outcome** (the operator can paste anything), so failures are modeled as an `ok:false` **data arm**, not thrown exceptions — control-flow-by-exception is wrong for a validation gate, and it also keeps the "no field value in an error" property structural (there is no `Error` object to accidentally interpolate a value into). Every failure maps to exactly one `PairingRejectReason`:

| Stage | Failure | Reason |
|---|---|---|
| 1 | empty / non-base64url-alphabet outer string | `not-base64url` |
| 2 | base64url→UTF-8→JSON throws (bad bytes, invalid UTF-8, invalid JSON, trailing garbage) | `not-json` |
| 3 | JSON is `null`, an array, or a non-object | `not-object` |
| 4 | any of the four fields missing / non-string / empty | `malformed-field` |
| 5a | `relay` not parseable by `new URL()` | `relay-not-url` |
| 5b | relay scheme ≠ `wss:` | `relay-scheme-not-wss` |
| 5c | relay URL carries embedded userinfo (`user`/`pass`) | `relay-has-credentials` |
| 5d | relay host ∉ `RELAY_ALLOWLIST` | `relay-host-not-allowed` |

- **No field value ever appears in a reason** (AC5). Reasons are fixed, value-free category strings. The success payload carries values; the failure arm carries only a category. There is no `console.*` anywhere in the module (log-free by construction, mirroring `pairedServerStore`). The **consumer** (#53) decides how to surface a reason to the operator — this module never logs.
- **Caught errors are discarded, not echoed.** The `try/catch` around JSON decode and around `new URL()` maps the throw to a category and drops the caught `Error` (a `ws`/URL error object can embed the input — never copy `err.message` into the reason).

## Testing strategy

`src/main/pairingPayload.test.ts` — vitest, **no fakes, no keychain, no filesystem, no network** (the function is pure). Test-first: write these RED before the module exists. Table-driven where the axis is wide. Each case is described below as *input → expected outcome*; the developer writes the assertions in the project's idiom (`describe`/`it`, AC-tagged names like `pairedServerStore.test.ts`).

**A shared helper** builds a valid pasted string from a `QrPayload`: JSON-stringify → `Buffer.from(json).toString('base64url')`. Use it to construct the happy case and to mutate individual fields for the malformed cases (so tests never hand-transcribe base64).

- **AC1 — happy path.** A `QrPayload` with `relay: 'wss://pyrycode-relay.pyryco.de/v1/client'` encoded via the helper → `{ ok: true, payload }` where `payload` deep-equals the four input fields. Assert the four fields are all present and equal.
- **AC1 — stray keys dropped.** Encode an object with the four valid fields **plus** an extra key → `ok:true` and `payload` has exactly the four keys (the extra is not present).
- **AC2 — not base64url.** `'!!!'`, `'has spaces'`, a padded base64 (`'...=='`), and `''` (empty) → each `{ ok:false, reason:'not-base64url' }`.
- **AC2 — not JSON.** base64url of `'not json'` → `not-json`. base64url of `'{"server":"a"'` (truncated) → `not-json`. base64url of a valid object **plus trailing garbage** (`'{...}x'`) → `not-json` (pins the JS-strict trailing-byte behavior).
- **AC2 — not object.** base64url of `'null'`, of `'42'`, of `'"a string"'`, and of `'[]'` → each `not-object`.
- **AC2 — malformed field.** For **each** of the four fields: (a) omitted, (b) present but a number/`null`/object (non-string), (c) present but empty string `''` → each `malformed-field`. (Table over field × failure-mode; assert never `ok:true` and never a partial payload returned.)
- **AC3 — disallowed scheme.** Valid tuple but `relay: 'ws://pyrycode-relay.pyryco.de/v1/client'` → `relay-scheme-not-wss`. Also `https://…` and `pyry://…` on the allowed host → `relay-scheme-not-wss`.
- **AC3 — host not in allowlist.** Valid `wss:` tuple but `relay: 'wss://evil.example/v1/client'`, `'wss://pyrycode-relay.pyryco.de.evil.example/'`, and `'wss://evil@pyrycode-relay.pyryco.de.evil.example/'` (userinfo does not rescue the wrong host) → each `relay-host-not-allowed`.
- **AC3 / security — embedded credentials rejected.** `relay: 'wss://user:pass@pyrycode-relay.pyryco.de/v1/client'` and `'wss://token@pyrycode-relay.pyryco.de/'` (allowlisted host, but userinfo present) → each `relay-has-credentials` (not `ok:true`, not `relay-host-not-allowed`). Pins that userinfo is rejected even on the allowed host.
- **AC3 — relay not a URL.** `relay: 'not a url'` and `relay: 'wss://'` → `relay-not-url`.
- **AC3 — allowed host accepted.** `relay: 'wss://pyrycode-relay.pyryco.de/v1/client'` and a bare `'wss://pyrycode-relay.pyryco.de'` (no path) → both `ok:true`. Confirms case-insensitivity: `'wss://PYRYCODE-RELAY.PYRYCO.DE/v1/client'` → `ok:true` (URL lowercases the host).
- **AC4 — allowlist single-sourced.** Assert `RELAY_ALLOWLIST.has('pyrycode-relay.pyryco.de')` and that the exported set is the only allowlist reference (structural — the reviewer greps for a second hardcoded host; the test just pins the canonical entry).
- **AC5 — log-free.** Spy all `console` methods (`log/info/warn/error/debug/trace`); run the happy path **and** every reject branch; assert none fire. (Mirrors `pairedServerStore.test.ts`'s console-spy.)
- **Normalization.** A valid encoded string with a trailing `'\n'` and surrounding spaces → `ok:true` (trim applied).

Type-level coverage: `npm run typecheck` confirms `ParsePairingResult` is a proper discriminated union (the `ok:true` arm exposes `payload`, the `ok:false` arm exposes `reason`) and that `payload` is `QrPayload`. `npm run build` is the salvage/QA gate.

## Open questions

1. **Port handling on the allowlisted host.** The relay check matches `URL.hostname` (per the AC's "host") and does **not** constrain the port; the deployed relay serves 443 only, and a payload with the allowed host but a dead port simply fails to connect downstream. If a future deployment runs the relay on a non-default port, either add the port to the matched value (`URL.host`) or widen the allowlist entry — a one-line change. Not addressed now (no observed need).
2. **Server-id / pubkey shape validation deferred** (see § "Scope"). If #53's fingerprint step or a security follow-up wants the gate to also reject a non-base64 or wrong-length `server_static_pubkey` and a non-UUID `server`, it is an additive two-stage/two-reason extension. Deferred; the fingerprint visual-verify in #53 is the load-bearing key check.
3. **Multi-relay / multi-pyrybox.** `RELAY_ALLOWLIST` is milestone-1 single-entry. Per-server allowlisting (or config-sourced hosts) is the same deferred multi-server change that `pairedServerStore`'s per-server-id keying is waiting on. The allowlist must remain main-process-defined and never payload-derived when that lands.

## Security review

**Verdict:** PASS (no MUST FIX; one Network & I/O hardening — embedded-credential rejection — was folded into the design during this pass, see stage 5c).

**Findings:**

- **[Trust boundaries]** No finding. This module *is* the untrusted→trusted boundary and it is explicit: a single named function (`parsePairingPayload`) in one file, returning a discriminated union. A caller only obtains a `payload` by taking the `ok:true` arm — the reject arm carries no record. Data flow enforces the boundary: the paste enters as a `string`, and this function is the *only* `string → QrPayload` path, so #53 cannot hold a "validated" record that skipped this gate. A branded output type (`ValidatedPairingPayload`) was considered and deferred — it adds an export for no reachable bypass (the union arm + single code path already gate it) and `QrPayload` is deliberately reused to prevent wire drift.
- **[Tokens, secrets, credentials]** No finding. The paste carries the `token` (bearer) and `server_static_pubkey`; this module generates nothing (no RNG), stores nothing (no persistence — #44/#53 own at-rest via `safeStorage`, ADR 0005), and **never places any field value in a reason, a log, or a thrown error** (reasons are fixed value-free category strings; zero `console.*`; caught errors discarded not echoed — the log-free test asserts it across every branch). The token appears only in the `ok:true` payload returned to the main-process caller, never to the renderer. Token lifecycle (rotation/revocation/expiry) is out of scope for a parser — named, owned upstream by the daemon + #53.
- **[File / storage operations]** N/A — the module performs no filesystem or storage I/O, builds no path, and reads no config file. The untrusted paste never reaches a file operation here; #53's persistence uses the fixed, non-payload-derived `PAIRED_SERVER_NAME`. No path-traversal, TOCTOU, or at-rest surface exists in this ticket.
- **[Inter-process / Electron attack surface]** SHOULD FIX (hand-off to #53, not a defect in this deliverable). This module adds no `BrowserWindow`, `webPreferences`, `contextBridge`, or `ipcMain` surface — it is a pure function called only from tests in this ticket. Its process placement is correct: it lives in `src/main`, so the parsed token/key never transit the renderer (a MUST-FIX-class property, satisfied). **Requirement carried to #53:** the future IPC/command handler that feeds the pasted string into this function must validate the argument is a `string` before calling (the renderer→main IPC arg is untrusted; this function's `(pasted: string)` contract assumes the type). That deterministic type-guard belongs at the IPC boundary #53 introduces, not duplicated inside this pure function — no such caller exists yet, so there is no exploitable path in *this* ticket.
- **[Cryptographic primitives]** N/A — no crypto. base64url is a transport encoding, not a security primitive; `server_static_pubkey` is handled as an opaque string (the Noise_IK handshake and fingerprint are the transport's / #53's concern). No secret is compared, so the non-constant-time `Set.has` host lookup is correct (`timingSafeEqual` is for secret/MAC compares; the relay host and allowlist are both public values).
- **[Network & I/O]** No finding — this is the ticket's core control, and it is complete: scheme is restricted to exactly `wss:` (no insecure `ws:` opt-in; the binary side's test-only `AllowInsecureScheme`/`PYRY_ALLOW_INSECURE_RELAY` is deliberately **not** mirrored — production-strict, no observed need), the host must exact-match a single-sourced main-process allowlist (`Set.has`, no prefix/substring matching, `URL.hostname` case-normalized and userinfo-stripped), a non-URL relay is rejected, and **embedded credentials are rejected** (stage 5c, added this pass — `wss://user:pass@allowed-host/` → `relay-has-credentials`, so no Basic-auth userinfo is ever handed to `ws`). Frame-size cap (`maxPayload`), connect/idle timeouts, reconnect backoff, and TLS cert verification are the transport's concerns (`relayConnection` / supervisor #21/#22, already shipped, `ws` defaults verify TLS and set `maxPayload`); this module opens no socket. `rejectUnauthorized:false` appears nowhere. Cert/host pinning beyond the hostname allowlist is out of scope, deferred to the transport.
- **[Error messages, logs, telemetry]** No finding. Reasons are bounded, value-free category strings; the module emits no logs, no telemetry, no disk output, and returns data rather than throwing (no stack traces surfaced). No secret can reach a crash/telemetry reporter from here. The log-free property is asserted by a console-spy test over the happy path and all eight reject branches.
- **[Concurrency]** N/A — a pure, synchronous, total function. No async, no `AbortController`, no timers/intervals, no listeners, no long-lived tasks, no shared mutable state (`RELAY_ALLOWLIST` is a read-only module constant). Nothing to cancel on teardown; concurrent calls are trivially safe.
- **[Threat model alignment]** The two desktop threats this gate owns are addressed: **relay substitution** (a malicious paste pointing the client at an attacker relay) is blocked by the `wss:`-only, exact-host allowlist, single-sourced and never payload-derived; **malformed/hostile paste** is rejected structurally with no partial record and no value leak. **Renderer-compromise-reaching-transport**: the parsed token/key are main-process-only and never cross to the renderer; a compromised renderer can at most submit a paste string over the (#53-guarded) IPC boundary — it cannot bypass the allowlist (main-process-defined) or extract the parsed token. **Substituted server static key (MITM via replaced pubkey)** is deliberately *not* defended by a format check here — it is neutralized by Noise_IK failing closed on a key mismatch and, decisively, by the operator visually verifying the key's fingerprint against the phone in #53; a base64/length check at this gate would be defense theatre against a threat the fingerprint step actually closes (§ Scope). Malicious-relay on-path behavior (drop/delay/reorder/flood) and token-theft-from-disk are the transport's and #44/#53's threats respectively — named, out of scope here.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
