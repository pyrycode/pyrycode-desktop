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
