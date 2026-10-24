# Canonical message reply scenarios

## Files read
- `e2e/message-reply.spec.ts` → `quote`, `expectDraftEnd`, `heldReplyDrain`, `savedReplies`: six existing mounted product scenarios and their input/persistence barriers.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: per-host facts, revision ownership and correlated opening/reconnect query certificates.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`: independently select canonical publishing on both hosts.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake`: retain list/create controls; register created chats before their first query.
- `e2e/status-icon-local-send.spec.ts` → authored user receipts: bind acceptance to actual device/message identity.
- `docs/knowledge/features/e2e-harness.md` and `development-verification.md`: positive processing barriers, canonical isolation and sequential native ABI preparation.
- `docs/recorded-tests.md` and `docs/client-replay-migration.md`: complete configured gate retains captured clients, native storage prerequisites and live-only boundaries.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository conventions and ownership.

## Context
Replace legacy content translation in all six reply scenarios with authored daemon thread facts. No production or visual change. Existing family work is merged in main; the remote feature-branch audit found no overlap in the owned spec. Forecast: about 250 written lines, zero exported contracts/production files, eight host configurations, four observable acceptance criteria, no new production reject branches. The six scenarios jointly prove the reply fixture migration; keep their single-consumer setup here.

## Design
Use a spec-local host configuration factory returning canonical mode, a fresh publisher and supported list/create controls. Seed every opened conversation with an explicit summary/session, epoch, version and empty item set. Register created chats before returning their creation control. Keep thread queries with the canonical publisher and never consult history aliases.

Author `thread_item_added` assistant facts, revisioned `thread_text_append` suffixes and `thread_item_changed` terminal status. Use explicit unique orders and session/turn ownership. After the first actual send, publish an authored delivered user item bound to its outgoing message ID and authenticated device ID. Do not infer acceptance from the assistant reply or send callback.

## State + concurrency model
Only test-side per-host publisher state changes. Each launch owns its publisher, including equal conversation/item IDs. Existing fixture teardown owns all Electron/transport resources. Preserve the actual preload suffix receipt observer and held frame/timer drains; publication continues while renderer application is held.

## State transitions and identity reuse
| Event | Existing scenario covering it |
| --- | --- |
| Partial → suffix received while drain held → settled source | `held suffix distinguishes visible partial content from current-source readiness` |
| Stream grows, repeated pointer/keyboard quote, edit/send, created-chat return | `pointer and keyboard replies append current source, focus once, and send the edited quote intact` |
| Repeated permission display/dismissal and chat navigation | `inline permission replies focus immediately without dismissal replay, and drafts and focus stay isolated on chat switch` |
| Equal chat/item/session identity on two hosts | `reply isolates equal conversation ids across hosts` |
| Protected save before offline reopen and other-chat draft | `reply appends and focuses in a reopened saved offline chat` |
| Independent protected records before/after offline reopen with equal IDs | `received history is saved for equal ids on different hosts and replies reopen offline` |

## Error handling
Keep existing failure controls, timeouts and disabled-offline Send assertions. Publisher validation rejects accidental legacy content or incorrect ownership. No production failure modes change.

## Testing strategy
- Select canonical mode first and observe the existing legacy push fail at the publisher, then replace those inputs with shared-wire facts.
- Preserve every existing product assertion, trusted input, geometry/copy check, held-drain comparison, suffix barrier, cursor settlement and actual protected `readThread` polling.
- Run pre-verify with the canonical publisher's affected fixture unit coverage, application typechecks, client-test typecheck, a scratch focused TypeScript config including this spec, and `npm run build` after merging main.
- Finish Node checks before Electron native preparation. Run all six cases in the configured clipboard project with zero retries; record revision, Linux and counted results. The complete configured application gate (captured replay/native prerequisites included) remains dispatcher/verifier-owned; reuse exact-candidate evidence, no duplicate full sweep or new live proof. Another OS is outside scope.

## Open Questions
None.
