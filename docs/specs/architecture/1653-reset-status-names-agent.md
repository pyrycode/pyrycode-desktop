# #1653 — the reset status row names the conversation's agent

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `RESETTING_RESTARTING_COPY`, `resettingLabel`, `statusRowCopy`, `ThinkingIndicator`, and the `ConversationScreen` container's `selectedHost` / `openConversationId` reads. These are the only production sites that change.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationAgentFor` (#1649). This returns `WireAgent` and resolves an absent agent, an unknown id or an unloaded slot to Claude. It is called with a client-held origin.
- `src/shared/wire/types.ts` → `WireAgent` (`'claude' | 'codex'`).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `resetting` describe block, which holds the existing copy pins and the sixteen-combination membership sweep.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The status row is one line: the turning mark followed by a primary-coloured body-small label. Only the words in the label change. The geometry, colour and modifiers stay the same.

## Change

- Add one client-owned constant beside `RESETTING_RESTARTING_COPY`: `RESETTING_RESTARTING_CODEX_COPY = 'Resetting: restarting codex…'`.
- `resettingLabel(resetting, agent)` selects the restarting constant by `agent`. It still selects and never interpolates, so the agent token never reaches the DOM as a character, which keeps #1517's security posture. The switch over `WireAgent` is total, so adding a third agent causes a `tsc` error.
- `statusRowCopy` threads `agent` through.
- `ThinkingIndicator` gains `agent?: WireAgent`, and an omitted value means `'claude'`. The prop is optional rather than required because an absent agent means Claude on the wire and in the #1649 selector. A required prop would change about 30 test render sites that have nothing to do with the agent, which exceeds the call-site boundary.
- The container reads the agent with `useConversationListStore(selectConversationAgentFor(selectedHost, openConversationId))`. The selector is memoised on those two values. When no conversation is open, the read answers `'claude'`. The container passes the result to `<ThinkingIndicator agent=…>`.

The wrapping-up phase, the bare copy, and both handoff suffixes stay the same.

## Testing strategy

Add unit tests in the existing `resetting` describe block of `ConversationScreen.test.tsx`:

- With `agent="codex"`, the restarting phase reads `Resetting: restarting codex…`, with the handoff suffix appended when one is present. The wrapping-up copy and the bare copy stay the same.
- With `agent="claude"` and with the prop omitted, all sixteen `(phase, handoff)` combinations render byte-identical markup, which pins today's Claude copy.
- The existing membership sweep is extended with the codex agent, and the allowed set gains the codex constant plus its two suffixed forms.
- The apostrophe and U+2026 check covers the new constant.

The container's store read is not reachable under a static render of the idle store. It is a single call to #1649's selector, and that selector is already unit-tested.

## Documentation handoff

None named by the ticket.
