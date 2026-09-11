# Tool denial reporting

## Files read

- `src/shared/wire/types.ts` → `ToolResultPayload`: adjacent wire contract.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `parseToolResultPayload`, `requireStringArrayOrNull`: live and stored decoding and nullable reports.
- `src/main/daemonConnection.ts` → `createDaemonConnection`: explicit IPC projection.
- `src/shared/ipc/events.ts` → `DaemonEvent`, stored timeline event union: typed delivery.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor`: conversation routing.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `reduceTimeline`: independent result and denial correlation.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts` → their event translators: exhaustive non-owning consumers.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ToolRow`, `openToolName`: expansion and working label.
- `src/renderer/src/screens/conversation/conversation.css` → tool-row rules: existing theme vocabulary.
- `e2e/thinking-progress-estimate.spec.ts` → fake frame delivery and positive working-label assertions.
- `docs/knowledge/features/development-verification.md` → evidence checks: static renders cannot prove delivery or clicks.
- `docs/knowledge/features/conversation-shell.md`, `thread-timeline.md`, `daemon-connection.md` → process ownership and timeline readers.
- Upstream `internal/protocol/interactive.go` → `ToolDeniedPayload`, and `docs/protocol-mobile.md` § `tool_denied`: nine required fields; known source tokens; null report semantics.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553

The Tool row is a bordered column with a filling left header and a trailing count/chevron group. It uses monospace tool text, body-medium subject text, and a stacked expandable body. Preserve the existing implementation of those elements; add a Denied tag and use the app's on-surface-variant muted ink in place of error ink.

## Context and scope

A permission denial is a separate daemon report, not a tool failure or permission actuator. Its plumbing has no independently useful consumer, so the one-consumer floor keeps this behavior together despite the ceiling: approximately 850–950 written lines, 10 TypeScript production files plus CSS, at most 3 new exported types, 4 acceptance criteria, and no new state machine. The nearest thinking-progress analogue added 1217 lines across its plan and implementation commits; this slice needs wire parsing but less UI state. Existing exhaustive consumers require three ignore arms; no signatures or existing call sites need migration. Remote feature-branch overlap check found none.

## Design

Add `ToolDeniedPayload` with the shipped snake-case fields, preserving strings and nullable string-array reports. Both the live parser and stored-frame decoder use one payload parser. Live delivery projects only the named fields into a camel-case `toolDenied` IPC event; stored delivery retains the same report fields.

The bridge creates a `toolDenied` thread event, addressed to the explicit nonempty conversation id. The tool-call model gains an optional denial record separate from `result`, containing tool name, decision reason type, reason, message and both reports. Within the conversation, `reduceTimeline` matches nonempty turn and tool-use ids exactly. Unmatched and repeated markers are same-reference no-ops; the first denial stays attached. A result arriving later fills only `result`, preserving denial. A denial after a result attaches to that existing call. No pending orphan buffer is introduced.

`ToolRow` becomes expandable when either result or denial is present. A denial takes precedence over error styling and adds the literal Denied header tag. Its body precedes the result with one of the four required attribution sentences, selected by exact `classifier`, `rule`, `mode`, or `asyncAgent` tokens; all other tokens use the generic permission-gate sentence. Append a nonempty reason. Awaiting a result, show the marker message. Retain actual results when they arrive. Bound denial prose to 4096 characters per field at rendering and remove terminal escapes and non-layout control characters before rendering inert React text. Source tokens and report entries are never interpolated into chrome or attributes.

`openToolName` skips explicitly denied calls immediately. Other pending calls and all phase/working-indicator rules remain as they are.

## State and concurrency

Denial is synchronous immutable item state, owned by the existing conversation timeline. No new subscriptions, timers, async tasks, persistence or cancellation paths. Result and denial events commute for the same existing call. Existing bridge teardown and history replay own their usual lifetimes.

## Error handling

Missing or mistyped required fields fail through the existing `WireDecodeError` handling. Empty strings remain valid values; empty join keys cannot correlate. Reports preserve null versus arrays, including empty arrays and unknown report names. Successful decode logs only the static event code, frame size and hash through the diagnostic logger; existing decode-failure classification owns invalid frames. Unknown attribution is a generic denial, never guessed provenance.

## Testing strategy

- Decoder: all required field types, empty strings, null/empty/nonempty reports, unknown source, stored decoding, content-free logs.
- Reducer/bridge: both result arrival orders, exact conversation/turn/tool matching, empty and unmatched keys, idempotent duplicates, report retention and ordinary failures.
- Static render: four source sentences plus empty/unknown fallback, escaping/bounds/control removal, expansion before result, denial precedence and pending-tool selection.
- Fake-transport Playwright: deliver classifier and rule frames through main and IPC; expand denied rows and observe positive working-label transitions, retaining another pending tool and then bare working state.
- Run touched tests, build, and the new Playwright spec only.

## Documentation handoff

Pending for documentation stage: no explicit documentation requirement or target section is named by this ticket. Record the resulting denial behavior in the owning timeline and tool-row topics as appropriate.

## Open questions

None. Upstream confirms the four source spellings and report nullability.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseToolDeniedPayload` must validate every required string and nullable string array before IPC. Typed data remains untrusted prose at `ToolRow`.
- Attribution and correlation: exact nonempty join keys prevent cross-call denial; source allowlisting prevents arbitrary daemon tokens from becoming attribution. The report grants no permission and sends no command.
- Renderer sinks: denial prose is bounded, terminal/control-stripped React text only. No HTML, attribute, URL, file path, cache key or log sink accepts it.
- Tokens, storage and cryptography: this slice creates no credential, disk write, key operation or cryptographic primitive. Existing main-process transport and safe storage remain their owners.
- Electron attack surface: one additional typed inbound event, no new bridge API, navigation or window capability. No raw frame or transport secret crosses to the renderer.
- Network and logs: existing envelope size cap and transport lifecycle apply; log only static code, byte length and hash. Invalid payloads use the existing classified failure path.
- Concurrency: no new long-lived work; synchronous immutable reduction has no await boundary or teardown race. Repeated markers cannot overwrite the original report.
- Threat model: a hostile daemon can misreport a denial, but this produces only display state; no execution or policy change follows. Relay dropping/reordering is handled by existing transport ownership and the two arrival orders, with no new transport design.

**Reviewer:** builder, self-review using `builder/security-review.md`
**Date:** 2026-09-11
