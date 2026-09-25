# #1650 — render Codex's two unrecognized-message sites

## Files read

- `src/shared/wire/types.ts` → `WireUnrecognizedSite` — the closed wire enum, widened by two literals.
- `src/main/transport/inboundMessage.ts` → `parseUnrecognizedMessagePayload` — the literal comparison that throws on any other site; gains the two new literals.
- `src/renderer/src/store/threadTimeline.ts` → `UnrecognizedSite` — the renderer-local re-declaration, kept identical to the wire union so the bridge assigns with no cast.
- `src/shared/chatHistory.ts` → the `unrecognizedMessage` member of `DurableThreadItem` and its `choice(...)` in the snapshot parser — the saved-history site list; without it a restored Codex row fails the snapshot parse.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `unrecognizedSiteLabel` — exhaustive switch; gains two client-owned labels.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

N/A for visual fidelity: the Unrecognized message row has no drawing. This adds two site labels to the existing row and nothing else.

## Change

pyrycode#2608 added `codex_method` (an unmapped Codex notification) and `codex_item` (an unmapped Codex item) to `unrecognized_message.site`. Add both literals to the four site lists above, in the same order in each, and map them in `unrecognizedSiteLabel` to "Codex notification" and "Codex item". The decode stays a closed literal comparison, so any other site still throws `WireDecodeError`, and the history parser's `choice` still rejects anything else. Nothing else moves: the bridge, the reducer and the row render read `site` only through these types and the label function.

## Testing strategy

- `inboundMessage.test.ts`: the "accepts every drop site" loop gains the two Codex sites; the fail-closed test keeps `a_site_invented_later` and adds a near-miss (`codex_event`).
- `chatHistory.test.ts`: a timeline item with `site: 'codex_method'` / `'codex_item'` round-trips; an unknown site is rejected.
- `ConversationScreen.test.tsx`: the label test asserts the two new labels.
- `types.test.ts`: the closed-enum list grows to six.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: the unrecognized-message package overview may note the two Codex sites.
