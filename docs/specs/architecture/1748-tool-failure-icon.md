# Failed tool row icon

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ToolRow`, `Timeline`: failure state, trailing count/chevron, visible-row joins.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row`, `.tool-row__right`: plain borders, failure retints, non-shrinking glyph layout.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → `ToolRow` cases: static rendering and existing success/pending controls.
- `e2e/tool-row-toggle.spec.ts` → expanded rows and joined-stack cases: computed borders and toggle behaviour.
- `e2e/tool-groups.spec.ts` → visible joined rows: collapsed descendant boundaries.
- `docs/knowledge/features/conversation-shell.md` → timeline ownership; renderer presentation only.
- `docs/knowledge/features/development-verification.md` → static markup cannot prove layout; focused browser evidence is required.
- `src/renderer/src/theme/tokens.css` → existing error colour and spacing tokens.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=796-11663

Read the section screenshot and its five Tool use instances. Failed rows retain the normal primary-container border and add a 16px Material `error_outline` glyph in Schemes/Error. Preserve the existing desktop right-aligned count/chevron layout, inserting the glyph after the count and before the chevron using `--color-error` and existing gaps; the ticket explicitly requires an inline SVG.

## Change

Keep `tool-row--error` as the failure-state hook. Render the design's inline SVG with `role="img"` and `aria-label="Failed"` only for a failed, non-denied result, in both collapsed and expanded headers. Remove the row and neighbour error border rules and the two error modifiers from `Timeline`'s joins map; preserve all joining geometry. No new types, state, asynchronous tasks or failure modes. One deliverable, two observable acceptance criteria, zero exported symbols or changed consumer signatures, and approximately 160 written lines including plan/tests/comment corrections (below 800). Remote feature-branch inspection found no overlaps with these files.

## Testing strategy

- First add failing static assertions for icon accessibility, order, presence with/without a count and expanded state; success, pending and denied rows have no Failed icon. Assert that visible timeline joins carry no error modifiers.
- Update the existing focused Playwright specs to prove neutral borders on every side and join, icon colour/16px geometry, and retained toggles/grouping. Capture the failed stack through the fake-transport fixture and compare with Figma.
- Run touched renderer tests, `npm run build`, and the two changed Playwright specs. The dispatcher owns full suites.
