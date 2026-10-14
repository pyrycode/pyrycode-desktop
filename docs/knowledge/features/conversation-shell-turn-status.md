# Conversation shell — turn status surfaces

The conversation shows retained turn and refusal records alongside live composer status.
Part of [Conversation shell](conversation-shell.md).

- [Background tasks](conversation-shell-background-tasks.md)
- [Timeline render and stopped-turn records](conversation-shell-timeline-render.md)
- [Thinking and working indicator](conversation-shell-working-indicator.md)

## Session-scoped live presentation

The inactive `threadLiveInputs` projection supplies existing views from
[summary-bound live state](session-id-store.md#summary-authority-in-the-inactive-thread-adapter).
Live readings remain independent of durable daemon items: turn/stall/retry/compaction,
thinking/tool/task progress, resetting/rate limits, model/context, session facts/settings,
MCP/slash/model inventories, suggestions, errors and outstanding permission/question
prompts remain available even without content rows. Existing translators produce
the run-config, announced-model and prompt shapes; settings payload `sessionId`
remains reported data and cannot replace the summary binding.

`workingIndicatorStateWithLocalSend` preserves the existing resetting → retrying →
compacting → stalled → thinking/working ranking and the caller's local-send input.
Activity booleans and eligible outstanding prompts supply attention inputs.
Lifecycle retirement happens after admission, atomically with the new reading:

| Admitted input | Retired live readings |
| --- | --- |
| Any `turnState`, including idle | Onset-only stall |
| Non-thinking `turnState` | Thinking estimate |
| Non-idle `turnState` | Session error |
| `sessionError` | Turn phase, stall, retry, compaction and thinking estimate |

Repeated thinking retains its estimate; after responding/idle, the next thinking
phase starts without the previous estimate. Idle preserves a session error, while
thinking/responding clears it. An error makes the derived phase idle but preserves
other families, outstanding prompts and caller-owned pending/queued inputs.
Rejected old-session activity/errors change nothing. Retry and compaction normally
survive turn-state updates and owning-host reconnect until current supplied values
replace them, including `active: false`.

Canonical-clear checks alone miss these lifecycle rules: a fixture that assumes
every family coexists can bless a stale retry indicator after an error or a stale
thinking estimate in the next phase. The supplied-input specs in
`threadLiveState.test.ts` and `threadLiveInputs.test.tsx` cover A→B replacement,
delayed A readings, family clears, reused host/prompt IDs and atomic status/attention/error
transitions. Static renders exercise the existing view inputs; production composition,
integrated interaction and combined live proof remain with
[#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908).

## Model refusal records

`ModelRefusalRow` renders both refusal variants as retained `modelRefusal` timeline
items, including served history. A fallback reads `Refused on <original>, continued
on <fallback>`; no fallback reads `Refused by <original>`. An empty identifier reads
“unknown model”. These frames have no turn or message identity: they cannot retract
the refused partial or establish that a turn ended. Receiving one leaves the composer
model label under its existing settings/announcement authority.

A nonempty `banner` enables a native button disclosure, initially collapsed, with
`aria-expanded` and Enter/Space activation. Its expanded plain-text body begins
“Claude: ”. An empty banner has no disclosure. Model identifiers are displayed using
their first 256 characters and banners their first 8192; the stored identifiers stay
unchanged for [Switch back](conversation-shell-composer-status.md#refusal-switch-back).
All daemon text is escaped React children, never Markdown, markup, attributes, URLs
or logs. Category and truncation/drop reports remain inert metadata.

The collapsed label reuses session-separator typography and a shrinkable, single-line
ellipsis box; the expanded body wraps within the thread at the 800px window minimum.
The disclosure button explicitly sets `font-family: var(--font-sans)`: applying the
separator class only to its child leaves the native button's Arial font inherited
by that label. A static class assertion misses this; the computed-font check in
[`e2e/model-refusal.spec.ts`](../../../e2e/model-refusal.spec.ts) catches it alongside
keyboard disclosure and overflow. Static renders cover escaping, bounds and empty
banners. Rows remain after [the recovery offer retires](conversation-timeline-store.md#refusal-offer-lifetime).
