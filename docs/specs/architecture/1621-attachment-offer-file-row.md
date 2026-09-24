# #1621 — show a file the assistant sent as a file row in the thread

## Files read

- `src/shared/ipc/events.ts` → `attachmentOffered` arm of `BaseDaemonEvent` — `conversationId`, `attachmentId`, `filename`; the security contract the row inherits (filename is claude-authored display text, never a path, attribute, URL, key or log field).
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` (the dormant `attachmentOffered` case in the no-op group, placed by #1620), `timelineTargetFor` (the `resetting` / `sessionTransition` group routes by the frame's own `conversationId`), `timelineWriteTarget` (enumerates only `reconnected`; an attributed arm never reads the screen).
- `src/renderer/src/store/threadTimeline.ts` → `MessageAttachment`, `ThreadItem`, `ThreadEvent`, `reduceTimelineContent` (`banner` / `unrecognizedMessage` tail-append arms), `reduceTimeline` (the `latestTurnEnd` clear list — an offer is not in it).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow` (exhaustive `switch (item.kind)` with no default, so a new kind is a compile error there), `BubbleAttachmentRow` (the file row; `onClick` calls `downloadAttachment(attachmentDownloadDeps, attachment)`), the `userText` arm's `isImageAttachmentName` fork, `Timeline` (keys rows by index, never by item content).
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → `BubbleAttachmentImage` — goes through `attachmentImageSources`, which fetches on `unavailable`, so an assistant-offered image with no local original still resolves.
- `src/renderer/src/screens/conversation/downloadAttachment.ts` → `downloadAttachment` — local-original ask, then `requestAttachment` + save on `unavailable`. Unchanged.
- `src/renderer/src/store/chatHistoryWriter.ts` → the timeline subscription's `capture({ … items: [...items] … })` — assigns `ThreadItem[]` to `DurableThreadItem[]`, so a new `ThreadItem` kind is a type error there.
- `src/shared/chatHistory.ts` → `DurableThreadItem`, `threadItem` parser — the on-disk item set; an unknown kind fails the parse.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble--daemon`, `.bubble__file` (`margin-top: var(--space-3)`, `color: var(--color-inverse-primary)`, body-small type), `.bubble__image-button` / `.bubble__image-fallback` (same `margin-top`).
- `docs/specs/architecture/1620-attachment-offered-ipc-carry.md` — the carry slice; its security review hands flood rendering to this ticket.

No in-flight branch touches any of these files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4605 (in context: node 102-4)

`File field` is a row: the 45×60 stroked file glyph with the extension (`PDF`, body-small emphasized) overlaid across its lower half, 12px gap, then the filename as one line of body-small text, both in `Schemes/Inverse Primary` (`--color-inverse-primary`). In 102-4 it sits inside an assistant bubble (`bubble--daemon` fill) on the left. This is exactly what `BubbleAttachmentRow` / `AttachmentFileIcon` already draw, so the row is reused as is; the only visual addition is dropping the row's leading `margin-top` when the file is the bubble's only content.

## Context

#1620 carries `attachment_offered` to the window as the `attachmentOffered` daemon event; `translateTimelineEvent` drops it. This slice turns it into a thread item in the conversation it names and draws it with the existing file row / image tile, activating through the existing `downloadAttachment` path. No ADR.

## Design

### Store (`threadTimeline.ts`)

- New `ThreadItem` arm: `{ kind: 'attachmentOffer'; attachment: MessageAttachment }`. No `turnId` (the frame has none), no `createdAt` (no meta row is drawn).
- New `ThreadEvent` arm: `{ type: 'attachmentOffered'; attachment: MessageAttachment }`.
- `reduceTimelineContent` arm: if `state.items` already holds an `attachmentOffer` item whose `attachment.attachmentId` equals the event's (strict string equality), return `state` (same reference). Otherwise tail-append a fresh item `{ kind: 'attachmentOffer', attachment: { attachmentId, filename } }` built by name (never a spread) and carry every chrome scalar unchanged (`{ ...state, items }`): an offer is not turn activity, so it neither clears a stall nor opens/closes the local send window, and it is not in `reduceTimeline`'s `latestTurnEnd` clear list.
- The dedupe key is compared, never used as a Map key, lookup path or React key.

### Bridge (`timelineBridge.ts`)

- `translateTimelineEvent`: move `attachmentOffered` out of the no-op group; return `{ type: 'attachmentOffered', attachment: { attachmentId: event.attachmentId, filename: event.filename } }`. `conversationId` stops here (the `resetting` discipline). Rewrite the dormant-case comment in the no-op group to a one-line "now an owned arm" note.
- `timelineTargetFor`: add `attachmentOffered` to the group that returns `event.conversationId` (with `resetting` and `sessionTransition`). The key is required and non-empty-checked upstream by the decoder. Consequently `timelineWriteTarget` never consults the open conversation for it.

### Render (`ConversationScreen.tsx`)

- `TimelineRow` new arm `attachmentOffer`:
  `<div className="message-row message-row--daemon"><div className="bubble bubble--daemon bubble--attachment-offer" data-thread-role="assistant">` then `isImageAttachmentName(item.attachment.filename) ? <BubbleAttachmentImage attachment={item.attachment} /> : <BubbleAttachmentRow attachment={item.attachment} />`.
- No `BubbleMeta` (nothing to copy, no timestamp). No key derived from the filename or id; `Timeline` keys by index as today.
- `BubbleAttachmentRow` is reused unchanged, so activation is the same closure: `downloadAttachment(attachmentDownloadDeps, attachment)` with the offer's id and filename.
- `conversation.css`: `.bubble--attachment-offer > :first-child { margin-top: 0 }` — the file row / image / fallback each carry `margin-top: var(--space-3)` for the text-above case; with no text above it would pad the bubble's top. Specificity (0,2,0) beats the single-class rules without `!important`.

### Durable history (`chatHistoryWriter.ts`)

The ticket makes offers live-only ("keeping offers across a reconnect or history reload" is out of scope; the wire cannot resupply them). The on-disk item set (`DurableThreadItem`) therefore does not gain the arm. The writer's timeline `capture` filters `attachmentOffer` items out before snapshotting, via a type guard `(item): item is Exclude<ThreadItem, { kind: 'attachmentOffer' }>`. Consequences: no claude-authored filename is written to disk by this ticket, and a restored-from-disk thread shows no offer rows, consistent with live-only. Offers are only ever appended at the tail by live frames, so removing them never shifts the head rows `prependedRows` counts.

## State + concurrency model

No new store, slice, timer or async work. The reducer arm is synchronous; the keyed `conversationTimelineStore` receives it through the existing fan-out. Activation is the existing `downloadAttachment` listener lifecycle.

## Error handling

Malformed frames never reach the window (#1619's fail-closed decoder). A download failure is already handled by `downloadAttachment` (content-free `console.error`). An image that fails to fetch or decode draws the existing client-owned fallback copy.

## Testing strategy

vitest only (static renders; activation is the existing row's handler, per the ticket's technical notes).

- `threadTimeline.test.ts`: an offer appends one `attachmentOffer` item with both fields; a second offer with the same id returns the same state reference; a different id appends a second item; chrome scalars (`stalled`, `localSendPending`, `phase`) carried unchanged; an offer after a `userText` echo carrying the same attachment id still appends (dedupe is against offer items only).
- `timelineBridge.test.ts`: `translateTimelineEvent` maps the arm to the fresh literal with no `conversationId` key (pinned with `Object.keys`); `timelineTargetFor` returns the frame's `conversationId`; `subscribeTimeline` dispatches with that key; the #1620 dormant assertions flip.
- Keyed routing: a `conversationTimelineStore`-level (or `useTimelineBridge` fan-out) case showing the offer lands in the named conversation's slice only, with another conversation open.
- `ConversationScreen.test.tsx`: an offer item renders inside `message-row--daemon` / `bubble--daemon bubble--attachment-offer` with `data-thread-role="assistant"` and the `bubble__file` button; an image name renders the image container path (no file button); a filename containing `<script>` and quotes appears only escaped in text content and never inside any attribute value.
- `chatHistoryWriter.test.ts`: a timeline holding an offer captures a snapshot without it.

## Open questions

- Whether the offer bubble should carry `BubbleMeta`: resolved no — the item has no text to copy and no timestamp, and the Figma `File field` has none.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: the timeline store / daemon-event-bridge package overviews under `docs/knowledge/features/` should record the `attachmentOffer` item, its routing by `conversationId`, its dedupe-by-attachment-id rule, and that it is deliberately excluded from durable chat history.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the untrusted→trusted boundary is `parseAttachmentOfferedPayload` in main (#1619), and #1620 copies its fields by name across IPC. This slice copies them by name again in `translateTimelineEvent` and the reducer arm (never a spread), so no extra key reaches the item. All three fields stay peer claims: `conversationId` only selects a slice through `timelineTargetFor` (the same trust `resetting` and `sessionTransition` already get), and `attachmentId` is compared for dedupe and passed to `downloadAttachment`, never interpreted.
- [Tokens] No findings — no token, key or credential is touched.
- [File / storage] Addressed — `filename` is never a path here: it reaches main only through the existing `saveAttachment` request, where `sanitizeAttachmentFilename` rebuilds the path; `attachmentId` reaches the filesystem only through `resolveAttachmentPath`'s guard in main and is length-bounded by `addressable` before any subscription. The offer is excluded from the chat-history snapshot in `chatHistoryWriter.ts`, so this ticket writes no claude-authored filename to disk.
- [Electron attack surface] No findings — no new IPC channel, preload API or `webPreferences` change; activation uses the existing `openLocalAttachment` / `requestAttachment` / `saveAttachment` bridge calls, each validated in main.
- [Crypto] No findings — no primitive touched.
- [Network & I/O] No findings — nothing new on the socket. Fetches are operator-initiated (click) or, for an image name, the existing thumbnail fetch capped at 4 concurrent in main.
- [Error messages, logs] No findings — the reducer, bridge and row log nothing; `downloadAttachment`'s errors are static strings with no id or filename. The filename renders only as React text children inside `bubble__file-name` / the fallback span; the image's `alt` is the client constant `ATTACHMENT_IMAGE_ALT`; no attribute, `key`, URL or class is derived from it (asserted in the render test with a markup-bearing filename).
- [Concurrency] No findings — synchronous reducer arm; the dedupe is a linear scan over the slice's items, not a daemon-keyed memo.
- [Threat model] Hostile daemon: can (a) announce a file into any conversation id — bounded, since `conversationId` only picks which slice holds a row, the same power it has for every other routed arm; (b) name an image extension on non-image bytes — draws the decode-failure fallback, never a different file; (c) flood distinct offers — OUT OF SCOPE: each adds one row, the same unbounded-append posture as `assistantText`, `banner` and `unrecognizedMessage`, which a hostile daemon can flood today; a timeline-wide item cap would be its own ticket if flooding is ever observed. Repeats of one id are deduped. Renderer compromise gains nothing new: the row holds only display strings the renderer already receives.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24

## Revisions

- 2026-09-24, build: `chatHistoryContract.test.ts` pins `DurableThreadItem` equal to `ThreadItem` minus live-only fields (#1565 precedent). It now also excludes the `attachmentOffer` kind, the type-level half of the writer filter above. Test-only; the design is unchanged.
