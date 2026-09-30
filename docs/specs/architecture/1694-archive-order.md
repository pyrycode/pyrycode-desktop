# Archive by most recently archived (#1694)

## Files read

- `src/shared/wire/types.ts` → `ConversationSummary`: optional fields preserve existing fixtures and saved rows.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`, `parseInboundMessage`: allowlisted, fail-closed list decode and existing content-free frame logging.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: detached projection of protected saved lists.
- `src/renderer/src/screens/archive/archiveViewModel.ts` → `partitionArchived`, `archivedSubtitle`: archive-only derivation and relative-time composition.
- `src/renderer/src/screens/archive/ArchiveScreen.tsx` → `ArchiveScreenView`, `ArchiveRow`: pure rendering and subtitle source.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `partitionByPromotion`, `formatLastActivity`: preserve partition behavior and time buckets for other callers.
- Existing co-located parser, archive view-model and screen tests: factories and static-render patterns.
- `e2e/fixtures/realDaemon.ts` → `test`: Claude-less registry lifecycle and isolated daemon teardown.
- `e2e/real-daemon-create-channel.spec.ts`, `e2e/real-daemon-conversation-lifecycle.spec.ts`: product create/archive interaction seams.
- `docs/knowledge/features/archive-screen.md`: superseded wire-order and last-message subtitle claims are the documentation handoff.
- `docs/knowledge/features/inbound-message-decode.md`, `chat-history.md`, `conversation-list-store.md`, `development-verification.md`: fail-closed projection, protected storage, flattened host rows and non-vacuous live proof.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=18-2 (row 18-19).
The inspected context and screenshot show a back/title header, Channels and Discussions tabs, and rows with title above muted small “Archived …” text and a trailing restore icon. Retain the existing `ArchiveScreenView`, theme-token typography, colors and geometry; only row order and the subtitle time source change. Existing icon differences are outside this ticket.

## Context and scope

Daemon PR #2700 adds nullable `archived_at`; archive order must reflect archive actions rather than host or last-use order. This is one behavior with decoder and live-proof support, not a general list-order refactor. Estimate: about 500 total written lines, five production files, four acceptance criteria, no new exported type/component/store, one changed production subtitle call site, and no state machine. The nearest analogue is #1594's optional list flag decode/snapshot extension; sorting and live proof account for the extra work.

In-flight #1657 adds a capability constant in `types.ts`; it does not touch `ConversationSummary` or supply a dependency. Keep this declaration edit local.

## Design

- Add `archived_at?: string | null` to `ConversationSummary`, mirroring the shipped daemon field. Live `parseConversationSummary` always emits strings or null, maps absence to null and rejects other types without echoing content. Do not validate timestamps at decode time.
- `parseChatHistorySnapshot` preserves string/null and accepts old snapshots with no field. Preserve absence on those legacy snapshots to avoid changing their projected shape.
- A shared archive-local selector returns the valid selected timestamp or null. Archive stamps require RFC3339 date/time/zone syntax and a parseable calendar instant; fall back to a parseable `last_used_at`. Bare dates and permissive JavaScript date formats are not archive stamps.
- `partitionArchived` filters, partitions and sorts fresh tab arrays across the flattened hosts. Descending selected instants precede invalid rows; ties use raw UTF-16 id comparison, then stable input order. Neither rows nor source arrays mutate.
- `archivedSubtitle` accepts the row and uses the same selector, feeding the selected string to unchanged `formatLastActivity`; no selected instant means bare `Archived`. `ArchiveRow` supplies the row instead of `last_message_ts`.

## State and concurrency

No new store, task, subscription or optimistic state. Existing host-scoped re-listing and saved-list writing retain the new field. Pure derivation recomputes on the existing list render seam. The real-daemon spec uses `spawnClaude: false` and waits for each archive's completed navigation/re-list before the next action; fixture teardown owns app, relay and daemon processes.

## Error handling and logging

Wrong field types use existing `WireDecodeError` or static snapshot validation errors. Invalid timestamp content is a normal legacy fallback, not a new classified transport error. Inbound frame acceptance and rejection retain existing structured content-free logging; never log archive strings, titles, paths, credentials or caught payloads. No new I/O or IPC result shape.

## Testing strategy

- RED then GREEN on live decode preservation, absent/null normalization, wrong-type whole-list rejection, invalid-string retention and snapshot restoration/round-trip.
- View-model tests cover both tabs across hosts, mixed stamped/legacy rows, invalid archive/fallback times, non-RFC3339 archive strings, equivalent offset instants, UTF-16 id ties, stable equal rows and frozen input.
- Static screen renders prove different-by-weeks timestamp sources, legacy/invalid archive fallback and bare subtitle, retaining existing buckets.
- Add `e2e/real-daemon-archive-order.spec.ts`: name the old seeded channel, create a newer channel, archive the older first and newer second with positive completion gates, then assert the newer is first in Channels. Creation order provides ascending last-used order opposite the expected archive order. Record daemon build revision and executed result; no Claude or credential.
- Run touched unit files and `npm run build`. Capture the real component with synthetic rows in scratch at the Figma size and desktop minimum width; compare the existing layout and new text/order with the design.

## Open questions

- Does the installed dedicated daemon contain PR #2700? Resolve before live execution; the installed September 25 binary predates the September 30 merge. If no suitable clean test revision is available, hand the exact focused spec and prerequisite to the dispatcher without claiming live acceptance.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/archive-screen.md`, sections “How it works” (the pure view-model and row subtitle descriptions) and relevant behavior/edge-case claims, with the ordering rule, legacy/invalid-time fallback and subtitle source, replacing old claims that wire order is authoritative here and no archive timestamp exists.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseConversationSummary` and `parseChatHistorySnapshot` validate the new field's type independently; strings remain untrusted content. Wrong-type rows reject the list, never coerce objects into dates.
- Tokens/secrets: no credential generation, storage or lifecycle change. Live spec uses the existing fixture's pairing fields without logging or attaching them.
- File/storage operations: only an allowlisted scalar joins existing protected snapshots; no field becomes a path, filename or cache key. Existing secure storage and atomic persistence remain responsible for at-rest data.
- Electron attack surface: no new bridge/channel/window/navigation capability; `ArchiveRow` renders client-formatted dates as React text children. Keys and sockets remain in main.
- Cryptography: no primitive, nonce, key or Noise variant changes; real fixture reuses the established transport.
- Network/I/O: no new socket or frame limits; existing inbound frame bounds and list decode apply. No relaxed TLS or relay policy.
- Logs/telemetry: existing static rejection categories and frame hash/length logging; archive timestamp contents never reach diagnostics.
- Concurrency: sorting is synchronous and non-mutating; no async state race or new cancellation ownership. Fixture teardown owns all live resources.
- Threat alignment: a hostile daemon can choose ordering metadata but cannot turn it into markup, attributes, URLs or filesystem operations. Relay, disk-token theft and renderer isolation defenses stay in their existing modules; no new threat surface requires a deferred fix.

**Reviewer:** builder (self-review per `builder/security-review.md`). **Date:** 2026-10-01.
