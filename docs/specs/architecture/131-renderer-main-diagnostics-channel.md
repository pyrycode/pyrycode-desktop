# Spec — #131 Content-free renderer→main diagnostics log channel

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/131
**Size:** S · **Labels:** security-sensitive · **Figma:** N/A (pure IPC plumbing, no UI surface)
**Blocks:** #134 (state-store transition logging — the first consumer; not wired here)

---

## Files to read first

| Path (lines) | What to extract |
| --- | --- |
| `src/shared/ipc/commands.ts` (all, ~72) | **The exact pattern to mirror.** An *untrusted-renderer* channel module: channel constant + renderer-safe record type + runtime boundary guard, co-located, imported by both sides via relative path. `isRendererCommand`'s "structural minimum, accepts extra fields" is the behaviour you must **deviate from** (see Design §3). |
| `src/main/receiveCommand.ts` (all, 42) | The main-side receiver pattern `onDiagnostic` mirrors: `CommandSource` structural stand-in for `ipcMain`, register-and-return-unsubscribe, boundary validation, fixed-string warn on drop, IpcMainEvent first-arg stripped. |
| `src/main/diagnosticLog.ts:20-60` | The canonical `DiagnosticEvent` allowlist (the 8 content-free fields) and the load-bearing `event()` **spread** `{ ...fields, seq, ts }` at line 87. This spread is *why* the handler must project, not forward raw. Also `DiagnosticLog` — the interface `onDiagnostic` forwards into. |
| `src/main/diagnosticLog.ts:73-102` | `createDiagnosticLog` factory + the swallow-on-sink-throw block (the AC3 "must not crash what it observes" precedent). Reused verbatim by the end-to-end AC4 test. |
| `src/main/index.ts:147-162` | Where the ONE `diagnosticLog` instance is constructed at the composition root. Your registration reuses **this** instance — do not build a second. |
| `src/main/index.ts:192-206` | The `onCommand` registration + `will-quit` teardown idiom. Your `onDiagnostic(ipcMain, diagnosticLog)` registration sits beside it, same shape. |
| `src/preload/index.ts:15-24, 78` | Where `sendCommand` lives inside the `api` object, and `export type PyryApi = typeof api`. Add `sendDiagnostic` beside `sendCommand`; the method's type auto-derives — **no `index.d.ts` edit** (confirmed: `index.d.ts` is just `PyryApi = typeof api`). |
| `src/main/receiveCommand.test.ts` (all, 63) | Test idiom to mirror: `fakeSource()` (`{ on: vi.fn(), removeListener: vi.fn() }`), listener extraction from `source.on.mock.calls[0][1]`, forward/strip-event/drop/unsubscribe assertions. |
| `src/shared/ipc/commands.test.ts:34-85` | Guard-test idiom. Note the divergence: commands *accept* an extra harmless field; the diagnostics projection must *drop* it from its output. |
| `src/shared/ipc/events.ts:1-20` | Header doc-comment density and the `CHANNEL = '…' as const` idiom for a `shared/ipc` module. Match the comment style. |
| `CLAUDE.md` | Invariants: renderer holds no keys/tokens/plaintext; sealed shapes on a `type` field; keep the transport (and secrets) out of the window. |

---

## Context

The content-free logger (#126, merged) lives in the main process. Bucket 1 of the Diagnostics design wants "state-store transitions and interface errors" in the one-click debug bundle — and both happen in the **renderer**, which is sandboxed and cannot call the main-process logger directly. This ticket adds the missing seam: a one-way renderer→main IPC channel that carries the same allowlisted, content-free record the #126 logger already enforces, re-validated at the untrusted→trusted boundary before it reaches the logger.

The channel ships with its own tests and a test emitter only. The first real consumer (store-transition logging) is #134.

The security contract is the whole point of the ticket: the renderer holds no keys, tokens, or plaintext (CLAUDE.md invariant), so it cannot forward a secret it never receives — and the boundary projection keeps that true even if the renderer is buggy or compromised.

---

## Design

Four files. Two new (a shared channel module + a main receiver), two one-line-ish edits (preload method + composition-root registration). The shape is a faithful copy of the existing **command** channel (`commands.ts` → `receiveCommand.ts` → `index.ts`), with one deliberate deviation forced by the #126 logger's spread (§3).

### Data flow (one-way)

```
renderer  window.pyry.sendDiagnostic(record)
   → preload  ipcRenderer.send(DIAGNOSTIC_CHANNEL, record)     // fire-and-forget, returns void
   → main     ipcMain.on(DIAGNOSTIC_CHANNEL)  →  onDiagnostic listener
   → main     projectDiagnosticEvent(raw)  →  fresh allowlisted object | null
   → main     diagnosticLog.event(projected)                   // the SAME #126 instance
   → sink     one JSON line
```

Nothing returns to the renderer. No reply, no throw path across the bridge.

### 1. `src/shared/ipc/diagnostics.ts` (NEW) — channel constant, record type, projection

Mirrors `commands.ts`. Exports:

- `export const DIAGNOSTIC_CHANNEL = 'pyry:diagnostic' as const` — the single source of truth both sides reference (a drift silently drops every record, exactly as the command/event channels warn).

- `export interface RendererDiagnosticEvent { … }` — a **field-for-field mirror** of #126's `DiagnosticEvent` (`event: string` required; `code?/status?/bytes?/count?/host?/path?/hash?` optional, same primitive types). Defined locally in shared because that is the established convention: `commands.ts` and `events.ts` each *define* their record type in `shared/ipc` and never reach into `src/main` — `src/shared` is a clean leaf (verified). The mirror is pinned to the canonical type by a compile-time assertion in the test (§ Testing), so a future field added to #126's `DiagnosticEvent` (correlation-id, etc. — #125 roadmap) surfaces as a `npm run typecheck` failure rather than a silent capability gap.

- `export function projectDiagnosticEvent(value: unknown): RendererDiagnosticEvent | null` — the deterministic boundary safety net (AC2). **Validate + project in one pass**, returning a **freshly built object literal** containing only allowlisted fields — never `value` itself. Contract:
  - `event`: required. If not a non-empty `string` → return `null` (nothing to log).
  - each optional field: copied into the output **only if present and the correct primitive type** (`code`/`host`/`path`/`hash`: `string`; `status`/`bytes`/`count`: finite `number`). A wrong-typed optional field is **omitted, not fatal** — a bogus `status` must not discard an otherwise-valid `event`.
  - a field **not named in the allowlist is never copied** — it is structurally absent from the output because the projection enumerates field names (an allowlist / fail-closed, not a denylist scrub / fail-open — matches #126's own stance).
  - each copied `string` field is truncated to a fixed cap (**128 chars** — safe headroom; the longest legitimate field is a 64-hex-char BLAKE2s hash). This bounds a compromised renderer's ability to bloat the log line / debug bundle (defense-in-depth; see Security review).

  **Why a single validate+project fn, not a `isRendererDiagnostic` type-guard + forward-raw (the command pattern):** `onCommand` forwards the *validated raw object* to its handler, which is safe there because the handler only reads `command.payload`. Here the handler forwards to `diagnosticLog.event()`, which **spreads its argument** (`{ ...fields, seq, ts }`, `diagnosticLog.ts:87`). Forwarding a raw renderer object would spread any planted extra field straight onto the log line. Returning a fresh object from a single function makes "forgot to project, forwarded raw" **structurally impossible** — the function has no code path that returns the input. This is the load-bearing reason AC2/AC4 exist.

### 2. `src/main/receiveDiagnostic.ts` (NEW) — the boundary receiver

Mirrors `receiveCommand.ts`. Exports:

- `export interface DiagnosticSource { on(channel, listener): void; removeListener(channel, listener): void }` — the minimal main surface; Electron's `ipcMain` satisfies it structurally, the unit test passes `{ on: vi.fn(), removeListener: vi.fn() }`. Defined locally (parallel to `CommandSource`) rather than imported, to keep the two receivers decoupled.

- `export function onDiagnostic(source: DiagnosticSource, logger: DiagnosticLog): () => void` — registers one `source.on(DIAGNOSTIC_CHANNEL, listener)`, returns an unsubscribe that removes the exact listener. The listener:
  - strips the `IpcMainEvent` first arg (never forwarded — it exposes `.sender`/`.ports`, a capability leak),
  - runs `projectDiagnosticEvent(raw)`; forwards to `logger.event(projected)` **only if non-null**; on `null`, drops with a **fixed-string** `console.warn` carrying **no renderer data** (parity with `onCommand`),
  - wraps its body in `try { … } catch { /* swallow */ }` so no projection/forwarding failure escapes (AC3). `logger.event` already swallows sink throws internally (#126); this is the belt-and-suspenders outer net.

  `logger` is typed `DiagnosticLog` (imported from `./diagnosticLog` — main→main, fine). The receiver never constructs a logger; it forwards to the injected one.

### 3. `src/preload/index.ts` (MODIFY) — expose `sendDiagnostic`

Add to the `api` object beside `sendCommand`:

- `sendDiagnostic: (record: RendererDiagnosticEvent): void => ipcRenderer.send(DIAGNOSTIC_CHANNEL, record)` — fire-and-forget, returns void (one-way, AC3), `DIAGNOSTIC_CHANNEL` fixed here so the renderer cannot address arbitrary IPC channels, `ipcRenderer` never crosses the bridge. Import `{ DIAGNOSTIC_CHANNEL, type RendererDiagnosticEvent } from '../shared/ipc/diagnostics'`.

The typed `record` param is the **compile-time ergonomic** half of the allowlist (AC1) — it makes the correct call obvious at #134's call site. It is *erased at runtime*; `projectDiagnosticEvent` is the deterministic half that actually enforces it, because the renderer is untrusted at the IPC boundary regardless of the TS type (belt-and-suspenders: stochastic/ergonomic type + deterministic runtime projection = different fabric). `PyryApi = typeof api` auto-derives the method's type — **no `preload/index.d.ts` edit**.

### 4. `src/main/index.ts` (MODIFY) — one registration at the composition root

After the existing `diagnosticLog` construction (`index.ts:152`) and beside the `onCommand` registration (`:199`):

- `import { onDiagnostic } from './receiveDiagnostic'`
- `const unregisterDiagnostics = onDiagnostic(ipcMain, diagnosticLog)` — reusing the **same** `diagnosticLog` instance already injected into `createDaemonConnection` (do NOT build a second logger — one `seq` counter, one file).
- `app.on('will-quit', () => unregisterDiagnostics())` — symmetric teardown, matching `unregisterCommands`.

Registered once, held for the app lifetime. Inert until #134 emits — a record arriving before any consumer is simply a logged line; no gating needed.

---

## Error handling / failure modes

| Failure | Behaviour | AC |
| --- | --- | --- |
| Malformed record / `event` missing (projection → `null`) | dropped, fixed-string warn (no renderer data), nothing logged | AC2 |
| Non-allowlisted field (planted secret) present | never copied into the fresh projected object → never spread onto the log line | AC2, AC4 |
| Wrong-typed optional field (e.g. `status: "x"`) | that field omitted; the valid `event` still projects | AC2 |
| Over-long string field | truncated to 128 chars before logging | (defense-in-depth) |
| `logger.event` throws | swallowed by the listener's outer try/catch; renderer unaffected | AC3 |
| Renderer's view | `sendDiagnostic` returns void, no reply, no throw across the bridge | AC3 |

---

## Testing strategy

`npm test` (vitest, fakes not mocks) + `npm run typecheck` (the type-pin below is a typecheck-gate assertion). Scenarios (developer writes the bodies in the project idiom):

### `src/shared/ipc/diagnostics.test.ts` (pure — no Electron)
- pins `DIAGNOSTIC_CHANNEL === 'pyry:diagnostic'`.
- `projectDiagnosticEvent` accepts a well-formed record and returns an object **equal in allowlisted fields but not the same reference** as the input (proves projection, not pass-through).
- **planted-secret, pure layer (AC4):** input `{ event: 'store-transition', code: 'ok', token: 'SUPER_SECRET', text: 'plaintext' }` → output keys ⊆ allowlist, no `token`/`text`; `JSON.stringify(output)` contains neither `'SUPER_SECRET'` nor `'plaintext'`.
- drops non-allowlisted fields while retaining allowlisted ones.
- `event` missing / empty-string / non-string → returns `null`.
- wrong-typed optional (`status: 'x'`, `host: 42`) → that field omitted; valid `event` still projects.
- over-long `event` (> 128 chars) → truncated in the output.
- **type-pin (compile-time, AC "single allowlist"):** a type-level equality assertion between `RendererDiagnosticEvent` and `import type { DiagnosticEvent } from '../../main/diagnosticLog'` (test-space may cross the boundary, as `receiveCommand.test.ts` imports across it). A drift in either direction fails `npm run typecheck`. This is the deterministic net that lets the security audit trust ONE allowlist.

### `src/main/receiveDiagnostic.test.ts` (fakeSource idiom)
- registers exactly one listener on `DIAGNOSTIC_CHANNEL`.
- forwards the **projected** record to `logger.event`, with the `IpcMainEvent` first arg stripped (assert `logger.event` called with one arg).
- **planted-secret, end-to-end (AC4 — load-bearing):** wire `onDiagnostic` to a **real** `createDiagnosticLog` over a capture-array sink (`{ write: (line) => lines.push(line) }`); drive the listener with `{ event: 'x', secret: 'SUPER_SECRET' }`; assert the captured JSON line contains **no** `'SUPER_SECRET'`. This proves the #126 spread foot-gun is closed through the whole path, not just in the pure projection.
- drops a malformed record (null projection) without calling `logger.event`.
- **swallows a throwing logger (AC3):** a `logger` whose `event` throws does not propagate out of the listener.
- unsubscribes the exact listener it registered (mirror `receiveCommand.test.ts`).

---

## Security review

Adversarial self-review of this spec (required — `security-sensitive` label). Threat model: the renderer is **untrusted at the IPC boundary** — assume a compromised or buggy renderer sends arbitrary JSON on `DIAGNOSTIC_CHANNEL`. The main process is trusted.

**Trust boundaries.** The single untrusted→trusted crossing is `ipcMain.on(DIAGNOSTIC_CHANNEL)` in `onDiagnostic` (`receiveDiagnostic.ts`). Everything the renderer sends is `unknown` until `projectDiagnosticEvent` returns. The TS `RendererDiagnosticEvent` type on `sendDiagnostic` is **not** a boundary — it is erased at runtime and provides zero guarantee against a compromised renderer; it is ergonomics only. The enforcement is `projectDiagnosticEvent`, exercised by the end-to-end planted-secret test.

**Secret dataflow.** The renderer holds no keys, tokens, or plaintext (CLAUDE.md; keys/frames never cross to the web layer). So the channel cannot exfiltrate a secret the renderer *has*. The residual risk is a secret the renderer *fabricates or forwards from render-layer state* riding an unexpected field into the debug bundle. This is closed by **projection as an allowlist (fail-closed)**: the output is built by enumerating named fields, so any unnamed field (`token`, `text`, `secret`, `__proto__`, …) is structurally absent from the logged object — it is never reachable by the logger's spread. This is the same guarantee #126 makes for the main-side call sites, extended to the renderer boundary; and it is an allowlist, not a denylist scrubber (which #126 correctly rejects as fail-open).

**Injection / log integrity.** Record fields land in a JSON-lines file via `JSON.stringify` in #126 (`diagnosticLog.ts:92`), which escapes embedded newlines — a renderer-supplied string cannot split one record into two log lines or forge a second record. No additional escaping needed here; the projection's 128-char cap bounds a compromised renderer's ability to bloat a line / the debug bundle (low-severity DoS given the renderer loads only the app's own locked-down bundle, but the cap is deterministic and near-free, so included).

**Fail-open modes checked.** (a) Projection returns a *fresh* object, never the input — no path forwards raw. (b) Wrong-typed optionals are omitted, not passed through untyped. (c) `event` required gates the record. (d) `logger.event` throw and any listener-body throw are swallowed, so a diagnostics fault cannot crash the window it observes (AC3) — but the swallow only hides *faults*, it never *widens* what is logged. (e) The type-pin makes a future #126 allowlist change a build failure, preventing a silent divergence between the audited allowlist and the renderer channel's allowlist.

**Capability leak checked.** The `IpcMainEvent` first arg (`.sender`/`.senderFrame`/`.ports`) is stripped in the listener and never forwarded — identical to `onCommand`. `sendDiagnostic` pins `DIAGNOSTIC_CHANNEL`, so the renderer cannot address arbitrary IPC channels, and `ipcRenderer` itself never crosses the contextBridge.

**Verdict: PASS.** The one-way channel adds no new secret-bearing shape, enforces the #126 allowlist deterministically at the untrusted boundary via fail-closed projection, strips the IPC event capability, and cannot crash its observee. The load-bearing invariant (no raw-forward past the logger's spread) is pinned by the end-to-end planted-secret test.

---

## Open questions

- **String cap length (128).** Sized for the current fields (64-hex hash is the longest). If #134 or a later consumer needs a longer legitimate field, raise the cap there rather than removing it. Non-blocking.
- **Warn-on-drop.** Mirrors `onCommand`'s fixed-string warn. A compromised renderer could spam it; this is cosmetic (no data leaks) and matches the existing channel, so kept for parity. Revisit only if drop-spam is observed.
