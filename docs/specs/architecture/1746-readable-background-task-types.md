# Readable background task type labels

## Files read

- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskRow`: render the type label without changing the raw type used for description styling.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` → `BackgroundTaskPanelView` render scenarios: replace raw-type expectations and cover display mapping and input preservation.
- `src/renderer/src/screens/conversation/conversation.css` → `.background-task-panel__type`: retain the existing mono typography and primary color tokens.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-shell-background-tasks.md` → panel contract: this is a pure roster reader; daemon strings remain escaped text children.
- `docs/knowledge/features/development-verification.md` → renderer test boundaries: independent expected labels in static render tests, with a separate visual capture.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=564-2230 — context and screenshot read. Card heads show Command and Agent in small mono text using the primary color, beside status tags. Preserve existing layout and tokens; only the type span text changes.

## Change

Add a module-private pure `formatTaskType(taskType: string): string` in `BackgroundTaskPanel.tsx`, used only by the type span in `TaskRow`. Exact `local_agent` maps to Agent and `local_bash` to Command. Other strings lose one leading `local_`, replace every underscore with a space, and uppercase only the first letter, following the detailed Context rule (for example, `local_file_watch` becomes File watch). Empty labels remain empty. Keep the held task, wire format, stored roster, grouping, truncation markers and raw-type description styling unchanged. No new state, exported types, consumers or failure modes. Remote feature branches have no overlap with the two touched source files. Both sizing checks: one deliverable, about 100 written lines including plan/tests, zero new exported surfaces, one internal call site, two acceptance criteria and zero error branches; within the xs estimate and all limits.

## Testing strategy

- Update the existing roster-order render test to expect Command and Agent search in their type spans.
- Table-driven static renders cover exact mappings, multiple underscores, leading-prefix-only removal, empty strings and markup-shaped unknown types remaining escaped.
- Render a frozen task held in an entry and assert its raw type, entry contents and identity remain unchanged; retain existing command-versus-agent description styling assertions.
- Watch the focused component tests fail before implementing, then run the touched component tests and `npm run build`.
- Capture the actual populated view with existing CSS and local fonts in scratch storage, compare its label spans with Figma, and record image paths and viewport in the PR. No interaction changes require a new Playwright spec.
