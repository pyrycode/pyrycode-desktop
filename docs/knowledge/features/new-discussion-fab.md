# The create → nav bridge (formerly the new-discussion FAB)

`src/renderer/src/store/conversationCreatedBridge.ts`'s create/created plumbing: fires the
[`createConversation` command](conversation-create.md) (fire-and-forget) and, when the daemon confirms
with a `conversationCreated` event, navigates the [paired shell](paired-shell.md) from `list` to `thread`
by reusing the existing `open` transition. Introduced alongside the new-discussion FAB (mirror mobile
\#347) as that control's engine room; the FAB itself is gone, but this bridge is not — it is the shared
nav wiring behind every surviving way to start a conversation on the [Channel List](channel-list.md): the
Chats-tree workspace row's `Create chat` plus
([#1178](channel-list-workspace-row-nest.md)),
the Channels-tree plus's [Create-channel dialog](create-channel-dialog.md) (#1179), and the host row's
[Add workspace dialog](channel-list-host-row.md#the-add-workspace-dialog-1308) (#1308).

**The FAB itself is deleted (#1426).** It was a 56px floating `+` pinned bottom-right over the list,
`aria-label="New discussion"`, present in all three list states — invented for the mobile-era flat list
(#242) before the tree had a plus of its own, and disabled unless exactly one host was paired and
connected. Juhana ruled it a special case of the workspace row's own `Create chat` plus (choosing its
workspace from a Settings default instead of a click) that the sidebar's Figma card (103:2959) never
drew. `requestNewConversation` — the constructor the FAB called — now has exactly one production caller,
the Chats-tree workspace row's plus; the [default-workspace store](default-workspace-store.md) the FAB
read for that call's `cwd` now has no renderer reader at all (see that store's own doc for the open
question this leaves).

Introduced in [#242](../codebase/242.md), split from [#142](../codebase/142.md); the sibling transport
ticket [#241](../codebase/241.md) (the `createConversation` command / `conversationCreated` event)
shipped first and is consumed here unchanged. The original bridge changed no transport,
IPC, store or wire code. Automatic model recall now composes renderer stores and the
existing settings-write path; its [security review](../../specs/architecture/1701-remembered-model.md#security-review)
covers captured ownership, raw eligibility and correlated settlement.

## How it works

One module, twin of [`conversationListBridge.ts`](conversation-list-store.md#the-data-path-srcrenderersrcstoreconversationlistbridgets):

### The bridge (`src/renderer/src/store/conversationCreatedBridge.ts`)

```ts
requestNewConversation(sendCommand: (c: RendererCommand) => void, defaultCwd: string | null, serverId?: string): void
// sendCommand({ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: defaultCwd }, ...serverId })
// inline literal, no builder — the requestConversationList precedent. Sole caller today: the Chats-tree
// workspace row's "Create chat" confirmation, passing null for the clicked host's daemon default.

translateConversationCreated(event: DaemonEvent): ConversationCreatedPayload | null
// switch (event.type) { case 'conversationCreated': return event.conversation; default: return null }

subscribeConversationCreated(onDaemonEvent, onCreated): () => void
// onDaemonEvent(event => { const c = translateConversationCreated(event); if (c !== null) onCreated(c, event.serverId) })
// returns the off-handle

useConversationCreatedNav(onCreated: (created: ConversationCreatedPayload, serverId?: string) => void): void
// React glue: subscribes once (empty-dep effect), holds the latest onCreated in a useRef so a
// fresh inline arrow each render never re-subscribes; window.pyry dereferenced only in the effect
```

`requestNewConversation` has two fixed-payload siblings in the same file, one per other caller —
`requestNewChannel` (`is_promoted: true` plus a trimmed name, the Channels-tree plus's [Create-channel
dialog](create-channel-dialog.md), #1179) and `requestNewWorkspaceChat` (an operator-typed folder and a
required `serverId`, the host row's [Add workspace dialog](channel-list-host-row.md#the-add-workspace-dialog-1308),
\#1308) — each documented in full at its own caller's doc, not duplicated here. A fourth export,
`subscribeConversationCreateRejected`, is the nullary rejection twin of `subscribeConversationCreated`;
see [Conversation create § Error handling](conversation-create.md#error-handling).

`translateConversationCreated` uses a **soft** `default: null`, not `assertNever` — this path
permanently consumes only `conversationCreated` (the `translateConversationsEvent` posture, not the
hard-`assertNever` `daemonEventBridge`/`timelineBridge`/`modalBridge` shape). It returns
`event.conversation` directly (a filter, not a field remap), so a rename of the arm is still caught by
the `case` label failing to overlap the union.

The bridge passes the decoded payload and main-stamped creating host to `onCreated`.
`useConversationCreatedNav` starts [remembered-model recall](remembered-model.md) before
calling it, installing the hold and reply listeners before activation can request settings.
Only newly created unpromoted chats recall; channel creation navigates without recall.
The hook captures the target's identity and observes active-conversation and owning-host
status changes to cancel the attempt. Its cleanup also cancels recall.

### The nav wiring (`src/renderer/src/PairedShell.tsx`)

`PairedShell`'s `useConversationCreatedNav` callback activates the created conversation,
retains the stamped host and conversation as the pane/timeline target, initializes its
timeline and post-list configuration request, then dispatches the existing `open`
transition. All three create callers use this callback. Activation requests the new
chat's own settings and model list; recall retains early replies without reading the
active-only session store. Bridge access remains effect/interaction-scoped so the shell
stays server-renderable.

The subscription is **shell-scoped, not app-lifetime** — unlike `ConversationListData`, which must stay
live across routes, `useConversationCreatedNav` is mounted only where `PairedShell` mounts (the paired
`conversation` route). On unpair the shell unmounts, the effect cleanup fires the off-handle, and the
subscription tears down; on re-pair a fresh shell mounts a fresh subscription.

### Data flow

```
Chats-tree "Create chat" plus (#1178) → confirmation dialog → OK
  → requestNewConversation(window.pyry.sendCommand, null, serverId)
  → sendCommand({serverId, type:'createConversation', payload:{is_promoted:false,name:null,cwd:null}})
  → [#241, already shipped] COMMAND_CHANNEL → createConversation(payload) → daemon

daemon → conversation_created frame → [#241] → conversationCreated DaemonEvent
  → DAEMON_EVENT_CHANNEL → useConversationCreatedNav's subscription
    → translateConversationCreated → payload (or null → skip)
    → start model recall for a new chat (hold/listeners before activation)
    → activate created conversation + retain creating host → dispatch({ type: 'open' })
  → PairedShellView route flips 'list' → 'thread' → ConversationScreen renders
```

The Channels-tree plus and the Add-workspace dialog feed the same `conversationCreated` event into the
same subscription through their own constructors (`requestNewChannel`, `requestNewWorkspaceChat`) — the
diagram above is one representative path, not the only one.

## Edge cases and limitations

- **A create the daemon never confirms simply does not navigate.** The success reply carries no
  correlation to the outbound command — see [Conversation create § The success reply stays uncorrelated;
  the rejection, since #1307, does
  not](conversation-create.md#the-success-reply-stays-uncorrelated-the-rejection-since-1307-does-not).
  There is no timeout or retry here; [`conversationCreateRejected`](conversation-create.md#error-handling)
  (#1307) is a separate, bare failure signal each caller gates on its own in-flight state.
- **Navigation activates the created target.** Recall holds only that chat's sends through
  correlated settlement. Leaving or losing its host cancels the attempt; reopening or
  reconnecting never starts it again. See [recall addressing](remembered-model.md#creation-and-addressing).
- **Untrusted daemon strings are not rendered by the bridge.**
  `ConversationCreatedPayload.name`/`.cwd` pass through to activation; downstream
  displays follow the existing escaped-text contract.
- **The click→command wiring and the event→nav wiring are each unit-proven, not DOM-tested** — the
  codebase has no jsdom harness (`renderToStaticMarkup` only). `conversationCreatedBridge.test.ts`
  spy-drives the pure helpers; the full click→command→event→nav chain is proven by composing these
  tested units with the already-tested `nextPairedRoute` reducer, the `interactiveRoundtrip.test.tsx` /
  `PairedShell.test.tsx` precedent, and (for the surviving `Create chat` plus) the fake-transport
  Playwright specs that press it.

## Related

- [Conversation create (transport)](conversation-create.md) / [#241 codebase notes](../codebase/241.md)
  — the `createConversation` command and `conversationCreated` event this bridge consumes unchanged.
- [Paired shell](paired-shell.md) / [#140 codebase notes](../codebase/140.md) — the `list ⇄ thread`
  router; `useConversationCreatedNav` drives its `dispatch({ type: 'open' })`.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the screen
  every one of this bridge's callers lives on.
- [Channel List — the workspace row's own nest and its create-chat
  plus](channel-list-workspace-row-nest.md)
  (#1178) — `requestNewConversation`'s sole production caller today.
- [Create-channel dialog](create-channel-dialog.md) (#1179) and [Channel List — the host row § The Add
  workspace dialog](channel-list-host-row.md#the-add-workspace-dialog-1308) (#1308) — the other two
  callers, `requestNewChannel` and `requestNewWorkspaceChat`.
- [Conversation list store](conversation-list-store.md) — the sibling bridge
  (`conversationListBridge.ts`) `conversationCreatedBridge.ts` mirrors member-for-member.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  the setting the FAB used to read for `requestNewConversation`'s `cwd`; orphaned by the FAB's removal.
- [#242 codebase notes](../codebase/242.md) — the FAB's original implementation summary, patterns,
  lessons.
- Spec: `docs/specs/architecture/242-new-discussion-fab.md` (the FAB's own spec) and
  `docs/specs/architecture/1426-remove-new-discussion-fab.md` (its removal).
