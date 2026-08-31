# 870 — Decode the conversation a modal prompt belongs to

Mirror the daemon's `ModalShownPayload.ConversationID` (pyrycode#1065) into the desktop wire type and its
fail-closed decoder, so an outstanding permission prompt can be attributed to a conversation. Decode-only:
the field stops at `parseModalShownPayload`'s return value this slice. Carrying it across IPC is #871;
rendering the sidebar dot is #872.

## Files to read first

Codegraph is not indexed for this repo (`.codegraph/` holds `config.json` only; `codegraph_status` returns
"CodeGraph not initialized" — confirmed again 2026-09-01). This list was built by grep + Read instead.

| Path | What to extract |
|---|---|
| `src/shared/wire/types.ts:837-857` | The `ModalShownPayload` interface + its doc block. The **edit site** for AC 1 and for stale-comment fix (1). |
| `src/shared/wire/types.ts:859-902` | `ModalDismissedPayload` / `ModalAnswerPayload` / `ModalCancelPayload`. **Read to confirm you leave the field claims alone** — see § Do not over-correct. |
| `src/main/transport/inboundMessage.ts:1214-1244` | `parseModalShownPayload` — the single decode site. The `requireString` idiom you extend for AC 1 + AC 3. |
| `src/main/transport/inboundMessage.ts:306-312` | `requireString` — narrows one required string or throws `missing required field: <name>`. The field name is a literal; the *value* is never interpolated. |
| `src/main/transport/inboundMessage.ts:240-258` | The `InboundDaemonMessage` doc block. Line 256 is stale-comment fix (2). |
| `src/main/transport/inboundMessage.ts:1675-1689` | The `modal_shown` case: narrow-then-log. AC 4's regression guard lives here; **no code change needed**. |
| `src/main/daemonConnection.ts:1027-1044` | The `modal-shown` → `modalShown` emit. Line 1031 is stale-comment fix (5) — see § The fifth stale comment. |
| `src/main/daemonConnection.ts:486-494` | The decode-error catch: `catch { return }`, **silent by design**. Read it before reasoning about AC 3's failure mode. |
| `src/main/transport/inboundMessage.test.ts:380-392` | The shared `MODAL_SHOWN` fixture — **untyped**. Fixture site 1. |
| `src/main/transport/inboundMessage.test.ts:2994-3000` | The "drops unknown server keys" test. **It uses `conversation_id` as its example of an unknown key.** Must be inverted, not merely updated — see § The test that inverts. |
| `src/main/transport/inboundMessage.test.ts:3018-3090` | The fail-closed block. AC 3's new cases follow the two idioms already here (absent-field loop, non-string array). |
| `src/main/transport/inboundMessage.test.ts:3891-3920` | The content-free log test. AC 4 extends its secret list; the asserted key set is already exact. |
| `src/main/daemonConnection.test.ts:329-332, 3146-3210` | **Fixture sites 2 and 3 — the ones the ticket body's count of four misses.** The helper takes `unknown`, so `tsc` will NOT flag these. See § The fixture cascade. |
| `src/shared/wire/types.test.ts:632-660` | Fixture site 4 — a typed `ModalShownPayload` literal + its `toEqual` mirror. Both halves need the field. |
| `src/main/daemonConnection.roundtrip.test.ts:610-640` | Fixture site 5 — typed literal. `expectedModalShown` below it is a `DaemonEvent`, **not** the payload; leave it alone. |
| `e2e/permission-modal-answer-paths.spec.ts:64-82` | Fixture site 6 — `satisfies ModalShownPayload`. The helper's `opts` param does not need a new field; see § The fixture cascade. |
| `docs/knowledge/decisions/0009-modal-prompt-model.md:18-23, 51-53` | The two passages reasoning from the retired premise. **Not a developer deliverable** — see § ADR 0009. |
| `docs/knowledge/features/inbound-message-decode.md` | The package overview for this decode site. Read-only; the documentation phase folds this ticket in. |

Upstream SSOT (checked out at `~/Workspace/Projects/pyrycode`, verified 2026-09-01, do not reason from the doc alone):
`internal/protocol/messaging.go:104-112` (the struct) and `internal/protocol/testdata/modal_shown.json` (the golden fixture).

## Design source

N/A — pure wire-decode change. No renderer surface: the field is deliberately not forwarded across the IPC
bridge this slice, so nothing visual changes. The sidebar dot this chain ends in is #872's, and carries its
own Figma anchor.

## Context

`ModalShownPayload` gained `conversation_id` in pyrycode#1065 (merged 2026-07-17). Desktop's mirror stops at
`modal_id`, so a client following more than one conversation cannot tell which one raised an outstanding
prompt. This is the first of four slices ending in a yellow input-required dot on the sidebar row.

Verified against the daemon struct rather than the contract doc:

```go
type ModalShownPayload struct {
	ConversationID  string        `json:"conversation_id"` // (#1065)
	ModalID         string        `json:"modal_id"`
	...
}
```

First in wire order, no `omitempty`, always present. The golden fixture agrees:
`{"conversation_id":"conv-7f3a","modal_id":"mdl-7f3a",...}`.

**This does not loosen the inbound anti-forgery model.** `conversation_id` is outbound scoping only. A
`modal_answer` carries no conversation id and the daemon still resolves it against its own outstanding-modal
state — confirmed in the same file: `ModalAnswerPayload` and `ModalCancelPayload` are unchanged, `ModalID`-only.

## Design

### 1. The wire type (AC 1)

`ModalShownPayload` gains `conversation_id: string` as its **first** member, mirroring the struct's field order.
A required, non-optional string — no `?`, no `omitempty` analogue.

Its doc block loses the claim that no `conversation_id` is carried, and keeps the half that stays true. The
replacement must state three things, because all three are load-bearing downstream:

1. Wire order is now `conversation_id, modal_id, class, title, prompt, options, default_option_id`.
2. `conversation_id` is an **outbound routing/scoping key**: daemon-asserted from its own active-conversation
   cursor, for filtering display by conversation.
3. `modal_id` remains the **sole inbound correlation key** — an answer is resolved server-side against
   `modal_id` alone, and a client cannot assert which conversation an answer targets.

### 2. The decode (AC 1, AC 3)

`parseModalShownPayload` gains one narrow, first, matching wire order:

```ts
const conversation_id = requireString(payload, 'conversation_id')
```

and returns it as the first member of the object literal. That is the whole production change at this site —
`requireString` already gives AC 3 exactly: absent → throw, non-string → throw, category-only message naming
the field but never its value, and no partially-decoded frame escapes because the throw precedes the return.

Fail-closed is decided, not open (ticket § Technical Notes). No tolerant fallback, no `?? ''`, no optional field.

Its doc block's field count ("six fields") becomes seven, and gains one sentence: `conversation_id` is
narrowed like every other required string, and is **not** cross-checked against any known-conversation set —
that would be a scoping concern for #872, and this decoder polices type, not membership (the same posture it
already takes for `default_option_id ∈ options[].id`).

### 3. The emit is deliberately unchanged

`daemonConnection.ts:1035-1043` builds the `modalShown` `DaemonEvent` from named fields. It does not spread,
so the newly-decoded `conversation_id` is dropped there automatically and **no renderer-visible surface changes
this slice**. That is correct: the IPC event arm is #871's.

Do not add it to the emit. Do not add it to `DaemonEvent`. Do not touch `src/shared/ipc/events.ts`.

### 4. The fifth stale comment

The ticket body counts four stale comments and assigns two to this slice. There is a fifth, in a file this
slice must now touch anyway: `daemonConnection.ts:1031` asserts *"NO `conversation_id` to drop — a modal
carries none."* Both halves become false — one carries one, and this emit does drop it.

Correct it in this ticket. It is a one-line comment edit in the same function whose input type is changing, and
leaving it would make the emit read as a bug rather than as the deliberate deferral it is. The replacement must
say the field is now carried on the payload and is deliberately **not** forwarded until #871.

This brings the production-file count to three: `types.ts`, `inboundMessage.ts`, `daemonConnection.ts`
(comment-only). No logic changes in the third.

### 5. Do not over-correct the adjacent blocks

`ModalDismissedPayload`, `ModalAnswerPayload`, `ModalCancelPayload` genuinely carry no `conversation_id` —
re-verified against `messaging.go:114-156`. Their **field claims stay**. Two narrower edits are in scope:

- `ModalAnswerPayload`'s "**NO `conversation_id` rides a modal**" over-reaches once one rides `modal_shown`.
  Narrow it to "no `conversation_id` rides an *answer*" — the accurate and still-load-bearing claim.
- The shared rationale "the daemon hosts one active conversation" is the premise pyrycode#1065 retired. Where
  it appears as the *reason* for a still-true field claim, replace the reason (the daemon resolves `modal_id`
  against its own outstanding-modal state), keep the claim.

Do not add fields, do not restructure these interfaces.

## The fixture cascade — six sites, not four

The ticket body counts four typed literals. There are **six**, and the two it misses are the dangerous kind.

| # | Site | Typed? | Caught by `npm run typecheck`? |
|---|---|---|---|
| 1 | `inboundMessage.test.ts:381` `MODAL_SHOWN` | no (bare `const`) | **no** |
| 2 | `daemonConnection.test.ts:~3161` inline payload | no (`modalShownPlaintext(payload: unknown)`) | **no** |
| 3 | `daemonConnection.test.ts:~3199` out-of-enum-class payload | no | **no** — and see below |
| 4 | `types.test.ts:633` `const payload: ModalShownPayload` | yes | yes |
| 5 | `daemonConnection.roundtrip.test.ts:615` `const modalPayload: ModalShownPayload` | yes | yes |
| 6 | `e2e/permission-modal-answer-paths.spec.ts:81` `satisfies ModalShownPayload` | yes | yes |

Sites 1–3 fail **at runtime, not at build**. Their failure is confusing rather than obvious: the decoder throws,
`daemonConnection` swallows it, no event is emitted, and the assertion fails against an empty array — it reads
like a routing bug, not a missing fixture field. Add `conversation_id` to all six before running the suite.

Notes per site:

- **Site 3** already asserts a *drop* (out-of-enum `class`). It will still pass without the new field — for the
  wrong reason. Add the field anyway so it keeps testing the `class` enum rather than the missing-field path.
- **Site 4** has a literal *and* a mirrored `toEqual` object below it. Both halves need the field.
- **Site 5**: the `expectedModalShown` literal below it is a camelCase `DaemonEvent`, not the wire payload.
  **Leave it unchanged** — the emit drops the field (§ 3), so adding `conversationId` there would fail.
- **Site 6**: the helper's `opts` parameter needs no new member. Thread a fixed conversation id in, either as a
  module constant or a defaulted argument; the spec does not care which.

## The test that inverts

`inboundMessage.test.ts:2994`:

```ts
it('drops unknown server keys, keeping only the six known fields (forward-compat)', () => {
  const withExtras = { ...MODAL_SHOWN, conversation_id: 'conv-1', extra: 'ignore-me' }
```

This test uses `conversation_id` as its *example of an unknown key* and asserts it is dropped. After this
ticket the assertion is backwards. It must be **inverted**, not patched:

- Drop `conversation_id` from the `withExtras` spread (`extra: 'ignore-me'` alone carries the forward-compat
  point), and update the title's "six known fields" to seven.
- The now-carried field is covered by the recognition test below, which asserts the full payload verbatim.

Watch for the same "six fields" phrasing in the recognition test title at line 2962 and in the
`parseModalShownPayload` doc block.

## Error handling

Unchanged in shape. One new reject branch, on the existing path:

| Input | Behavior |
|---|---|
| `conversation_id` absent | `WireDecodeError('missing required field: conversation_id')` — thrown before any return |
| `conversation_id` non-string (number, `null`, object, array) | same |
| well-formed | carried verbatim into the returned `ModalShownPayload` |

At `daemonConnection.ts:490` the `WireDecodeError` is caught and the frame dropped with no event and **no log
line** — pre-existing, deliberate (the error message could echo plaintext), and repo-wide for every frame type.
See § Consequences for the operator-visible effect.

## Testing strategy

`npm test` (vitest, node environment — renderer specs are static renders and cannot click; irrelevant here,
this slice is entirely main-side). Scenarios, as bullets — the developer writes them in the file's existing idiom:

**Recognition** (`inboundMessage.test.ts`, existing describe at 2961)
- A full `modal_shown` narrows to `{ kind: 'modal-shown' }` carrying `conversation_id` verbatim alongside the
  other six fields. Covered by extending `MODAL_SHOWN` — the existing `toEqual(MODAL_SHOWN)` assertion then
  pins carry-through with no new test.
- The conversation id is carried verbatim for a value that is *not* a plausible conversation id (e.g. `'../../x'`,
  an empty string) — pinning "narrows type, does not police membership or shape."

**Fail-closed** (`inboundMessage.test.ts`, existing describe at 3018) — AC 3
- Add `'conversation_id'` to the absent-field loop at line 3040 (one-word change; it already iterates
  `['modal_id', 'title', 'prompt', 'default_option_id']`).
- Add `{ ...MODAL_SHOWN, conversation_id: 42 }`, `: null`, `: {}` to the non-string array at line 3045.
- Assert no partial escapes: a payload missing only `conversation_id` throws rather than returning a
  `modal-shown` — implied by `toThrow`, worth one explicit case if the file's idiom favours it.

**Content-free log** (`inboundMessage.test.ts:3891`) — AC 4, regression guard only
- Extend the existing test: set a `SECRET_CONVERSATION` id on the payload, add it to the loop that asserts no
  secret appears in the line. The exact-key assertion
  (`['bytes','code','event','hash','seq','ts']`) already holds and needs no change.
- The existing "does NOT log on a malformed `modal_shown` throw path" test (line 3944) covers the rejected
  frame leaving no record. Confirm it still passes; extending it to the new field is optional.

**Stream** (`daemonConnection.test.ts:3146`)
- The existing "carries all six camelCase fields" test keeps its expectation **unchanged** — no
  `conversationId` on the emitted event (§ 3). Only its *input* fixture gains the field. This is the test that
  pins the deliberate non-forwarding, so leave its assertion alone and consider renaming it to say so.

**Type shape** (`types.test.ts`) and **round-trip** (`daemonConnection.roundtrip.test.ts`)
- Fixture updates only; existing assertions carry the new field through.

**Build gate**: `npm run build` (typecheck + build) catches sites 4–6. `npm test` catches 1–3. Both must pass.
`npm run e2e` exercises site 6.

## ADR 0009 — amend, do not supersede

`docs/knowledge/decisions/0009-modal-prompt-model.md` reasons from the retired premise in two places:

- § Context, the first load-bearing bullet: *"no `conversation_id` is carried on a modal (the daemon hosts one
  active conversation…)"*.
- § The wire boundary: *"`conversation_id` is not carried because the **wire carries none**"*.

**Decision: amend.** The ADR's actual decision — an id-addressed `ModalPrompt` array, a pure `reduceModal`,
`modalId` as the correlation key for hold/clear — is untouched by pyrycode#1065. `conversation_id` is an
outbound *display-scoping* key, not a correlation key: it does not address a prompt, it filters which client
renders one. Superseding would replace a decision that is still entirely correct in order to fix two factual
premises. Amend the two passages, note pyrycode#1065 and this ticket as the cause, and leave § Decision,
§ Rationale and § Consequences alone.

**The amendment is not a developer deliverable.** It is a shared knowledge-base doc; the documentation phase
owns it and runs after code review on this branch. The developer's worktree mutates code, tests, and this spec
only. This section is the instruction that phase acts on.

## Consequences

- **The client now requires a daemon at or past pyrycode#1065** (2026-07-17). Against an older daemon every
  permission prompt is dropped at decode — no event, no log line, `claude` blocks with nothing on screen. The
  ticket accepts this trade explicitly; it is named here so it is diagnosable rather than mysterious. The silent
  drop is pre-existing and repo-wide (every required field on every frame type behaves this way), so adding
  telemetry to the drop path is out of scope for this slice.
- **`e2e/real-claude-permission-modal.spec.ts` drives a real daemon**, which supplies the field itself. No spec
  change; but the real-claude gate is now the first place a daemon-version regression would surface.
- **#871 and #872 unblock.** #871 carries the field across IPC (`events.ts` + the emit at
  `daemonConnection.ts:1035`, whose comment this slice leaves pointing at it); #872 consumes it in the store.

## Open questions

None blocking. One judgment call is left to the developer: whether site 6 threads its conversation id as a
module constant or a defaulted helper argument. Either satisfies the spec.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The boundary is a single named function, `parseModalShownPayload`
  (`inboundMessage.ts:1226`) — the field is narrowed there and nowhere else, and `requireString` is the same
  narrowing every sibling field already uses. Downstream signal is the type: consumers hold a
  `ModalShownPayload`, never a raw record. **SHOULD FIX, forwarded to #872:** `conversation_id` is
  daemon-asserted, but the desktop must treat it as untrusted *display-scoping* input, never authorization.
  Concretely, when #872 matches it against the sidebar: compare by equality against an existing keyed set
  (`Map.get`, a `===` scan) — never `obj[conversation_id] = …`, which is the prototype-pollution shape, and
  never as a path segment, filename, or cache key (CLAUDE.md's daemon-text rule). This slice reaches none of
  those sinks; the constraint is recorded so the consuming slice inherits it.
- **[Tokens, secrets, credentials]** No findings. The field is not a credential and confers no authority. The
  one-time `modal_id` nonce and the client-minted `answer_token` are untouched; no storage, rotation, or
  revocation surface changes. The inbound anti-forgery model is unchanged and re-verified against
  `messaging.go:114-141`: `ModalAnswerPayload` / `ModalCancelPayload` carry `ModalID` only, so a client still
  cannot assert which conversation an answer targets.
- **[File / storage operations]** No findings, by design rather than by luck: the decoded value's entire
  lifetime this slice is one field of an in-memory struct that the emit then drops (§ 3). It reaches no
  `path.join`, no `fs` call, no cache key, and no disk. Recorded here because § Trust boundaries forwards that
  constraint to the slice where it stops being automatic.
- **[Inter-process / Electron attack surface]** No findings. This slice adds **zero** IPC surface — the field
  is deliberately not forwarded across `contextBridge`, so the renderer cannot observe it at all until #871.
  No new `ipcMain` channel, no new bridge member, no `webPreferences` change. The transport stays main-side.
- **[Cryptographic primitives]** N/A with a concrete reason: no handshake, key, nonce, or AEAD code path is
  touched. `hashPlaintext` at the log site is unchanged and still hashes the whole frame, not a field.
- **[Network & I/O]** No findings. The frame-level size guard at `parseInboundMessage` (`inboundMessage.ts:1279`)
  runs before decode and bounds every field transitively; `conversation_id` inherits it exactly as `title` and
  `prompt` do. Adding a required field cannot increase the accepted frame size. No socket, timeout, TLS, or
  reconnect behavior changes. Considered and rejected as unnecessary: a per-field length cap, which no sibling
  field has — adding one only here would be an inconsistent defense against an unobserved failure.
- **[Error messages, logs, telemetry]** No findings; AC 4 is the pin. The log record at
  `inboundMessage.ts:1682` is a fixed literal of `event / code / bytes / hash` — no payload field can reach it
  structurally, and the narrow-before-log ordering means a rejected frame leaves no record at all. The new
  reject message is `missing required field: conversation_id`: the field **name** is a client-owned literal and
  the offending **value** is never interpolated, matching `requireString`'s category-only contract. The
  `WireDecodeError` is additionally dropped unread at `daemonConnection.ts:490`, so it cannot reach a log or an
  event even indirectly.
- **[Concurrency]** N/A with a concrete reason: `parseModalShownPayload` is a synchronous pure function over an
  already-decrypted buffer. No task, timer, listener, `await`, or shared mutable state is introduced, so there
  is nothing to cancel, race, or leak on teardown.
- **[Threat model alignment]** The applicable threat is **hostile / buggy daemon response**, and fail-closed
  narrowing is the answer AC 3 asks for — a malformed frame is rejected whole, never partially decoded.
  **Malicious relay:** it is content-blind and on-path; AEAD integrity means it can drop or reorder whole frames
  but cannot strip a field to trigger the new reject branch selectively, and whole-frame dropping was already
  available to it. **Renderer compromise:** unreachable — no renderer-visible surface is added.
  **Availability, considered and classified OUT OF SCOPE:** a daemon predating pyrycode#1065 makes every
  permission prompt vanish silently. Not exploitable (it requires a genuinely old daemon, not an attacker), not
  new (identical to every existing required field on every frame type), and the fix — telemetry on the shared
  silent-drop path at `daemonConnection.ts:490` — is a repo-wide change well outside an XS slice. Named in
  § Consequences so it is diagnosable; it belongs to a future drop-path-observability ticket, not this one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-09-01
