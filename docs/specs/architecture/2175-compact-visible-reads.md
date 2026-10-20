# Compact visible reads

## Files read
- `src/renderer/src/store/threadCompact.ts` → `createThreadCompact`: root completion, consumption, gaps and lifecycle ownership.
- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`: automatic selection and independent complete evidence.
- `src/renderer/src/store/conversationReadPublisher.ts` → `readTargetFor`, `useReadObservation`: committed viewport proof and bounded acknowledgement/resend.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `ThreadItemsView`: immutable display snapshot and mounted observer.
- `src/renderer/src/store/conversationReadPublisher.test.ts` and `e2e/compact-demand.spec.ts`: target and production opening regressions.
- `docs/knowledge/features/thread-runtime-compact.md`, `thread-runtime.md`, `development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: compact evidence must never enter complete persistence; mounted observation requires Electron.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read context and screenshot: fixed sidebar with host/channel trees and unread dots, adjacent conversation pane and input footer. Preserve existing components, theme tokens, dimensions and decorations; only read-state behaviour changes.

## Context
Automatic compact opening currently disables visible-read publication. Its zero checkpoint/no-range display snapshot must remain separate from complete history. One behaviour ships here: an evidenced visible compact root marks the conversation read, with its regression proof. Comprehensive diagnostics belong to #2176. No ADR needed.
Overlaps: #2089 changes live-store removal in `threadRuntime`; #2163 adds send tests in `compact-demand`; neither is a dependency.
Sizing: about 650–750 written lines including this plan and tests, at most two new exported types, four production files, fewer than ten consumers/error branches and five observable acceptance criteria. No independently useful plumbing slice.

## Design
Compact snapshots hold a read watermark independent of their query cursor and consumed watermark. Only a successful newest/catch-up marker establishes it, then contiguous admitted live updates can advance it. Root coverage comes from the certified compact window or an admitted live row. Gapped consumption cannot bridge missing evidence; older/detail completion cannot establish newest authority.
Pass compact evidence with the exact immutable rows used to construct the committed display snapshot. `readTargetFor` selects compact authority explicitly and checks identity, scope, target bound and root coverage without borrowing complete fields. Keep the existing complete branch and DOM focus/visibility/overlay/queued fences.
Compact owns route selection for its epoch. A lifecycle token validates held render evidence across same-epoch reselection, reset, deletion, unpair, suspension and disposal. Retire read authority before publishing lifecycle changes. Reconnect preserves the publisher's existing bounded resend of already observed targets.

## State + concurrency model
Compact query callbacks retain their existing request/selection/connection ownership. Read evidence is immutable per compact snapshot; a current-scope predicate only withdraws authority and cannot upgrade older committed evidence. React's layout effect installs the committed inputs before observation. No new async job or subscription is introduced.

## State transitions and identity reuse
| Event | Proof |
| --- | --- |
| Incomplete data then newest completion | compact unit and mounted production compact read regression |
| New summary before row/evidence commit | mounted production compact read regression |
| Contiguous shown update; hidden-only update; gap and recovery | compact unit and mounted production compact read regression |
| Older/detail completion | compact unit; existing compact demand test |
| Same-epoch reselection, reset, delete, unpair, dispose | compact lifecycle unit regression |
| Reconnect/resend/acknowledgement | existing publisher units and mounted acknowledgement/reopen regression |
| Retained complete evidence beside incomplete compact | mounted retained-complete control and publisher unit |

## Error handling
Existing compact query failures and Retry remain unchanged. Missing, incomplete, stale or gapped evidence withholds eligibility. Existing content-free compact lifecycle/query logs remain; exhaustive skip reasons are #2176.

## Testing strategy
Test first: compact target unit controls and mounted production automatic-opening regression fail before implementation. Unit tests cover evidence admission/retirement and complete compatibility. Electron verifies successful marker processing, committed tail, viewport scroll, exact outgoing read, daemon acknowledgement, deduplication and reopening, with processing/commit barriers around absence assertions. No descendant/body prefetch. Run focused affected units, pre-verify, build and focused Playwright on Linux; replay the retained complete thread scenario separately.
Current-daemon/mobile scenario: if access is unavailable, hand to Juhana with a pre-merge hold: read an unread long agent-heavy compact channel to newest root; prove daemon read advance to `last_shown_version` and companion mobile clearing retained after reopening. Required evidence: Desktop build/revision, daemon version/revision, four accepted capability booleans, numeric before/after targets and executed/passed/failed/skipped counts (at least one executed). Replay cannot satisfy this.

## Open Questions
None. Prefer extending the existing compact snapshot over a separate evidence store, keeping commit pairing and retirement in one owner.

## Documentation handoff
Pending documentation stage: update `docs/knowledge/features/thread-runtime-compact.md` under “Root facts and independent evidence” and “Live controls and read publication” in `docs/knowledge/features/thread-runtime.md`: replace the unconditional compact-receipts-withheld statement with the compact-specific visible-read contract, preserving the prohibition on borrowing complete/persistence evidence.

## Revisions
2026-10-20: Route ownership fits inside `createThreadCompact`, alongside its selection and generation checks, so `threadRuntime.ts` needs no edit. A per-opening route token also rotates on reset, while reconnect preserves already observed pending targets. Render evidence captures the connection, generation, exact display snapshot, watermark and certified root IDs; current-scope checks only revoke it. Successful overlapping captures preserve a later contiguous live watermark. Row versions beyond held read progress cannot borrow an older root certificate.

Regression evidence: the new unit failed before implementation (`undefined` instead of target 10). Restoring the original compact observer guard in a controlled build made the mounted test fail at the exact first outgoing mark (expected 10, received none); `/tmp/builder-2175/before-mounted.log`. Restoring the repair passed both automatic compact variants, with and without retained complete checkpoint 100: 2 executed/passed, 0 failed/skipped. The affected unit batch passed 202/202. Final post-merge checks are recorded in the PR.

Live handoff / pre-merge hold for Juhana: companion mobile access is unavailable in this Linux worker (`adb` absent; no connected companion session). The current-daemon cross-client scenario above has **0 executed, 0 passed, 0 failed, 0 skipped** here and remains unverified. Before merge, run it against the candidate Desktop build and record Desktop revision/build, daemon revision/version, accepted `interactive`, `thread`, `thread_expansion`, `thread_compact` booleans, numeric prior read/last-shown/acknowledged targets, mobile clear/reopen result and nonzero executed counts. Local fake/replay results do not satisfy this hold.
