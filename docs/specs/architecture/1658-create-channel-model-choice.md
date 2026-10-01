# Create channel model choice

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository boundaries and meaningful interaction evidence.
- `docs/knowledge/features/create-channel-dialog.md`: preserve host/stage guards, cancellation, confirmation and verbatim system-prompt continuation.
- `docs/knowledge/features/last-effort-store.md` → `What it does`: profile-wide preference records confirmed choices; read it at submission.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialog`, `confirmsPending`: local draft and existing rejection handling.
- `src/renderer/src/screens/channels/ChannelForm.tsx` → `ChannelForm`, `channels.css` → create-channel rules: bundled optional fields and modal styling.
- `src/renderer/src/components/Modal.tsx`, `modal.css` → `Modal`: shared 640px scrolling modal and existing close asset.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelRowLabel`: agent-aware row labels.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`: existing mouse, arrow/Home/End, Enter, Escape, outside-click and focus-return behavior.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationsFor`; `modelListStore.ts` → `ModelListState`: host-scoped conversation membership and cached lists.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewChannel`: optional choice already forwards agent/model/effort in the create payload.
- `src/renderer/src/store/lastEffortStore.ts` → `selectLastEffort`: synchronous submission-time preference read.
- `src/shared/wire/types.ts` → `WireModelOption`, `agentFromWire`: absent agent means Claude; preserve opaque model values.
- `CreateChannelDialog.test.tsx`, `e2e/sidebar-create-channel.spec.ts` → controlled fake: static form assertions and real app create/error correlation.

## Design source

Figma: [closed choice](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=578-3014), [open list](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=578-3197), [shared modal](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=489-1942). Design contexts and screenshots read. Model is a full-width, body-medium filled trigger between name and prompt, with an exported down-chevron asset. Its flat body-small list opens below, with the current row highlighted. Reuse Modal and ComposerOptionsMenu, scoped channel styles and existing theme tokens for fill, spacing, typography, radius and shadow; retain the existing textarea resize affordance.

## Context

New channels must start on the chosen agent/model and compatible remembered effort. Prerequisites already expose the choice transport and shared labels. One deliverable; no wire, IPC or background changes. No ADR needed.

## Design

- Add `channelCreateChoice.ts` with pure host-cache and create-choice helpers. Read the first cached list belonging to `selectConversationsFor(serverId)`; a cached empty list stays empty, and no target-host cache means no model field. Never inspect the open conversation as a fallback or request a new list.
- Subscribe to the target host's conversation array and select its cached model array by reference. Offer every row in daemon order using `composerModelRowLabel` with client-generated index identities, so equal values across agents remain distinct and daemon text reaches only escaped visible labels.
- Add one optional bundled model prop to ChannelForm. Only CreateChannelDialog supplies it; Save as channel retains its current fields. Reuse ComposerOptionsMenu interaction without changing its shared interface. While busy render the same trigger as a disabled button, unmounting any menu and its listeners.
- The dialog's transient model draft is a row or null (inherited Claude default). Resolve the current draft against the cached rows by exact value and normalized agent; null selects the published Claude `default` row. A fresh opening resets to null.
- `channelCreateChoice(row, lastEffort)` returns optional agent/model/effort fields: Codex sends agent and value; explicit Claude sends value only; Claude default sends neither. Add effort only for exact membership in that row's effort_levels. Without a row return no choice.
- Read `selectLastEffort(lastEffortStore.getState())` at submission and pass the choice to requestNewChannel with the clicked serverId, trimmed name and cwd null. No post-create model/effort settings write.

## State + concurrency model

No new store or asynchronous task. Existing pending ref prevents duplicate creates; rejection clears busy/error state while retaining the model draft. Existing host/session subscriptions and cleanup remain unchanged. Shared menu owns and cleans up focus and outside-click/resize listeners; unmount cancels its local state. Store selectors preserve cached array identity.

## Error handling

Existing send exceptions and correlated conversationCreateRejected retain “Could not create that channel” and restore editing. No optimistic channel. Existing confirmation/prompt attribution and disconnect abandonment stay intact. Missing/empty cache is a normal omitted field, with no agent/model/effort keys. Existing static diagnostics suffice; never log model labels or values.

## Testing strategy

- Test first: pure unit cases for default/explicit Claude/untagged Claude/Codex, exact effort membership including default, absent row and no preference; host cache isolation, empty lists and later cached conversation.
- Static renders assert field ordering, shared labels, disabled pending trigger, omission and unchanged Save-as-channel form.
- Extend only the existing create-channel spec with local fake model/settings replies. Prove mouse and keyboard choice, same-value agent distinction, Codex create frame with remembered effort, correlated settings refusal and retry, host isolation and absent/empty cache omission. Existing scenarios continue proving prompt, cancellation and confirmation.
- Capture closed/open choice at 1280×800 and 800×600 under `/tmp/builder-1658/`; compare against Figma. Run touched unit tests, npm run build and this one fake-transport spec.
- Dispatcher/operator live acceptance remains pending: confirm Low on an existing conversation, create the published GPT-6 Luna channel, send first message without settings changes, confirm Luna footer before/after the real Codex reply, and record daemon revision/result. Preserve needs-real-claude.

## Open Questions

None. Cleaner-shape check: reuse the shared interaction menu with scoped geometry instead of introducing another keyboard/focus implementation.

## Size check

Sketch and plan: 3 production TypeScript files, 1 CSS file, 1 SVG asset, about 650 written lines including tests and plan; no new exported type/component/store, 1 existing consumer updated, 5 observable acceptance criteria, no new reject branch. Analogue #1428 added 812 scoped lines, including a 332-line plan; this plan and menu reuse keep the current change smaller. Remote feature overlap check found none.

## Revisions

2026-10-01: Source inspection and integrated captures clarified shared menu behavior and asset delivery. The menu supports wrapping Up/Down, Enter/Space and Escape; Home/End remain native unhandled keys. Vite inlines small SVG imports, while the renderer CSP deliberately rejects data URLs. ChannelForm therefore loads the exact exported local chevron through a blob URL, creates it only while the model field exists and revokes it on cleanup; no CSP/build configuration change. The open list extends beyond the panel at ordinary heights as drawn, while windows at or below 550px keep it in the modal's scroll flow. Its shadow uses the design's 4px/12px/40% scrim treatment with existing tokens. No new error branch or store; about 550 written lines after these adjustments.
