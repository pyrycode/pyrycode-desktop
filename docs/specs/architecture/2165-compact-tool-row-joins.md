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
