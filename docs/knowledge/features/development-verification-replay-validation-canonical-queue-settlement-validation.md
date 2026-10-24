# Development verification — canonical queue-settlement validation

Retained evidence from [replay validation](development-verification-replay-validation.md).
Each record keeps its execution OS, candidate and proof boundaries.

## Integrated send and queue acceptance

The [PR #2278](https://github.com/pyrycode/pyrycode-desktop/pull/2278) verifier
stage `e9e2a6139811bc2983ddaf7d62a7bc0ce1cc132bc312594ead26af7a576f14f4`
was accepted with PASS for #2211 on Linux x86_64, 2026-10-24. Reviewed and built
candidate `eff1c2f8d6fc5c1eae3aedc0e90f1022d63e900a` has normal-profile provenance
with `sourceDirty: false`. Ancestry includes canonical prerequisite #2210
(`928f28fe`) and all eight implementation merges below. These are retained
executions; documentation runs only the docs guard. The
[integration plan](../../specs/architecture/2211-send-queue-integration.md)
retains the builder checks and original evidence handoff.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Complete unit gate, individual JSON/JUnit executions | 10144 / 10144 / 0 / 3 |
| Same unit gate, distinct file/title identities in dispatcher summary | 10045 / 10045 / 0 / 3 |
| Complete configured application gate | 542 / 542 / 0 / 4 |
| All 12 cohort specs, subset of application gate | 24 / 24 / 0 / 0 |
| Captured-client replay, subset of application gate | 29 / 29 / 0 / 1 |

The unit report contains 99 additional parameterized executions sharing titles;
the two unit rows describe the same run and must not be added. The accepted
verdict reconciles both counts against the individual results.
Unit retries/audit errors, browser retries/flaky results
and Playwright global errors are zero; every browser result has retry index 0.
Application gate 7 ran `npx playwright test --reporter=json`, the complete
configured equivalent of `npm run e2e`, with four actual workers and the unchanged
native-writer, clipboard and parallel projects, without selection/shard filters.
This exact candidate's normal gate supplies combined acceptance once; child
focused checks alone do not. No gate was repeated to produce this record.

All 24 cohort scenarios listed in these retained child records are present and
passed once in that application gate. Spec paths below are under `e2e/`.

| Slice / merge | Cohort specs (passed cases) | Retained child evidence |
| --- | --- | --- |
| #2248 / `b7c343eb` | `send-and-stream.spec.ts` (1) | [Send and stream](development-verification-replay-validation-canonical-publisher-verification.md#canonical-send-and-stream-validation) |
| #2249 / `257fbda1` | `live-user-receipts.spec.ts` (1) | [Receipts](development-verification-replay-validation-canonical-publisher-verification.md#canonical-receipt-validation) |
| #2250 / `c5d12375` | `user-whitespace.spec.ts` (1) | [User whitespace](#canonical-user-whitespace-validation) |
| #2254 / `a040d524` | `queue-delivery-evidence.spec.ts` (1), `queued-own-settlement.spec.ts` (6) | [Queue settlement](#canonical-queue-settlement-validation) |
| #2255 / `f25c78cc` | `status-icon-local-send.spec.ts` (1) | [Local send status](#canonical-local-send-status-validation) |
| #2256 / `eafa6ce9` | `message-lifecycle-diagnostics.spec.ts` (1) | [Lifecycle diagnostics](development-verification-replay-validation-canonical-message-lifecycle-diagnostics-validation.md#canonical-message-lifecycle-diagnostics-validation) |
| #2221 / `d192a094` | `queued-send-now.spec.ts` (2), `queued-backlog-interrupt.spec.ts` (1) | [Queue actions](development-verification-replay-validation-canonical-publisher-verification.md#canonical-queue-action-validation) |
| #2222 / `d86f547c` | `disconnected-message-delivery.spec.ts` (3), `offline-conversation-actions.spec.ts` (3), `offline-held-responses.spec.ts` (3) | [Offline held delivery](#canonical-offline-held-delivery-validation) |

Canonical facts and correlated queries supply content independently per host,
including reconnect and older pages; legacy content/history aliases do not.
Explicit own-device/message acceptance remains distinct from transport write
and assistant activity. Queue order/status, drafts, send-now/drop/interrupt,
positive processing barriers and no-duplicate delivery assertions remain intact.
Native exact-wire duplicate/revision probes intentionally bypass
`createScriptedThread` and strict publisher mutation. Shared real/replay
`queueTurnEvidence` still requires canonical `turn_end`, exactly one normal
completion per turn and marker/turn ordering. A query alone cannot prove adapter
bypass: retain the child inferred-acceptance failure control.

All 29 active replay exchanges retain source provenance and finish with zero
remaining requests; permission replay also reports no mismatch. The 28 shared-spec
replays record completed native readiness for all 33 opened processes, including
saved-profile relaunches. Both `finite protected writer backlog preserves native keyboard and both event loops`
and `packaged protected history commits and reopens with production encryption`
are present and passed in the 542/542 gate. Writer evidence records genuine Linux
`gnome_libsecret`, 8333 persisted items, committed keyboard input `xyz` and no
writer errors. These native checks are separate from application-message replay.

Install, docs guard, application typecheck/build, client-test typecheck and
Electron-native preparation passed. Pre-verify passed three enabled checks under
`--no-suite`; subsequent gates supplied units/typecheck. Builder focused TypeScript
proof covers all 12 specs, helpers, publisher/queue units and preload/wasm
declarations at `6403d3d194705caed8e8dcf8665d6ab9a5450540`; those inputs are
unchanged in the accepted candidate. Node-native units finished before Electron
preparation. No assertion, timeout, skip, fixture or production change ships here.

Evidence references: agents-repository `logs/verifier-gate_#2211_{1..7}.log`
and matching stderr, `build/dispatcher-tests/unit-uz4rhwj6/{0.json,0.audit.json,dispatcher.xml,invocation.json}`,
`build/dispatcher-tests/native-preparation.json` and `out/main/build-provenance.json`.
Review extractions remain in `/tmp/verifier-2278/`, including `acceptance.json`,
`application-identities.json`, `replay-completion.json`, `native-storage-input.json`
and `integration-source.json`. All 44 output hashes are in `build-SHA256SUMS`,
manifest SHA-256 `f3679bcd4a6801159b58ac47bfe10083b4b4f854b414f31d9616fa692acd391c`.
Full application report SHA-256:
`439ed972a8edaf46c426339efb456ac02e59c5a8aff783c3f01fca5c3f5807b6`.
The accepted stage bundle was retrieved into `/tmp/documentation-2211-accepted/`;
all 19 checksum entries passed. Its pointers retain full gate-log hashes where
the bundle contains tails. The authoritative stage record confirms acceptance.

Three unit skips require operator-owned live relay credentials. Four application
skips are two macOS badge cases, macOS last-window reopen and the existing
reset-system-prompt fixme (the replay subset's one skip). None counts as passed;
macOS is outside this Linux ticket's verification scope. All child historical
failures, including #2222's #2265 replay failure, remain failed evidence. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory/exclusions](../../client-replay-migration.md) retain original
live-only assertions and strict replay/protected-storage boundaries. This
migration adds no fresh provider/daemon, encryption-interoperability or physical-effect
claim and requires no new live capture. Compatibility remains for other cohorts;
the legacy-removal work can consume this combined acceptance. #2153/#2191 and
\#2169 remain separately owned. No API or wire-reference change is required.

## Canonical queue-settlement validation

The [PR #2260](https://github.com/pyrycode/pyrycode-desktop/pull/2260) accepted
verifier stage `735e2dacf0c39fb3cdca0861eaa17ff89183592575b27ee5f6200eefbf28e468`
records PASS on Linux x86_64, 2026-10-24, at
`e404b07f9a81f734688697a9f26168b470522fac`. Executed build provenance identifies
that clean revision and the normal profile. Both owned specs and
`queueSettlementThread.ts` are unchanged from builder executable revision
`6fddaa5a14ec35406d3e1bef3afc3d4d806a82b0`. These are retained results;
documentation runs only the docs guard. The
[plan](../../specs/architecture/2254-queue-settlement-evidence.md#builder-validation--linux-2026-10-24)
retains commands and earlier failures; the
[harness contract](e2e-harness.md#scripted-and-native-thread-fixtures) describes
explicit acceptance, native conflict probes and the installed completion oracle.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder seven owned cases plus native writer prerequisite, retries zero | 8 / 8 / 0 / 0 |
| Builder queue-turn evidence units | 20 / 20 / 0 / 0 |
| Builder canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted report; verifier prose lists 10,144,
so that larger aggregate is not used here. Each owned case is present and passed
once in both the focused builder run and application gate 7:

- `queued own rows settle in stream order: removal-first`
- `queued own rows settle in stream order: receipt-first`
- `queued own rows settle in stream order: sent-now`
- `queued own rows settle in stream order: mixed-removal-first`
- `queued own rows settle in stream order: mixed-receipt-first`
- `queued and delivered treatments retain the message-area design`
- `queue evidence follows a single user row through delivery in the built app`

The native prerequisite
`finite protected writer backlog preserves native keyboard and both event loops`
also passed in both runs. The complete gate used four actual workers, with zero
retries or flaky outcomes. Its captured-client subset records 29 executed/passed,
0 failed, 1 skipped; all 29 exchanges completed with zero remaining requests.
Canonical activation, captured history and protected-storage scenarios passed.
This matching configured run supplies complete-suite proof once. Evidence is
retained in dispatcher `logs/verifier-gate_#2254_7.log`,
`build/dispatcher-tests/unit-3tdj_10q/` and the builder's
`/tmp/builder-2254/final-mounted.json`.

Builder pre-verify passed five checks; `npm run typecheck`,
`npm run typecheck:client-tests`, focused TypeScript checking including both
specs, the helper and declarations, and final build passed. Verifier install,
docs guard, build/typecheck and Electron native preparation passed. Its
`--no-suite` pre-verify passed three checks and intentionally skipped two suite
checks supplied by subsequent gates.

The retained inferred-acceptance negative control executed 2 tests: 1 passed
native prerequisite, 1 intended failure, 0 skipped/retried. Assistant activity
caused compatibility to invent an authoritative user row before explicit
acceptance. The earlier request-only control passed 2/2, 0 failed/skipped, proving
that an actual thread request alone cannot distinguish the adapter. Initial
incomplete-install and SQLite ABI prerequisite failures remain retained in the
plan; no owned case executed in those blocked runs. None becomes passing evidence.

The four application skips are two macOS badge cases, macOS window reopen and the
existing reset-system-prompt fixme; no skip counts as passed. macOS is outside
this Linux ticket's verification scope. The [recorded-test contract](../../recorded-tests.md)
and [migration inventory](../../client-replay-migration.md) preserve strict replay,
causal validation, canonical activation, captured history, protected-storage and
native prerequisites, and all original live-only assertions. Authored facts and
historical captures add no fresh provider/daemon, encryption or physical-effect
proof. Compatibility remains for unmigrated siblings;
[#2211](https://github.com/pyrycode/pyrycode-desktop/issues/2211) retains combined acceptance.

## Canonical user-whitespace validation

The [PR #2257 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2257#issuecomment-6387959503)
and accepted stage `1cc0b10044e8075cb2a17682b867f61e9a12f721343aa64f463d3eeb8465627b`
record PASS on Linux x86_64 at `89fed00c2fb80c898eee964810243bb41a722615`,
2026-10-24. Normal build provenance identifies that clean revision. The owned spec
and relevant shared fixtures are unchanged since builder executable revision
`919ceb8808bddd7243e294ecdb97e5f8bf2c049a`. The
[plan](../../specs/architecture/2250-canonical-user-whitespace.md#verification--2026-10-24)
retains builder commands, checksum and evidence references; the
[layout topic](development-verification-layout-and-input.md#layout-and-input)
records the acceptance and measurement boundaries.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder affected canonical-publisher units | 17 / 17 / 0 / 0 |
| Builder owned scenario plus native writer prerequisite, retries zero | 2 / 2 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |
| Captured-client subset of that application gate, per accepted verdict | 28 / 28 / 0 / 1 |

Use the supplied counted unit report above; the verdict prose's larger aggregate
of 10,144 is not used. The exact owned scenario,
`a user message draws the line breaks, blank lines, space runs and indents it was typed with`,
is present and passed once in application gate 7, as is
`finite protected writer backlog preserves native keyboard and both event loops`.
The builder reports both present and passed in its focused run. The complete gate
has zero retries, flaky results or report errors. All 28 captured exchanges finished
with zero remaining requests; captured history, packaged encrypted-history reopen
and native-storage prerequisites passed. This matching configured run supplies
complete-suite acceptance once, superseding the plan's earlier pending statement.

Verifier install, docs guard, application typecheck/build and Electron native
preparation passed. Its pre-verify passed three checks with two `--no-suite`
omissions supplied by later gates. Builder pre-verify, client-test and focused
owned-spec typechecks, and build passed. The original `/tmp/builder-2250` reports,
traces and red-control patch were unavailable to the verifier; their detailed
contents were not independently inspected. The plan's red control remains a
reported failure (2 executed, 1 passed, 1 failed, 0 skipped), not final acceptance.
Counted current-head gates supply the final proof. Evidence references include
dispatcher `logs/verifier-gate_#2250_{1..7}.log`,
`build/dispatcher-tests/unit-l1z7i6e_/0.json` and builder bundle
`05202ae1c1afd0e1c89628629965fe4c8532c36ff14315746afbfb9fc1d09486`.

The four application skips are two macOS badge cases, macOS window reopening and
the existing saved-system-prompt Reset fixme; none counts as passed. macOS is
outside this Linux ticket's verification scope. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) retain original live-only
assertions; authored facts and captured replay add no fresh provider/daemon,
encryption-interoperability or physical-effect proof. No production, shared-fixture
or visual behavior changed. Compatibility remains for unmigrated siblings.
[#2211](https://github.com/pyrycode/pyrycode-desktop/issues/2211) retains combined
acceptance under [#2209](https://github.com/pyrycode/pyrycode-desktop/issues/2209);
this slice does not complete that parent acceptance. #2153 and #2191 remain separate
repairs.

## Canonical offline held-delivery validation

### Current configured Linux acceptance

The later [PR #2258 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2258#issuecomment-6388956185),
accepted stage `14e3a0b0a9eee9968f143abbe091231b7b450cf22360f9afa71ef3fdefeb6a6d`,
records PASS on Linux x64, 2026-10-24, at
`0af2e04ff7831fbd3cb80096f5fcf346ad9b9547`. Normal-profile build provenance
identifies that revision with `sourceDirty: false`. The three owned specs remain
byte-for-byte unchanged from builder revision `4ee2d3beab8a6cc38fcc5e9a9bdc95b152a73d01`.
Documentation retrieved the accepted bundle and verified every `SHA256SUMS` entry;
these are retained executions, not documentation-stage test runs.

| Current retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |
| Captured-client subset, per accepted verdict | 28 / 28 / 0 / 1 |

Use the supplied counted unit report; the verdict prose's larger 10,144 aggregate
is retained separately rather than substituted. All nine named scenarios listed
below and `finite protected writer backlog preserves native keyboard and both event loops`
were present and passed in this configured application run. Every project and
result used retries zero; flaky outcomes were zero. Protected-storage controls
also passed. The four application skips and replay's reset exclusion remain as
described below. This candidate's configured run supplies complete acceptance
without a duplicate suite execution and does not erase the earlier #2265 failure.

Install, docs guard, build/typecheck and Electron native preparation passed.
Pre-verify passed three checks under `--no-suite`; later gates supplied its two
omitted checks. Client-test and focused TypeScript checks passed with all three
specs, imported helpers, `canonicalThread.test.ts`, preload and wasm declarations
included. References are `/tmp/verifier-2258/current-0af2e04/`,
`build/dispatcher-tests/unit-8qmu4o4b/` and dispatcher
`logs/verifier-gate_#2222_{1..7}.log`. The accepted bundle is retained under
`/tmp/docs-2222-current-evidence/14e3a0b0a9eee9968f143abbe091231b7b450cf22360f9afa71ef3fdefeb6a6d/`.
The nonblocking leftover negative assertion still has no published conflicting
text; positive original-text, identity, ordering and row-count barriers provide
the useful proof. No API or protocol-reference change is required; #2211/#2209
retain combined feature acceptance.

### Earlier acceptance and preserved scenario coverage

The [PR #2258 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2258#issuecomment-6388256293)
and accepted stage `2bab738cd99d3d576c3d66f80a4feea0fd4b9120a2afbccbc894b7d79583bd27`
record PASS on Linux x64, 2026-10-24, at
`e64c72a36761440713a1076dfa409014f9169a98`. Normal-profile build provenance
identifies that revision with `sourceDirty: false`. All three owned specs are
unchanged from builder implementation/build revision
`4ee2d3beab8a6cc38fcc5e9a9bdc95b152a73d01`. These are retained results;
documentation runs only the docs guard. The
[plan](../../specs/architecture/2222-canonical-offline-held-delivery.md#validation-evidence--2026-10-24)
retains focused commands, artifacts and earlier failures.

All nine cases in
[`disconnected-message-delivery.spec.ts`](../../../e2e/disconnected-message-delivery.spec.ts),
[`offline-conversation-actions.spec.ts`](../../../e2e/offline-conversation-actions.spec.ts)
and [`offline-held-responses.spec.ts`](../../../e2e/offline-held-responses.spec.ts)
select canonical publishers independently on every fake host. Authored summaries,
current sessions, items and updates supply content through correlated thread
queries, including reconnect and reopen. The local `event` helpers retain
connection/ownership, attachment and prompt controls without translating content;
neither legacy content nor history aliases supply the thread. Shared fixtures
and compatibility for unmigrated siblings remain unchanged.

Reconnect modes retain intercepted commands, socket-write observations, original
send identity/text/order, waiting/not-sent contrast, queued-to-delivered facts and
other-host drafts. The [settlement and replay barriers](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early)
require running cursors before finished revisions, then same-identity redelivery
and a rendered processing marker before one-row assertions. Offline actions retain
held text, attachments, draft/queue state, local copying/reopening and explicit
post-reconnect actions. The unopened chat's unverified live item stays hidden
until its first connected query; rendered content precedes the exact one-query
assertion, and Home adds no request. Permission/trust and question cases retain
selections, independent answers, drafts, pre-opened confirmations, rejection
notices and forced-click/keyboard controls. Unavailable, missing and ambiguous
owners cannot submit or fetch attachments; a connected second host still works.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder three owned specs plus native writer prerequisite, retries zero | 10 / 10 / 0 / 0 |
| Builder canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Initial complete configured application gate 7, retries zero | 542 / 541 / 1 / 4 |
| Captured-client subset of that initial gate | 28 / 27 / 1 / 1 |
| Separate same-tree rerun of the failing replay and two prerequisites, retries zero | 3 / 3 / 0 / 0 |

Unit totals use the supplied counted gate report; verifier prose lists 10,144,
so that larger aggregate is not used here. The verdict confirms all nine owned
cases were present and passed in both the focused builder run and configured gate:

- `accepted disconnected messages drain and settle: automatic`
- `accepted disconnected messages drain and settle: explicit`
- `accepted disconnected messages drain and settle: terminal`
- `held reading, draft and queue survive offline actions, reopening and copying; another host and reconnect work`
- `pre-opened action menu and missing, connecting, failed or ambiguous ownership cannot submit`
- `offline opening does not consume first-history eligibility`
- `permission and trust retain selection offline, including pre-opened confirmation and keyboard attempts`
- `questions preserve independent picks and draft offline; a second connected host answers`
- `all unavailable statuses and missing or ambiguous ownership block both prompt families`

The genuine prerequisite
`finite protected writer backlog preserves native keyboard and both event loops`
also passed in both runs. The initial application's sole failure was captured
`daemon-session-settings` →
`real daemon persists a session-settings write and returns it on a fresh read`,
tracked in [#2265](https://github.com/pyrycode/pyrycode-desktop/issues/2265).
That named scenario and both prerequisites were present and passed in the
separate rerun. The dispatcher accepted this flake disposition; the original
full run remains 1 failed, with retries zero throughout. Its exact-candidate
gate supplies configured acceptance without another complete-suite run.

Builder pre-verify passed five checks; application/client-test typechecks, focused
TypeScript checking including all three specs, imported helpers/declarations and
`canonicalThread.test.ts`, and build passed. Verifier repeated client-test and
focused TypeScript checking successfully. Its `--no-suite` pre-verify passed
three checks and intentionally skipped two supplied by subsequent gates. Install,
docs guard, build/typecheck and Electron native preparation passed. Evidence
references include dispatcher `logs/verifier-gate_#2222_7.log`, retained
`.failure-1792868037892.log`, separate
`2026-10-24T18-53-58-060Z_verifier-gate-rerun_#2222.log` and compiler logs under
`/tmp/verifier-2258/`.

Earlier builder failures remain failures: canonical activation rejected the old
`assistant_delta` (2 executed, 1 passed prerequisite, 1 failed owned case,
0 skipped); the first migrated run used unsupported `streaming` status
(10 executed, 4 passed, 6 failed, 0 skipped). Correcting authored status to
`running`, then `finished`, preserved assertions and timeouts. Premature-build
and SQLite-ABI attempts each failed the prerequisite alone; no owned case ran.

The four configured skips were two macOS badge cases, macOS window reopen and
the existing system-prompt-reset exclusion. The captured subset retains that
reset skip; none counts as passed. macOS is outside this Linux ticket's scope.
The [recorded-test contract](../../recorded-tests.md) and
[migration inventory/exclusions](../../client-replay-migration.md) preserve
captured-client history/replay, protected storage, native prerequisites and
original live-only assertions. No fresh provider/daemon, encryption or
physical-effect proof is introduced. No production or visual behavior changed;
[#2211](https://github.com/pyrycode/pyrycode-desktop/issues/2211) retains combined
feature acceptance.

## Canonical local-send status validation

The [PR #2261 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2261#issuecomment-6388233969)
and accepted stage `a2e502344c4d50bae9e666c02f837f1170830f9adad8040d9f92eb4bb60d0e9c`
record PASS on Linux x64, 2026-10-24, at
`d8306dcd12468b9627b150cf985ca9017880be65`. Normal build provenance identifies
that revision with `sourceDirty: false`. The owned spec is unchanged from builder
implementation `ecb1e40d901c11c5754f88d9df63b4ce2a3306c9`. These are retained
results; documentation runs only the docs guard. The
[plan](../../specs/architecture/2255-canonical-local-send-status.md#validation-evidence)
retains commands and artifact paths, and the
[fixture contract](e2e-harness.md#scripted-and-native-thread-fixtures) explains the
independent identity controls and positive delivery/idle barriers.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned spec plus native writer prerequisite, retries zero | 2 / 2 / 0 / 0 |
| Builder canonical-publisher/selection units | 17 / 17 / 0 / 0 |
| Builder send-store units | 13 / 13 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted report; the verifier prose's larger 10,144
aggregate is not used. Both named mounted tests were present and passed in the
builder's final focused run and the configured application gate:

- `the status row reads Sending, then Waiting for Claude, then Thinking, with the icon turning throughout`
- `finite protected writer backlog preserves native keyboard and both event loops`

The complete gate used four workers and all three configured projects without
shard filtering, retries, flaky results or report errors. Canonical activation,
protected saved-history cases and all 29 captured-client exchanges passed, with
zero remaining requests and no request mismatch. Inputs retain October 16/19
capture provenance. This matching configured gate supplies complete-suite evidence
once. Reports remain referenced as
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2255_{1..7}.log`
and their corresponding stderr logs.

Builder pre-verify passed all five checks; `npm run typecheck`,
`npm run typecheck:client-tests`, focused TypeScript checking including the owned
spec and imported helpers/declarations, and build passed. Verifier install, docs
guard, application typecheck/build and Electron-native preparation passed.
Node preparation preceded units, then Electron preparation preceded mounted
execution. The initial overlapping manual/pre-verify preparation failed before
any units executed; the later sequential preparation passed. The legacy opening
oracle remains a recorded failure: 2 executed, 1 passed native prerequisite,
1 failed owned case, 0 skipped, retries zero. Builder artifacts are referenced
under `/tmp/builder-2255/`; no failed run becomes a pass.

The four application skips are two macOS badge cases, macOS window reopen and
the existing system-prompt Reset fixme; three unit skips require live relay
credentials. No skip counts as passed. macOS is outside this Linux ticket's
verification scope. The [recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) preserve captured history,
protected storage, native prerequisites and original live-only assertions.
Authored facts and captured replay add no fresh provider, encryption or
physical-effect proof, and this migration adds no duplicate-wire proof or visual
change. Compatibility remains for unmigrated siblings; #2211 retains combined
acceptance. #2153/#2191 remain separate repairs and #2169 owns missing-acceptance
recovery.

