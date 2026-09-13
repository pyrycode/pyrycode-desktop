# Save as channel modal and workspace choices

## Files read

- `SaveAsChannelDialog.tsx` → `SaveAsChannelDialog`, `requestCreateChannelFolder`, `requestPromoteConversation`, `slugForChannel`: existing promotion, host filtering and disconnect continuation.
- `CreateChannelDialog.tsx` → `CreateChannelDialogView`, `CreateChannelDialog`: form presentation and workspace-relative parent construction to reuse.
- `components/Modal.tsx` → `Modal`: shared header, divider, close and centered actions.
- `screens/channels/channels.css` → create-channel selectors: tokenized fields, radio controls and window constraints.
- `store/newFolderBridge.ts` → `subscribeNewFolder`: original host stamp must be filtered before flattening.
- `SaveAsChannelDialog.test.tsx` → view and command scenarios: update old default and fixed parent assertions.
- `e2e/save-as-channel-promote.spec.ts` → promotion fake: replace documentary path claims with payload assertions.
- `e2e/sidebar-offline-mutations.spec.ts` → disconnect tests: preserve renderer command observation and batched reconnect checks.
- `e2e/sidebar-create-channel.spec.ts` → controlled replies: pattern for host, stage and visual evidence.
- `docs/knowledge/features/save-as-channel-dialog.md` and `create-channel-dialog.md`: promotion closes on dispatch; same-host replies lack correlation.
- `docs/knowledge/features/development-verification.md`: static tests cannot prove effects; barrier before command absence assertions.

Codegraph context returned not initialized; repository search supplied the caller inventory.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2355

The inspected reference is a 640px dark modal with a title and circular close glyph above a divider, a filled Channel name input, two vertically ordered location choices and centered Cancel/OK actions. Reuse `Modal` and the Create channel theme-token styles, including its matching close asset. Create reference: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2435; shared modal: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942.

## Context and design

One deliverable: promote an existing chat through the new workspace-relative form. Extract the existing Create channel fields into `ChannelForm.tsx`, receiving name, location, busy, error and change callbacks. Both views use this form inside the existing Modal; submission remains in their separate containers. Reuse create-channel styling and remove obsolete save-only panel/preview styling.

Export a small `channelsParent(cwd)` helper from that module, preserving Create channel's trailing-slash removal plus `/channels`. Both folder submissions use it and the unchanged `slugForChannel`. Extend `requestCreateChannelFolder` with the workspace argument; its single production caller supplies `row.cwd` and the retained host. No promotion-helper signature or wire changes.

Save defaults to scratch, prefills `titleFor(row.name)` on every mount and autofocuses the form input. Scratch sends the trimmed name, original conversation ID and exact row cwd. Dedicated first requests the workspace channels parent and slug, then promotes with the host-returned canonical path verbatim. The conversation-list refresh remains unchanged.

## State + concurrency model

Retain local name/location state, pending/abandoned refs and the existing folder round-trip store. Pending synchronously prevents repeated submissions; the form freezes edits while in flight. Retain original-event host filtering and synchronous host-loss subscription. Dismissal explicitly abandons and clears pending before invoking the parent; effect cleanup removes subscriptions and resets the round trip on unmount. Remote operations already sent are not cancelled. Successful promotion still closes immediately on dispatch.

## Error handling

Folder rejection resets pending, displays the client-owned folder error and permits retry. Wrong-host, unstamped, unrelated and non-pending events cannot continue the operation. No new acknowledgement, timeout, filesystem access or error protocol is introduced. Keep content-free lifecycle diagnostics and add dismissal diagnostics.

## Testing strategy

- RED then GREEN static view assertions for Modal, focused filled input, scratch-first labels, absent preview, busy controls and accessible error; helper payloads cover workspace parent, slug and canonical promotion path.
- Focused fake-transport promotion specs capture both destination payloads, original ID, list refresh without duplicates, rejection/retry, radio keyboard behavior, pending controls, dismissal/reopening, host routing and ignored events.
- Update old selectors/default assumptions in offline and real-daemon promotion specs; run the offline spec to retain disconnect-abandonment proof. Live tier execution belongs to the dispatcher.
- Run touched unit tests, build, affected fake-transport specs (including Create channel because its form is shared). Capture actual modal at 1280x800, 800x600 and a short window, then inspect against Figma.

## Scope check

Estimate approximately 600 written lines including plan and tests, 3 production TSX files plus stylesheet, 2 new exports, 3 existing consumer updates, 5 acceptance criteria, fewer than 10 rejection/ignore branches. One independently verifiable flow. Refiner's 600-line estimate is consistent with the existing Create channel analogue. Refreshed remote feature branches have no overlaps with intended files.

## Open questions

None. Same-host concurrent folder replies remain indistinguishable because the renderer has no request identifier.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/save-as-channel-dialog.md` to describe the new modal, default workspace choice, workspace-relative dedicated destination, retained host filtering and dismissal behavior. Replace its obsolete claim that Create channel has no location choice, and retain the promotion acknowledgement and same-host correlation limitations.

## Security review

**Verdict:** PASS

- Trust boundaries: `SaveAsChannelDialog` filters original main-stamped events by retained host and pending operation before `subscribeNewFolder`; no unstamped response can authorize promotion.
- Tokens and cryptography: this renderer change introduces no credentials, storage, key handling or crypto; existing main-process transport remains the only owner.
- File/storage: `slugForChannel` produces one clean folder element; `channelsParent` only constructs an opaque remote request. The daemon remains responsible for confinement, missing-parent creation, reuse and canonicalization. Returned paths are forwarded verbatim, never locally opened.
- Electron attack surface: no new IPC channels, browser settings, remote content, navigation or raw markup; form values use React escaping and existing Modal assets.
- Network/I/O: existing commands and transport only; no new socket or retry loop. A stalled folder request remains dismissible, matching the existing contract.
- Logs/errors: client-owned static error and diagnostic codes only; no names, paths or exception details in logs.
- Concurrency: synchronous pending and abandonment refs gate continuation; cleanup removes listeners and resets state on every unmount. Disconnect/reconnect cannot revive the draft.
- Threat alignment: delayed or wrong-host replies are rejected; same-host correlation limitations remain explicitly accepted by the ticket. Transport authentication, parser limits and at-rest secret protection are unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
