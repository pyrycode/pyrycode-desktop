# Visible compact delivery

## Files read

- `src/renderer/src/PairedShell.tsx` → `openConversation`, created activation: both production entry points.
- `src/renderer/src/store/threadRuntime.ts` → `open`, `handle`, `observeReports`: route and live ownership.
- `src/renderer/src/store/threadCompact.ts` → `createThreadCompact`: session-only roots, coverage and recovery.
- `src/renderer/src/store/threadBodies.ts` → `demand`: finite leases, rendered bodies and summary pages.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`, `ToolRow`: expansion, pinning and presentation.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `threadItemIndex`: complete presentation stays independent.
- `src/renderer/src/screens/conversation/threadComposerReports.ts` → `threadComposerReports`: admitted full reports.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`: actual handles required.
- `src/renderer/src/store/conversationReadPublisher.ts` → `useReadObservation`: complete committed evidence only.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/thread-runtime.md`, `docs/knowledge/features/thread-runtime-compact.md`: existing ownership and renderer constraints.
- Core `docs/protocol-mobile.md` → Compact projection / Bounded expansion reads: headers, full roots and rendered bodies are distinct authorities.
- `docs/knowledge/features/development-verification.md`, shared working practice, sizing policy and visual-review recipe: counted mounted proof and artifact ownership.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-4939

The collapsed row is a horizontal headline, target and result summary with the existing bordered chip, mono lead and body text. Preserve existing theme tokens, spacing and expansion control; rendered body text uses existing body presentation. Reference screenshot: `/tmp/builder-2128/figma.png`.

## Context

Production currently opens complete history even when compact delivery is accepted. Activate one usable compact route, keeping canonical complete history, saved restoration and receipts independent. Selection without expansion and a demand adapter without its sole route are not useful independent slices. The earlier complete-route pruning has already shipped in #2127.

Sizing: approximately 1400 written lines including integrated proof and this plan, at most five exported declarations and eight production consumer updates, five observable criteria, no new reject state machine. This exceeds the ordinary line ceiling under the verification-floor exception documented on the ticket. No further independently useful slice was found. No new dependency, IPC or wire types. Runtime overlaps #2079 (scheduler) and #2089 (departed-host lifecycle); keep route edits additive and local.

## Design

Production selects compact from the owning accepted handshake, with session-held projection retained while offline. Recovery re-evaluates current capabilities. Explicit runtime compact selection remains available; complete callers retain their existing contract.

Render compact roots explicitly. Full non-tool roots reuse existing Markdown, attachments, delivery and queue rendering. Summary rows remain summaries and never enter canonical items or acquire fabricated action handles. Tool expansion demands a body; agent expansion demands children at the existing default 50. An independent agent launch-body control demands its body. Group expansion reveals headers only. Child continuation uses the supplied cursor and `more`, never page length. Supplied direct-child counts remain labelled as children, with unknown counts omitted.

Keep demand in mounted expanded areas. Each uses its lease's state, retained content and explicit retry/continue callbacks. Rendered input/output is adapted only for body presentation, never installed as canonical item content. Preserve source IDs and existing pin measurements across content updates.

Full admitted roots feed nonvisual reports and actual task handles independently of row expansion. Header lifecycle/error facts may supply display status but never fabricate identities. Compact views supply no read observer or complete certificate, including when a complete snapshot is retained.

## State + concurrency model

Runtime owns connection/selection and compact scope. React owns only expansion sets and mounted leases. Effects release on collapse, ancestor/run closure, route exit, connection replacement and scope generation change, and reacquire against the current owner. Cache invalidation refreshes active demands; subsequent pages still need user action. Failure stays failed until explicit Retry.

## State transitions and identity reuse

| Event | Proof |
| --- | --- |
| Existing/new conversation opening, capability omission and owner mismatch | runtime activation units and mounted compact scenario |
| Tool/agent/nested/group open and close | mounted compact scenario request counts and absent components |
| Cached reopen, invalidation, page continuation | mounted compact scenario and existing lease units |
| Disconnect/recovery, capability replacement, offline reopen | runtime units and mounted compact scenario |
| Scope replacement/navigation with late reply | mounted compact scenario and existing runtime ownership units |
| Retained complete history and compact progress | runtime units and mounted no-receipt assertions |
| Held response while typing | mounted native input under 1000 ms |

## Error handling

Use existing classified query/cache states. Compact query failure exposes Retry and cannot fall back to complete. Expanded detail shows loading, stale retained content, failed Retry or offline unavailability. No new rejection branches or logged daemon content.

## Testing strategy

Write route-selection and presentation regressions first, observe failure, then implement. Unit tests establish capability/owner selection and summary/body authority. Mounted fake-transport Electron coverage uses at least 8333 generated source items, positive frame/commit barriers and normal teardown for demand, recovery, controls, anchoring, input and receipts. Run affected units through pre-verify, build and configured guarded client replay on Linux. Capture integrated 1280 and 800 views for comparison. macOS is outside this ticket's scope.

## Open Questions

None. The protocol supplies rendered input/output rather than canonical tool content; adapt at the visible body only.

## Revisions

2026-10-19: The resumed implementation exposes pending compact root queries in the existing compact state so initial, Older and Retry loading remain observable. Runtime `presentation(host, chat)` returns zero-evidence display facts for the selected compact route; delivery settlement, refusal reports and actual task handles use those admitted roots rather than retained complete history. This does not certify or persist them. Group collapse clears compact member expansion; nested demand belongs to the mounted parent detail so ancestor collapse releases and resets nested expansion. Rendered tool output keeps the existing preformatted result presentation.

2026-10-19: Mounted recovery found that selecting from a later session-store subscription sent a complete query before upgrading to compact. Production now calls `open(host, chat, { projection: 'auto' })`; the runtime chooses from the accepted owning handshake before reconnect dispatch and publishes its selected projection. Explicit complete/compact callers keep their contracts. Active leases follow cache-owned revision invalidation rather than reacquiring on each revision, preventing duplicate replacement reads. The mounted Older fixture returns only roots inside the requested interval, preserving the decoder's range checks.

2026-10-19: Selection generation also reacquires leases when an already-open conversation is selected again, while preserving its screen-local expansion and reading state. Supplied direct-child counts use the existing header outcome slot. Final written scope is approximately 700 lines, below the ordinary ceiling; the integrated verification floor is retained. The lifecycle table's mounted proof is `e2e/compact-demand.spec.ts`: `production compact demand keeps 8333 source items off the wire until visible expansion` covers grouping, bodies, children, nesting, continuation, invalidation, held input, controls, recovery, Older and creation; `compact Retry, retained complete evidence and late navigation replies remain independent` covers explicit failures, scope replacement, late replies, conservative receipts with retained history and offline reselection. `visibleThread.test.ts` covers accepted capability/owner changes and compact evidence independently of complete checkpoints. `compactPresentation.test.tsx` covers headers, summary-only messages and closed-parent reports without fabricated task identities.
