# Newest history on opening and reconnect

## Files read

- `src/renderer/src/PairedShell.tsx` → `PairedShell`, `openConversation`: navigation owns the saved read and host/conversation target.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: owned read settlement and cancellation.
- `src/renderer/src/store/historyPageBridge.ts` → `requestOlderHistory`, `useHistoryPageBridge`: request guards and retained contribution admission.
- `src/renderer/src/store/conversationTimelineStore.ts` → `beginLocalTimelineRead`, `markHistoryRequested`, `recordHistoryPage`, `withHistory`: transient request state and durable paging evidence.
- `src/renderer/src/store/historyContributions.ts` → `reconcileHistory`: merged #1851/#1875 joins preserve held identities and live state, including suppressed subagent calls.
- `src/renderer/src/store/chatHistoryWriter.ts` → timeline capture: saves coverage, complete served receipts, display evidence and row identity independently.
- `src/renderer/src/screens/conversation/historyRetry.ts` → `retryHistoryPage`: captured failure and current ownership guards.
- `src/renderer/src/store/sessionStore.ts`, `activeConversationStore.ts`, `conversationActionAvailability.ts` → host-keyed statuses and current target resolution.
- `src/shared/ipc/commands.ts` → request-history payload validation; `src/main/daemonConnection.ts` → correlation and interruption settlement.
- `e2e/history-on-open.spec.ts`, `e2e/fixtures/realDaemon.ts`, `e2e/real-daemon-history-on-open.spec.ts`: trusted-input and protected-profile launch fixtures.
- `docs/knowledge/features/chat-history.md`, `development-verification.md`, `CLAUDE.md`, `docs/knowledge/INDEX.md`: receipts are exact evidence, legacy rows do not imply IDs, renderer units cannot drive interaction, live execution belongs to dispatcher.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read context and screenshot: vertical assistant/user bubbles, body-medium text, rounded theme surfaces, and separate tool/event rows. Reuse existing thread components, theme tokens and following/parked scroll behavior; no visual element or layout changes.

## Context

Held backwards completion cannot establish freshness after shutdown. Fetch one newest page per actual opening and owning-host connection edge; never download the missing range automatically. #1875 is closed and its suppressed-subagent grouping is present. No overlapping in-flight remote feature branch touches the planned source files. No ADR required.

One lifecycle deliverable; estimated 200 production, 380 tests/helpers and 75 plan lines, three new exports, five production files, five integration sites, five observable acceptance criteria, and six rejection/settlement branches. Both sketch and plan fit the size limits.

## Design

Add `createNewestHistoryDemand(deps)` with `sync(target, connected)`. Retain host/id identity, last connection state and one unsent demand outside React effects. Same target and connection updates do not create demand; navigation away clears it. A connected opening or disconnected-to-connected edge creates one demand, consumed before sending to prevent synchronous subscription replay.

`PairedShell` keeps the controller across effect replay and subscribes to active conversation, lists, session status and timeline changes. Its route and saved target identify the visible opening. Recheck active target and connected host at send time. Saved reads start before the effect can send; loading defers demand until settlement or owned live supersession. Cleanup removes every subscription; route departure invalidates demand.

Retain optional request cursor and purpose (`older` or `newest`) on pending/failed history state, preserving legacy constructors. A shared `requestHistoryPage` guard enforces local-read and pending exclusion plus current ownership. Backwards input additionally retains near-top/completed-walk guards. Retry resends the captured failed cursor and purpose, with legacy fallback to backwards coverage.

Successful newest pages retain existing received backwards coverage, while unknown coverage seeds from the newest response. Every response still records its exact complete served-ID receipt/cursor/start flag and contribution evidence through the existing admission path. No schema, wire or main-process changes.

## State + concurrency model

One request per owned slice; pending opening demand waits behind an existing request. Disconnect invalidates unsent demand; the next connected edge creates a fresh one after main's interrupted-request settlement. Page/read updates only release existing demand. Request failure consumes demand and never retries automatically. No timers or background jobs added. Read cancellation remains shell-owned; store read identity rejects obsolete completions.

## Error handling

Reuse typed IPC history failures and protected-read results. Missing, failed or superseded reads allow the owned newest ask. History failure preserves rows, receipts, display evidence and backwards coverage; existing generic Retry UI resends only a current retryable owned failure. No payload text or opaque cursor is logged.

## Testing strategy

- Test-first controller units count opening/offline/reconnect/navigation, equal-ID hosts, duplicate sync/effect replay, delayed read settlement/failure/live supersession and cancellation, and pending-request deferral.
- Store/Retry units prove held `atStart` permits newest refresh/Retry, exact failed cursor ownership, preserved backwards coverage, complete empty/undrawable receipts and validated protected restoration with legacy rows.
- Adapt fake history-on-open interaction to prove mounted newest rows without upward input, no arrival/programmatic-scroll cascade, reconnect refresh, and unchanged trusted upwards input gates.
- Adapt the real-daemon spec to save a conversation, fully exit Electron, post a unique channel marker while closed, relaunch the same protected profile and observe exactly one bubble without upward input. Dispatcher owns execution under `needs-real-claude`; all-skipped is insufficient.
- Final main merge, pre-verify full units/typecheck and build; run scoped fake specs. Capture integrated existing thread for visual evidence.

## Open Questions

None. Prefer the small retained controller over a new persistent lifecycle store; the opening identity belongs to shell navigation, not page state.

## Revisions

2026-10-07 rework (findings 1–4): `beginLocalTimelineRead` must carry the same-host history request through read start, completion and cancellation so reopening waits for the original correlated settlement. Add actual shell leave/reopen coverage and unit cases for created/failed-read empty slices. Settle opening before asserting trusted-input gates, keeping pending exclusion separate. Consume the automatic first page in the agent reconstruction test. Use the existing real-daemon fixture's protected-profile `relaunch` and its isolation checks; add an optional `whileClosed(): Promise<void>` callback after awaited process exit and before launch so the test can post while closed. Fixture edits stay additive beside in-flight #1364 and #1544; neither supplies a needed dependency.

2026-10-07: `createChatHistoryWriter` derived coverage from the last response rather than the slice's retained paging coverage. Capture `slice.coverage` on successful settlement so newest receipts and oldest-end paging evidence survive protected restoration together. This adds a sixth production file, without another deliverable or exported declaration; total written work remains below 800 lines.

2026-10-07: The protected-restoration browser test exposed that clearing a settled `localRead` on newest demand makes a saved partial assistant appear to stream. Preserve settled saved presentation across newest pending, admission and failure; only owned live data supersedes it. Schedule subscription-driven eligibility checks after receipt/writer settlement, while observing connection loss synchronously so rapid connection edges cannot disappear.

2026-10-07 rework (finding 1 at `490ba22e`): Successful owned page admission supersedes a loading saved read and clears its owner, including empty/undrawable settlement and legacy responses without served IDs. Only settled saved presentation is retained on newest admission; session notices still preserve pending reads. Late missing/stored completion, failure or cancellation cannot replace admitted rows, identities, display contributions, served receipts or coverage. The reopened demand releases once after the outstanding page settles, and failure of that refresh retains the admission. Regression units cover both page-first completion orders and preserved settled presentation. Security concurrency review remains PASS: the existing host replacement guard and owned-read token reject obsolete disk results without expanding IPC, storage or transport capabilities.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/chat-history.md`, introduction and `### Received-state admission and ownership`: replace opening/reconnect no-demand claims with one newest page per owned opening/connection edge after read/request settlement, offline deferral/cancellation and no automatic range fill.
- Pending documentation stage: `docs/knowledge/features/conversation-shell-composer-status.md`, `## History page failure and Retry`: captured cursor/purpose, newest Retry with `cursor: ''` despite held `atStart`, and retained backwards trusted-input/two-viewport guards.
- Pending documentation stage: `docs/knowledge/features/chat-history.md`, `## Snapshot contract` and `### Protected row identities and saving`: retained oldest-end coverage versus newest served receipts/high-water/display evidence and saved partial-assistant presentation. Record actual fake/dispatcher-live counts in `docs/knowledge/features/development-verification.md`, `## What each test tier proves`, and `docs/knowledge/features/live-e2e-runbook.md`, `## Current real-claude gate state`, after dispatcher acceptance finishes.

## Security review

**Verdict:** PASS

- [Trust boundaries] Existing `parseRendererCommand` request-history validation and main correlated page decoder remain the only command/response boundaries. Renderer demand changes timing, never parsing or raw bytes.
- [Tokens] No credentials added or moved; pairing secrets remain main-only and protected with `safeStorage`.
- [File/storage] Existing validated protected history handler owns host membership, bounded snapshots, atomic encrypted storage and failure when secure storage is unavailable. No path or storage API changes.
- [Electron surface] Fixed allowlisted IPC commands only; isolation, sandbox, navigation and external-content policy unchanged. No new bridge API.
- [Crypto] Existing main-process Noise variant, keys and counters unchanged; no cryptographic work in renderer.
- [Network/I/O] Existing transport limits, request correlation/interruption and reconnect backoff retained. At most one owned page ask, limit 200; no automatic range fill/retry.
- [Errors/logs] Existing static failure codes and lifecycle diagnostics only; cursors, message bodies, raw frames and secrets never logged.
- [Concurrency] MUST FIX addressed in design: retain opening identity across effect replay, recheck current host, defer loading/pending requests, consume demand before publishing pending state, and invalidate delayed demand on departure/disconnect.
- [Threat alignment] Relay delay/drop is handled by existing interruption settlement; hostile pages remain bounded/parsed in main; token theft is mitigated by protected storage; renderer compromise gains no new capabilities or access to transport secrets.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
