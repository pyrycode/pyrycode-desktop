# Tool-row elapsed counter

## Context and sizing

Show the daemon's latest elapsed reading on its pending call and on the working label naming that call. This is one visible deliverable; transport and timeline plumbing have no independent consumer. The one-consumer floor therefore overrides the production-file ceiling. Estimate: 11 production files, about 650 written lines including tests and this plan (refiner estimated 1100); one new exported payload interface, four acceptance criteria, one production prop consumer, and fewer than ten rejection conditions. No existing function signature is replaced. The #1314 analogue carries a timeline-wide scalar; this reading instead belongs to an existing call.

Remote feature branches were refreshed and checked for overlaps: none. Codegraph reported an uninitialized index, so source searches supplied the reading map. No ADR is needed.

## Files read

- `src/shared/wire/types.ts`: `ToolUsePayload`, `ThinkingProgressPayload`, `MessageType` establish wire conventions.
- Upstream `internal/protocol/interactive.go`: `ToolProgressPayload`, and `internal/protocol/testdata/tool_progress.json`, pin four required keys and signed integer seconds (fixture reading -44).
- `src/main/transport/inboundMessage.ts`: `parseInboundMessage`, `parseThinkingProgressPayload`, `requireNumber`, `requireString` establish validation and content-free diagnostics.
- `src/main/daemonConnection.ts`: `createDaemonConnection` maps validated payloads into named IPC fields.
- `src/shared/ipc/events.ts`: `DaemonEvent` carries live events separately from history.
- `src/renderer/src/store/timelineBridge.ts`: `translateTimelineEvent`, `timelineTargetFor`, `subscribeTimeline` route attributed updates.
- `src/renderer/src/store/threadTimeline.ts`: `ThreadItem`, `ThreadEvent`, `reduceTimeline`, `fillResult` own pending calls and completion.
- `src/renderer/src/store/conversationTimelineStore.ts`: `createConversationTimelineStore` currently creates absent slices even for no-op folds.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts`: exhaustive event translators must explicitly ignore the new arm.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ToolRow`, `ThinkingIndicator`, `openToolName`, `toolWorkingCopy` own both text sinks; pending leaves have no toggle.
- `e2e/thinking-progress-estimate.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: frame-driven end-to-end proof pattern.
- `docs/knowledge/features/development-verification.md`: positive completion evidence before absence assertions; static renders do not prove effects.
- Feature overviews `thread-timeline.md`, `conversation-timeline-holder.md`, `conversation-shell.md`, `conversation-shell-tool-rows.md`, `inbound-message-decode.md`, `daemon-connection.md`, `daemon-event-channel.md`: process boundaries, Map attribution and display conventions.

## Design source

https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-557

The trailing count is a single body-medium text run using on-background ink. Reuse `tool-row__right` and `tool-row__count` for elapsed text without changing the leaf's expandability.

https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The status area places a small primary-colored working label beside the existing mark, with error actions opposite it. Append elapsed text inside the existing single ellipsizing label; reuse its typography, spacing and icon unchanged. Design context and visual references were read for both nodes.

## Design

Add `tool_progress` and `ToolProgressPayload` with required `conversation_id`, `turn_id`, `tool_use_id` strings and integer `elapsed_seconds`. Preserve zero and negative values. Reject missing/mistyped fields and fractional/non-finite seconds, without imposing positivity or monotonicity. Return a fresh four-field payload; unknown keys do not propagate.

The inbound `tool-progress` arm has no history timestamp. `createDaemonConnection` emits `toolProgress` with four named camel-case fields. The timeline bridge creates a `ThreadEvent` carrying turn, call and seconds, routing by the event's conversation. Other exhaustive bridges ignore it. History gains no new arm.

`ThreadItem` tool calls gain optional `elapsedSeconds`. `reduceTimeline` replaces it only when turn and call ids match a pending, non-denied call. No match returns the original state. All lifecycle fields and other row references remain unchanged. Completion and denial clear the reading. `dispatchFor` ignores progress for an absent conversation slice, avoiding row creation and retention eviction from unmatched traffic.

Use one pending-call lookup for the working label's name and reading, retaining `openToolName` as a compatible wrapper. `ThinkingIndicator` receives an optional elapsed prop, used only when its existing tool label is active. Format the absolute seconds as `12s` or `1m 05s`, prepend a negative sign when needed, and append with a space. `ToolRow` renders that same format in its trailing count slot for pending calls, including grouped parents; chevrons remain conditional on existing expandability.

## State and concurrency

All progress updates are synchronous reducer folds inside existing subscriptions. Add no async job, timer, inferred reading or persistence. Existing bridge unsubscriptions and pairing clears remain the teardown path. Latest arrival wins, even when the reading decreases; resolved or denied calls reject late progress.

## Error handling

Malformed payloads throw the existing `WireDecodeError` at the parser boundary and are dropped by the existing connection catch. Successful decoding logs only static `tool_progress`, frame length and hash. Existing decode-failure classification handles rejects; ids and elapsed values never enter logs. Unmatched progress is a normal no-op, not a UI error.

## Testing strategy

- First run failing parser, reducer/bridge and static-render tests before production edits.
- Pin upstream fixture shape, required fields, signed/zero values, malformed types and integer validation; compile-time narrowing checks cover wire and IPC unions.
- Verify delivery through the existing fake driver, ignored exhaustive consumers, matching conversation/turn/call, unknown conversations, repeated/decreasing readings, unchanged lifecycle, resolution/denial and late updates.
- Static markup covers signed formatting, no reading, pending leaf without a toggle, grouped row, and unchanged non-tool indicator states.
- Focused fake-transport Playwright sends 30, 60 and 90 separately, checks both surfaces at each step, waits without a frame, then positively observes resolution before asserting the elapsed text disappeared. Capture the rendered treatment for comparison with Figma.
- Run touched unit specs, `npm run build`, and the new focused Playwright spec through the approved Electron launcher.

## Documentation handoff

Pending for the documentation stage: no explicit documentation acceptance criterion or path/section was supplied by this ticket. Record the live elapsed behavior in the owning tool-row and timeline topics as appropriate.

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseToolProgressPayload` validates the three strings and finite integer before returning a fresh typed object; hostile extra keys are discarded. The elapsed value stays untrusted display data.
- Tokens and storage: this path creates no credential and writes no storage. Existing main-process key handling is untouched.
- Electron attack surface: a receive-only `DaemonEvent` arm adds no command or capability; raw frames and transport remain in main. React text children are the only new sinks, never attributes, HTML or URLs.
- Cryptography: no handshake, RNG, nonce or comparison changes; existing Noise framing remains authoritative.
- Network and I/O: `parseInboundMessage` retains the existing plaintext cap. No new connection, endpoint, timeout or read operation is introduced.
- Logs and errors: metadata-only success diagnostic and existing static decode-failure classification; no payload fields in logs or error text.
- Concurrency: no awaits between reading and folding state, no timer, no new subscription. Late frames cannot revive completed calls. Unknown conversations create no state.
- Threat model: content-blind relay cannot author decrypted progress. A hostile paired daemon can supply readings but cannot use these fields to reach a privileged sink; matching uses array comparisons and the existing Map, not object property paths.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-11
