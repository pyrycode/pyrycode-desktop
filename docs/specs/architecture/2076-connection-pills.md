# Connection feedback in the conversation overlay

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md` → renderer boundaries and existing desktop layout.
- `docs/knowledge/features/composer-send.md`, `docs/knowledge/features/development-verification.md` → send gating, static versus mounted proof.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `useOpenConnectionStatus`, `TopOverlayControl`, `ComposerErrorSlot`: host routing, restoration inputs and existing notice placement.
- `src/renderer/src/screens/conversation/TopOverlay.tsx` and adjacent `TopOverlay.test.tsx` → `TopOverlay`: existing Error treatment and pointer-transparent stack.
- `src/renderer/src/screens/conversation/composerSend.ts` and adjacent `composerSend.test.ts` → connection predicates and client-owned explanations; preserve their policy.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx`, `src/renderer/src/store/daemonEventBridge.test.ts` → retired surface assertions and daemon-update distinction.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__top-overlay`, `.top-overlay-pill`: existing wrapping, absolute placement and pointer routing need no new styling.
- `e2e/unpair-repair.spec.ts`, `e2e/host-row-per-server.spec.ts`, `e2e/thread-activation.spec.ts`, `e2e/composer-usage-limit.spec.ts` → recovery observation, offline rows and mounted geometry fixtures.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617 (context and screenshot read).
Reuse the right-aligned absolute Top overlay and its Error variant: error-container/error theme roles, body-small typography, existing spacing/radius and wrapping. Connection explanation has no X; Reconnect uses the same button treatment as Re-pair. No assets or new styles are needed.

## Context

Connection state currently occupies a header band and a composer recovery slot, while saved-history feedback adds another band. Move these occupants into the established overlay without changing transport, retry, storage or send policy. One deliverable, approximately 650–750 written lines including plan/tests, one new exported helper, fewer than ten production consumers, five observable acceptance criteria and no new reject branches.
Overlap: #2077 / PR #2078 adds Markdown-open failure feedback in the same overlay/screen files. Its additive prop and notice must survive a later merge; neither design needs the other.

## Design

- Add `connectionNotice(status: ConnectionStatus): string | null` beside the existing connection predicates. It selects the existing generic, pairing-expired or daemon-update-required client copy, never an error message.
- Extend the pure `TopOverlay` with optional connection status, saved-row visibility, restoration loading and Reconnect callback inputs. Existing callers without connection inputs retain their behavior.
- Render one Error status pill when disconnected/connecting/error or restoring. Inside it, preserve the existing offline saved sentence only when the screen actually renders a nonempty host-qualified snapshot offline. Loading remains independent of connection health and disappears on read settlement. One atomic polite region owns these facts; action pills have no live-region role.
- Derive Reconnect using unchanged `shouldOfferReconnect`; keep Re-pair's existing predicate. Move its IPC handler from the composer control to `TopOverlayControl`. Both actions resolve the current open host and recheck eligibility at click time.
- Remove the mounted connection/saved bands and connection chip. Remove their unused views. Keep `ComposerErrorSlot`'s connected-only priority chain for recovery/refusal/settings/history/MCP/task occupants, and remove its Reconnect input and handler.
- No new stores, types, timers, subscriptions, logs or dependencies. Retain existing reconnect bridge-rejection diagnostics. The old banner copy constant remains the generic explanation.

## State + concurrency model

Reuse the host-qualified session selector and the screen's immutable snapshot/restoring reads. There is no added async job. Restoration cancellation and identity ownership stay in the existing thread runtime. Reconnect awaits the existing bridge and classifies rejection with the existing content-free diagnostic. Overlay notices never affect timeline/composer flex geometry.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Connected → disconnected → connecting → error → connected; repeat | Mounted connection-pill transition spec; TopOverlay static matrix |
| Saved read pending → nonempty or empty; connected while pending | Mounted restoration spec and TopOverlay loading/saved matrix |
| Switch open conversation/host, including back to original host | Mounted host-switch spec; host-row-per-server |
| Reconnect click, success and repeated failure/retry | unpair-repair terminal-close cases, checking owning-host IPC |
| Pairing rejection → Re-pair → cancel/return | unpair-repair recovery dialog cases; never Reconnect |
| Daemon update required, then connected | Static copy matrix and mounted connection transitions |
| Usage notice coexists with connection feedback over empty/saved rows | Mounted 800px geometry/pointer spec and static coexistence assertion |

## Error handling

Existing status discriminants select only client-owned explanations. Pairing rejection cannot offer Reconnect. Daemon cause selects daemon-update copy. IPC rejection retains the existing diagnostic and does not render exception text. Local query failures and Retry remain in the thread and outside this relocation.

## Testing strategy

- Test first: static connection copy/markup and connected-only composer slot assertions, followed by production changes.
- Vitest covers every connection arm, offline saved versus empty, loading independence, escaping/no daemon text, single polite status and coexistence with usage; existing composerSend policy tests remain authoritative.
- Mounted Playwright covers transitions/clearing, host changes, both real recovery action routes, restoration settlement and geometry at 800px, with positive state barriers before absence assertions. Extend local fixtures; no shared test infrastructure.
- Run changed unit files, final-main pre-verify and build, then focused mounted specs. The ticket explicitly requests `npm run e2e` (complete default fake/captured-replay suite), so run it on Linux as well; no live-provider or macOS check is required.
- Capture the integrated connection/usage stack at 800px and a normal desktop width under `/tmp/builder-2076/`; inspect against Figma.

## Open Questions

None. The existing absolute overlay already supplies the required wrapping and pointer-transparent gaps.

## Revisions

2026-10-16: Integrated main's #2077 Markdown failure prop, pill and tests alongside the connection feedback, preserving its existing lifecycle and announcement. Retired the now-unused header-band CSS after both callers moved. Saved feedback requires at least one `shown` item in the rendered snapshot; hidden-only snapshots are silent, like completed empty reads. Mounted coverage includes both. No new state or policy was introduced.
