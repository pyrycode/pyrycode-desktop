# Trusted hosted content pane

## Files read

- `src/main/hostedAppView.ts` → `createHostedAppViews`: native authority, retirement and visibility capability.
- `src/main/transport/hostedApps.ts` → `read`, `refresh`, `subscribe`: complete discovery and release updates.
- `src/main/index.ts` → `openWindow`: parent ownership and named connection registry.
- `src/preload/index.ts` → `api`: narrow privileged IPC bridge and subscription snapshot pattern.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`, `PairedShellView`: explicit conversation navigation and retained pairing background.
- `src/renderer/src/pairedShell.css` → pane cards: fixed sidebar, tokens and native placement.
- `src/main/hostLabelStore.ts` → `loadFor`: paired-host labels, not conversation identity.
- `e2e/hosted-app-view.spec.ts`, `e2e/fixtures/launchPairedApp.ts` → reply scripting and native inspection.
- `docs/knowledge/features/paired-shell-routing.md`, `daemon-connection-hosted-resource-views.md`, `development-verification.md`: native composition and positive delivery barriers.
- Approved daemon contract `3120-hosted-app-contract.md` → identity and Electron resource bridge: labels outside hosted content, fresh native generations.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and screenshot: existing 400px sidebar beside the expanding dark pane, inset card and compact title/divider. Reuse pane card, theme spacing, on-surface text and primary controls. Hosted contents are synthetic test content; sidebar Apps placement remains #1928.

## Context

Mount the merged #1991 viewer with retained trusted identity and recovery feedback. No new browser policy, Fetch adapter, sidebar entry or wire changes. No ADR needed. No overlapping numeric remote feature branches touch the planned existing files.
Sizing: one integrated pane deliverable, four observable criteria, approximately 700 written lines including plan/tests, four new exported types/components/stores, four existing production consumers, at most eight refusal categories.

## Design

Add shared `HostedPaneState` and `HostedPaneCommand` unions. `window.pyry.hostedPane(command)` selects a named host/app; `onHostedPane` supplies snapshots/events. Main owns the current selection, labels, generation, discovery subscription and native handle per privileged parent. Commands are select, snapshot, layout, reopen and close; all control commands carry the current generation. No native authority crosses IPC.
One main controller validates the exact privileged main-frame sender and command shape before use. It captures `registry.connectionFor(serverId).hostedApps`. Labels come from bounded stored host metadata and completed discovery, are retained across loss, and reach only escaped React text. A renderer Zustand store mirrors main state; the shell renders a hosted pane in the existing pane position. Explicit channel/chat/settings/archive/back navigation closes it; incidental active-conversation changes do not.
The pane measures its empty native surface using ResizeObserver/window resize. MutationObserver detects client dialogs and hides the native view through main, since renderer stacking cannot occlude it. Initial content is hidden until layout arrives; main rejects nonfinite/out-of-window geometry. Native state alone establishes ready.

## State + concurrency model

Selection generations increase on select, reopen and release replacement. Main rejects stale layout/close/reopen; preload uses events rather than late command replies to write state. A late label read is guarded by selection identity. Native subscriptions are removed before close. Parent close/reload disposes subscriptions/content. Discovery is observed even when native opening is refused.
Initial loading waits for discovery completion. Lost discovery retires content and disables automatic reopening. Reconnect alone retains feedback; explicit reopen requests fresh discovery when needed, waits for completion and opens a fresh native view. A running active-release replacement uses its already authoritative update and replaces the native generation automatically. No timers, polling loops or new resource tasks.

## State transitions and identity reuse

| Event | Focused Playwright coverage in `hosted-content-pane.spec.ts` |
| --- | --- |
| Initial held discovery then completion | loading discovery and recovery |
| Select/switch/close/reselect equal IDs across hosts | geometry, dialogs and selection; two hosts and stale controls |
| Resize/layout/dialog open and cancel | geometry, dialogs and selection |
| Release replacement twice; stale controls | release replacement and recovery |
| Discovery gap, stopped/failed/missing app | unavailable states and discovery loss |
| Disconnect/reconnect/reopen with held discovery | loading discovery and recovery |
| Conversation host changes and explicit navigation | two hosts and stale controls |
| Parent teardown and stale pending delivery | geometry, dialogs and selection |

## Error handling

Malformed/untrusted/stale commands return typed `{ ok: false, error: 'refused' }`, log static codes and change nothing. Native unsupported/disconnected/unavailable remain static client feedback with retained labels. Host-label I/O failure uses the existing Server fallback; never forward exceptions. Native retirement/resource policy remains #1991.

## Testing strategy

Write focused tests first and observe the absent bridge failure. Unit tests cover command validation; fake-transport Electron tests drive the actual preload/IPC selection, native geometry, dialog visibility, identity and lifecycle. Inspect actual child native views and completed discovery/resource barriers before absence assertions. Capture the composed BrowserWindow with native content. Run focused spec, final pre-verify and build after merging main. Live daemon/relay/SQL proof belongs to #1929.

## Open Questions

None. Prefer one parent-owned coordinator over duplicating viewer/discovery state machines.

## Security review

**Verdict:** PASS

- [Trust boundaries] Exact sender/main-frame membership and strict command validation at the main controller; labels only escaped text.
- [Tokens] No credentials created, persisted or sent through this bridge; existing safeStorage remains unchanged.
- [File/storage] No new paths, persistence or caches; host metadata uses existing loadFor with bounded output.
- [Electron] Only registered privileged parents may control their view; finite constrained geometry and generation checks; #1991 isolated content receives no client preload.
- [Cryptography] No new primitives or key handling; #1991 retains random origins and existing Noise transport.
- [Network/I/O] No new network path; existing discovery/resource limits and deadlines remain authoritative.
- [Errors/logs] Static status and diagnostic codes only; no labels, payloads, URLs, secrets or exception text logged.
- [Concurrency] Parent-scoped ownership, fenced async metadata, fresh generations and explicit unsubscription prevent successor control or revival.
- [Threat model] Hostile daemon labels remain text; malformed IPC is refused; relay loss retires native content. Native isolation remains #1991, Fetch writes #1961 and live proof #1929.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15
