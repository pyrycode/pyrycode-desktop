# #1737 — Notification body previews the reply, or the action awaiting approval

## Files read

- `src/main/fireNotification.ts` → `NOTIFICATION_COPY`, `notificationTitle`, `fireNotification`: the fixed body and the title-cleaning precedent (#1593) the body cleaner sits beside.
- `src/shared/ipc/commands.ts` → `NotifyKind`, `NotifyPayload`, `isNotifyPayload`: the payload gains `preview`, the guard bounds it.
- `src/main/index.ts` → the `'notify'` case of the command switch: passes `payload.preview` through.
- `src/renderer/src/store/pushNotifyBridge.ts` → `subscribePushNotify`, `usePushNotify`: the send path gains an optional preview lookup after the existing gates.
- `src/renderer/src/store/conversationTimelineStore.ts` → `ConversationTimelineState`, `ConversationSlice.serverId`, `receivedSlice`: the preview source, keyed by conversation id only; a slice's `serverId` is the receipt host stamp, possibly absent.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` arms `assistantText` (`turnId`, `text`) and `toolCall` (`name`, `result`).
- `src/renderer/src/screens/conversation/toolHeadline.ts` → `toolHeadline`: the collapsed tool row's subject text, reused as `<target>`.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `markdownPlainText` (#1630): remark-parse + `remarkGfmSubset` walk that already drops emphasis, heading hashes, fences, bullets and link URLs while keeping link text and code content. Reused rather than writing a second walker.
- `src/main/fireNotification.test.ts`, `src/renderer/src/store/pushNotifyBridge.test.ts`, `src/shared/ipc/commands.test.ts`: the tests the new cases sit beside.

Overlap: feature/1726 and feature/1770 touch `commands.ts` and `src/main/index.ts` in unrelated blocks; edits here stay local to the notify block.

## Design source

N/A — native OS notification, as in #391 and #1593. No app screen changes.

## Context

The body was always one of two fixed lines. This relaxes the "body is static and main-owned" invariant the same way #1593 relaxed the title: the renderer may offer an optional `preview`, and main has the final say (cleans, caps, falls back to the fixed copy). Mobile has a matching ticket with the same 200-character cap, fallback copy and "Wants to run" wording. The invariant change may deserve an ADR note in the notification overview (documentation stage's call).

## Design

**Shared (`commands.ts`).** `NotifyPayload.preview?: string` — untrusted, renderer-derived, plain text. `isNotifyPayload` rejects a present, non-`undefined` `preview` that is not a string or whose `.length` exceeds `MAX_NOTIFY_PREVIEW_LENGTH = 4000`; a rejection fails the whole command closed, like a mistyped `name`. Content is not judged there. Doc comments on `NotifyKind`, `NotifyPayload` and `isNotifyPayload` updated to state the relaxed invariant.

**Main (`fireNotification.ts`).** `notificationBody(kind: NotifyKind, preview: string | undefined): string` beside `notificationTitle`:
1. `undefined` → `NOTIFICATION_COPY[kind]`.
2. Each control character (`\p{Cc}`) is dropped, except whitespace controls (`\n`, `\t`, `\r`…), which become a space — so a line break reads as a word gap rather than gluing two words.
3. Each run of whitespace collapses to one space; ends trimmed.
4. Longer than `MAX_BODY_CHARS = 200` code points → first 199 code points + `…` (total 200, code-point counted so no surrogate pair splits). Trailing whitespace before the `…` is trimmed.
5. Empty → `NOTIFICATION_COPY[kind]`.

`fireNotification(kind, deps, name?, preview?)` uses `notificationBody(kind, preview)`. `src/main/index.ts` passes `command.payload.preview`. Nothing logs it.

**Renderer (new `src/renderer/src/store/notificationPreview.ts`).**
- `notificationPreviewIn(state: ConversationTimelineState, event: NotifyEvent): string | null` where `NotifyEvent` is the stamped `turnEnd | modalShown | questionShown` arms (local type, not exported as a new public type beyond the bridge's need).
  - Slice = `state.timelines.get(event.conversationId)`. Absent (never seen or evicted past `MAX_RETAINED_TIMELINES`) → `null`. A slice whose `serverId` is set and differs from `event.serverId` → `null` (same "stamped and different" test the store's own `receivedSlice` uses).
  - `turnEnd`: newest `assistantText` item with `turnId === event.turnId` (walk items from the tail). `markdownPlainText(text)` strips markdown. None → `null`. Never another turn's text.
  - `modalShown` with `class === 'permission'`: tool = `event.prompt`; newest `toolCall` with `result === null` and `name === tool`; `Wants to run ${tool}: ${toolHeadline(item)}`. No match → `null`.
  - Trust modal, `questionShown` → `null`.
  - The result passes through `boundPreview`: collapse whitespace, trim, cut to `NOTIFICATION_PREVIEW_CHARS = 200` code points with a trailing `…` when cut; empty → `null`. Collapsing before cutting is what keeps the `…` when main re-applies its own rules (a raw 200-unit cut full of newlines would shrink under main's collapse and lose its cut marker). The renderer cut is what keeps a long reply far below main's 4000 bound.

**Bridge (`pushNotifyBridge.ts`).** `subscribePushNotify(..., isMuted?, previewFor?: (event: NotifyEvent) => string | null)`. Called only on the send path, after the dedup, toggle and mute gates, beside `nameFor`. A preview rides as `payload.preview`; `null` omits the key (never a present `undefined`). Optional, so existing callers/tests are unchanged and send no preview. `usePushNotify` passes `(event) => notificationPreviewIn(conversationTimelineStore.getState(), event)` — read at event time, no refetch.

## State + concurrency model

No new state. The lookup is a synchronous read of the timeline store snapshot inside the existing listener. The deltas and `toolUse` that feed the slice arrive before the `turnEnd` / `modalShown` they describe and `timelineBridge` files them under their own conversation regardless of which one is open. No new subscription, nothing to tear down.

## Error handling

All functions are total: a missing slice, server mismatch, missing item or empty result yields `null` (renderer) or the fixed copy (main). An oversized or non-string `preview` fails the `notify` command closed at `isRendererCommand` (no notification, as for a bad `name`). Nothing new is logged; neither the preview nor reply or tool text reaches a log.

## Testing strategy

Vitest only (no UI, no interaction):
- `commands.test.ts`: string preview accepted; 4000-char accepted; 4001-char rejected; non-string (number, null) rejected.
- `fireNotification.test.ts`: `notificationBody` — absent → fixed copy per kind; 4000-char preview → 200 code points ending `…`; control chars dropped and newlines/tabs collapsed to single spaces; whitespace/control-only → fixed copy; astral characters not split at the cut. `fireNotification` passes the cleaned preview as `body`.
- `notificationPreview.test.ts`: turnEnd picks the newest assistant text of that turn, markdown stripped (emphasis, heading, fence, bullet, link URL gone; link text and code kept); earlier turn's text ignored → `null`; no slice → `null`; server-mismatched slice → `null`; permission modal → `Wants to run Bash: npm test` from the newest result-less matching row; row with a result or a different name → `null`; trust modal and questionShown → `null`; long text cut to 200 with `…`.
- `pushNotifyBridge.test.ts`: `previewFor` result rides as `payload.preview`; `null` omits the key; not consulted when toggle off or muted. All existing gate tests unchanged.

## Open Questions

- Whether `toolHeadline` returning `''` should count as a match. Leaning yes (the row matched); main trims the trailing space.
