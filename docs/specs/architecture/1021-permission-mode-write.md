# #1021 — let a settings change name a permission mode

The `set_session_settings` write half gains a fourth field, `permission_mode`, mirroring upstream
pyrycode#1687. This is the symmetric twin of #1020, which threaded the same field in on the READ half
(`session_settings` → `RunConfigSnapshot.permissionMode`). No consumer is built here; the control that
submits a mode is #682.

## Files read

- `src/shared/wire/types.ts` → `SetSessionSettingsPayload` — the outbound payload the new optional key
  joins; its docblock states the omitempty presence contract and carries the Go-struct mirror that goes
  stale. Also `SessionSettingsPayload.permission_mode` (#1020's read half, a required plain `string` with
  no union and no allowlist) — the posture this ticket keeps — and `WireModelOption.supports_auto_mode`,
  whose docblock already names this field's write-half closed five against the read half's six. **That
  last docblock is an anchor and must not be edited.**
- `src/shared/ipc/commands.ts` → `isSetSessionSettingsPayload` — the untrusted renderer→main boundary
  guard; the per-optional `in`-then-`typeof` idiom the new check clones, and the docblock's "four modeled
  keys" phrase.
- `src/main/transport/setSessionSettingsEnvelope.ts` → `buildSetSessionSettings` — the fresh-literal
  builder that OWNS the presence contract and doubles as the anti-smuggling net; its file docblock carries
  the second Go-struct mirror and the second "four modeled keys" phrase.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `SettingsChange`, `applyConfirmed`,
  `selectEffectiveSettings`, `selectPendingFields`, `RunSettingsWriteState['confirmed']`,
  `reduceRunSettingsWrite`'s `reconnected` arm — the union to widen, the three exhaustive switches, and
  the arm whose docblock warns that a *pending-scoped* future field needs hand-wiring (it does not here —
  see Design).
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `buildSettingsPayload` — the per-field switch that
  emits `session_id` plus exactly one key, and `submitSettingsChange`, its sole caller.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `RUN_CONFIG_ERROR_COPY` (a total
  `Record` over `SettingsChange['field']`, compiler-forced) and `RunConfigView`'s `pending` prop, typed
  `ReturnType<typeof selectPendingFields>`, which is what cascades into the test fixtures.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot.permissionMode` — #1020's landed field;
  the selector's widened return `Pick`s from it, so no new type is minted.
- `docs/knowledge/features/session-settings-send.md` § "The omitempty presence contract" and § "Security
  properties" — the prior tickets' ruling that the BUILDER's conditionally-keyed fresh literal, not the
  command guard, is the deterministic net bounding the outbound wire. This ticket inherits that division
  rather than moving policy into the guard.
- `docs/knowledge/features/run-settings-write-store.md` — the store's fail-closed correlation posture and
  the sparse-overrides-composed-over-the-snapshot doctrine the new field joins unchanged.

## Design source

**Figma:** N/A — the ticket carries no `## Figma` section by design. Nothing this ticket adds reaches a
pixel: the Run configuration sheet keeps its four sections and its YOLO toggle, the new error-copy string
is required by a total `Record` but rendered nowhere, and the new in-flight boolean on the widened
`pending` prop is unread. The visual-fidelity check is intentionally skipped.

## Context

A client can currently reach only two of claude's six postures, because the only posture control on the
wire is the boolean `yolo`. Upstream added `permission_mode` to `set_session_settings` in pyrycode#1687;
this repo picked up the read half in #1020 and not the write half. #682's footer permission-mode menu
needs a named mode to submit, and this is the path it submits through.

The upstream contract, from `pyrycode/internal/protocol/settings.go` and
`internal/relay/v2session_settings.go`:

- `permission_mode` is `*string` with `omitempty` — the same presence contract `model` / `effort` / `yolo`
  already carry.
- The accepted vocabulary is claude's five non-escalating modes: `default`, `acceptEdits`, `plan`, `auto`,
  `dontAsk`, checked at `validPermissionMode`, a closed enum.
- `bypassPermissions` is **refused** on this field. The escalation keeps exactly one spelling on the wire,
  `yolo: true`. This is deliberate upstream, not an oversight to route around.
- Present-at-`""` is refused, unlike `model` / `effort` where `""` means "run at claude's own default".
- A frame carrying **both** `permission_mode` and `yolo` is refused as malformed, checked before the
  mode's value, so that refusal is unconditional.
- Every refusal replies with the same fixed constant, so a client cannot tell them apart, and the daemon
  logs none of them.

**No ADR is warranted.** This ticket adds no new decision — it extends a contract #263 already recorded
and #1020 already re-affirmed on the read side.

## Design

One new arm on an existing union, threaded through the five sites the compiler forces. No new exported
type, no new module, no new IPC channel.

### The seam chain

| Layer | Symbol | Change |
|---|---|---|
| wire type | `SetSessionSettingsPayload` | `permission_mode?: string` — a fourth optional under the same omitempty contract |
| IPC guard | `isSetSessionSettingsPayload` | one more `in`-then-`typeof === 'string'` clause |
| envelope builder | `buildSetSessionSettings` | one more `!== undefined` conditional key assignment |
| change union | `SettingsChange` | `\| { field: 'permissionMode'; value: string }` |
| payload build | `buildSettingsPayload` | one more `case` returning `{ session_id, permission_mode: change.value }` |
| store confirm | `applyConfirmed` | one more `case`; `confirmed` gains `permissionMode?: string` |
| store selectors | `selectEffectiveSettings`, `selectPendingFields` | one more `case` **and a widened return type** |
| error copy | `RUN_CONFIG_ERROR_COPY` | one more key on the total `Record` |

### Naming

The renderer and IPC side spell the field camelCase — #1020 landed `permissionMode` on both
`RunConfigSnapshot` and the `runConfigReceived` event — and the wire key stays snake_case
`permission_mode`. The `SettingsChange` arm therefore reads `{ field: 'permissionMode'; value: string }`
and `buildSettingsPayload` performs the one spelling change, at the same seam every sibling field already
crosses. No third spelling is introduced.

### The two selectors' return types widen deliberately

This is the trap the ticket names and the one thing here that is not mechanical. The compiler forces a
`case`, **not a returned field**: a `case` that assigns a local and never threads it into the return
object satisfies `assertNever` while leaving the overlay and the in-flight flag silently dead. Both
returns are widened by hand:

- `selectEffectiveSettings` returns `Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo' |
  'permissionMode'>` — `RunConfigSnapshot` already carries `permissionMode` from #1020, so this mints no
  type. The composed line is `permissionMode ?? s.confirmed.permissionMode ?? snapshot?.permissionMode ??
  ''`, the existing pending > confirmed > base > zero order verbatim, `??` so an empty string at any layer
  is held rather than coerced.
- `selectPendingFields` returns `{ model, effort, yolo, permissionMode }: boolean`.

Both widenings are additive, so the three existing consumers that read only `.model` / `.effort`
(`ComposerModelMenu`, `ComposerEffortMenu`, `RunConfigSections`) are untouched.

### What deliberately does NOT change

- **The `reconnected` arm needs no hand-wiring.** Its docblock warns that a future *pending-scoped* field
  must be added by hand. `permissionMode` is not one: it is an arm of `SettingsChange`, which lives
  *inside* the `pending` Map, and the arm replaces that Map wholesale with a fresh empty one. The new
  field is cleared for free.
- **No cross-field check anywhere.** `buildSettingsPayload` returns a fresh literal with exactly one key,
  so the both-fields refusal is honoured by construction. Nothing is added to enforce it, and nothing is
  added that could violate it.
- **No client-side allowlist, normalisation, repair, or mode↔yolo mapping** (AC3). See § Security review
  for why an allowlist here would be a false boundary rather than a control.

### Prose that goes stale, and one anchor that must not move

Four counts change because a fourth optional key lands: the `Model, Effort *string; YOLO *bool` Go-struct
mirror in `types.ts`'s `SetSessionSettingsPayload` docblock and again in `setSessionSettingsEnvelope.ts`'s
file docblock, plus the "four modeled keys" phrase in that same builder docblock and in
`isSetSessionSettingsPayload`'s docblock. Two test names in `setSessionSettingsEnvelope.test.ts` say "four
keys" and go with them.

`WireModelOption.supports_auto_mode`'s docblock in `types.ts` states the write half's closed five and the
read half's six correctly and post-#1020. It is an anchor naming the contract, not a stale claim. **Do not
touch it.**

## State + concurrency model

No new async work, no new subscription, no new timer, no new listener, and no new cancellation path. The
store gains one union arm; every transition it participates in (`changeDispatched` → optimistic overlay,
`settingsConfirmed` → commit, `settingsRejected` → rollback + `error`, `reconnected` → clear) is the
existing machinery reached through the existing correlation key. The fail-closed no-op on an unmatched
`changeId` covers the new arm unchanged, because the lookup is by `changeId` and never by field.

## Error handling

Unchanged in structure. A daemon refusal — whichever of the five reasons fired, since they share one fixed
constant — arrives as `sessionSettingsRejected` carrying only the client's own `changeId`, deletes the
pending marker (which *is* the rollback: the overlay vanishes and the effective value falls through to the
confirmed override or the snapshot base), and sets `error: 'permissionMode'`. `RUN_CONFIG_ERROR_COPY`
gains a client-owned, apostrophe-free string for that field, required by the total `Record` and rendered
nowhere in this ticket.

**A note for #682, not a defect here:** `selectEffectiveSettings().permissionMode` composes a client-owned
pending/confirmed value over a **daemon-authored** snapshot base, and the read half reports six modes while
the write half accepts five. The composed value can therefore legitimately be `bypassPermissions`, which
the write half refuses. A consumer must not offer the currently-displayed value back as a submittable
option without filtering it. Naming it here so it does not cost #682 a cycle.

## Testing strategy

All vitest; nothing renders, so no Playwright spec. RED first at each layer.

`src/main/transport/setSessionSettingsEnvelope.test.ts`
- a lone `permission_mode` crosses the wire carrying `session_id` and **no `yolo` key** — AC1's assertion,
  made on the built payload rather than on the type
- `permission_mode: ''` present-at-zero survives, because the builder tests `!== undefined` and is not the
  value-policy point (the daemon refuses `''`; the builder must not pre-empt it with a truthiness test)
- the all-present case now carries five keys; the omit-everything case asserts `permission_mode` absent
- the two "four keys" test names become five

`src/shared/ipc/commands.test.ts`
- a `permission_mode` string is admitted, including `''` (type check, not emptiness)
- a non-string `permission_mode` is rejected; an absent one is accepted
- the fully-populated accept gains the key

`src/renderer/src/store/runSettingsWriteBridge.test.ts`
- a `permissionMode` change builds `{ session_id, permission_mode }` and nothing else — asserted with an
  explicit `not.toHaveProperty('yolo')`
- a value outside the daemon's five is submitted **verbatim**, unmapped and unrepaired (AC3)

`src/renderer/src/store/runSettingsWriteStore.test.ts`
- optimistic overlay, confirm-commits, reject-rolls-back-and-sets-`error` for the new field
- `selectPendingFields` flags it and clears it on resolution
- the two whole-object `toEqual` assertions gain their key, and the null-snapshot fallback gains
  `permissionMode: ''`

`src/renderer/src/screens/conversation/RunConfigSections.test.tsx`
- fixture-only: the shared `NONE` const plus the four full `pending={{ … }}` literals gain a key. The
  `{...NONE, x: true}` spread sites inherit it for free.

## Size

**Two size-S lines are exceeded, stated rather than split away — the floor rule wins over the ceiling.**

- Production source files: **6** (ceiling 5). The sixth is a single copy string in `RunConfigSections.tsx`
  that the total `Record` makes mandatory.
- Total written work: **~900 lines** (ceiling 800), of which ~55 are production code across the six files;
  tests, the stale-prose edits and this plan are the rest.
- Every other line holds: 0 new exported types, 4 acceptance criteria, no state-machine reject branches.

Splitting was considered at two seams and rejected at both. Cutting the wire/guard/builder half from the
store half leaves a slice whose only consumer is its sibling in the same family — the one-consumer slice
the floor rule merges back. Cutting the two selectors from the union arm lands a `case` that discards its
value, which is exactly the dead slice the floor rule forbids and exactly the failure AC4's second clause
exists to prevent. And a type widening cannot be split from its own fixture fixup without leaving `main`
red in between. Depth checked: parent #682, no grandparent. Nearest analogue #988, verified at merge at
1380 lines / 4 production files.

## Open questions

1. Should `isSetSessionSettingsPayload` reject a payload carrying **both** `permission_mode` and `yolo`,
   mirroring the daemon's unconditional malformed-frame refusal? Resolved in § Security review: **no** —
   it would move value policy into a guard the codebase deliberately keeps structural, could drift from
   upstream, and defends nothing (the only actor who can produce that frame has a strictly stronger option
   available). Recorded here so the verifier sees the omission is a decision.
2. Is `''` worth a builder test given the daemon refuses it? Resolved: **yes** — the test pins that the
   builder still uses `!== undefined` rather than a truthiness test, which is the presence contract's own
   invariant and independent of what the daemon does with the value.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds no boundary; it widens one that exists. The
  renderer→main crossing stays the single explicit `isSetSessionSettingsPayload` guard, and the new clause
  clones the sibling `in`-then-`typeof` idiom rather than parsing in a second place. Downstream the value
  is re-keyed into `buildSetSessionSettings`'s fresh literal, so the shape reaching the wire is decided by
  main, not by whatever the renderer sent.
- **[Trust boundaries — the escalation question]** No findings, and this is the category that mattered
  most. A compromised renderer can put any string in `permission_mode`, including `bypassPermissions`.
  That grants nothing: the daemon's `validPermissionMode` is a closed enum that refuses it, and the same
  compromised renderer already has the strictly stronger `yolo: true` arm sitting next to it, which grants
  bypass outright. The new field is therefore **weaker than the capability already exposed**, and adds no
  reachable state. This is also the argument against a client-side allowlist (which AC3 forbids anyway):
  it would read as a security boundary while the stronger unguarded arm sits beside it, and it would drift
  from `validPermissionMode` the first time upstream adds a mode.
- **[Trust boundaries — the both-fields frame]** No findings. The guard is structural-minimum and does not
  reject `permission_mode` and `yolo` on one payload; the daemon refuses that frame unconditionally as
  malformed. The intended path cannot produce it (`buildSettingsPayload` emits one key), so the only
  producer is a compromised renderer, whose worst outcome is its own request being refused — a self-DoS on
  a capability it already holds, not an escalation. Adding the cross-field check would re-implement a
  daemon rule client-side, against this file's structural-guard convention. Open question 1, resolved.
- **[Tokens, secrets, credentials]** Not applicable by design. This path mints no token, reads none, and
  stores none. `session_id` is a routing id of the same class as `conversation_id` (stated in
  `SetSessionSettingsPayload`'s docblock), and `changeId` is a client-minted, IPC-internal correlation key
  that never reaches the wire. `permission_mode` is a posture name, not a credential.
- **[File / storage operations]** Not applicable. No filesystem path is constructed, read, or written; no
  `safeStorage` surface is touched. The value never becomes a filename, a cache key, or a lookup path —
  the CLAUDE.md sink rule holds trivially because the value's only destination is a JSON literal.
- **[Prototype pollution — the sink that is live here]** No findings, and the posture is load-bearing
  rather than incidental. `applyConfirmed` commits through a per-field `switch` with a literal key
  (`{ ...confirmed, permissionMode: change.value }`), **never** a computed `confirmed[change.field] =
  change.value`. The new arm keeps that. `RUN_CONFIG_ERROR_COPY[field]` indexes with a union literal, not
  free text. No object on this path is ever keyed by a daemon- or renderer-authored string.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow` option, no `contextBridge`
  API, no `ipcMain` channel, and no protocol handler is added — the `setSessionSettings` command already
  exists and this widens its payload only. The main-only builder keeps its `codec.ts`/`Buffer` import and
  is not re-exported through a renderer barrel, so raw bytes stay out of the web layer.
- **[Cryptographic primitives]** Not applicable. No RNG, no key, no nonce, no comparison against a secret.
  `nextEnvelopeId` is untouched and remains a monotonic application id, not a Noise nonce.
- **[Network & I/O]** No findings. The new key is bounded by the existing cap: an oversized value makes
  `buildSetSessionSettings` throw `WireEncodeError` past `MAX_PLAINTEXT_BYTES`, which the sole caller
  catches and drops. No new socket, no new timeout, no new reconnect path.
- **[Error messages, logs, telemetry]** No findings. This ticket adds no log line. The daemon logs none of
  the five refusals and replies with one fixed constant, so nothing distinguishing reaches the client to
  leak; the rejection event carries only the client's own `changeId`, never daemon text (#269's strip).
  The error copy is client-owned and apostrophe-free, per the `RUN_CONFIG_ERROR_COPY` convention.
- **[Concurrency]** No findings. No async task, listener, or timer is created, so there is nothing new to
  cancel. The stranding path #539 closed stays closed for the new field for free: `reconnected` replaces
  the whole `pending` Map, and the new field lives inside it rather than beside it.
- **[Threat model alignment]** *Hostile daemon* — the daemon cannot forge a confirmation for this field
  any more than for the existing three: a forged `in_reply_to` finds no pending entry and is dropped
  (#261's fail-closed lookup). *Malicious relay* — content-blind and unchanged; the field rides inside the
  Noise session. *Renderer compromise* — addressed above: no new capability. *Token theft* — no token on
  this path. **Out of scope, named:** whether a rendered control may offer `bypassPermissions` back to the
  daemon is #682's, not this ticket's — flagged under § Error handling so it is not rediscovered there.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
