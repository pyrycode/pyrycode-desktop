# Spec: `conversationStateFake` — stateful reply factory for per-flow list-mutation e2e (#434)

## Design source

N/A — test infrastructure. The demonstrating spec drives EXISTING product UI (the #141 Channel
List + #360 Rename dialog); no new visual surface is introduced, so there is no Figma node and the
code-review visual-fidelity check is intentionally skipped.

## Files to read first

- `e2e/fixtures/launchPairedApp.ts` (whole file, ~213 lines) — the factory fixture this rides. Note
  lines 60–83 (`SEEDED_ROW` / `seedConversationsFrame()` — the one-row default seed pattern to
  mirror), lines 138–143 (a caller's `buildReplyFrames` OVERRIDES the default `buildReply`, so the
  factory OWNS seeding), and lines 189–197 (the drive clicks `.channel-list__row-open` then waits for
  Send — a clickable row exists only if the initial `list_conversations` reply is non-empty).
- `e2e/send-and-stream.spec.ts:59–75` — the `buildReplyFrames = (inbound) => switch(decodeEnvelope(inbound).type)`
  dispatch idiom this fixture generalizes; the `default` arm and multi-frame-stream shape.
- `e2e/real-daemon-rename.spec.ts` (whole file, ~100 lines) — the demonstrating spec's proven drive
  (pencil → dialog → fill → Save) and its new/old-title assertion. The #434 demonstrating spec is
  this drive against the FAKE (via `launchPairedApp`) instead of a real daemon, plus one back-nav.
- `src/shared/wire/types.ts:504–791` — the exact reply/request payload shapes and field orders:
  `ConversationSummary` (523), `ConversationsPayload` (535), `ConversationCreatedPayload` (588,
  `cwd` before `name`), `ConversationUpdatedPayload` (767, `name` before `cwd`),
  `ConversationDeletedPayload` (789, bare `{ id }`), and the outbound payloads
  `Create/Rename/Archive/Unarchive/Delete/Promote/ChangeWorkspace` (570–715).
- `src/renderer/src/store/conversationListBridge.ts:35–49` — `shouldRefreshList`: the app auto
  re-requests `list_conversations` on `conversationUpdated` (broadcast) AND `conversationDeleted`
  (correlated). This is why every mutation reply is followed by a fresh `list_conversations` the
  fixture must answer from UPDATED state.
- `src/renderer/src/store/conversationCreatedBridge.ts:41–95` — `conversationCreated` drives list→thread
  nav (NOT a re-list); the created row surfaces on the next `list_conversations`.
- `src/main/transport/deleteConversationEnvelope.ts` (whole, ~50 lines) — confirms the outbound
  `delete_conversation` envelope carries a numeric `id`; the daemon echoes it as `in_reply_to` on
  `conversation_deleted`. `src/main/daemonConnection.ts:406` — `nextEnvelopeId` (monotonic from 2) is
  the request `id` the fixture reads off the decoded inbound for delete correlation.
- `src/main/transport/codec.ts` — `encodeEnvelope` / `decodeEnvelope` (the production framing the
  fixture MUST use, exactly as `send-and-stream`); confirm `Envelope.in_reply_to` is an accepted field.
- `src/renderer/src/screens/channels/ChannelList.tsx:247–342` — `partitionByPromotion` routes
  `is_promoted:true` rows to the Channels section, which render the `.channel-list__rename` pencil;
  discussion rows do NOT. The demonstrating seed MUST be promoted (see § Demonstrating spec).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` (`BackControl`,
  `className="conversation__back"`, `aria-label="Back"`) — the thread→list back affordance the
  demonstrating spec clicks after `launchPairedApp` lands it in the thread.
- Reference (do not re-read fully): `docs/knowledge/*` — no relevant pitfall beyond what is inlined here.

## Context

The fake daemon (`src/main/transport/fakeDaemon.ts`) is reply-driven and **stateless**: a run passes
`buildReplyFrames` (an ordered `Uint8Array[]`, each sealed as its own `noise_msg`), which takes
precedence over `buildReply`. Per-flow UI e2e specs (the #422–#429 family, natively blocked-by this
ticket) need a fake that **holds** a conversation list and mutates it, instead of each re-transcribing
the wire semantics: apply the mutation to the held list, emit the mutation reply, and answer the
app's auto-fired follow-up `list_conversations` from the updated state.

This factory is consumed through `launchPairedApp` (child A, #433, merged): a spec passes the produced
`buildReplyFrames` straight through to `startFakeDaemon`. Two properties drive the design:

1. **The factory OWNS every inbound.** Because a scripted `buildReplyFrames` overrides the fixture's
   default `buildReply` seed, the factory must answer the initial connected-edge `list_conversations`
   with ≥1 row — else `launchPairedApp`'s row click (`.channel-list__row-open`) has nothing to click
   and the launch hangs (the "non-empty seed is load-bearing" constraint).
2. **Two reflect paths.** `rename`/`archive`/`unarchive`/`promote`/`change_workspace` reply an
   unsolicited `conversation_updated` broadcast (the app auto re-lists via `shouldRefreshList`);
   `delete_conversation` replies a CORRELATED `conversation_deleted { id }` echoing the request `id`
   as `in_reply_to` (also auto re-lists); `create_conversation` replies `conversation_created { record }`
   (consumed by the create→nav bridge; the new row surfaces on the next `list_conversations`).

## Design

One new fixture module, `e2e/fixtures/conversationStateFake.ts` (test-only; imports the production
`codec` + wire types via RELATIVE paths — `../../src/...` — exactly like `launchPairedApp.ts`, since
the `@shared` alias is not available to e2e and e2e is not part of any tsconfig).

### Public contract

```ts
export interface ConversationStateFakeOptions {
  // Initial held list, in wire order. Default: a single promoted, named row (DEFAULT_SEED) so a
  // zero-config fake both launches (non-empty seed) and renders the rename pencil.
  conversations?: ConversationSummary[]
}

// Returns the FakeDaemonOptions.buildReplyFrames shape: a stateful closure over the held list.
export function conversationStateFake(
  options?: ConversationStateFakeOptions
): (inboundPlaintext: Uint8Array) => Uint8Array[]
```

Usage in a spec: `const buildReplyFrames = conversationStateFake({ conversations: [SEED] })` then
`await launchPairedApp({ buildReplyFrames })`. Return the bare function (AC1's wording), not an
options object — the spec composes it into `launchPairedApp`'s options itself.

### Reply dispatch (the closure body)

Decode the inbound once (`const env = decodeEnvelope(inbound)`), switch on `env.type`, mutate the
held `list` in place, and return the reply frames. Input is TRUSTED (the app's own well-formed
outbound envelopes), so payloads are read with a per-verb cast to the known outbound payload type —
NOT the fail-closed narrowing of the production inbound decoder (this is a fake; keep it lean, the
`send-and-stream` posture). Behaviour per arm (all frames built with `encodeEnvelope`):

| inbound `type` | mutation on held list | reply frame(s) |
|---|---|---|
| `list_conversations` | none | `[conversationsFrame(list)]` |
| `create_conversation` | append a fresh row minted from the payload (see below) | `[conversationCreatedFrame(row)]` |
| `rename_conversation` | row.name = payload.name | `[conversationUpdatedFrame(row)]` |
| `archive_conversation` | row.is_archived = true | `[conversationUpdatedFrame(row)]` |
| `unarchive_conversation` | row.is_archived = false | `[conversationUpdatedFrame(row)]` |
| `promote_conversation` | row.is_promoted = true; row.name = payload.name; row.cwd = payload.cwd | `[conversationUpdatedFrame(row)]` |
| `change_workspace` | row.cwd = payload.cwd | `[conversationUpdatedFrame(row)]` |
| `delete_conversation` | remove the row | `[conversationDeletedFrame(id, inReplyTo: env.id)]` |
| _default_ | none | `[]` (no-op — a genuinely-other verb, e.g. a snapshot request on thread entry, needs no reply for these flows; returning `[]` sends nothing, safe) |

The five mutation verbs above (rename/archive/unarchive/promote/change_workspace) find their row by
`payload.conversation_id`. **Row-not-found is a defensive no-op:** if the id is absent from the held
list, skip the mutation and return `[]`. The demonstrating spec (and the #422–#429 family) always
targets a seeded row, so this defends an unobserved path without adding reject-branch machinery —
do NOT model daemon rejections here (out of scope; that is a per-flow spec's own concern).

### Frame builders (private helpers)

Each builder projects the held 7-field `ConversationSummary` onto the exact wire reply shape and field
order — this is the load-bearing fidelity, so match `src/shared/wire/types.ts` precisely:

- `conversationsFrame(list)` → envelope `type: 'conversations'`, `payload: { conversations: list }`
  (`ConversationsPayload`).
- `conversationUpdatedFrame(row)` → `type: 'conversation_updated'`, payload is the **5-field**
  `ConversationUpdatedPayload` — `{ id, is_promoted, name, cwd, last_used_at }`, `name` BEFORE `cwd`,
  and deliberately WITHOUT `is_archived` / `last_message_ts` (the daemon omits them; the held row
  keeps them for the follow-up list). No `in_reply_to` — it is a broadcast.
- `conversationDeletedFrame(id, inReplyTo)` → `type: 'conversation_deleted'`, payload the bare
  `{ id }` (`ConversationDeletedPayload`), envelope `in_reply_to: inReplyTo` (the request `env.id`).
- `conversationCreatedFrame(row)` → `type: 'conversation_created'`, payload the **5-field**
  `ConversationCreatedPayload` — `{ id, is_promoted, cwd, name, last_used_at }`, `cwd` BEFORE `name`
  (the intentional reorder vs. `conversation_updated`).

Reply envelope `id` / `ts` are fixed deterministic literals (the `fakeDaemon` HELLO_ACK_ID/TS
convention — no `Date.now()` / randomness); the app inspects neither, except `conversation_deleted`'s
`in_reply_to`, which echoes the request id.

### Minting a created row

`create_conversation` payload is `CreateConversationPayload { is_promoted, name, cwd }` (each
nullable-and-present). Mint a full `ConversationSummary`: `id` from a closure-held monotonic counter
(`'created-1'`, `'created-2'`, … — deterministic, no clock/random), `is_promoted`/`name`/`cwd` taken
from the payload with the daemon-default fallback (`false` / `null` / a fixed default cwd when the
payload sends `null`), `is_archived: false`, `last_message_ts` / `last_used_at` the fixed ts literal.
Append it to the held list; the `conversation_created` reply projects its 5 fields.

## State + concurrency model

- **Single source of state:** the closure holds one mutable `ConversationSummary[]` (`list`) plus one
  `nextCreatedId` counter. There is no store, no React — this is Node-side test infra riding the
  fake daemon in `src/main`. `list` order is preserved (append on create; in-place edit otherwise),
  so `list_conversations` reflects wire order.
- **No concurrency:** `fakeDaemon.handleTransport` processes inbound frames serially on the single WS
  `message` handler and calls `buildReplyFrames` synchronously; the closure never awaits. No locking,
  no races. Each mutation is applied before its reply frame is built, so the follow-up
  `list_conversations` (a separate later inbound) reads the already-updated `list`.
- **Lifetime:** the fixture holds no resources; teardown is `launchPairedApp`'s (app→daemon→forwarder→
  userDataDir LIFO). Nothing to close here.

## Error handling

- **Trusted input:** inbound is the app's own outbound, always a well-formed envelope. `decodeEnvelope`
  throwing would be a genuine bug in the app-under-test, not a case to swallow — let it surface (the
  fixture does not fail-closed; that is the production decoder's job, not a fake's).
- **Unknown verb → `[]`** (no reply). Safe: `fakeDaemon` sends nothing and still settles `ok:true`.
- **Row-not-found → `[]`** (defensive no-op, see Design). No thrown error, no reject frame.
- **Log-free** by construction (the `fakeDaemon` convention): no `console.*`, no payload/id bytes in
  any diagnostic. All observable behaviour is the spliced reply frames.

## Demonstrating spec

New file `e2e/conversation-state-fake.spec.ts` (name does NOT match `real-*.spec.ts`, so it runs under
the default `npm run e2e`, excluded from `e2e:real-claude`). It reuses `real-daemon-rename.spec.ts`'s
proven drive against the FAKE, with one added back-nav because `launchPairedApp` lands in the thread.

Seed: one **promoted, named** row (e.g. `name: 'Original channel'`, `is_promoted: true`,
`is_archived: false`, fixed cwd/ts). Promoted so `partitionByPromotion` renders the
`.channel-list__rename` pencil; named so the old-title assertion is crisp. **Rename is the chosen
scenario deliberately** — it keeps the row in the active list (only the title changes), so the
assertion is unambiguous. Do NOT demonstrate archive: `partitionByPromotion` does not filter
`is_archived`, so an archived row does not leave the active list (latent #366 behaviour) — an
"archived row gone from list" assertion is unrealizable and is exactly the #440 trap.

Scenario (bullet steps, developer writes the Playwright code in-idiom):

- `const buildReplyFrames = conversationStateFake({ conversations: [SEED] })`; `const { page } = await launchPairedApp({ buildReplyFrames })`.
  The launch drive answers the connected-edge `list_conversations` from the seed → the promoted row
  is clickable → the drive enters the thread and Send enables (the fixture's completion signal).
- Click `.conversation__back` (`aria-label="Back"`) → route flips to `list`; the app-singleton
  conversation-list store is already populated, so the promoted row renders with its rename pencil.
- Click `.channel-list__rename` → the Rename dialog (`.rename-conversation`) opens.
- `.rename-conversation__input`.fill(NEW_TITLE) (a fixed literal ≠ the seed name); click
  `.rename-conversation__save`. This sends `rename_conversation`.
- Assert `.channel-list` `getByText(NEW_TITLE, { exact: true })` is visible (auto-waits the full
  round-trip: command → fake applies rename to held state → `conversation_updated` broadcast →
  `shouldRefreshList` → re-request `list_conversations` → fake answers from UPDATED state → re-render).
- Assert `.channel-list` `getByText('Original channel', { exact: true })` has count 0 (old title gone).

`npm run e2e` stays green. This single scenario exercises: the non-empty-seed launch, the
`list_conversations`-from-state answer, the `conversation_updated` broadcast reflect path, and the
re-list-from-updated-state loop — the fixture's core contract. The other six verbs are covered by the
uniform mutation-apply + the field-exact frame builders (type-level fidelity); their end-to-end
exercise is the job of the #422–#429 per-flow specs this fixture unblocks.

## Testing strategy

- **e2e (Playwright, `npm run e2e`):** the demonstrating spec above is the behavioural coverage.
  Playwright transpiles `e2e/` at runtime (esbuild), so a type error in the fixture surfaces as a
  runtime failure there, not at `npm run build` (neither `tsconfig.node.json` nor `tsconfig.web.json`
  includes `e2e/` — confirmed). Keep imports RELATIVE (`../../src/...`); the `@shared` alias is not
  resolvable in e2e.
- **No vitest unit test:** the fixture lives under `e2e/`, outside the vitest `include` glob, and its
  logic is a thin stateful wrapper over the production `codec`. Its correctness is pinned by (a) the
  e2e scenario and (b) the wire types it must project onto — do NOT relocate any of it under `src/`
  to make it vitest-reachable (that would drag test-only crypto/socket-free infra into the production
  graph and violate the fakeDaemon TEST-ONLY boundary).
- **Salvage/QA gate:** `npm run build` (typecheck src + build) must stay green — trivially, since this
  ticket adds no `src/` code. `npm run e2e` is the acceptance gate for AC3.

## Open questions

- **Reply envelope `id` uniqueness.** The app does not dedupe `conversations` replies by envelope id,
  so a single fixed literal is safe. If a future consumer ever correlates a broadcast by envelope id,
  switch the reply `id` to the same closure counter used for created rows. Not needed now.
- **`change_workspace` cwd reflection surface.** The demonstrating spec renames; a change-workspace
  per-flow spec (#422–#429) will assert the workspace chip / list cwd. The fixture already applies
  `row.cwd` and re-lists, so that spec needs only its own selectors — flagged so the downstream
  architect knows the reflect path is already wired here.
