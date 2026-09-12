# Host-addressed conversation list lifecycle

## Files read

- `src/renderer/src/store/conversationListBridge.ts`: `ConversationListData`, `subscribeConversations`, `requestConversationList`, `originOf` own loading and refresh.
- `src/renderer/src/store/conversationListBridge.test.ts`: bridge fakes and static container coverage.
- `src/renderer/src/store/sessionStore.ts`: `statuses` holds independent host connection states.
- `src/main/serverRouter.ts`: `createServerRouter` refuses ambiguous requests.
- `e2e/fixtures/launchPairedApp.ts`: `launchPairedApp` currently pushes second-host seed rows.
- `e2e/sidebar-workspace-create.spec.ts`, `e2e/workspace-updated-relist.spec.ts`: existing request/reply browser patterns.
- `docs/knowledge/features/conversation-list-store.md`, “The data path” and “Edge cases and limitations”: obsolete global refresh contract must be replaced later.
- `docs/knowledge/features/development-verification.md`: static renders cannot prove effects or interaction.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot: a 400px sidebar groups channels and chats under hosts and workspaces beside the conversation pane and bottom composer. Existing blue theme, small text, nested rows and paired connection dots remain; this fix restores their data without changing presentation.

## Context and scope

Multiple saved hosts make an unaddressed list command ambiguous. Missing list rows also prevent the open conversation from resolving its host for connection and Send state. One deliverable: restore the host-addressed list lifecycle, including mutation refresh.

Estimated total written work: approximately 500–550 lines, one production file, no new exported types/components/stores, at most one new exported helper, three existing production caller updates, four acceptance criteria, two rejection classes (invalid identity and existing routing refusal). This fits the refiner estimate and all sizing limits. Refreshed remote feature branches have no overlap with the bridge/test or launch fixture. Codegraph returned an uninitialized-index error; repository search supplied the call graph.

## Design

Require a string host identity in `requestConversationList` and put it on `requestConversations`. `subscribeConversations` passes a nonempty string from `originOf` to its refresh callback for all four mutation arms; invalid origins never request or fall back to payload data. List replies keep the existing per-origin replacement behavior.

Observe `sessionStore.statuses` directly through an injected subscription helper, requesting current connected hosts at mount and each subsequent disconnected-to-connected edge. Track connected host IDs in a Set, updating that set before sending to tolerate synchronous callbacks. This captures transitions even if React batches rendering. `ConversationListData` installs its daemon listener before the status observer and cleans up both on unmount.

The multi-host fixture supplies each host's own seed through request replies and waits for its row instead of pushing seed frames. A focused browser spec uses the existing stateful conversation fake, counts real list requests per transport, disconnects one saved host, and creates a workspace on the other. No renderer row insertion or unsolicited list reply may satisfy the proof.

## State and concurrency model

No new store state or async tasks. The subscription owns a bounded Set of currently connected identities; disconnected, removed and invalid slots leave it. No list is cleared by a connection transition. Synchronous store observations prevent missed reconnect edges. Cleanup removes both listeners; remount loads current connected hosts anew.

## Error handling

Missing/null/non-string/empty refresh origins are ignored with a static diagnostic code. Requests log a content-free lifecycle event through the existing diagnostic channel. Existing main-side routing refusal and transport error handling remain authoritative. No new user-facing errors, timeouts or retries.

## Testing strategy

- RED first: addressed request assertion and origin-validation matrix; injected status observer proves mount, independent connect/reconnect, duplicate notifications, invalid slots and cleanup.
- Preserve existing single-host mutation tests with explicit stamps and per-host replacement assertions.
- Browser proof uses real IPC, router, fake Noise transport and replies for initial and post-create lists; asserts host grouping, unavailable-host status, open row, enabled draft Send and absent disconnected warning.
- Run touched unit tests and `npm run build`, then focused fake-transport browser spec through approved Electron launcher. Capture the resulting screen for visual comparison. Full suites belong to verifier.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/conversation-list-store.md` under “The data path” and “Edge cases and limitations” to describe per-host connection requests and origin-scoped refresh, replacing the obsolete global-refresh limitation.

## Open questions

None.

## Security review

**Verdict: PASS**

- Trust boundaries: `originOf` reads only the main-stamped sibling identity; mutation payload fields never select a target. Invalid origins are rejected before requesting. `createServerRouter` remains the deterministic refusal boundary for unknown or ambiguous destinations.
- Tokens and cryptography: no credential, key, Noise or safeStorage changes; these remain main-process concerns.
- File/storage operations: no production persistence or filesystem access is introduced.
- Electron surface: existing typed command only; no new IPC capability, navigation, remote content or window setting.
- Network/I/O: existing request transport and decoder retain limits and error handling; no socket/retry/timeout changes.
- Logs: static event/code only, never host identity, daemon text, workspace paths or payloads.
- Concurrency: synchronous Set update before sends; both subscriptions have cleanup, no timers or floating promises.
- Threat model: a hostile daemon can request refresh of its own list by mutation events, but cannot choose another host through payload fields. Relay and disk-threat controls remain unchanged; no new mitigation outside this observed defect.
