# Paired shell — confirmed conversation deletion

A daemon-confirmed deletion removes its explicitly owned retained thread even when another
conversation is open. Only deletion of the active, owned conversation clears the active stores and
returns to the list. Part of [conversation exits and stamps](paired-shell-conversation-exits.md).

## The delete exit (`exitActiveConversation.ts`, `conversationDeletedBridge.ts`, #652)

`exitActiveConversation` is the React-free active-thread exit shared by deletion, archive and
server-scoped cleanup. It reads the current active conversation through a getter at invocation time;
a mismatched id or no active conversation is a total no-op. Keep that gate: Delete begins in A's
Channel Info sheet, but the operator can open B before A's confirmation arrives. Removing the gate
would clear B's live thread and configuration. The gate describes which conversation is on screen;
it does not establish host ownership or correlate a locally issued request.

Past the gate, the synchronous ordering is:

```text
dispatchTimeline({ type: 'reset' })
clearTimelineFor(conversationId)
clearActiveConversation()
clearSessionId()
clearRunConfig()
navigateToList()
```

The keyed clear deletes the slice rather than replacing it with an empty timeline. The last effect
is navigation so the list cannot appear against the departed thread's state. `clearRunConfig` clears
the run snapshot, pending/confirmed/rejected settings writes, system-prompt reading and system-prompt
writes together; see [run-configuration clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167).
Clearing the session also makes run-configuration writes inert rather than addressing the destroyed
conversation's daemon session. Repeating an active exit is harmless because the active record is now
null. The helper itself produces no diagnostic.

This is a conversation boundary, so it does not invoke `clearPairingScopedState`. Connection status,
other retained timelines, last-read marks and daemon-scoped command menus survive. Announced models
remain keyed by conversation; a deleted id has no active consumer. The queue is selected by the
active id, so clearing that id hides its backlog without clearing other conversations' queues.

Archive still calls this helper directly through
[its active-only list predicate](paired-shell-conversation-exits.md#the-archive-exit-conversationarchivedbridgets-653).
An inactive archive flag or a missing list row cannot authorize permanent-deletion invalidation.

## Confirmed deletion and host authority

`confirmConversationDeleted` (`src/renderer/src/confirmConversationDeleted.ts`) separates retained
cleanup from active navigation. Its injected dependencies extend `ExitActiveConversationDeps` with
`getTimelineServerId(id)` and a diagnostic sender. The stamped origin must be a string exactly equal
to the retained slice's explicit `ConversationSlice.serverId` before either path runs:

- If the deleted id is active, call the unchanged `exitActiveConversation` sequence above.
- If another conversation or no conversation is active, call only `clearTimelineFor(deletedId)`.
  Survivor slice references and Map order remain unchanged. The route, active selection, flat
  timeline, session, run configuration and pending settings/system-prompt state stay intact.

Missing/null origin, absent slices, unknown ownership and foreign ownership authorize neither removal
nor active exit. A confirmation from H therefore cannot exit a same-id chat whose retained slice is
owned by another host. Ownership comes from the retained slice and the main-stamped event, never an
active-host guess, list membership or a local pending-request tracker. An owned daemon confirmation
is authoritative even without a remembered Delete request.

Duplicate confirmations and absent ids are harmless. Ids remain exact Map keys, including `''`,
`__proto__` and `constructor`; no object-key conversion or truthiness filter is allowed. Diagnostics
contain only `event: 'conversation-deletion'` and one static code: `unattributed`, `unowned`,
`active-cleared` or `inactive-cleared`. They carry no conversation/server ids or thread content.

The ownership getter flushes accepted timeline frame folds before reading the owner. The decision
then checks and removes synchronously, without an await. The existing publication mutation boundary
and saved-read ownership checks prevent work accepted before confirmation from recreating the
removed slice; see [holder deletion lifecycle](conversation-timeline-holder.md#confirmed-deletion-lifecycle).
A pending foreign-host fold can establish a different owner during that flush, in which case H's
confirmation is refused. Fresh traffic arriving after deletion remains outside this guarantee.

## Subscription and mounted wiring

`translateConversationDeleted` retains its string/null contract: the bare deleted id for
`conversationDeleted`, null for unrelated events. `subscribeConversationDeleted` filters with
`!== null`, preserving empty ids, and forwards `(conversationId, serverId)` from the same event.
Main stamps the origin from the connection; it is not a daemon-payload claim. The existing bare-event
test seam yields undefined origin, which grants no deletion authority.

`useConversationDeletedExit` holds the latest two-argument callback in a ref, subscribes once in an
empty-dependency effect and returns the off-handle for teardown. It dereferences `window.pyry` inside
the effect, preserving static rendering. Static renders never execute that effect.

`PairedShell` mounts the decision using its existing module-scoped exit dependencies:

```ts
useConversationDeletedExit((conversationId, serverId) =>
  confirmConversationDeleted(
    {
      ...exitConversationDeps,
      getTimelineServerId: id => {
        conversationTimelineStore.flushTimeline()
        return conversationTimelineStore.getState().timelines.get(id)?.serverId
      },
      log: event => window.pyry.sendDiagnostic(event),
      navigateToList: () => { leaveRecovery(); dispatch({ type: 'back' }) }
    },
    conversationId,
    serverId
  )
)
```

Getters read singleton stores at delivery time rather than closing over render-time state. Navigation
stays container-local because it needs the shell's dispatch. The existing absolute `back` arm returns
to the list without a new route or reducer action. A delayed owned active deletion after leaving the
thread without selecting another conversation can still return from Settings/Archive to the list;
route-aware navigation is a separate concern. Inactive deletion never invokes that navigation.

The independent list bridge still sends one re-list on confirmation. Sidebar disappearance alone
does not establish retained-thread removal: those subscriptions mutate different stores. Neither a
Delete click, a sent request, rejection nor an unrelated event enters the new invalidation path.
The existing [chat-history writer](chat-history.md) remains responsible for confirmed removal of saved
history and daemon items; this decision adds no persistence deletion path or wire change. Cross-client
deletion fan-out and migration to authoritative thread items are separate work.

## Regression coverage

`confirmConversationDeleted.test.ts` injects real keyed, flat, active, session, run-configuration,
settings-write and system-prompt stores through the deletion subscription. It proves A-only removal,
B's identity/state preservation, exact owner refusal, active clear-before-navigation, hostile-looking
keys, duplicate/absent ids, unsubscribe and ignored events. Controlled frame scheduling and saved-read
success/failure/cancellation exercise the real lifecycle seams after confirmation. The existing
`exitActiveConversation` mismatch regression must continue passing; its no-op is correct for that
helper even though a confirmed deletion now has an independent cleanup path.

The mounted fake-transport spec `e2e/conversation-delete-inactive.spec.ts` initiates Delete in A's
sheet, holds its correlated reply, opens B and then releases A's confirmation. It captures A's actual
mounted `useSyncExternalStore` getter through test-only React fiber inspection before switching away,
and reads null after confirmation. It adds no production test accessor. The missing sidebar row is
only a receipt/re-list barrier; the selector proves removal while B's thread, selection and displayed
configuration remain intact. Checking only the list row would pass with the original retained-state bug.

[Verifier evidence for #782](https://github.com/pyrycode/pyrycode-desktop/pull/1945#issuecomment-6137862925)
records the original callback's fails-before run: 1 executed, 1 failed, 15 unselected/skipped. The
dispatcher unit run executed 10,011 tests, 0 failed and 3 skipped; all 16 current decision cases were
present and passed, including queued publication and late saved-read settlement. The fake-transport
gate executed 388 tests, 0 failed and 3 skipped. The held-confirmation spec and the existing
`conversation-archive-lifecycle`, `conversation-switch-keeps-both-threads` and `timeline-frame-deltas`
specs were each present and passed on retry 0; that subset executed 4, with 0 failed and 0 skipped.
No real-Claude test is required for this lifecycle.
