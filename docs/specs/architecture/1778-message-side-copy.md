# Message copy beside the bubble

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md` → repository rules and owning topic.
- `docs/knowledge/features/conversation-shell-message-bubble.md` → bubble geometry, streaming inline cursor, reserved meta height, clipboard source and stats hover contract.
- `docs/knowledge/features/development-verification.md` → static rendering cannot prove interaction or geometry; use the fake-transport Electron fixture.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`, `BubbleMeta`, `QueuedRowDrop`: live text render arms and existing copy closure.
- `src/renderer/src/screens/conversation/conversation.css` → `.message-row`, `.bubble`, `.bubble__copy`, `.bubble__turn-stats`: sizing, copy target and independent stats reveal.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → meta-row, queued, streaming and attachment assertions.
- `e2e/message-copy.spec.ts`, `e2e/assistant-whitespace.spec.ts` → clipboard round-trip and inert-markdown positive control guard.
- `e2e/user-whitespace.spec.ts`, `e2e/thread-shadow.spec.ts`, `e2e/turn-stats-hover.spec.ts` → required regression checks.
- `src/renderer/src/theme/tokens.css` → existing spacing and theme roles.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-4225; actions `808:12242`; hover/focus `814:12025`. Read design context and viewed the Message area screenshot. A 13px actions column sits 12px beside each bubble, vertically centred and mirrored for user/assistant. Keep body-medium text, current fills/shadow, inverse-primary copy ink and body-small timestamps; render copy alone. The ticket overrides non-text caps.

## Change

Move the existing copy button/glyph into a module-local `MessageActions({ text })` sibling of the bubble, after assistant bubbles and before delivered user bubbles. `BubbleMeta` retains the timestamp and optional turn stats only. Append a text-row modifier to the two live arms, including queued users, to set a centred border-box width of 100% capped at 900px, a 40px far-side inset, and shrinking content-hugging bubbles with no old 680px/75% cap. Delivered rows have the 12px gap and fixed 13px stretching actions column; queued rows keep their leading drop control and no actions/meta. Define exact off-grid dimensions as scoped CSS variables in the owning stylesheet. Copy keeps inverse-primary ink in every pointer state and a visible keyboard outline; use 4px vertical and 8px horizontal target padding with matching negative margins (27×20px target), compatible with a future 12px glyph gap. Hide timestamp via visibility, revealing on text-row hover/focus-within while reserving its existing slot. Stats still reveal only on meta hover. Streaming, attachment children, clipboard helper, markdown code copy and other row kinds keep their contracts. No new store, async lifecycle, type, dependency or failure mode.

Overlaps inspected: #1726, #1729, #1731, #1733; local/additive edits require none of their unmerged interfaces. Codegraph unavailable (not initialized); source search supplies the surface.

Sizing before commitment: one deliverable, approximately 450–550 written lines including plan/tests, two production files, one new module-local component (zero new exports), two internal render consumers, five observable criteria, zero new error branches. All ceilings hold.

## Testing strategy

- Test first: static markup asserts actions are a direct sibling on user, settled assistant and streaming assistant rows, and absent from queued rows; meta has no copy. Preserve timestamp formatting/empty-slot, stats and attachment assertions.
- Update clipboard locators to the row in `message-copy`; preserve clipboard pointer/keyboard round-trips, permission denial, bubble geometry and meta position checks.
- Move the task-list positive control guard to the row while keeping markdown inertness assertions.
- Fake-transport geometry/reveal spec: both sides, long/short bubbles at 800/1280/1800 widths, 900px outer cap/centering, 40px inset, actions width/gap/vertical alignment, stable colour and keyboard focus, timestamp row pointer/focus reveal without dimension changes, streaming and queued rows, attachment focus and non-text scope guard. Capture synthetic UI at constrained and wide sizes for Figma comparison.
- Run required five regression specs and new scoped spec; after final main merge run pre-verify check and build. No live specs changed; full browser/live gates remain dispatcher-owned.

## Revisions

2026-10-06: The source sweep found four more bubble-scoped copy locators in `e2e/chat-history-recording.spec.ts` and `e2e/offline-conversation-actions.spec.ts`. Move those to the message row and run both specs with all behavior assertions preserved. This extends test maintenance only; the production contract stays the same. Final expected work remains below 550 lines.

2026-10-06: `turn-stats-hover` used `innerText` equality to prove a metrics-free turn adds no stats. Timestamp reveal intentionally changes visible text, so compare underlying `textContent` and assert the timestamp's hidden/visible states explicitly. Keep the existing stats content, absence and meta sizing checks.
