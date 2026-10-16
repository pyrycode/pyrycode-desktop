# Client replay migration inventory

Baseline: Desktop `008f468f95acc70a568b4ea41f5ade9e5cc80927`, including
PR #2036 (`834400252ca7a9c8d9d68d43fc521b7d8be3d2c4`). This inventory describes
work in progress; a planned recording is not evidence of a successful capture.

The original live test bodies remain the assertion source. Replay may supply
captured daemon messages and explicit recorded scenario inputs. It must not
fabricate replies, substitute a renderer, or satisfy a file-effect assertion
with a recording. Fresh verification must execute the original live assertions.

## Protected board work

The orchestrator confirmed `held:manual-client-replay` on Desktop #1662 (model
handover), #1929 (orchestrator app integration), #2046 (history-on-open baseline),
and #2050 (idle daemon history queries). Holds stay until the migration merges.
A hold does not mean that this migration has satisfied a ticket's acceptance.
Unrelated storage and fake-suite work remains under its existing owners.

## Scenarios

| Original live file (under `e2e/`) | Client assertion scope | Additional live proof retained |
| --- | --- | --- |
| `real-claude.spec.ts` | UI chat creation and two successive streamed replies | Real Claude liveness and real transport |
| `real-claude-attachment.spec.ts` | Native attachment selection, upload payload, returned description | Real image interpretation and native file dialog |
| `real-claude-codex-channel.spec.ts` | Claude/Codex model selection and low-effort channel creation | Dedicated Codex login and actual model/effort announcement |
| `real-claude-effort-default.spec.ts` | Applied effort, preference confirmation, profile restart, chat recall, channel choice | Actual running model settings |
| `real-claude-interrupt.spec.ts` | Running affordance, interrupt request, quiescence and stable content | A genuinely running Claude child stops |
| `real-claude-mcp.spec.ts` | Published MCP server list in Channel info | Servers originate with the real child |
| `real-claude-model-recall.spec.ts` | Confirmed model survives restart and governs new-chat announcement | Real child's selected model |
| `real-claude-new-session.spec.ts` | Reset-session divider and subsequent reply | Real session restart |
| `real-claude-permission-modal.spec.ts` | Session checkbox, confirmation, repeated use, new-session prompt, Cancel | Witness mtime proves effects occur only with permission |
| `real-claude-permission-mode.spec.ts` | Confirmed bypass, no-op write, menu return, Manual approval Read | Registry/handoff-note setup and actual Read denial |
| `real-claude-phase-reconnect.spec.ts` | Same-turn status restored across reconnect | Real disconnect, running tool and filesystem release gate |
| `real-claude-question-answer.spec.ts` | Model change during question and continuation with original answer | Real question tool and continued child |
| `real-claude-question-cancel.spec.ts` | Clarification refusal, dismissal, stopped work | Absence of generated artifacts after Cancel |
| `real-claude-queue-delivery.spec.ts` | Queued send, delivery identity and ordering | Real entered/release files and tool effects |
| `real-claude-queue-drop.spec.ts` | Mid-turn enqueue, drop before drain, no later queued turn | Real gate file and genuinely running child |
| `real-claude-queue-send-now.spec.ts` | Send now inside the current turn | Real tool entered/release gate and child consumption |
| `real-claude-system-prompt.spec.ts` | Stored prompt at spawn; a save leaves current session unchanged | Actual system-prompt application; existing reset fixme remains explicit |
| `real-claude-thread.spec.ts` | Daemon-built stream, agent placement, reconnect, reset and saved reopen | Real agent execution and transport restart |
| `real-daemon-archive-order.spec.ts` | Archived channels sorted by use | Daemon registry timestamps independently checked |
| `real-daemon-conversation-lifecycle.spec.ts` | Archive, restore, deletion and reply-gated navigation | Real registry operations |
| `real-daemon-create-channel.spec.ts` | Named promoted channel, default workspace and dialog close | Real daemon creation semantics |
| `real-daemon-history-on-open.spec.ts` | Saved baseline, closed-app posts, >200 rows, gaps, checkpoints and paging | Real daemon control-socket posts, registry and protected-storage behavior |
| `real-daemon-multi-agent.spec.ts` | App's hello acknowledgement includes advertised capabilities | Actual authenticated capability negotiation, including reconnect |
| `real-daemon-promote.spec.ts` | Save-as-channel request and reply-gated affordance transition | Real promotion handler |
| `real-daemon-rename.spec.ts` | Rename request, new title and old-title removal | Real rename handler |
| `real-daemon-session-settings.spec.ts` | Write settlement, value retention and fresh settings read | Real session-pool persistence |

## Exclusion rules

Encryption interoperability, handshakes, reconnect transport, real process
liveness, native platform integration, and daemon/tool filesystem effects cannot
be established by application-message replay. Their live checks remain required.
These boundaries do not exempt the client request and UI assertions within a
mixed scenario from migration. Existing fixmes remain visible and are not counted
as successful captures or replay coverage.

#1929 asks for a new orchestrator-hosted app integration, not an existing real
Claude spec. It is relevant board context but has no current scenario to migrate.
#1662's requested two-agent handover is also separate acceptance from the
existing Codex channel test. Neither can be closed on replay results alone.

## Baseline repairs found by live execution

Core #3502 restores authenticated cold/idle query demand and keeps a joined
view alive until its connection generation retires. The unchanged two-turn
Claude check and history reopen acceptance run against that source-stamped
isolated candidate before its merge. Desktop maps the daemon's native reset
cause to the existing session divider presentation.

The history test now obtains its conversation ID from the real conversation
list (and independently checks the registry during live execution). Its fresh
profile reads backward with repeated trusted input: production requests one
bounded page per input, so one Home key cannot establish coverage of 205 rows.
Every original assertion remains. The already completed resumed profile exits
before the independent fresh profile, giving each captured connection one
sequential lifetime. Question fixtures explicitly enable the daemon's stdio
permission/question bridge; the original answer, cancel and model assertions
remain. Channel section counting selects Channels and Chats, since Apps is a
separate section now.
