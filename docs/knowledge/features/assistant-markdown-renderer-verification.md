# Assistant Markdown verification

Computed-style, mounted-render and retained regression evidence for the
[Assistant Markdown renderer](assistant-markdown-renderer.md). Static server
renders establish markup, not browser typography or interactive behavior.

## Heading typography

[`e2e/assistant-whitespace.spec.ts`](../../../e2e/assistant-whitespace.spec.ts)'s
“all six markdown heading levels share the scale while streaming and settled”
uses `readHeadingTypeMetrics` to measure all six top-level headings, a quoted H2
and a list-item H6 at window widths 1280 and 800. It checks the active stream,
another observed delta and settlement, including cursor presence/removal.
Each heading must match both the [literal scale](assistant-markdown-renderer.md#heading-typography)
and its designated token quartet, the Roboto-first `--font-sans` stack and
`--color-on-secondary-container`. Comparing computed values only with tokens
could pass if both drifted together; one settled H2 cannot prove six-level or
streaming coverage. Blink's `normal` tracking is normalized to `0px` before comparison.

The existing inline-code regression checks H2 code against
`--text-markdown-h2-size` and literal `18px`, while retaining its monospace,
background, wrapping and fenced-code exclusion assertions. Static renderer units
cannot establish computed CSS. Reader inheritance is confirmed by its shared
container and the [PR](https://github.com/pyrycode/pyrycode-desktop/pull/2113);
reader-specific browser verification remains with #2100.

The [accepted Linux verifier verdict for #2106](https://github.com/pyrycode/pyrycode-desktop/pull/2113#issuecomment-6256259013)
at `800043c1` records all 14 whitespace regressions present and passed, including
the named six-level test, inline code and existing spacing. The builder's focused
run executed/passed 14 tests, with 0 failed and 0 skipped. The configured Electron
run executed 500: 499 passed, 1 failed and 5 skipped; all 14 whitespace cases passed
there too. The unrelated catch-up failure remains recorded under #2109; the
dispatcher accepted its successful same-tree targeted rerun. The builder's guarded
two-send captured reply scenario executed/passed 1 test, with 0 failed/skipped and
zero forbidden launches. This is retained offline evidence, not a fresh live run.

The verifier compared revision-matched streaming and settled captures at content
sizes 1280×873 and 800×873 with Figma `892:13442`, confirming heading typography
and preserved spacing. Retained capture references are
`/tmp/verifier-2113/{streaming,settled}-{1280,800}.png` and `/tmp/builder-2106/`.
No provider/live proof is required; macOS is outside this Linux ticket's scope.

## Heading spacing

`e2e/assistant-whitespace.spec.ts`'s “H1–H6 spacing preserves adjacent, nested and
outside edges while replies grow at 1280” and its 800-wide counterpart measure
all six levels between non-heading blocks, adjacent headings, first/last headings,
heading-only messages and headings inside lists/quotes. Each fixture is checked
while streaming, after an observed appended paragraph and after settlement.
Positive block and nested-heading counts prevent empty geometry from passing.
The expected gaps are literal 20/12 px at heading/non-heading boundaries,
16 px between adjacent headings or non-headings, and 8 px inside lists/quotes.
Both outside offsets must be zero. Typography retains the separate six-level
regression above.

Parameterize the viewport and resize once per launch. Repeated resizing inside
the fixture/phase loop lost Electron's main evaluation context during one of
42 resize calls (retained failure in `/tmp/builder-2107/final/`). Separate
viewport cases keep every geometry assertion without that repeated resize loop.
Appending before settlement changes a heading-only or final-heading fixture:
its settled edge check then proves the appended form only. The committed test
has this nonblocking coverage gap; unchanged settled edges were verified
separately, not added to the regression.

The [accepted Linux verifier verdict for #2107](https://github.com/pyrycode/pyrycode-desktop/pull/2115#issuecomment-6256805856)
at `127ce946` records the PR's post-merge focused whitespace/reader run:
19 executed, 19 passed, 0 failed and 0 skipped. Both named spacing viewport
cases and the six-level typography case were present and passed, along with
“the reader menu copies the note three ways and refreshes it (#1630)”. That
reader-menu check now expects 12 px from H1 to paragraph at both widths,
inherited through the shared `.bubble__markdown` container. Additional
reader-specific coverage is owned by #2100; the merged #2106 typography stays
unchanged by the spacing rules.

The same verdict records separate scratch Electron checks: 2 executed/passed,
0 failed/skipped, at 1280×800 and 800×800 windows. Those measured unchanged
H1–H6 heading-only and final-heading replies while streaming and settled, with
zero outside offsets. Each width retained 16 measured states in
`/tmp/verifier-2115/current/metrics-{1280,800}.json`. The verifier's local unit
report `build/dispatcher-tests/unit-pg2765kl/dispatcher.xml` records
9,523 executed/passed, 0 failed and 3 skipped, including AssistantMarkdown
(157 passed) and StreamingAssistantMarkdown (75 passed), neither with skips.
Build preceded Electron checks. These are recorded Linux results, not tests
run by documentation; macOS is outside this ticket's verification scope.

The verifier compared fresh synthetic streaming/settled captures at the reviewed
head with Figma `883:13431`, retaining main's typography. Captures are
`/tmp/verifier-2115/current/{streaming,settled}-{1280,800}.png`, with content
sizes 1280×773 and 800×773. No provider/live run is required for this CSS behavior.

## Rendering and spacing

`hostedAppLink.test.ts` pins the exact raw grammar. `hostedAppLinks.test.tsx`
covers opt-in and inert output, no render-time activation or identity attributes,
normalization rejection, escaped titles/reference labels and meaningful/blank
labels in settled and streaming renderers. Static markup cannot prove activation;
see [the production link scenarios and counted evidence](development-verification.md#hosted-app-link-verification).

`StreamingAssistantMarkdown.test.tsx` replays every original prefix of the named
regression fixtures and deterministic seeded block-starter fuzz. It compares raw
partition trees at absolute offsets and rendered markup with the full parse/render,
ignoring only whitespace between blocks. Pending display has separate expected-output
cases because it intentionally differs from raw-prefix rendering. Existing
`AssistantMarkdown.test.tsx` security cases also cover callers without stabilization.

Static markup and unchanged DOM identity cannot prove a skipped render.
[`e2e/progressive-markdown.spec.ts`](../../../e2e/progressive-markdown.spec.ts) uses
mounted V8 function counters for frozen-render skips and bounded probing, plus a
scoped parser breakpoint to prove later inputs exclude frozen source. It also covers
definition invalidation, pending presentation and both raw-source settlement triggers.
[`e2e/assistant-whitespace.spec.ts`](../../../e2e/assistant-whitespace.spec.ts) checks
computed styles and geometry for markdown-owned whitespace and cursor placement.

Block spacing requires measured rectangles as well as computed `row-gap`: UA block
margins can add space while the declared gap still looks correct. The settled
“markdown blocks keep heading spacing and flush bubble edges” case guards block
count, every gap and both zero edges. “streaming markdown blocks keep heading
spacing through settlement” measures seven blocks before and after settlement
at 1280×800 and 800×800 window sizes. Both expect 20/12 px at heading boundaries
and 16 px elsewhere. The nested list/quote case retains 8 px checks.
The [reader menu scenario](conversation-shell-markdown-reader.md#note-actions-menu)
measures its loaded note at both sizes, accounting for escaped-HTML text items.

The [accepted Linux verifier verdict for #2097](https://github.com/pyrycode/pyrycode-desktop/pull/2105#issuecomment-6255574509)
records 499 executed, 498 passed, 1 failed and 5 skipped in the complete application
run. All 17 whitespace/reader cases above were present and passed without retries.
The unrelated history-on-open failure remains failed, tracked in #2112; its separate
dispatcher rerun executed/passed 3 tests, 0 failed/skipped, including the failed case.
The prior visual review inspected streaming, settled and reader captures from
`93669438` at 1280×773 and 800×773 content sizes against Figma; the repair changed
no spacing CSS. These are retained results, not fresh documentation runs. No provider
run is required; macOS is outside this Linux ticket's verification scope.

Recorded evidence at `4d33723f` from the
[passing verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1832#issuecomment-6028909574):
the configured fake-transport run executed 321 tests, all passed, with 0 failed and
5 skipped. Both named progressive tests, “indented pending headers and heading closers
preserve streaming presentation” and “progressive presentation, parser/render reuse
and raw-source settlement”, were present and passed (2 executed, 0 failed/skipped).
All 13 assistant-whitespace tests executed and passed (0 failed/skipped). No live
Claude or real-daemon evidence is required for this renderer behavior.

The settled-row regression also counts `AssistantMarkdown` separately from
`TimelineRow`, `ToolRow`, `StreamingAssistantMarkdown` and `parseMarkdown`.
Establish positive counts before measuring skips and observe each delta before
delivering the next; batching can otherwise manufacture apparent reuse.
`StreamingAssistantMarkdown` may execute again for its own partition-state update,
so its positive counter must remain separate from the parent row count. See
[row reuse verification](conversation-shell-timeline-render.md#row-reuse-verification)
for the mounted regression and baseline/fixed evidence.

At `c0268369`, the 2026-10-08
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1889#issuecomment-6053401984)
and dispatcher gate report record 358 fake-transport tests executed/passed, 0 failed
and 4 skipped. Both “settled rows skip deltas and unrelated group toggles while the
active reply renders” and “progressive presentation, parser/render reuse and
raw-source settlement” were present and passed. This is counted mounted evidence
for settled reuse alongside the existing progressive proof.
