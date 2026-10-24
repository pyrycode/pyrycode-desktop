# Development verification — replay validation

Retained evidence for the [replay build policy and provenance](development-verification.md#replay-build-policy-and-provenance).
These results record their own execution OS and candidate; documentation does not rerun tests.

## Canonical publisher verification

The [PR #2218](https://github.com/pyrycode/pyrycode-desktop/pull/2218) accepted
verifier stage `db57bd2b2cb1a24cddecf1663acfd6655a4bdc71403fc4a77018e0c597550226`
records PASS for `4641c22adbcb997269faa2290f80362a10f6c7eb` on Linux,
2026-10-24. Implementation is unchanged from repaired candidate
`accb8c861f60c69f8ce13b971fea8326ee931b9d`; subsequent commits record plan evidence.
The [plan](../../specs/architecture/2210-canonical-thread-publisher.md#rework-verification--macos)
retains commands, focused TypeScript inputs and historical failures.

| Retained check | OS | Executed / passed / failed / skipped |
| --- | --- | --- |
| Canonical and preserved adapter units after repair | macOS | 28 / 28 / 0 / 0 |
| Focused Electron, three canonical scenarios plus native writer prerequisite | macOS | 4 / 4 / 0 / 0 |
| Complete configured managed suite at `accb8c86` | macOS arm64 | 544 / 544 / 0 / 2 |
| Supplied dispatcher unit gate 4, JUnit counts | Linux | 10032 / 10032 / 0 / 3 |
| Supplied dispatcher application gate 7, `npx playwright test --reporter=json` | Linux | 542 / 542 / 0 / 4 |

Unit totals above use the supplied counted gate report; verifier prose lists
10,131, so that larger total is not used here. The accepted verdict confirms all
17 canonical and 11 preserved adapter controls passed. Named repair controls include
`resumes checkpoints and replaces a different epoch`,
`rejects unpageable authored order %s atomically at every mutation boundary` and
`visits every retained fact once across one-item windows and order changes`.
`selects canonical and native without constructing the adapter` uses a throwing
adapter factory, with the default scripted selection as its positive control.

Both complete application runs contain and pass all three cases in
[`canonical-thread.spec.ts`](../../../e2e/canonical-thread.spec.ts):

- `canonical facts open, stream, page and reconnect without the adapter`
- `canonical epoch replacement resets a positive checkpoint and recovers reused identity`
- `canonical defaults keep colliding conversation and item identities isolated per host`

They observe actual opening/page/checkpoint requests, trusted Home-key paging,
rendered addition/append/reconnect content without duplicates, epoch replacement
and independent host ownership. Both runs also pass the native prerequisite
`finite protected writer backlog preserves native keyboard and both event loops`
and all 29 active captured-client cases (28 in `recorded-clients.spec.ts`, one in
`recorded-permission.spec.ts`). Browser retries/flaky results and global errors
are zero. Pre-verify, application/client typechecks, focused TypeScript checking
including fixture/unit/scenario inputs and build passed in the recorded builder
and verifier checks. Node checks precede Electron-native preparation.

### Retained native artifacts and exclusions

Documentation retrieved and inspected all six artifacts of managed task
`50bff7ea75f3d4504b3ddaff47bd078a48731607ff756c09d2772ee4a4cb425f`,
run `b2247ddccb8646e3c92804cb7a42eb5074e3f90e7c1beee23c2a55e7568c766d`,
in `/tmp/docs-2210-native-20261024/desktop/`. Capture, raw JSON and list log agree
on 544 passed, 0 failed, 2 skipped, 0 retries/flaky and no per-result errors.
All 590 setup attachments have unique, complete capture references, attempt 1,
successful connections/upgrades and no parser/rejection/failure category.
Execution provenance identifies `accb8c86`, dependency installation, build and
Electron preparation. Returned configuration matches the branch byte for byte:
four workers, native-writer/clipboard/parallel projects, no grep/shard filtering,
zero retries; SHA-256
`0d1fb967aa3b3d66275b736ec63bc55142dff69708eb297cce6ff3d4898d2643`.
The [returned evidence section](../../specs/architecture/2210-canonical-thread-publisher.md#returned-rework-full-suite-evidence--2026-10-21)
retains all six matching artifact sizes/hashes via the managed task manifest and
the committed hash table.

Linux's four application skips are two macOS-only badge cases, the macOS-only
last-window reopen and `real claude picks up a saved channel system prompt at Reset session`.
The unit skips require operator-owned live relay credentials. Retained macOS
skips are the same reset-prompt fixme and
`an independent input-enabled cover preserves isolated hover`, because a
never-shown window receives no display pointer. The latter passed on Linux;
the earlier macOS skip remains a skip. No skipped test counts as passed.
The initial native-prerequisite failure (1 executed, 0 passed, 1 failed, 0 skipped,
one scenario not run) and pre-repair failing regressions remain failed evidence
in the plan; subsequent passing runs do not erase them.

These fake/captured-client results preserve the [recorded-test contract](../../recorded-tests.md)
and [migration inventory/exclusions](../../client-replay-migration.md): default
replay, exact-wire native/compact controls and original live-only assertions stay
in place. They establish no fresh provider, encryption or physical-effect claim.
Linux is the accepted verifier's execution OS; macOS results are retained earlier
evidence, not a requested second-OS run or fresh documentation-stage execution.

## Canonical queue-action validation

The accepted [PR #2251](https://github.com/pyrycode/pyrycode-desktop/pull/2251)
verifier stage `c56a445bd9b94aa9fffe47394d0a56c66d10e6ad5df2bd0eb65d9ea8b91d06d9`
records PASS on Linux, 2026-10-24, for
`7449d6bf716b418d6d151663b7e42049ff832c4e`. Its normal-profile build reports
`sourceDirty: false`. Builder implementation/build revision
`4b91565b943b8f75793e2820be7aeca1cf0c75d0` differs only by plan evidence.
These are retained runs, not documentation-stage executions. The
[plan](../../specs/architecture/2221-canonical-queue-actions.md#validation-evidence--2026-10-24)
retains exact commands and artifact paths.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned specs, `--retries 0`, including native writer prerequisite | 4 / 4 / 0 / 0 |
| Builder canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; verifier prose separately
lists 10,144, so that larger total is not used here. The verdict confirms all
17 canonical-publisher units passed. All three owned cases were present and
passed in both the builder run and configured application gate:

- `queued backlog renders distinctly, drops a queued message, and interrupts a running turn`
- `queued actions keep Figma geometry, full opacity, isolated hover and keyboard focus at 800 and 1280`
- `Send now sends one send_queued_now and keeps the message one row through delivery (#1726)`

The complete gate used four workers and all three configured projects without
selection/shard filters, retries, flaky results or report errors. The native
protected-writer prerequisite and all 29 captured-client scenarios passed; their
recorded exchanges left zero requests and reported no mismatch. This configured
run supplies complete-suite evidence without a second full run for the migration.
Builder pre-verify passed 5/5 checks. Application/client-test typechecks, focused
TypeScript checking including both changed specs, imported canonical helpers and
preload declarations, and final build passed. Verifier pre-verify's `--no-suite`
intentionally skipped unit/typecheck checks; later unit/build gates supplied them.
Install, docs guard and Electron preparation also passed.

The failed exploratory runs remain failures: canonical mode rejected the old
`assistant_delta` (2 executed, 1 passed, 1 intended failure, 0 skipped); the first
migration checked idle before local-send acceptance (4 executed, 3 passed,
1 failed, 0 skipped). Another candidate run overlapped the Node native rebuild:
its prerequisite alone executed and failed (1 executed, 0 passed, 1 failed;
the three owned cases did not run). It supplies no queue acceptance or established
production cause. Finish Node-native unit work before restoring the Electron ABI
and running mounted checks; then preserve the same output until they finish.
The final sequential 4/4 pass retains all assertions and timeouts.

The four application skips are two macOS badge cases, macOS window reopen and
the existing system-prompt Reset fixme; none counts as passed. macOS is outside
this Linux ticket's verification scope. Captures are historical October 16/19
inputs. The [recorded-test contract](../../recorded-tests.md) and
[inventory/exclusions](../../client-replay-migration.md) retain captured-history,
protected-storage/native prerequisites and original live-only assertions.
This authored-fact migration adds no fresh provider, daemon, encryption or
physical-effect proof, and no visual implementation change.

## Canonical send-and-stream validation

The [PR #2252 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2252#issuecomment-6387177626),
accepted stage `0da73ad5d7b445b6a485b90feeb59311864705db419474eac9414aba6eed0ea2`,
records PASS on Linux x86_64, 2026-10-24, at
`0c417eacde1ea4cb13345553750f9dad406719ac`. Normal-profile build provenance
records that exact revision and `sourceDirty: false`. Builder implementation/build
revision `133abc4cc7262e212389d3b1b01faceda4edc522` differs only by plan evidence.
These are retained results, not documentation-stage test executions. The
[plan](../../specs/architecture/2248-send-and-stream.md#builder-verification--linux)
retains focused commands, artifacts and hashes; the
[mounted example](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early)
explains the pending/accepted wrapper and active-reply barrier.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned spec plus native prerequisite, `--retries 0` | 2 / 2 / 0 / 0 |
| Builder canonical publisher/selection units | 17 / 17 / 0 / 0 |
| Builder send-settlement units | 13 / 13 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; verifier prose lists 10,144,
so that larger total is not used here. Both named tests were present and passed
in the focused builder run and once each in application gate 7:

- `send a message and see the streamed daemon reply render in the thread`
- `finite protected writer backlog preserves native keyboard and both event loops`

The application gate used four workers, with zero retries, flaky results or global
errors. All 29 captured-client replay cases executed/passed within that gate:
773 matched requests, 3,216 emitted frames, zero remaining and zero mismatches.
The matching configured run supplies complete-suite proof once. Its retained log
is `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2248_7.log`, SHA-256
`ba6dc4b5a046bb7b6d46b36c1cbe7a243f51f00a780587ea137d439c746957b4`.

Builder pre-verify passed 5/5 checks; `npm run typecheck`,
`npm run typecheck:client-tests`, focused TypeScript checking including the owned
spec/imported fixtures, and `npm run build` passed. The focused check matters
because the default client-test configuration does not include this fake spec.
Verifier install, docs guard, application typecheck/build and Electron native
preparation passed. Its pre-verify used `--no-suite` (3 checks passed, 2 intentionally
skipped); separate unit/build gates supplied those checks. The test-first legacy
failure remains failed evidence: 2 executed, 1 passed native prerequisite,
1 failed owned opening assertion, 0 skipped, retries zero.

The four application skips are two macOS badge cases, macOS window reopen and the
existing saved-system-prompt Reset-session fixme; skips are not passes. macOS is
outside this Linux ticket's verification scope. The [recorded-test contract](../../recorded-tests.md)
and [migration inventory/exclusions](../../client-replay-migration.md) retain captured
history, protected-storage coverage, native prerequisites and original live-only
assertions. This test-only migration establishes no fresh provider, real-daemon,
encryption or physical-effect proof and introduces no visual change.

## Canonical receipt validation

The [PR #2253 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2253#issuecomment-6387337075),
accepted stage `679496ad52a57a1ae235a15923915150f2a562b25ff2cd6bd57a20b134d4e79f`,
records PASS on Linux x86_64, 2026-10-24, at
`10b430a584d77bd32051e49cae5e80991962e5e7`. Normal-profile build provenance
identifies that clean revision. The owned receipt spec is unchanged from builder
implementation `b2aa72d17ca6831636ac73e188c6506fec8336dd` through documentation's
starting head `0e45c7769f4f6062fbf959ff7bb5268a7c925dd5`. These are retained results;
documentation runs only the docs guard. The
[plan](../../specs/architecture/2249-canonical-user-receipts.md#verification--linux)
retains commands, artifact locations and hashes.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned spec plus native writer prerequisite, `--retries 0` | 2 / 2 / 0 / 0 |
| Builder send-store units | 13 / 13 / 0 / 0 |
| Builder canonical-publisher and item-store units | 56 / 56 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted report; verifier prose separately lists
10,144, so that larger aggregate is not used here. The verdict confirms all
13 send-store, 39 item-store and 17 canonical-publisher tests passed. Both named
mounted tests were present and passed in the builder run and application gate 7:

- `live user envelopes draw with daemon time and preserve one optimistic echo`
- `finite protected writer backlog preserves native keyboard and both event loops`

The complete gate used four workers and all three configured projects, without
selection/shard filters, retries, flaky outcomes or report errors. All 29
captured-client scenarios passed with zero remaining requests; shared captured
scenarios reported ready/complete native storage, including saved-profile
processes. The captured thread case matched 45 requests and emitted 378 frames.
Application report SHA-256:
`70158357534304e6d07cf178983898405e7d7132df84245b9bd617ed2a88f58f`.
The matching configured gate supplies complete-suite proof once.

Builder pre-verify passed all five checks; application/client-test typechecks,
focused TypeScript checking including the owned spec (absent from the normal
client-test include list), and build passed. Node checks preceded Electron-native
preparation. Verifier install, docs guard, application typecheck/build and native
preparation passed; its `--no-suite` pre-verify passed three checks and intentionally
skipped two, supplied by subsequent unit/build gates. Retained legacy-authority
and initial selector failures each executed 2 tests: 1 passed, 1 failed, 0 skipped,
retries zero. The legacy failure detects adapter substitution of local text;
neither failure is converted into a pass.

The four application skips are two macOS badge cases, macOS window reopen and the
existing system-prompt-reset fixme. The three unit skips require explicit live
relay/Noise credentials; no skip counts as passed. macOS is outside this Linux
ticket's verification scope. These authored facts and historical captures add no
fresh provider/daemon, encryption or physical-effect proof. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) preserve captured history,
protected storage, native prerequisites and original live-only assertions.
[#2211](https://github.com/pyrycode/pyrycode-desktop/issues/2211) retains combined acceptance.

## Canonical streamed-text validation

The [PR #2259 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2259#issuecomment-6387622967),
accepted stage `3a7afb9450073b835f4153f744e994338c3a8716e29d742f43eadf62fbc36b13`,
records PASS on Linux x86_64, 2026-10-24, at
`59199eeec71cf7490a2727c999a4e21ab07e35d1`. Normal-profile build provenance
identifies that revision with `sourceDirty: false`. Builder execution used
`ed07ff8a0f8c076d630ea67f5f9058e0c05d6034`; subsequent ticket edits record evidence.
These are retained results, not documentation-stage test executions. The
[plan](../../specs/architecture/2223-canonical-streamed-text.md#builder-verification--linux)
retains commands, hashes and earlier failures; the
[Markdown verification topic](assistant-markdown-renderer-verification.md#canonical-streamed-text-fixtures)
describes the authored fixture pattern and preserved assertions.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder three owned specs plus native writer prerequisite, retries zero | 21 / 21 / 0 / 0 |
| Verifier same focused cohort at reviewed head, retries zero | 21 / 21 / 0 / 0 |
| Builder canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; verifier prose lists 10,144,
so that larger aggregate is not used here. The verdict confirms all 17
canonical-publisher units passed. All 20 owned cases (2 attribution, 16 whitespace,
2 progressive Markdown) are present and passed in both focused runs and the
configured application gate. They include
`markdown owns whitespace on the in-progress tail and settled bubble`,
`streamed assistant text folds under its owner and follows expansion without inflating tool counts`,
`attributed text follows its owner when an enclosing tool run collapses`,
`indented pending headers and heading closers preserve streaming presentation`
and `progressive presentation, parser/render reuse and raw-source settlement`.
The native prerequisite
`finite protected writer backlog preserves native keyboard and both event loops`
also passed in each run. Browser retries, flaky outcomes and global errors are zero.

The configured gate passes all three canonical activation cases, captured history
and protected-storage/native prerequisites. All 29 captured-client scenarios
completed strict exchanges: 773 matched requests, 3,216 emitted frames, zero
remaining. Its 589 setup attachments show successful first attempts; the verifier
focused run's 22 attachments do too. The matching configured gate supplies complete
acceptance once, without a duplicate complete-suite execution. Application report
SHA-256 is `e36f725254495db3e2a3965e471e6964e8c8b7abc25163dc132d5dd774068d19`
at `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2223_7.log`.
Verifier focused report `/tmp/verifier-2259/focused.json` has SHA-256
`e6926b92c3358887465e1d63aae91ef6e4eb610401ca4feaa1de2aaec79d6082`.

Builder pre-verify passed 5/5 checks; application/client-test typechecks, focused
TypeScript checking and build passed. Verifier focused compiler inventory confirms
all three changed specs and imported canonical/publisher/launch helpers were checked;
client-test typecheck passed separately. Its first scratch compiler configuration
lacked an absolute Node type root; correcting that scratch project needed no
repository change. Verifier pre-verify passed three enabled checks under `--no-suite`,
with unit/typecheck intentionally skipped and supplied by later gates. Install,
docs guard, build and Electron native preparation passed.

Earlier builder runs remain failed as reported in the plan: withholding explicit
completion executed 2 tests (1 passed native prerequisite, 1 failed original
raw-source settlement assertion, 0 skipped); tool arrival had positively rendered
while text stayed streaming. The first full focused run executed 21 (9 passed,
12 failed at the unchanged timestamp barrier, 0 skipped). Both used retries zero.
The verifier could not independently reconstruct those raw reports from the
truncated builder bundle; its fresh focused/compiler checks establish the final
pass independently. Missing item `content.ts` was repaired without changing
assertions or timeouts; the earlier failures are not converted into passes.

The four application skips remain two macOS badge cases, macOS last-window reopen
and the saved-system-prompt Reset fixme. The three unit skips require operator
live-relay credentials. None counts as passed; macOS is outside this Linux ticket's
verification scope. The [recorded-test contract](../../recorded-tests.md) and
[migration exclusions](../../client-replay-migration.md) preserve captured-client
replay, captured history, protected storage, native prerequisites and original
live-only assertions. Compatibility stays available to unmigrated siblings;
\#2153 and #2191 remain separate repairs. This fixture migration adds no fresh
provider, real-daemon, encryption or physical-effect proof and changes no visuals.

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

## Canonical message lifecycle diagnostics validation

The accepted [PR #2262](https://github.com/pyrycode/pyrycode-desktop/pull/2262)
verifier stage `55e809cbc71518a7b9d985c2a584e3b67e52e675d9d8917499561e6074cc5bfc`
records PASS on Linux x86_64, 2026-10-24, at
`cb7dfb9592a220222053d4093ef74fe2a73d655f`. Normal build provenance identifies
that revision with `sourceDirty: false`. The owned spec is unchanged from builder
candidate `51aa1c28753ca6430f55487a63e42960d3c11f15` and through documentation
base `1273338bb5c5cf062b5d306d4dd8aa1280a7c9b2`. These are retained results;
documentation runs only the docs guard. The
[plan](../../specs/architecture/2256-message-lifecycle-diagnostics.md#builder-validation--linux-x86_64-2026-10-24)
retains commands and artifact paths; the
[fixture contract](e2e-harness.md#scripted-and-native-thread-fixtures) explains
native duplicate delivery and publisher resynchronization before the rendered
processing barrier.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned case plus native writer prerequisite, retries zero | 2 / 2 / 0 / 0 |
| Builder lifecycle and canonical-publisher units | 23 / 23 / 0 / 0 |
| Builder pre-verify lifecycle units, within five passed checks | 6 / 6 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; the verdict prose's larger
10,144 aggregate is not used. Both named mounted tests were present and passed
once in the final builder run and the configured application gate:

- `idle and running composer submissions reach diagnostics, and drop is a local request`
- `finite protected writer backlog preserves native keyboard and both event loops`

The complete gate used retries zero and reported zero flaky results. The accepted
verdict confirms captured-client scenarios, canonical activation, captured history,
packaged protected-history encryption/reopen and the native writer/keyboard/event-loop
prerequisite passed. This matching configured gate supplies complete-suite
evidence once. References are dispatcher
`logs/verifier-gate_#2256_{1..7}.log` and
`build/dispatcher-tests/native-preparation.json`.

Builder typecheck, client-test typecheck, focused TypeScript checking including
the changed spec and imported helpers/declarations, and build passed. Verifier
install, docs guard, build and Electron-native preparation passed; pre-verify
passed three enabled checks, with typecheck/unit steps disabled by `--no-suite`.
Builder Node checks finished before final Electron preparation and mounted
execution. The legacy opening-content control remains failed evidence:
2 executed, 1 passed native prerequisite, 1 failed owned case, 0 skipped, retries
zero. Builder artifacts and their hashes remain referenced under
`/tmp/builder-2256/`; that failure is not final acceptance.

The application gate skipped two macOS badge cases, window reopen and the existing
live-only system-prompt Reset case; three units were skipped. None counts as
passed. macOS is outside this Linux ticket's verification scope. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) preserve original live-only
assertions. Authored facts and captured replay add no fresh provider/daemon,
encryption-interoperability or physical-effect proof. Compatibility remains for
unmigrated siblings; #2211 retains combined acceptance, #2153/#2191 remain separate
repairs and #2169 owns missing-acceptance recovery. No production or visual change
ships in this migration.

## Canonical clipboard validation

The accepted [PR #2266](https://github.com/pyrycode/pyrycode-desktop/pull/2266)
verifier stage `858d96ba00a7b4c9a6506b0e82ac0c2fbfc6d149095bcd6cc7c6f67f347e98b1`
records PASS on Linux x64, 2026-10-24, at
`cd350ca7ca914295943e422557773d02d4357310`. Normal-profile build provenance
identifies that revision with `sourceDirty: false`; both owned specs are unchanged
from builder candidate `364f68544dfcabd686163b8d7338f895e4f26476`. These are
retained results, not documentation-stage test runs. The
[plan](../../specs/architecture/2224-canonical-clipboard-facts.md#builder-verification--2026-10-24)
retains commands, focused TypeScript inputs and report hashes; the
[fixture contract](development-verification-evidence-that-cannot-pass-too-early.md#canonical-clipboard-fixtures)
explains explicit acceptance and rendered processing barriers.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder owned clipboard cases, `--project=clipboard --retries=0` | 2 / 2 / 0 / 0 |
| Builder native-writer prerequisite, separately | 1 / 1 / 0 / 0 |
| Builder affected canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; verifier prose lists 10,144,
so that larger aggregate is not used here. Both owned tests are present and passed
in the builder run and matching complete application gate, in `clipboard`:

- `copies only the activated block, preserving literal text and whitespace`
- `copies a message to the OS clipboard by pointer and by keyboard, and draws the redrawn bubble`

The prerequisite `finite protected writer backlog preserves native keyboard and both event loops`
is present and passed in `native-writer` in both runs. All retry indices are zero;
the complete gate reports zero flaky outcomes and three actual workers. Setup and
launch-fate attachments show successful launches, exit 0 and no teardown failures.
The cases retain real Electron OS clipboard writes/readback, synthetic sentinels,
whole-message Markdown/user-source copy, notification denial and bubble/meta
geometry. Code copy retains literal whitespace, headed/headerless/long/empty
blocks, plain-only formats, Tab/Enter/Space, visible focus and containment/non-overlap
at 1280 and 800 pixels. No production or visual behavior changed.

All 29 captured-client cases passed, with 29 completed exchanges and zero remaining
requests. Canonical activation, captured history, replay-native-storage controls
and native/protected-storage prerequisites passed. This matching configured gate
supplies complete-suite acceptance once; no duplicate full run was needed.
Application report `logs/verifier-gate_#2224_7.log` has SHA-256
`3cf47e9eb1c2d1bd8afd1389e65ef8e3f4eef70fb7c1d11cc4f0a3b2a1a29cf3`.

Builder application/client-test typechecks, focused TypeScript checking of both
specs and imported helpers, and build passed. Verifier install, docs guard,
typechecks/build and sequential Electron-native preparation passed. Its pre-verify
ran three checks under `--no-suite`; later unit/build gates supplied the omitted
checks. The test-first canonical launch with legacy replies remains failed:
2 owned executed/failed, 0 passed/skipped; separately 1 prerequisite
executed/passed, 0 failed/skipped. Reports remain under `/tmp/builder-2224/`.

The four application skips are two macOS badge cases, macOS window reopen and the
existing system-prompt reset fixme; three units were skipped. Skips are not passes.
macOS is outside this Linux ticket's verification scope. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) retain strict replay,
captured history, protected storage, native prerequisites and original live-only
assertions. The owned native clipboard checks ran on Linux; no fresh provider,
encryption or additional physical-effect proof was introduced. Compatibility
remains for unmigrated siblings; #2212/#2209 retain combined feature acceptance,
and #2153/#2191 remain separate repairs.

## Canonical side-action validation

The [PR #2275 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2275#issuecomment-6388813234),
accepted stage `060d5dea2f4b45e1ddd9d966633a9660a49ae53592068b89013b7ed811654900`,
records PASS on Linux x86_64, 2026-10-24, at
`5e3b01e33ace9147463dd8da2422e5fcc9f724cc`. Normal build provenance names that
revision with `sourceDirty: false`. Implementation is unchanged from builder
revision `b58259bfd5c7c296570bc6f872a57906cb120826`; the next commit records evidence.
These are retained runs. The [plan](../../specs/architecture/2264-canonical-message-side-actions.md#builder-verification--linux-x86_64-2026-10-24)
retains commands, focused TypeScript inputs and report hashes.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder three owned cases plus native prerequisite, retries zero | 4 / 4 / 0 / 0 |
| Builder canonical-publisher units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted report; the verdict prose's larger 10,144
aggregate is not used. All three owned tests were present and passed in both the
builder run and matching complete gate, in the serialized `clipboard` project:

- `copy and reply do not increase short or multi-line bubble heights or neighbour gaps`
- `copy and reply hover layers surround only the pointed glyph without changing layout or keyboard focus`
- `side copy and row cap retain sizing while metadata expands on hover and focus`

The prerequisite `finite protected writer backlog preserves native keyboard and both event loops`
was present and passed in both runs. The complete gate used four workers,
zero retries and zero flaky results. All 29 captured-client cases passed with
29 exchange receipts, zero remaining requests and no reported mismatch.
Canonical activation/reconnect, captured history and protected native storage
passed. This matching gate supplies complete-suite evidence once, superseding
the earlier pending note. Full application log SHA-256:
`7c6c00e389573d71adb0a00819e9efd649e07f9ee18f3db2cc5b09424831b2a8`.

The [fixture contract](e2e-harness.md#scripted-and-native-thread-fixtures) and
[message-bubble testing](conversation-shell-message-bubble-testing.md#streaming-copy-input-readiness)
retain exact accepted identities, attached-reply terminal settlement, the active
partial/cursor, prior different clipboard value, trusted Copy receipt and exact
OS clipboard readback. `stream-copy-readiness` retained equal consecutive bounds
and scroll geometry with focus/hover true. Layout, metadata, attachment, queued
geometry/dequeue and standalone-offer assertions remain. Production and shared
harness code are unchanged.

Builder pre-verify passed 5/5; application/client-test typechecks, focused
TypeScript checking of the owned spec/imported helpers/preload declarations and
build passed. Verifier typechecks, docs guard, install, build and Electron
preparation passed. The test-first legacy-content control remains failed:
2 executed, 1 passed prerequisite, 1 failed owned case, 0 skipped, retries zero.
It is not acceptance evidence.

The four application skips remain two macOS badge cases, macOS window reopen
and the existing system-prompt Reset fixme; three units were skipped. No skip
counts as passed. macOS is outside this Linux ticket's verification scope.
The [recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) retain original live-only
assertions/exclusions. No fresh provider, encryption or additional physical-effect
proof is required or claimed; native clipboard proof remains distinct from replay.
\#2212 retains combined acceptance; compatibility remains for unmigrated siblings,
with #2153/#2191 separate repairs.

## Counted Linux compatibility validation

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
connection mismatch and the original visibility assertion fail. Both historical
full retained scenarios remain failed. The subsequent
[combined retained-input acceptance](development-verification.md#captured-close-client-tails) resolves the
hold using the compatibility profile together with the close-scheduler repair.

Earlier attempts remain failed: each of two invalid combined data/final fixtures
recorded 2 executed / 1 passed / 1 failed / 0 skipped; the missing-Electron launch
executed zero tests. An overly broad control invocation recorded 1 executed /
0 passed / 1 failed / 6 skipped and a nonzero forbidden-launch count when it selected
an unrelated native-writer dependency. It is excluded from the corrected focused
evidence above, which used `--project parallel --no-deps` under the same guard.
No fresh provider, live encryption or physical transport proof is claimed. macOS
is outside this Linux ticket's verification scope.
