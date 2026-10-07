# Save equal-id received history independently by host

## Files read

- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: synchronous ownership admission, detached snapshots, host-scoped buffered writes and removal handling.
- `src/renderer/src/store/chatHistoryWriter.test.ts` → `harness`: injected receipt context and real timeline store expose admission/refusal independently of IPC.
- `src/renderer/src/store/conversationTimelineStore.ts` → `receivedSlice`, `beginLocalTimelineRead`: a receipt replaces an explicitly different host with empty state, but stamps and retains previously unowned rows; restoration grants explicit ownership.
- `src/preload/index.ts` → `chatHistoryReceipt`: synchronous main-stamped receipt context, restored after subscriber delivery.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: protected-history requests require validated coordinates and saved-host membership.
- `e2e/message-reply.spec.ts` → equal-id saved-history regression: existing two-host fixture and saved/offline quote assertions.
- `docs/knowledge/features/chat-history.md` → Received-state admission and ownership: unknown retained rows must never acquire ownership from later receipts; protected storage already separates hosts.
- `docs/knowledge/features/development-verification.md` → Evidence that cannot pass too early: poll protected storage for completed saves and use a received-row barrier before absence assertions.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and test tiers.

## Change

Allow an explicit received host independently of other hosts' list claims. Keep the unique-list requirement for unstamped local echoes. In the writer, recognize clean replacement only when the previous slice has an explicit host different from the current receipt and the new slice stamp agrees with that receipt. The timeline store guarantees that this transition starts from empty state; release the previous observation/comparison metadata and admit the new owner without inheriting the old coverage. A newly assigned stamp on previously unowned rows is not replacement evidence. Retained unknown observations and nonempty unobserved rows continue refusing admission; explicit saved restoration remains the separate admission path.

The writer continues capturing detached snapshots synchronously, with pending/saved writes keyed by host, kind and conversation. Deletion, removal, durable filtering, scheduling and store/IPC contracts stay as implemented. No new declarations, consumer migrations, state surfaces or failure modes. One deliverable with three observable acceptance criteria; estimated total written work about 250 lines across one production file, unit/e2e tests and this plan, below all five sizing ceilings. The shipped queued-cancellation analogue supports a local writer repair with harness tests.

In-flight overlap: #1818 edits a different permission/focus test in `e2e/message-reply.spec.ts`; keep this regression local and build through the overlap. This persistence repair introduces no layout, chrome or navigation design.

## Testing strategy

- First run failing writer assertions: both list claims admit each stamped host; alternate deltas/completion and distinct history coverage before and after flush without row/coverage crossover.
- Restore an explicitly owned saved timeline while both lists claim its id; same-host receipt continues saving the restored rows/coverage.
- Missing origins, direct unowned installation and ambiguous unstamped echoes refuse saves; a later stamp does not retroactively own retained rows. A clean store-cleared replacement can resume recording.
- Update existing tests that treated store-cleared cross-host replacement as contamination, retaining independent refusal assertions for unowned retained rows and arbitrary echo removal.
- Enable and extend the equal-id browser regression: read both protected snapshots with distinct replies, visit the second host, disconnect the first, reopen offline and quote only the first reply into its draft. Keep existing draft isolation and ordinary offline tests enabled.
- Run focused writer units, the focused fake-transport reply scenarios, pre-verify check and build after the final merge of main. No live-Claude test is needed; the dispatcher owns its full browser tier.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — receipt origin comes from main-stamped daemon delivery through preload's `chatHistoryReceipt`; `createChatHistoryWriter` must require a matching new slice stamp and a previously explicit different stamp for clean replacement. Merely adding a stamp to retained unowned rows grants no authority. Active selection never participates.
- [Tokens, secrets, credentials] No findings — the repair handles display snapshots and host identities only, introduces no credential access, storage or logging.
- [File and storage operations] No findings — detached validated snapshots use the existing `chatHistory` bridge and protected main store. No paths or renderer web storage are introduced; main validates requests and saved-host membership, and existing secure storage/encryption availability behavior remains authoritative.
- [Electron attack surface] No findings — no bridge API, IPC argument shape, window, navigation or process-setting change. Existing protected-history validation remains in `createChatHistoryHandler`; transport and keys remain in main.
- [Cryptographic primitives] No findings — no randomness, keys, nonce, comparison or Noise change; protection at rest stays with the existing secure store.
- [Network and I/O] No findings — no new network operations, retries, downloads or I/O interface. Recording remains an observer of already-admitted typed daemon events.
- [Errors, logs, telemetry] No findings — unknown ownership continues reporting the static `unknown-ownership` code; neither received text nor snapshots are logged. Existing invalid-snapshot/IPC errors remain contained.
- [Concurrency] No findings — ownership and snapshots are captured synchronously before scheduling; release only the held conversation observation on clean replacement. Pending snapshots remain detached and host-keyed, so alternating hosts before a flush cannot reattribute rows or coverage. Existing serial drain, cancellation and host-removal generations remain intact.
- [Threat model alignment] No findings — hostile daemon content cannot override receipt origin through a list claim or obtain ownership for retained unowned rows. Relay delay/reordering is bounded by main receipt origin and existing store admission. Token theft/keychain unavailability and renderer compromise continue using existing process isolation, membership validation and protected storage; this change adds no security boundary or protocol responsibility.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
