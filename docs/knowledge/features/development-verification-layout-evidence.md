# Conversation layout verification evidence

Counted browser results and reviewed captures for the translucent conversation and
Markdown reader layouts. See [Development verification](development-verification.md#layout-and-input)
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

