# #513 — a rejected pairing IPC invoke must not wedge the screen

**Size:** XS · **Labels:** `bug`, `security-sensitive`

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/pairing/pairingState.ts:98-130` | `PairingBridge` + the two effect-runners. **This is the only production file you change.** Note the current shape: bare `await`, no `try`, and a doc comment at `:109-113` that asserts the no-catch assumption. |
| `src/renderer/src/screens/conversation/unpairAction.ts:51-68` | **The catch posture to copy.** `try` wraps *only* the invoke; the result branch stays outside; the catch body is bare (`catch {` — no binding, nothing logged) and returns the same outcome as a domain error. Mirror this exactly. |
| `src/renderer/src/screens/pairing/pairingState.test.ts:97-153` | The existing `runSubmit` / `runConfirm` describe blocks. Your two new tests are siblings inside these blocks; reuse the `PairingBridge` fake shape verbatim. |
| `src/renderer/src/screens/pairing/PairingScreen.test.tsx:14-41` | The `renderView` helper and the existing `not.toContain('disabled')` assertion at `:37-41` — proof that `renderToStaticMarkup` omits the attribute when `disabled={false}`. AC4's test is a sibling of that one. |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:94-119` | `EntryCard`: `disabled={busy}` on the textarea (`:99`) and on Cancel (`:108`), and the inline error `<p role="alert">` at `:102-106`. This is what AC4 asserts against. **No change here.** |
| `src/shared/ipc/pairing.ts:45-62` | The closed 5-member `PairingErrorReason` set and the two response types. `malformed-request` is the member you reuse. **Do not add a member.** |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:174-194` | The container's `void run….then(dispatch)` call sites — read them to confirm they need **no** edit once the runners stop rejecting. |

Everything else in the ticket body's verification block is already discharged — do not re-run the premise check.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-54

Node `19-54` ("Paste Code Dialog") is a rounded surface-container card: headline "Paste pairing code", a body line with the `pyry pair --print` mono accent, a bordered 96px paste field with the `pyry://home.lan:7117?token=…` placeholder, and a right-aligned `Cancel` / `Pair` text-button pair. Verified against the rendered node — it is already implemented by `EntryCard`, and **this ticket adds no chrome**: the inline error line (`PairingScreen.tsx:102-106`) is a desktop-only element with no Figma counterpart, and the fix only changes *which already-designed state* the screen lands in after a failure. No token, spacing, or typography change.

## Context

`runSubmit` / `runConfirm` map only the typed `{ok:false}` domain outcomes. A *rejected* invoke is unhandled: the container fires `void runSubmit(target, paste).then(dispatch)` (`PairingScreen.tsx:184`, `:190`) with no `.catch`, so no `PairingEvent` is dispatched, the reducer sits in `submitting` / `confirming` forever, and `busy` disables the textarea, the primary action **and Cancel** — no recovery short of restarting the app, plus an unhandled rejection.

The rejection surface is infrastructure-level, not domain-level: the main handler is deliberately hardened so no domain path throws (`pairingHandler.ts:74-77`, `:98-109`). What is left is a handler absent or already unregistered (`index.ts:217` on `will-quit`), an invoke racing registration, or a non-serializable reply. That is the same class `runUnpair` (`unpairAction.ts:53-59`) and `App.tsx:77-79` already coerce. Pairing is the one screen that does not — this closes an asymmetry, it does not add a speculative guard.

## Design

### Seam: the two effect-runners, not the container

The fix lands in `pairingState.ts` — the pure, React-free, `node`-env module that is this screen's tested seam. `PairingScreen.tsx` is untested glue (render-smoke only); a `.catch` there would put the behaviour in a layer no test can drive. This also matches `runUnpair`, which is the named precedent and lives at the same altitude.

Consequence: **`PairingScreen.tsx` is not edited at all.** The runners' signatures and return type are unchanged (`Promise<PairingEvent>`) — they simply stop rejecting. The single production consumer needs no migration.

### Contract change

Both runners gain a total-function guarantee:

```
runSubmit(bridge, paste): Promise<PairingEvent>   // never rejects
runConfirm(bridge):       Promise<PairingEvent>   // never rejects
```

A rejected (or synchronously throwing) bridge call resolves to the failure event for that phase, carrying the existing reason `malformed-request`:

- `runSubmit`  → `{ type: 'submit-failed', reason: 'malformed-request' }`
- `runConfirm` → `{ type: 'confirm-failed', reason: 'malformed-request' }`

### Two load-bearing details

**1. The `try` wraps only the bridge call.** Follow `unpairAction.ts:52-59` precisely: declare the response, `try { response = await bridge.…(…) } catch { return <failure event> }`, then do the `response.ok` branch *outside* the try. Wrapping the whole body would silently coerce a bug in the mapping (e.g. a fake resolving `undefined`, so `response.ok` throws) into a user-visible "try again" — masking a contract violation as an infrastructure hiccup. Keeping the call inside the `try` (rather than only the `await`) also covers a bridge that throws synchronously.

**2. The catch binds nothing.** Write `catch {`, not `catch (error) {`. Nothing is logged and nothing is inspected. See § Error handling for why the `console.error` precedent elsewhere in the renderer deliberately does not apply here.

### Reason choice

`malformed-request` — an existing member of the closed 5-member `PairingErrorReason` union (`src/shared/ipc/pairing.ts:45-50`). Its copy, "Something went wrong sending the code. Try again." (`PairingScreen.tsx:31`), reads correctly for an infrastructure failure and is value-free. **Do not add a union member**: `PairingErrorReason` is the shared IPC contract with main-side fan-out (`pairingHandler.ts` maps onto it), so growing it is an out-of-scope contract change.

Deliberate property: the coerced event is **byte-identical** to the domain `malformed-request` event the handler's own guard produces. Indistinguishability is the point — the renderer learns "the send failed, retry", and nothing more granular. No new category, no new copy, no new branch anywhere downstream.

### Recovery path (why this actually unwedges the screen)

The reducer already accepts `cancel` from any phase (`pairingState.ts:91-92`) — the reducer was never the trap. The trap is the **view**: `busy` disables Cancel itself. So the fix has to move the reducer out of `submitting` / `confirming`, which the coerced failure event does via the existing arms (`:77-80`, `:87-90`) → `editing`, paste preserved, `error` set. In `editing` with a non-empty paste, `busy` is `false` and `paste.trim() !== ''`, so **no control in `EntryCard` renders `disabled`** and the inline error line appears. One-click retry, no restart.

No reducer arm changes. No view change. No new state, no new event.

### Doc comments

`pairingState.ts:109-113` currently ends with "…so there is no catch." That sentence becomes false and must be corrected in the same commit — state that domain outcomes arrive as typed responses while a *rejected* invoke (handler absent / unregistered / racing registration) is coerced to `submit-failed` with `malformed-request`, and that the caught value is deliberately discarded. Add the symmetric sentence to `runConfirm`'s comment (`:121-124`), which makes no false claim today but must document the same guarantee.

## State + concurrency model

Unchanged. Both runners remain one-shot, awaited from a user-interaction handler; there is no `useEffect`, no subscription, no timer, no `AbortController`. In-flight re-entrancy is still blocked at the view (`disabled={busy}` on the primary action). A dispatch after unmount remains a harmless React-18 no-op. The change strictly *adds* a terminating path to a promise that previously could end in an unhandled rejection — it removes a leak rather than creating one.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| Bridge (`ipcRenderer.invoke`) | Domain outcome | Typed `{ok:false, reason}` → mapped as today |
| Bridge (`ipcRenderer.invoke`) | Rejection / sync throw | Caught in the runner → `*-failed` + `malformed-request` |
| Runner mapping (`response.ok`) | Malformed response object | **Still throws** — outside the `try` by design (see above) |
| View | Any of the above failure events | `editing` + inline `role="alert"` copy, all controls enabled |

**Nothing is logged.** The renderer has two postures for a swallowed bridge failure: bare `catch {}` (`unpairAction.ts:55`) and `console.error('…', error)` (`composerSend.ts:62`, `sendInterrupt.ts:33`, `dropQueuedMessage.ts:38`, `requestScreenSnapshot.ts:46`). Take the bare one, for three reasons:

1. It is the posture of the **named sibling** — same helper altitude, same "coerce a rejected invoke" shape.
2. `pairingState.ts` is the module whose `paste` field "embeds the token… the only field that transitively holds a secret" (`:20-25`), and the module has zero logging today. `clearPairingScopedState.ts:64` sets the local precedent for *deliberately* logging nothing on a pairing-scoped path.
3. AC3 requires the caught value never reach the UI; not binding it at all makes that structural rather than a reviewer's promise, and keeps an Electron-serialized main-process error (message + stack) out of the renderer DevTools console.

The `console.error` sites are all conversation-screen helpers whose bridge calls carry no secret argument — the discriminator is the argument, not the layer.

## Testing strategy

All in the existing `node` vitest environment; no new dependency, no DOM harness (`vitest.config.ts:27` is `environment: 'node'`; there is no `jsdom` / `happy-dom` / `@testing-library`). Any AC phrased as "click Cancel" would be unimplementable here — AC4 is a static-markup assertion instead.

**`pairingState.test.ts` — add to the existing `runSubmit` describe:**

- A bridge whose `submitPairingPaste` returns a rejected promise → `await runSubmit(bridge, 'pyry://x')` **resolves**, and the resolved value `toEqual` the exact literal `{ type: 'submit-failed', reason: 'malformed-request' }`. The `toEqual`-against-an-exact-literal is AC3's proof: any message / stack / cause riding along fails the assertion. Reject with a value that would be obvious if it leaked (e.g. `new Error('boom')`).
- The same, one describe down, for `confirmPairing` → `{ type: 'confirm-failed', reason: 'malformed-request' }`.
- One test pinning the `try` placement: a bridge method that throws **synchronously** (`vi.fn(() => { throw new Error('sync') })`) resolves to the same event. This is what fails if someone later hoists the call out of the `try`.

**`PairingScreen.test.tsx` — add to the existing `PairingView` describe:**

- Render `{ phase: 'editing', paste: 'pyry://x', error: 'malformed-request' }` through the existing `renderView` helper and assert the markup (a) does **not** contain `disabled` — which covers Cancel, the textarea and Pair in one assertion, exactly as the existing `:37-41` test does — and (b) does contain the mapped copy `'Something went wrong sending the code.'`

**Mutation check (record the numbers in the PR body):** reverting the `runSubmit` catch should fail exactly the two `runSubmit` rejection tests (the async one and the sync-throw one); reverting the `runConfirm` catch should fail the one `runConfirm` rejection test. Reverting both fails three. The `PairingView` test is a state-level assertion and stays green under either revert — that is expected, it pins the recovery affordance, not the catch.

**Gates:** the existing suite stays green and `npm run build` (typecheck + build) passes. There is no `lint` script.

## Open questions

None. The premise is verified and discharged in the ticket body; the seam, the reason, and the logging posture are all settled above.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This change adds no boundary crossing. The renderer→main boundary is unchanged (`isPairingRequest` at `src/shared/ipc/pairing.ts:73-87` still guards every request in main), and the main→renderer direction gains *less* trusted data, not more: the caught rejection — the one value in this flow that originates outside the typed response contract — is discarded unbound and never becomes renderer state. The coerced event is constructed entirely from module-local literals.
- **[Tokens, secrets, credentials]** No findings, and one property worth pinning for code-review. `paste` transitively holds the pairing token (`pairingState.ts:20-25`). The fix does not move it, copy it, widen its scope, or place it in any new value: the `catch` returns an object literal containing only `type` and `reason`. Critically, **`paste` must not appear in the catch's return value** — the reducer already preserves it from the pre-existing `submitting` state (`:77-80`), so there is no reason to thread it through the event, and doing so would put the token on a new path. The spec's exact-literal `toEqual` in AC3 is the deterministic guard against that.
- **[File / storage operations]** Not applicable by design decision. This is a renderer-only, in-memory change: no path is constructed, no file read or written, nothing is persisted. Persistence for this flow lives entirely in main behind `confirmPairing` (#53/#54) and is untouched.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` method, `ipcMain.handle` registration, protocol handler, or `webPreferences` value is added or altered. The preload surface (`src/preload/index.ts:51-52`, `:59-60`) keeps its fixed-channel discipline and still never crosses `ipcRenderer`. The change is confined to how the renderer *interprets a rejected promise it already receives*. One adversarial case considered and dismissed: a compromised/racing main process cannot use the new path to widen renderer state, because the failure event does not carry any attacker-influenced field — a hostile rejection value and a benign one produce the identical event.
- **[Cryptographic primitives]** Not applicable by design decision. No randomness, hashing, key handling, comparison, or Noise-adjacent code is touched. The `fingerprint` (a hash) is only handled on the success path, which is unchanged.
- **[Network & I/O]** Not applicable by design decision. No socket, no WebSocket frame, no relay URL, no timeout, no reconnect logic. `ipcRenderer.invoke` is a local in-process call, not a network hop.
- **[Error messages, logs, telemetry]** No findings — this is the category the design actively hardens. The catch binds nothing and logs nothing, so an Electron-serialized main-process `Error` (message + stack, and with it any internal state or path it happens to name) never reaches the renderer DevTools console, renderer state, or the UI. The user-facing string is the pre-existing fixed `ERROR_COPY['malformed-request']` — no interpolation, no value. The alternative posture available in this repo (`console.error('…', error)`, e.g. `composerSend.ts:62`) was considered and explicitly rejected here; the reasoning is recorded in § Error handling. Residual, accepted: an operator cannot distinguish an infra rejection from a domain `malformed-request` in the console. That is the intended value-free trade for a pairing-screen failure, and the main-side diagnostics channel (#131) is the correct place to surface it if it is ever needed.
- **[Concurrency]** No findings. No new async task, timer, listener, or subscription; nothing long-lived to own or cancel. There is no check-then-act across the new `await` — the runner reads no shared state, and the container already captures `paste` before its await (`PairingScreen.tsx:182`). The change *removes* an unhandled promise rejection, which is a shutdown-safety improvement: previously a rejection during `will-quit` handler teardown (`index.ts:217`) produced both a wedged screen and an unhandled rejection.
- **[Threat model alignment]** No findings; the applicable threat is the one being fixed. Of the four desktop-specific threats: *renderer compromise reaching the transport* — unchanged, no key, socket, or token path is added to the renderer; *malicious relay* and *hostile daemon response* — not on this path, pairing IPC does not traverse the relay; *token theft from disk* — not on this path, no persistence here. The residual denial-of-availability (an unpairable app until restart) is exactly what this ticket closes. Explicitly out of scope and named in the ticket body: a throwing `onPaired` callback, and any change to the phase-guard / re-entrancy behaviour.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-02
