# 1020 — carry the session's permission mode in from `session_settings`

One required string field threaded end to end, from the wire type to the renderer's
run-configuration snapshot. Nothing renders it; #682 is the first thing that does.

## Files read

Codegraph is not indexed in this worktree (`.codegraph/` holds `config.json` and no index;
`codegraph_context` answered *"CodeGraph not initialized for this project"*), so the reading list
below was built with grep and Read rather than `codegraph_context`. Noting the gap per the builder
brief's fallback clause.

- `src/shared/wire/types.ts` → `SessionSettingsPayload` — the six fields today and the docblock's
  `wire order` sentence that enumerates them; also `WireModelOption`'s `supports_auto_mode`
  docblock, which holds the one stale sentence this ticket corrects.
- `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload` — the narrower, and
  `requireString` / `requireBoolean` / `requireNumber`, the fail-closed helpers it composes. Also the
  `session_settings` arm of `parseInboundMessage`, which logs *after* narrowing, content-free.
- `src/main/transport/inboundMessage.ts` → `requireNonEmptyString` — read to *reject* it: it is the
  sibling that would refuse `''`, which AC3 forbids here.
- `src/main/daemonConnection.ts` → the `session-settings` case of the inbound switch — the named-field
  emit (never a spread) onto `runConfigReceived`.
- `src/shared/ipc/events.ts` → the `runConfigReceived` arm — the camelCase-with-two-legacy-exceptions
  shape, and the neighbouring `assistantDelta` arm whose comment states the "wire is snake, IPC is
  camel" rule.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `createRunConfigStore` — the
  verbatim-hold contract (no coercion, no validation, whole-object replace).
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot` — the
  field-by-field copy into the snapshot literal; also `toSnapshotSessionId`, the `''`-is-a-value
  precedent this field follows.
- `src/renderer/src/store/daemonEventBridge.ts` → its `runConfigReceived` arm — read to confirm the
  ticket's claim that it is a documented no-op reading no field. It is; no edit.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `subscribeRunConfig` reuse and
  `RunConfigLiveData` — the app-lifetime listener. It passes snapshots through opaquely; no edit.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings` — takes
  `Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo'>`, so a widened snapshot does not reach it.
  No edit; its *test* fixture is in the cascade.
- `docs/knowledge/features/run-config-store.md` § "The store", § "Edge cases and limitations" — the
  verbatim-hold rule and the `sessionId: ''`-is-a-real-value precedent that AC3 extends to this field.
  It also records **No correlation**: any `session_settings` reply is emitted unconditionally, which
  is why nothing here may branch on the new field.
- `e2e/run-config-settings.spec.ts`, `e2e/composer-model-menu.spec.ts`,
  `e2e/composer-effort-menu.spec.ts` → each holds a `BASELINE_RUN_CONFIG: SessionSettingsPayload`
  literal. These are the three the ticket flags as invisible to `npm run typecheck`.

## Design source

**Figma:** N/A — this ticket renders nothing. It is wire-to-store plumbing; the run-configuration
sheet keeps its exact current shape (the ticket's "Out of scope" clause), and #682 is the first
ticket with a visual surface for the mode. The verifier's visual-fidelity check is intentionally
skipped.

## Context

`session_settings` is the run-configuration read half (#491). Upstream added a seventh field,
`permission_mode`, in pyrycode#1687. Without it nothing in this client can name the session's
posture: `yolo` is a boolean and claude has six modes, so it can only separate `bypassPermissions`
from everything else. The footer permission-mode menu (#682) needs a mode string for its label; this
is the read half it will read.

**Required, not optional.** The Go field carries no `omitempty`, so the key is always on the wire and
every zero value is a real answer. That is how this repo already models every other field on this
payload, and modelling it optional would invent a distinction the wire does not carry. The
consequence is explicit and accepted: **this couples the client to a daemon carrying pyrycode#1687.**
Against an older daemon every `session_settings` reply is rejected whole and the sheet plus all three
footer controls go inert with nothing surfaced anywhere. AC5 — `npm run e2e:real:gate` with
`e2e/real-daemon-session-settings.spec.ts` among the specs that *executed* — is what proves the
deployed daemon actually carries the field. The fake e2e tier cannot see this, because it seeds its
own frames.

**Six modes in, five accepted out.** The read half names one of `default`, `acceptEdits`, `plan`,
`auto`, `dontAsk`, `bypassPermissions`. The write half's `validPermissionMode` is a closed *five*
with `bypassPermissions` excluded (#1021). The asymmetry is deliberate upstream, and this ticket must
not narrow to five — no client-side allowlist anywhere on this chain.

No ADR is warranted. This is a field-for-field mirror addition under the existing ADR 0002 contract,
not a new decision.

## Design

Six production files, in seam order. Every edit is additive; no signature changes, no renames, no
new exported types.

### 1. `src/shared/wire/types.ts` — `SessionSettingsPayload`

Add `permission_mode: string` **between `yolo` and `used_tokens`**, mirroring the Go struct order
(ADR 0002). Two docblock corrections come with it:

- The interface docblock's `wire order` sentence lists the six names; it becomes the seven, in
  position.
- Insertion hazard: `used_tokens` carries its own `/** … */` docblock immediately above it. A
  docblock binds to the declaration that *follows* it, so the new field and its own docblock go
  **after `yolo: boolean` and before `used_tokens`' docblock** — never between that docblock and its
  field, which would silently orphan it. Verified after the edit by reading the block back.

The new field's docblock states, in this repo's voice: one of claude's six modes on a resolved
session; `''` = **no session was resolved**, the one zero on this payload that does not name a real
posture, occurring only in the all-zero reply beside `session_id: ''` — read the pair together, never
treat `''` as a mode; it always agrees with `yolo` because the daemon stores them so they cannot
disagree; and the read half deliberately carries a mode the write half refuses (#1021).

Separately, one stale sentence in `WireModelOption`'s `supports_auto_mode` docblock — *"It collides
with nothing in the daemon's own vocabulary — `set_permission_mode` carries default / acceptEdits /
bypassPermissions / plan, and `auto` is claude's mode name."* Both halves are wrong: the field is
`set_session_settings.permission_mode`, and `auto` **is** in the daemon's vocabulary. That one
sentence is replaced. **Nothing else in that docblock or its neighbours is touched** — the `#682`
greys-out sentence, the `effort_levels` collapse and truncation rules, and the `truncated_fields` /
`display_name` paragraphs anchor other contracts by name and stay exactly as they are.

### 2. `src/main/transport/inboundMessage.ts` — `parseSessionSettingsPayload`

One `requireString(payload, 'permission_mode')`, positioned between the `yolo` and `used_tokens`
reads, and returned in wire order.

`requireString`, deliberately **not** `requireNonEmptyString`: `''` is a value here (AC3), and
`requireNonEmptyString` is the sibling that exists to refuse it. `requireString` checks the *type*,
not truthiness, so a missing key (`undefined`) and a non-string both throw `WireDecodeError`, exactly
as `model` and `yolo` already do (AC1). The docblock's "Returns only the six known fields" becomes
seven.

No allowlist. The narrower does not check the value against the six mode names — AC2 forbids a
client-side allowlist, and the daemon normalises at every construction site.

**Fail signal.** `parseSessionSettingsPayload` **throws** on a malformed payload of a claimed type;
`return null` is the other, different signal reserved for an unclaimed frame type. This field's
rejection is a throw, so its tests assert `toThrow(WireDecodeError)`, never `toBeNull()`.

### 3. `src/main/daemonConnection.ts` — the `session-settings` emit

One named copy: `permissionMode: inbound.sessionSettings.permission_mode`. The literal stays a fresh
object with named fields, never a spread — which is why this file is on the chain at all.

Its comment currently reads *"snake→camel for the id only (`sessionId`) … the five value fields keep
their wire names"*. That sentence becomes false with this change and is corrected: snake→camel now
covers the id **and** `permissionMode`, and four of the six value fields keep their wire names.

### 4. `src/shared/ipc/events.ts` — the `runConfigReceived` arm

`permissionMode: string`. **camelCase**, per the arm's convention and the neighbouring
`assistantDelta` comment's "wire is snake, IPC is camel" rule. `used_tokens` / `window_tokens` are
the two legacy exceptions on this arm and are explicitly not a precedent to extend.

The arm's comment gains the untrusted-text warning that `ModelAnnouncedPayload`'s `model` already
carries on this same union, because #682 is a render surface and inherits the constraint from here:
`permissionMode` is daemon-asserted text that crossed the subprocess trust boundary, held with **no
client-side allowlist** by AC2, so it is a *report* and never a control input — no security-relevant
behaviour may branch on it, and it is never markup, an attribute, a URL, a filename, a cache key or a
lookup path. `''` means no session was resolved and crosses verbatim; the field reaches no log sink.
(Security review finding 1.)

### 5. `src/renderer/src/store/runConfigStore.ts` — `RunConfigSnapshot`

`permissionMode: string`, required. It inherits the interface's existing verbatim-hold contract
unchanged: `setSnapshot` replaces the whole object and never coerces or validates, so `''` is held as
`''` (AC3) by construction rather than by a new guard. The docblock notes it alongside the existing
`''`-is-a-value fields.

### 6. `src/renderer/src/screens/conversation/runConfigSnapshot.ts` — `toRunConfigSnapshot`

`permissionMode: event.permissionMode` in the snapshot literal. Unconditional, like every other
field, so `''` flows through — no `??`, no truthiness check. `toSnapshotSessionId` is untouched.

### Contract summary

| Layer | Symbol | Field name | Type |
|---|---|---|---|
| wire | `SessionSettingsPayload` | `permission_mode` | `string` (required) |
| decode | `parseSessionSettingsPayload` | `permission_mode` | `string`, `requireString` |
| IPC | `runConfigReceived` arm | `permissionMode` | `string` |
| store | `RunConfigSnapshot` | `permissionMode` | `string` |

### Not on the chain

`src/renderer/src/store/daemonEventBridge.ts` — its `runConfigReceived` arm is a documented no-op
reading no field. `runConfigLive.ts` passes snapshots through opaquely. `RunConfigSections.tsx` /
`ConversationScreen.tsx` carry a `windowTokens` **prop**, not a snapshot, and do not move.

## State + concurrency model

No new state, no new async work, no new subscription, no new store. The one store touched
(`runConfigStore`) gains a field on an existing interface; its single setter, its whole-object
replace semantics and its "most recent snapshot wins" contract are unchanged. No timers, no
`AbortController`, no listener registration is added or removed, so there is nothing new to tear
down. The existing app-lifetime listener in `RunConfigLiveData` and the sheet's per-open request keep
their current lifetimes.

Re-render seams are unchanged: the snapshot is already replaced as a whole object on every reply, so
one more field on it changes no selector's notification behaviour.

## Error handling

- **Malformed frame** — `parseSessionSettingsPayload` throws `WireDecodeError` when
  `permission_mode` is absent or not a string, before any log call, so a rejected frame leaves no
  record. `daemonConnection` catches at the decode call site and drops the line, which is the
  existing behaviour for every other required field on this payload.
- **Old daemon** — the frame is rejected whole and the sheet stays at its last-known values (or
  `null`). This is the accepted coupling named in Context, not a failure the client recovers from.
  AC5's real-daemon gate is the detector.
- **Hostile daemon** — a value outside the six mode names decodes fine and is held verbatim. That is
  correct here: this ticket ships no consumer, and #682 is where an unknown mode's *display*
  behaviour is decided. Nothing on this chain branches on the value.

## Testing strategy

All vitest (`environment: 'node'`); no renderer-render test is needed because this ticket renders
nothing, and no new Playwright spec because there is no interaction. RED first at each layer.

**`src/main/transport/inboundMessage.test.ts`** — the decode boundary, where AC1, AC3 and AC4 are
falsifiable:

- a full `session_settings` frame narrows with `permission_mode` carried verbatim (extends the
  existing "all six fields" test, whose title becomes seven);
- `permission_mode: ''` decodes as `''` — asserted beside `session_id: ''` in the existing all-zeros
  case, so the pair is read together (AC3);
- a frame missing `permission_mode`, and one carrying a non-string (`42`, `null`), each throw
  `WireDecodeError` (AC1) — `toThrow`, not `toBeNull`, per the two-fail-signals distinction above;
- **new pin, two halves:** a `session_settings` frame whose `permission_mode` is a distinctive
  sentinel logs content-free — the emitted `DiagnosticEvent` carries `event`, `code`, `bytes`, `hash`
  and no field value, and the serialised record contains neither the sentinel nor any other payload
  value; **and** a frame whose `permission_mode` is malformed emits **no record at all**, so a
  hostile daemon cannot route a value into the diagnostic log through the reject path (AC4). There is
  no such pin for this frame today (only for `session_settings_updated`), so both halves are new
  rather than inherited. (Security review finding 2.)

**`src/main/daemonConnection.test.ts`** — the emit carries `permissionMode` verbatim onto
`runConfigReceived`, including `''`, and the emitted event object carries no snake-case
`permission_mode` key (proving the named copy, not a spread).

**`src/renderer/src/screens/conversation/runConfigSnapshot.test.ts`** — `toRunConfigSnapshot` copies
`permissionMode` verbatim, `''` included, and unrelated events still map to `null`.

**`src/renderer/src/store/runConfigStore.test.ts`** — the verbatim hold; covered by extending the
existing all-defaults fixture rather than a new test, since the store's contract is unchanged.

Fakes over mocks throughout: the decode tests build real encoded frames through the existing
`encodeSessionSettings` helper; the emit test uses the existing fake sink.

**The fixture cascade.** Adding a required field to three shapes reddens every literal constructing
one. Counted 2026-09-03: `SessionSettingsPayload` literals in `inboundMessage.test.ts` (a shared
`RUN_CONFIG` base plus explicit standalone literals) and the **three e2e baselines**;
`runConfigReceived` literals across `runConfigSnapshot.test.ts`, `daemonConnection.test.ts`,
`runConfigLive.test.ts`, `logDataDownload.test.ts`, `announcedModelBridge.test.ts`,
`questionBridge.test.ts`; `RunConfigSnapshot` literals across `runConfigStore.test.ts`,
`runConfigSnapshot.test.ts`, `runSettingsWriteStore.test.ts`. Roughly forty one-line edits across
about a dozen files.

The three e2e baselines sit **outside `tsconfig.node.json`**, so `npm run typecheck` stays green when
they are missed and the failure surfaces instead at runtime as the seeded frame being
decode-rejected — which reads as the footer controls and the sheet rendering nothing at all, i.e.
like a mount bug rather than a fixture gap. They are edited from the grep list, not from the
compiler's output, and re-greped before commit.

**AC5 is not run here.** The ticket carries `needs-real-claude`; `npm run e2e:real:gate` is the
operator's gate on this fork, not the builder's, and the ticket parks in Inbox after verification for
it. `e2e/real-daemon-session-settings.spec.ts` already exists and needs no edit — it drives a real
daemon, so it seeds no `SessionSettingsPayload` literal.

## Size

Two lines of the size-S table are exceeded, stated rather than split away:

- **Production source files: 6, against a boundary of 5.**
- **Consumer call sites needing simultaneous update: ~40, against a boundary of 10** — the fixture
  cascade above. Counted raw; not discounted for being one line each.

Total written work re-measured against this plan: production ≈ 35 lines, tests ≈ 150, e2e fixtures 3,
this plan ≈ 210 — around 400, comfortably inside the 800 ceiling and below the refiner's ~850
estimate, because each cascade edit is a single line.

**The floor decides it.** The only clean split is main-side decode (files 1–2) from
bridge-and-renderer (files 3–6), and the decode half's sole consumer is the renderer half in this
same family: on its own it lands a field nothing reads, which no verifier can check independently.
Per the builder brief, when the floor and the ceiling disagree the floor wins — merge, state the
overage, build. The other split the cascade pattern suggests (land optional, migrate fixtures, then
require) would ship a tolerant decode contradicting the no-`omitempty` contract this ticket exists to
mirror, purely as build staging.

Split depth is not the operative rule here (the floor is), but for the record #1020 is split from
#682, so a further split would be a third generation.

## Open questions

1. **Does the existing `session_settings` decode arm already emit a `DiagnosticEvent` with no payload
   field?** Read as yes from the arm's code (`event`, `code`, `bytes`, `hash` only), but there is no
   test pinning it. Resolved in Phase B by writing that pin (AC4) and confirming it passes without a
   production change; if it does not, the production change to make it content-free is in scope.
2. **Is `RunConfigSnapshot` reached by any `Pick`/`Omit`/index-signature consumer that a seventh field
   would silently widen?** `selectEffectiveSettings` uses an explicit three-key `Pick`, so no. Any
   further consumer surfaced by the typecheck is recorded here as a `## Revisions` entry.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two boundaries are crossed and both are explicit, single-symbol
  and pre-existing: relay → main at `parseSessionSettingsPayload` (one named narrower, not scattered)
  and main → renderer at the `session-settings` emit in `daemonConnection`, which builds a fresh
  named-field literal rather than spreading the decoded payload — so a decoder that later grows a
  field cannot smuggle it across. Direction matters: this is main → renderer, not the renderer →
  main direction the checklist flags as untrusted-to-trusted. The *data* is nonetheless
  daemon-asserted and untrusted, which finding 1 below is about. Downstream holders know it: the
  field is typed `string` on a sealed union arm whose comment now states the trust tier.
- **[Trust boundaries] SHOULD FIX (finding 1, folded into Design §4).** The field is untrusted,
  unbounded-by-this-code, *deliberately un-allowlisted* text (AC2 forbids a client-side allowlist)
  and #682 is the first render surface for it. As designed here it is exploitable by nobody — this
  ticket ships no consumer, no sink, and no branch on the value — but the constraint must be
  recorded where #682 will read it. Phase B carries the `ModelAnnouncedPayload.model` warning onto
  the `runConfigReceived` arm: plain text only, never markup / attribute / URL / filename / cache key
  / lookup path, and never a control input. Not a gate, because nothing consumes it yet.
- **[Trust boundaries]** No finding — prototype pollution. `requireString` reads `payload[field]`,
  which walks the prototype chain, so a polluted `Object.prototype.permission_mode` would satisfy a
  frame that omits the key. This is (a) identical for all six existing fields on this payload, so not
  introduced here, and (b) unreachable from the wire: the payload arrives via `JSON.parse`, which
  round-trips `__proto__` as an ordinary own key and writes no prototype, and nothing on this path
  does `obj[k] = v` with a daemon-supplied key. Pre-existing shape, out of scope, named rather than
  silently inherited.
- **[Tokens, secrets, credentials]** Not applicable, by the nature of the field. `permission_mode` is
  a posture name from a closed six-name vocabulary — the same tier as `model` / `effort`, and less
  sensitive than `session_id`, which this repo already documents as a routing id and not a secret. No
  token is generated, stored, rotated, revoked or compared; no credential path is touched.
- **[File / storage operations]** No findings, by construction. No filesystem path is built,
  concatenated or resolved; the field never becomes a filename, cache key or lookup path (now stated
  in the arm's comment, per finding 1). `runConfigStore` is in-memory renderer state built on
  `zustand/vanilla`'s `createStore` with **no persist middleware** — nothing here reaches disk,
  `localStorage`, `sessionStorage` or IndexedDB, so no at-rest, atomic-write or `safeStorage`
  question arises.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` API, no `ipcMain.handle` / `.on`, no `webPreferences` change, no protocol handler,
  no navigation surface. The field rides an **existing** arm of an existing sealed union on the
  existing daemon-event channel. Process placement is preserved and is the point of the design: the
  decode stays in main, the renderer receives an already-typed `string`, and no key, socket or raw
  byte moves toward the web layer. Because the field is required and always a `string`, the
  structured-clone `undefined`-preservation trap on `webContents.send` cannot arise.
- **[Cryptographic primitives]** Not applicable. No RNG, no key, no nonce, no derivation, and no
  comparison of an attacker-controlled value against a secret is added. The Noise variant constant
  and the handshake are untouched. The AC4 pin reuses the existing one-way `hashPlaintext`; it does
  not introduce or modify a primitive.
- **[Network & I/O]** No findings. No socket, timeout, reconnect path, TLS setting or relay URL is
  touched. Length is bounded upstream rather than here: `parseInboundMessage`'s existing
  oversized-plaintext check rejects the frame before the narrower runs, so a hostile daemon cannot
  use `permission_mode` as an unbounded-allocation vector — the cap is inherited, not newly needed.
- **[Error messages, logs, telemetry]** SHOULD FIX (finding 2, folded into Testing strategy).
  `requireString`'s message interpolates the **field name**, a client-owned constant, never the
  payload value — correct as-is. The decode arm narrows *before* logging and emits only
  `event` / `code` / `bytes` / `hash`, and `emitDaemonEvent` is log-free by construction, so no mode
  value can reach a sink on either side of the bridge. But none of that is pinned for this frame
  today (only for `session_settings_updated`), so AC4 currently rests on reading the code. Phase B
  adds the pin in **two halves** — content-free on the success path, and **no record at all on the
  reject path**, closing the route by which a hostile daemon might land a value in the diagnostic log
  via an error. Not a gate: the behaviour is already correct; the test is what keeps it correct.
- **[Concurrency]** Not applicable, and the reason is that this ticket adds zero async. No timer,
  listener, subscription, promise or `AbortController` is created or removed, so there is nothing new
  to cancel or tear down. The store's single setter is a whole-object replace that reads no prior
  state, so there is no check-then-act gap across an `await` and no critical section to guard.
  Shutdown and duplicate-connection behaviour are untouched.
- **[Threat model alignment]** Addressed for the three that apply; one deferral.
  *Malicious / compromised relay* — content-blind and on-path, so it cannot forge this field (it is
  inside the Noise session); dropping or delaying the reply degrades to "the sheet keeps its last
  values", which is the existing behaviour and not a new failure.
  *Hostile daemon response* — the live threat, addressed by fail-closed narrowing (missing or
  non-string throws before any log), by consuming the value nowhere, and by the finding-1 constraints
  recorded for the eventual consumer. A value outside the six mode names decodes and is held
  verbatim, which is correct here: no allowlist is AC2's explicit instruction, and the read half must
  not narrow to the write half's five.
  *Token theft from disk* — nothing new reaches disk.
  *Renderer compromise reaching the transport* — unchanged; this ticket moves nothing toward main.
  **OUT OF SCOPE, deferred to #682:** the display-side treatment of a mode name outside the six, and
  any length bound on the rendered label. #682 owns the first render surface and is where those
  decisions belong; this ticket records the constraint rather than pre-deciding it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
