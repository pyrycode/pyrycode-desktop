# Translucent thread controls

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer boundaries and reading map.
- `docs/knowledge/features/conversation-shell.md`: existing chrome, sheets and composer ownership.
- `docs/knowledge/features/conversation-shell-scroll-pin.md`: follow flag, resize observation, native anchoring and zero-offset prepend compensation.
- `docs/knowledge/features/development-verification.md` → Layout and input: positive overlap plus actual clicks establish stacking.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → ConversationScreen, useThreadScrollPin, reassertPinnedToBottom, ComposerSlot: preserve the existing scroller and send/history signals.
- `src/renderer/src/screens/conversation/conversation.css` → thread, overflow, composer, drawer and covered wrapper: current geometry and stacking.
- `src/renderer/src/theme/tokens.css` → shadow-thread, spacing and typography: reuse existing values.
- `e2e/fixtures/launchPairedApp.ts` and existing scroll-pin, history-walk, composer-message-box, thread-overflow-overlay and background-task-drawer specs: integrated fake transport and geometry assertions.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9848

Read desktop frame plus shared Top bar `731:6010` and Input area `134:5013`, including screenshots. Keep the sidebar and existing desktop glyphs/footer. Overlay full-width controls on the existing thread; the scrolled reference does not change resting first-row clearance. Header gradient uses #09141D to transparent, with progressive 10px → 0px backdrop blur. Input gradient uses transparent → #0B0E11 at 60%, with 0px → 10px blur across its top fifth. Default shadow is black at 20%, offset (0, 4), radius 5; reuse `--shadow-thread` for text and an equivalent filter variable for glyphs. Introduce local CSS variables for treatment values rather than altering global theme ownership.

## Context

The flexible message region currently ends at the header and composer. Full-pane scrolling allows rows to show through softened controls without sacrificing the existing desktop geometry or reader position.

Overlapping branches: #1726 queued controls, #1729 inline questions, #1731 queue row identity and #1732 sidebar menu. Their changes do not supply a required interface or rewrite the scroll/layout logic; keep edits local and additive.

Sizing: one layout deliverable; approximately 650–750 written lines including this plan and browser tests, no new exports/types/stores, one composition site, five observable criteria, no new I/O reject branches. No dependency added.

## Design

Wrap existing header/notices and ComposerSlot in separate positioned chrome containers, with non-interactive decorative blur layers behind their sharp controls. Keep Timeline, its ref, direct-child rows, stable keys and native scroll anchoring. The covered subtree fills the pane; the reader remains its existing independent overlay.

The existing pin measures the occupied header/input border boxes into CSS custom properties on the covered pane. Thread padding reserves those heights at history start and bottom; temporary inline bottom padding remains exclusively prepend compensation, so clearing it restores measured CSS clearance. Measure before pinning and before zero-offset compensation. Observe both chrome boxes in the existing resize observer so composer-only edits, status, attachments, questions, window size and zoom all update clearance and conditionally re-pin.

Stacking: rows below pills/drawer, chrome above pills, menus above rows/pills, existing sheets above chrome. Pills start below the measured header. Drawer top/bottom use measured chrome heights; leave the input live. Existing focus, Escape and outside-click handlers remain responsible for behavior.

## State + concurrency model

No new store state or asynchronous task. Heights and following remain DOM/ref-local. Existing observer teardown disconnects all targets; callback re-reads the current thread. Successful send re-arms the same following flag. User input/history demand and native nonzero anchoring remain unchanged.

## Error handling

No new I/O, parsing or failure branch. Existing notices are included in occupied header height; pending permission/questions in input height. Hidden reader chrome retains its geometry.

## Testing strategy

- Write a focused fake-transport spec first and observe failure for missing full-pane scroll geometry.
- Assert full-pane boxes, start alignment, bottom clearance, overlapping rows, click precedence, composer growth/shrink, resize and Electron zoom at both requested sizes.
- Exercise status, attachment and pending prompt clearance using existing fake frames where available; retained tests prove send, late images and zero/nonzero history anchoring.
- Run existing scroll-pin/history-walk, composer-message-box, thread-overflow-overlay and drawer specs, plus affected prompt scenarios.
- Capture synthetic resting, under-header, under-composer and expanded states at both sizes under `/tmp/builder-1733/`; inspect against Figma and preserve for review. Record revision and comparison in PR.
- Final merge of main, pre-verify check, build and all changed focused specs. No live spec changes expected.

## Open Questions

None. Use measured chrome rather than duplicating height formulas; retain the existing scroll state machine.

## Revisions

2026-10-05: Browser resize coverage exposed a native anchoring scroll arriving before resize observation when narrowing the pane. Keep a ref of the last observed viewport dimensions; while following, a scroll with changed dimensions leaves the decision to the pending observer rather than reclassifying layout movement as reader input. The existing offset echo still handles ordinary pin writes. Synthetic native Electron captures replace the Playwright screenshot call, which timed out on this runner; wait two animation frames so captures represent the requested painted state.

2026-10-05: Read `ComposerOptionsPanel.tsx` → useComposerOptionsClamp: its existing boundary is the window. In the conversation input chrome, use the pane's right edge and apply its existing measured maximum width to footer menus as well as type-ahead, retaining other consumers. This adds a third production file without a signature migration. Update composer-message-box's old viewport-shrink assertion to assert unchanged viewport plus the matching clearance-padding delta. Share native capture in `e2e/fixtures/capturePairedApp.ts` with the four affected screenshot-bearing specs; preserve their images and all interaction assertions. Written work remains below 800 lines with one new exported test helper.

2026-10-05: The full-pane viewport invalidated the late-image fixture's greater-than-one-viewport parked-distance precondition (727px versus 733px). Increase its shared synthetic reply count from 20 to 24; retain all image and position assertions. Update the existing options-clamp geometry test to prove the pane-relative width bound and width restoration, rather than a window-relative left shift.

2026-10-05: An empty offline thread unmounts Timeline while header notices remain; its Re-pair pill was measured 32px inside the occupied header. Give the pin a pane ref and observe chrome independently of the optional scroller. `measureThreadChrome(pane)` remains usable with no Timeline, and all following/anchor writes still require a mounted thread. The observer teardown disconnects the pane too. Footer command coverage now explicitly parks again after a successful command, which correctly resumes following like a typed send.

2026-10-05: The measured rejection banner places Re-pair below the short header menu. Retain positive overlap and actual click checks for usage pills at both sizes; the connection scenario still checks stacking and a real menu click at its natural position. The new empty-offline regression separately clicks Re-pair below the measured header.

2026-10-05: The affected permission-sheet scenario also stalls in Playwright screenshot on this runner. Migrate its capture calls to the same native helper, retaining the original image paths and all permission assertions.

2026-10-06: Verifier findings 1–4 require restoring modal precedence and completing browser geometry migration. Contain the thread, pills and drawer in the message area's level-0 stacking context; put sharp chrome at level 1 so existing level-2 sheets and later dialog siblings (including Create chat at level 3) retain their precedence. Remove the sheet's new level-3 override. Bound drawer width by pane width minus its right inset, and prove containment and unchanged Escape/send behavior using actual Electron resizing at both requested sizes. Overlaps remain additive with #1726 and #1729; #1732's merged sidebar-menu CSS is preserved.

2026-10-06: `capturePairedApp` creates the destination parent recursively before writing; a capture into a fresh nested test-output path must match the returned PNG. Migrate status/newest-row geometry to measured input chrome, pills to occupied-header height plus their gap, and type-ahead width to the input pane boundary. Keep all interaction, overlap and scrim hit-test assertions.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/conversation-shell.md` → What it does / How it works: full-pane scrolling behind translucent controls; reader adaptation remains follow-up work.
- Pending documentation stage: `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin: measured chrome clearance, chrome-only ResizeObserver changes, resize/zoom following and coexistence with temporary prepend padding.
- Pending documentation stage: `docs/knowledge/features/development-verification.md` → Layout and input: below-header pills, dialog/sheet/menu ordering, drawer boundaries, pane-relative menu clamping, native capture parent creation, final revision, retained capture paths, comparison results and executed browser counts. No wire/protocol documentation change.
