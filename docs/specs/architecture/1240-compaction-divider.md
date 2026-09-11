# Permanent compaction divider

## Context and scope

Ticket #1240 retains received compactions in the existing held conversation timeline.
The shipped daemon sends outcome fields on `compacting` and later count/trigger metadata
on `compaction_boundary`; neither status edges nor metadata are guaranteed to precede
the other. These are display facts, with no inference about Claude's actual memory.

One deliverable spans decode, IPC, store and rendering. Estimated written work is
900–950 lines, including tests and this plan, across 11 production TypeScript files
and the existing conversation stylesheet. This exceeds the 800-line/5-file ceilings;
the ticket's one-consumer floor exception applies because a plumbing-only sibling
has no independent consumer. Two new exports, zero signature migrations, four ACs,
and at most eight compaction state branches remain within their respective limits.
The analogue #1242 cost 1008 insertions across 11 production files, as measured by
the refiner; its retained optional state in `reduceTimeline` is the local precedent.
No fetched remote feature branch overlaps the planned files. Codegraph reports no
initialized project index; source reads and text search supplied the caller audit.

## Files read

- `src/shared/wire/types.ts` → `CompactingPayload`, `EnvelopeType`: wire contracts.
- Daemon `internal/protocol/interactive.go` → `CompactingPayload`, `CompactionBoundaryPayload`: shipped outcome strings and nullable counts.
- `src/main/transport/inboundMessage.ts` → `parseCompactingPayload`, `optionalString`, `parseInboundMessage`, `decodeHistoryEvent`: shared validation and content-free diagnostics.
- `src/main/daemonConnection.ts` → `createDaemonConnection`: explicit named-field IPC emission.
- `src/shared/ipc/events.ts` → `DaemonEvent`, `HistoryTimelineEvent`: renderer event contracts.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor`, `useTimelineBridge`: per-conversation routing and subscription cleanup.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `TimelineState`, `reduceTimeline`, `reduceTimelineContent`: retained rows versus transient status.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor`, `prependHistoryFor`: retained Map slices and immutable row references during prepend.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts` → their exhaustive translators: new event must explicitly no-op.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`: existing session delimiter rendering.
- `src/renderer/src/screens/conversation/conversation.css` → `.session-delimiter` rules: spacing, equal hairlines, text and painted-part shadows.
- `src/main/transport/modelRefusal.test.ts`, `src/main/daemonConnection.test.ts`, `src/renderer/src/store/threadTimeline.test.ts`: decoder/IPC/reducer test patterns and old compaction assertions.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/model-refusal.spec.ts` → fake-daemon frame delivery and navigation patterns.
- `docs/knowledge/features/development-verification.md` → evidence barriers, Electron approval and focused checks.
- `docs/knowledge/features/conversation-timeline-store.md`, `thread-timeline.md` → retained slices and reconnect status cleanup.
- `docs/knowledge/features/inbound-message-decode-contract.md`, `daemon-connection.md` → validation boundaries and named-field transport mapping.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-session-and-channel-info.md` § Session-boundary delimiter → reuse existing styles; static markup cannot prove layout.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

Read design context and its screenshot, plus the screenshot endpoint. The approved
session-reset row places a body-small centered label between equal one-pixel rules,
with 12px gaps and a subtle shadow on the painted parts. Reuse `.session-delimiter`,
primary/inverse-primary theme roles and existing spacing/shadow tokens; a failed
compaction changes the label to the existing error role. No image asset is needed.

## Design

Extend `CompactingPayload` with optional open `compact_result` and `compact_error`
strings. Add `CompactionBoundaryPayload` and its envelope/inbound kinds with a
required conversation id and open string trigger, plus optional nullable counts.
Use the existing optional-string validator for outcomes. Wrong required shapes or
present non-string outcomes/triggers fail closed; unusable counts normalize to
absence so they never suppress the divider itself. Zero is valid. Unknown keys
are discarded. `parseInboundMessage` logs only static kind, byte count and hash.

Carry named fields through `DaemonEvent` and `translateTimelineEvent`. Reuse the
compacting parser for history's existing compacting arm and carry its outcome fields;
new boundary history/pagination recovery is outside this ticket. Add no-op cases
to the three unrelated exhaustive bridges. Route live boundaries by their own id.

Add a `compactionBoundary` item holding a classified failure flag, manual flag and
optional counts, never raw daemon prose. An observed active-to-inactive edge appends
one item. `compact_result === 'failed'` or any nonempty error wins; other results
retain the generic success label. Repeated inactive frames do nothing.

An optional pending-row reference on `TimelineState` identifies the most recent
non-failed completion. Preserve it across unrelated events, scrolling, history
prepend and reconnect; a new active edge, consumed boundary or reset clears it.
Delayed metadata replaces that exact referenced item in place. With no matching
item, append a standalone boundary. A failed item never becomes pending. This
reference avoids index drift when existing history prepends rows or user echoes
are removed. No ids, timestamps or content are invented for correlation.

Add `compactionBoundaryTitle` beside the existing boundary view model. It returns
`Compaction failed` or `Conversation compacted`, optionally `, X → Y tokens` only
when both counts are nonnegative safe integers, followed by ` by you` only for
manual compaction. Counts below 1000 render as integers; larger counts render in
thousands rounded to one decimal with trailing `.0` removed. `TimelineRow` uses
the existing delimiter DOM and an error modifier for failures.

## State and concurrency

All reductions remain synchronous within the existing conversation Map. There are
no new async jobs, subscriptions, timers or storage writes. `useTimelineBridge`
keeps its existing unsubscribe cleanup. Reconnect's direct status reset never
passes through an inactive compaction event, so it cannot manufacture a row.
Retention ends when the existing holder clears or evicts that conversation.

## Error handling

Malformed required fields produce static `WireDecodeError` categories and follow
the existing main-process drop path. Optional unusable counts omit the count phrase.
Compaction failure is a retained display outcome, never a connection failure.
Result, trigger, error and conversation id strings never reach label/attribute/log
sinks; only client-owned label fragments, classified booleans and valid counts do.

## Testing strategy

- First run failing focused decoder, reducer and label tests before production edits.
- Decoder tests: old outcome-free frames, strict malformed shapes, unknown result/trigger tokens, null/missing/zero/unusable counts and content-free logs.
- Reducer/bridge tests: edge idempotence, delayed enrichment after content, new-compaction supersession, standalone boundaries, failures, conversation isolation, pending reference survival and reconnect without false completion.
- Static render tests: label formatting and error modifier; update existing assertions that intentionally expected no row on completion.
- Fake-daemon Playwright: automatic/manual/failed frames, generic label before metadata, standalone boundary, successive compactions, other-conversation routing, scroll/navigation/reconnect retention. Assert observable delivery barriers before absence checks and capture the real delimiter for Figma comparison.
- Gate: touched unit specs, `npm run build`, and only `e2e/compaction-divider.spec.ts` through the approved Electron launcher. No live Claude run required.

## Open questions

None. Nullable and unusable count policy follows the AC; retention is bounded by
the existing timeline holder, not disk persistence or offline recovery.

## Documentation handoff

Pending documentation stage: fold the divider's lifetime and delayed-metadata
behaviour into `docs/knowledge/features/conversation-timeline-store.md` § What it
does / Edge cases and limitations, and
`docs/knowledge/features/conversation-shell-session-and-channel-info.md` § Session-boundary delimiter.
This carries the refiner's handoff; the issue has no separate documentation AC.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseCompactingPayload` and the new boundary parser validate opaque input before explicit IPC projection; a required malformed identity cannot route a row. `conversationTimelineStore` uses a Map, not a prototype-bearing object.
- [Hostile reports] Counts must be safe nonnegative integers before display. Raw open strings are classified by exact equality/nonempty checks and never rendered. Unknown keys do not cross the decoder.
- [Logs/errors] Existing `inbound-decoded` diagnostics contain only static codes, length and hash. Decode failure catches discard caught prose; add tests with hostile marker strings.
- [IPC/Electron] Only a typed inbound event is added to the existing channel; no new renderer-to-main capability, navigation, remote document, or raw socket access is introduced.
- [Tokens/crypto/storage] No credential, cryptographic operation or disk/web-storage path changes. The feature holds display facts in renderer memory; existing Noise transport and safeStorage ownership stay in main.
- [Network/I/O] Parsing inherits `parseInboundMessage`'s plaintext cap. The feature introduces no socket, URL, timeout or reconnect mechanism and leaves transport policy intact.
- [Concurrency] Reductions do not await. Pending identity is a held row reference, with explicit supersession and consumption. Reconnect preserves received items without synthesizing edges.
- [Threat alignment] Hostile-daemon shapes are covered above; relay drops cannot be repaired by this received-row feature. Offline recovery and history pagination remain the existing transport/history owners' scope, not a new mitigation proposed here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-11
