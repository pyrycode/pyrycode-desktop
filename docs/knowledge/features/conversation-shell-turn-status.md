# Conversation shell — turn status surfaces

The conversation shows retained turn and refusal records alongside live composer status.
Part of [Conversation shell](conversation-shell.md).

- [Background tasks](conversation-shell-background-tasks.md)
- [Timeline render and stopped-turn records](conversation-shell-timeline-render.md)
- [Thinking and working indicator](conversation-shell-working-indicator.md)

## Model refusal records

`ModelRefusalRow` renders both refusal variants as retained `modelRefusal` timeline
items, including served history. A fallback reads `Refused on <original>, continued
on <fallback>`; no fallback reads `Refused by <original>`. An empty identifier reads
“unknown model”. These frames have no turn or message identity: they cannot retract
the refused partial or establish that a turn ended. Receiving one leaves the composer
model label under its existing settings/announcement authority.

A nonempty `banner` enables a native button disclosure, initially collapsed, with
`aria-expanded` and Enter/Space activation. Its expanded plain-text body begins
“Claude: ”. An empty banner has no disclosure. Model identifiers are displayed using
their first 256 characters and banners their first 8192; the stored identifiers stay
unchanged for [Switch back](conversation-shell-composer-status.md#refusal-switch-back).
All daemon text is escaped React children, never Markdown, markup, attributes, URLs
or logs. Category and truncation/drop reports remain inert metadata.

The collapsed label reuses session-separator typography and a shrinkable, single-line
ellipsis box; the expanded body wraps within the thread at the 800px window minimum.
The disclosure button explicitly sets `font-family: var(--font-sans)`: applying the
separator class only to its child leaves the native button's Arial font inherited
by that label. A static class assertion misses this; the computed-font check in
[`e2e/model-refusal.spec.ts`](../../../e2e/model-refusal.spec.ts) catches it alongside
keyboard disclosure and overflow. Static renders cover escaping, bounds and empty
banners. Rows remain after [the recovery offer retires](conversation-timeline-store.md#refusal-offer-lifetime).
