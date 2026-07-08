# 132 — Stamp the diagnostics log with the app version and wire-protocol version

**Ticket:** [#132](https://github.com/pyrycode/pyrycode-desktop/issues/132) · size **XS** · `security-sensitive`
**Split from:** #125 (Bucket-1 diagnostics). **Blocked-by:** #126 (the content-free logger) — **merged**.

## Context

An operator diffing a good session's diagnostics bundle against a bad one needs to attribute each bundle to a specific client build and protocol variant. A version mismatch is a real, high-value failure class: the exact `Noise_IK_25519_ChaChaPoly_BLAKE2s` variant is load-bearing and a mismatch fails the handshake **silently** (CLAUDE.md; ADR 0002). The version stamp is the first thing you need to spot that from the bundle alone.

This ticket emits **one** content-free "session start" record through the single #126 `diagnosticLog`, carrying the app version and the wire-protocol identity. It is a startup banner — emitted once per process, not a per-line stamp — and it is the last of the #125 Bucket-1 split.

## Files to read first

- `src/main/index.ts:148-163` — the composition root. `diagnosticLog` is constructed at line 153-155; `app.getVersion()` is already read at line 161. **This is where the banner is emitted** — immediately after the logger exists, before `createDaemonConnection`, so the banner is the first record (`seq 0`) of the session.
- `src/main/diagnosticLog.ts:30-64` — the `DiagnosticEvent` allowlist. Add the version fields here, additively, exactly the way `hash?` (line 57) and `safeBytes?` (line 63) were added. Read the module header (lines 1-18): the security guarantee is the **absence of any secret-shaped field** — no `Record`, `unknown`, or index signature. Preserve it.
- `src/main/receiveDiagnostic.test.ts:20-26` — the compile-time allowlist pin `Equals<RendererDiagnosticEvent, Omit<DiagnosticEvent, 'safeBytes'>>`. **Adding a main-only field to `DiagnosticEvent` breaks this pin** — you must extend the `Omit<…>` list. Read the comment at lines 14-22: this is the same conscious, reviewed decision #133 made for `safeBytes`.
- `src/shared/ipc/diagnostics.ts:33-100` — `RendererDiagnosticEvent` (the renderer-safe mirror) and `projectDiagnosticEvent` (the renderer→main boundary net). The version fields are **main-only** — they must **NOT** be added here. Read the reasoning at lines 8-17: `RendererDiagnosticEvent` deliberately omits main-only fields; leaving these out is what keeps the untrusted renderer from producing them.
- `src/shared/wire/types.ts:10-14` — `NOISE_PROTOCOL` (`'Noise_IK_25519_ChaChaPoly_BLAKE2s'`) and `PROTOCOL_VERSION` (`'v2'`). Import these **verbatim** into the banner helper (relative path `../shared/wire/types` — the `@shared` alias is not available in `src/main`; see `src/main/transport/codec.ts:23` for the idiom). Never retype the string.
- `src/main/daemonConnection.ts:173,192,384` — existing `diagnosticLog?.event({ event: '…' })` call sites. Match the kebab-case event-name convention (`'daemon-failed'`, `'daemon-connected'`, `'daemon-dial'`). Those sites use `?.` because the dep is optional there; at the composition root `diagnosticLog` is a concrete instance, so the call is `diagnosticLog.event(...)` (no `?.`).
- `src/renderer/src/store/sessionDiagnostics.ts` (#134) — **conceptual precedent only** (it is renderer-side): a tiny dedicated module that builds a content-free record and emits it through the logger, unit-tested in isolation. The banner helper mirrors that shape on the main side.

## Design

### 1. Allowlist: three additive version fields on `DiagnosticEvent`

Add three optional string fields to `DiagnosticEvent` in `src/main/diagnosticLog.ts`, each a distinct, named, content-free version axis (mirroring how `hash?`/`safeBytes?` slot in — no new `Record`/`unknown`/index signature):

| Field | Value source | Meaning |
|-------|--------------|---------|
| `appVersion?: string` | `app.getVersion()` | which desktop client build |
| `noiseProtocol?: string` | `NOISE_PROTOCOL` | the Noise handshake variant (the silent-failure axis) |
| `protocolVersion?: string` | `PROTOCOL_VERSION` | the outer wire-protocol version (`v1` vs `v2`) |

**Why all three, not just the Noise variant.** The ticket's load-bearing target is the Noise variant, and `appVersion` is explicitly required. `protocolVersion` is included because it is **not** redundant with the Noise variant: v1 and v2 share the *same* Noise variant string (`types.ts:26-30` — v2 changed the framing/size caps, not the handshake variant), so the Noise variant alone cannot disambiguate a v1↔v2 negotiation drift. `protocol_versions: [PROTOCOL_VERSION]` is exactly what the client sends the daemon (`codec.ts:168`), so a negotiation mismatch is diagnosable only with this field. Three cheap static strings, one banner.

Each field carries the constant **verbatim**, never a retyped literal. Document each with a one-line doc comment in the allowlist, matching the surrounding style.

### 2. The banner helper — a small, testable, Electron-free module

New file `src/main/sessionBanner.ts`. It exists so the banner logic has a unit-test surface (the composition root inside `app.whenReady()` is not unit-testable). Contract:

```
// signature only — implementation is a single log.event(...) call
export function logSessionStart(log: DiagnosticLog, appVersion: string): void
```

- Imports `NOISE_PROTOCOL`, `PROTOCOL_VERSION` from `../shared/wire/types` and the `DiagnosticLog` type from `./diagnosticLog`. It does **not** import Electron — the only Electron-sourced value, `app.getVersion()`, is passed in as `appVersion`. This keeps the Electron coupling at the composition root, exactly like `diagnosticLog.ts` itself.
- Emits **exactly one** record: `{ event: 'session-start', appVersion, noiseProtocol: NOISE_PROTOCOL, protocolVersion: PROTOCOL_VERSION }`. No other field. `seq`/`ts` are stamped by the logger (`diagnosticLog.ts:127`).
- Event name `'session-start'` is a static literal, kebab-case per convention.

The value-of-a-separate-file trade: the alternative (inline in `index.ts`) has no unit-test surface and would force an Electron harness. One tiny module is the right seam — same call the #134 helper makes.

### 3. Emission seam — one call at the composition root

In `src/main/index.ts`, immediately after `const diagnosticLog = createDiagnosticLog({…})` (line 155) and **before** `createDaemonConnection` (line 156):

```
logSessionStart(diagnosticLog, app.getVersion())
```

Placing it here makes the banner `seq 0` — the first line of every bundle. `app.whenReady().then(…)` runs once per process, so the banner is emitted once. **Do not** call `logSessionStart` from `connection.start()`, `reconnect()`, the dial loop, or any transport module — re-running the transport must not re-emit it (AC3). Add the `import { logSessionStart } from './sessionBanner'` alongside the existing main imports.

### 4. Extend the #131 pin (mandatory — typecheck fails otherwise)

The three version fields are **main-only**. Adding them to `DiagnosticEvent` breaks `receiveDiagnostic.test.ts:25`. Extend the `Omit` union:

```
Equals<RendererDiagnosticEvent, Omit<DiagnosticEvent, 'safeBytes' | 'appVersion' | 'noiseProtocol' | 'protocolVersion'>>
```

Extend the explanatory comment (lines 14-22) to name the version fields as main-only additions, the same way #133 documented `safeBytes`. **Do not** touch `RendererDiagnosticEvent` or `projectDiagnosticEvent` in `src/shared/ipc/diagnostics.ts` — the renderer has no reason (and no capability) to emit a version banner; keeping the fields out of the renderer mirror is what preserves the "every field the renderer can send is a canonical allowlisted field" guarantee.

## State + concurrency model

No store, no async, no stream. One synchronous `diagnosticLog.event()` call in the `whenReady` callback. The logger's `seq` counter is single-writer with no `await` in `event()` (`diagnosticLog.ts:121-123`), so emitting the banner first deterministically yields `seq 0`. No teardown, no cancellation — the banner is fire-once at startup.

## Error handling

None to add. `diagnosticLog.event()` never throws (it swallows sink failures — `diagnosticLog.ts:133-139`). `app.getVersion()` and the two wire constants are always present (baked at build time). There is no untrusted input and no failure branch.

## Testing strategy

New test `src/main/sessionBanner.test.ts` (vitest, `npm test`). Bullet-pointed scenarios — the developer writes the assertions in the project idiom:

- **(a) exactly one banner record at startup.** Wire a **real** `createDiagnosticLog` over a capture array (`sink: { write: (line) => lines.push(line) }`, mirroring `receiveDiagnostic.test.ts:66`); call `logSessionStart(log, '9.9.9-test')`; assert `lines.length === 1`. Going through the real logger also exercises the `{ ...fields }` spread — the same foot-gun the #131 end-to-end test guards.
- **(b) carries the expected values.** `JSON.parse(lines[0])` has `event: 'session-start'`, `appVersion: '9.9.9-test'`, `noiseProtocol` **equal to the imported `NOISE_PROTOCOL`** (assert against the imported constant, not a retyped literal — proves "reused verbatim"), and `protocolVersion` equal to the imported `PROTOCOL_VERSION`.
- **(c) no field beyond the allowlisted version fields.** Assert the parsed record's keys are exactly `{ event, appVersion, noiseProtocol, protocolVersion, seq, ts }` — nothing secret-shaped. A fake-logger variant (`{ event: vi.fn() }`) can additionally assert `event` was called once with exactly the four-field object (no `seq`/`ts` noise), pinning "no extra field" at the call boundary.
- Use a synthetic version string (`'9.9.9-test'`), never the current `0.1.0` from `package.json` — the value must be shown to flow through `logSessionStart`'s parameter, not be a coincidence.

The existing `src/main/receiveDiagnostic.test.ts` continues to compile only after the `Omit` union is extended — that compile-time pin *is* the test that the renderer mirror stays in sync (no runtime assertion needed for it).

## Open questions

- **Field count.** Three fields is the recommendation (§ Design 1). If review prefers the minimal two (`appVersion` + `noiseProtocol`), drop `protocolVersion` from all four sites (allowlist, helper record, Omit union, test) — but note the v1/v2-disambiguation gap that leaves. No other design change.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The banner is emitted from the composition root (trusted main process) with no untrusted input flowing in — the three values are two compile-time constants and `app.getVersion()` (baked at build time), none user-controlled. No new untrusted→trusted path is created. The fields are deliberately kept out of `RendererDiagnosticEvent`/`projectDiagnosticEvent` (main-only), so the renderer gains no new capability; the extended `Omit` pin is the deterministic net that keeps that true (`receiveDiagnostic.test.ts:25`).
- **[Tokens, secrets, credentials]** No findings. The banner carries no token, key, or credential. The values are `'Noise_IK_25519_ChaChaPoly_BLAKE2s'`, `'v2'`, and a semver string — all static, non-secret, safe to log by design (this is Bucket-1 content-free attribution data).
- **[Error messages, logs, telemetry]** No findings. This is the log, and every field is MUST-log-safe (event type + version attribution). No message body, key, token, or Noise transcript. The structural guarantee is preserved: the three additions are named `string` fields, not a `Record`/`unknown`/index signature, so the allowlist still cannot carry a secret-shaped value. Emitted once per session, not per line (AC3). SHOULD-FIX-flavored design constraint (not gating): the developer must **not** add the version fields to the renderer projection — if they did, a compromised renderer could send a `≤128-char` string in a version field, but the renderer holds no secret to put there (CLAUDE.md) and the value is length-capped, so blast radius is bounded log-line noise, not exfiltration. The correct main-only design (via the `Omit` extension) is spelled out in § Design 4; code-review verifies `diagnostics.ts` is untouched.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, `contextBridge` API, or `BrowserWindow` config. The helper is Electron-free (`app.getVersion()` is injected as a parameter), so no Electron surface is widened.
- **[Concurrency]** No findings. One synchronous `event()` call in `whenReady`, before the transport starts; the `seq` counter is single-writer with no `await` (`diagnosticLog.ts:121-123`). No async task, timer, listener, or race is introduced.
- **[File / storage operations]** N/A — no filesystem path is constructed or opened. The record lands via the already-existing injected sink (`diagnosticLog.ts:133`).
- **[Cryptographic primitives]** N/A — no crypto, RNG, key, or nonce is touched. `NOISE_PROTOCOL` is referenced only as an attribution string, not used to drive a handshake.
- **[Network & I/O]** N/A — no socket, WebSocket, URL, or frame is read or written. The Noise variant appears only as a logged label.
- **[Threat model alignment]** N/A — no wire-protocol behaviour changes; the daemon, relay, and handshake are untouched. This is observability metadata emitted locally at startup.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
