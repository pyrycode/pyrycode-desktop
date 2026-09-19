# Session text drafts by host and conversation

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ConversationScreen`, `ComposerSlot`, `Composer` — retained host coordinates, controlled input, completion and local submit-success seam.
- `src/renderer/src/PairedShell.tsx`: `PairedShell`, `PairedShellView` — selection coordinates and keyed pane lifetime.
- `src/renderer/src/store/conversationCreatedBridge.ts`: `useConversationCreatedNav` — creating host comes from the event stamp.
- `src/renderer/src/store/activeConversationStore.ts`: `createActiveConversationStore` — vanilla Zustand factory, singleton and narrow hook convention.
- `e2e/conversation-switch-remount.spec.ts`: existing create/sidebar switch drive — replace discard expectation and retain independent remount evidence.
- `docs/knowledge/features/composer-send.md`: “The controlled composer” and “Data flow” — `submitMessage` clears at local success, including swallowed bridge failure.
- `docs/knowledge/features/paired-shell-routing.md`: “The conversation-switch remount bug and the paneKey fix” — transient state must still remount.
- `docs/knowledge/features/development-verification.md`: “Evidence that cannot pass too early” — wait for positive navigation effects before absence assertions.

Codegraph returned “not initialized”; repository search supplied the symbol and caller checks.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The input area stacks status, attachments, a rounded blue textarea with a right-hand send icon, and the compact Actions/settings footer. Body-medium input and body-small footer use the existing theme roles; the inspected context and screenshot require no appearance changes for this state-retention fix.

## Context and size

Pane recreation currently destroys local input text. Retain only text for the renderer session; attachments and transient controls keep their current lifetime. No disk persistence or transport change.

One deliverable: independent session drafts. Estimate about 450 written lines including plan and tests, 3 production files, 1 new exported store type, 2 production prop consumers, 4 acceptance criteria and no new error-state machine. The #670 analogue added 181 lines across four files. All six ticket boundaries pass. The remote feature-branch overlap check found no conflicts for the proposed production, store-test and switch-spec files.

## Design

Add `composerDraftStore.ts` with a vanilla Zustand factory, renderer singleton and hook. A nested Map keyed by server ID then conversation ID holds exact strings. `setDraft(serverId, conversationId, text)` replaces that entry; empty text removes it. Missing entries read as empty. Null coordinates never create a shared anonymous draft. Selecting the string for one coordinate avoids re-rendering for another draft's edits.

`PairedShell` retains the creating host alongside the new conversation ID in its existing `savedTimelineTarget`, just as sidebar activation already does. Include host and conversation in `paneKey` so equal IDs on different hosts still recreate transient state. Later metadata refreshes cannot reassign these retained coordinates.

`ConversationScreen` passes its retained `selectedHost` through `ComposerSlot` into `Composer`. Replace the local text state with the selected draft and a coordinate-bound setter. Keep textarea change, slash completion and textarea resizing on that same controlled value. Keep `sendText` and `submitMessage` unchanged; only `handleSubmit` clears the selected draft when `sendText` returns true. Actions-menu sends therefore keep typed text intact.

## State and concurrency

All writes are synchronous renderer edits to the current coordinate. There are no new tasks, subscriptions outside Zustand, acknowledgement waits or teardown jobs. The singleton survives screen unmounts; process restart discards it. Pane-local menus, attachments and scroll state still reset on remount.

## Error handling and logging

Unavailable-host and whitespace rejection keep their current send result and leave the draft untouched. No new I/O or error branch. Emit a content-free `composer-draft-cleared` diagnostic at successful typed submit; never log draft text or host/conversation values.

## Testing strategy

- Store unit tests: exact whitespace/multiline retention, separate conversations and identical IDs across hosts, collision-safe keys, empty removal, independent store instances and stable unrelated selections.
- Fake-transport switch spec: channel and newly created chat drafts, edits/emptying, screen exit/reentry, Send and Enter clearing only their own draft, blocked/whitespace submit retention, slash completion and Actions preservation where supported by the fixture.
- Keep observable transient panel reset on both create and sidebar switches, independent of text retention. Check restored multiline textarea sizing and capture the actual composer for visual comparison.
- Run the new store test RED before implementation, then touched tests and `npm run build`; run the focused fake-transport spec with approved Electron execution. Full-suite regression remains the verifier's gate.

## Open questions

None.

## Revisions

### 2026-09-19 — verifier regression: new-chat timeline ownership

Retaining the creating host made `ConversationScreen` correctly reject the unowned
empty slice created by `markViewed`, but nothing settled that new chat's timeline.
Add `initializeCreatedTimeline(serverId, conversationId)` to
`conversationTimelineStore` and call it after creation activation in `PairedShell`.
The creation event establishes an empty live timeline owned by its stamped host,
without a saved-history read, restoration provenance or pending history request.
It replaces any same-ID content from another host. Draft coordinates and submission
behavior remain unchanged. Store tests cover ownership and replacement; the switch
spec asserts no loading banner before the held list reply, and the verifier's
`host-conversation-list` regression spec must pass. This adds one production file
(four total), no exported types and one consumer; total written work remains below 800 lines.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/composer-send.md` under “The controlled composer” and “Data flow”, and `docs/knowledge/features/paired-shell-routing.md` under “The conversation-switch remount bug and the paneKey fix”. Explain that text drafts survive by host/conversation for the app session while transient pane state still resets.
