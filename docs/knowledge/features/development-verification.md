# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

| Topic | Reference |
| --- | --- |
| [What each test tier proves](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) | Static, mounted and live proof boundaries, with counted regression evidence. |
| [Evidence that cannot pass too early](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early) | Positive processing barriers and nonvacuous absence assertions. |
| [Layout and input](development-verification-layout-and-input.md#layout-and-input) | Measured layout, native input, focus and capture verification. |
| [Live-test diagnosis](development-verification-live-test-diagnosis.md#live-test-diagnosis) | Executable identity, credential ownership and counted live evidence. |

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## Replay build policy and provenance

An unchanged successful capture can fail strict replay after application selection
policy changes. A complete-thread capture may already grant `thread_compact`, so
automatic selection now sends a compact query it never recorded. Use the explicit
[complete-thread build invocation](../../recorded-tests.md#replay-contract) to
exercise the current source's existing complete route; keep default replay and
production compact-demand controls on normal automatic selection. Changing
capabilities or stripping projection would hide the contract difference.

Build identity must come from compilation-time metadata and output hashes, not
`git HEAD` observed later during replay. The runner refuses mismatched build
profiles, so interrupted compatibility output cannot silently masquerade as normal.
Keep executed revision/dirty status/profile and bundle hashes separate from raw
input checksum and capture source. An absent temporary capture path is not proof
that its bytes are unavailable: check immutable repository history and verify the
required checksum before substituting input or reporting missing access.

Synthetic thread replies need separate data and final frames, as the production
parser requires. Connection/composer readiness also does not prove the opening
query dispatched: wait for its positive content visibility barrier or poll the
matched count before asserting it. The accepted review retains a nonblocking
timing finding where the compatibility control checks that count too early.

### Counted Linux compatibility validation

These are retained results accepted by the
[PR #2151 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2151#issuecomment-6275916553),
not documentation-stage runs. Builder profile runs compiled clean source
`fc64084e9df76dfd11481b18571c7313ee7e28bc`; reviewed head
`12a162e1281b1362e7549726a59ae213ab53b168` differs only in the plan. The
[recovery evidence](../../specs/architecture/2149-complete-thread-replay.md#retained-input-recovery-and-final-linux-evidence--2026-10-19)
retains commands, report hashes, all bundle hashes and historical failures under
`/tmp/builder-2149/`. The builder browser runs in the table used retries 0 and
reported zero forbidden launches.

| Check | Executed / passed / failed / skipped |
| --- | --- |
| Profile, guard and strict-exchange units | 22 / 22 / 0 / 0 |
| Normal compact-demand and profile controls | 6 / 6 / 0 / 0 |
| Compatibility controls and committed-input shared question | 3 / 3 / 0 / 0 |
| Complete guarded normal committed-recording suite | 29 / 29 / 0 / 1 |
| Exact retained question, default profile | 1 / 0 / 1 / 0 |
| Exact retained question, complete-thread profile | 1 / 0 / 1 / 0 |
| Supplied dispatcher unit gate 4 | 9810 / 9810 / 0 / 3 |
| Supplied dispatcher application gate 7 | 517 / 517 / 0 / 5 |

The named control `complete-thread profile selects complete on opening, creation
and reconnect; normal rejects strictly` was present and passed in application
gate 7 and both builder profiles. Compatibility matched 3 complete queries, emitted
8 frames and left zero requests across initial opening, creation and same-ID
reconnect. Normal selection asserted `projection: 'compact-v1'` and sticky strict
rejection. Changed projection, version and envelope-field controls also passed.
Both successful and failed compatibility runs restored normal output.

`real claude changes model during a question and resumes with the original answer`
was present and passed in gate 7 and the builder's committed-input compatibility
run (29 matched requests, 136 emitted frames, zero remaining). That committed input
has SHA-256 `6de35feed0dcf02764da0765a4af03234314ff691a29cc975bf82c3e8d498d6b`,
capture Desktop `5788a683ab580647008eaf2b292631607c407ab8`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`. The complete committed suite completed
29 exchanges, 773 requests and 3,216 frames, zero remaining. Its one skip,
`real claude picks up a saved channel system prompt at Reset session`, was also
explicitly skipped in gate 7 and remains a fixme.

The separate retained input's checksum is
`24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`,
capture Desktop `ef097bfc29324437d067d65360558b8e77be8f40`, daemon
`664305939d73e5a146457503081d8232fcca5407`. Default preserves the strict step-4
mismatch before close, followed by worker exit 7; no completion attachment exists,
so remaining requests are unknown. Compatibility accepts the original complete
`thread_catch_up` at index 22 and records 9 matched requests, 38 emitted frames,
29 remaining. The observed reconnect and unchanged close-forwarding invariant
(39 successful server writes including Noise before close 4413) establish prefix
socket forwarding through index 47, without renderer acknowledgement. Subsequent
connection mismatch and the original visibility assertion fail. Both full retained
scenarios remain failed; #2141 owns its combined 1 executed/passed, 0 failed/skipped,
zero-remaining acceptance after its separate close-scheduler repair.

Earlier attempts remain failed: each of two invalid combined data/final fixtures
recorded 2 executed / 1 passed / 1 failed / 0 skipped; the missing-Electron launch
executed zero tests. An overly broad control invocation recorded 1 executed /
0 passed / 1 failed / 6 skipped and a nonzero forbidden-launch count when it selected
an unrelated native-writer dependency. It is excluded from the corrected focused
evidence above, which used `--project parallel --no-deps` under the same guard.
No fresh provider, live encryption or physical transport proof is claimed. macOS
is outside this Linux ticket's verification scope.

## Replay native storage prerequisite

Node and Electron require different `better-sqlite3` native addon ABIs. Rebuild
for Electron after installation or a Node rebuild before replay; the
[replay contract](../../recorded-tests.md#replay-contract) describes the command
and startup diagnostic. A missing Electron addon can look like captured-contract
drift: unavailable history storage makes a restarted profile send a fresh
`thread_catch_up` cursor. Diagnose native storage before changing recorded
requests or query ordering. The replay fixture checks an in-memory database in
each opened Electron main process, including relaunches, before device binding.
The probe proves addon load/open/query/close, not protected-profile persistence.
History IPC cannot substitute for this pre-pair check because it requires paired
host membership.

Finish pre-verify's Node rebuild before Electron-native preparation and browser
checks; running them concurrently can change the addon underneath a launched app.
The [#2097 repair evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2105)
retains seven storage failures from that overlap in `rework-specs.json`. After
sequential native preparation, `rework-final.json` recorded 37 executed/passed,
0 failed/skipped, covering the complete thread-activation, whitespace and reader-menu
specs. These reports are under `/tmp/builder-2097/`; the failed run remains failed.
See [saved traversal diagnostics](e2e-harness-context-recovery.md#saved-traversal-diagnostics)
for the separate listener-confirmation repair and accepted configured-gate evidence.

The [effort-default verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2071#issuecomment-6220345807)
records Linux x64 results for #2069. Failed unchanged-main evidence remains failed:
**1 executed, 0 passed, 1 failed, 0 skipped**, zero forbidden launches. At request
41 on connection 2, actual `thread_catch_up` used epoch `""` / version 0 instead
of the recorded saved epoch / version 14, followed by worker exit 7. Rebuilding
SQLite for Electron made the identical archived app/capture pass: **1 executed,
1 passed, 0 failed, 0 skipped**, zero forbidden launches. The
[plan's evidence paths](../../specs/architecture/2069-replay-native-storage.md#validation-evidence)
retain `baseline-native.log`, `historical-main-recorded.log` and the successful
`native-ready.log` under `/tmp/builder-2069/`.

The original focused effort-default scenario was present and passed:
**1 executed, 1 passed, 0 failed, 0 skipped** (`candidate-focused.log`). Complete
guarded replay recorded **29 executed, 29 passed, 0 failed, 1 existing
system-prompt-reset fixme**, zero retries and zero forbidden launches
(`recorded-final.log` / `recorded-final.json` in the same evidence directory).
Effort-default, model-recall and daemon-session-settings were present and passed;
all 29 exchanges had zero remaining requests. Effort-default matched all 96
requests and emitted 396 frames with the capture, original assertions, strict
matcher and causal barriers unchanged. These are recorded offline Linux results;
current provider behavior and live physical effects are not established, and
macOS is outside this ticket's verification scope.

## Replay inspection after profile relaunch

Bounded `app.evaluate` polling cannot recover persistent inspector await-promise
loss. At unchanged main `5c0793c7`, controlled inspection of `__threadHistoryAsks`
failed six consecutive times with `Runtime.callFunctionOn: Promise was collected`.
Even an awaited constant failed while the same-process synchronous history read
succeeded with `awaitPromise: false`; scheduling a Node turn did not restore it.
The original #2069 failures at `340f6a961a` retained only Playwright's rewritten
destroyed-context error: thread lost `assertReplayNativeStorage` after relaunch
(6 requests remaining), and history exhausted `mainRead` (14 remaining).
The unchanged rerun passed both with zero remaining; #2068 hit the same history
boundary. The controlled reproduction establishes the mechanism at that boundary;
the original reports do not expose their underlying protocol errors.

[`readReplayMainProcess`](../../../e2e/fixtures/replayNativeStorage.ts) bypasses
the awaited path only for the SQLite prerequisite and history's synchronous
`mainRead` observations. Public `evaluateHandle` also forces `awaitPromise` and
is not an alternative. The adapter obtains the current app's local inspector
session on every call; it never caches a session across relaunch. Playwright's
internal `_connection.toImpl(app)._nodeSession` access is isolated here and depends
on the lockfile-pinned implementation. Dependency upgrades must retain the
synchronous-inspection regressions and both relaunch replay checks. See the
[inspection contract](e2e-harness-context-recovery.md#persistent-awaited-inspector-loss)
for valid empty values, bounded unavailability and mutation boundaries.

The [verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2073#issuecomment-6221253088)
records Linux x64 on 2026-10-16, implementation `db6c6bb9`, reviewed head
`20fd3f8b`, main `5c0793c7`. These are retained results, not documentation reruns:

- Controlled regression `checks storage when the inspector loses every
  awaitPromise acknowledgement`: original **6 executed, 5 passed, 1 failed,
  0 skipped**; repaired targeted run **23 executed/passed, 0 failed/skipped**,
  including that case and all four observer-registration cases.
- Five consecutive focused guarded runs each used two actual workers,
  `--fully-parallel --workers 2 --retries 0`: **2 executed/passed, 0 failed/skipped**
  per run, **10 executed/passed, 0 failed/skipped** total. Both named scenarios
  were present and passed in every run:
  `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
  and `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.
  Every thread exchange matched 45 requests/emitted 378 frames; history matched
  32/emitted 63. All ten had zero remaining requests and zero forbidden launches.
- Subsequent complete guarded `npm run e2e:recorded` used one worker, retries zero:
  **29 executed/passed, 0 failed, 1 skipped**. Both named cases were present and
  passed; all 29 exchanges had zero remaining requests, with zero forbidden launches.
  The explicit skip remains `real claude picks up a saved channel system prompt at Reset session`.
- Configured application gate used two actual workers, retries zero:
  **492 executed, 491 passed, 1 failed, 4 skipped**. Both named cases passed on
  their first attempt with the same complete exchanges above; all 29 replay
  exchanges had zero remaining requests. The unrelated visible-tail failure is
  tracked in #2074; its separate rerun was **2 executed/passed, 0 failed/skipped**.
  This does not turn the original full gate into a failure-free run. Skips were
  three macOS-only cases and the system-prompt-reset fixme.

Capture bytes, assertions, strict matching and causal barriers are unchanged:
Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon source
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
The [plan's evidence paths](../../specs/architecture/2072-replay-inspection.md#validation-evidence)
retain diagnostics, red/green regression reports and `focused-1` through
`focused-5` plus `recorded-full` reports under `/tmp/builder-2072/`.
Offline replay establishes no fresh provider/daemon or physical-effect evidence;
macOS is outside this Linux ticket's verification scope. The SQLite ABI
prerequisite above still applies independently of inspection availability.

## Actual submitted-turn reply evidence

The daemon-built scenario in
[`real-claude-thread.spec.ts`](../../../e2e/real-claude-thread.spec.ts) records the
actual assistant replies. Requested `THREAD_AGENT`/`THREAD_RESET` wording remains
in the captured outgoing prompts, but does not determine success. Its single-consumer
[`threadReplyEvidence`](../../../e2e/fixtures/threadReplyEvidence.ts) collector runs
synchronously in the page and observes sends through CDP without replacing the preload API.
It filters both stamped and payload conversation routes to the created chat on the paired host.

Before each send, baseline the existing item and turn identities. Bind the fresh delivered
top-level user item to the outbound message ID. Native user items have no turn field, so
select the first fresh top-level work after that delivery's order in the same epoch,
session and agent, before the next user delivery. Require a fresh, nonempty, done/inactive
assistant and a later normal `turn_end` with the same attribution: `end_turn`, done/inactive,
without an error or unsuccessful outcome. Nested items, including replies carrying
`parent_tool_use_id`, cannot qualify. Neither old items, another chat's completion nor an
unrelated turn can supply the evidence.

Stable reply identity is host + conversation + epoch + item ID. Revisions and update
versions describe changes to that item, not a fresh reply. Apply full revisions and
base-matched text appends, including one immediately ordered same-version/same-revision
suffix companion; duplicate replay must not append it twice. Record settled native text
and session/agent/turn attribution. After the observed connection count advances, require
the first reply's identity and exact text to remain. After the additional reset delimiter,
take a new baseline and require a distinct reply identity and turn.

Protected `readThread` inspection must contain both recorded top-level replies with their
exact identities, attribution and original text before profile retirement. After full
process exit and same-profile relaunch, first assert there is no open conversation thread,
then inspect protected history again before opening the saved chat. This prevents network
history-on-open from repairing a missing saved reply. Missing or changed items and
pre-reset substitution fail. Retain agent placement before/after reconnect, capability
checks, and the separate [protected saved-list title observation](#protected-saved-list-title-observation)
with its string assertion. Saved reply content alone cannot establish list durability.

Rendered persistence needs identity as well as text: two turns can legitimately return
identical words, letting one body satisfy two text-only searches. In one poll, snapshot
each assistant body's nearest `data-read-row` ID and body text, then require both recorded
IDs with their expected text. The open conversation supplies host/conversation/epoch scope;
the row supplies the numeric item ID. Playwright's TSX transformation prevented React
server rendering of the imported view in this runner. Use the existing `markdownPlainText`
parser for expected body text, remove code-block headers/copy buttons and task marks from
cloned rendered bodies, and remove whitespace for the rendered comparison. Cursor and
statistics chrome are not reply text; native/saved comparisons still use exact original text.

The deterministic [collector and comparison tests](../../../e2e/fixtures/threadReplyEvidence.test.ts)
cover non-marker text, legitimate item updates, stale/wrong-route/wrong-turn/nested evidence,
missing or abnormal completion, missing/changed saved items and pre-reset substitution.
Equal-text rendering coverage requires both identified rows, rejecting either missing row,
duplicated substitutes, missing/substituted IDs and changed body content.

### Counted Linux thread validation

These are retained builder results accepted by the verifier for
[PR #2139](https://github.com/pyrycode/pyrycode-desktop/pull/2139), not documentation reruns.
On Linux x64, 2026-10-19, implementation
`5d06a2c7bcd080ea5b80817b2cf50166be3e5de8` was reviewed at
`39dfe1bbe3b299cd9afa9ddb159bb88d33d19c57`; the later commit records evidence only.
The [plan's rework evidence](../../specs/architecture/2138-actual-thread-replies.md#rework-validation-evidence)
retains reports and their SHA-256 hashes under `/tmp/builder-2138/`:

| Check | Executed / passed / failed / skipped | Report |
| --- | --- | --- |
| Targeted `threadReplyEvidence.test.ts`, including identical-text identity regression | 23 / 23 / 0 / 0 | `rework-unit.xml`, `rework-pre-verify-ready.log` |
| Exact guarded `claude-thread` replay | 1 / 1 / 0 / 0 | `rework-replay.log` |
| Exact scenario against real Claude | 1 / 1 / 0 / 0 | `rework-live.log`, `rework-live-stderr.log` |

Both browser reports contain and pass
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`,
with retries 0 and no flaky results. Replay started `2026-10-19T11:27:28.148Z`, matched
45 requests, emitted 378 frames, left 0 outstanding requests and recorded 0 forbidden
launches. Captures, provenance and outgoing prompts are unchanged. This is offline
evidence; the separate live run establishes the required current provider/daemon behavior.
Pre-verify's five checks, client-test typecheck and build passed. Electron SQLite preparation
completed after Node preparation and before either browser launch.

Live started `2026-10-19T11:27:49.423Z` and took 27,366ms. The isolated
`/tmp/builder-2138/pyry` used clean daemon source
`664305939d73e5a146457503081d8232fcca5407`, `vcs.modified=false`, Linux amd64,
SHA-256 `ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869`.
The live attachment records the Desktop/daemon revisions and authenticated capabilities
`interactive`, `multi_agent`, `stop_background_task`, `thread`, `thread_expansion`,
`thread_compact`. Earlier TSX-comparison failures and the interrupted-install prerequisite
failure remain failed reports in the plan. The identical-text regression failed before
the identity repair; the final 23-test run includes it passing.
macOS is outside this Linux ticket's verification scope.

The supplied dispatcher unit gate records 9,699 executed/passed, 0 failed, 3 skipped.
Its application gate records 509 executed, 507 passed, 2 failed, 5 skipped and explicitly
lists the named thread scenario as passed. This is captured-client evidence. The accepted
verifier stage `c8c14257cda146cdfec2e2e28e11cc55b6d19627fae7a061dfde2ffa22ae77ae`
reports PASS after the two unrelated failures passed same-tree reruns, tracked on
[#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125) and
[#2140](https://github.com/pyrycode/pyrycode-desktop/issues/2140). The original complete
application run retains its two failures; the supplied gate report records no overall pass.

## Protected saved-list title observation

[`readSavedListTitle`](../../../e2e/fixtures/savedListTitle.ts) observes the actual
protected `readList` for the exact host and conversation before the shared thread
scenario calls `initial.relaunch()`. Lists and owned thread changes are buffered
separately; the handler's serial queue cannot order renderer work not yet submitted.
Waiting for writer acknowledgement would require instrumentation; reading the
required protected list directly establishes the needed durable state.

| Protected result | Observation behavior |
| --- | --- |
| `missing` | Repeat read-only observation as `missing-list`. |
| Stored list for the exact host, exact row absent | Repeat as `absent-row`. |
| Exact row with `name: null` | Repeat as `unnamed-row`. |
| Exact row with a string name | Return that stored string, including `''`. |
| Classified storage error | Fail with its static code after one read. |
| Wrong host, unexpected status/kind, rejected read | Fail after one read as `wrong-host`, `unexpected-result` or `read-failed`. |

Only the three pending categories repeat, within Playwright's unchanged default
five-second assertion bound. Another chat's name, another host's same chat ID,
sidebar text and saved replies cannot supply the title. No flush, synthetic
completion, mutation retry, sleep or enlarged timeout makes this observation pass.
The explicit `expect(typeof title).toBe('string')` remains. Saved replies are
checked before relaunch and again immediately afterward with no conversation open,
then the saved row is reopened and both rendered reply identities/texts are checked.
Stream, agent placement, reconnect, reset, native-storage prerequisite, synchronous
inspection and successful-profile retirement proofs remain intact.

The [controlled regression](../../../e2e/fixtures/savedListTitle.test.ts),
`waits for the exact named list after replies are already saved`, uses the real
writer, renderer stores, handler and protected SQLite store with an injected
scheduler and held list write. Replies already satisfy `savedRepliesMatch` while
the protected result is `stored/list`, exact row present, name null. The original
one-shot string assertion rejects it. The repaired observation remains pending
before named-list receipt and while the scheduled write is held. Its payload-free
trace orders unnamed-list receipt, protected unnamed reads, named-list receipt,
write submission, another protected unnamed read, successful write acknowledgement,
protected named read, then a retirement sentinel. The sentinel proves ordering;
actual profile retirement/relaunch is covered by the application scenario.
This demonstrates an observation gap, not the unobserved historical trigger or a
production persistence defect. Persistent pending categories still fail within
the bound; terminal failures are observed once.

### Counted Linux saved-title validation

These retained Linux x64 results are accepted by the
[PR #2146 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2146#issuecomment-6272324515),
not documentation reruns. Builder implementation
`aa4938b653cf0b2f9b6f98b238699c2287a17191` contains main `0848c1fb`;
dispatcher application evidence is at `62845cfd114fe43c973743e88f288d7fe934b88c`.
The [plan](../../specs/architecture/2129-saved-list-title-observation.md#validation-evidence)
retains exact commands, worker slots/process IDs and reports under `/tmp/builder-2129/`.
Node-native checks finished before Electron SQLite preparation; no native rebuild
ran during replay.

| Check | Executed / passed / failed / skipped | Workers and retries |
| --- | --- | --- |
| Original one-shot controlled observation | 1 / 0 / 1 / 0 | 10 other tests unselected |
| Final `savedListTitle.test.ts` regression file | 11 / 11 / 0 / 0 | Includes ordering, bounded pending state and terminal failures |
| Five consecutive guarded paired batches | 20 / 20 / 0 / 0 | Each 4 / 4 / 0 / 0; three configured and actual concurrent slots; retries zero |
| Subsequent complete guarded `npm run e2e:recorded` | 29 / 29 / 0 / 1 | One configured/actual worker; retries zero |
| Supplied dispatcher unit gate 4 | 9789 / 9789 / 0 / 3 | Named ordering and `does not repeat wrong-host` regressions passed |
| Dispatcher application gate 7, `npx playwright test --reporter=json` | 515 / 515 / 0 / 5 | Three configured workers; retries zero, no flaky results |

Both named cases were present and passed twice in every paired batch and once
without retry in both the complete recorded run and application gate 7:
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
and `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.
Batch 3 recycled a worker process after a completed test; all three slots actually
ran concurrently and no result was retried. Every thread exchange matched 45
requests/emitted 378 frames; history matched 32/emitted 63, all with zero remaining
requests. Every builder guard reported zero forbidden launches, and all 29 exchanges
in both the complete recorded run and application gate had zero remaining requests.
No unrelated application failures were reported. The complete recorded skip is
`real claude picks up a saved channel system prompt at Reset session`; the application
gate also skipped three macOS-only cases and unreachable-host unpair blocked on #2089.

Capture bytes and provenance remain unchanged: thread SHA-256
`53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`, history
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`.
Both retain Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5` and daemon
source `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`. Strict request/payload matching,
frame ordering, causal checkpoints, connection boundaries and exchange-completion
checks are unchanged. These offline results add no fresh provider/daemon or
physical-effect claim; macOS is outside this Linux ticket's verification scope.

## Owned history mutation evidence

A one-item edit after full replacement can conceal an unbounded production append
path. Start empty and measure successive additions at growing saved sizes, keeping
untouched placement bytes as an independent assertion. Measure changed-item
serialization/protection separately from logarithmic sequence-index reads/writes;
ciphertext equality alone does not prove that no full scan occurred. Batch fixtures
must also check each shared authenticated path flushes once, because correct final
bytes can hide repeated work that stalls mounted browser setup.

Compare separately flushed, coalesced and held-failure progress after fresh protected
reopen. A completion flag combined with later metadata can erase saved/pending fences;
carry exact version intervals and certified availability boundaries instead. Include
same-epoch explicit resets, memory-only holder recreation and lost acknowledgements.
Individually admitted JSON additions must still fit full-reader aggregate bounds.
See [owned regression assertions and counted Linux/package validation](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
for the final #2044 verifier evidence: 9,103 units executed/passed, 0 failed, 3 skipped;
435 configured fake cases executed/passed, 0 failed, 3 skipped; packaged owned-update
reopen present/passed, 1 executed, 0 failed/skipped. These are recorded results on
`5005bf69`, Linux x64, not checks rerun by documentation. The skips provide no live
acceptance; macOS and live-Claude are outside that ticket's scope. Historical failures
and teardown follow-up #2054 remain linked from the testing reference.

## Authoritative thread read evidence

Renderer units are static `renderToStaticMarkup` in Node: they prove markup and pure decisions,
not effects, focus, scrolling or publication. The existing `rendererFixture` in
[`e2e/thread-items.spec.ts`](../../../e2e/thread-items.spec.ts) supplies route, immutable
snapshot, summary, completion and reader inputs to the isolated item view. Keep
`ConversationListData` mounted when replacing `App`; writing a mark directly into the list
store does not test received owning-daemon confirmation.

Assert three boundaries separately: renderer publisher attempts with host/conversation/target,
wire commands recorded by the fake daemon, and received marks reflected through the mounted
receipt bridge. Main can refuse a host-qualified attempt when two connected hosts claim the
same conversation ID. Fake `conversation_updated` acknowledgements must correlate with the
recorded wire request; also exercise unsolicited late marks. A below-target clamp stays
pending, while a confirming mark retires it. Neither a successful send nor an attempt count
establishes acknowledgement.

Fence absence assertions with positive callback/processing and React-commit barriers. For the
pre-commit race, receive a same-row append and newer summary, trigger focus/scroll/list probes
before committing, then show that only committed complete visible content permits the newer
target. Receipt/list output must commit before checking exclusions after clamps, epoch/host
replacement, deletion or owner loss, with the observer still mounted. Cover blur, reader,
above-tail/chrome overlap, collapsed descendants, hidden trailing items, shown unordered/queued
items, older/incomplete/abandoned batches and repair fences. A poll that immediately sees no
command can otherwise pass before any input reaches the consumer.

History fakes need the same ownership discipline. In
[`e2e/tool-groups.spec.ts`](../../../e2e/tool-groups.spec.ts), keep the quiet conversation's
history request pending and positively observe it before returning to the seeded chat. Capture
requests by host/conversation and answer the seeded request, then wait for its historical child
to commit before asserting the finished marker. One shared latest-request slot can reply to the
wrong chat because main correlates replies by request ID and suppresses repeated pending asks.
Reply to `list_conversations` with the current roster, retaining the single-row launch seed and
both rows afterwards; a catch-all one-row list response can silently remove quiet ownership.
The [controlled shared-ID proof](../../specs/architecture/1936-visible-thread-read-marks.md#revisions)
failed at the historical-child commit barrier (`0 tools`, expected `1 tool`); selecting the
owning request passed the existing identity, finished-marker and navigation assertions. Preserve
that barrier and request ordering when reusing the scenario to validate another platform.

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1965#issuecomment-6188903924)
records the configured Linux gate on `20d0f07140931f3f0aaad4977f6a186c5f761727`, 2026-10-15:
`npx playwright test --reporter=json` ran **407 executed, 407 passed, 0 failed, 3 skipped,
0 flaky**, with four workers, clipboard/parallel projects and zero retries. All 12 thread-items
and 6 tool-groups cases were present and passed, including both 1280/800 variants of
`publishes only committed visible authoritative read evidence` and
`connect roster Agents appear before history and keep identity through live and historical launches`.
The three skips are macOS-only badge/window lifecycle cases. Units recorded 10,279 executed/passed,
0 failed, 3 skipped across 405 passing files. Install, docs guard and build passed; pre-verify
recorded 3 passed and 2 deliberately skipped by `--no-suite`, with typecheck subsequently in build.
These results supersede the earlier red complete gates; a focused pass or a baseline comparison
alone did not satisfy that full-suite requirement.

The [connect-roster verifier](https://github.com/pyrycode/pyrycode-desktop/pull/2000#issuecomment-6189606015)
records the unchanged scenario/configuration on `1e6cc84ce2117dd6c06a31d11af901f25ac7d6eb`,
2026-10-15: the complete Linux gate ran **427 executed, 427 passed, 0 failed, 3 skipped,
0 flaky**, four actual workers and zero retries. The named connect-roster scenario above was
present and passed: **1 executed, 1 passed, 0 failed, 0 skipped**, retry 0. The skips were two
macOS badge cases and the macOS window-reopen case. Retained reports are
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1998.pass.json` and
`verifier-gate_#1998_6.log` (Playwright JSON) with its stderr log in that directory; shared
verifier evidence bundle `7e872c636b8d6eb367de8e665f72659b5feea9c4cbce0cf933466bd04cf00a29`
includes the verdict and report tail, with the full-report pointer in `pointers.json`.

The [native validation evidence](../../specs/architecture/1998-connect-roster-native-validation.md#validation-evidence)
now includes inspected managed `desktop-fake-suite` task
`0234f9aa222747faa60ae91272b3c4c0a8c191f095a48b442728b5adbb6e44ce`, run on the MacBook
at revision `0573bc79d97199427d6eebdf4f36f9d3785f7321`, 2026-10-15. The complete configured
suite recorded **429 executed, 429 passed, 0 failed, 1 skipped, 0 flaky**, four actual
workers and zero retries. The named connect-roster scenario above was present and passed:
**1 executed, 1 passed, 0 failed, 0 skipped**, retry 0. The sole skip was the independent
input-enabled-cover hover case because a never-shown window receives no display pointer.
The named case's `launch-fate` attachment records a running app at outcome, exit 0 and no
teardown failures; the setup summary is `[]`, with no top-level report errors.

Documentation inspected all six retained artifacts in `/tmp/docs-1998-native-20261015/desktop/`:
`capture.json`, `playwright.json`, `playwright.list.log`, `execution.log`, returned
`playwright.config.ts` and `fake-daemon-setup.json`. They remain retrievable through the
managed task. Its invocation was Playwright `test --config=playwright.config.ts`, without
file, grep, project or shard filters; all 430 configured cases are accounted for.
The returned configuration SHA256 is
`f2868e97d72733c286ff8c3098f09adc62e2e8bfa3ad9393e000eebf9a429d5a`, matching the
candidate and original failing configuration. The scenario is unchanged in the current
branch; later main merges changed configuration, so these counts belong to the recorded
candidate. Reuse the controlled ownership proof above rather than adding another regression
or replacing the complete configured gate with a filtered pass.

Native execution is verified; acceptance remains pending the builder's required returned-artifact
inspection and evidence commit, as specified by the PR/verifier handoff. The earlier task-access
blocker is resolved. This documentation inspection does not stand in for that builder-owned step;
return the existing task reports to the builder without requesting duplicate execution.

Separate native/macOS evidence for older candidate `ddb9bce8db99546129037f00713b753f603562d9`
remains unverified and handed to the dispatcher: task
`400bbaf6852f5e7efa8c860719fcf81552c8014a58142a12f66936d55fa14a07` has no verified result
in the verdict. Any result needs its own revision/configuration, executed/failed/skipped counts,
named cases and setup-attachment review before native acceptance. Replacement-epoch captures at
1280×773 and 800×773 show existing bubbles and copy/reply controls; the supplied fixture omits
the surrounding sidebar/top/input chrome, so they do not prove integrated chrome fidelity.
No real-Claude/live-daemon test ran or was required for this supplied seam.
Production activation has separate [counted fake-suite evidence](thread-runtime.md#validation-boundaries).
Credentialed live acceptance remains pending in the live runbook.

## Hosted app link verification

[`e2e/hosted-app-links.spec.ts`](../../../e2e/hosted-app-links.spec.ts) clicks links
in the production conversation renderer through privileged preload/IPC and inspects
native hosted content and fake-daemon dispatch. `launchPairedApp` uses legacy
non-UUID host IDs; use `skipPairing` and spec-local canonical UUIDv4 pairing for
this grammar instead of silently testing targets the parser must refuse.

The configured verifier gate on `fd19fde4bd34febc3111693f2171d62a520015a4`,
2026-10-15, ran `npx playwright test --reporter=json`: **436 executed, 436 passed,
0 failed, 3 skipped**. All four named cases below were present and passed, as
confirmed by the dispatcher gate report and
[final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2005#issuecomment-6191844871).
The skips were three macOS-only badge/window lifecycle cases on Linux.

| Passed scenario | Behavior covered |
| --- | --- |
| `streaming and settled links preserve conversation drafts` | Pending/frozen and settled activation, repeated opens, keyboard activation, unchanged healthy discovery and sidebar return releasing native content/restoring the draft. |
| `latest host selection survives delayed replies` | Equal app IDs on two hosts, cross-host selection and delayed A discovery/command replies after selecting B. |
| `invalid and unpaired links stay bounded` | Malformed destinations stay visible/inert, manual pairing cancel preserves the draft, and successful pairing does not open the original target automatically. |
| `links reuse discovery recovery` | Missing/stopped/failed apps, offline/reconnect and unsupported recovery, failed discovery refresh and held completion, Reopen and removal. |

Fence zero-dispatch/OS-handoff assertions with positive processing evidence.
The delayed-selection case releases old discovery, observes a newer B label and
uses an ordered snapshot response after releasing A's command result before
checking B's generation/native identity and zero A assets. Recovery observes
authoritative status/discovery processing before excluding resources; a requested
walk alone does not establish readiness. Ready content and return-to-conversation
checks precede the final `shell.openExternal` spy assertions.

Static parser/renderer tests pin exact raw destinations, normalized-destination
denial, escaped titles/reference-label delimiters, meaningful labels, opt-in output
and no render-time activation. Main boundary units independently cover attached
privileged main-frame and named paired-host admission. Static renders cannot prove
clicks, effects or native composition. Existing
[native-view/Fetch proof](daemon-connection-hosted-resource-views.md#native-viewer-verification)
retains its scope; these synthetic reply scenarios establish no real Claude
creation/publish, daemon/relay or SQL acceptance, which remains #1929.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

CodeGraph's existing ignore patterns do not cover every runtime artifact. Check
`.codegraph/codegraph.lock`, `.codegraph/writer.pid`, `.codegraph/codegraph.db-shm`
and `.codegraph/codegraph.db-wal` against both the tracked diff and
`git check-ignore -v`; an ignored file can still be tracked. Repository-local Git
exclusions keep these generated lock/PID and mutable SQLite sidecar files out of
automatic commits while preserving the running index's local files.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
