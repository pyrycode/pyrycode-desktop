# Confirm sidebar creates in the daemon default folder

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `ChannelListView`, `renderServerTrees` — connected-host guards and the existing per-workspace plus routing.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialog`, `confirmsPending` — draft lifecycle, host-stamped event handling, and prompt continuation.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewConversation`, `requestNewChannel`, `useConversationCreatedNav` — command shape and confirmation-driven navigation.
- `src/renderer/src/components/Modal.tsx` → `Modal` — shared header, close, and confirmation actions.
- `src/renderer/src/screens/channels/channels.css` → `.create-channel-overlay` — existing modal placement and scrim.
- `e2e/sidebar-create-channel.spec.ts` → `controlled`, `event` — held replies, host routing, and prompt assertions.
- `e2e/sidebar-workspace-create.spec.ts` → workspace plus drive — current immediate-create behavior that must change.
- `e2e/real-daemon-create-channel.spec.ts` → real daemon drive — distinguishes clicked workspace from daemon default.
- `docs/knowledge/features/create-channel-dialog.md` → Requests and replies — existing attribution limit and transient prompt design.
- `docs/knowledge/features/channel-list-workspace-grouping.md` → workspace create controls — existing host/path grouping contract.
- `docs/knowledge/features/development-verification.md` → evidence boundaries — static renderer tests cannot click; focused Electron interaction is required.

## Design source

**Create chat:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=489-1942

**Create channel:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=578-3014

Both references use the existing dark, centered `Modal` panel with title, close control, divider, and centered Cancel/OK actions. The channel reference shows a name field and system prompt area; the existing app form remains the visual vocabulary. Neither dialog exposes a folder choice. The channel reference also depicts a model selector, which is outside this ticket's create contract.

## Context

The current workspace-row plus supplies its group's `cwd` as the creation destination. The daemon must now choose its default folder for both creation flows, while the clicked row still identifies the target host. The later host-first sidebar ticket #1683 relocates the controls; this ticket changes their current behavior only.

## Design

- `ChannelList` retains only the clicked `serverId` for each creation draft. Its connected-host guard remains at opening and confirmation. The Chats plus mounts a small `CreateChatDialog` view backed by the shared `Modal`; cancel/close only dismiss, and confirm sends `requestNewConversation(sendCommand, null, serverId)` once and dismisses. Navigation stays owned by `useConversationCreatedNav` on the daemon's confirmation.
- `CreateChannelDialog` no longer accepts a requested `cwd`. It sends `requestNewChannel` with `cwd: null` and retains its transient name, prompt, pending ref, host-stamped event listener, and host-loss cleanup. Rejection returns to an editable draft; a retry sends one new request.
- `requestNewChannel` accepts `string | null` for `cwd`, preserving explicit-path callers and choice fields. The null is present on the IPC and wire payload. `confirmsPending` checks promoted status and trimmed name; the daemon-resolved path cannot equal a requested path because none was sent. Its caller retains the nonempty same-host stamp guard before writing a prompt. As before, same-host created events dismiss the local wait even when the payload fails prompt attribution.
- Shared overlay CSS gives the new dialog the existing modal placement. No new IPC verb, wire field, storage, or dependency is introduced.

## State and concurrency model

The sidebar holds one nullable host target for each dialog. The chat dialog has a synchronous ref to prevent duplicate confirmation before React repaints. The channel dialog keeps its existing `idle | channel` ref, including the submitted trimmed name and optional prompt. Closing or losing the selected host unmounts the dialog and clears its local wait; already-sent daemon work remains owned by the daemon and global navigation bridge. Wrong-host and unstamped events cannot complete the channel wait. Concurrent same-host, same-name promoted creates are indistinguishable without reply correlation, so the first matching confirmation may receive the prompt; no wire change is made.

## Error handling

The chat confirmation checks connection immediately before send, and dismisses without a create if the host is unavailable. A local send exception does not navigate optimistically. The channel dialog retains its generic rejection/retry error and catches prompt-send failure through its existing app-level write store path. Diagnostics use static event and status codes only; names, paths and prompt text are never logged.

## Testing strategy

- Focused Vitest: chat view renders confirmation actions without a folder input; bridge emits explicit null `cwd`; channel attribution accepts a daemon-resolved path but rejects wrong name or promotion. Static markup tests do not claim to prove clicks.
- Focused fake-transport Playwright: chat cancel/close sends none, confirm sends one to the clicked host and waits for navigation; identical paths on two hosts still route independently. Channel tests cover null destination, validation, rejection/retry, wrong-host replies, host loss, and a single prompt write after the same-host promoted/name match.
- Update the credential-light real-daemon channel spec so the created row is in the daemon default `work` group, distinct from the clicked seed workspace. Build and run the touched unit and focused interaction specs.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/create-channel-dialog.md`, especially **What it does**, **Requests and replies**, and **The system prompt write**, for confirmation and daemon-default creation, including the residual same-host/same-name ambiguity. Update the create-control section of `docs/knowledge/features/channel-list-workspace-grouping.md` for both confirms and note that #1683 will relocate these controls.

## Open questions

None. The ticket fixes the daemon-default signal, same-host dismissal behavior, and no-correlation limit.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No new boundary: `requestNewConversation` and `requestNewChannel` send typed IPC commands through the existing main-process validation path. The host id comes from the clicked connected row, not daemon text in an attribute.
- [Tokens and storage] No tokens or durable draft data are added. The channel prompt remains component-local and is not persisted or logged.
- [File operations] No renderer filesystem operation or path construction is added. `cwd: null` asks the daemon to resolve its own default under its existing policy.
- [Electron and cryptography] No bridge API, window, socket, key, Noise, or crypto code changes. The transport remains in the main process.
- [Network and I/O] No new connection or stream. The existing create command and daemon-event subscription are reused.
- [Error and logs] Generic UI error and static diagnostics remain; prompt/name/path content never enters logs or exception text.
- [Concurrency] The clicked host is held independently of identical paths on other hosts. The existing host-stamp guard and cleanup prevent a wrong-host continuation; `confirmsPending` remains an attribution filter, not an authorization boundary. Same-host, same-name promoted creates remain ambiguous without wire correlation and are explicitly documented.
- [Threat model] A hostile daemon controls its own reply id and fields, so echoed-field comparison cannot authenticate it. Relay behavior, token-at-rest handling, frame limits, and broader renderer isolation remain in their existing owners; this ticket does not change those surfaces.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-27
