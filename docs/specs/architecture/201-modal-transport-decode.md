# Spec #201 — Decode `modal_shown` / `modal_dismissed` into typed `DaemonEvent` arms

**Size:** S · **security-sensitive** · Transport slice of the modal vertical (ADR 0009). First of six
slices: **#201 (this, transport)** → #223 (store + bridge) → #224 (interactive render) → #225 (answer
path) → #226 (second-confirm) / #227 (surface rejection). Wires the missing wire → transport → bridge
chain so the two inbound modal frames stop dropping at `parseInboundMessage`'s `default →
inbound-unmodeled → null` and instead cross IPC as typed camelCase `DaemonEvent` arms. **No store, no
render, no `interactive` flip.** No UI surface (main-process transport + IPC types + two renderer bridge
cases), so there is **no Figma / Design source section**.

This is a near-exact **structural clone of #214 (turn_state) and #217 (tool_use)** — the same
wire → `inboundMessage.ts` decode → `InboundDaemonMessage` kind → `daemonConnection.ts` emit →
`DaemonEvent` arm → both renderer bridges chain — scaled to **two** inbound frames, with **two** new
twists:

1. **Two closed wire enums** (`class` ∈ `permission | trust`, `source` ∈ `remote | local | timeout`) get
   the `role`/`state` single-comparison enum check, **not** a bare `requireString` (the #214 precedent,
   now applied twice).
2. **A nested ordered array of objects** (`options: [{ id, label }]`) — decoded with a per-element
   narrower mapped over the array, exactly like `parseConversationsPayload` maps `parseConversationSummary`
   (#139) / `parseMessageChunkPayload` maps `parseMessagePayload`.

Unlike #214, **neither renderer bridge owns these arms** — both `daemonEventBridge` (session) and
`timelineBridge` (timeline) return `null`; the real consumer is a **third** bridge + modal store landing
in **#223**. This slice stops at the `DaemonEvent` arm crossing IPC.

## Files to read first

Read these before writing a line. The whole design is "clone the `tool_use` chain (#217) for two more
inbound frames, apply the `state`-enum check (#214) to `class` and `source`, and map a per-option
narrower over `options` (the `conversations` array pattern, #139)."

- `docs/knowledge/decisions/0009-modal-prompt-model.md` — **read end-to-end first.** The ADR that shipped
  the renderer-side model this vertical folds into (#122). It fixes the wire contract, the `ModalEvent`
  target shape the #223 bridge maps onto, and the two load-bearing facts: **`modal_id` is the sole
  correlation key (no `conversation_id` on a modal)** and **`class` is `permission | trust` only (no
  `destructive` wire class)**.
- `src/renderer/src/store/modalPrompts.ts:11-47` — **the target contract (#122).** `ModalClass`
  (`permission | trust`), `ModalOption` (`{ id, label }`), and the `ModalEvent` union
  (`shown{modalId, class, title, prompt, options, defaultOptionId}` / `dismissed{modalId, outcome,
  source: 'remote'|'local'|'timeout'}`). The `DaemonEvent` arm field names/types **mirror these** so the
  #223 bridge is a thin rename — `class` is kept as-is (a legal reserved-word property, ADR 0009 § "class
  is a legal reserved-word property").
- `docs/knowledge/codebase/214.md` (and `docs/specs/architecture/214-decode-turn-state-phase.md`) — the
  direct precedent chain. #201 is #214 plus a second frame and a nested array. The "Scope self-check" and
  "Security review" sections there map onto this one almost verbatim.
- `src/shared/wire/types.ts:180-218` — **the enum + payload declaration precedent.** `WireTurnState`
  (180-186) is the closed-wire-enum shape `WireModalClass` / `WireModalSource` mirror; `TurnStatePayload`
  (188-199) and `ToolUsePayload` (201-218) are the doc-comment + interface style (name the SSOT, "no
  `omitempty`") to mirror for the two modal payloads.
- `src/shared/wire/types.ts:40-59` — `EnvelopeType` union (add `'modal_shown'` and `'modal_dismissed'`).
- `src/shared/wire/types.ts:240-254` — `ConversationSummary` + `ConversationsPayload`: the **nested-object
  wire type** precedent (`WireModalOption` mirrors `ConversationSummary` as a wire sub-struct).
- `src/main/transport/inboundMessage.ts:154-174` — **`parseMessagePayload` — THE enum-check reference.**
  Its single `role` comparison (`if (role !== 'user' && role !== 'assistant') throw`) is the exact idiom
  the `class` and `source` checks each clone: covers non-string and unknown-string alike, narrows without
  a cast, category-only error message, never interpolates the value.
- `src/main/transport/inboundMessage.ts:276-315` — `parseTurnStatePayload` (the enum-field clone, #214)
  and `parseToolUsePayload` (five required strings, #217): the parse-function shape to mirror.
- `src/main/transport/inboundMessage.ts:317-355` — `parseConversationSummary` + `parseConversationsPayload`:
  **the per-element-narrower-mapped-over-an-array pattern** `parseModalOption` + `options` decode clones
  (array guard → `raw.map(parseModalOption)`; one bad element throws the whole frame closed; empty array
  tolerated).
- `src/main/transport/inboundMessage.ts:89-100` — `InboundDaemonMessage` union (add two kinds).
- `src/main/transport/inboundMessage.ts:467-508` — the `case 'turn_state'` / `case 'tool_use'` /
  `case 'conversations'` switch arms: narrow **before** logging, content-free `inbound-decoded` log. The
  template for the two modal cases.
- `src/main/daemonConnection.ts:303-332` — the `case 'turn-state'` / `case 'tool-use'` /
  `case 'conversations'` emit arms: fresh literal, snake→camel. **The `conversations` arm (322-332) is the
  key reference for `options`** — it reuses the already-minimal decoded array verbatim (nothing to drop).
  Note: the `switch (inbound.kind)` here has **no** `default: assertNever` — a missing consumer case
  silently drops, so the `daemonConnection.test.ts` emit test is the deterministic safety net.
- `src/shared/ipc/events.ts:14-20, 56-94` — the imports block (add `WireModalClass` / `WireModalSource` /
  `WireModalOption` alongside `WireTurnState`) and the `DaemonEvent` union; the `turnState` / `toolUse` /
  `conversationsReceived` arms (80-94) are the shape to mirror. AC4-by-construction: no arm carries a
  token/key/raw frame.
- `src/renderer/src/store/daemonEventBridge.ts:58-68` — `translateDaemonEvent`; its `assertNever` default
  forces two `return null` cases. The `turnState` / `toolUse` / `conversationsReceived` cases (58-68) are
  the exact mirror — the **session store does not consume** modal frames.
- `src/renderer/src/store/timelineBridge.ts:56-69` — `translateTimelineEvent`; its `assertNever` default
  forces two `return null` cases **in the inverse-filter list** (mirror `conversationsReceived` at 66),
  **not** the owned block — the **timeline store does not consume** modal frames either.
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts:349-535` (turn_state / tool_use
  recognition + fail-closed), `:761-1055` (content-free logging), `:1129-1160` (secret-safety /
  never-echo); `src/main/daemonConnection.test.ts:223-263, 447-` (stream-arm emit);
  `src/renderer/src/store/daemonEventBridge.test.ts:128-140` (arm → null);
  `src/renderer/src/store/timelineBridge.test.ts:76-` (inverse-filter null list).
- Contract SSOT (read-only, for field verification): QMD `pyrycode-docs/specs/architecture/701-modal-wire-types.md`
  § Design 2 — the daemon field tables (`ModalOption`, `ModalShownPayload`, `ModalDismissedPayload`).

## Context

Desktop cannot see `claude`'s permission/trust prompts: the modal frames have no wire types, no transport
decode, and no `DaemonEvent` arm, so `modal_shown` / `modal_dismissed` fall through
`parseInboundMessage`'s `default → inbound-unmodeled → null`. This slice is the **wire-and-decode
foundation** the modal store (#223), render (#224), and answer path (#225) land on — the transport half,
exactly as #199 was the transport half of the timeline vertical over the already-shipped model (#121).

The renderer-side model this vertical folds into — the pure `reduceModal` reducer and its `ModalEvent`
union — already shipped in **#122** (`src/renderer/src/store/modalPrompts.ts`, ADR 0009). This slice does
**not** touch it: it stops at the `DaemonEvent` arm crossing IPC. The Zustand container + `DaemonEvent →
ModalEvent` bridge that consumes these arms is **#223**.

Desktop **withholds the `interactive` capability** by design (`codec.ts`, `helloExchange.ts`), so the
daemon sends no `modal_shown` in production today — flipping it on is **#179**. **Do not flip
`interactive` here.** Everything is testable against injected envelopes / a fake daemon, exactly as #214 is.

Wire facts (verified against ADR 0009 and the SSOT `701-modal-wire-types.md § Design 2`; **no modal frame
carries `conversation_id` — `modal_id` is the sole correlation key and one-time nonce**):

- `modal_shown{ modal_id, class, title, prompt, options: [{ id, label }], default_option_id }` — binary →
  client. `class` ∈ `permission | trust` (closed two-value set — **no `destructive` wire class**).
  `options` is **ordered** (array order is display/selection order). `default_option_id` is the id of a
  fail-safe deny default set daemon-side. All fields always present (no `omitempty`).
- `modal_dismissed{ modal_id, outcome, source }` — binary → client. `outcome` = the answered option id or
  a producer sentinel (opaque string). `source` ∈ `remote | local | timeout` (closed set). All present.

## Design

Six thin, additive touchpoints, each mirroring the `tool_use` / `turn_state` sibling. Nothing existing
changes behaviour — every other decode path is untouched.

### 1. Wire types — `src/shared/wire/types.ts`

Add two closed wire enums, one nested option struct, and two payload interfaces, field-for-field with the
daemon (SSOT #701), every field required-present (no `omitempty`):

```ts
export type WireModalClass = 'permission' | 'trust'          // no `destructive` (ADR 0009)
export type WireModalSource = 'remote' | 'local' | 'timeout' // fully determined by the resolver
export interface WireModalOption { id: string; label: string }        // ordered by array position
export interface ModalShownPayload {
  modal_id: string; class: WireModalClass; title: string; prompt: string
  options: WireModalOption[]; default_option_id: string
}
export interface ModalDismissedPayload { modal_id: string; outcome: string; source: WireModalSource }
```

Add `'modal_shown'` and `'modal_dismissed'` to the `EnvelopeType` union (group with the v2 interactive
types, after `tool_use`). Mirror the existing doc-comment style: name the SSOT (#701, ADR 0009), note "no
`omitempty`", note `class` / `source` are plain wire strings closed to their sets exactly like
`MessagePayload.role`, and note **`modal_id` is the sole correlation key — no `conversation_id`**.

**Why closed `WireModalClass` and not an open `string`:** the desktop deliberately narrows `class` to the
two shipped values (matching `ModalClass`, #122). The daemon models `class` as an open string (SSOT #701),
so this is a **stricter-than-wire, fail-closed** choice — an unknown class drops the frame. This is the
same no-drift posture as `WireTurnState`; its consequence (higher than #214's, because a dropped modal is
a blocking prompt) is called out in **Open questions**. The `Wire`-prefixed enums are structurally equal
to the renderer's `ModalClass` / the inline `'remote'|'local'|'timeout'` / `ModalOption`, so the #223
bridge assigns one to the other with no cast (the `WireTurnState ≡ TurnPhase` precedent).

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add two union arms to `InboundDaemonMessage` (kebab kinds, consistent with `turn-state` / `tool-use`):
  `| { kind: 'modal-shown'; modalShown: ModalShownPayload } | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }`.
- Add **`parseModalOption(payload: unknown): WireModalOption`** — `isRecord` guard (`'malformed modal
  option'`), then `requireString('id')` + `requireString('label')`; returns only `{ id, label }`, tolerates
  extra keys but does not copy them. Sibling of `parseConversationSummary`.
- Add **`parseModalShownPayload(payload: unknown): ModalShownPayload`** — `isRecord` guard, then
  `requireString('modal_id')`, the **`class` closed-enum check** (`if (cls !== 'permission' && cls !==
  'trust') throw new WireDecodeError('missing required field: class')` — the `role`/`state` idiom, narrows
  to `WireModalClass` without a cast), `requireString('title')`, `requireString('prompt')`, the **options
  decode** (`options` must be an array or throw `'malformed modal options'`, then `raw.map(parseModalOption)`
  — one bad option throws the whole frame closed, empty array tolerated per the `conversations` precedent),
  and `requireString('default_option_id')`. Returns exactly the six known fields. **Do not** reach for
  `requireString` on `class` — that would accept any string and defeat the closed-enum boundary.
  `default_option_id ∈ options[].id` is **not** cross-checked here (see Open questions).
- Add **`parseModalDismissedPayload(payload: unknown): ModalDismissedPayload`** — `isRecord` guard, then
  `requireString('modal_id')`, `requireString('outcome')` (opaque string — option id or sentinel, carried
  verbatim, **not** enum-checked), and the **`source` closed-enum check** (`if (src !== 'remote' && src !==
  'local' && src !== 'timeout') throw new WireDecodeError('missing required field: source')`). Returns the
  three known fields.
- Every error message names the failure **category only** — never interpolate `title` / `prompt` /
  `options[].label` / `outcome` / `modal_id` / `class` / `source` (the uniform no-echo discipline; these
  fields carry operator/`claude`-surfaced content or the correlation nonce).
- Add `case 'modal_shown'` and `case 'modal_dismissed'` to `parseInboundMessage`'s `switch (envelope.type)`
  (mirror `case 'tool_use'`): narrow **before** logging so a malformed frame throws first and leaves no
  record; emit `{ event: 'inbound-decoded', code: 'modal_shown' | 'modal_dismissed', bytes: plaintext.length,
  hash: hashPlaintext(plaintext) }` — **no decoded field** logged; then return the kind.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails oversized frames
closed (and bounds the `options` array) — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`

Add two `case` arms to the inner `switch (inbound.kind)` (mirror `case 'tool-use'` / `case 'conversations'`):

- `case 'modal-shown'` — emit a fresh literal `{ type: 'modalShown', modalId, class, title, prompt,
  options, defaultOptionId }` with `modal_id`→`modalId`, `default_option_id`→`defaultOptionId`, and
  `options` **reused verbatim** from `inbound.modalShown.options` (the `conversations` precedent — the
  decoded array is already minimal because `parseModalOption` returns only `{ id, label }`; nothing to
  drop, no snake→camel needed on `id`/`label`). Never a spread of the decoded payload.
- `case 'modal-dismissed'` — emit a fresh literal `{ type: 'modalDismissed', modalId, outcome, source }`.

**No `conversation_id` is dropped** (there is none on a modal — contrast the `turn-state` / `tool-use`
arms which drop it).

### 4. `DaemonEvent` arms — `src/shared/ipc/events.ts`

Import `WireModalClass`, `WireModalSource`, `WireModalOption` alongside the existing `WireTurnState`, and
add two arms whose field names/types mirror `ModalEvent` (#122) so the #223 bridge is a thin rename:

```ts
| { type: 'modalShown'; modalId: string; class: WireModalClass; title: string; prompt: string;
    options: readonly WireModalOption[]; defaultOptionId: string }
| { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
```

Carry only display/correlation fields — no token, key, or raw frame (AC4-by-construction). Mirror the
doc-comment on the `turnState` / `toolUse` arms — note these are consumed by the **modal** store + bridge
(#223), **not** the session store or timeline store, and that `title` / `prompt` / `options[].label` are
untrusted `claude`-surfaced display text the render slice (#224) must render as plain text.

### 5. Session bridge (no-op) — `src/renderer/src/store/daemonEventBridge.ts`

Add `case 'modalShown':` / `case 'modalDismissed': return null` to `translateDaemonEvent` (mirror the
`turnState` / `toolUse` / `conversationsReceived` null cases), with a comment: *no session-store action —
the modal store + bridge (#223) consumes these.* Required purely because the `assertNever` default makes a
new `DaemonEvent` arm a compile error until every subscriber decides its mapping.

### 6. Timeline bridge (also no-op) — `src/renderer/src/store/timelineBridge.ts`

Add `case 'modalShown':` / `case 'modalDismissed':` to the **inverse-filter `return null` list** (mirror
`conversationsReceived` at line 66), **not** the owned block — a modal is neither a session action nor a
timeline event. Comment: *the modal store + bridge (#223), not the timeline store, consumes these.*
Required by the same `assertNever` guard.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()             [transport boundary: fail-closed decode + content-free log]
      'modal_shown'     → parseModalShownPayload (class enum + options.map + reqStrings) → { kind:'modal-shown', modalShown }
      'modal_dismissed' → parseModalDismissedPayload (source enum + reqStrings)          → { kind:'modal-dismissed', modalDismissed }
  → daemonConnection switch(inbound.kind)   [consumer: snake→camel; NO conversation_id to drop]
      → emitDaemonEvent { type:'modalShown', modalId, class, title, prompt, options, defaultOptionId }
      → emitDaemonEvent { type:'modalDismissed', modalId, outcome, source }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge.translateDaemonEvent  → null   (session store: nothing)
      → timelineBridge.translateTimelineEvent   → null   (timeline store: nothing)
      → [#223: modal bridge → ModalEvent → reduceModal → modalStore]   (NOT this slice)
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel. Decode is a pure synchronous function;
each event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on the existing driver
read loop — no correlation map, no pending request, no teardown to add. **Both** renderer bridges no-op
these arms (`return null`); the real consumer (a third bridge + `modalStore`) is #223. Cancellation, socket
lifecycle, and reconnect are unchanged and owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Any missing/mistyped field, a `class` outside `permission|trust`, a `source` outside
  `remote|local|timeout`, an `options` that is not an array, or a bad option element** →
  `parseModal*Payload` throws `WireDecodeError` (never a partial value). `daemonConnection`'s existing
  `try/catch` around `parseInboundMessage` drops the frame — no event, no throw, no log (the caught error
  is dropped so it can't echo plaintext). No new catch needed.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode; it also bounds the
  `options` array (a hostile daemon cannot amplify beyond the frame cap).
- **Well-formed but unmodeled** (any other type) → still falls to `default → inbound-unmodeled → null`.
- **Category-only error messages** — every check names the field only, never the value (uniform no-echo).
- **Content-free diagnostics** — each new log call carries only `code` + `bytes` + `hash`; the throw path
  stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the `tool_use` /
`turn_state` / `conversations` cases. `npm test` + `npm run build` must stay green.

**`inboundMessage.test.ts`** (mirror `:349-535` recognition/fail-closed and `:761-1055` logging):
- Well-formed `modal_shown` (≥2 options, `default_option_id` = one of them) → `{ kind:'modal-shown',
  modalShown }`; assert **option order preserved** (`options[0].id`, `options[1].id`), every field verbatim.
- Well-formed `modal_dismissed` for each of `source` ∈ `remote` / `local` / `timeout` → `{ kind:
  'modal-dismissed', modalDismissed }`; every field verbatim.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for: any `modal_shown` field absent /
  non-string; `class` a non-string, or a string outside the enum (`'destructive'`, `''`); `options` absent
  / a non-array (`'x'`, object); an option element missing `id` or `label`, or a non-object; any
  `modal_dismissed` field absent / non-string; `source` a non-string or outside the enum (`'admin'`, `''`);
  either payload not an object.
- Extra server-added key tolerated (top-level **and** per-option) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `modal_shown` / `modal_dismissed` logs
  `code`, `bytes`, `hash`, and the record contains **no** decoded field (`title` / `prompt` / `options` /
  any `label` / `outcome` / `modal_id` / `class` / `source`). A malformed frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch):
- A `modal_shown` frame through the driver emits exactly one `{ type:'modalShown', ... }` with all six
  fields and options in order; a `modal_dismissed` emits one `{ type:'modalDismissed', ... }`; cover all
  three `source` values.
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts`**: `translateDaemonEvent` returns `null` for `modalShown` and `modalDismissed`
(mirror the `turnState` case at `:128`).

**`timelineBridge.test.ts`**: `translateTimelineEvent` returns `null` for `modalShown` and `modalDismissed`
(add to the inverse-filter "every other arm returns null" list at `:76`).

**`types.test.ts`**: the new `ModalShownPayload` / `ModalDismissedPayload` / `WireModalOption` /
`WireModalClass` / `WireModalSource` / the two `EnvelopeType` members compile (type-level, mirror existing).

Type coverage: `npm run typecheck` — the two `assertNever` guards (`daemonEventBridge`, `timelineBridge`)
are the exhaustiveness proof that both subscribers handle the new arms.

## Scope self-check (6 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 6 production `.ts` files, 0 new files** (every touchpoint read
and grep-verified; no hidden cascade):

1. `src/shared/wire/types.ts` — 5 exported types + 2 `EnvelopeType` members
2. `src/main/transport/inboundMessage.ts` — 3 parse fns + 2 kinds + 2 switch cases
3. `src/main/daemonConnection.ts` — 2 consumer emit cases
4. `src/shared/ipc/events.ts` — 2 `DaemonEvent` arms + 3 imports
5. `src/renderer/src/store/daemonEventBridge.ts` — 2 `assertNever` cases (return null)
6. `src/renderer/src/store/timelineBridge.ts` — 2 `assertNever` cases (return null)

This crosses the file-count self-check boundary (≥5), so the decision is **documented, not assumed** — a
deliberate keep-as-S on direct precedent, not an undercount rationalization:

- **6 is the architectural floor for this slice.** Adding inbound `DaemonEvent` arms needs: wire type →
  decode → connection emit → event union → **both** renderer bridges (`daemonEventBridge` and
  `timelineBridge` are each `assertNever`-guarded — verified by grep that these are the **only** two
  exhaustive `DaemonEvent` switches; `conversationListBridge` / `logDataDownload` / `runConfigSnapshot` use
  `default: null` and need no touch). Drop any one file and it either doesn't compile or never decodes.
  **#214 (turn_state) and #217 (tool_use) hit this exact 6-file floor and each shipped as one S ticket,
  code-review PASS, no salvage.**
- **The honest count is 6 and every file is a load-bearing, tiny, cloned edit** — cloning a pattern that
  already lives in the same file (`tool_use` is the template for five of the six; `role` for the enum
  checks; `conversations` for the array). This is the opposite of the gate's target failure (pyrycode #311:
  *claimed* 4 files, *actual* 13 / 300+ LOC). Nothing is hidden; the estimate is bounded by three direct
  precedents.
- **No valid split exists.** The only intra-slice seam is wire+decode (files 1–2) vs. emit+event+bridges
  (files 3–6): slice A would decode into an `InboundDaemonMessage` kind that `daemonConnection`'s
  un-`assertNever`'d inner switch **silently drops** — a decode with no consumer, dead code a reviewer
  flags; it does not stand alone. A by-frame split (`modal_shown` slice / `modal_dismissed` slice) is
  **worse**: both children edit the **same 6 files**, which the §1.5 file-overlap rule forbids (guaranteed
  merge conflict), for no per-child file reduction. And the vertical is **already** ADR-0009-decomposed into
  six children (#201–#227); #201 is the smallest coherent transport unit. Every split ships dead code or
  conflicts.
- **Every line-based red line passes:** 0 new files (≤3), ~145 production + ~250 test ≈ **~395 total LOC**
  (< 600), **5 new exported types** (`WireModalClass` / `WireModalSource` / `WireModalOption` /
  `ModalShownPayload` / `ModalDismissedPayload`; the arms/kinds are union members, not exports — at the ≤5
  ceiling, not over), **2 consumer bridge cases** (compile-forced, ≤10), **~4 reject branches** (two enum
  checks, options-array guard, per-option narrower), **6 ACs** all facets of one cohesive two-frame change.
  Projected turn cost tracks #214/#217 (~15–25 turns), well inside budget.

Conclusion: genuine, verified, precedented S. Not an undercount — proceed.

## Open questions

- **`class` value evolution — higher consequence than #214's `state`.** The desktop closes `class` to
  `permission | trust`; a future daemon class (SSOT #701 names *plan-approval* / *tool-confirmation* as
  possibilities) would **fail closed here — the whole modal drops**. Because a modal is a prompt `claude`
  is *blocking on*, a silent drop is more serious than dropping a `turn_state` phase indicator. This is the
  deliberate no-drift fail-closed posture (CLAUDE.md); widening is a **coordinated 3-touch change**
  (`WireModalClass` + `ModalClass` in `modalPrompts.ts` #122 + the decoder), which #223/#224 should note.
  Evidence-based: only `permission | trust` ship today (#716), so closing to the shipped set is correct
  **now** — building tolerance for an unshipped class would defend an unobserved failure.
- **`default_option_id ∈ options[].id` not enforced at decode.** Decoded as a required string; the
  cross-field invariant is **deferred to render (#224)**. A daemon sending a mismatched default just means
  the render pre-highlights nothing — harmless (answering needs an explicit user action, #225).
  Cross-field validation at the transport is scope creep.
- **Empty `options` array accepted structurally** (the `message_chunk` / `conversations` precedent). A
  zero-option modal is degenerate (unanswerable → daemon timeout) but not a security issue; the render
  slice (#224) decides its presentation.
- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case silently drops. The
  `daemonConnection.test.ts` emit test is the deterministic safety net (same as #214 / #217). **Do not**
  expand scope to guard the switch here.
- **Untrusted free text forwarded to #224.** Unlike `turn_state` (three enum values), a modal carries
  **free text** — `title`, `prompt`, and each `options[].label` are untrusted `claude`-surfaced strings the
  render slice (#224) must render as **plain text, never HTML** (the `assistant_delta`/#203 +
  `tool_use`/#218 React-auto-escape precedent). Flagged for #223 (carries them untouched) and #224 (renders
  them).

## Security review

**Reviewer:** architect (self-review; `agents/architect/security-review.md` is not synced into this
worktree — performing the pass inline using the standard adversarial categories, per the #214 / #701
precedent).
**Date:** 2026-07-10
**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains three explicit fail-closed narrowers (`parseModalShownPayload`,
  `parseModalDismissedPayload`, `parseModalOption`), each throwing `WireDecodeError` on any
  structural/semantic mismatch, never a partial value — the same named boundary that already owns
  `message` / `tool_use`. The **tightest** gates are the **two closed-enum checks**: a hostile daemon
  cannot smuggle an arbitrary string, an object, `null`, or a `'__proto__'`-style value onto `class` or
  `source` — anything outside the closed set throws and the frame drops. `parseModalOption` fail-closes
  each element (two required strings; extra keys stripped). Positive control against IPC-side unknown-key /
  prototype leakage: the emit builds **fresh object literals** with named fields and reuses the
  already-stripped `options` array, never a spread of the decoded payload.
- **[Trust boundaries — code-review must verify]** SHOULD FIX (design-directed, already specified). The
  security property of this slice **is** the two enum checks + the per-option narrower. If the developer
  reaches for `requireString('class')` / `requireString('source')` instead of the three-way / three-way
  literal comparisons (Design § 2), the boundary silently weakens to "any string reaches the arm."
  Code-review must confirm the shipped decoders use the literal comparisons. Deterministic net: the
  `inboundMessage.test.ts` fail-closed cases assert an out-of-enum `class` (`'destructive'`) and `source`
  (`'admin'`) throw — a green suite proves the enum boundaries shipped.
- **[Tokens / secrets]** N/A by design. No token/key/credential is added, decoded, or carried. `modal_id`
  is a correlation nonce (per SSOT #701 its security property is unguessability, minted daemon-side — **not
  a secret the client holds**), carried end-to-end as the sole correlation key. No `conversation_id` is
  synthesised (the wire carries none). No arm field can hold a key/token/raw frame (AC4), matching
  `events.ts`'s existing invariant.
- **[File / storage]** N/A — no filesystem or storage operation in this slice.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the two arms ride the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) the preload already forwards generically. Process placement
  preserved: decode lives in `src/main/transport/inboundMessage.ts` (main-only, imports `Buffer`, never
  re-exported to a renderer barrel); no key, socket, or raw frame moves toward the renderer.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for content-free logging; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard at the top of
  `parseInboundMessage` fails an oversized frame closed before decode and **bounds the one unbounded field,
  `options`** — a hostile daemon cannot amplify beyond the frame cap. `raw.map(parseModalOption)` is O(n)
  with n bounded by frame-size / min-option-size; each option is two flat strings (no nesting), rejected in
  O(1) with no regex (no ReDoS). No new socket / timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — the category the ticket is security-sensitive *for*,
  addressed head-on. The two new diagnostic calls are **content-free** (`code` + `bytes` + one-way `hash`
  only), emitted **after** the frame fully narrows so the throw path leaves no record; every parser error
  message names the failure **category only** — never interpolating `title` / `prompt` / any option
  `label` (operator / `claude`-surfaced content), `outcome`, or the correlating `modal_id` / `class` /
  `source`; the `WireDecodeError` caught in `daemonConnection` is dropped, never logged or forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  events ride the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak.
  Both renderer bridges no-op these arms.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious/compromised relay*
  (on-path, content-blind): a flood of malformed modal frames all throw and drop — no plaintext leak, no
  log record, no hang (synchronous, frame-bounded). *Hostile daemon response*: every field parsed
  defensively, fail-closed, with the two enum checks + per-option narrower as the tightest gates.
  *Renderer compromise reaching transport*: unchanged — no new renderer capability. Note the modal is a
  **high-consequence surface** (a prompt `claude` blocks on), but this slice only **decodes and carries to
  two no-op bridges** — the answer path, where the consequence lands, is #225 (also security-sensitive) and
  the per-device answer gate is enforced daemon-side (#702, ADR 0009 § "Nothing to gate on in this store").
- **[Untrusted content at render — forwarded to #224]** Unlike `turn_state.state` (three known enum
  values), `modal_shown` carries **free text** — `title`, `prompt`, and each `options[].label` are
  untrusted `claude`-surfaced strings that the render slice (#224) **must render as plain text, never
  HTML** (the `assistant_delta`/#203 + `tool_use`/#218 React-auto-escape precedent). This is the modal
  analog of #199→#203's text-at-DOM concern; it is a **render-slice** obligation (this slice does not
  render), recorded in Open questions and forwarded to #223 (carries the strings untouched) and #224
  (renders them).

**Reviewer:** architect (self-review per the #214 / #701 precedent)
**Date:** 2026-07-10
</content>
</invoke>
