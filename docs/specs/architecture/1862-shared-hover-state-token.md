# Shared hover state layer token (#1862)

## Files read

- `src/renderer/src/theme/tokens.css` → `:root`, `--color-on-surface`: shared dark-scheme palette and insertion point.
- `docs/knowledge/decisions/0003-m3-theme-tokens-css-custom-properties.md` → Decision: custom properties are the single source of theme values; dormant foundation tokens are supported.
- `docs/knowledge/features/conversation-shell-chrome.md` → Structure: shared roles come from the theme file.
- `docs/knowledge/features/development-verification.md` → What each test tier proves: browser computation establishes resolved CSS values.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=841-9405. Inspected design context and screenshot: each hover layer uses Schemes/On Surface (`#e0e2e8`) at 8% opacity behind existing glyphs and labels; geometry and keyboard focus stay unchanged. This ticket only declares its shared colour.

## Change

Add `--color-state-hover: color-mix(in srgb, var(--color-on-surface) 8%, transparent)` directly beside `--color-on-surface` in `:root`. No consumers or existing hover/focus declarations change. No state, types, failure modes, or dependencies are added. No overlapping in-flight branch touches the file. Size: one deliverable, about 22 written lines including this plan, zero exported surfaces or consumer updates, two acceptance behaviours, zero error branches; within all limits.

## Testing strategy

- Run a scratch browser check against the real stylesheet: the token must resolve to sRGB `(224, 226, 232)` at alpha `0.08`, and follow an overridden On Surface value.
- Verify removing the one new declaration reproduces the prior stylesheet exactly, and search for consumers to establish no visible change. No persistent test is needed for this unused literal token.
- Merge current main, run the pre-verify check and `npm run build`. No interactive or live test changes are required; there is no new rendered state to compare.
