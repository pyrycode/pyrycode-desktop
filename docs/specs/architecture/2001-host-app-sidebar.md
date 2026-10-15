# Host app discovery in the sidebar

## Files read

- `src/main/transport/hostedApps.ts` → `createHostedApps`: complete bounded snapshots, contiguous updates, refresh coalescing and readiness authority.
- `src/main/connectionRegistry.ts` → `runReconcile`, `connectionFor`: named connection ownership; accessors return fresh wrappers, so compare discovery service identity.
- `src/main/hostedPane.ts` → `registerHostedPane`: attached privileged windows, exact main-frame validation and generation-fenced opening.
- `src/main/index.ts` → registry construction, `openWindow`: bridge composition and window teardown.
- `src/preload/index.ts` → `onHostedPane`: stripped event objects and race-safe subscription ordering.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `HostSection`, `renderBody`: paired host enumeration and preserved independent folds.
- `src/renderer/src/screens/channels/channels.css` → section and row rules: existing token geometry and selected treatment.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`: stream-owned pane selection; conversation activation closes hosted content without changing drafts.
- `e2e/hosted-content-pane.spec.ts` → spec-local scenario: real preload/IPC with fake discovery/resource frames.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → Discovery and bound resources: refresh invalidates all bindings; never refresh on ordinary opening.
- `docs/knowledge/features/paired-shell-routing.md` → Hosted app selection and trusted chrome: preserve active chat identity and use streamed pane state.
- `docs/knowledge/features/channel-list.md` → host grouping and folds: enumerate paired hosts even with no conversations; keep hidden sections mounted.
- `docs/knowledge/features/development-verification.md` and linked evidence guidance: positive processing barriers precede absence assertions.
- Approved daemon contract at revision `964c5c4b`, Registration/Capability sections: display observed state, ordered discovery, no implicit starts or release authority.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-3902 (Apps child `590:4015` read and screenshot inspected).
Reuse `HostSection` after Chats, folder/chevron and existing 28px header/24px row geometry, title-small/body-small typography, on-surface and selected-row theme tokens. Show readable observed state beside escaped title. No creation plus: creation stays conversational as the ticket specifies.

## Context

One deliverable: return to a discovered app from its paired host sidebar. Main already owns paging, reconnect and opening; this adds only display projection and navigation. No ADR needed. No overlapping remote feature branches touch the planned existing files.
Size: approximately 280 production + 390 test/helper + 90 plan lines (760 total), 2 new exported types, 6 production consumers, 5 observable acceptance groups, at most 8 refusal categories. The #1992 analogue added 656 lines including its plan and tests; this bridge adds lifecycle coverage while reusing that viewer.

## Design

`src/shared/ipc/hostedAppsDisplay.ts` defines a host-stamped display union (discovery status; ready items contain only app ID, bounded title and observed state) and a strict command union for watch/unwatch/refresh with host and subscription token. No revision, release, errors, resource bytes or authority enters the renderer.
`registerHostedAppsDisplay` in main attaches only composition-root windows. Each client has one watch per host, holding its token and captured discovery service. Watch installs observation then synchronously publishes a copied snapshot on the event stream; invoke replies carry success/refusal only, preventing late initial replies from overwriting events. Registry reconciliation rebinds changed discovery services and publishes unavailable for removed hosts. An optional registry dependency callback avoids changing every registry consumer.
Preload's `onHostedApps(serverId, listener)` allocates a monotonic token, installs its filtered event listener before watch, and returns cleanup that removes it and unwatches that exact token. `refreshHostedApps(serverId)` asks only the named paired host. Fixed channels, no raw Electron objects.
`ChannelList` owns a mount-local Zustand Map of host display states; its effect subscribes for current paired hosts and clears/guards callbacks on cleanup. `ChannelListView` accepts injectable display/pane state, refresh/select callbacks. `renderBody` adds Apps under every paired host using existing fold components. Selection calls the existing `hostedPane(select)` and ignores command-result state; `hostedPaneStore` supplies current host/app highlight. Any open pane suppresses conversation highlights. Existing chat activation and composer keys stay intact.

## State + concurrency model

Discovery remains exclusively in main's existing state machine. The bridge holds only client/host watch identity, unsubscribe handles and copied display state; no network jobs or timers. Compare captured `hostedApps` identity against the registry before publication. Rebind after reconciliation; retired callbacks check watch and service identity. Window loading/close/dispose clear watches. Preload tokens fence old deliveries after remount; renderer callbacks also hold an active flag. Refresh delegates to main's existing coalescing and unavailable/unsupported checks.

## State transitions and identity reuse

| Event | Coverage in `e2e/hosted-app-sidebar.spec.ts` |
| --- | --- |
| Initial snapshot, held pages, post-publish update/removal | `discovery, lifecycle and navigation` / `paging and retry` |
| Equal IDs across hosts, switching pending opens, folding sections/host | `discovery, lifecycle and navigation` |
| Failed retry coalescing, unsupported/disconnected | `paging and retry` / `unsupported and unauthorized` |
| Reconnect, retired connection delivery | `stale delivery and remount` |
| Subscription replacement, unpair, remount and late snapshot | `stale delivery and remount` |
| Navigate app → original chat with draft | `discovery, lifecycle and navigation` |

Every stale/absence assertion follows a positive current-service update or command acknowledgement plus a renderer animation-frame commit barrier. Existing viewer tests retain native isolation/Fetch proof.

## Error handling

Malformed shape/token/host, unattached client or non-main frame returns typed `{ ok: false, error: 'refused' }` without dispatch. Allowed calls return `{ ok: true }`. Discovery failure displays static copy and host Retry; unavailable maps to disconnected. Ready empty differs from loading. IPC exceptions are consumed with static failed display or teardown no-op, never rendered exception text. Logs use static event/code only.

## Testing strategy

Test first: strict IPC validation unit tests and pure sidebar markup assertions for escaped titles, all states and selection. Fake-transport Playwright clicks production rows, scripts authoritative pages/events and validates routing, lifecycle, stale delivery, folds and drafts. Capture integrated sidebar at 1280×800 and 800×800; compare with Figma. Run focused unit/spec, final main merge, pre-verify and build. #1929 owns real publishing/relay/SQL acceptance; no live test changed here.

## Open Questions

None. Main's existing discovery service and viewer remain the only authority; ordinary opens never refresh.

## Security review

**Verdict:** PASS

- Trust boundaries: display projection is explicit in `registerHostedAppsDisplay`; parsed daemon records become copied display-only items. Text renders through React escaping, never attributes, URLs, logs or raw markup.
- Tokens/secrets: subscription tokens are public correlation only. No credentials introduced; existing safeStorage and main-only keys remain authoritative.
- Files/storage: no persistence or path construction; display state is memory only.
- Electron: exact attached WebContents/main frame and strict command keys, bounded paired host and safe integer token validated before dispatch. No new hosted-page bridge or changed sandbox policy.
- Cryptography: no cryptographic changes; existing Noise variant and key lifecycle unchanged.
- Network/I/O: existing discovery bounds (256 apps, bounded titles), timeouts, coalescing, capability and connection checks retained. Sidebar starts no resources except existing trusted select flow.
- Errors/logs: static refusal/failure codes only; no title, app content, token, key or decrypted byte logging.
- Concurrency: MUST FIX addressed in design: service/watch identity and preload tokens fence old callbacks and cleanup; streamed initial snapshots avoid an invoke-result race. Reconciliation explicitly handles connection removal/replacement.
- Threat model: relay delay/reorder and hostile records remain bounded by discovery codec/state machine; compromised renderer gains only display/refresh for paired hosts. Opening still independently validates current main authority. Token-at-rest and native-page isolation retain existing owners; live relay proof belongs to #1929.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions

2026-10-15: existing geometry/order specs assumed two sections per host; update their counts and host-section stride for Apps and run all three changed specs. App dots reuse existing static status styles alongside readable state text. The main unit `copies display only and fences replacement, unpair, retired watches and reload` explicitly covers changed service identity and retired callbacks; the Electron stale-delivery case covers reconnect, remount token fencing and unpair through production IPC. No authority or lifecycle contract changed.

2026-10-15, verifier rework: `ConnectionRegistry.settled(): Promise<void>` waits for queued storage reconciliation without starting discovery. A watch missing its connection waits once, then validates the named host again; unknown hosts still refuse. Pending watch identity is canceled on unwatch, replacement, reload and disposal. The held-reconciliation unit publishes the storage host list before connection construction and proves delivery without remount; three cancellation cases cover that new async seam. Preload handles resolved refusal with static failure only before any streamed snapshot. Security recheck: PASS; exact privileged client/frame validation still precedes dispatch, queued work cannot survive teardown, and no new authority or data reaches the renderer.

Retry uses token-based typography, border, colour, spacing and radius, with failed-state captures at both required widths. Conversation-only fixture locators exclude app-state rows; host-fold counts include three sections. The pill test scrolls the real chat control to the scrollport edge and retains the overflow precondition and mirrored-placement proof. The stale-delivery test removes a host through Edit host, delivers the retired event while the sidebar remains mounted, then fences absence with a surviving host update and render commit before separate reload evidence.

Rework validation: the unpair delivery uses the current mount's captured subscription token, asserted different from the pre-remount token, so remount fencing cannot satisfy the unpair check. In-flight #1908 adds unrelated preload/device routing and #1983 adds fixture setup diagnostics; both overlaps are in separate blocks and require no design dependency.
