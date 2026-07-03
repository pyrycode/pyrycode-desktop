# 0003 — M3 theme tokens as CSS custom properties, single source

## Status

Accepted, 2026-07-03. First realized in [#1](../codebase/1.md).

## Context

The desktop renderer mirrors the mobile design, whose visual language is Material 3: colors bound to `Schemes/*` variables and text bound to M3 text styles. The first renderer ticket (#1, the conversation shell) needed those values, and every screen that follows (#2 connection/status UI, #12 streamed-reply rendering) will need the same palette and type scale. The question was where those values live and how components reference them.

The alternatives were: hardcode values per component; pull in a CSS-in-JS or design-token library; or declare the resolved values once as CSS custom properties.

## Decision

Theme values — color, typography, spacing, and radii — are declared once as CSS custom properties under `:root` in `src/renderer/src/theme/tokens.css`, resolved from the mobile M3 **default (dark) scheme**. Every component stylesheet references those variables with `var(--…)`; no color, type, spacing, or radius literal is allowed in a component stylesheet. `index.css` imports `tokens.css` first, so the variables are defined before any component style resolves.

The token families are `--color-*`, `--font-*` + `--text-*` (each M3 text style expands to four tokens: `-size`, `-line`, `-tracking`, `-weight`), `--space-*` (a 4px scale plus named off-grid values), and `--radius-*`.

## Rationale

- **One source of truth.** The values are read authoritatively once (from the Figma variables of node `16-8`) and inlined. Later tickets add screens by referencing tokens, never re-deriving colors or type — which is what keeps the mobile mirror consistent across screens built ticket-by-ticket.
- **No new dependency.** Plain CSS custom properties are native to the platform, work in the self-only CSP, and need no build-time token pipeline. This fits the project's "don't add dependencies without justification" rule.
- **Foundation ported ahead of consumers.** Tokens the shell doesn't yet use (`tertiary`, `success`, `outline*`, the `title-large`/`body-small`/`label-small` type styles, `--font-mono`) are ported now because they belong to the same Conversation Thread scheme. #2's status row and #12's tool chips / code blocks / session delimiters consume them without a second derivation pass.

## Consequences

- **Dark-only for now.** Only the default (dark) scheme is ported; there is no light/dark split. Adding one later means re-declaring the `--color-*` block under a `prefers-color-scheme` (or an explicit theme attribute) selector — the token *names* stay stable, so component styles don't change.
- **Roboto is not bundled.** The self-only CSP forbids a Google Fonts CDN, so `--font-sans` falls back to `system-ui` after `'Roboto'`. The M3 size/line/tracking/weight scale carries the fidelity; exact glyph shape does not. Shipping a self-hosted Roboto webfont is a deferred open question — revisit if a fidelity review flags it.
- **Off-grid values get named tokens.** Design values that fall off the 4px grid (notably the bubble's `14px` horizontal padding → `--space-bubble-x`) still get a named token, so the "no literal in a component stylesheet" rule holds without distortion.
- **Bare structural geometry is not a theme value.** `100%`, flex ratios, the send button's `48px` square, and the bubble content measure are layout geometry mandated by the layout contract, not palette/type — they stay as literals in `conversation.css`. See [the conversation-shell feature doc](../features/conversation-shell.md).

Related: [0001](0001-stack-electron-react-typescript.md) (React + TS renderer), [0002](0002-remote-head-over-relay-shared-wire.md) (the wire reuse this UI eventually renders).
