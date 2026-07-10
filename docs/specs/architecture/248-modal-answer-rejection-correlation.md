# #248 — Surface a rejected `modal_answer` as a correlated, content-free rejection event (transport/main)

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/248
**Size:** S · **Label:** `security-sensitive` · Split from #227; render slice is #249 (blocked-by this).

## Files to read first

- `src/main/daemonConnection.ts` — the correlation host and the ONLY production file with real logic here. Read: module-local state block (`245-266`, where a new local joins `nextEnvelopeId` / `reassembler`), `answerModal` (`687-711`, where the answer is sent — the set-on-answer seam), the `case 'daemon-error':` arm (`324-326`, the emit seam, currently `reassembler?.fail`), the `case 'modal-dismissed':` arm (`447-457`, the clear-on-accept seam), and `dial()` (`759-781`, the clear-on-reconnect seam, next to `nextEnvelopeId = 2`).
- `src/shared/ipc/events.ts:60-136` — the `DaemonEvent` union. Extract: the arm-comment style (each arm documents what it carries + who consumes it + "no token/key/raw frame") and the `sessionTransition` (`88-94`) dormant-arm precedent this arm clones.
- `src/renderer/src/store/daemonEventBridge.ts:27-87` — session bridge; the `assertNever` guard (`84-85`) and the existing null-group (`sessionTransition` at `79-83`). Add one no-op case.
- `src/renderer/src/store/timelineBridge.ts:35-91` — timeline bridge; same shape, null-group at `82`. Add one no-op case.
- `src/renderer/src/store/modalBridge.ts:41-97` — modal bridge; the OWNING bridge. It translates `modalShown`/`modalDismissed` (`43-54`) and null-groups the rest (`55-76`). Add the new arm as an explicit **dormant** owning case (see Design).
- `src/main/daemonConnection.test.ts:1-270` — the test harness. Extract: `build()` → `{ connection, sink, drivers }`, `emitted(sink)` event capture (`109-110`), the fake driver's `emit()` (`80`) to drive `RelaySessionEvent`s, `errorPlaintext()` (`263-271`, carries `message: 'secret error detail'` — the no-echo probe), `modalDismissedPlaintext()` (`249-251`), and how a test reaches `connected` before delivering a `message` frame.
- `src/renderer/src/store/modalBridge.test.ts:72-122` — the "returns null for all N non-modal arms" table (`73-121`). The three bridge tests each carry one; add the new arm to each.
- `docs/knowledge/decisions/0009-modal-prompt-model.md` — §Context "two contract facts" (`modal_id` is the sole one-time nonce; no `conversation_id` on a modal) and §70 (the note that scoped THIS follow-up to "surface the rejection," not "check a local bit").
- `src/main/transport/inboundMessage.ts:756-768` — the `error` → `{ kind: 'daemon-error' }` decode. **READ-ONLY, not modified.** Confirms `daemon-error` is already content-free (no `ErrorPayload` field narrowed); this ticket adds no inbound kind and no parse function.
- `src/main/transport/bundleReassembler.ts:24-62` — the other `daemon-error` consumer (`fail('daemon-error')`). Note it exposes no `isPending()` query — relevant to the precedence decision.

## Context

An ungranted device's `modal_answer` (#236 sends it, #237 optimistically clears the modal on answer) round-trips to a daemon `error` envelope. Today that `error` decodes content-free to `{ kind: 'daemon-error' }` (#116, `inboundMessage.ts`) and its only consumer is `reassembler?.fail('daemon-error')` (`daemonConnection.ts:325`). With no debug bundle in flight that call is a silent no-op — the rejection vanishes, and the user (whose modal is already gone) sees nothing.

The daemon `error` carries **no** machine-readable rejection signal and **no** `modal_id` (content-free decode, ADR 0009). Attribution therefore comes from the transport's own memory that it recently sent a `modal_answer`: the answer is minted and sent main-side (`answerModal`, #236), so a correlation window lives naturally on the trusted main side, and the emitted event carries the correlating `modal_id` — a one-time nonce already renderer-visible from `modalShown` (#201), not sensitive daemon content.

This slice delivers the correlated rejection to the renderer as a new, content-free `DaemonEvent`. It renders nothing: the arm ships **dormant** (every exhaustive bridge routes or no-ops it) until the render slice #249. Mirrors the transport-then-render split of #201 → #224 and #214 → #215, and the dormant-arm posture of `sessionTransition` (#254), whose consumer (#259) is likewise not yet built.

Not UI-visible: transport/main only, arm dormant, renders nothing this slice. No `## Design source` section — the visual design lands in #249.

## Design

### New `DaemonEvent` arm (`src/shared/ipc/events.ts`)

One arm, appended to the union, content-free:

```ts
| { type: 'modalAnswerRejected'; modalId: string }
```

Carries ONLY `modalId` — the one-time nonce already renderer-visible from `modalShown` (#201, ADR 0009), never the daemon `ErrorPayload` text. Comment it in the `sessionTransition` style: what it carries, that it is consumed by the modal bridge (#249, render), NOT the session/timeline store, and that no token/key/raw frame can ride it (AC4 by construction — no field can hold a secret).

### Main-side correlation window (`src/main/daemonConnection.ts`)

A **FIFO queue of outstanding answered `modal_id`s**, closed over in `createDaemonConnection` alongside `nextEnvelopeId` / `reassembler`:

```ts
// modal_ids whose modal_answer is awaiting the daemon's reply (#248). FIFO: the wire `error` carries
// no modal_id, so a rejection dequeues the OLDEST outstanding answer. Drained by a matching
// modal_dismissed (answer accepted) and reset on each dial (fresh connection). Single-writer — every
// mutation runs to completion inside a synchronous onDriverEvent / command call, no await between.
const outstandingAnswers: string[] = []
```

Four seams, each 1–3 lines:

1. **Set-on-answer** — in `answerModal`, **after** `driver.sendMessage(bytes)` succeeds (inside the existing `try`, last statement): `outstandingAnswers.push(payload.modal_id)`. Placing it after the send means a build/send throw records no phantom outstanding answer (no `error` will come back for an answer that never left). The `if (driver === null) return` guard already skips it when disconnected.

2. **Emit-on-error** — in `case 'daemon-error':`, **keep the existing `reassembler?.fail('daemon-error')` line unchanged** (bundle-fail preserved), then append:

   ```ts
   const rejectedModalId = outstandingAnswers.shift()
   if (rejectedModalId !== undefined) {
     emitDaemonEvent(sink, { type: 'modalAnswerRejected', modalId: rejectedModalId })
   }
   ```

   An empty queue → `shift()` is `undefined` → no event, existing drop/reassembler behaviour intact (AC2).

3. **Clear-on-accept** — in `case 'modal-dismissed':`, remove the matching `modal_id` from the queue (the answer was accepted, confirmed by its dismissal) before/after the existing emit. Contract: remove the first element equal to `inbound.modalDismissed.modal_id` if present; a no-op if absent (a dismissal for a modal this client didn't answer — e.g. a `local`/`timeout` source, or an already-drained id). This is what keeps a later **unrelated** `error` (e.g. the dropped `request_snapshot` error, `daemonConnection.ts:129`) from mis-attributing to an already-accepted answer.

4. **Clear-on-reconnect** — in `dial()`, next to `nextEnvelopeId = 2`: reset the queue (`outstandingAnswers.length = 0`). A fresh connection starts with no outstanding correlation, so a stale answer from a dead session can never correlate an `error` on the reconnected one.

**No `inboundMessage.ts` change.** `error` → `daemon-error` already exists (#116). The correlation is pure routing-layer state in `daemonConnection.ts`; no new inbound kind, no new parse function, no wire-type change.

### Why FIFO (not a single slot)

The grant is **per-device**, not per-modal (ADR 0009 §70): within one connection either every answer is accepted (granted → each yields a `modal_dismissed`) or every answer is rejected (ungranted → each yields an `error`). An ungranted user can answer modal A then a queued modal B before A's `error` returns (#237 clears each optimistically, so nothing on screen signals "wait"). A single slot would overwrite A with B and then mis-attribute A's `error` to B and drop B's. FIFO dequeues in send order: first `error` → A, second `error` → B — correct. The accept path drains by id (a granted device's dismissals remove the exact answered id), so the queue is empty between turns. Cost over a single slot is one `push`/`shift`/`indexOf`+`splice` — negligible.

### Precedence when both a bundle and an answer are in flight

The two `daemon-error` consumers act **independently**; neither suppresses the other:

- `reassembler?.fail('daemon-error')` stays first and unchanged → a `daemon-error` during an active bundle still fails the bundle (hard requirement, Technical Notes). Inert when no bundle (reassembler `null` or `settled`).
- The correlation emits **iff** an answer is outstanding (queue non-empty), regardless of bundle state.

In the common cases exactly one fires (only a bundle in flight → only the reassembler; only an answer outstanding → only the rejection). The sole overlap — a bundle download AND an outstanding answer AND a single `daemon-error` in that window — double-fires (bundle fails + a rejection emits), and one is spurious because the content-free `error` is genuinely unattributable (no `modal_id` on the wire, ADR 0009). This is an **accepted, documented limitation**, not defended, per evidence-based restraint: the overlap is unobserved, and disambiguating it would need either a new `isPending()` on the reassembler (scope creep into #116) or a parallel bundle-pending flag — both defend an unobserved failure. If ever observed, the follow-up fix is a "bundle-pending suppresses correlation" gate; noted here so a reviewer sees it was a decision, not an oversight.

### Bridges — one arm, three exhaustive consumers (atomic)

The `assertNever` guard in each of the three bridges makes the new union member a compile error until each adds a case. This is the #241 DaemonEvent-arm posture: the three touches are mechanical, compiler-forced one-liners, not independent design.

- **`daemonEventBridge.ts`** — add `case 'modalAnswerRejected':` to the existing null fall-through group (with `sessionTransition`); comment "consumed by the modal bridge (#249), not the session store."
- **`timelineBridge.ts`** — same: add to the null group; comment "modal bridge (#249), not the timeline store."
- **`modalBridge.ts`** — the OWNING bridge. Add a **distinct** dormant case (not lumped into the anonymous null group), so ownership is visible:

  ```ts
  case 'modalAnswerRejected':
    // Owned here — the render slice (#249) flips this to translate a rejection ModalEvent. Dormant
    // this slice: returns null (no ModalEvent, no reduce arm added), so the arm renders nothing.
    return null
  ```

  No `modalPrompts.ts` / `reduceModal` change this slice — the rejection reducer arm and the render are #249's. This keeps #248 transport-only and matches how `sessionTransition` (#254) added the arm + three bridge no-ops while its real consumer (#259) waited.

## State + concurrency model

- **Single source of correlation state:** the `outstandingAnswers` array, closed over in `createDaemonConnection` — the same module-local pattern as `nextEnvelopeId` / `reassembler` / `driver`. No store, no renderer-side mirror. The renderer never sees the queue; it only receives the emitted `modalAnswerRejected` event.
- **Single-writer, no await races:** every mutation happens inside a synchronous body — `answerModal` (a command, no `await`) or `onDriverEvent` (the driver's event callback, synchronous). There is no `await` between a read and a write of the queue, so no check-then-act race across a yield (matches the `nextEnvelopeId` comment at `daemonConnection.ts:255-260`).
- **Teardown:** the queue holds only strings (no timers, sockets, or listeners) — nothing to abort. `dial()` resets it; `stop()` needs no reset (the driver is torn down, no frames arrive, the stale queue is inert until the next `dial()` clears it).
- **Reconnect (#83):** the driver's automatic supervisor reconnect replaces the driver but does NOT call `dial()`. Consider whether an in-session auto-reconnect should also clear the queue. Decision: it need not — an outstanding answer whose `error`/`dismissed` was lost to the drop simply ages out via the next real reply or the next explicit `dial()`; the worst case is one stale entry that a later `error` dequeues (a bounded, single false-attribution, same class as the accepted overlap limitation). Documented in Open questions in case #249's UX makes it matter.

## Error handling

- **No new failure modes.** The change adds no parse, no I/O, no throw. `emitDaemonEvent` is a pure forwarder. `shift()` / `push` / `indexOf` / `splice` on a `string[]` cannot throw.
- **No-echo discipline (AC3):** the emitted event is a fresh literal `{ type: 'modalAnswerRejected', modalId }` where `modalId` is the client's OWN outstanding-queue value (main-side trusted state the desktop chose when it sent the answer), never a field read from the untrusted `error` payload. The `error`'s `ErrorPayload.code` / `.message` are never decoded (already true, #116) and never surfaced. The category-level content is exactly "an answer was rejected" plus the correlating nonce.
- **False-attribution envelope (documented, not defended):** (a) an unrelated `error` arriving while an answer is outstanding on a granted device (narrow window between answer and its `modal_dismissed`) → a spurious rejection; the accept-path drain minimises this. (b) the bundle-overlap double-fire (above). Both are inherent to a content-free `error` with no `modal_id`; both are unobserved; neither is defended per evidence-based restraint.

## Testing strategy

Vitest (`npm test`), extending the existing harnesses. All scenarios as bullet inputs → expected behaviour; the developer writes the bodies in the project idiom.

### `src/main/daemonConnection.test.ts` (the core coverage)

Drive the connection to `connected`, then use `answerModal(...)`, `drivers[0].emit({ type: 'message', plaintext })` with `errorPlaintext()` / `modalDismissedPlaintext(...)`, and assert on `emitted(sink)`.

- **Correlated rejection:** answer `{ modal_id: 'mdl-1', option_id: 'allow' }`, then deliver `errorPlaintext()` → `emitted(sink)` contains exactly one `{ type: 'modalAnswerRejected', modalId: 'mdl-1' }`.
- **No answer outstanding → no rejection (AC2):** with no prior `answerModal`, deliver `errorPlaintext()` → no `modalAnswerRejected` in `emitted(sink)` (existing drop behaviour preserved).
- **Accept then unrelated error → no rejection:** answer `mdl-1`; deliver `modalDismissedPlaintext({ modal_id: 'mdl-1', outcome: 'allow', source: 'remote' })`; deliver `errorPlaintext()` → no `modalAnswerRejected` (the accept drained the queue).
- **FIFO across two rejections:** answer `mdl-1`, answer `mdl-2`; deliver `errorPlaintext()` twice → two events in order: `modalId: 'mdl-1'` then `modalId: 'mdl-2'`.
- **No-echo (AC3):** assert the emitted `modalAnswerRejected` object has keys exactly `{ type, modalId }` and that `'secret error detail'` (the `errorPlaintext()` message) appears in no emitted event. Reuse the #116 no-echo probe.
- **Reconnect clears the window:** answer `mdl-1`; `connection.reconnect()` (drives a fresh `dial()`); reach `connected` again; deliver `errorPlaintext()` → no `modalAnswerRejected`.
- **Bundle + answer overlap (documents precedence):** `requestDebugBundle(consumer)`, then `answerModal(mdl-1)`, then deliver `errorPlaintext()` → assert BOTH `consumer.fail('daemon-error')` was called AND one `modalAnswerRejected{ modalId: 'mdl-1' }` emitted (independent consumers).
- **Answer send throws → no phantom outstanding:** with a `throwOnSend` driver, `answerModal(mdl-1)`; reach a state where an `error` arrives → no `modalAnswerRejected` (the failed send recorded nothing). (Use the existing `makeDriverFactory({ throwOnSend: true })` seam; note the answer must be sent post-handshake.)

### Bridge tests (mechanical, one line each)

- `daemonEventBridge.test.ts`, `timelineBridge.test.ts`, `modalBridge.test.ts`: add `{ type: 'modalAnswerRejected', modalId: 'mdl-1' }` to each "returns null for all non-owned arms" table and assert the translator returns `null`. (In `modalBridge.test.ts` it belongs in the null table this slice — it is dormant; #249 moves it to an owned assertion.)

### Type coverage

`npm run typecheck` proves exhaustiveness: omitting any of the three bridge cases fails to compile via `assertNever`. `npm run build` is the salvage/QA gate (AC5).

## Scope & size note

Production `.ts` files touched: **5** — `events.ts`, `daemonConnection.ts`, and the three bridges. This meets the §4 self-check count of 5, but is the recognized **DaemonEvent-arm atomic-bridge exception** (#241 posture, explicit in the ticket body; #241 shipped this exact shape as one `size:s`, PR #244):

- The three bridge touches are **compiler-forced one-liners** — each `assertNever` guard makes the arm a build error until a case exists. They are not independent design surface.
- The change is **type-system-atomic**: you cannot add the arm in one ticket and the bridge exhaustiveness in another — the intermediate state does not compile. A "split" would produce a broken build, not a smaller ticket.
- The parent split (#227 → #248 transport + #249 render) already happened; #248 is the minimal transport atom, and the arm cannot be separated from the correlation that emits it or the bridge cases the compiler demands.
- Real design surface is **2 files** (`events.ts` + `daemonConnection.ts`); total written work ≈ 190 LOC (≈ 25 dev-turns), far under the 600-LOC / budget ceilings.

## Open questions

- **In-session auto-reconnect (#83) and the queue.** `dial()` clears the queue; the supervisor's transient auto-reconnect does not. The chosen behaviour (let a stale entry age out; worst case one bounded false-attribution) is documented above. If #249's UX makes a stale rejection user-visible and annoying, revisit — clearing on the driver `terminal`/`error` events would tighten it, at the cost of a slightly larger diff. Deferred, evidence-based.
- **`modalAnswerRejected` field name / arm name.** Chosen to mirror `modalShown` / `modalDismissed` (camelCase, `modalId`). If #249's `ModalEvent` prefers a different discriminant (e.g. `type: 'answerRejected'`), that rename is #249's bridge concern and does not touch this arm's wire/IPC name.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No MUST FIX — the correlation reads **no field** from the untrusted daemon `error` payload; the `daemon-error` contributes only the boolean fact "an error arrived," and the emitted `modalId` is the client's OWN outstanding-queue value (chosen main-side when it sent the answer). The boundary is explicit and stated (Design §correlation, Error handling §no-echo). `answerModal`'s `payload.modal_id` is renderer-supplied (the renderer is untrusted vs main), but it is **echo-only**: stored in a main-process `string[]` and emitted back to the same renderer on `DAEMON_EVENT_CHANNEL` — it never reaches a filesystem path, a crypto compare, a log, or the daemon (the wire `modal_answer` frame is built via the separate, unchanged #236 path). No confused-deputy route to a more-privileged sink.
- [Tokens/secrets] No findings — no token generation, storage, or compare in this slice; `mintToken()` (#236) is untouched. The `modalId` is a one-time non-secret nonce (ADR 0009), echoed to its origin (the renderer), leaking nothing. The event carries no other field (AC4 by construction).
- [File/storage] N/A — no path, no `fs`, no disk; the change is pure in-memory routing state (`outstandingAnswers: string[]`).
- [Electron / IPC surface] No MUST FIX — no new `contextBridge` API, `ipcMain` channel, or window; `modalAnswerRejected` rides the existing main→renderer `DAEMON_EVENT_CHANNEL`. Process placement is clean: correlation state + emit stay in the MAIN process; nothing moves keys/socket/token toward the renderer. A renderer that supplies a non-string `modal_id` (bypassing types) only gets it echoed back to itself → a self-inflicted no-match in #249 (fail-safe); #249 must still render `modalId` as plain text, never HTML (the inherited modal-display discipline) — noted as a forward-constraint, not a change here.
- [Cryptographic primitives] N/A — no RNG, compare, key, or nonce touched.
- [Network & I/O] No findings — no new socket, URL, timeout, or frame parse; the `error` is already size-bounded (`MAX_PLAINTEXT_BYTES`, #116). A content-blind relay cannot forge a Noise-authenticated `error`; drop/delay yields a missed rejection (fail-safe); in-session nonce ordering rules out reorder-driven mis-attribution.
- [Error messages / logs] No findings — `emitDaemonEvent` is an unlogged pure forwarder; the daemon-error diagnostic record (inboundMessage.ts:762-767) is unchanged (event/code/bytes/hash only, no `modal_id`, no error content). The correlation adds no log call.
- [Concurrency] No findings — single-writer queue; every mutation (`push` / `shift` / `indexOf`+`splice`) runs inside a synchronous `answerModal` or `onDriverEvent` body with no `await` between read and write (matches the `nextEnvelopeId` single-writer rationale). No timer/listener/socket added → nothing to leak or cancel.
- [Threat model alignment] No MUST FIX — hostile relay (can't forge encrypted `error`; drop/delay is fail-safe), hostile daemon (can only trigger a content-free rejection for a modal the client actually answered — no content injection, no escalation beyond its existing authenticated position), hostile daemon response parsed defensively (the `error` is content-free-decoded #116; this ticket reads no field from it). Renderer-compromise-reaching-transport: adds no renderer→main capability; `modal_id` is echo-only.
- [Availability / DoS] OUT OF SCOPE — a compromised renderer looping `answerModal` grows the queue, but only at the rate it already floods `modal_answer` frames through the shared command surface (every command function has this property); the queue holds short strings and is drained by every reply/dial. A cap would defend an unobserved failure already subsumed by the existing command-flood surface. Revisit only if observed.
- [Correctness limitation, not a security finding] The narrow-window false-positive (unrelated `error` during an outstanding answer) and the bundle-overlap double-fire are documented as accepted limitations (Error handling §false-attribution). Both are UX/correctness (a spurious "answer rejected"), not confidentiality/integrity/availability — no data leak, no access grant.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-11
