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

## Revisions

- 2026-10-05 — Open question resolved without a design change: an empty `toolHeadline` still counts as a match (the row matched); the renderer's trim, and main's again, leave `Wants to run <tool>:`.
- 2026-10-05 — PR #1773 verifier rework: audited the existing design under `builder/security-review.md` and recorded the required security verdict below. No interface or runtime behavior changes are required. Correct `stateWith` so the unstamped-slice test actually omits `serverId`, assert that omission, and revise `isNotifyPayload`'s comment to describe its two optional text fields and static fallback. Rechecked remote overlaps: #1726 still touches `commands.ts` in unrelated command blocks; #1770 is now on main.

## Documentation handoff

Pending for the documentation stage, from the PR #1773 verifier review:

- `docs/knowledge/features/push-notifications.md`, sections **What it does**, **Key types and files**, **The guard is the security-relevant line**, and **The copy table holds the body only**: update the static-body invariant, payload/signature examples and copy-table/guard explanations for the optional preview and fixed fallback.
- `docs/knowledge/features/push-notifications.md`, sections **The trigger (#392)** and **Edge cases and limitations**: document ending-turn selection, markdown stripping, unresolved matching tool headlines, server-stamp rejection, trust/question fallback, the 4000 UTF-16-unit IPC bound, and the 200-code-point renderer/main caps and cleaning rules.
- `docs/knowledge/features/push-notifications.md`, sections **Why the command is main-local, not wire** and **Edge cases and limitations**: record the intentional trust-boundary change and consider an ADR note. Carry forward the resolved empty-target behavior (`Wants to run <tool>:`), reuse of `markdownPlainText`, and whitespace collapse before truncation.

## Security review

**Verdict:** PASS

Audit of the written design and its existing implementation for PR #1773 rework. Additional files read: `src/main/receiveCommand.ts` → `onCommand` validates before dispatch and logs only a fixed rejection string; `src/main/transport/relayConnection.ts` → `createRelayConnection` retains the existing socket payload cap; `src/main/transport/inboundMessage.ts` → `parseInboundMessage` retains the existing plaintext-size boundary. No MUST FIX or SHOULD FIX security findings remain.

**Findings:**

- [Trust boundaries] No findings — `onCommand` calls `isRendererCommand` / `isNotifyPayload` before the main-local notify handler. `kind` remains a closed enum with exhaustive fallback copy; `preview` is optional untrusted text, type-checked and capped at 4000 UTF-16 units. `notificationBody` independently removes controls, collapses whitespace and caps the OS body at 200 code points. `notificationPreviewIn` rejects a differently stamped server and selects only the ending turn or a matching unresolved tool row; it does not treat renderer cleaning as a main-side guarantee.
- [Tokens, secrets, credentials] No findings — this change creates no credential or storage surface. The existing click token remains an opaque `crypto.randomUUID()` correlation value, validated by `isNotificationToken`, never interpreted as authority or derived from preview text. Reply/tool content intentionally becomes visible in OS notifications under the existing push, mute and focus gates; OS notification history is part of that approved display surface, not private app storage.
- [File and storage operations] No findings — preview lookup is an in-memory timeline read and `notificationBody` feeds only `Notification`'s plain-text body. It performs no file access or persistence and uses no preview as a filename, path, URL or cache key. Reusing `toolHeadline` shortens display text only, without accessing a path.
- [Electron attack surface] No findings — no new channel or bridge capability; the existing `notify` payload alone is extended. Main reconstructs `{ title, body }` rather than spreading renderer fields into Electron options. Neither `markdownPlainText` nor the OS body evaluates HTML, follows links or executes tool text. The existing window's sandbox and context isolation remain enabled; process placement and navigation policy are unchanged.
- [Cryptographic primitives] No findings — preview selection, cleaning and notification display introduce no cryptographic operation and modify no Noise variant, key, nonce, token storage or transport code. Transport and credentials remain in main.
- [Network and I/O] No findings — notify is main-local and returns without any transport call. `notificationPreviewIn` reads already-received typed timeline data without fetching; existing relay `maxPayload` and inbound plaintext limits are unchanged. The 4000-unit IPC guard bounds main-side cleaning even for a compromised renderer, and the legitimate renderer caps previews before sending.
- [Errors, logs, telemetry] No findings — malformed payloads are dropped with `onCommand`'s fixed warning only. The notify handler, `fireNotification`, `notificationPreviewIn`, `markdownPlainText` and `toolHeadline` do not log preview, reply or tool content. Missing/empty data uses fixed copy without exposing a parse error or adding telemetry.
- [Concurrency] No findings — selection and main cleaning are synchronous, with no await, refetch, new state or async job. The existing listener's unsubscribe remains the effect cleanup. Dedup, push and mute gates still precede preview lookup; main checks focus before constructing the notification. Reconnect/unpair ownership and click routing are unchanged.
- [Threat model alignment] No findings — a hostile daemon can choose notification text but gains only the intended bounded plain-text display, never a command, markup or navigation sink. A compromised renderer must pass the main guard and cleaner and gains no new filesystem/socket/key access. Relay confidentiality, flooding defenses and credential storage retain the existing main-process transport/storage owners; this change adds no bypass. Unicode format characters are outside the specified control-character policy, as with the existing title; displaying daemon text does not establish its truth or grant it authority.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
