# #1649 — decode and hold each conversation's and model row's agent

## Files read

- `src/shared/wire/types.ts` → `ConversationSummary`, `ConversationCreatedPayload`, `WireModelOption` — the three shapes gaining optional keys; the file already exports runtime constants, so the one mapping helper can sit beside the type it returns.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`, `parseConversationCreatedPayload`, `parseConversationUpdatedPayload`, `parseModelOption` — the fresh-literal narrowers that drop unknown keys today; `requireString` is the type check to reuse.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot` (the `kind: 'list'` arm) and its `optional` / `string` helpers — the saved offline list; `is_muted` (#1594) is the precedent for an optional row key.
- `src/renderer/src/store/chatHistoryWriter.ts` → the `kind: 'list'` capture — copies rows verbatim, so the saved list gains `agent` with no writer change.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationsFor` — the origin-scoped read the new selector projects, and its "call it with a client-held id" rule.
- `src/renderer/src/store/pushNotifyBridge.ts` → `conversationRowIn` / `conversationMutedIn` — the shipped server-scoped row lookup the selector mirrors (`byServer.get(origin)?.find(...)`).
- `src/renderer/src/store/modelListStore.ts` — holds `WireModelOption` rows verbatim, so decoding is enough to hold `agent` / `family`.

## Design source

N/A — no UI change. The ticket decodes and holds data; no surface reads it yet.

## Context

The daemon tags conversations and model rows with their agent for a client advertising `multi_agent` (pyrycode#2643, #2647, #2651, #2669). This app does not advertise it yet, so today every key is absent; this ticket makes the decode and the hold ready so a later ticket can flip the capability.

## Design

**Type and helper (`src/shared/wire/types.ts`).**

- `export type WireAgent = 'claude' | 'codex'`.
- `export function agentFromWire(raw: string | undefined): WireAgent` — `'codex'` only for the exact string `codex`, `'claude'` for anything else including `undefined`. The one mapping; used by the narrowers, the saved-list parse and the selector. The raw daemon string never survives it, so no raw agent text is ever held or rendered.
- `ConversationSummary.agent?: WireAgent`, `ConversationCreatedPayload.agent?: WireAgent`, `WireModelOption.agent?: WireAgent` and `WireModelOption.family?: string`. Optional because an old daemon or a client without the capability sends no key. `family` is daemon text: equality comparison only, never an object key, never logged.

**Narrowers (`inboundMessage.ts`).** In `parseConversationSummary`, `parseConversationCreatedPayload` and `parseModelOption`: an absent (`undefined`) key stays absent — the returned literal gains the key only through a conditional spread, so an untagged frame decodes to exactly the object it did before (`toStrictEqual`). A present key must pass `requireString` (a non-string fails the frame closed with the existing category-only message); `agent` then maps through `agentFromWire`, `family` is kept as sent. A small local `optionalAgent(payload)` helper keeps the three sites one line each. `parseConversationUpdatedPayload` is unchanged: it already builds a fresh literal, so a carried `agent` is dropped — proven by a test, per AC2.

**Saved list (`chatHistory.ts`).** The `kind: 'list'` row gains `agent` via the same conditional spread: absent stays absent (a pre-#1649 saved row restores as before), present must be a string and maps through `agentFromWire`, a non-string rejects the snapshot like any other bad field.

**Selector (`conversationListStore.ts`).** `selectConversationAgentFor(origin: ConversationListOrigin, conversationId: string) => (s) => WireAgent` — finds the row in `selectConversationsFor(origin)(s)` and returns `agentFromWire(row?.agent)`. Same client-held-origin rule as `selectConversationsFor`; a primitive return, so it is a stable `useConversationListStore` read surface. An unknown id, an unloaded slot or an absent agent answer `'claude'`.

## State + concurrency model

No new state or async work. Rows are held where they already are (`conversationListStore.byServer`, `modelListStore`); the agent rides on the row.

## Error handling

A non-string `agent` or `family` fails the frame (or saved snapshot) closed through the existing `WireDecodeError` / `INVALID_CHAT_HISTORY` paths. An unknown agent string is not an error: it holds as Claude.

## Testing strategy

Vitest only, beside the existing specs:

- `types.test.ts` — `agentFromWire`: `codex` → codex; `claude`, `Codex`, `codex ` , `''`, `undefined` → claude.
- `inboundMessage.test.ts` — conversations row and created reply: `codex` holds as codex, `claude` and an unknown string hold as claude, an absent key decodes `toStrictEqual` the untagged result, a non-string (`1`, `null`, `{}`) throws. `conversation_updated` with `agent` decodes `toStrictEqual` the same frame without it. `model_list` row: `agent` mapped, `family` kept verbatim, absent both decodes as today, non-string either throws.
- `chatHistory.test.ts` — a saved row keeps `codex`, an unknown string restores as claude, a row with no agent restores with no key, a non-string rejects.
- `conversationListStore.test.ts` — the selector answers codex for a codex row, claude for an absent agent, an unknown id and an unloaded slot, and does not read a same-id codex row filed under another origin.

## Documentation handoff

Pending for the documentation stage: the ticket names none; the relevant package overviews (wire decoding, conversation list) may want a note that `agent` / `family` are decoded and held but not yet advertised.

## Open questions

None.
