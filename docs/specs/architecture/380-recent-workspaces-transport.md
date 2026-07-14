# #380 — `recent_workspaces` transport: request + decode the recent-workspaces list

**Size:** S · **Security-sensitive:** yes (parses an inbound frame off the internet-exposed relay socket in the main process) · **Split from:** #157 · **Blocks:** #382 (renderer store + bridge)

## Context

The daemon now serves a `recent_workspaces` read verb (pyrycode/pyrycode #888, merged): an empty request returns `recent_workspaces_list` with the distinct workspace paths ordered most-recent-first. This ticket ports the desktop client's **transport half** — a bare request builder plus decoding the new inbound reply into a typed daemon event — and wires the emit path so the event actually reaches the renderer channel. The renderer store that holds the list and the Workspace-Picker UI that renders it land in **#382** (which consumes the `recentWorkspacesReceived` event this ticket emits).

This is a **near-exact clone of #139** (`list_conversations` → `conversations`), transposed to a two-string row type. Every design decision below has a #139 (or sibling) precedent; the developer's job is a disciplined clone, not novel design.

**Wire contract (matches the merged daemon #888 — do not drift, CLAUDE.md):**
- Request `recent_workspaces`: payload **empty** (`{}`), a bare control-ask like `list_conversations`.
- Reply `recent_workspaces_list`: payload `{ workspaces: Array<{ path: string, last_used_at: string }> }`, correlated by `in_reply_to`; `workspaces` is **always present** (empty → `[]`).
- `path` is a **required string** (the field tag is `path`, **not** `cwd`). `last_used_at` is an **opaque RFC3339 string, left unparsed** — relative-time formatting is a downstream (#382) UI concern.

## Design source

N/A — main-process wire/transport data path with no on-screen surface (like #139 / #180 / #254). The Workspace-Picker visual design lands with #382 / the #157 UI slice.

## Files to read first

Read these before writing anything — they are the exact clone sources. Line refs are from this worktree at spec time; the developer verifies against current code.

- `src/main/transport/listConversationsEnvelope.ts:1-48` — **the request-builder clone source.** `buildListConversations({ id, ts })` emits a bare `payload: {}` envelope. Copy its shape, docstring posture (why `{}` not an omission), and `ListConversationsInput` interface verbatim.
- `src/main/transport/inboundMessage.ts:539-568` — `parseConversationSummary` + `parseConversationsPayload`: **the exact decode idiom to clone** — `isRecord` guard, `requireString` per field, `.map` over the row array, one bad row throws the whole frame.
- `src/main/transport/inboundMessage.ts:195-202` — `requireString` (already exists; reuse it — no new helper needed, unlike #139 which added `requireStringOrNull`).
- `src/main/transport/inboundMessage.ts:910-923` — the `conversations` switch arm: narrow-before-log, content-free log with **no `count`**. Clone this for `recent_workspaces_list`.
- `src/main/transport/inboundMessage.ts:161-186` — the `InboundDaemonMessage` union; add the new arm here.
- `src/shared/wire/types.ts:40-88` — `EnvelopeType` union; add the two new wire type tags.
- `src/shared/wire/types.ts:508-533` — `ConversationSummary` + `ConversationsPayload`; the new row + reply types go beside these, same doc posture.
- `src/shared/ipc/events.ts:185-190` — the `conversationsReceived` `DaemonEvent` arm (reuses the wire row type verbatim, snake_case). Clone for `recentWorkspacesReceived`.
- `src/main/daemonConnection.ts:156-165` — `requestConversations()` interface doc; `:895-910` — its inert send-twin impl; `:634-644` — its inbound-emit case; `:1319` — its export line. Four clone points.
- `src/renderer/src/store/daemonEventBridge.ts:66-69` — the `conversationsReceived` no-op case (this bridge's `default: assertNever` forces a case).
- `src/renderer/src/store/modalBridge.ts:70-93` and `src/renderer/src/store/timelineBridge.ts:95-127` — the two other `default: assertNever` bridges; the new arm joins their `return null` fall-through group.
- `src/shared/ipc/commands.ts:95-111` (union) + `:173-221` (`isRendererCommand`) — the bare `requestConversations` RendererCommand arm + its `return true` guard case; clone for `requestRecentWorkspaces`.
- `src/main/index.ts:255-259` — the `requestConversations` onCommand dispatch case; clone for `requestRecentWorkspaces`.
- Memory / prior specs: `docs/specs/architecture/139-decode-conversation-list.md` if present — this ticket is its transpose; the security posture and the "8-file atomicity exception" rationale carry over.

## Design

One wire verb, one round-trip, spread across the sealed-union consumers the TypeScript exhaustiveness guard forces. Ten production files, all additive, zero call-site fan-out (no rename, no signature change) — see **Scope self-check** for why this is one irreducible ticket, not a split.

### 1. Request builder — NEW `src/main/transport/recentWorkspacesEnvelope.ts`

Clone `listConversationsEnvelope.ts`. Contract:

```ts
export interface RecentWorkspacesInput { id: number; ts: string }
export function buildRecentWorkspaces(input: RecentWorkspacesInput): Uint8Array
```

- Emits `{ id, type: 'recent_workspaces', ts, payload: {} }` via `encodeEnvelope`. Present-but-empty `payload: {}`, **never** an omission or `null` (the module's "never emit null on the wire" posture — copy the docstring rationale verbatim).
- MAIN-PROCESS ONLY; never re-exported through a renderer barrel.
- Pure, no wall-clock read — `id`/`ts` are supplied by the caller.

### 2. Wire types — `src/shared/wire/types.ts`

- `EnvelopeType` (~L40-88): add `'recent_workspaces'` (outbound request) and `'recent_workspaces_list'` (inbound reply) as members.
- New row type beside `ConversationSummary`:

```ts
export interface RecentWorkspace {
  path: string        // untrusted daemon-supplied workspace path — opaque display text, never fs-resolved here
  last_used_at: string // opaque RFC3339 string, left unparsed
}
```

- New documentary reply type (mirrors `ConversationsPayload`):

```ts
export interface RecentWorkspacesPayload { workspaces: RecentWorkspace[] }
```

Field order `path, last_used_at` — preserve it from the wire, do not reorder. Docstring must state: `path` is untrusted display text this client never resolves into a filesystem path; `last_used_at` is opaque, formatted downstream.

> **Do not add a documentary request-payload type.** The builder emits `{}` inline (the `listConversationsEnvelope` posture — it does not import `ListConversationsPayload`). Keeping it out holds new exported types at three (`RecentWorkspace`, `RecentWorkspacesPayload`, `RecentWorkspacesInput`).

### 3. Inbound decode — `src/main/transport/inboundMessage.ts`

- Import `RecentWorkspace` from `../../shared/wire/types`.
- New `InboundDaemonMessage` arm: `| { kind: 'recent-workspaces'; recentWorkspaces: RecentWorkspace[] }`.
- Two new fail-closed narrowers, cloned from `parseConversationSummary` / `parseConversationsPayload`:
  - `parseRecentWorkspace(payload): RecentWorkspace` — `isRecord` guard, then `requireString(payload, 'path')` + `requireString(payload, 'last_used_at')`. Both plain required strings; **no nullable, no boolean, no enum** (simpler than `parseConversationSummary`). Category-only error messages — never interpolate `path` (it can echo a `$HOME`/username/project name).
  - `parseRecentWorkspacesPayload(payload): RecentWorkspace[]` — `isRecord` guard, `payload.workspaces` must be an array (else throw), `.map(parseRecentWorkspace)`. Empty `[]` is valid (`[].map()` → `[]`). One bad row throws the whole frame (the `parseConversationsPayload` discipline).
- New `case 'recent_workspaces_list':` in `parseInboundMessage`'s switch — **narrow before logging** (a malformed frame throws first and leaves no record), then a content-free `diagnosticLog?.event(...)` with `code: 'recent_workspaces_list'` and **exactly** `{ event: 'inbound-decoded', code, bytes, hash }` — **NO `count` field** (the `conversations` #139 posture: a workspace count is more identifying than a message-batch size). Return `{ kind: 'recent-workspaces', recentWorkspaces }`.

### 4. Sealed daemon event — `src/shared/ipc/events.ts`

- Add `RecentWorkspace` to the `../wire/types` import block.
- New `DaemonEvent` arm, cloned from `conversationsReceived` (reuse the wire row type verbatim, snake_case — no camelCase remap, no field drop):

```ts
| { type: 'recentWorkspacesReceived'; recentWorkspaces: readonly RecentWorkspace[] }
```

Docstring: consumed by the recent-workspaces store (#382), not the session store; carries no token/key/raw frame — only paths (untrusted display text) and opaque timestamps; the #382 render slice must render `path` as **plain text, never HTML** (inherited-constraint note, matching `conversationsReceived` / `sessionTransition`).

### 5. Emit path + dormant request twin — `src/main/daemonConnection.ts`

- Import `buildRecentWorkspaces` from `./transport/recentWorkspacesEnvelope`.
- **Interface method** `requestRecentWorkspaces(): void` (clone the `requestConversations` doc block, ~L156-165): the `send` twin — inert no-op when `driver === null`, no consumer to fail; the reply arrives asynchronously as one `recentWorkspacesReceived` event consumed by #382; bare, no payload arg; no caller in this ticket (#382 triggers it via the command on connect).
- **Impl** `function requestRecentWorkspaces(): void` (clone `requestConversations` at ~L895-910 line-for-line): `if (driver === null) return`; `try { const bytes = buildRecentWorkspaces({ id: nextEnvelopeId, ts: now() }); nextEnvelopeId += 1; driver.sendMessage(bytes) } catch { /* never throw out of the module (parity #490) */ }`. Shares the single monotonic `nextEnvelopeId`.
- **Inbound-emit case** `case 'recent-workspaces':` in the inbound consumer switch (clone the `conversations` case at ~L634-644): `emitDaemonEvent(sink, { type: 'recentWorkspacesReceived', recentWorkspaces: inbound.recentWorkspaces })`. Verbatim passthrough — `parseRecentWorkspace` already stripped each row to its two known fields, nothing to drop. **This inner switch has no `assertNever` (see the L550/L676 comments), so the case is not compile-forced — it must be added deliberately; the round-trip test (below) is what guards it.**
- **Export** `requestRecentWorkspaces` in the returned connection object (~L1319, beside `requestConversations`).

### 6. The three forced bridge no-ops (renderer)

Adding a `DaemonEvent` arm forces a case in the three bridges whose `default:` calls `assertNever(event)` — the exhaustiveness guard turns a missing case into a compile error. All three are one-line mechanical no-ops (the arm is consumed by #382, not these stores):

- `src/renderer/src/store/daemonEventBridge.ts` — new `case 'recentWorkspacesReceived': return null` beside `conversationsReceived` (~L66), with the "consumed by #382, present only because assertNever" comment.
- `src/renderer/src/store/modalBridge.ts` — add `case 'recentWorkspacesReceived':` to the `return null` fall-through group (~L76-86).
- `src/renderer/src/store/timelineBridge.ts` — add `case 'recentWorkspacesReceived':` to the `return null` fall-through group (~L102-113).

> The other seven `*Bridge.ts` files use `default: return null` and **absorb the new arm silently — do not touch them.** Follow the #375 (`conversationDeleted`) commit as the exact three-bridge template.

### 7. Outbound command plumbing (the untrusted-boundary arm — belongs on this sec ticket)

The RendererCommand is what lets #382's bridge trigger the request; it adds an arm to the untrusted renderer→main IPC boundary, which is **why it lives on this security-sensitive ticket, not the non-sec #382** (the #139 → #208 precedent: `requestConversations` was defined on #139). Dormant here — nothing sends it until #382.

- `src/shared/ipc/commands.ts`:
  - New bare `RendererCommand` arm `| { type: 'requestRecentWorkspaces' }` (~L99, beside `requestConversations`), and update the union's member-count doc comment.
  - New `isRendererCommand` case `case 'requestRecentWorkspaces': return true` (~L183) — a bare member, no payload to validate, so a well-formed `type` is complete acceptance. **The guard's `default: return false` does not compile-force this — add it in lockstep or the command is silently dropped (the file's own L91-93 warning).**
- `src/main/index.ts`: new `case 'requestRecentWorkspaces':` in the `onCommand` dispatch (~L255) → `connection.requestRecentWorkspaces(); return` (clone the `requestConversations` case, comment adjusted).

## State + concurrency model

No new store, no new async task, no new subscription (those are #382). The request is a fire-and-forget bare control frame over the existing Noise session; the reply arrives on the existing inbound plaintext path and is emitted as one `recentWorkspacesReceived` event on the existing `DAEMON_EVENT_CHANNEL`. Envelope ids share the single monotonic `nextEnvelopeId` (the daemon correlates by id). No cancellation/teardown surface is added — `requestRecentWorkspaces` is inert when `driver === null` and never throws out of the module (parity #490).

## Error handling

- **Decode (untrusted boundary):** `WireDecodeError` is the single failure type. Fails closed — throws, never returns a partial value — when `workspaces` is absent or not an array, or any row is missing `path`, has a non-string `path`, or a non-string `last_used_at`. One bad row fails the whole frame. Oversized frames are caught by the existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage`.
- **Encode/send:** `buildRecentWorkspaces` may in principle throw `WireEncodeError`, but a fixed-shape empty-payload envelope cannot exceed `MAX_PLAINTEXT_BYTES`; `requestRecentWorkspaces` catches-and-drops anyway (parity #490).
- **UI surfacing:** none in this ticket. A malformed reply is dropped at the decode boundary (no event emitted); a well-formed reply emits the event that #382 will consume.

## Testing strategy

Unit tests only (`npm test`, vitest), builder + decoder + round-trip in isolation — **no renderer store or UI** (AC5). Scenarios as bullets; the developer writes them in the project idiom (test-first, RED before GREEN):

- **NEW `recentWorkspacesEnvelope.test.ts`** (clone `listConversationsEnvelope.test.ts`):
  - `buildRecentWorkspaces({ id, ts })` → bytes that `decodeEnvelope` narrows to `type: 'recent_workspaces'`, `payload` deep-equals `{}`, `id`/`ts` echoed.
- **`inboundMessage.test.ts`:**
  - Happy path: two-row `recent_workspaces_list` decodes to `{ kind: 'recent-workspaces', recentWorkspaces: [...] }`, **order preserved**, each row exactly `{ path, last_used_at }` (unknown extra keys stripped).
  - Empty `workspaces: []` → valid, `recentWorkspaces: []`.
  - Fail-closed (each throws `WireDecodeError`, no partial value): `workspaces` absent; `workspaces` not an array; a row missing `path`; a row with non-string `path`; a row with non-string `last_used_at`; a mix where one bad row fails the whole frame.
  - Content-free log: on a successful decode the injected `DiagnosticLog` receives exactly `{ event: 'inbound-decoded', code: 'recent_workspaces_list', bytes, hash }` — assert **no `count`** and **no `path` value** appears in the record; on a throw, assert **no** record is emitted.
- **`daemonConnection.test.ts`** (clone the `requestConversations` / `conversations` blocks):
  - `requestRecentWorkspaces()` on a connected session sends one frame whose decoded payload is `{}` and `type` is `recent_workspaces`; shares/advances `nextEnvelopeId` with interleaved `send`/`requestConversations` calls.
  - Inert when disconnected (`driver === null`) — no send, no throw.
  - Inbound `recent_workspaces_list` → exactly one `recentWorkspacesReceived` event carrying the decoded rows (drive the real Noise round-trip via the existing `buildReplyFrames` seam, the #139 AC8 pattern).
  - No throw escapes the module on a `driver.sendMessage` failure.
- **`commands.test.ts`:** `isRendererCommand({ type: 'requestRecentWorkspaces' })` → `true`; a bare arm needs no payload; an unknown `type` still → `false`.
- **Bridge tests** (`daemonEventBridge.test.ts` / `modalBridge.test.ts` / `timelineBridge.test.ts`): touch **only if** the test enumerates every arm exhaustively or asserts a specific no-op; otherwise the existing "ignores unrelated events" coverage already exercises the new `return null`. Follow whatever #375's `conversationDeleted` commit did for these three.

Type-level coverage: `npm run typecheck` proves the three `assertNever` bridges and the `InboundDaemonMessage` / `DaemonEvent` unions stay exhaustive. `npm run build` is the salvage/QA gate.

## Scope self-check (auditable — why 10 files is S, not a split)

Honest production-file count (`.ts`, excluding tests/`.md`/spec): **10** — `recentWorkspacesEnvelope.ts` (NEW), `inboundMessage.ts`, `types.ts`, `events.ts`, `daemonConnection.ts`, `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts`, `commands.ts`, `index.ts`. This is above the §4 ≥5-file gate, so the count is stated openly and justified here rather than rationalized away.

This is the **documented TS-exhaustive-union-atomicity exception**, identical in shape to #139 (which shipped this exact vertical at 8 files, clean review, size S — #380 adds two files only because two more `default: assertNever` bridges, `modalBridge`/`timelineBridge`, exist now than did at #139's time). Against the red lines:

- **New files:** 1 (`recentWorkspacesEnvelope.ts`). The other 9 are additive edits. ✓ (≤3)
- **Total written LOC:** ~450–550 (leaner than #139's 610 — this reuses `requireString`, adds no new decode helper). ✓ (≤600)
- **New exported types:** 3 (`RecentWorkspace`, `RecentWorkspacesPayload`, `RecentWorkspacesInput`). Every other addition is a *union member* (a `DaemonEvent` / `InboundDaemonMessage` / `RendererCommand` / `EnvelopeType` arm), not a new exported type. ✓ (≤5)
- **Consumer call-site fan-out:** zero. No rename, no signature change, no widely-used type replaced. The "extra" files are single-case `return null` no-ops **forced by the exhaustiveness guard**, not a dependent cascade. `codegraph_impact` is moot — nothing existing changes shape. ✓ (≤10)
- **Acceptance criteria:** 5, all mechanical #139 clones. ✓
- **Reject branches:** ~3, folded into two narrowers. No state machine. ✓ (≤10)

**Why splitting is strictly worse (not merely unnecessary):** the `DaemonEvent` arm and its three `assertNever` consumers must compile together — a PR that adds the arm without the three bridge cases does not build, and a PR that adds the bridge cases for a nonexistent arm does not type-check. Any split of "decode half / builder half" would have **both** halves touch `types.ts` and `daemonConnection.ts` → a self-inflicted §1.5 file-overlap conflict — and would split the atomic request→reply round-trip test across two tickets. #139 rejected this identical split for these identical reasons and shipped clean. **Do not split. Do not route to PO.**

## Security review

Label-gated pass (ticket is `security-sensitive`). Verdict: **PASS** — no MUST FIX. The distinguishing surface vs. sibling transport tickets is that `path` is a filesystem-path-shaped untrusted string; it is traced end-to-end below and never touches a local filesystem API.

**Trust boundaries**
- **Inbound relay socket → main (untrusted peer bytes):** the `recent_workspaces_list` frame is attacker-influenceable (a malicious/compromised relay peer or daemon). `parseInboundMessage` is the untrusted→trusted boundary. Enforced fail-closed at `inboundMessage.ts` by: the `MAX_PLAINTEXT_BYTES` guard (oversized), `isRecord`/array checks, and `requireString` per field. One bad row throws the whole frame; a partial value is never returned. `WireDecodeError` is the single failure type, so the existing single caller catch covers all failure modes. ✓
- **Renderer → main (untrusted IPC):** the new bare `requestRecentWorkspaces` RendererCommand adds one arm to the boundary `isRendererCommand` polices. It carries **no payload**, so `return true` on a well-formed `type` is complete acceptance — no field can smuggle data onto the wire. This is why the command plumbing stays on this sec ticket, not #382. ✓

**Sensitive-data handling**
- **`path` (workspace filesystem path):** untrusted and privacy-sensitive (can reveal `$HOME`/username/project names). Decoded as **opaque display text only** — this ticket never calls `fs.*`, `path.resolve`, or any filesystem API on it (the `ConversationSummary.cwd` #139 / `SessionTransitionPayload.workspace_cwd` #254 posture). It crosses IPC as a plain string on the event; it is **never logged** (the content-free log emits only `{event, code, bytes, hash}` — no `count`, no `path`, so the diagnostic bundle cannot leak a path). ✓
- **`last_used_at`:** opaque RFC3339 string, **left unparsed** — no `Date`/parser fed untrusted input, so no parser-DoS/injection surface. ✓
- **Process isolation:** builder, decode, and raw bytes stay in `src/main` (transport). The event carries only two strings per row — no token, key, raw frame, or plaintext bytes. Not re-exported through any renderer barrel. ✓

**Carry-forward constraint for #382 (the consumer):** render `path` and any derived label as **plain text — never `innerHTML` / `dangerouslySetInnerHTML`** — and **never resolve `path` into a local filesystem operation** (it is a *remote* daemon-side path; the desktop has no business touching the local FS with it). Source any user-chosen workspace for the outbound `change_workspace` (#379) from a validated folder chooser, not from a decoded `path` echoed back as free text.

No FAIL condition found; committing as PASS.

## Open questions

- **Documentary request-payload type:** intentionally omitted (see Design §2). If a future reviewer wants strict #139 parity, adding `export type RecentWorkspacesRequestPayload = Record<string, never>` is harmless but unused — the builder emits `{}` inline. Left out to keep new exported types at three.
- **Bridge test edits:** whether `daemonEventBridge.test.ts` / `modalBridge.test.ts` / `timelineBridge.test.ts` need the new arm depends on whether they enumerate arms exhaustively — resolve by matching the #375 `conversationDeleted` commit. Not a design question; a mechanical parity check.
