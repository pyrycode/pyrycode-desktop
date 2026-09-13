# Permission context and session-offer contract

## Context

Ticket #1407 carries the daemon's permission context and session offer to the renderer-facing event and carries the optional answer Boolean back through main. Both #1408 and #1409 consume this contract; neither renderer display nor store wiring belongs here. The source is the [daemon Modal (v2) protocol](https://github.com/pyrycode/pyrycode/blob/main/docs/protocol-mobile.md#modal-v2), read on 2026-09-13 after the listed daemon prerequisites landed. No new ADR is needed.

## Files read

- `src/shared/wire/types.ts` — `ModalShownPayload`, `ModalAnswerPayload`: existing wire shapes and nonce ownership.
- `src/shared/ipc/events.ts` — `DaemonEvent`: camel-case modal event and untrusted-content rules.
- `src/shared/ipc/commands.ts` — `AnswerModalCommandPayload`, `isAnswerModalPayload`: derived type and renderer boundary.
- `src/main/transport/inboundMessage.ts` — `parseModalShownPayload`, `requireString`, `requireBoolean`, `requireStringArray`, `requireRecord`: fail-closed parsing and named-field reconstruction.
- `src/main/transport/codec.ts` — `decodeEnvelope`: JSON parsing before semantic validation.
- `src/main/daemonConnection.ts` — `createDaemonConnection`, `answerModal`, `cancelModal`: event projection, token mint, correlation, lifecycle logs and teardown.
- `src/main/transport/modalResolutionEnvelope.ts` — `buildModalAnswer`: serializes its supplied payload without filtering.
- `src/main/receiveCommand.ts` — `onCommand`: validates before invoking the handler; exposes an unsubscribe handle.
- `src/main/index.ts` — `answerModal` command arm: routes by modal ID and passes the payload unchanged.
- `src/main/correlationRouter.ts` — `routeModal`, `observe`: host ownership follows stamped modal events, never renderer destinations.
- `src/main/emitDaemonEvent.ts` — `emitDaemonEvent`, `bindServerOrigin`: IPC forwarding and trusted host stamp.
- `src/main/daemonConnection.test.ts` — `build`, `FakeDriver`, `stampedEvents`: fake-driver and IPC-sink integration seams.
- `src/main/transport/inboundMessage.test.ts` — `MODAL_SHOWN`, `encodeModalShown`: compatible fixtures and decoder rejection coverage.
- `src/shared/ipc/commands.test.ts` — `isRendererCommand` tests: optional field validation.
- `docs/knowledge/features/modal-store-bridge.md` — “The translator + binding”: the renderer rebuilds named fields; forwarding to its store is later work.
- `docs/knowledge/features/command-channel.md` — command guards: structured clone preserves a present `undefined` property, so it must be rejected for this Boolean contract.
- `docs/knowledge/features/daemon-connection.md` and `daemon-connection-methods.md` — transport placement and named-field sender behavior.
- `docs/knowledge/features/inbound-message-decode.md` — “Error handling”: malformed frames are dropped without partial events.
- `docs/knowledge/features/development-verification.md` — source-check fallback and the limits of static renderer tests.

Codegraph reported an uninitialized index, so source reads and text searches supplied the symbol and consumer map. The #870 analogue added 324 plan lines and 97 implementation/test lines; this plan is smaller while the field/test matrix is larger.

## Design

Extend the existing wire interfaces with optional fields. `ModalShownPayload.reason?: unknown` holds an opaque JSON value already parsed by `decodeEnvelope`; consumers must narrow it before display. It has no relationship to the optional, open string `reason_type`. Add optional string `blocked_path` and `description`, Boolean `default_to_no`, and `always_allow?: { offered: boolean; rules: string[] }`. The latter is optional only for compatibility with older daemons. Add `ModalAnswerPayload.always_allow?: boolean`; the derived answer command inherits it.

`parseModalShownPayload` keeps its current required-field validation. Construct a typed result from named fields, then add each optional field only when its key exists. Validate strings and Boolean using the existing required-field helpers inside those presence checks. For the offer, require an object and reconstruct only `offered` and `rules` using `requireBoolean` and `requireStringArray`. A wrong shape rejects the whole frame. Preserve rule order, empty lists, false, empty strings and all JSON reasons including null. Unknown payload/offer keys are omitted; reason object keys are opaque and retained, including prototype-shaped keys. No recursive reason traversal or new size limit is needed: JSON parsing and the existing plaintext limit already bound this boundary.

Extend only the existing `modalShown` event arm with `reason`, `reasonType`, `blockedPath`, `description`, `defaultToNo`, and `alwaysAllow`. Reuse the wire offer field type to keep its shape consistent. `createDaemonConnection` copies each new field by name only when present, so IPC structured clone cannot turn absence into an own property holding undefined. Keep the existing host stamp and modal/conversation IDs.

`isAnswerModalPayload` accepts an absent `always_allow` or a Boolean; present undefined, null, numbers, strings, arrays and objects are invalid. `answerModal` reconstructs only the modeled fields, mints the token in main as before, and conditionally includes the Boolean without truthiness filtering. Neither reason nor offer rules/destination can be echoed as answer authority. The existing builder serializes this fresh payload. No function signatures, command tags or routing expressions change.

## State + concurrency model

No new store, async task, subscription or state machine. The connection's existing driver-generation checks and `stop()` teardown remain authoritative. Answers still enter `outstandingAnswers` only after a successful send; daemon rejection/dismissal and reconnect retain their existing correlation behavior. `cancelModal` stays unchanged. Test-installed command listeners are unsubscribed and fake connections stopped.

## Error handling

Malformed declared inbound shapes throw `WireDecodeError` with static field/category messages; the current connection catch drops them without a modal event or a connection failure. Invalid renderer commands never reach the sender, using `onCommand`'s existing fixed warning. Existing modal lifecycle and send-failure structured logs remain content-free. No reason, category, path, description, rule, token or raw error is added to diagnostics.

## Testing strategy

- Decoder tests: missing fields stay absent; reasons preserve objects, arrays, null, strings, numbers and Booleans; category-only and reason-only payloads work. Ordered multi-rule and unavailable offers survive, unknown outer keys are filtered, malformed optional shapes throw.
- Connection tests drive encoded plaintext through the real decoder to the IPC sink, assert exact camel-case properties and host stamps, and verify invalid frames emit nothing while the next valid frame still works. Include content-free log assertions.
- Command tests accept true/false/absent and reject every representative non-Boolean, including explicitly present undefined.
- Main integration tests feed raw commands through `onCommand` to the real sender and decode the fake driver's output. Assert true/false/absence, main-minted tokens, exact allowed fields despite smuggled extras, rejection sends nothing, and existing cancellation/rejection correlation.
- Run new tests RED before production changes, then touched-file Vitest and `npm run build`. No UI interaction changes, so no Playwright or live-Claude acceptance belongs to this ticket. Existing permission fixtures remain unchanged.

## Size and overlap check

One deliverable: the complete permission exchange contract. Estimate remains approximately 500 written lines including this plan: five production files, three test files, zero new exported symbols, zero consumer call sites requiring simultaneous updates, three acceptance criteria, and no new state-machine reject branches. Existing parser helpers cover six optional shape-validation paths. A refreshed remote-feature-branch check found no overlap with any of the eight proposed source/test files. All six ticket limits pass.

## Open questions

None. JSON reasons stay `unknown` to enforce consumer narrowing without recursively interpreting open content; offer omission is accepted for compatibility while malformed presence fails closed.

## Documentation handoff

Pending for the documentation stage: the issue specifies no documentation-only acceptance criteria or required path/section. Record this contract in `docs/knowledge/features/inbound-message-decode.md` (permission-context decoding), `docs/knowledge/features/daemon-connection-methods.md` (modal answer), and `docs/knowledge/features/command-channel.md` (answer validation). Renderer display/store behavior remains owned by #1408 and #1409.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] `parseModalShownPayload` validates every declared optional shape before returning; `reason` remains explicitly untrusted opaque JSON. `isAnswerModalPayload` validates the only new renderer input. Neither category nor offer presence grants authority.
- [Tokens] `answerModal` retains main-side `randomUUID()` minting and drops injected tokens. No new credential, persistence, expiry or revocation mechanism; daemon one-shot resolution/dedup remains authoritative.
- [File / storage] No file operations or storage are introduced. `blocked_path` is data only and never feeds a filesystem API. Prototype-shaped reason keys are retained as parsed data, never assigned into another object by key.
- [Electron attack surface] Existing channels only; no window, navigation, preload capability or remote-content changes. Named-field event and answer construction prevents extra fields from becoming capabilities. Tests include forged rules, destinations and tokens.
- [Cryptography] No cryptographic changes; existing Noise transport and main-only keys remain intact. The answer token continues to use the existing CSPRNG.
- [Network & I/O] Existing `MAX_PLAINTEXT_BYTES` bounds decoded frames. No new sockets, URL handling, retries or deadlines. Offer strings are copied in order with no interpretation, truncation or prefix acceptance.
- [Errors / logs] Preserve the established fail-closed drop and static warnings. Existing structured modal lifecycle logs and frame type/length/hash diagnostics never include new payload values; tests assert this.
- [Concurrency] No new long-lived work. Existing send-before-correlation ordering and connection teardown remain unchanged; command listener cleanup is exercised in integration tests.
- [Threat model] Malformed daemon data cannot emit a partially valid modal; compromised renderer data cannot supply retained rules or choose a destination. Session grant eligibility and replay defense remain daemon-owned. OUT OF SCOPE: inert reason rendering belongs to #1408; session-offer UI and live grant acceptance belong to #1409.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
