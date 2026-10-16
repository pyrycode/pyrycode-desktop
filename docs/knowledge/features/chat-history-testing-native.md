# Protected history testing — native runtime and evidence

Part of [protected history testing](chat-history-testing.md).

## Native runtime and packaged proof

Host-Node Vitest and Electron use different native ABIs. `npm run rebuild:node`
runs `npm rebuild better-sqlite3` for host tests; `npm run rebuild:electron` runs
`electron-builder install-app-deps` for Electron. Rebuild for the runtime being
used after switching ABIs. Production packaging sets `npmRebuild: true` and
`asarUnpack: node_modules/better-sqlite3/**`; a Node import alone cannot prove the
packaged adapter loads.

Prepare host Node before unit gates, then prepare Electron again before the ordinary
app's Playwright gate. `npm install` or a successful Node gate does not establish
Electron readiness. An isolated packaged smoke rebuilds its own adapter copy and
cannot certify the ordinary application's ABI preparation. The activation review
reproduced host Node 25.8.0 / ABI 141 loading an adapter that Electron 33.4.11 /
Node 20.18.3 / ABI 130 rejected. The unchanged full suite passed after the Electron
rebuild; local verifier runner preparation was tracked by #2038, separately from
the managed runner repair in #2018.

The [renderer-retirement PR](https://github.com/pyrycode/pyrycode-desktop/pull/2039)
records the same trap after indexed storage merged: 13 failures in the first
post-merge fake run used the host-Node adapter. Rebuilding for Electron made all
13 pass without source changes. The final counted Linux gate executed/passed
435 cases, 0 failed, 3 skipped. Treat the earlier capture as failed and the later
pass as separate evidence; the rebuild order is Node units, then Electron suite.

On Linux/macOS, `npm run check:history-native -- /tmp/history-native-proof` packages
an isolated entrypoint, launches the packaged Electron app and writes `runtime.stdout`
and `runtime.stderr` beneath the supplied scratch directory. It uses the actual
`electronSecretEncryption` through activated `createChatHistoryStore`, imports
both protected formats, closes/reopens the database and compares parser-normalized
content structurally. An owned item revision is committed and compared exactly
after another fresh reopen. A 500-receipt by 200-id fixture exercises 100,000 memberships,
full replacement and exact fresh reopen. It checks all history-directory files for
fixture plaintext and reports versions, packaged/asar/native-unpacked flags,
static stage and nonzero test counts. An 801-item authoritative fixture opens the
last 200 shown items despite 500 hidden items, retaining one hidden active item
and two evidence ranges. It records first conversion separately, closes the database,
then checks exact partial content, checkpoint and opaque continuation through a
fresh owner while measuring cold opening. A separate fresh owner then enumerates
all newest/before held windows, including opening omissions, and compares exact
content/order with 801 unique identities alongside the opening and saturated
persistence assertions.
Failure or missing/all-skipped evidence is nonzero. It adds no release channel.

[`history-native.spec.ts`](../../../e2e/history-native.spec.ts) includes
`packaged protected history commits and reopens with production encryption` in the
ordinary Playwright configuration and attaches stdout/stderr. This lets a managed
`desktop-fake-suite` task exercise the native proof on the exact pushed candidate
through normal manager admission. On macOS follow the approved Electron-launch
route from the project instructions. Other platforms explicitly skip this case;
direct smoke invocation rejects them before packaging imports or scratch creation.
[`historyNativePlatform.test.ts`](../../../src/main/historyNativePlatform.test.ts)
pins Windows rejection. Run the native proof on the operating system running the
ticket; opposite-OS scheduling is outside scope. Existing NSIS x64/arm64 targets
remain unchanged.

### Counted unchanged saved traversal validation

The [post-merge verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2066#issuecomment-6217180444)
records Linux x64 on 2026-10-16 at `8fa5f23fc349c11d1564dfbb54d3ece845a74636`:
full units **9,228 executed/passed, 0 failed, 3 skipped**; complete configured
Playwright gate 8 **466 executed/passed, 0 failed, 4 skipped**. The named
`packaged protected history commits and reopens with production encryption` case
is explicitly present and passed: **1 executed, 1 passed, 0 failed, 0 skipped**.
Both mounted held-reply/offline traversal cases also passed; see
[counted restoration evidence](chat-history-testing-restoration.md#counted-unchanged-saved-traversal-validation)
for suite configuration, historical repaired failures and scope.

The verifier inspected `/tmp/pyry-history-native-n6DVpj/runtime.stdout` and
`runtime.stderr`: Electron 33.4.11 / Node 20.18.3 / better-sqlite3 12.4.1,
production `gnome_libsecret`, packaged/ASAR/native-unpacked true, stage complete.
The 801-item fresh-opening/exact-traversal fixture and 100,000-membership persistence
fixture passed. Conversion took **3,840 ms**, cold opening **110 ms**. Raw stderr
contains system-bus/GPU/network-service diagnostics without failed storage assertions.
This is recorded packaged production-protection evidence, not a fresh live run.
Other operating systems and real Claude are outside this ticket's scope.

The existing indexed opening counter fixture additionally measures a 200-item
newest held page, resetting its counters after opening. The builder's
[implementation measurements](../../specs/architecture/2063-saved-thread-traversal.md#validation-evidence)
separate selected records/payloads/decrypts, authenticated structure and conversion:

| Fixture items | Opening records / payloads / decrypts | Opening structural reads | Opening cold / conversion ms | Traversal records / payloads / decrypts | Traversal structural reads / cold ms |
| ---: | --- | ---: | --- | --- | --- |
| 262 | 206 / 202 / 408 | 1,583 | 369.2 / 2,716.8 | 203 / 200 / 403 | 282 / 255.1 |
| 1,242 | 206 / 202 / 408 | 1,992 | 408.6 / 13,706.5 | 202 / 200 / 402 | 262 / 164.4 |

The final verifier confirms the same 200 selected traversal payloads and 403/402
decrypts; current unit cold-opening times were 317/458 ms and traversal times
180/168 ms. Selected work stays bounded as unrelated history increases;
authenticated structure work may grow logarithmically. Import/conversion is paid
separately and can scale with saved history. These timings establish no latency
threshold. Counting payloads/decrypts alone would miss repeated structural work.

### Counted bounded-opening validation

The [bounded-opening verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2062#issuecomment-6215044001)
reviews Linux x64 head `b64334baa9d5ef1885296d93bfa5f7992c756b2a` on 2026-10-16.
The inspected builder reports cover implementation
`17901342573d182351400caca03babb767af0fbf`, after main
`c369bb4728c07111d0fde6c33b02166780458e87`; only the plan's validation record changed
before the reviewed head. The dispatcher separately records all verifier gates
passed on that head, with counted fake gate 8:

| Run or included case | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Builder approved full units, 392 files | 9,138 | 9,138 | 0 | 3 |
| Builder complete configured fake suite, both projects/two workers | 436 | 436 | 0 | 3 |
| Mounted restore/live/held-reply case, included in builder suite | 1 | 1 | 0 | 0 |
| Packaged production-encryption case, included in builder suite | 1 | 1 | 0 | 0 |
| Dispatcher verifier fake gate 8 | 436 | 436 | 0 | 3 |

The verdict confirms that `restore overlapping live content retains complete progress
across an interrupted catch-up and epoch replacement` and `packaged protected history
commits and reopens with production encryption` are present and passed in the
inspected builder report. Each executed/passed once with zero failed/skipped, within
the 436-executed, zero-failed, three-skipped suite. The dispatcher report supplies
aggregate counts without named-test results; it is not the source of those named
passes. The builder suite had no flaky results or global errors. The plan records
zero retries and no fake-daemon-setup attachment.

The mounted capture `bounded-opening-held-reply.png` at 1100×773 shows saved-only
rows, newer live facts and pending loading together. The fixture proves local
visibility before server release, coordinator resume from the admitted epoch and
checkpoint, and exclusion of unrelated older shown rows while retaining the hidden
active item. See [restoration traps](chat-history-testing-restoration.md#restoration).

Instrumented protected fresh-owner measurements, inspected by the verifier, separate
selected work from structural traversal and one-time conversion:

| Fixture items | Base / active / dependency / evidence | Protected record reads / payload reads / decrypts | Structural reads | Cold opening ms | Conversion ms |
| ---: | --- | --- | ---: | ---: | ---: |
| 262 | 200 / 1 / 1 / 3 | 206 / 202 / 408 | 1,583 | 1,015.5 | 7,576.1 |
| 1,242 | 200 / 1 / 1 / 3 | 206 / 202 / 408 | 1,992 | 796.6 | 31,035.8 |

These runs shared the machine with other checks and establish bounded selected
work, not a latency threshold. The earlier focused capture recorded cold
454.9/439.0 ms and conversion 2,552.9/12,544.4 ms for the same small/large fixtures.
Replacement and one-time collection import/retirement precede the cold measurements;
fresh owners do not repeat them. Structural growth is separate from constant
selected placement/payload decoding.

The inspected `/tmp/pyry-history-native-ZdFgoe/runtime.stdout` and `runtime.stderr`
record Electron 33.4.11 / Node 20.18.3 / better-sqlite3 12.4.1, production
`gnome_libsecret`, packaged/ASAR/native-unpacked true and `stage: complete`.
The 801-item packaged fixture selects 200 shown, one hidden active item, zero
dependencies and two evidence ranges: conversion 3,873 ms, cold reopen 118 ms.
The retained 100,000-membership full replacement also passed, taking 5,931 ms.
Raw stderr retains system-bus/GPU/network-service diagnostics alongside successful
counted completion; an empty stderr is not the success criterion.

Build and docs guard passed. The dispatcher also records successful install,
pre-verify `--no-suite`, Node/Electron rebuilds, units and build; its unit exit code
supplies no new per-test count. The counted unit evidence above comes from the
verifier-inspected `/tmp/builder-2059/pre-verify-approved.log`; the builder fake report
is `/tmp/builder-2059/fake-suite.json`. The
[plan validation record](../../specs/architecture/2059-bounded-saved-opening.md#validation-evidence)
retains artifact paths and the separate focused ancestor assertion pass.

Earlier sandbox captures remain failed: initial setup lacked the SQLite binding,
and initial sandbox pre-verify failed 68 socket cases with `listen EPERM` and could
not read security labels. The approved passes above are separate runs. Unit skips
are existing opt-in relay/interoperability checks; fake skips are two macOS badge
cases and macOS window reopen. macOS is outside this Linux ticket's verification
scope; no live-Claude acceptance was introduced or claimed. These results are
recorded evidence, not documentation-stage test reruns.

### Counted stable-binding validation

The [stable-binding verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2045#issuecomment-6209414001)
records Linux x64 evidence at `61ec3eaf44cea1e16d58c2bf2bc28e3b81f28568`
(2026-10-16), superseding the earlier builder totals:

| Run or included module | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 392 passing files | 9,165 | 9,165 | 0 | 30 |
| Indexed authoritative module, included above | 38 | 38 | 0 | 0 |
| Migration module, included above | 21 | 21 | 0 | 0 |
| Application history-store module, included above | 14 | 14 | 0 | 0 |
| Complete configured fake suite, original gate 8 | 435 | 434 | 1 | 3 |
| Separate visible-tail rerun | 2 | 2 | 0 | 0 |
| Packaged production-encryption case, included in gate 8 | 1 | 1 | 0 | 0 |

The supplied gate report explicitly lists
`packaged protected history commits and reopens with production encryption` as
present and passed. The verifier inspected `/tmp/pyry-history-native-XpWH6e/runtime.stdout`:
Electron 33.4.11, Node 20.18.3, SQLite adapter 12.4.1, production `gnome_libsecret`,
packaged/ASAR/unpacked flags true and `stage: complete`.

The original fake gate failed
`committed folded tails require focus, uncovered viewport and a closed reader`.
That exact test is present and passed in the separate two-executed, zero-failed,
zero-skipped rerun, according to the verifier's inspected dispatcher report.
The verifier records dispatcher acceptance as unrelated flakiness; the original
failed capture remains failed and is not a new full-suite pass. The supplied gate
report retains only the original run. Its three skips are macOS-only cases;
macOS is outside this Linux ticket's verification scope.

Install, native adapter preparation, typecheck, build and docs guard passed per
the verdict. Pre-verify recorded three passed checks and two intentional
`--no-suite` skips, with units/typecheck in subsequent gates. This storage-only
change required no live-Claude run. The verdict links dispatcher gate logs
5/6/8 and the `2026-10-16T06-16-49-715Z` rerun; these are recorded evidence,
not tests rerun by documentation.

The [activation verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2019#issuecomment-6208451299)
and dispatcher gate 8 record Linux x64 acceptance on
`2af705788086ec1339f0b271a891da19b18e956f` (2026-10-16):

| Run or included module | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 420 passing files | 10,247 | 10,247 | 0 | 30 inherited |
| Migration module, included above | 21 | 21 | 0 | 0 |
| Protected store module, included above | 14 | 14 | 0 | 0 |
| Handler admission module, included above | 7 | 7 | 0 | 0 |
| Daemon-item history module, included above | 6 | 6 | 0 | 0 |
| Removal/unpair integration module, included above | 6 | 6 | 0 | 0 |
| Daemon-item cache integration module, included above | 5 | 5 | 0 | 0 |
| Update draining module, included above | 15 | 15 | 0 | 0 |
| Complete configured Linux Playwright suite | 435 | 435 | 0 | 10 existing |
| Packaged production-encryption case, included above | 1 | 1 | 0 | 0 |

The named `packaged protected history commits and reopens with production encryption`
case is present and passed. The verifier inspected both attachments and raw
`/tmp/pyry-history-native-pjNuvq/runtime.stdout` / `runtime.stderr`: Electron
33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`,
packaged/asar/unpacked true and `stage: complete`. Exact two-format import/reopen,
full replacement/fresh reopen and plaintext rejection passed; saturated replacement
took 3,877 ms. The report stderr attachment is empty; raw stderr retains
system-bus/GPU diagnostics with successful counted completion.

The full fake gate ran both configured projects with four concurrent worker slots,
zero retries/flaky results, no filters and no global errors, after Electron
preparation. All 15 `thread-activation.spec.ts` cases, both [indexed quit/window cases](chat-history-testing-restoration.md#recording-and-removal) and `local list read failures stay beside the saved host` are
present and passed. The ten skips are seven retired legacy scenarios and three
macOS-only checks; skips establish no execution proof. macOS is outside this Linux
ticket's verification scope. No live-Claude spec changed or live run was required.
Verifier artifacts are retained under `/tmp/verifier-2019/current-2af70578/`;
full report SHA256 is `1c4b5faf5de7b9c65324dd9a476467fefcdc3b820cb07b058aa53bcf3f3fcabe`.

Historical activation failures retain their status. The initial Linux gate on
`54d7010a` executed 434: 421 passed, 13 failed, 10 skipped; its ABI diagnostic rerun
executed/passed 13, failed/skipped 0 and did not replace the complete gate. The
later Linux focused run on `41fbd1f4` executed 19: 18 passed, one inspection-context
failure, zero skips/retries; the unchanged case passed alone (1/1) and in the final
focused group (19/19), both with zero failures/skips. #2035 records that intermittent
inspection failure without claiming its cause repaired. Earlier Mac capture
`d89f50d5` remains 438 executed, 437 passed, one failed, one skipped; abandoned final
task `a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf`
on `109888c4` was settled interrupted with no results and drained custody. Neither
that interrupted task nor a passing earlier revision proves final Mac acceptance.
The [activation plan](../../specs/architecture/1975-activate-indexed-history.md#revisions)
retains the full chronology, including earlier failed ABI captures.

Earlier backend-only proof from the [final verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1996#issuecomment-6189261285)
confirmed retained production-encryption artifacts from candidate
`f2ef9815571c2ce773a0d736e0ec32d0f26b776a`, whose backend/native/dependency/packaging
files matched that review's head. The named packaged case above was present and passed
on both platforms, with `packaged`, `asar` and `unpacked` all true:

| Platform/architecture | Electron | Embedded Node | better-sqlite3 | Encryption backend | Executed | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Linux/x64 | 33.4.11 | 20.18.3 | 12.4.1 | `gnome_libsecret` | 1 | 1 | 0 | 0 |
| macOS/arm64 | 33.4.11 | 20.18.3 | 12.4.1 | `os-keychain` | 1 | 1 | 0 | 0 |

Linux evidence is `/tmp/pyry-history-native-oIcJN0/runtime.stdout` and
`/tmp/builder-1979/rework-54c52c4c/linux-native.log`. Managed Mac task
`3e410b97e50a5471f7ce4e37030f5781e4ad1f84b12f515c8520d95a72e515e8`, run
`9297b2992b3b45cb013a6c5f392611eb5e33ca3e7526636e4eb6853acefc73cd`, returned
`/tmp/builder-1979/rework-54c52c4c/mac-results/desktop/playwright.json` with complete
native stdout/stderr attachments; its native case passed in 8.899 seconds with
empty stderr. Exact runtime JSON and artifact locations also live in the
[architecture plan](../../specs/architecture/1979-protected-indexed-legacy-history.md#revisions).

That earlier full Mac suite was not green: 408 executed, 406 passed, 2 failed,
1 skipped, 0 retries. Its pre-launch HTTP 404 remains tracked by #1983 and missing
connect-b completion by #1998; neither is native-backend evidence. The dispatcher's
later supplied verifier gate 6 reports 414 executed, 413 passed, 1 failed, 3 skipped;
`native view retires on unpair` and
`connect roster Agents appear before history and keep identity through live and historical launches`
are individually listed as passed. Its aggregate counts do not identify the native
case, so the retained per-platform artifacts above establish that proof. No live
Claude test was required for that backend-only change.

