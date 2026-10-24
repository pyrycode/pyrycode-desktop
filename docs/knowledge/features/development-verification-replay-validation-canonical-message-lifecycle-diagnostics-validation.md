# Development verification — canonical message lifecycle diagnostics validation

Retained evidence from [replay validation](development-verification-replay-validation.md).
Each record keeps its execution OS, candidate and proof boundaries.

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

## Canonical reader validation

The [PR #2276 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2276#issuecomment-6389289463),
accepted stage `b3c9224c6e26144ead75afae3db93d9741faf41f40c1b96f866c62d9b5ab26ed`,
records PASS on Linux x64, 2026-10-24, at
`a7dd5835b68f7159bde720fff11ad051a35b3281`. Normal build provenance identifies
that exact revision with `sourceDirty: false`. All five changed test/fixture
files are byte-identical to builder source/build revision
`d4f714509747e385af304d4881a6585b91c879d4`. These are retained results;
documentation runs only the docs guard. The
[plan](../../specs/architecture/2267-canonical-reader-interactions.md#validation-evidence)
keeps commands and artifact references; the
[reader fixture contract](conversation-shell-markdown-reader.md#canonical-interaction-fixtures)
describes explicit acceptance, ordered history and unchanged attachment handling.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder five owned reader/menu cases, retries zero | 5 / 5 / 0 / 0 |
| Builder native-writer prerequisite, separately | 1 / 1 / 0 / 0 |
| Builder canonical-publisher units, within five passed pre-verify checks | 18 / 18 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10046 / 10046 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |

Unit totals use the supplied counted gate report; the verdict's larger 10,145
aggregate is not used. The verdict confirms all 18 canonical-publisher units
present and passed, including `passes correlated file chunks unchanged without
accepting retired content`. All five owned mounted cases were present and passed
at retry zero in both the builder run and matching configured application gate:

- `reader headings share the scale, spacing and first-block clearance (#2100)`
- `a markdown link in a reply opens the note in the reader, refetched on every open, and back returns (#1627)`
- `the reader menu copies the note three ways and refreshes it (#1630)`
- `reader scrolls under sharp chrome with dynamic clearance and input at 1280`
- `reader scrolls under sharp chrome with dynamic clearance and input at 800`

The separate `finite protected writer backlog preserves native keyboard and both
event loops` prerequisite passed at retry zero in both runs; the final builder
run used `gnome_libsecret`. The clipboard project remains serial and depends on
`native-writer`. The complete application gate reported zero flaky results,
29 passed captured-client cases with the existing reset fixme skipped, passed
canonical activation/captured history and all seven replay-native-storage cases.
The matching configured gate supplies complete-suite evidence once. References
are dispatcher `logs/verifier-gate_#2267_{1..7}.*` and
`/tmp/builder-2267/playwright-serial.{json,log}`. Final builder launch-fate
attachments report clean exits and no teardown failures or top-level report errors.

Builder application/client-test typechecks, focused TypeScript checking including
both specs, `readerThread.ts`, publisher unit inputs and imported publisher, and
post-pre-verify build passed. Verifier pre-verify, install, docs guard, application
typecheck/build and Electron native preparation passed. Focused compilation caught
the existing file responders' missing required `conversation_id`: they now echo
the requesting conversation without changing chunk bytes, digest or request IDs.

Earlier failures remain failures: the intentional red attachment regression had
18 executed, 17 passed, 1 failed, 0 skipped before passthrough. The initial
`playwright.log` and overlapping-preparation `playwright-accepted.json` each
failed the native prerequisite with all five owned cases unexecuted.
`playwright-final.json` passed the prerequisite but failed all five owned cases
at the two-row pairing setup. The final passing run followed the single-row
pairing repair and serialized Node preparation, Electron preparation and execution.
All reports remain referenced under `/tmp/builder-2267/`; none of those earlier
runs is acceptance evidence. The builder's AST comparison retained all original
expect expressions in order (reader 84/84, menu 89/89), with no timeout changes.

The four application skips are two platform badge cases, window reopen convergence
and the existing system-prompt reset fixme; three live units were skipped. Skips
are not passes. macOS is outside this Linux ticket's verification scope. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) retain captured replay,
canonical activation, captured history, protected storage, native prerequisites
and every original live-only assertion. Native clipboard/input assertions ran;
no fresh provider, live relay/encryption or additional physical-effect proof was
required or performed. Compatibility remains for unmigrated siblings; #2212
retains complete feature acceptance and #2153/#2191 remain separate repairs.

## Canonical reply validation

The accepted [PR #2274 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2274#issuecomment-6389243666),
stage `4a6a0228fc6e8d72ef4a811183779571043d512a51db63be990e465b86d5ae2e`,
records PASS on Linux x64, 2026-10-24, for reviewed candidate
`dc15b8b8cd0e840d1c19ee60bbd31e1352985f65`. Normal build provenance identifies
that revision with clean source. The owned spec is unchanged from builder
candidate `6dde32e24ee9a966715a844297dd1a3a13583f63` through documentation
base `347f011d0cc5950a1489176f8ea0917bfa174ab6`. These are retained results;
documentation runs only the docs guard. The
[harness contract](e2e-harness.md#scripted-and-native-thread-fixtures) records
per-host canonical publishers, explicit acceptance/session/terminal facts and
created-chat registration. [Reply coverage](conversation-shell-message-bubble-testing.md#canonical-reply-fixtures)
retains the preload/drain and protected-storage proof boundaries.

| Retained Linux check | Executed / passed / failed / skipped |
| --- | --- |
| Builder focused reply spec, configured clipboard project, retries zero | 6 / 6 / 0 / 0 |
| Builder focused native-writer prerequisite, retries zero | 1 / 1 / 0 / 0 |
| Builder canonical fixture units | 17 / 17 / 0 / 0 |
| Supplied dispatcher unit gate 4, JUnit counts | 10045 / 10045 / 0 / 3 |
| Complete configured application gate 7, `npx playwright test --reporter=json` | 542 / 542 / 0 / 4 |
| Complete gate captured-client subset | 29 / 29 / 0 / 1 |

Use the supplied counted unit report rather than the verdict prose's 10,144
aggregate. All six named reply scenarios were present and passed in both the
focused builder run and the complete application gate:

- `held suffix distinguishes visible partial content from current-source readiness`
- `pointer and keyboard replies append current source, focus once, and send the edited quote intact`
- `inline permission replies focus immediately without dismissal replay, and drafts and focus stay isolated on chat switch`
- `reply isolates equal conversation ids across hosts`
- `reply appends and focuses in a reopened saved offline chat`
- `received history is saved for equal ids on different hosts and replies reopen offline`

The complete gate used three configured/actual workers and zero retries.
All 29 active captured-client cases passed; the original reset-system-prompt
fixme remains excluded. Canonical activation, saved-history resume with zero
legacy requests, protected history with production encryption and the native-writer
prerequisite passed. The inspected protected thread/history exchanges completed
45 requests / 378 frames and 32 requests / 63 frames, both with zero remaining
requests; all 33 replay native-storage observations reported readiness/completion.
The matching configured gate supplies complete-suite evidence once.

Focused report: `/tmp/builder-2263/final-focused-followup.json`. Builder
pre-verify passed five checks; application, client-test and focused reply-spec
TypeScript checks (including imported helpers), and Linux build passed. Evidence
remains under `/tmp/builder-2263/`: `final-pre-verify.log`,
`final-typecheck-client-tests.log`, `final-typecheck-focused.log`,
`tsconfig.reply.json` and `final-build.log`. Dispatcher install, docs guard,
application typecheck/build and sequential Electron native preparation passed;
the application report is `logs/verifier-gate_#2263_7.log` in the agents repository.

The earlier clean-candidate native timing failure in
`/tmp/builder-2263/final-focused.json` remains failed evidence: 1 executed,
0 passed, 1 failed and 6 dependent skips, zero retries. Main heartbeat
1823.882337 ms exceeded the unchanged 1000 ms bound. It is tracked separately in
[#2273](https://github.com/pyrycode/pyrycode-desktop/issues/2273); the follow-up
pass and complete green gate establish no causal repair. The initial canonical
fixture attempt also remains failed (7 executed, 4 passed, 3 failed, 0 skipped);
its corrections are reflected in the final focused pass.

The four application skips are two macOS badge cases, macOS window reopen and
the existing system-prompt Reset fixme; no skip counts as a pass. macOS is
outside this Linux ticket's verification scope. The
[recorded-test contract](../../recorded-tests.md) and
[migration inventory](../../client-replay-migration.md) retain captured-history,
protected-storage/native prerequisites and original live-only assertions.
No new live proof is required or claimed; authored facts and replay do not prove
fresh provider/daemon behavior or additional physical effects. Compatibility
remains for unmigrated siblings; #2212 retains integrated feature acceptance,
with #2153/#2191 separate repairs. No production or visual change ships here.

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
