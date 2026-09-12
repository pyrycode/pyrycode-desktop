# Rename modal

## Files read

- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` — `RenameConversationDialogView` owns presentation; `requestRenameConversation` trims and sends the target id.
- `src/renderer/src/components/Modal.tsx` and `modal.css` — `Modal` supplies accessible header, close control, centred actions and viewport scrolling.
- `src/renderer/src/screens/channels/channels.css` — rename overlay and input rules; the Edit workspace field supplies the matching token pattern.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelList` seeds the displayed title and dismisses after dispatch.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ChannelInfoSheet` mounts the same view and helper for chats.
- `src/renderer/src/screens/channels/RenameConversationDialog.test.tsx` — static markup and exact command assertions.
- `e2e/conversation-create-rename.spec.ts`, `e2e/conversation-state-fake.spec.ts`, `e2e/real-daemon-rename.spec.ts` — existing rename interaction and affected selectors.
- `docs/knowledge/features/rename-conversation-dialog.md` — no autofocus, Enter submission or own Escape/backdrop dismissal; container owns draft reset.
- `docs/knowledge/features/channel-list.md`, `conversation-shell.md`, `development-verification.md` — entry points and static versus browser proof boundaries.

## Design source

Rename: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2320

Shared Modal: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

The inspected Rename context and screenshot show a 640px dark panel, title and circular close glyph above a divider, a filled field labelled **Channel name:**, and centred outlined Cancel / filled OK buttons. Reuse `Modal` and its existing asset, typography and colour tokens; the field uses label-large emphasized and body-medium with the existing translucent on-primary fill.

## Change

Replace the view's bespoke panel and actions with `Modal` at width 640, retaining the overlay and inert scrim. Pass Cancel and close to `onCancel`, OK to `onSave`, and disable OK when the controlled name trims empty. Keep both caller contracts, command helper, state ownership, focus and dismissal policy unchanged. Replace obsolete panel/action CSS with the filled field rules mirroring Edit workspace. No new state, async work, error branch or logging event is introduced; existing command infrastructure remains responsible for lifecycle/error logs.

Size check: one deliverable, one production TypeScript file plus one stylesheet, approximately 350 written lines including tests and this plan, zero new exports or changed consumer signatures, three acceptance criteria, zero new reject branches. Remote feature branches checked after fetch: no overlap with proposed files. Codegraph was uninitialized; repository search established the two view and two helper callers.

## Testing strategy

Update static assertions first and observe RED for shared modal markup, exact copy and blank validation. Preserve command trim/id tests. Update all affected browser selectors, including the daemon spec without running the live tier. Extend the existing create/rename fake test for prefill, cancellation, close, keyboard activation, correct target identity and unchanged row metadata across both entry points. Check 800px width and short-window scroll reachability; capture the rendered modal for comparison with Figma. Run touched unit tests, build and affected fake specs only.

## Documentation handoff

No explicit documentation acceptance requirement was supplied. Pending documentation stage: update `docs/knowledge/features/rename-conversation-dialog.md`, sections “What it does”, “How it works” and “Edge cases and limitations”, for shared Modal, filled Channel name field, Cancel/OK and header close; retain existing focus/Escape/backdrop and command behavior.

## Open questions

None.
