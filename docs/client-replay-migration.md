# Client replay migration inventory

Baseline: Desktop `008f468f95acc70a568b4ea41f5ade9e5cc80927`, including
PR #2036 (`834400252ca7a9c8d9d68d43fc521b7d8be3d2c4`). This inventory describes
26 source files: 28 active cases, plus the permission scenario from PR #2036, for 29 active replay cases. One pre-existing system-prompt reset fixme is excluded. The final capture and replay results below distinguish executed evidence from exclusions.

The original live test bodies remain the assertion source. Replay may supply
captured daemon messages and explicit recorded scenario inputs. It must not
fabricate replies, substitute a renderer, or satisfy a file-effect assertion
with a recording. Fresh verification must execute the original live assertions.

## Protected board work

The orchestrator confirmed `held:manual-client-replay` on Desktop #1662 (model
handover), #1929 (orchestrator app integration), #2046 (history-on-open baseline),
and #2050 (idle daemon history queries). Holds stay until the migration merges.
Core #3502 and #3508 are held prerequisites. A hold alone does not establish ticket acceptance; #1662 and #1929 remain separate feature work.
Unrelated storage and fake-suite work remains under its existing owners.

## Scenarios

| Original live file (under `e2e/`) | Client assertion scope | Additional live proof retained |
| --- | --- | --- |
| `real-claude.spec.ts` | UI chat creation and two successive streamed replies | Real Claude liveness and real transport |
| `real-claude-attachment.spec.ts` | Native attachment selection, upload payload, returned description | Real image interpretation and daemon upload/retrieval; the existing picker stub remains |
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

Core #3502 is satisfied by merged PR #3505: authenticated cold/idle query demand keeps a joined view alive until its connection generation retires. The unchanged two-turn Claude check and history reopen acceptance pass against that source-stamped implementation. Desktop maps the daemon's native reset
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

The production capture also exposed dropped top-level conversation routes in
Desktop's decoder. Supplied live-state session tags describe the producing
source, including the daemon-wide model vocabulary source; they do not identify
the destination conversation. Desktop now validates the supplied route, rejects
conflicting payload routes, preserves it across the real preload, and isolates
readings and clears by host plus conversation. Envelopes without that newer
route retain the prior bound-session checks. Live-state tests retain their
original scope/provenance assertions and add the current protocol cases.

Capture retains the complete decrypted JSON envelope after validation, including
forward-compatible metadata. Replay compares every outgoing envelope field
except fresh request identity and timestamp, and rebinds client upload/message
identities once. It never regenerates missing daemon metadata. Only successful complete captures are eligible; failed exploratory captures remain private diagnostics.

The independently merged core PR #3505 (`4871e083`) superseded the parallel
prerequisite PR #3507; live two-turn and history acceptance pass on the merged
implementation. Core PR #3509 then adds #3508's intermediate Send now state. Final captures use the isolated, clean, source-stamped `58f46aa5` binary containing both fixes; the installed application daemon is unchanged.

A live agent turn returned the complete marker, but Desktop rejected the
protocol's combined field-change/suffix pair because the suffix keeps the final
revision. The item store now accepts one ordered companion at the same version
and revision, invalidates that opportunity across intervening full data, and
refuses duplicate suffix application. Owned encrypted persistence accepts only
strict text growth at an equal revision with every other field unchanged.
Replacement, rollback, duplicate and restart checks remain explicit.

Configuration revalidation is bounded to one request pair per selected bound
session and opening after an admitted withdrawal of a previously held settings
reading. It does not retry missing initial replies. Effort recall waits for a
real configuration reading before interpreting an empty effort as unset.

Core #3508 adds the successful Send now write fact needed before a held tool
echoes input. Desktop recognizes the explicit pending `written` status as one
user row without queue actions. Every original Send now assertion, including
the release-file ordering, remains. Successful live-only assertions also mark
causal checkpoints: offline waits for their actual recorded message prefix but
never executes or claims the filesystem/OS proof.

Observed push-overload closes are recorded at the exact application-message prefix with their actual WebSocket code. Replay forwards every preceding encrypted frame before reproducing that local close; explicit application reconnects and profile relaunches still come from the shared scenario. Capture adapters remain separate build inputs.

The evidence observers also retain native identity semantics: queue markers include an ordered same-revision suffix, and a completed permission turn is counted once even when reconnect returns its item again. These repairs preserve every original matcher and strengthen the meaning of completion. An AST audit retains all 1,028 original expect expressions, plus all 1,036 from merged baseline `aebee62f`.


The queue-drop scenario positively observes its native turn completion and rendered
assistant before checking the original absence and settled-row assertions. The
previous absence-only gate could run before the final assistant arrived. Reset
and permission menu input can reopen only across an observed connection change
and only before any menu activation was dispatched. No mutation is retried.
Question answers and refusals bind their fresh answer token once; every choice,
answer field and subsequent token reuse remains checked.

Saved restoration can finish between an ordered field update and its text suffix.
The store retains that pending companion only when the exact admitted live item
wins the merge; a replacement item invalidates it. This integrates with the
saved/live restoration fixes merged in PR #2058.

## Validation evidence

On October 16, all 29 active cases passed guarded offline replay in 76.172 seconds,
with zero forbidden executable launch attempts, zero failures and one pre-existing
fixme. Every committed recording is byte-identical to a successful actual capture;
source identities are retained per recording rather than rewritten to the merge
commit. Fresh live verification and the final default-suite results are recorded
in the live runbook.

The dedicated Codex scenario's provider warning retains the path of its isolated
test config. It contains no credential or config contents. The configured Claude
credential is passed only to the live subprocess environment. No credential file
is copied into a fixture or a production build.
