# Stopped turns

## Context and sizing

Retain the daemon's stopped-turn report in the thread and offer transient recovery
for the latest live stop. One deliverable: plumbing without its sole display consumer
cannot be independently accepted. Estimate 750 written lines, eight production TS/TSX
files plus CSS, four acceptance criteria, at most two new exported types/components,
three consumer sites updated together, and fewer than ten new reject branches.
The file overage uses the ticket's explicit one-consumer floor exception. The nearest
analogue is #1244's 422 inserted implementation/test/plan lines; this adds decoder and
history coverage. Refreshed remote feature branches have no overlapping files.

## Files read

- `src/shared/wire/types.ts`: `TurnEndPayload` — optional wire fields.
- `src/main/transport/inboundMessage.ts`: `parseTurnEndPayload`, `decodeHistoryEvent`, `DecodedHistoryEvent` — common live/history validation.
- `src/shared/ipc/events.ts`: `DaemonEvent`, `HistoryTimelineEvent` — named IPC fields.
- `src/main/daemonConnection.ts`: `createDaemonConnection` — live forwarding and content-free diagnostics.
- `src/renderer/src/store/timelineBridge.ts`: `translateTimelineEvent` — renderer translation.
- `src/renderer/src/store/threadTimeline.ts`: `ThreadItem`, `ThreadEvent`, `TimelineState`, `reduceTimeline` — retained boundary and transient state.
- `src/renderer/src/store/historyPageBridge.ts`: `reduceHistoryPage` — scratch fold returns rows only.
- `src/renderer/src/store/conversationTimelineStore.ts`: `dispatchFor`, `prependHistoryFor` — conversation isolation and replay insertion.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `TimelineRow`, `Composer`, `ComposerSlot`, `ComposerErrorSlotControl` — presentation and existing send path.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx`: `COMPOSER_ACTIONS` — client-owned Compact command.
- `src/renderer/src/screens/conversation/composerActionAvailability.ts`: `markUnavailableActions` — published availability guard.
- `src/renderer/src/screens/conversation/conversation.css`: `.session-delimiter__title`, `.composer-status` — reusable tokens.
- `docs/knowledge/features/development-verification.md`: source checks and evidence — static renders cannot prove clicks or layout.
- `docs/knowledge/features/conversation-shell.md`, `conversation-timeline-holder.md`, `thread-timeline.md`, `daemon-connection.md`, `inbound-message-decode.md` — owning topics; history must not restore chrome.

Codegraph context returned an uninitialized-index error; source reads replaced it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

The reference has a centered primary-colored body-small label between two fine rules.
Reuse its label typography and shadow for the stopped record, with single-line
ellipsis inside a shrinkable row.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The composer status sits above the input, with body-small status text and a small
trailing action. Reuse the existing status-message and small-button classes for
recovery, as approved in the ticket; no new imagery or tokens.

## Design

Preserve optional `outcome`, `is_error`, `terminal_reason`, `error_category` through
both decode lanes, camel-case IPC, translation, and the boundary. Optional strings
must be strings of at most 256 UTF-8 bytes; otherwise omit. Preserve false and empty
strings distinctly from absence. Required-field validation remains unchanged.

One pure stopped-report formatter implements the ticket's precedence and wording.
Cancellation suppresses the display first. A stop requires true isError or a nonempty
non-success outcome. Meaningful terminal reason wins; otherwise use outcome aliases,
API category, unknown outcome, or generic error. Sanitize controls at the text sink,
bound there too, and append the reported category as plain React text.

Keep an optional latest live boundary reference beside timeline items. The reducer
sets it on turn end and clears it on local userText, non-idle turnState, or daemon
turn content/activity. Idle preserves it. Reset/reconnect clear it; history's scratch
fold returns items only, so old stops cannot restore recovery. The holder already
isolates this state per conversation and evicts it with the timeline.

Supply the status area through a render callback to Composer via ComposerSlot, so
the recovery action receives Composer's existing sendText callback. Keep the status
area outside the hidden composer subtree. Compact checks markUnavailableActions
against the open conversation's list at render and click time, then sends the
client-owned `/compact` through sendText. The typed draft is never cleared by this
action. Existing Reset remains unchanged. Connection/re-pair failures precede
recovery, and recovery precedes usage notices. Billing/auth guidance is static copy
about Claude on this server, with no settings action.

## State, concurrency, and errors

No new store, IPC command, subscription lifetime, timer, or async job. Existing
React store hooks own teardown. The send callback retains its connection and
conversation guards and existing failure handling. Report strings never enter logs;
existing turn-end decode diagnostics already record static event type, size and hash.
Malformed optional metadata cannot discard an otherwise valid boundary.

## Testing strategy

- Decoder tests: live/history parity, missing/empty/false, wrong types, unknown values,
  UTF-8 byte bounds and existing required-field rejection.
- Reducer/render tests: all wording, success-with-error, cancellation, controls/HTML,
  idle retention, activity clearing, replay rows without recovery, and conversation isolation.
- Fake-transport Playwright: max turns; context overflow and Compact dispatch without
  draft loss; unavailable Compact; API/category guidance; slot priority, retained
  records and recovery clearing. Check one-line containment at 800px.
- Run touched Vitest files, build, and the focused Playwright spec. Dispatcher owns
  full regression tests; no live compaction claim.

## Documentation handoff

No explicit documentation requirement or path/section was supplied. Documentation
stage owns updates to the relevant feature topics for stopped records and recovery.

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseTurnEndPayload` validates optional types and UTF-8 sizes for
  both live and history. Unknown strings are display reports, never authority.
- Hostile daemon/rendering: formatter strips control characters and bounds text;
  React children escape markup. No reported value enters attributes, URLs, lookup
  paths, command text, or diagnostics. Tests include malicious and multibyte strings.
- Action authority: Compact is client-owned and user-triggered; published metadata
  can disable it but cannot change its command. Existing send guards remain mandatory.
- Tokens/storage/crypto: no credentials, persistence, RNG, Noise or key changes.
- Electron/network: no new bridge APIs, navigation, socket operations or remote content.
- Logging: existing static decode diagnostics suffice; never log reported reasons.
- Concurrency: state stays in the existing per-conversation holder; scratch history
  cannot write live recovery. No new lifetime or cancellation obligation.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-11
