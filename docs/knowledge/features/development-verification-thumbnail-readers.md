# Development verification — thumbnail readers

Controlled ownership, focus and input boundaries for the late-image cases in
[`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts). Part of
[layout and input verification](development-verification-layout-and-input.md);
see [the scroll-pin contract](conversation-shell-scroll-pin.md#thumbnail-reader-setup).

## Thumbnail reader setup verification

The [plan's controls and artifact manifest](../../specs/architecture/2183-thumbnail-reader-setup.md#validation-evidence)
and [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2187#issuecomment-6295685469)
record Linux x64/Xvfb evidence on 2026-10-20, reviewed at `90fd2c8e`.
After all three authoritative user rows (`1`, `2`, `123`) arrived, focusing the first
thumbnail's Copy action with `preventScroll` and reading layout increased content
height 3149 → 3177 (viewport 733). The original park immediately read back 1260,
but scroll/resize processing restored bottom offset 2444 before image release.
An echo barrier alone still failed. The repair retains this focus intervention,
settles focus/layout, then trusted ArrowUp moves 2416 → 2376. One exact park produces
a newer processed event at 1260 and at least 21 identical observations before release.
This diagnoses a controlled setup boundary without establishing the historical
unrecorded schedule; no production change shipped.

| Recorded run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Original setup with concurrent metadata focus | 2 | 1 | 1 | 0 |
| Same control with positive echo barrier | 2 | 1 | 1 | 0 |
| Repaired control | 2 | 2 | 0 | 0 |
| Ten consecutive focused invocations | 20 | 20 | 0 | 0 |
| Complete `thread-scroll-pin.spec.ts` | 23 | 23 | 0 | 0 |
| Complete configured application gate | 528 | 528 | 0 | 4 |

Each focused invocation executed/passed the exact case `a thumbnail resolving leaves
a scrolled-up reader where they were, above them or below them` once plus native writer
once. All three thumbnail cases passed in the complete spec. Builder browser reports
used four configured workers and one effective slot, zero retries and report errors,
with no skips. Compiled source was clean `ecab6253`; later builder commits changed only
plan evidence. Commands, combined stdout/stderr, build/spec hashes, failed controls and
`thumbnail-reader-setup` phase samples remain under `/tmp/builder-2183/` as indexed by
the plan. The verifier checked all 44 manifest hashes and matching compiled bundles.

Dispatcher gate 7 ran `npx playwright test --reporter=json` after a separate build,
rather than the requested `npm run e2e -- --reporter=list,json`. The invocation/reporting
difference preserved complete selection. The exact named case executed/passed once;
all 22 scroll cases and all 29 captured-client cases passed. Four configured/actual
workers, zero retries/flaky results and zero report errors were retained. Existing
skips were two macOS badge cases, macOS window reopening and the system-prompt Reset
fixme. Report SHA-256: `3b62325962e4faa18670340aa58362ae5d92b666e15212edc539cbf0c47a299a`;
JSON and separate stderr paths are in the linked verdict. This is mounted fake-daemon
and captured-client evidence, not fresh provider/daemon or physical-effect acceptance;
see [replay limits](../../recorded-tests.md#live-checks-remain-required). No fresh live
run was required; macOS is outside this Linux ticket's verification scope.

Historical #2173 evidence remains failed: 529 executed, 528 passed, 1 failed,
4 skipped, zero retries, three configured/actual workers; this case expected 1260
and observed 2416 before release. Unchanged focused comparison passed 2/2 with no
failures/skips; a full comparison passed this case but recorded 529 executed,
528 passed, 1 separate failure owned by #2184 and 4 skips. The
[refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2183#issuecomment-6294684015)
retains original commands, identities, report hashes and source-computer paths.
Those green comparisons prove intermittency only. Earlier #2158 thumbnail failures
remain separate [bounded-observation evidence](chat-history-testing.md#counted-linux-bounded-observation-validation).

## Last-row thumbnail ownership verification

The [ownership plan and artifact manifest](../../specs/architecture/2188-thumbnail-row-ownership.md#validation-evidence--2026-10-20)
and [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2193#issuecomment-6297065884)
record Linux x86_64/Xvfb evidence on 2026-10-20. Builder compilation identifies
clean implementation `655d229bc89497db6342de9ba7e63872009021a9`, normal profile;
the verifier reviewed `e5a10947a393d32bdad01c50b5533ad8f6782325` and confirmed
matching compiled outputs. No production change shipped.

With the daemon echo held, the optimistic bubble was connected inside the thread
without a numeric read-row identity. Releasing the echo and completing the existing
`sendWithThumbnail` publication barrier disconnected that exact node and removed its
thread ancestor. Inspecting the retired node with the original guard threw
`the bubble is not inside a thread scroll region` before image release. The repaired
case uses a fresh locator after the same schedule and proves connected active-thread
membership, numeric direct-child identity and final-child membership with no image
present. The existing barrier suffices for this controlled boundary; another readiness
implementation would duplicate it.

| Recorded run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Stale-node ownership control, including native writer | 2 | 1 | 1 | 0 |
| Ten consecutive focused invocations | 20 | 20 | 0 | 0 |
| Complete `thread-scroll-pin.spec.ts` | 23 | 23 | 0 | 0 |
| Complete configured application gate | 528 | 527 | 1 | 4 |
| Separate unrelated reply-case rerun with prerequisites | 3 | 3 | 0 | 0 |

Every focused invocation executed/passed `a thumbnail resolving in the last row
leaves a bottom-resting reader at the bottom` once and native writer once, with
retries disabled. The complete spec passed all 22 scroll cases, including all three
thumbnail scenarios, plus native writer. Builder browser reports retain three
configured workers and one effective slot due to dependency/file ordering, zero
retries/flaky results/report errors and clean teardown, including the failed control.
No sleeps, deadline changes, skips or swallowed ownership errors were added.

All ten focused reports record committed direct/final-child row `122`, content
height 3081 → 3253, scrollTop 2348 → 2520 and viewport 733: 172px growth and zero
bottom distance. Overflow, bottom-resting, overlapping-row and final-child guards,
200px intrinsic width, 160px drawn height, the 172px growth floor and original bottom
tolerance remain required. Following is measured after correlated image release
without an intervening send, unrelated frame/render or manual scroll.

The plan retains exact commands (`--grep` on the named case, `--retries 0`,
`--reporter=list,json`; no grep for the full file), source/build hashes and separate
stdout/stderr, reports and result directories under `/tmp/builder-2188/`.
`control.spec.ts` and `control.json` preserve the intentional failure separately
from `final.spec.ts` and the repaired reports. `summary.json` indexes report hashes
and ownership/growth/launch attachments; the verifier independently checked all
115 manifest files and all 12 browser-report hashes.

Dispatcher gate 7 ran `npx playwright test --reporter=json` with three configured/actual
workers, zero retries and zero report errors. The exact named case was present and
passed once in 3788ms with connected ownership, 172px growth and zero bottom distance;
all 22 scroll cases passed. All 29 captured-client exchanges completed with 773 matched
requests, 3216 emitted frames and zero remaining requests. The unrelated reply failure
is tracked by #2173; the separate three-test rerun includes that case and prerequisites,
with zero retries/report errors. The accepted gate disposition does not turn the
original complete run into a failure-free pass. Existing skips are two macOS badge
cases, macOS window reopening and the system-prompt Reset fixme.

Full application report: `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2188_7.log`,
SHA-256 `9162885ec64224cf14128041b33b43e839f5505d64ae60ed2ab68bbc4eb7f803`.
The verdict retains the separate rerun log/hash and both stderr logs.

Historical #2186 remains failed: 528 executed, 527 passed, 1 failed, 4 skipped,
zero retries, at `c449934ff692110a56a7e542a5253fa1627b2ecb`. The
[refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2188#issuecomment-6296017589)
retains its command, source/report provenance and failed artifact references. The
controlled replacement demonstrates an ownership boundary, not that historical
failure's unrecorded schedule or exact cause. It is separate from the held-reader
focus/input controls above. Mounted fake-daemon and captured-client results prove
client behavior within [replay limits](../../recorded-tests.md#live-checks-remain-required)
and the [replay inventory](../../client-replay-migration.md); no fresh provider or
external-daemon acceptance was required or claimed. Other operating systems are
outside this Linux ticket's verification scope.
