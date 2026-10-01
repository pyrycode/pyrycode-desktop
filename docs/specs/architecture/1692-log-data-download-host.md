# #1692 — Log data's Download names the open conversation's host

## Files read

- `src/renderer/src/screens/conversation/LogDataSection.tsx` → `LogDataView`, `LogDataSection` — the section that sends a bare `requestDebugBundle` today.
- `src/renderer/src/screens/conversation/logDataDownload.ts` → `toDownloadAction`, `reduceDownload` — the pure event→action seam the new server filter sits beside.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts` → `connectedConversationHostNow`, `useConversationActionAvailability` — click-time host resolution and the render-time gate.
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → `BubbleAttachmentImage` — the "resolve at the act, null means do nothing" idiom.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `StatusSheet` mount of `LogDataSection`, and `openConversationId` / `actionsAvailable` already in scope there.
- `src/shared/ipc/commands.ts` → `requestDebugBundle` arm (`serverId?: string`, #1120).
- `src/shared/ipc/events.ts` → `StampedDaemonEvent` — every event reaching the window carries its origin `serverId`.
- `src/main/debugBundleDownload.ts` → `createDebugBundleDownloads` — one orchestrator per server, events emitted bound to that server's origin.
- `e2e/stall-bundle.spec.ts`, `e2e/offline-session-settings.spec.ts` — the bundle chunk-stream fake and the two-server + command-capture patterns the new spec follows.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

Behaviour only. The Download button's existing disabled treatment (`.log-data__download:disabled`) is reused; no new visuals.

## Context

With two hosts paired, the router refuses a `requestDebugBundle` without `serverId` as `ambiguous-server` and emits nothing, so the section sits on "Downloading…" forever. The fix addresses the request at the open conversation's host and ignores the other host's bundle events.

## Design

- **`LogDataSection({ conversationId, available })`.** `ConversationScreen` passes `openConversationId` and the `actionsAvailable` it already computes from `useConversationActionAvailability`.
- **`LogDataView` gains `available: boolean`.** The button is `disabled` when `busy || !available`. `aria-busy` stays tied to `busy` only.
- **`requestDebugBundleFor(conversationId: string | null): string | null`** (exported from `LogDataSection.tsx`). Resolves `connectedConversationHostNow(conversationId)`; on null it sends nothing and returns null; otherwise sends `{ type: 'requestDebugBundle', serverId }` and returns that `serverId`. Exported so the "disconnected sends nothing" rule is unit-provable without a click.
- **`bundleActionFor(event: StampedDaemonEvent, requestedServerId: string | null): DownloadAction | null`** (in `logDataDownload.ts`). Null unless `requestedServerId !== null` and `event.serverId === requestedServerId`; otherwise `toDownloadAction(event)`. Pure.
- **Container state.** A `useRef<string | null>` holds the requested server. `onDownload`: phase guard as today, then `requestDebugBundleFor`; on null return (state stays idle); else store the id in the ref and dispatch `requested`. The listener dispatches `bundleActionFor(event, ref.current)`.

Deliberate consequence: after a mid-download sheet close/reopen, the fresh mount has made no request, so it ignores the in-flight download's events until the next press. The reducer's idle→downloading rehydration on a bare `progress` stays in the reducer; the container just no longer feeds it events it did not ask for. A second press is dropped by the per-server orchestrator's in-flight gate, and later events then match.

## Error handling

A null host at click (disconnected, unknown owner) → no command, idle. Other hosts' events → `null`, no dispatch. No new logging: `connectedConversationHostNow` already emits its content-free availability diagnostic.

## Testing strategy

- `logDataDownload.test.ts`: `bundleActionFor` maps a matching-server event, returns null for another server's event, for a null request, and for a non-bundle event.
- `LogDataSection.test.tsx`: `LogDataView` with `available: false` renders a disabled, not-busy button; `requestDebugBundleFor` with store setup (the `conversationActionAvailability.test.ts` idiom) and a stubbed `window.pyry`: connected owner → one command carrying that `serverId`; owner disconnected → no command, null; single host → command carries the single host's id. Container SSR test updated for the new props.
- `e2e/debug-bundle-second-host.spec.ts`: two-server launch; open `SECOND_SEEDED_ROW`; Run configuration → Download; the second daemon captures `request_debug_bundle` and streams chunks, the first daemon captures none; the caption shows the chunk count.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: the Log data behaviour note in the conversation package overview (host-addressed request, server-filtered events).
