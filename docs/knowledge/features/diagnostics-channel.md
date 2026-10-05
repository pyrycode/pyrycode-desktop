# Renderer→main diagnostics channel

The one-way, **content-free diagnostic pipe** from the React window to the background process: the renderer ships an allowlisted record, and the main process re-validates it at the untrusted boundary and forwards only the safe fields to the [#126 content-free logger](diagnostic-log.md). It is the seam that lets **renderer-side** surfaces — the [session store](session-store.md) ([#134](../codebase/134.md)), later the render layer — land in the same one-click debug bundle as the transport logs, **without ever giving the renderer a path to emit a secret**.

Introduced in [#131](../codebase/131.md). It is the renderer→main slice of **Bucket 1** of the Diagnostics design (split from [#125](https://github.com/pyrycode/pyrycode-desktop/issues/125)): the logger ([#126](diagnostic-log.md)) lives in the main process, but Bucket 1's "state-store transitions and interface errors" happen in the sandboxed renderer, which cannot call it directly. This channel shipped the pipe + its tests + a test emitter only, inert until its first consumer; [#134](../codebase/134.md) then wired the session store's `dispatch` choke point as that first real producer (state-store transitions). The render-layer consumer (interface errors) remains deferred.

## What it does

Gives the renderer **one typed function** (`window.pyry.sendDiagnostic`) and the
main process **one receiver** (`onDiagnostic`). Generic records are projected to
the renderer-safe subset of [DiagnosticEvent](diagnostic-log.md) before forwarding
to the same logger the transport uses. Restricted composer lifecycle requests are
projected separately and passed to a main-owned tracker, which constructs the log
records. Fire-and-forget: no reply channel. The receiver swallows faults; composer
and cancellation helpers also guard diagnostic calls so bridge faults cannot
interrupt their actions.

## The one way it diverges from the command channel

This channel is a faithful copy of the [command channel](command-channel.md) (`commands.ts` → `receiveCommand.ts` → `index.ts`) — the same one-way, boundary-validated renderer→main shape — with **one deliberate deviation** forced by the logger's spread:

- `onCommand` validates with a **type guard** (`isRendererCommand`) and forwards the **validated raw object** to its handler. That is safe there because the handler only reads `command.payload`.
- `onDiagnostic` forwards to `logger.event()`, which **spreads its argument** (`{ ...fields, seq, ts }`, [`diagnosticLog.ts:87`](diagnostic-log.md)). Forwarding a raw renderer object would spread any **planted extra field** (`token`, `text`, `__proto__`, …) straight onto the log line.

So instead of guard-then-forward-raw, this channel uses a **single validate+project function** — `projectDiagnosticEvent(value: unknown): RendererDiagnosticEvent | null` — that returns a **freshly built object literal** containing only allowlisted fields, never `value` itself. A function that has no code path returning its input makes "forgot to project, forwarded raw" **structurally impossible**. This is the load-bearing reason the security ACs (AC2/AC4) exist. Do **not** copy the command channel's forward-raw shape here.

## How it works

Four files: two new (a shared channel module + a main receiver), two one-ish-line edits (a preload method + one composition-root registration).

| Piece | File | Layer |
|---|---|---|
| `DIAGNOSTIC_CHANNEL`, generic/lifecycle request types and fresh-object projections | `src/shared/ipc/diagnostics.ts` | shared |
| `onDiagnostic(source, logger, lifecycle?)` receiver seam | `src/main/receiveDiagnostic.ts` | background |
| `window.pyry.sendDiagnostic(record)` | `src/preload/index.ts` | preload bridge |
| the one `onDiagnostic(ipcMain, diagnosticLog, messageLifecycle)` registration | `src/main/index.ts` | composition root |

### 1. The channel module (`src/shared/ipc/diagnostics.ts`)

Mirrors `commands.ts`. Co-locates the three pieces both sides import by **relative** path (`src/main` / `src/preload` have no `@shared` alias — see [command channel § Configuration](command-channel.md)):

```ts
export const DIAGNOSTIC_CHANNEL = 'pyry:diagnostic' as const

export interface RendererDiagnosticEvent {
  event: string   // required — the event name, a static literal ('store-transition')
  code?: string; status?: number; bytes?: number; count?: number
  host?: string; path?: string; hash?: string   // same primitive types as #126's DiagnosticEvent
}

export function projectDiagnosticEvent(value: unknown): RendererDiagnosticEvent | null
```

- **`RendererDiagnosticEvent` mirrors the renderer-safe subset of [DiagnosticEvent](diagnostic-log.md)** — the same envelope fields and primitive types, excluding the main-only fields described below. It is **defined locally in `shared`**, which never imports `src/main`. A compile-time equality assertion in `receiveDiagnostic.test.ts` pins this subset, so a new logger field must be mirrored or deliberately added to the main-only `Omit` list.
  - **[#133](../codebase/133.md) relaxed the pin.** #133 added `safeBytes?: SafeBytesEncoding` to `DiagnosticEvent` — a **branded** `src/main`-only type. It cannot be mirrored here (the brand must not be reachable from `src/shared`, and the renderer holds no frame bytes to send in the first place), so the assertion in `receiveDiagnostic.test.ts` reads `Equals<RendererDiagnosticEvent, Omit<DiagnosticEvent, 'safeBytes'>>` rather than a bare `Equals<RendererDiagnosticEvent, DiagnosticEvent>`. The security-relevant direction — "the renderer cannot invent a field the allowlist doesn't name" — is unaffected; only capability-parity for a field the renderer must never produce is dropped. Any future main-only field added to `DiagnosticEvent` must be either mirrored here or added to that `Omit` list, or the pin fails typecheck.
  - **[#132](../codebase/132.md) extended the `Omit` list a second time**, with three **plain, unbranded** `string` fields: `appVersion?`, `noiseProtocol?`, `protocolVersion?` (the once-per-session version banner). These needed no brand — they're main-only purely because their *source* (`app.getVersion()`, the shared `NOISE_PROTOCOL`/`PROTOCOL_VERSION` constants) is only ever read at the composition root, never the renderer. This established that the `Omit` escape hatch covers provenance restrictions as well as branded types. The current pin also excludes lifecycle correlation fields, as described below.
- **`RendererDiagnosticEvent` is the compile-time ergonomic half of the allowlist.** It makes the correct call obvious at [#134](https://github.com/pyrycode/pyrycode-desktop/issues/134)'s call site. But it is **erased at runtime** and provides **zero** guarantee against a compromised renderer — `projectDiagnosticEvent` is the deterministic half that actually enforces it (belt-and-suspenders: an ergonomic type + a deterministic runtime projection — different fabric).
- **`projectDiagnosticEvent` is the fail-closed boundary safety net.** It validates AND projects in one pass:
  - `event` is **required** — not a non-empty `string` → returns `null` (nothing to log).
  - each optional field is copied **only if present AND the correct primitive type** (`code`/`host`/`path`/`hash` a `string`; `status`/`bytes`/`count` a finite `number`); a wrong-typed optional is **omitted, not fatal** — a bogus `status` must not discard an otherwise-valid `event`.
  - fields are enumerated **by name** — an **allowlist / fail-closed**: a field not named here is structurally absent from the output, never a scrubbed-out denylist entry (which fails open, the posture [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) rejects).
  - each `string` field is truncated to `MAX_STRING_LENGTH = 128` (headroom over the longest legitimate field, a 64-hex-char BLAKE2s hash) — a deterministic bound on a compromised renderer's ability to bloat the log line / debug bundle.

### Restricted message lifecycle requests

[#1721](https://github.com/pyrycode/pyrycode-desktop/issues/1721) adds a separate
`MessageLifecycleDiagnostic` request on the same channel:

```ts
interface MessageLifecycleDiagnostic {
  event: 'message-queued' | 'message-bridge-failed' | 'message-cancel-requested'
  messageId: string
  conversationId: string
}
```

`projectMessageLifecycle` accepts only those three exact event values, a lowercase
UUIDv4 `messageId` (version 4 and valid variant bits), and a nonempty string
`conversationId` of at most 256 characters. It constructs a fresh literal with
only those named fields. Extra content, error strings and planted connection ids
are absent. Conversation ids are held for matching and never serialized.

The receiver reserves every event starting with `message-` before generic
projection. Invalid or unsupported lifecycle events return without logging;
renderer-supplied `message-sent`, `message-acknowledged` or `message-dropped`
cannot fall through to generic forwarding. Valid requests call the optional
tracker's `queued`, `drop(..., 'bridge-failed')` or `cancel` methods. The receiver
never forwards a lifecycle request directly to the logger: only the tracker’s
held, validated local UUID reaches a lifecycle record. Bridge-failure and
cancellation requests require an existing id in the same conversation.

Generic `projectDiagnosticEvent` still excludes `messageId` and `connectionId`.
The compile-time pin in `receiveDiagnostic.test.ts` is now:

```ts
Equals<RendererDiagnosticEvent, Omit<DiagnosticEvent,
  'safeBytes' | 'appVersion' | 'noiseProtocol' | 'protocolVersion' |
  'messageId' | 'connectionId'>>
```

Those two logger fields stay main-only even though a restricted queued request
can admit a composer UUID. Only the relay socket mints `connectionId`; daemon
queue ids are comparison-only. Main binds the held message to its originating
host/conversation and writes the four [lifecycle events](outbound-send-path.md#message-lifecycle-diagnostics).
Queue snapshots acknowledge daemon possession once, never a Claude answer.
Rekey entries carry their own observers until write or discard. Sent without a
matching acknowledgment remains delivery unknown after close. The tracker
silently retires its oldest entry at the 1024-submission cap without a drop claim.

`ConversationScreen` wires `diagnose` to `window.pyry.sendDiagnostic` for both
`submitMessage` and `dropQueuedMessage`. Accepted idle/running submissions request
queued before dispatch; blank, no-conversation and availability refusals do not.
Cancellation requests become a separately deduplicated `message-dropped` record
with fixed `user-cancel-request` code, even if dequeue dispatch fails. Marking that
request as a terminal delivery discard would hide later write/acknowledgment
evidence from a still-buffered message. The tracker therefore permits those later
facts and never claims that cancellation removed the message from the daemon.
Other fixed reasons are `bridge-failed`, `route-refused`, `send-refused`,
`send-failed`, `write-failed`, `rekey-buffer-full`, `rekey-abandoned` and
`rekey-teardown`; none comes from renderer or daemon error text.

### 2. The receiver seam (`src/main/receiveDiagnostic.ts`)

Mirrors `receiveCommand.ts`. **No `electron` import** — the source is injected structurally, so the unit test runs in plain Node:

```ts
export interface DiagnosticSource {
  on(channel: string, listener: (event: unknown, record: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, record: unknown) => void): void
}

export function onDiagnostic(source: DiagnosticSource, logger: DiagnosticLog,
  lifecycle?: MessageLifecycle): () => void
```

The registered listener:

- **strips the `IpcMainEvent` first arg** — never forwarded; it exposes `.sender`/`.senderFrame`/`.ports`, a capability leak (identical to `onCommand`).
- intercepts reserved `message-*` requests as described above; otherwise runs `projectDiagnosticEvent(raw)` and forwards **only if non-null**. A malformed generic record produces a **fixed-string** `console.warn` carrying **no** renderer data.
- wraps its whole body in `try { … } catch { /* swallow */ }` so **no** projection/forwarding failure escapes into the window (AC3). `logger.event` already swallows sink throws internally ([#126](diagnostic-log.md)); this is the belt-and-suspenders outer net. The swallow hides a fault; it never *widens* what is logged.
- returns an **unsubscribe** closure that removes the exact listener it registered (mirrors `onCommand`).

The receiver **never constructs a logger** — it forwards into the injected `DiagnosticLog`.

### 3. The preload sender (`src/preload/index.ts`)

One method added to the `api` object beside `sendCommand`:

```ts
sendDiagnostic: (record: RendererDiagnosticEvent | MessageLifecycleDiagnostic): void => {
  ipcRenderer.send(DIAGNOSTIC_CHANNEL, record)
}
```

Fire-and-forget `send` (not `invoke` — no reply channel a handler could leak back through). `DIAGNOSTIC_CHANNEL` is hardcoded here so the renderer cannot address an arbitrary IPC channel; `ipcRenderer` never crosses the `contextBridge`. `PyryApi = typeof api` auto-derives the method's type onto `window.pyry` — **no `preload/index.d.ts` edit** (it is just `PyryApi = typeof api`).

### 4. The composition-root registration (`src/main/index.ts`)

Beside the `onCommand` registration (`:200`), after the one `diagnosticLog` is constructed (`:153`):

```ts
const unregisterDiagnostics = onDiagnostic(ipcMain, diagnosticLog, messageLifecycle)
app.on('will-quit', () => unregisterDiagnostics())
```

Reuses the **same** `diagnosticLog` and main-owned `messageLifecycle` instances
injected into every host's daemon connection. Registered once for the app lifetime,
torn down symmetrically on `will-quit`. A second logger would split sequence/file
correlation; a second tracker would lose host-bound acknowledgment matching.

### Data flow (one-way)

```
 renderer (#134)           diagnostics.ts          preload bridge              receiveDiagnostic          #126 logger
 store transition ───────► RendererDiagnosticEvent ─► window.pyry.sendDiagnostic ─► onDiagnostic listener ─► diagnosticLog.event
   (allowlisted record)    (compile-time allowlist)   ipcRenderer.send ──IPC──►  strip event,             (SAME instance,
                                                       DIAGNOSTIC_CHANNEL          projectDiagnosticEvent ✓  one seq, one file)
                                                                                  fresh allowlisted obj │ null
```

`sendDiagnostic` is the single outbound choke point; `onDiagnostic` is the single
inbound seam. The diagram shows generic records; lifecycle requests take the
reserved projection → tracker → logger branch. Fresh objects guard both routes
before the logger's spread. Nothing returns to the renderer.

## Edge cases and limitations

- **Single registration is the composition root's contract.** `onDiagnostic` returns an unsubscribe (exact-listener `removeListener`); registering it **once** and tearing it down is the caller's job. Registering twice would double-log every record.
- **A malformed record is dropped, never fatal.** Missing/empty/non-string `event`, a null/non-object value → `null` → a fixed-string warn, nothing logged. A wrong-typed optional field is omitted while the valid `event` still projects.
- **The allowlist must grow with #126's in lockstep — pinned, not hoped.** If a later consumer needs a new safe field that the renderer *can* produce, add it to **both** [#126's `DiagnosticEvent`](diagnostic-log.md) **and** `RendererDiagnosticEvent`; the compile-time type-pin turns a one-sided drift into a `typecheck` failure. A field that is structurally main-only (like [#133](../codebase/133.md)'s branded `safeBytes?`) instead goes on the pin's `Omit` list — see § *The one way it diverges from the command channel* above.
- **String cap is 128.** Sized for the current fields (64-hex hash is the longest). [#134](../codebase/134.md) fit within it (`code` is a `SessionAction['type']` string, well under the cap); a later consumer needing a longer legitimate field should raise the cap deliberately, not remove it.

## Security posture

**Verdict: PASS** (architect self-review + independent code-review, `security-sensitive`; see [#131 codebase notes](../codebase/131.md)). Threat model: the renderer is **untrusted at the IPC boundary** — assume a compromised or buggy renderer sends arbitrary JSON on `DIAGNOSTIC_CHANNEL`.

- **The single untrusted→trusted crossing is `ipcMain.on(DIAGNOSTIC_CHANNEL)` in `onDiagnostic`.** Everything is `unknown` until its generic or lifecycle projection returns. Both request types are erased at runtime; the TypeScript signatures are ergonomics only.
- **Projection excludes content fields.** Keys and raw transport frames never cross to the renderer ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)), but composer text and rendered daemon content do live there. Any unnamed field (`token`, `text`, `secret`, `__proto__`, …) is structurally absent from the fresh projected object and cannot ride the logger's spread. Generic fields still require static/client-owned values at producer sites; lifecycle requests additionally validate exact events and UUID shape, and main emits held ids with fixed reasons. This extends [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s allowlist enforcement to the renderer boundary.
- **The `event()` spread foot-gun is closed structurally, not by discipline.** `projectDiagnosticEvent` returns a fresh object with no path that returns the input; the **end-to-end planted-secret test** drives the listener with `{ event: 'x', secret: 'SUPER_SECRET' }` through a **real** `createDiagnosticLog` over a capture sink and asserts the serialized JSON line contains no secret — proving the guarantee through the whole path, past the spread, not just in the pure layer.
- **Capability leak checked.** The `IpcMainEvent` first arg is stripped; `sendDiagnostic` pins `DIAGNOSTIC_CHANNEL` so the renderer cannot address arbitrary IPC channels; `ipcRenderer` never crosses the bridge.
- **Log integrity.** Fields land in a JSON-lines file via `JSON.stringify` in [#126](diagnostic-log.md), which escapes embedded newlines — a renderer-supplied string cannot split one record into two lines. The 128-char cap bounds a compromised renderer's line-bloat (low-severity, deterministic, near-free).
- **Cannot crash its observee (AC3).** A throwing `logger.event`, and any listener-body throw, are swallowed; `sendDiagnostic` returns void with no throw path back across the bridge.

## Related

- [Message lifecycle verification](development-verification.md#message-lifecycle-diagnostics) — real-serializer hostile-field checks and the production renderer-to-sink Playwright regression.
- [Content-free diagnostic log](diagnostic-log.md) / [#126](../codebase/126.md) — the logger this channel feeds; the `DiagnosticEvent` allowlist `RendererDiagnosticEvent` mirrors and the `event()` spread that forces the project-not-forward-raw deviation. The renderer boundary is a **new** producer for the same single instance the transport legs ([#127](../codebase/127.md)/[#128](../codebase/128.md)) and the [decode boundary](inbound-message-decode.md) ([#130](../codebase/130.md)) write to.
- [Session store](session-store.md) / [#134 codebase notes](../codebase/134.md) — the first real consumer: an optional `dispatch`-level observer that emits one content-free `store-transition` record per action.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the one-way, boundary-validated renderer→main pattern this copies end-to-end; read for the shared conventions and the trust-boundary contrast. The **one** divergence (project-not-guard) is documented above.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md) — allowlist the envelope, enforced by the type, never a runtime scrubber. This channel extends that fail-closed enforcement to the **untrusted renderer boundary** via `projectDiagnosticEvent`.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) — keys/bytes never reach the renderer; the invariant that makes "the renderer cannot forward a secret it never receives" true.
- [#131 codebase notes](../codebase/131.md) · Spec: `docs/specs/architecture/131-renderer-main-diagnostics-channel.md` · Parent: [#125](https://github.com/pyrycode/pyrycode-desktop/issues/125) (Bucket-1 diagnostics split into #130/#131/#132/#133/#134). First consumer: [#134](../codebase/134.md) (state-store transition logging, shipped).
