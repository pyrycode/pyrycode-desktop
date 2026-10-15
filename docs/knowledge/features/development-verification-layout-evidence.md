# Conversation layout verification evidence

Counted browser results and reviewed captures for the translucent conversation and
Markdown reader layouts. See [Development verification](development-verification-layout-and-input.md#layout-and-input)
for layout/input test guidance and [scroll pin](conversation-shell-scroll-pin.md#thread-scroll-pin)
for current metadata-reflow behavior. These runs record the layout at their reviewed revisions.

## Translucent conversation controls

Recorded [translucent-control design](../../specs/architecture/1733-translucent-thread-controls.md)
evidence: the dispatcher verifier gate on 2026-10-06 at final production revision
`d2ef7fc79270a0b01d8d5b9316bb9544c96659d7` ran
`npx playwright test --reporter=json`: 284 executed, 284 passed, 0 failed, 4 skipped.
The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1797#issuecomment-6007169599)
confirms every test in the following spec groups was present, executed and passed
in that run. Each group had 0 failed and 0 skipped:

| Browser spec | Executed / passed | Proof retained |
| --- | --- | --- |
| `translucent-thread-controls.spec.ts` | 3 / 3 | Full-pane overlap, dynamic clearance, resize/zoom, offline pills, fresh capture parents |
| `composer-options-clamp.spec.ts` | 3 / 3 | Width/shift restoration, complete long labels, real selection and focus |
| `thread-scroll-pin.spec.ts` | 11 / 11 | Following, late images, zero/nonzero prepend position, no extra history demand |
| `history-walk.spec.ts` | 2 / 2 | Existing history behavior |
| `composer-message-box.spec.ts` | 3 / 3 | Draft sizing, scrolling and editing |
| `thread-overflow-overlay.spec.ts` | 1 / 1 | Menu/pill overlap and real clicks |
| `background-task-drawer.spec.ts` | 1 / 1 | Native resizing, containment, send, Escape and chat switch |
| `chat-top-bar-geometry.spec.ts` | 5 / 5 | Top bar, dropdown interaction and sheet/dialog scrims |
| `permission-modal-answer-paths.spec.ts` | 7 / 7 | Permission response paths |
| `question-picks.spec.ts`, `question-answer-continue.spec.ts`, `question-cancel-refuses.spec.ts` | 3 / 3 | Picks, Continue and Cancel |

The footer tests are named `the options panel fits the pane and restores its width
on resize`, and `long footer model labels stay readable and selectable at 1280 with
zoom` / `long footer model labels stay readable and selectable at 800 with zoom`;
each executed once and passed, with 0 failed and 0 skipped.
The verdict also confirms all 13 tests across the migrated top-bar, status-spacing,
usage-limit, type-ahead and unpair/repair specs executed and passed (0 failed, 0 skipped),
retaining interaction and hit-test assertions. These overlap the groups above and
are not an additional suite total. The four full-run skips concern platform-specific
badge/window-close scenarios. Acceptance uses fake transport; no real-Claude run or
separate manual interaction run is claimed.

The same verdict independently inspected all 14 native synthetic captures at that
revision against [Desktop `756:9848`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9848),
[Top bar `731:6010`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=731-6010)
and [Input area `134:5013`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-5013).
Fade/softening, sharp controls, preserved sidebar/alignment, expanded-input clearance,
drawer containment and complete long labels with visible focus matched, with no
unresolved visual deviation. Outer windows were 1280×800 and 800×600; native 100%
content captures were 1280×773 and 800×573. Geometry tests establish resting clearance;
captures establish appearance.

| State | Original 1280×800 capture | Original 800×600 capture |
| --- | --- | --- |
| Resting | `/tmp/builder-1733/resting-1280.png` | `/tmp/builder-1733/resting-800.png` |
| Under header | `/tmp/builder-1733/under-header-1280.png` | `/tmp/builder-1733/under-header-800.png` |
| Under composer | `/tmp/builder-1733/under-composer-1280.png` | `/tmp/builder-1733/under-composer-800.png` |
| Expanded composer | `/tmp/builder-1733/expanded-1280.png` | `/tmp/builder-1733/expanded-800.png` |
| Drawer | `/tmp/builder-1733/drawer-1280.png` | `/tmp/builder-1733/drawer-800.png` |
| Long labels, 100% | `/tmp/builder-1733/long-model-1280-1.png` | `/tmp/builder-1733/long-model-800-1.png` |
| Long labels, 125% | `/tmp/builder-1733/long-model-1280-1.25.png` | `/tmp/builder-1733/long-model-800-1.25.png` |

Reviewed copies and a SHA-256 manifest are retained under
`/tmp/verifier-1797/review-d2ef7fc7/` with the same basenames. These are recorded scratch
evidence paths, not committed image assets. Original paths and comparison remain in
[PR #1797](https://github.com/pyrycode/pyrycode-desktop/pull/1797).

## Translucent Markdown reader

Recorded [reader-header design](../../specs/architecture/1734-translucent-markdown-reader.md)
evidence: the dispatcher verifier gate on 2026-10-06 at production revision
`9caa860214f8caee57aca508fa456dbee04bb843` ran
`npx playwright test --reporter=json`: 286 executed, 286 passed, 0 failed, 4 skipped.
The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1801#issuecomment-6007835769)
confirms the existing reader scenario and every reader-menu/shared-header scenario were
present, executed and passed in that run; each group had 0 failed and 0 skipped:

| Browser spec | Executed / passed | Proof retained |
| --- | --- | --- |
| `markdown-reader.spec.ts` | 1 / 1 | Refetch on open, Back, pending attachments completing while covered |
| `markdown-reader-menu.spec.ts` | 3 / 3 | Existing six-action scenario plus full-pane overlap, dynamic clearance, resize/zoom, menu bounds, real pointer/keyboard input, draft and thread-position preservation |
| `translucent-thread-controls.spec.ts` | 3 / 3 | Shared thread-header regression coverage |

The two layout cases in `markdown-reader-menu.spec.ts` are
`reader scrolls under sharp chrome with dynamic clearance and input at 1280` and
`reader scrolls under sharp chrome with dynamic clearance and input at 800`.
The verdict confirms both passed alongside the existing copy/refresh scenario.
The four full-run skips were two OS badge cases, close-time history drain and
window-reopen convergence; none is counted as passed. This is fake-transport evidence;
no live-Claude run is claimed for the reader layout.

The same verdict inspected all ten native synthetic captures and confirmed their hashes
against `/tmp/builder-1734/capture-manifest.json` at that revision. Comparison with the
retained [Figma `756:10358`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-10358)
reference `/tmp/builder-1734/figma-756-10358.png` and shared thread capture
`/tmp/builder-1733/under-header-1280.png` matched downward fade/progressive softening,
sharp controls, preserved sidebar/alignment, readable failure notices and complete menu
labels at both zoom levels, with no unresolved in-scope visual discrepancy. A fresh Figma
fetch was unavailable; the verdict used the retained reference. Outer windows were
1280×800 and 800×600; native 100% content captures were 1280×773 and 800×573.

| State | Original 1280×800 capture | Original 800×600 capture |
| --- | --- | --- |
| Resting | `/tmp/builder-1734/resting-1280.png` | `/tmp/builder-1734/resting-800.png` |
| Scrolled | `/tmp/builder-1734/scrolled-1280.png` | `/tmp/builder-1734/scrolled-800.png` |
| Three failure notices | `/tmp/builder-1734/notices-1280.png` | `/tmp/builder-1734/notices-800.png` |
| Menu, 100% | `/tmp/builder-1734/menu-1280-1.png` | `/tmp/builder-1734/menu-800-1.png` |
| Menu, 125% | `/tmp/builder-1734/menu-1280-1.25.png` | `/tmp/builder-1734/menu-800-1.25.png` |

These are recorded scratch evidence paths. Original paths, revision and comparison
results are retained in [PR #1801](https://github.com/pyrycode/pyrycode-desktop/pull/1801).

## Reader reopen input verification

The [diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1970#issuecomment-6180262603)
and [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1981#issuecomment-6180406848)
record the test-only repair reviewed on 2026-10-14 at
`62fc391be9ad3dd10c534ca93f80ff1ea792702f`. The reader and protocol were unchanged.

Historical observations come from the
[refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1970#issuecomment-6180068699):
the gate at `58caf4cd0c` executed 395 tests, with 394 passed, 1 failed and 3 skipped,
four workers and zero retries. The exact 800px layout case failed its final heading
assertion after pointer Back at the unchanged 5,000ms timeout; its 1280px sibling
was present and passed. The unchanged targeted 800px rerun executed/passed 1,
failed 0, skipped 0, retry 0. Original log references are
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1964_6.log` and
`/work/Projects/pyrycode-desktop-agents/logs/2026-10-14T21-42-47-639Z_verifier-gate-rerun_#1964.log`.
Those remote logs and the missing original snapshot were not inspected locally;
neither the rerun nor the absent heading establishes the original event sequence.

The controlled 800px failure measured the link before hover, moved the real pointer
to its recorded center, let two animation frames process layout, then clicked there.
Metadata reveal and bottom pinning moved the link's y from 372 to 344 and scrollTop
from 1461 to 1489. Hit-testing and pointer down/up/click identified the timestamp span.
Only reads 9, 10 and 11 reached the synthetic host; no reopen read arrived, the reader
count stayed zero and the heading assertion failed at 5,000ms. This establishes a
stale-coordinate input mechanism consistent with the historical failure, without
claiming its unavailable trace proves that sequence. A preceding control also exposed
an unsettled preservation baseline: 1489 immediately after open versus 1461 after Back.

After [focus normalization and measured geometry settlement](development-verification-layout-and-input.md#layout-and-input),
the same recorded-coordinate control held y=344, hit the link button, received fresh
read 12 and rendered Plan version 3. Temporary control code was removed. Retained
fake-transport reports under `/tmp/builder-1970/` give these counts:

| Report | Executed | Passed | Failed | Skipped | Flaky |
| --- | --- | --- | --- | --- | --- |
| `stale-pointer-normalized.json` | 1 | 0 | 1 intentional | 0 | 0 |
| `controlled-repair.json` | 1 | 1 | 0 | 0 | 0 |
| `final-repeat.json` | 20 | 20 | 0 | 0 | 0 |
| `reader-specs.json` | 4 | 4 | 0 | 0 | 0 |

Every result used retry 0. Both exact titles were present and passed ten times each
in `final-repeat.json` with four concurrent workers:

- `reader scrolls under sharp chrome with dynamic clearance and input at 1280`
- `reader scrolls under sharp chrome with dynamic clearance and input at 800`

The repeat-only scratch config lifts the clipboard project's one-worker cap only for
these clipboard-write-only cases; repository clipboard isolation is unchanged.
`reader-specs.json` contains all three menu-spec cases and the reader spec's refetch/Back
case, each executed and passed. The native 1280×800 and 800×600 cases retain resize/zoom,
dynamic clearance, positive menu overlap and input, draft/thread-position preservation,
injected external-open/save failures, fresh content/read correlation and keyboard Back.

The verifier verdict supplies the full-suite counts absent from the dispatcher's
unstructured gate report: 397 executed/passed, 0 failed, 1 skipped. It confirms all
four reader tests were present, executed and passed at the reviewed commit. This is
fake-transport evidence; no live-Claude run was required or claimed.

Controlled patches are `controlled-failure.patch` and `controlled-repair.patch`;
their reports retain geometry/pointer/read diagnostics and the failure error-context.
Result directories are `stale-pointer-normalized-results/`, `controlled-repair-results/`,
`final-repeat-results/` and `reader-specs-results/` alongside the reports. Logs and
`repeat.config.ts` remain there too. The retained bundle is
`/tmp/builder-1970-evidence.tar.gz`. These are scratch evidence locations, not committed
assets or new test executions by the documentation stage.
