# Compact tool-row joins

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`, `CompactRow`, `ToolRow`: indexed visible neighbours own joins; compact headers mount through a separate branch.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `presentation`, `projectThread`: omitted-detail headers already adapt to tool calls at index and header scope; preserve deferred body adaptation.
- `src/renderer/src/screens/conversation/conversation.css` → joined wrapper selectors: cancel the thread gap plus overlap one border pixel, square interior corners and keep only the final shadow.
- `e2e/compact-demand.spec.ts` → native compact fixture: negotiate `compact-v1` and inspect actual outgoing detail requests.
- `e2e/tool-runs.spec.ts` → mounted geometry: measure border boxes at 800px and 1280px.
- `docs/knowledge/features/conversation-shell-tool-row-box.md` and `conversation-shell-tool-row-header-groups.md` → visible-neighbour contract and square internal-corner ruling.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md` → normal client replay retains original assertions; this layout repair requires no provider/live effect.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=384-7103

Existing full-width tool boxes share a 1px edge and a single lower shadow. Preserve surface/primary-container theme tokens and body-medium typography; retain `--radius-xs` only at the outside, applying the recorded square-interior ruling over the reference's overlapping rounded instances. Design context and screenshot inspected.

## Change

Restore the existing visible-neighbour join contract for compact-delivered headers in `ThreadItemsView`/`CompactRow`, using a mounted failing seam to identify the smallest repair before altering classification or CSS. Header→Read and Read→SendMessage must each overlap by 1px at equal display depth. A visible non-tool, marker or depth change breaks the stack; hidden descendants contribute no layout. Preserve grouping, expansion identity, deferred adaptation and detail-demand boundaries. No new types, state, failure modes or exported API are planned. Remote feature branches inspected before planning: no committed overlap in the proposed production/CSS/compact-spec paths. One useful behaviour including its regression; estimate ≤280 written lines, ≤2 production files, zero API migrations, three acceptance behaviours and zero new reject branches.

## Testing strategy

- Add a native negotiated-compact Electron regression beside compact demand coverage, with actual omitted-detail Read/SendMessage headers. Observe both after group expansion and retain geometry before repair; assert both seam offsets within 0.5px, all internal/outer corners, borders, widths and shadow placement at 800px and 1280px.
- Include a visible non-tool separator and lone-tool control, plus collapse/reopen checks proving hidden members consume no space and expansion alone requests neither bodies nor child pages. Exercise mixed complete/omitted delivery if the diagnosis implicates rendered selection.
- Run the affected existing renderer unit files through pre-verify and run `npm run build` after the final main merge. Run the focused compact regression and existing complete tool-run spec on Linux; normal full application/replay acceptance belongs to the dispatcher. No live daemon criterion applies. macOS is outside this ticket's verification scope.
- Capture and inspect the integrated expanded state at both widths under `/tmp/builder-2165/` and compare with the Figma reference.

## Revisions

2026-10-20: Mounted diagnosis showed correct join classes and header→Read overlap, but Read→SendMessage had a 31px gap at both widths (32px away from the required −1px seam). Successful daemon summaries explicitly send `error_summary: ""`: `ThreadSummary.MarshalJSON` documents known-no-error and `prepareChildHeader` supplies it for inactive successful rows. `CompactRow` rendered an empty status paragraph after each tool, adding 32px of vertical margins inside its wrapper. Repair only that paragraph's guard to require nonempty text. Keep neighbour classification and CSS unchanged; no new state or concurrency. The new static regression fails only for the empty-string case before repair and preserves escaped nonempty error text. Mounted baseline: 2 executed, 2 failed at the geometry assertion; `/tmp/builder-2165/before.json`, `before-800.png`, `before-1280.png`. The unchanged join map remains covered by the existing complete-route tool-run/ancestor tests, and the new compact regression covers reopening and header revision under the same source id. An attempted full-tool replacement control was rejected by the existing compact protocol (`rootItem` intentionally excludes tools); corrected the fixture to use a valid header revision, keeping complete-route coverage in `tool-runs.spec.ts`.

Final Linux x64 validation after merging main `0b6da265`: pre-verify passed all five checks, including 7 executed/passed unit cases; `npm run build` passed. After restoring Electron SQLite with `npm run rebuild:electron`, `npx playwright test e2e/compact-demand.spec.ts e2e/tool-runs.spec.ts --no-deps --retries=0 --output=/tmp/builder-2165/final-results --reporter=list,json` ran 8 cases, all passed, zero failed/skipped/retried. Report: `/tmp/builder-2165/final.json`. Both compact widths measured −1px at both seams and retained corner/border/shadow and demand assertions. Inspected `/tmp/builder-2165/compact-joins-800.png` and `compact-joins-1280.png` against the Figma screenshot: joined stack and square internal/rounded outer corners match the established ruling; no unresolved visual deviation. Normal full application/replay gate remains dispatcher-owned; no live daemon check is required. Total written work is under 150 lines, one production file, zero new exports/state/error branches or consumer migrations.
