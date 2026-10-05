# Hide repeated background-task finish summaries

## Files read

- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskRow`: owns the finished summary and its truncation marker.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` → status tag and summary scenarios: static-render coverage and held-task fixtures.
- `src/renderer/src/screens/conversation/conversation.css` → `.background-task-panel__summary`: existing body-small styling remains applicable.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-shell-background-tasks.md`, and `docs/knowledge/features/development-verification.md`: renderer tests prove markup; terminal summaries and their cut markers share a display guard.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230 — populated vertical drawer with finished cards, type/status headers, descriptions and informative summaries in On Surface Variant body-small text. Keep the existing components, tokens and card spacing; repeated summaries take no extra line.

## Change

In `TaskRow`, hide a finished summary when its trimmed text contains the non-empty trimmed description using a case-sensitive substring comparison. Keep the existing non-empty summary and finished-row guards; empty or whitespace-only descriptions continue to show a non-empty summary. Comparison uses derived strings only; render retained summaries verbatim as escaped React text and leave held data untouched. Hide the summary's truncation marker with its summary. No new type, state, async task, failure mode or consumer change is needed. The branch scan found no overlapping in-flight feature branches; #1746 is already present and its type formatting remains untouched. Estimated total written work is under 150 lines, with zero new exports or consumer updates and one display behavior.

## Testing strategy

Add static-render tests beside the existing summary scenarios, first observe the repeated-summary test fail, then implement the guard:

- Template and exact summaries containing a trimmed description disappear, including their cut markers; description and status remain and the frozen held task retains its data.
- Distinct failure/stop text and a case-different summary remain visible verbatim with their existing cut markers.
- Empty and whitespace-only descriptions retain their summary.
- Empty summaries render no summary or cut marker.

Run `npm test -- src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` and `npm run build`. Capture the actual static panel with synthetic repeated and informative summaries at 1280×800 and 800×600, and compare with the Figma frame. No user-driven transition changes, so no new Playwright interaction spec is required.
