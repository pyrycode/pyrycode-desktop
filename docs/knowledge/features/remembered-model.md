# Remembered model for new chats

New chats recall the desktop profile's last deliberately confirmed model choice.
The preference and recall coordinator live in `src/renderer/src/store/rememberedModel.ts`;
the [composer model menu](composer-model-menu.md#new-chat-model-recall) renders the chat's
selection through its existing label layers.

## Persistence and scope

One raw, non-secret string lives at the fixed renderer-local `localStorage` key
`pyry.lastModel`, shared across hosts and agents and retained across restarts with the
same desktop profile. It is independent of mobile's preference. `createRememberedModel`
accepts a `ModelPreferenceStorage` read/write port for isolated tests; the production
port returns null and ignores writes without `window`, keeping imports safe in Node.

The [settings-write bridge](run-settings-write-store.md#remembering-the-confirmed-model)
remembers a non-empty deliberate model write from either the dropdown or Run configuration
sheet only after its correlated confirmation. It captures the pending record before the
reducer consumes it, then persists its raw `value` verbatim. No trimming, normalization,
family extraction or resolution lookup participates in persistence.

Pending, rejected, locally failed, unmatched or replayed writes cannot replace the
preference. Passive settings and announcements never remember. Automatic writes carry
`source: 'recall'` and never remember, even on success: a newer deliberate confirmation
during an attempt must survive that attempt's eventual acknowledgement. This differs
from [effort recall](last-effort-store.md), which can re-remember its confirmed value.

## Creation and addressing

Only the [create → navigation hook](new-discussion-fab.md#the-nav-wiring-srcrenderersrcpairedshelltsx)
starts recall, for an unpromoted newly created chat. Both Create chat and Add workspace
use it. Creating a channel and opening an existing conversation do not recall.
Each new-chat attempt reads storage once; missing, empty or raw `default` values skip.

The coordinator installs its pending hold and listeners before activation so it retains
early replies. It captures the created conversation, agent and main-stamped host. It
never reads the active-only session-id store, which activation clears. Only the target
host's first `runConfigReceived` for that conversation supplies the settings address;
later settings replies cannot retarget the attempt. An empty first session ID settles
immediately, even before models arrive.

## Eligibility and settlement

Recall waits up to five seconds for the created chat's model list, accepting one already
cached. The first available list must contain a row whose raw `value` exactly equals
the captured preference, whose agent matches the created chat (absent means Claude),
and whose `truncated_fields` excludes `value`. A truncated display name does not disqualify
an intact value. Empty, unoffered, wrong-agent and value-truncated lists settle without
a write; there is no fallback to a family or resolved identifier.

After eligibility, a separate five-second wait accepts the target's first settings
reply, including one received during the model wait. A usable session and currently
connected, unambiguous owning host permit exactly one model-only settings write. The
value is the captured raw preference. Confirmation commits the chat's own selection.

Command return does not settle recall. After submission there is no acknowledgement
timer: the hold lasts until the correlated confirmation or rejection, or cancellation.
The composer disables Send and synchronously checks the pending target in its shared
`sendText` path before `submitMessage`, covering Enter, Actions and status-area message
sends without consuming draft text or attachments. Unrelated chats are not held.

Read skips/timeouts and write failures fall back silently, preserving inherited settings
and the preference. A rejection removes the optimistic recall overlay without creating
the ordinary user-pick model error. Main-process encoding or driver-send exceptions
settle through the actual correlated rejection event, not a renderer catch around
fire-and-forget IPC; see [local settings-write rejection](session-settings-send.md).

Leaving, losing the owning connection, shell unmount or another creation cancels the
attempt, removes only its pending overlay, and cleans up timers/listeners. Reopening or
reconnecting cannot replay it. Another host's reconnect preserves the write correlation
and hold, allowing the owning host's later confirmation to commit the selection.

Diagnostics carry only static lifecycle/outcome codes under `composer-model-preference`
and `composer-model-recall`; model values, session/conversation IDs and exception text
never enter them. Skips and failures have no error UI or automatic retry.

## Testing

`rememberedModel.test.ts` injects storage, stores and fake time for raw persistence,
non-remembering cases, eligibility, both read deadlines, early settings, cancellation
and correlated settlement. The two-host regression uses `subscribeRunSettingsWrite`,
`foldWriteEvent` and the reducer: folding only chosen confirmation/rejection events can
pass while reconnect cleanup silently loses the pending model. Assert the committed
effective selection as well as send release.

`e2e/remembered-model-boundaries.test.ts` composes recall with `createDaemonConnection`.
An over-cap model exercises real encoding failure; a throwing driver exercises the send
catch. Asynchronous rejection delivery proves the hold remains after command return,
then releases with silent rollback, unchanged preference, inherited settings and no retry.
A synchronous renderer-send mock throwing cannot establish this background boundary.

`e2e/composer-model-recall.spec.ts` withholds replies to prove Send/Enter/Actions retain
drafts and attachments through confirmation or rejection, and excludes existing chats
and channels. `e2e/real-claude-model-recall.spec.ts` confirms a published model different
from the inherited one, restarts the same profile, creates a chat and asserts its first
announcement equals that row's resolved model. An actually executed passing live test
is required; an all-skipped exit is not evidence.

See the [design and settlement revision](../../specs/architecture/1701-remembered-model.md).
