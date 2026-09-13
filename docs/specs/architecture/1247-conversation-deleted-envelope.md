# Conversation deletion envelope vocabulary

## Files read
- `src/shared/wire/types.ts` — `EnvelopeType` omits the already-supported reply.
- `src/shared/wire/types.test.ts` — the `turn_state` membership test supplies the pattern.
- `src/main/transport/inboundMessage.ts` — `parseInboundMessage` already decodes and logs deletion replies.
- `docs/knowledge/features/wire-codec.md` and `development-verification.md` — wire contracts and typecheck evidence.

## Change
Add `conversation_deleted` beside `delete_conversation` in `EnvelopeType`, correcting the declaration to match existing protocol support. Add one typed membership assertion beside the existing vocabulary tests. No runtime, logging, state, or consumer changes are needed. Codegraph was unavailable; source reads supplied context. The refreshed feature-branch overlap check found none. One deliverable, one production file, approximately 30 total added lines including this plan, zero new exports, zero consumer updates, one acceptance criterion, and zero new error branches fit the ticket boundary.

## Testing strategy
First add the test and run the node TypeScript check: assignment to `EnvelopeType` must fail while the member is absent. Then add the member and run `npm test -- src/shared/wire/types.test.ts` and `npm run build`. Vitest alone cannot prove type membership. No UI or open design questions.

## Documentation handoff
No documentation requirement was specified by the ticket.
