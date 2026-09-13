# Connected saved chats

## Files read

- `src/renderer/src/PairedShell.tsx` — `PairedShell` owns clicked coordinates and local-read cancellation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ConversationScreen` gates host identity, local notices, queues and saved-row presentation; `Timeline` suppresses inferred working decorations.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — saved timeline notice regressions and `stageOpenConnection` provide static presentation proof.
- `src/renderer/src/store/savedTimelineRestorer.ts` — `readSavedTimeline` contains IPC failure handling and content-free diagnostics.
- `src/renderer/src/store/conversationTimelineStore.ts` — `beginLocalTimelineRead` enforces exact coordinates and pending-slice admission; `receivedSlice` clears local-read state on receipts.
- `src/renderer/src/store/chatHistoryWriter.ts` — restored-marker admission establishes ownership without resaving restoration.
- `src/renderer/src/store/historyPageBridge.ts` — `requestOlderHistory` discards pending demand and reads retained coverage.
- `e2e/chat-history-recording.spec.ts` — recording, restart, saved reading and held IPC fixtures.
- `e2e/history-on-open.spec.ts` — main-side command observation and trusted keyboard demand.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp` can reuse saved pairing and storage against the original endpoints.
- `docs/knowledge/features/chat-history.md`, “Received-state admission and ownership” — metadata refresh can discard incidental host stamps; restored writer ownership must survive reconnect.
- `docs/knowledge/features/conversation-shell.md` and `development-verification.md` — static tests cannot prove effects; Electron interaction requires the focused fake tier.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

The inspected node has a fixed sidebar with host/workspace trees beside a flexible message pane, dark blue message surfaces and a bottom composer. Reuse `ConversationScreen`, `Timeline`, existing surface/primary and typography tokens, assets and connection presentation; no layout or token changes.

## Context and design

Opening a host-stamped sidebar row always invokes `readSavedTimeline`, including while connected. Preserve explicit clicked coordinates across metadata refresh and reuse the existing bounded holder and writer. No new types, stores, IPC or network behavior.

The screen checks held ownership against the selected host regardless of connection state. Connection status determines offline copy; local-read state determines saved-content presentation. Connected pending/failed/empty local reads may show their existing local notice, but loaded nonempty rows show no offline notice. Locally restored partial rows suppress inferred streaming/tool decorations and unrelated id-only queued rows until received state takes over. New live receipts keep their existing behavior.

## State and concurrency

Keep the existing cancellation handle on navigation, active-id change and teardown, including the retained repair background route. Completion requires the exact pending slice; newer receipts, eviction and cancellation invalidate delayed results. Reopening settled rows reuses them. Reconnect and list refresh neither replace the timeline nor initiate history requests. Pending demand remains discarded by `requestOlderHistory`; fresh input uses saved coverage after settlement.

## Error handling

Reuse typed chat-history results, snapshot validation and fixed diagnostic codes in `readSavedTimeline`. Read failures cannot change connection state or delete saved data. No new failure branches or retry loop.

## Testing strategy

- Extend static screen regressions for connected host isolation, saved partial-row suppression and actual offline/connected notice changes; verify live receipt rendering resumes normally.
- Extend the recording fake spec with incomplete saved coverage: receive/save, restart offline/read, reconnect/list refresh, receive/save new text, one demanded older page, restart/read ordered durable rows and updated coverage.
- Add already-connected restart with a held local read and pre-routing command observation. Pending input and settlement send zero history commands; only fresh input sends one with the saved cursor. Reopening does not duplicate rows.
- Reuse existing admission/cancellation and writer tests. Run touched static tests and `npm run build`, then the recording Playwright spec via the approved Electron helper. Capture connected/restored states at 800 and 1280 pixel widths and compare with Figma.

## Scope check

One deliverable: saved-chat continuity across connection states. Estimate about 350 written lines including plan and tests, two production files, zero new exported declarations, zero signature migrations, three acceptance criteria, zero new error branches. No remote feature branch overlaps the four planned code/test files. Codegraph reported an uninitialized index; source reads supplied the map.

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/chat-history.md`, “Received-state admission and ownership”, with connected saved-chat opening and continuity through reconnect and subsequent receipts.

## Security review

**Verdict:** PASS

- Trust boundaries: `beginLocalTimelineRead` validates snapshots and exact host/conversation coordinates. Screen ownership checks now also protect connected opening.
- Tokens and cryptography: no credential, key or Noise changes; these remain main-process responsibilities.
- Storage: reuse protected chat history through the existing main handler and secure store, with no new paths or renderer web storage. Keychain failure remains a typed storage failure, never plaintext fallback.
- Electron surface: existing narrow `chatHistory` IPC only; no new APIs, window preferences, navigation or remote content.
- Network: no new download/reconnect policy; local reads cannot send commands and pending demand is discarded.
- Logs: reuse `history-timeline-restore` fixed codes; no message content, credentials or raw errors logged.
- Concurrency: store-owned pending identity rejects stale completion; the shell cancels on real departure and teardown.
- Threat alignment: malformed saved data and equal-id cross-host substitution are rejected. This change leaves relay transport, frame validation and safeStorage protections intact.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

### 2026-09-13 — verifier regressions

The verifier found that connected reopening replaced a newly created chat's unstamped
optimistic echo. Add `dispatchLocalEcho(serverId, conversationId, userText)` to
`conversationTimelineStore`, wired from the host resolved by Composer's existing
`connectedConversationHostNow` send gate. Stamp ownership when composing, retaining
only explicitly same-host rows, rather than adopting unowned rows during restoration.
Reuse the bounded holder and reducer; no existing exported signature changes.
The writer continues to admit local echoes through its existing message-id and
unique-list-owner checks.

The two healthy-host interaction tests now require exactly the empty saved-storage
notice, preserving their assertion that another host's failure adds no connection
warning. No presentation or Figma changes are needed. Extend admission tests for
echo reopening, cross-host replacement and rejection of a pending read after a send;
rerun the three reported interaction specs plus the recording spec.

Security re-review: PASS. The new local write uses a host resolved synchronously by
the existing send gate, accepts only user-text events, and cannot adopt differently
owned or unowned content. Existing snapshot validation, cancellation, writer admission,
IPC, logging, storage and network boundaries remain unchanged. Total scope remains
within limits: three production files across the PR, no signature migrations, one
store method, three acceptance criteria, no new failure branches, under 800 written lines.
