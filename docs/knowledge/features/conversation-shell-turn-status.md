# Conversation shell — turn status surfaces

The conversation shows retained turn and refusal records alongside live composer status.
Part of [Conversation shell](conversation-shell.md).

- [Background tasks](conversation-shell-background-tasks.md)
- [Timeline render and stopped-turn records](conversation-shell-timeline-render.md)
- [Thinking and working indicator](conversation-shell-working-indicator.md)

## Session-scoped live presentation

The production `threadLiveInputs` projection supplies existing views from
[summary-bound live state](session-id-store.md#summary-authority-in-the-thread-runtime).
Live readings remain independent of durable daemon items: turn/stall/retry/compaction,
thinking/tool/task progress, resetting/rate limits, model/context, session facts/settings,
MCP/slash/model inventories, suggestions, errors and outstanding permission/question
prompts remain available even without content rows. Existing translators produce
the run-config, announced-model and prompt shapes; settings payload `sessionId`
remains reported data and cannot replace the summary binding.

Reports use the selected `threadRuntime.presentation(host, chat)`: complete items on
the complete route, admitted roots/headers on the compact route. Refusal and hook-stop
records require full-item content; foreground-tool status may use a header. Reports
do not consult older retained complete history while compact is selected.
Questions, approvals, actionable errors, delivery feedback and current-session
controls keep their admitted scoped authority with a parent closed; no hidden-body
read is needed. Header lifecycle/error facts may supply display status, but headers
and rendered detail replies create no task or action handle. See
[compact authority and read boundaries](thread-runtime-compact.md#root-facts-and-independent-evidence).

On the compact route, `liveTaskIdentities` additionally admits current-session
`backgroundTaskProgress` with an actual task ID, the selected host/conversation/epoch,
a matching envelope session and the owning summary's explicit agent. Missing agent,
session or task identity grants no membership. These live tasks can appear in the
count/drawer and offer guarded Stop with their parent closed; tool-call linkage
remains unknown (`toolCallId: null`). Full task-linked items retain their recorded
lifecycle and take precedence over matching live identities, including terminal
outcomes. Complete-route membership remains based on actual full-item links.

Stop rechecks current selection, selected presentation, admitted live identity and
the connected owning host's `stop_background_task` capability. Only Claude tasks
qualify. Pending claims use the scoped task identity, reject duplicate Stop and
survive unrelated compact revisions; the mounted presentation settles them with
the same live/full inputs. Reused IDs on another host, conversation, epoch, session
or agent cannot supply controls. Progress alone must not be forced through the
full-item tool-link requirement: compact headers intentionally have no such content.
See [task membership and controls](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)
and [counted mounted evidence](thread-runtime-compact.md#production-activation-and-visible-demand).

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
transitions. Static renders exercise existing view inputs. Mounted production
coverage also checks errors, session replacement and settings refresh through the
[thread runtime](thread-runtime.md#validation-boundaries). Credentialed live proof
remains separately pending.

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
