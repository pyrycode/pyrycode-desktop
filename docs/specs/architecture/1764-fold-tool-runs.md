## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer boundaries and reading map.
- `docs/knowledge/features/conversation-shell.md`: screen composition.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md`: expansion identity and visible joins require flat, mounted wrappers.
- `docs/knowledge/features/development-verification.md`: static rendering cannot prove interaction or geometry.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `Timeline`, `ToolRow`, `stoppedTurnText`, origin-relative keys and disclosure controls.
- `src/renderer/src/screens/conversation/groupToolRows.ts`: ownership projection and descendant-inclusive running status.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts`: queued rows participate in drawn boundaries.
- `src/renderer/src/screens/conversation/conversation.css`: tool outline, fill, joins and spinner animation.
- `src/renderer/src/screens/conversation/toolGroups.test.tsx` and `e2e/tool-groups.spec.ts`: grouping and history preservation.
- `e2e/tool-row-toggle.spec.ts`, `e2e/tool-denied.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: retained member assertions and fake transport.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=726-5376
Read the collapsed, expanded, running and failed frames and screenshot. Retain Desktop `102:4` geometry and existing tool outline/fill/shadow. Header uses body-medium copy, 8px vertical/12px horizontal token padding, a chevron after the label (down collapsed, up expanded), trailing primary spinner/check and error-coloured body-small failure count/glyph. Existing 38px height is within the specified 36px ±2px convention. Expanded header joins the first root member.

## Context

Adjacent tool roots obscure the narrative of a tool-heavy turn. This is one presentation deliverable; stored rows, IPC and wire types are unchanged. The optional `Timeline` prop defaults off; `ConversationScreen` enables it pending Settings sibling #1765.
Overlapping branches #1721, #1724, #1726 and #1729 touch screen wiring or other controls; none supplies a required dependency or rewrites the tool projection. Keep changes local and additive.
Sizing: approximately 700 written lines, one exported projection function and one interface, one production consumer update, three acceptance criteria, no new error branches. The helper plus sibling header is simpler than nesting run containers, which would change member parents.

## Design

`foldToolRuns(items, projection)` produces runs with a first root index, owned member indices, root count, descendant-inclusive running reading and root-only failure count. It scans the grouped projection independently of expansion. Only undrawn turn boundaries are skipped; every drawn non-tool breaks a run. Runs shorter than two roots produce no header.
`Timeline` supplies drawn projection entries and maps run ownership to existing wrappers. Insert a keyed sibling header before each run without changing tool wrapper parents or keys. Hidden run members stay mounted; descendant visibility still depends on `expandedTools`. Header and first visible root use the same join classes as tool members, while member indentation joins remain unchanged. Header copy and accessible glyph labels are client-owned.

## State + concurrency model

A local `expandedRuns` set uses `firstRowKey + first root index`, alongside existing `expandedTools`. Functional toggle updates preserve appends and origin-relative history identity. A newly prepended run header starts collapsed; existing member expansion survives regrouping. Timeline remount on conversation change clears view state. No effects, subscriptions or async work are introduced.

## Error handling

Failure count tests each root once for result error OR denial; descendant failures do not add to it. A running root and failed root render both statuses. A completed successful run shows only the done check. Existing member failure/denial rendering remains intact. No I/O boundary changes or new failure modes.

## Testing strategy

- Test first with static renderer cases for optional-off compatibility, lone tools, drawn boundaries including queued/session/compaction/notices/stopped turns, undrawn turns, Agent descendants and status combinations including denial plus result.
- Fake-transport Playwright proves click/Enter/Space, retained member/Agent expansion, append and history identity, collapsed count/status updates and joined header geometry.
- Adapt adjacent-tool setups in existing toggle/groups/denied specs while retaining member assertions and including the header in stack expectations. Run those focused specs; lone-row proofs remain effective.
- Capture collapsed success, expanded, running and failure states at 800px and 1280px in scratch and compare to Figma.
- Final merge of main, pre-verify check and build. No live-Claude tests change or are required.

## Open Questions

None.

## Revisions

2026-10-05: Preserve run expansion when a prepend introduces an earlier root into the same run. A run is expanded if any surviving member origin is marked in `expandedRuns`; closing clears markers for all its members. Opening still records the first root origin. This also preserves member state when history supplies a previously missing owner.

2026-10-05: `TimelineRow` also omits informational banners. With folding enabled, exclude those from the drawn projection and join reading so invisible notices cannot split visually adjacent tools. Optional-off joins remain unchanged.

2026-10-05: The done-check sublayer resolves to Schemes/On Surface Variant (`#c2c7cf`), while the spinner uses Primary. Use the exported check path with `currentColor` and the existing on-surface-variant token.
