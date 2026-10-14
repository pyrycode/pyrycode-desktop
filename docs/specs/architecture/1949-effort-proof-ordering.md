## Files read

- `e2e/real-claude-effort-default.spec.ts` → `observe`, `showFresh`, `refresh`: any reply-count increase currently freezes the footer oracle.
- `e2e/offline-session-settings.spec.ts` → `observeCommands`: read-only CDP command observation without replacing the preload bridge.
- `src/shared/ipc/events.ts` → `DaemonEvent`: conversation-scoped readings and change-correlated acknowledgements.
- `src/shared/ipc/commands.ts` → `RendererCommand`: settings requests identify conversations; writes identify sessions and changes.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`: confirmation remembers effort and triggers a fresh reading.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `subscribeRunConfig`: foreign conversation replies cannot update the footer.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `development-verification-live-test-diagnosis.md`: counted live proof, no retries, daemon provenance.
- `docs/knowledge/features/last-effort-store.md`, `composer-effort-menu.md`: saved and applied effort are separate; keep bootstrap effort empty to prove recall.

## Context

The #1947 original report records a 21,769ms failure at the final channel change: `showFresh` expected low while the footer remained medium. Its focused rerun passed in 18,434ms, on daemon release 0.39.0. The reports have no settings sequence, so they establish the mismatch, not its exact historical ordering. The old helper can freeze an obsolete reply even when the product correctly advances; deterministic replay will establish this mechanism and live runs will attach the observed sequence.

One test-observation deliverable, approximately 350 written lines including regression and plan, no production changes, at most five helper exports, no consumer migration. No overlapping remote feature branch touches this spec. No UI presentation change or ADR required.

## Design

Add a helper beside this spec, consumed only by this proof and its Vitest regression. Record only settings requests, effort writes, settings acknowledgements and selected reading fields in a synchronous page-local ordered list. Use the existing read-only CDP function-call observation pattern for outbound commands; preserve their execution unchanged. Models and announcements retain their independent observer.

`selectEffortProof(events, after, intent, footer): Reading | null` uses the intended conversation (or the operation's settings request for a newly created conversation), the latest reply for that conversation, and any required saved/applied effort. A write proof also requires its matching change acknowledgement and a subsequent reading for that session. A newer conflicting reply supersedes an older matching one. Sample evidence and footer together, then poll the selector within the existing ROUNDTRIP deadline. Never substitute the chosen value for the daemon footer oracle.

Every creation, opening, sheet read, refresh and effort change gets a checkpoint before its action. Preserve first-opening saved-choice checks separately from the final applied/selected proof, preserving chat recall versus channel creation semantics. Attach the selected fields and ordering on success or failure; omit message text, model vocabulary and secrets.

## State + concurrency model

Test-only page lifetime state. The Electron fixture owns page teardown and restart; each new page gets an empty observer. Dispose CDP observation and the event subscription when the observer is released. No product store or async job changes. One bounded proof poll re-samples current evidence each time.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Obsolete reply followed by current reply | `obsolete reply followed by current evidence` deterministic regression |
| Unrelated conversation or acknowledgement | `unrelated evidence cannot settle the operation` regression |
| Latest reply supersedes an older matching reply | `superseded evidence cannot pass` regression |
| Missing current reply / persistently wrong footer | `missing current evidence or incorrect footer stays pending` regression |
| Same conversation refresh / consecutive effort choices | named live scenario and regression checkpoints |
| Electron restart / explicit conversation reopen | named live scenario, new observer and original conversation ID |
| Chat recall / channel creation effort | named live scenario, first-opening and correlated-write checks |

## Error handling

Missing required evidence or footer disagreement stays pending until the existing bounded deadline fails, with ordered settings evidence attached. No longer timeout, sleep, retry or alternate-label acceptance. Product errors remain outside this test-only repair.

## Testing strategy

Write deterministic Vitest regression first and show the old frozen-reading logic failing the obsolete/current ordering. Cover correlation, supersession, missing evidence and wrong footer with the same selector used by the live proof. Run the named live scenario three consecutive times through the configured launcher with retries disabled; record counts, daemon release and executable build identity. Merge final main, run pre-verify and build. Dispatcher owns the full real-Claude acceptance gate.

## Open Questions

None. If sequence evidence establishes a production defect beyond this observer repair, return its precise contract requirement for refinement.
