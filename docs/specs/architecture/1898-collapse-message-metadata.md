# Collapse hidden message metadata

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `BubbleMeta`, `TimelineRow`: time/stats slots and the separate always-visible delivery status.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__meta`, `.bubble__turn-stats`: reserved height and independent reveal rules.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → metadata suites: static presence, ordering, timestamp and last-assistant association.
- `e2e/turn-stats-hover.spec.ts`, `e2e/message-side-actions.spec.ts` → hover/focus and geometry assertions that must follow the new contract.
- `e2e/message-copy.spec.ts`, `e2e/attachment-file-row.spec.ts`, `e2e/attachment-image-open.spec.ts`, `e2e/attachment-image-thumbnail.spec.ts`, `e2e/user-whitespace.spec.ts` → metadata geometry checks need an explicit revealed state.
- `docs/knowledge/features/conversation-shell-message-bubble.md` → metadata behavior: supersede reserved timestamp space; retain formatting and last-completed-assistant association.
- `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/development-verification.md`, `CLAUDE.md`: screen composition, static-render limitations and fake-transport interaction coverage.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-4225 · hover: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=814-12025

Read both design contexts and screenshots. At rest the bubble hugs content; hover/focus adds one body-small metadata row, using inverse-primary ink, 8px inline gap and 12px top gap. Existing bubble padding, fills, body-medium text and side actions remain. Keep the current full date/time and stats formatting as the ticket requests rather than adopting the illustrative shortened timestamp.

## Change

`BubbleMeta` returns no row when neither timestamp nor stats exists. Give its rows a details modifier so CSS hides the whole row with `display: none` at rest and restores flex layout on text-row hover or focus-within. Remove timestamp visibility and independent stats-hover rules; both slots inherit the row visibility. Retain the existing metadata typography and revealed gap, and keep delivery status outside the details modifier. No new state, type, async task or failure mode. In-flight `feature/suggestion-quieter-tab-sends` overlaps the screen and stylesheet in composer blocks only; these edits remain local to metadata. Estimated total written work: about 300 lines, zero new exports, no changed consumer contracts, two observable criteria, zero rejection branches; within all size limits.

## Testing strategy

- Static tests first: absent time/stats emits no metadata, stats-only remains supported, and timestamp ordering and completed-turn association remain covered. Update existing stamped fixtures to exercise meaningful metadata.
- Fake-transport `turn-stats-hover.spec.ts`: time and stats reveal together from empty row space and keyboard focus; mouse leave retains focus reveal; removing both collapses the row and bubble again. User timestamps collapse too. Capture resting/revealed states at the normal viewport and 800px minimum.
- Update existing geometry checks to reveal metadata before measuring it; change side-action invariants to require expansion during hover/focus and contraction afterward. Run all changed fake specs. No live specs change.
- Final merge of main, pre-verify check and build.

## Revisions

2026-10-08: The 800px capture showed the full timestamp shrinking between date digits beside the unbroken stats text. Allow the details flex row to wrap whole items onto another line at constrained widths; preserve the existing timestamp and stats strings. The normal-width row remains on one line. Existing action-hover geometry checks now hold keyboard focus to reveal metadata before measuring, so they isolate action paint rather than asserting the superseded metadata reservation.

2026-10-08 (verifier finding 1): Metadata height changes can cause native anchoring scrolls before resize observation, clearing bottom-following intent and obscuring the tail behind input chrome. Extend `useThreadScrollPin`'s existing observed viewport snapshot with content height: a scroll during changed geometry must retain following until the existing resize observer re-pins. Trusted upward wheel/key input still releases following synchronously; held readers retain native anchoring. No store state or new async task. Observer ownership and cleanup remain in the existing hook. Increase collapsed-row fixtures where their original overflow/band preconditions no longer hold, and settle pointer/focus geometry before taking wheel and checkbox baselines. Keep reader-intent, history-demand, input-clearance and visible-tail assertions intact. In-flight `feature/suggestion-quieter-tab-sends` still overlaps only composer logic. Total written work remains under 500 lines; no new exports or consumer contracts.

2026-10-08 (clearance follow-up): Chromium can reach the bottom before delivering the wheel callback, then shift away as hovered rows change height before the scroll callback. A trusted downward wheel measures the actual bottom position and resumes following there. A following reader's subsequent downward scroll retains intent and re-pins through the existing write if metadata moved the endpoint. Small movements within the tolerance are not snapped; upward input still releases synchronously. An immediate predictive pin was rejected because it interfered with small native movements. No additional state or async task. The repeated-reveal spec also wheels from history start through changing metadata to prove clearance at both widths.

## State transitions and identity reuse

| Repeated event | Coverage |
| --- | --- |
| Metadata hover/focus expands and collapses while following, including narrow-window wrap | `turn-stats-hover.spec.ts` → `repeated metadata reveal preserves bottom clearance and held reader position` |
| Metadata focus expands above a held reader then collapses | Same spec: reference row retains its viewport position |
| Upward wheel releases intent during growth, including inside the bottom tolerance | `thread-scroll-pin.spec.ts` → streaming wheel and 1px/4px wheel cases |
| Inline focus/growth while held; history prepend; reader close with a newer committed tail | Verifier-named permission, history, scroll-pin and visible-tail cases |

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/conversation-shell-message-bubble.md` § The meta row and § Turn stats on hover (#1566) — supersede reservation and separate stats hover with collapsed details, simultaneous row hover/focus reveal, whole-item wrapping and unchanged formatting/association/delivery feedback.
- Pending documentation stage: `docs/knowledge/features/conversation-shell-scroll-pin.md` § Thread scroll pin — native metadata resize scrolls retain following; trusted upward intent still releases it.
- Pending documentation stage: `docs/knowledge/features/development-verification.md` § Layout and input — metadata-aware fixture overflow and settled pointer/focus baselines; preserve clearance and reader-intent assertions.
