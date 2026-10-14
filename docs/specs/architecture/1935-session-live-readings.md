# Current-session live readings and prompts

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `features/development-verification.md`: process and supplied-input test boundaries.
- `docs/knowledge/features/conversation-shell.md`, `modal-store-bridge.md`: existing ranking, prompt views and escaped display contracts.
- Daemon `docs/knowledge/decisions/042-daemon-built-thread.md`, `docs/protocol-mobile.md` session-scoped live-state section: live readings are independent of items; no source-generation wire fields.
- `docs/specs/architecture/1914-session-state-metadata.md`, `src/shared/ipc/events.ts`: supplied provenance and deliberately unattributed clears.
- `src/renderer/src/store/sessionIdBridge.ts`, `announcedModelBridge.ts`, `conversationActivityBridge.ts`: legacy writers cannot become thread binding authorities.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts`: `toRunConfigSnapshot` retains settings report semantics.
- `src/renderer/src/store/modalBridge.ts`, `questionBridge.ts`, `modalPrompts.ts`, `questionBatches.ts`: existing presentation shapes and reducers.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `workingIndicatorStateWithLocalSend`, `ThinkingIndicator`, status ranking.
- `src/renderer/src/screens/conversation/modalResolution.ts`, `questionResolution.ts`, `src/preload/index.ts`: typed response commands and bridge validation; production joining belongs to #1908.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Reviewed design context and screenshot: fixed sidebar beside the conversation, with the activity row and model/context footer below its content. Reuse existing views and theme styles without changing their geometry, typography or ranking. This ticket supplies their values; it does not mount a production route.

## Context

An inactive thread consumer needs live state attributed to its displayed host/conversation/session, independently of durable items. Legacy session transitions and settings replies remain valid for the ordinary app but cannot bind this consumer. No ADR or documentation deliverable is needed.

Sizing: one isolation deliverable, five observable criteria; approximately 300 production + 360 tests + 75 plan lines, at most four exported state/input/dependency types and one store factory, zero existing consumer signature changes. New files have no in-flight overlaps after the remote-branch check.

## Design

- Add `createThreadLiveState` with injected host-bound response sink and content-free logger. Its synchronous input union accepts summary binding, typed daemon readings, retained request ownership and request release. No singleton or production subscriptions.
- Only a summary supplies `current_session_id`. Empty/omitted binding remains unaddressable; null summary means displayed scope lost. Any host/conversation/session change atomically drops all scoped readings, outstanding prompts and retained requests, without resolving or answering prompts.
- Admission requires a nonempty bound host/conversation, matching stamped host, positive conversation ownership and a matching nonempty `envelopeSessionId`. Payload session IDs never supply missing provenance. Direct conversation fields, retained requests and retained outstanding prompts establish ownership; mismatches fail closed. Session tags and selection alone establish nothing.
- Store readings under canonical `SessionStateFamily` Maps. Singletons replace; tool/task progress and prompts retain independently addressed IDs. Dismissals and settings acknowledgements share the canonical shown/settings families. Attributable clears remove only one family; unattributed clears do nothing.
- Add `threadLiveInputs` to derive existing status, run-config, announced-model, permission and question input shapes, retaining typed access to every other family. Existing translators build prompt shapes; invalidation never dispatches a synthetic dismissal. No items, history or hydration feed this adapter.
- Preserve caller-owned connection/account/conversation readings and pending/queue inputs; the adapter never resets or writes those stores. Status derives with the existing ranking function and retains the caller's local-send input. Attention can read the same activity booleans and outstanding prompt eligibility.
- Response actions require the exact still-held displayed prompt, current scope and owning host. The injected sink receives that host plus existing typed answer/cancel commands. It must be host-bound by the future composition root; no bare global sender is installed here. Existing permission choice/confirmation and question selection semantics remain presentation-owned.

## State + concurrency model

One Zustand vanilla store per injected adapter. Binding is either absent or a host/conversation with a known/unknown session; all writes are synchronous. No tasks, timers or subscriptions. Request ownership is released explicitly or on invalidation/disposal. Disposal removes held state and rejects subsequent inputs/actions. Caller-owned connection and queue lifetimes remain independent.

## State transitions and identity reuse

| Event | Focused test |
| --- | --- |
| A populated, B bound, delayed A pushes/replies/prompts | `replacement rejects delayed readings through existing view inputs` |
| Empty/omitted binding, loss, reactivation with reused ID | `invalidates unavailable bindings and scope loss` |
| Absent/null/string provenance and foreign host/conversation | `requires positive ownership and envelope provenance` |
| Correlated and unattributed family clear | `clears only the attributable canonical family` |
| Reconnect active/inactive readings and outstanding prompt recovery | `reconciles retry compaction and prompts independently of items` |
| Two hosts reuse conversation/session/prompt/request IDs | `routes responses to the retained owning host and rejects stale handles` |
| Multiple progress/prompt identities, disposal and request release | `retains independent identities and releases ownership` |

## Error handling

Rejected readings are no-ops with static reason codes; no peer text or identifiers enter logs. Failed response sends return false and retain the prompt for recovery. No exception reaches rendered state. Existing main/preload validation is unchanged.

## Testing strategy

Write supplied-input unit tests first, observe the missing-adapter failure, then implement. Assert the A/B sequence, all canonical families, property/provenance distinctions, retained correlation, prompt response IDs/host and unchanged caller-owned inputs. Static-render existing views using derived inputs to prove actual model/status/prompt presentation. No shared harness, Electron interaction or live-Claude test; production integration is #1908. Run focused tests, final main merge, pre-verify and build. Capture the reused status/prompt views for visual comparison when available.

## Open Questions

Resolved: use an injected host-bound response sink for the inactive route; enabling actual IPC composition belongs to #1908. Typed payload-less clears cannot gain invented ownership; only retained request correlation can admit them with current provenance.

## Security review

**Verdict:** PASS

- [Trust boundaries] Admission checks stamped host, independent conversation ownership and envelope provenance together; no content/selection-based fallback. IDs stay in Maps.
- [Tokens] No tokens, credentials or key access; safeStorage remains main-owned.
- [File/storage] No persistence, paths or renderer web storage; cache/items cannot create prompts.
- [Electron] Existing validated commands only, injected with their retained host. No new IPC/window/navigation surface; production wiring is #1908.
- [Crypto] No cryptography or raw bytes; existing Noise variant and key lifecycle unchanged.
- [Network/I/O] No network or I/O added; parsed typed inputs inherit main frame bounds.
- [Errors/logs] Only fixed event/reason codes; never prompt text, answer contents, IDs or caught errors.
- [Concurrency] Synchronous invalidation and exact-held-prompt checks prevent stale response callbacks; disposal ends ownership.
- [Threat alignment] Delayed relay readings fail admission; hostile daemon text remains escaped display-only. Compromised renderer gains no transport/key access. Disk-token protection remains safeStorage; production negotiation and end-to-end proof remain #1908.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-14

## Revisions

2026-10-14: `reduceQuestionBatches` intentionally ignores empty question readings, including an empty replacement. Keep that eligibility guard in the adapter so an unanswerable batch cannot create attention or replace an outstanding request. `threadLiveInputs` has a named return interface because the TypeScript declaration build cannot name the event union's private metadata through an inferred return type. No production UI or IPC composition is enabled.

2026-10-14: An owning-host `connected` event atomically retires outstanding prompt families and retained request correlation without a resolution, following the existing prompt reconnect contract. Current supplied shown readings repopulate them; a different host's connection event does nothing. Retry/compaction stay available until current supplied active/inactive values replace them. This closes the stale-prompt gap when payload-less reconnect clears cannot establish conversation ownership.

2026-10-14: Verifier findings 1 and 2 require the existing turn-activity lifecycle in `dispatch`: after admission, every `turnState` removes the onset-only `stall` family, and a non-thinking state also removes `thinking_progress`. Publish the phase and both removals in one store update; repeated thinking preserves its estimate, and rejected readings change nothing. Retry/compaction remain independent. The security verdict remains PASS: lifecycle clearing occurs only after the unchanged host, provenance and ownership guards.

| Additional lifecycle event | Supplied-input regression |
| --- | --- |
| Thinking/responding/idle after a stall; rejected old-session activity | `clears stalls atomically on admitted %s activity` |
| Non-thinking phase, repeated thinking and a later thinking phase; rejected old-session activity | `ends thinking progress atomically on %s and starts the next think fresh` |
