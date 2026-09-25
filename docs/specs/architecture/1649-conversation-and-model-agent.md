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

## Revisions

- **2026-09-25 — security review added (verifier finding, MUST FIX).** The ticket carries `security-sensitive`, and the plan committed without the `## Security review` section the label requires. The pass below was run against the design and the shipped diff. It found nothing that changes the design or the code, so the contract above stands as written.
- **2026-09-25 — active-conversation re-seed carries `agent` (verifier finding, MUST FIX).** A fifth production file, missed from Files read: `src/renderer/src/store/activeConversationReseedBridge.ts` → `reseededActiveConversation`, the last fresh `ConversationCreatedPayload` literal. The created reply and a clicked row reach `activeConversationStore` whole, so the open chat's snapshot holds `agent`; on a re-list that moved another field, this function rebuilt the snapshot without it, so an open Codex chat read as Claude after a rename (AC2). New contract: `row.agent === active.agent` joins the unchanged check, so an agent-only change re-seeds, and the rebuilt literal carries `agent` through the same conditional spread as the narrowers, so an untagged row re-seeds to exactly the previous six-key literal. Tests in `activeConversationReseedBridge.test.ts`: a tagged row keeps its agent, an agent-only change re-seeds, and an untagged row re-seeds `toStrictEqual` the untagged literal with no `agent` key. Security: the value was already narrowed to `WireAgent` by `parseConversationSummary`; nothing renders, logs or keys on it. The verifier's NIT on the stale "fresh 5-field" comment in `daemonConnection.ts` is left alone, since that file is not otherwise touched.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Daemon frames cross into trusted state at exactly two decoders: `parseConversationSummary` / `parseConversationCreatedPayload` / `parseModelOption` in `inboundMessage.ts` (main process, after the Noise session), and `parseChatHistorySnapshot` in `chatHistory.ts` (disk → memory). Both reuse the same fail-closed primitives (`requireString`, the saved list's `string`). `agent` is narrowed through the one helper `agentFromWire` at every hold site (live row, create reply, model row, saved row) and again at the one read site (`selectConversationAgentFor`), so the type `WireAgent` is a closed two-value union and no daemon agent string is ever held, in memory or on disk.
- [Daemon text: rendering, logs, keys] No findings. Nothing renders `agent` or `family`: no component reads either field in this ticket, and `agent` is not daemon text once held — it is a client-owned constant (`'claude'` / `'codex'`). `family` is held verbatim, documented on `WireModelOption.family` as equality-only, never an object key, lookup path or log. No new log call: the `inbound-decoded` events in `parseInboundMessage` carry only event code, byte length, count and plaintext hash. No new `Map` / object keyed by either value; the selector filters by the client-held conversation id.
- [Error messages] No findings. A non-string `agent` / `family` throws `WireDecodeError('missing required field: agent' | 'family')` from `requireString` — the field name, never the value or a row index. A bad saved row throws the constant `INVALID_CHAT_HISTORY`, which carries no content.
- [Length bounds] No findings. `agent` needs none: it is collapsed to a two-value union before it is held. `family` is not length-bounded client-side, deliberately and consistently with its siblings: `parseModelOption`'s contract takes no per-string bound (the daemon bounds model-row strings and reports cuts in `truncated_fields`), and `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard backstops the whole frame. `family` is also never persisted — the saved offline list (`chatHistory.ts`) holds conversation rows only, not model rows — so there is no at-rest growth path.
- [Fail-closed decoding] No findings. A present non-string `agent` or `family` (number, `null`, object) rejects the whole frame or the whole saved snapshot, as the neighbouring fields do; tests cover `1`, `null` and `{}`. An absent key stays absent through a conditional spread, so an untagged frame decodes to exactly the previous literal (asserted with `toStrictEqual`, which `toEqual` would not catch). An unknown agent string is not an error and holds as Claude, per AC1.
- [Stale / spoofed agent via update] No findings. `parseConversationUpdatedPayload` still builds a fresh literal without `agent`, so an update frame cannot clear or change a held agent (AC2, tested); the agent changes only from a list row or a create reply.
- [Cross-server confusion] No findings. `selectConversationAgentFor` reads only `origin`'s own slot through `selectConversationsFor`, so a same-id row filed under another paired server is never consulted (tested).
- [Tokens / secrets, crypto, file operations, Electron surface, network, concurrency] Not applicable — the design adds no token, key, RNG use, file path, IPC channel, `webPreferences` change, socket or async task. The saved list rides the existing chat-history persistence path unchanged; the model rows ride the existing model-list IPC event unchanged.
- [Threat model] OUT OF SCOPE — advertising `multi_agent`, and every surface that reads the agent (menus, Codex-specific behaviour), belong to later tickets; each will run its own pass when it starts rendering or branching on these values. A hostile daemon can at most mislabel a conversation's agent, which today changes nothing observable.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
