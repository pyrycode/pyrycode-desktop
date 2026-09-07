# #1113 — the message bubble's text takes the design's body-medium type

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.bubble` — the four type declarations under change; `.bubble__file` and `.bubble__markdown th, .bubble__markdown td`, the two other rules whose comments state the bubble's weight as a premise.
- `src/renderer/src/theme/tokens.css` → the `--text-title-small-*` quartet plus `--text-title-small-weight-emphasized`, and the `--text-body-medium-*` quartet the bubble moves onto. The body-medium quartet already has a dozen consumers in `conversation.css` (the composer textarea, the tool row, the unrecognized row), so nothing is added here.
- `e2e/user-whitespace.spec.ts` → `readBubbleMetrics` — reads the bubble's line height off its OWN computed style, so this retune cannot move its numbers; its doc comment names the title-small token as the thing it deliberately does not read.
- `e2e/attachment-file-row.spec.ts` → `ROW_TOP_IN_BUBBLE_PX` — 48 = `--space-4` + one 20px line of message text + `--space-3`; the comment names that line as title-small.
- `docs/knowledge/features/conversation-shell-message-bubble.md` § the `title-small` family — records that #969 added the family for this one consumer and that `--text-title-small-weight` shipped with none. After this ticket the whole family is dormant, which the token comment has to say rather than keep naming the bubble.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 (`Message area`, both bubbles)

Every message text node in the frame — assistant `132:4444` / `132:4445`, user `132:4433` / `132:4434`, and the short and attachment-carrying variants — is `M3/body/medium`: Roboto Regular, 14/20, tracking 0.25, weight 400. `get_design_context`'s style list prints the step's weight as 400 outright. The screenshot reads as regular-weight prose in both fills; nothing else in the frame moves, and the meta row, the file field and the session-reset divider stay at body-small as shipped.

## Change

`.bubble` swaps its four type declarations from the `--text-title-small-*` tokens to the `--text-body-medium-*` ones: size and line stay 14/20 (both families carry the same pair), tracking goes 0.1 → 0.25, and the weight goes from `--text-title-small-weight-emphasized` (600) to `--text-body-medium-weight` (400). No markup, no token, no `.tsx`. Nothing geometric moves, so the streaming tail, the queued row and the retired `MessageBubble` take the new type by the same inheritance that gave them the old one.

Three comments state the old weight as a premise and are reworded in the same commit:

- `.bubble`'s own block comment, which walks through why #969 typed it at title-small emphasized.
- `.bubble__file`'s "ALL FOUR TYPE AXES ARE RESTATED" paragraph — its point (body-small differs from the bubble on every axis, so three are easy to inherit by accident) survives the change, but the number it names does not.
- `.bubble__markdown th, td`'s "NO font-weight" paragraph, where the reasoning itself changes: it argued that a token-sourced weight would *erase* the header distinction because the scale topped out at the bubble's own 600. At 400 that is no longer true. The decision does not move — `<th>`'s UA `bold` still distinguishes the header and no declaration is added — but the comment must say why on the new footing rather than on the old one.

In `tokens.css`, `--text-title-small-weight-emphasized`'s comment names the bubble as its consumer; the family stays in place, dormant, and the comment says so. `--text-title-small-weight`'s comment already reads "no consumer today" and needs nothing. `--text-label-medium-weight-emphasized`'s "the same node already uses title-small-emphasized, so more are coming" is #721's own historical note about the code-block header's Figma node and is left alone — it does not say the bubble is title-small.

The two `e2e/` comments name the 20px line and the line-height token by the wrong family only; both numbers are identical across the two steps, so the reword is the whole edit.

## Testing strategy

No new proof, per the ticket. The change is four token references with no new logic and no geometry, and renderer specs are static markup renders that apply no stylesheet, so nothing there can see a computed weight.

What guards it: `e2e/user-whitespace.spec.ts` and `e2e/attachment-file-row.spec.ts` both derive their heights from the bubble's live line box (`readBubbleMetrics`) and from `ROW_TOP_IN_BUBBLE_PX = 48`. Those numbers hold only while size and line stay 14/20 — exactly the pair this change must not move — so a slip onto a step with different metrics reddens them in the verifier's fake-transport tier. Weight and tracking themselves are asserted nowhere today and are read straight off the two declarations; adding an assertion for them is a spec of its own, which is the "no new proof" the ticket rules out.

`npm run build` covers the rest: an unknown custom property would not fail it, so the declarations are checked by reading them against `tokens.css`, where the body-medium quartet is present and already widely consumed.
