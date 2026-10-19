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
| `real-claude-question-answer.spec.ts` | Same outstanding two-question batch across model change; exact indexed UI answers, daemon dismissal, fresh confirmation and original-turn completion before model probe | Real question tool, answer interpretation and changed resolved-model announcement |
| `real-claude-question-cancel.spec.ts` | Clarification refusal, dismissal, stopped work | Absence of generated artifacts after Cancel |
| `real-claude-queue-delivery.spec.ts` | Queued send, delivery identity and ordering | Real entered/release files and tool effects |
| `real-claude-queue-drop.spec.ts` | Mid-turn enqueue, drop before drain, no later queued turn | Real gate file and genuinely running child |
| `real-claude-queue-send-now.spec.ts` | Send now inside the current turn | Real tool entered/release gate and child consumption |
| `real-claude-system-prompt.spec.ts` | Stored prompt at spawn; a save leaves current session unchanged | Actual system-prompt application; existing reset fixme remains explicit |
| `real-claude-thread.spec.ts` | Daemon-built stream, agent placement, reconnect, reset, exact protected saved-list title and saved-reply reopen | Real agent execution and transport restart |
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
as successful captures or replay coverage. The excluded reset-prompt scenario
failed its original September 15 live gate because reset relaunched the child
from frozen arguments instead of applying the newly stored system prompt. There
is no successful current capture of that assertion; its full test remains a fixme.

#1929 asks for a new orchestrator-hosted app integration, not an existing real
Claude spec. It is relevant board context but has no current scenario to migrate.
#1662's requested two-agent handover is also separate acceptance from the
existing Codex channel test. Neither can be closed on replay results alone.

## Question-answer proof

`claude-question-answer` selects an offered policy and answers a separate confirmation
question through Other. `scenarioInput('question-confirmation', ...)` supplies unique
text only after the two-question batch surfaces; the initial prompt cannot supply it.
The accepted pending-question model change must leave the original host, conversation,
batch and turn outstanding. Exact indexed values, including the surfaced policy label,
must match the observed submission. Panel disappearance alone is optimistic: the proof
also requires the owning daemon's answered dismissal, fresh top-level assistant text
containing the confirmation on the original turn, and a later matching normal terminal
item before the changed-model probe. Label mention order and prose format are irrelevant.

Same-route/epoch snapshots exclude known assistant text/revisions and terminal identities;
they never establish the witness, original tool turn or completion. Every accepted live
assistant text revision before submission also extends the exclusion baseline, including
between arming and submission. Shorter/missing bodies cannot erase exclusions, and a
status-only update cannot make old confirmation text fresh. Genuine subsequent appends
remain eligible, including paired same-revision suffixes. A terminal can complete the proof
only when first observed after the witness. See the
[observer contract and controls](knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md#question-answer-interpretation-and-freshness)
and [counted Linux evidence with distinct daemon provenance](knowledge/features/development-verification-live-test-diagnosis.md#question-answer-linux-acceptance).

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

Observed push-overload closes retain their raw application-message position and
actual WebSocket code. Capture observes client calls before sending, so trailing
calls can still belong to the closing connection without proving successful
socket writes. Replay exactly matches only its finite contiguous client-only
tail before reproducing the close, after forwarding every preceding encrypted
frame. No daemon frame crosses the raw close, and checkpoints and connection
ownership remain enforced. Explicit reconnects and profile relaunches still come
from the shared scenario. Capture adapters remain separate build inputs. See the
[close scheduling contract](recorded-tests.md#replay-contract).

The evidence observers also retain native identity semantics: queue markers include an ordered same-revision suffix, and a completed permission turn is counted once even when reconnect returns its item again. These repairs preserve every original matcher and strengthen the meaning of completion. An AST audit retains all 1,028 original expect expressions, plus all 1,036 from merged baseline `aebee62f`, normalizing only type assertions and the equivalent read-only inspection wrapper.

History's `mainRead` now uses synchronous inspection to bypass persistent
awaited-inspector promise loss after relaunch, polling only unavailable reads
within the existing five-second bound. Valid false/empty observations retain
their original assertions. The replay SQLite prerequisite uses the same scoped
adapter; a false probe still rejects the addon with its rebuild diagnostic.
Isolation read-back retains its existing bounded transient-error treatment and
all isolation matchers. History observer installation inspects the actual IPC
listener after a lost acknowledgement; a guarded installation can run again only
after conclusive absence, and cannot duplicate a late listener or reset observations.
All original matchers and expected values remain unchanged. See the
[inspection contract and dependency-upgrade caveat](knowledge/features/e2e-harness-context-recovery.md#persistent-awaited-inspector-loss).


The queue-drop scenario positively observes its native turn completion and rendered
assistant before checking the original absence and settled-row assertions. The
previous absence-only gate could run before the final assistant arrived. Reset
and permission menu input can reopen only across an observed connection change
and only before any menu activation was dispatched. No mutation is retried.
Question answers and refusals bind their fresh answer token once; every choice,
answer field and subsequent token reuse remains checked.

Reset, system-prompt save and the Codex scenario now positively observe a normal native turn completion before subsequent configuration input. The Codex Create channel input also waits for the actual enabled control after reconnect. The visible-tail fake scenario drains the queued scroll input before its next pushed completion; all original read-mark assertions remain.

Saved restoration can finish between an ordered field update and its text suffix.
The store retains that pending companion only when the exact admitted live item
wins the merge; a replacement item invalidates it. This integrates with the
saved/live restoration fixes merged in PR #2058.

## Validation evidence

Replay evidence identifies the executed build separately from capture provenance.
Default replay uses normal output and checks automatic projection policy, including
compact selection when accepted capabilities permit it. Explicit
`node scripts/run-offline-replay.mjs --profile complete-thread --retries 0` builds
the current source's complete route for the whole run, including creation and
reconnect, then restores normal output after success or failure. Both profiles
retain the executable guard, original shared assertions, full-envelope matching,
captured capabilities, causal barriers and completion checks. Neither supplies
fresh provider behavior or physical transport proof. The
[replay contract](recorded-tests.md#replay-contract) gives the exact retained-input
selection, restoration failure behavior and separate revision/dirty/profile,
bundle-hash, input-checksum and capture-source fields.

The [combined Linux retained-input acceptance](knowledge/features/development-verification.md#captured-close-client-tails)
resolves the earlier close-ordering hold. On clean build revision
`3372c1f318aa4da6d46c4638fd0ce4dccb990998`, the unchanged retained question input
(`24bbe5df…dac1`, captured from Desktop `ef097bfc` / daemon `66430593`, Claude
2.1.280) passed the original named question-answer scenario under
`--profile complete-thread`: 1 executed/passed, 0 failed/skipped, retries zero,
38 matched / 201 emitted / 0 remaining and zero forbidden launches. All four
original closes remain consumed with their captured codes and positions intact.
The linked evidence carries the full input checksum, daemon binary checksum,
bundle provenance and commands separately from the executed build identity.

The subsequent complete guarded normal-profile committed-recording suite recorded
29 executed/passed, 0 failed, 1 skipped, retries zero and zero forbidden launches;
all 29 exchanges completed at 773 matched / 3,216 emitted / 0 remaining. The
excluded `real claude picks up a saved channel system prompt at Reset session`
remains an explicit fixme. Earlier retained-input runs remain failed: compatibility
alone forwarded the prefix but left 29 requests outstanding, while automatic
selection failed earlier on a compact request. Offline completion establishes no
fresh provider behavior or physical transport acceptance; macOS is outside this
Linux ticket's verification scope.

The [completed-profile retirement contract and Linux evidence](recorded-tests.md#replay-contract)
record the final connection-completion then relay-forwarding boundary, five fresh
three-worker paired batches (20 executed/passed, 0 failed/skipped), subsequent
guarded replay (29 executed/passed, 0 failed, 1 existing fixme), and both named
history/thread cases passed without retry in the configured application gate
(515 executed/passed, 0 failed, 5 skipped). This closes the later retirement
acceptance; #2129 is closed. Earlier failed runs remain historical failures.

The [saved-title observation evidence](knowledge/features/development-verification.md#protected-saved-list-title-observation)
records the controlled stored-null mechanism, 11 passing regressions, five
three-worker paired batches (20 passed), the complete guarded recorded run
(29 passed, one existing system-prompt-reset fixme), and both named relaunch cases
passing without retry in the 515-case Linux application gate. Full executed,
failed and skipped counts and unchanged capture provenance are retained there.
The controlled delay does not establish the historical failure's production cause.

The [Linux relaunch repair evidence](knowledge/features/development-verification.md#replay-inspection-after-profile-relaunch)
records five consecutive two-worker paired runs, the complete guarded recorded
suite and the configured application gate for #2072. It preserves the failed
gate's unrelated visible-tail result separately. Both repaired scenarios passed
without changing capture bytes or provenance, strict matching, causal barriers
or exchange-completion checks. These offline results add no live/physical-effect
acceptance; the existing system-prompt-reset fixme remains excluded.

On October 16, all 29 active cases passed fresh live capture on Desktop
`8bd3abb9`, using the isolated `58f46aa5` daemon (macOS binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`).
All original live-only assertions ran. The complete integrated unit suite passed
9,205 tests in 399 files, with six existing platform/opt-in skips. The live runbook records
final full-suite, cross-platform replay counts and equivalent-scope timings. The
complete normal application gate passed 466 cases, failed zero and retained two
existing skips with no test retries; the last changed transport fixture also
passed its 46 forwarding/responder/setup checks.

Every committed recording is byte-identical to a successful actual capture;
source identities remain per recording rather than being rewritten to the merge
commit. The fresh comparison identified 18 strict trace differences: query/read-mark
coverage, numeric cursors and observed connection-close boundaries varied with
provider output and arrival timing. Manual review found the same ordered mutation
types, choices and payloads after fresh identity binding. These remain reported
as drift; no cursor, read mark or close is erased to turn verification green.
The upload identity comparison now binds `attachment_ids` to the same previously
observed `attachment_id`, while changed bytes or substituted attachments still fail.

Earlier failed runs remain failures: transient Electron inspector reads, a lost
observer-installation acknowledgement, one Linux paging-progress timeout, a
macOS fake-server HTTP 400/501 before Electron launch, and loopback handshake
starvation under unrestricted unit concurrency. Read and installation handling
are bounded as described above; unit verification uses four workers. The test
forwarder now explicitly binds its advertised IPv4 loopback address. Its 46
forwarding/responder/setup checks pass; the earlier HTTP failures do not establish
a root cause and remain recorded failures. No test
retry or assertion weakening converts those runs into successful evidence.

The dedicated Codex scenario's provider warning retains the path of its isolated
test config. It contains no credential or config contents. The configured Claude
credential is passed only to the live subprocess environment. No credential file
is copied into a fixture or a production build.
