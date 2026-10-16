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
clearActiveConversation()
clearSessionId()
clearRunConfig()
navigateToList()
```

The last effect is navigation so the list cannot appear against the departed active state.
Neither flat nor keyed legacy timelines are reset or cleared. `clearRunConfig` clears
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

`confirmConversationDeleted` (`src/renderer/src/confirmConversationDeleted.ts`) retains the
owning-host admission check before active navigation. Its dependencies extend
`ExitActiveConversationDeps` with `getTimelineServerId(id)` and a diagnostic sender. The stamped
origin must be a string exactly equal to `getTimelineServerId(id)`. In current shell wiring,
matching `savedTimelineTarget` coordinates supply the captured selected host first; otherwise the
getter flushes accepted legacy folds and reads the slice's explicit `ConversationSlice.serverId`.
Missing/null origin, unknown ownership and foreign ownership grant no active-exit authority.
Do not replace this check with an active-host guess,
list membership or a remembered Delete request.

An admitted active deletion runs the sequence above. With another chat or no chat active, the
helper does nothing: #2028 removed `clearTimelineFor` and the `inactive-cleared` diagnostic.
Legacy slices survive both paths. Remaining diagnostics are the static `unattributed`, `unowned`
and `active-cleared` codes, without conversation/server ids or content. Repeated confirmations
cannot exit again after the active record becomes null. Exact Map keys, including empty and
hostile-looking strings, remain supported.

The legacy-holder fallback still flushes accepted timeline frame folds before reading the owner. A
queued foreign-host fold may change that fallback owner and cause refusal. This is a retained read-side
dependency, not permission to restore legacy navigation writes. Authoritative items, pending sends,
query/read authority and protected storage are removed at their existing independent lifecycle
boundaries; see [thread runtime cleanup](thread-runtime.md#restore-recovery-and-cleanup).

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
        if (savedTimelineTarget?.conversationId === id) return savedTimelineTarget.serverId
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
deletion fan-out is separate work; production content already uses authoritative thread items.

## Regression coverage

`confirmConversationDeleted.test.ts` adapts its existing real-store dependency factory. It proves
legacy slices remain identical on active/inactive confirmation, other active state survives inactive
confirmation, and owned active cleanup finishes before navigation. It retains missing/foreign-owner
refusals, duplicate/absent and hostile-looking IDs, ignored events and unsubscribe coverage.
Activation, exit and pairing tests also seed legacy state and assert preservation, so removing a
retired dependency cannot silently leave an old mutation behind.

Current mounted coverage uses `thread-activation.spec.ts` for deletion/owning-pairing cleanup and
`thread-items.spec.ts` for authoritative committed-visible-read publication. The
[counted #2028 evidence](thread-runtime.md#navigation-retirement-validation) names their passing
cases and preserves the historical native revision boundary.

Historical [verifier evidence for #782](https://github.com/pyrycode/pyrycode-desktop/pull/1945#issuecomment-6137862925)
records the retired legacy-slice removal behavior, not the current preservation contract.
Its original callback's fails-before run was: 1 executed, 1 failed, 15 unselected/skipped. The
dispatcher unit run executed 10,011 tests, 0 failed and 3 skipped; all 16 then-current decision cases were
present and passed, including queued publication and late saved-read settlement. The fake-transport
gate executed 388 tests, 0 failed and 3 skipped. The held-confirmation spec and the existing
`conversation-archive-lifecycle`, `conversation-switch-keeps-both-threads` and `timeline-frame-deltas`
specs were each present and passed on retry 0; that subset executed 4, with 0 failed and 0 skipped.
No real-Claude test is required for this lifecycle.
