# Sidebar status dot redraw

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer conventions and owning topic.
- `docs/knowledge/features/channel-list.md` and `channel-list-status-dot.md`: per-row status subscriptions and the settled centred geometry.
- `docs/knowledge/features/development-verification.md`: static renderer tests cannot prove CSS paint or hover.
- `src/renderer/src/screens/channels/ConversationStatusDot.tsx` → `ConversationStatusDot`: existing pure leaf and accessible labels remain intact.
- `src/renderer/src/screens/channels/channels.css` → `.conversation-status-dot` and its modifiers: paint, idle row overrides and working animation.
- `src/renderer/src/theme/tokens.css` → `:root`: add a dot-only colour beside the existing warning token.
- `e2e/sidebar-status-dot-fills.spec.ts` → computed-style probes: existing coverage for all four paints.
- `e2e/sidebar-row-geometry.spec.ts` → idle dot checks: real open and hovered rows already exercised.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=106-3077, in use at node 103-2985. Context and screenshot inspected: four 6px circles, idle an unfilled blue ring at half opacity, working solid primary blue (#9dcbfc), new messages solid success green (#2fc038), input required solid gold (#d8b85a). Figma variable definitions confirm `Schemes/Success`; the ticket supplies primary and dot-only gold values. Existing CSS circles express these shapes without image assets.

## Change

Move the inset primary ring from the base class to `--idle` and give idle opacity 0.5. Remove the hovered/open idle background rule. Working uses `--color-primary` and retains its existing blink and reduced-motion fallback; new messages retains `--color-success`. Input required uses a new `--color-status-dot-input-required: #d8b85a` token, leaving connection `--color-warning` unchanged. Filled dots have no ring. Size, position, labels, status resolution and stores stay unchanged. Replace comments that describe the superseded paint contract. No new state, types, failure modes or dependencies.

Remote overlap: `feature/1658` adds create-channel model controls elsewhere in `channels.css`; no shared logic or dependency, so this change stays local to dot rules.

Sizing checked before and after planning: one independently verifiable visual behaviour, two acceptance criteria, about 200 total written lines including tests and plan, zero exported surfaces, zero consumer API updates and zero error branches; within all builder limits.

## Testing strategy

- Update the existing browser paint spec first and observe failure against the old stylesheet: idle-only ring and half opacity, three exact solid fills, 6px geometry, working-only animation and reduced-motion fallback. Check connection warning remains amber.
- Update the idle assertions in the existing row geometry spec: both real idle rows remain transparent, half-opacity rings at rest and while hovered/open.
- Run the focused paint and geometry specs, existing `ConversationStatusDot.test.tsx` and `ChannelList.test.tsx`, and `npm run build`.
- Capture actual `ConversationStatusDot` static renders in all four states using the shared capture recipe, compare with the Figma screenshot, and record viewport and scratch image paths in the PR. Full suites belong to the dispatcher.
