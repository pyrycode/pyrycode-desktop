# Sidebar pairing toolbar

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelListView`, `renderBody`, `SectionHeader`, `SettingsButton`, `ArchiveButton`, `controlNamePlacement`: toolbar, grouping, callback and tooltip seams.
- `src/renderer/src/screens/channels/channels.css` — `.channel-list__actions`, `.channel-list__tree`, `.channel-list__host`, `.channel-list__pair`: fixed toolbar, scrolling, first-host margin and focus treatment.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` — `render`, section markers and pairing assertions: migrate header-dependent static tests without weakening grouping checks.
- `src/renderer/src/PairedShell.tsx` — `PairedShell`, `PairedShellView`: existing origin-aware cancellation and diagnostic ownership; callback contract stays unchanged.
- `src/renderer/src/theme/tokens.css` — spacing and primary colour tokens: existing values cover the revised geometry.
- `e2e/sidebar-pair-new-host.spec.ts`, `e2e/sidebar-section-header-plus-name-pill.spec.ts` — pairing origin, draft, focus and tooltip interaction proof.
- `e2e/sidebar-tree-geometry.spec.ts`, `e2e/paired-shell-card.spec.ts`, `e2e/sidebar-offline-mutations.spec.ts` — geometry, paint and obsolete header/two-button assertions.
- `docs/knowledge/features/channel-list.md`, `channel-list-section-header-pair-control.md`, `paired-shell-routing.md` — existing grouping, tooltip placement and modal lifetime.
- `docs/knowledge/features/development-verification.md` — static rendering cannot prove clicks or geometry; fake transport supplies that evidence.

CodeGraph returned “not initialized” for this worktree; source reads established two `SectionHeader` consumers and one `renderBody` call. No other remote feature branch touches the planned files after fetching origin.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-3902

The sidebar's top bar (`115:3693`) places Settings and Archive at the left and Add (`590:5802`) at the right, all as primary-colour glyphs without button grounds. Its 360px-wide buttons wrapper has 4px top padding and 24px controls, followed by a 16px gap and a 1px primary-colour rule at 60% opacity. Sidebar padding is 24px above and 20px horizontally; list content starts 24px below the rule. The current design also shows host-first grouping, which belongs to #1679 and is outside this slice.

## Change

Move the existing nullary pairing callback into one private toolbar button and delete the two global title rows. Keep Settings then Archive in DOM order, followed by pairing with an automatic left margin; use a 20px flex gap and 4px wrapper top padding. Keep the existing toolbar/rule outside the scrollport and change the rule margin to 16px and tree top padding to 24px. Replace header adjacency with first-child/divider adjacency for the first host's zero top margin, retaining the section divider and existing server/workspace grouping.

Reuse the existing Settings and Archive glyphs. Store the Figma 24px add SVG locally under `src/renderer/src/assets/` and use it as a primary-colour mask. Preserve native buttons, accessible names, focus outlines and the shared pointer/focus name-pill placement. Apply that existing pill treatment to all three toolbar actions. No new exported API, state, async task, failure mode or transport operation is introduced; pairing lifecycle/error diagnostics remain owned by the existing flow.

Sizing recheck: one deliverable, two production source files plus one SVG; approximately 450 written lines including tests and this plan; zero new exports; three private consumer updates (two removed header calls, one shortened `renderBody` call); three acceptance criteria; zero new reject branches. This is within all six limits and smaller than #1443's comparable 770 added lines including its plan.

## Testing strategy

- First change the static tests and observe failure for the single toolbar pairing button and absent headers. Retain partition checks by using the tree/divider boundaries instead of deleted label text; cover null, empty and populated list states.
- Fake-transport pairing spec: one visible toolbar trigger; Enter/Space activation; Cancel/Escape return to list/thread/Settings and trigger focus; thread draft preservation; Settings and Archive navigation.
- Tooltip spec: shared hover/focus treatment, pointer-following placement, hide on leave/blur and visible focus for all three controls.
- Geometry spec: 400px sidebar, 20/24px insets, 28px wrapper, 24px controls at y=4, left gap 20, 16px to the 1px rule, 24px to first host; toolbar and rule stay fixed during tree scrolling. Capture 1280×800 and 800×800 synthetic renders for comparison with Figma.
- Migrate the paired-shell paint assertion to the toolbar and offline pairing count to one. Run touched unit tests, `npm run build`, and each changed fake-transport spec. Full suites belong to the verifier; no live-Claude check is needed.

## Documentation handoff

Pending documentation stage: no explicit documentation requirement appears in the ticket. Update the owning channel-list overview's “What it does” and pairing-control topic's geometry/wiring descriptions to reflect the single toolbar entry and removed global headers.

## Open questions

None.
