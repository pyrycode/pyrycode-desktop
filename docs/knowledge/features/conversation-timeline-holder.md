# Conversation timeline holder

The flat `timelineStore.ts` and keyed `conversationTimelineStore.ts` holders,
their factories/hooks/selectors and exclusive tests were deleted in #2030.
Navigation mutations had already retired in #2028 and renderer legacy saved IO
in #2029. There is no retained standalone holder or ten-slice eviction policy.

## What it does

Conversation content belongs to the host/conversation/epoch-scoped
[daemon item store](thread-item-store.md), composed by [thread runtime](thread-runtime.md).
Local unaccepted sends live in its separate pending-send store. No missing
snapshot or binding can recreate a legacy slice or select reconstructed rows.

## How it works

Shared row, event and live-feedback declarations remain at `threadTimeline.ts`;
task presentation declarations remain at `backgroundTaskRosterStore.ts`.
`timelineBridge.ts` retains shared translation, without content subscription,
delta joins, result filling or history reconciliation. Module names are not
proof that their former stores or producers survive.

### Local timeline admission

`beginLocalTimelineRead` and its standalone admission tests are deleted with the
holder. Authoritative restore retains owned protected reads, request/generation
fences and complete checkpoint certification. Legacy saved formats are never
converted for display. Main/IPC retirement (#2025) and saved-format/indexed legacy
storage retirement (#2026) remain separate.

### Confirmed deletion lifecycle

Confirmed deletion and unpair retain authoritative item, pending-send, live,
query, read and protected-storage cleanup and ordering. They no longer consult or
flush a legacy holder. Missing sidebar content is not evidence of resource
removal; use [runtime lifecycle coverage](thread-runtime.md#renderer-producer-retirement-validation).

### Stopped records and history isolation

Current-session composer reports derive from canonical items and admitted live
readings. History recovery uses authoritative queries; it cannot revive a retired
legacy send window, stop record or refusal offer. Exact displayed session-error
consumption remains identity-fenced and deferred through a microtask.

## Configuration and usage

Use `threadRuntime.items`, `threadRuntime.sends` and scoped live state. Do not
import `createConversationTimelineStore`, `selectTimelineFor`, `markViewed`,
`dispatchFor` or legacy local-read/clear methods: those APIs no longer exist.

## Edge cases and limitations

The deleted holder's eviction ordering and local-count unread discontinuities
are historical behavior, not constraints on current daemon item retention.
Protected offline cache, deletion/unpair and stale-callback fences survive.

## Related decisions

- [Renderer producer retirement](thread-runtime.md#navigation-boundaries) — deletion scope and surviving main/storage contracts.
- [Conversation shell](conversation-shell.md) — authoritative presentation and composer.
- [Historical holder implementation](../codebase/755.md) — frozen design and eviction rationale.
- [Historical write paths](../codebase/756.md) and [clears](../codebase/757.md).
