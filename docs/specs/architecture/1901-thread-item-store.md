# Retained daemon thread items

## Files read
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: landed decoded delivery contract.
- `src/main/transport/threadUpdates.ts` → `logical`: validation precedes store application; patches retain presence and explicit clears.
- `src/renderer/src/store/conversationTimelineStore.ts` → `ConversationTimelineStore`: independent retained store precedent; no reducers or consumers change.
- `docs/knowledge/features/conversation-timeline-store.md` and `conversation-timeline-holder.md`: legacy reconstruction and host ownership must remain separate.
- `docs/knowledge/features/development-verification.md` → Source and contract checks / test tiers: pure store proof needs no Electron.
- Daemon `docs/protocol-mobile.md` → Daemon thread updates (v2, supplied delivery contract): replacements are shallow; append requires exact base.
- Daemon decision `042-daemon-built-thread.md`: daemon owns identity, placement and attribution.
- `package.json`: existing Zustand and Vitest suffice.

## Context
Keep daemon facts separately from reconstructed legacy timelines. This ticket supplies
an independently testable store for sync/cache consumers; requests, reply certification,
persistence and production wiring belong to #1902/#1903/#1908. No new ADR is needed.
One deliverable: revision-aware retention with its complete-progress contract.
Sizing: approximately 300 production + 360 tests + 70 plan = 730 lines; four exported
types, one store factory, zero migrated consumers, five observable criteria, at most
nine rejection categories. Remote feature branches have no overlap with these new files.

## Design
Add `src/renderer/src/store/threadItemStore.ts`, a vanilla Zustand factory.
`ThreadSnapshot` holds host/conversation/epoch, ordered inert items, applied `version`,
`checkpoint`, certified `ranges` and optional `olderAvailable`, plus repair progress.
Held items guarantee identity/kind/revision; remaining fields are inert unknown JSON,
allowing explicit null clears without lying about the full-item DTO's optional types.
Nested Maps scope snapshots by host then conversation. Map insertion order is the stable
arrival tie-break; only numeric daemon order moves an item ahead of unordered items.
Full items replace only on greater item revision, including absent optional fields.
Kind disagreement requests repair even when a full item's revision is old.
Changes require exact base and increasing target revision; immutable id/kind changes
reject. Copy own properties safely; content replaces wholesale. Appends require a
user/assistant message with own string content.text, preserving other content fields.
Inputs are detached/frozen inert JSON; prototype-like keys remain own data properties.
`ThreadApplyResult` discriminates applied/ignored, scoped repair and stale ownership.
An optional content-free event logger records epoch, update, batch, repair and cleanup.

## State + concurrency model
`acceptEpoch(host, conversation, epoch)` explicitly establishes/replaces one slice;
updates never automatically switch epochs. The factory has no global singleton,
transport, React, background task or subscription. Zustand publishes immutable scoped
snapshots while untouched conversations retain reference identity.
`beginBatch(host, conversation, epoch)` captures a private generation symbol and returns
applyItems(items, version), commit(certificate), and abandon methods. Applying decoded
items can publish newer facts/version but never checkpoint or coverage. Only #1902 may
supply `ThreadBatchCertificate`: fromVersion/version, certified ranges and optional
older availability. Commit is one-shot, refuses failed/abandoned/stale handles, merges
ranges and monotonically publishes complete progress without replacing held items.
Live success advances checkpoint only without repair. Repair records checkpoint as
its lower bound and greatest missing version as its upper bound; a completion must
cover both to clear that fence. A page outside that interval cannot repair it.
Certificates explicitly own range boundaries; active items/parents cannot widen them.

## State transitions and identity reuse
| Event | Unit scenario in `threadItemStore.test.ts` |
| --- | --- |
| Duplicate append / delayed base | replay and missing/mismatched bases |
| Repeated full item / delayed batch | revision merge and live/full races |
| Queue delivered / equal order | stable arrival and supplied placement |
| Incomplete, abandoned, repeated commit | completed batch ownership |
| Repair then live updates / partial repair | repair checkpoint fencing |
| Same epoch accepted repeatedly | epoch idempotence |
| Epoch replaced twice / old epoch reused | epoch generation ownership |
| Conversation/host/pairing clear then reuse | stale batches after each cleanup |
| Equal host/conversation/item identities | scoped isolation |

## Error handling
No I/O exceptions. Repairs classify missing item, base mismatch, incompatible update,
kind conflict or insufficient repair coverage. Stale handles cannot recreate state.
Malformed wire data stays at the decoder boundary. Certification validates numeric
bounds; the caller, not the store, proves a server reply completed. Repair results
carry scope for #1902; only static reason codes reach diagnostics. No UI changes.

## Testing strategy
Write failing Vitest tests first beside the store. Supplied complete-batch fixtures
exercise explicit commit versus incomplete progress, item/reply races, null/false/zero
replacement, inert unknown JSON, append applicability and all lifecycle rows above.
Run focused tests, pre-verify (full unit suite/typecheck) and build after final main merge.
No Playwright or live test: this ticket owns no mounted or interactive production path.

## Open Questions
Cleaner shape considered: one generic event reducer would obscure batch ownership;
use named sync methods and a scoped generation-bound handle. No unresolved questions.

## Revisions
- 2026-10-10: The unfinished-batch regression exposed that successful live appends
  can use an item from a partial reply. Retain a private highest uncommitted batch
  version; live successes cannot advance the checkpoint until certification covers
  it, even after abandonment. Delayed completion publishes only its certified
  version while preserving newer held facts. Certificates cannot start beyond the
  held checkpoint. An exhausted oldest boundary cannot reopen from a delayed reply.
- 2026-10-10 (verifier finding 1): Ignored equal/older batch items can still carry
  uncertified progress while a repair fences newer live facts. Compute the pending
  batch version before `success` checks for a no-op, and publish when it increases.
  `retains uncertified progress from %s batch revisions during repair` covers both
  revisions, abandonment, partial repair completion and live resumption only after
  certification covers the pending batch version.

## Documentation handoff
- Pending for the documentation stage: document retained identity/revisions, exact-base
  updates and inert JSON, separately from the legacy timeline.
- Pending: document snapshot/batch certification, repair and unfinished-batch checkpoint
  fencing, certified ranges and older availability; only #1902 certifies replies.
- Pending: document generation-bound cleanup; requests, persistence and activation
  remain #1902, #1903 and #1908.
