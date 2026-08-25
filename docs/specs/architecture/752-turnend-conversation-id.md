# #752 — carry the conversation id on the `turnEnd` IPC arm

**Size:** S (2 production files, ~10 production lines, 6 fixture literals, 5 comment/name retirements, 1 new test)
**Base:** `main` at `65dec7e` — #751 (PR #761) is **merged**. Every citation below was re-measured against that base, not against the ticket body's projection.

## Design source

N/A — transport/IPC only. The change is one field on an internal `main → renderer` union arm; it renders nothing and `ThreadEvent` is untouched, so there is no visual surface and no Figma node. The visual-fidelity check is intentionally skipped.

## Files to read first

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:105-132` | The **whole** v2 interactive-stream comment region. `:109-129` is #751's assistantDelta block — the exemplar to mirror. `:131` is the turnEnd one-liner AC4 must retire, `:132` the arm to widen. |
| `src/shared/ipc/events.ts:133-147` | The `turnState` arm (#214/#724) — the *other* precedent, and the one whose comment sets the "routing key, not rendered text" terms. |
| `src/main/daemonConnection.ts:585-608` | The `assistant-delta` emit as #751 left it — the comment and the named-field literal this ticket copies. This is the idiom the other arms cite by name. |
| `src/main/daemonConnection.ts:609-615` | The `turn-end` emit. The **entire** production change on this side is one added line inside this literal. |
| `src/main/transport/inboundMessage.ts:562-570` | `parseTurnEndPayload`. `requireString(payload, 'conversation_id')` at **`:566`**, returned on the literal at `:569`. **Read it before writing any decode code — there is none to write.** |
| `src/shared/wire/types.ts:261-270` | `TurnEndPayload` — `conversation_id, turn_id, stop_reason`, all required, no `omitempty`. Unchanged by this ticket. |
| `src/main/daemonConnection.test.ts:1339-1392` | The structured-stream describe block. `TURN_END` fixture at `:1341`; the turn_end test at `:1381-1391`. **Read `:1352-1365` first** — #751's finished assistant_delta test is the shape to copy, including its inverted leak guard at `:1364`. |
| `src/main/transport/inboundMessage.test.ts:751-766` | The two shipped fail-closed decode tests. `:753` is already `{ ...TURN_END, conversation_id: undefined }` — **the missing-id case is tested at the decode layer today.** Read this before writing the new test, so you scope it to the *emit* layer instead of duplicating this. |
| `src/renderer/src/store/timelineBridge.ts:41-42` | `translateTimelineEvent`'s `turnEnd` case — a fresh three-field literal. **Do not change it.** This is where the id stops. |
| `src/renderer/src/store/threadTimeline.ts:124` | The `ThreadEvent` `turnEnd` arm. **Do not change it.** |
| `src/renderer/src/store/pushNotifyBridge.test.ts:28-30, 102-112` | The `-XYZ` fixture convention and the leak assertion that depends on it. See § The `-XYZ` convention. |

`docs/lessons.md` does not exist in this repo. Knowledge docs under `docs/knowledge/` mention `turnEnd` but are owned by the documentation phase — **do not edit them**.

## Context

`TurnEndPayload` carries `conversation_id` on the wire and the decoder already validates it, but the emit drops it. The renderer is moving to one timeline per conversation (#675), and a turn boundary that cannot be attributed closes the wrong thread's turn. This is child B of the #675 split: #751 widened `assistantDelta`, this widens `turnEnd`, #753/#754 follow with `toolUse`/`toolResult`.

The design is fully determined by five shipped precedents (`turnState` #724, `stallDetected` #732, `apiRetry`/`compacting` #742, `assistantDelta` #751). This spec's value is not the design — it is the **measured** cascade below, which differs from the ticket body's projection in three places.

## Design

### Production change — 2 files, and that is all

**1. `src/shared/ipc/events.ts:132`** — add the field to the arm:

```ts
| { type: 'turnEnd'; turnId: string; stopReason: string; conversationId: string }
```

Required, never optional. An optional routing key invites the `?? activeConversation` fallback that #675 exists to remove.

**2. `src/main/daemonConnection.ts:610-614`** — add one line to the existing literal, reading the id **bare**:

```ts
conversationId: inbound.turnEnd.conversation_id
```

Copied **by name** onto the existing fresh literal — never a spread of `inbound.turnEnd`, so a decoder that later grows a field cannot smuggle it across IPC.

### There is no decode change — do not write one

`parseTurnEndPayload` (`inboundMessage.ts:562-570`) already does `requireString(payload, 'conversation_id')` at `:566` and returns it at `:569`. A missing or non-string `conversation_id` already throws `WireDecodeError` and drops the whole frame before any emit runs — and this is **already pinned by a shipped test**: `inboundMessage.test.ts:753` feeds exactly `{ ...TURN_END, conversation_id: undefined }` and expects a throw. **AC2 is true by construction on `main` today.** #751 hit the identical situation one arm over and correctly wrote zero decode lines.

That shipped test is at the **decode** layer. The new test in § Testing belongs at the **emit** layer — same input, different assertion (nothing crosses IPC, rather than the parser throws). Write it there, and do not duplicate `:751-766`.

The live risk AC2 guards is entirely at the **emit**: `inbound.turnEnd.conversation_id` is already typed `string`, so reaching for `?? ''` or `?? activeConversation` there would convert a fail-closed drop into a silent misattribution — the exact bug this work exists to remove. The new test in § Testing is therefore a **guard against a future regression**, not a fix for present behaviour. Say so in its name and comment so a later reader does not mistake it for a bug fix.

### Comment rewrites — keep them tight

Both comment blocks must stop claiming the arm carries only two fields.

- `events.ts:131` — replace the one-liner with a **compact** block (aim ~6-9 lines, wrap at **≤108 columns** to match the block above). It sits three lines under #751's 21-line assistantDelta block, which already states the routing-key / required-never-optional / fail-closed / no-secret reasoning in full. **Defer to it explicitly** ("for the reason the delta arm above carries it") rather than restating it. Two near-identical 21-line blocks three lines apart is worse writing, and see § Citation drift for the second reason to stay short.
- `daemonConnection.ts:609` — the `turn-end` case currently has **no** comment. Add a short one mirroring `assistant-delta`'s at `:586-600`, compressed the same way: name the by-name copy, the bare read, and the fact that the decode needed no change.

Both must state that the id is a daemon-asserted **routing key**, not rendered text — none of the untrusted-text warnings that attach to `model` / `description` / `raw` apply to it, and it reaches no log sink.

### Consumers are unchanged — verified, not assumed

- `timelineBridge.ts:41-42` rebuilds a fresh `ThreadEvent` from named fields; `ThreadEvent` (`threadTimeline.ts:124`) carries no conversation id. The id **stops at the bridge**. Routing lands in #756.
- `daemonEventBridge.ts:53` groups `turnEnd` into a `return null` fallthrough — no field access.
- `pushNotifyBridge.ts:32` maps `turnEnd` → the closed literal `'turn-complete'` — no field access.
- `modalBridge.ts:75` no-ops it.
- `conversationActivityBridge.ts` handles `turnState` / `stallDetected` / `apiRetry` / `compacting` only (`:111`, `:132`, `:136`, `:141`) — it has **no** `turnEnd` arm and is not touched by this ticket, unlike #751 which did touch its test.

## The AC4 census — five sites, not two

The ticket body names two. **There are five.** `tsc` reaches none of them; vitest reaches exactly one, and only on a second run.

| # | Site | Current text | Why it goes false |
|---|---|---|---|
| 1 | `src/shared/ipc/events.ts:131` | *"turnEnd closes the turn and carries turnId / stopReason — no token, key, or raw frame."* | Counts the fields. **(body named this)** |
| 2 | `src/renderer/src/store/timelineBridge.test.ts:50` | test name *"turnEnd → a ThreadEvent turnEnd with the same fields, a fresh object"* | The `DaemonEvent` input gains a fourth field, the `ThreadEvent` output keeps three — "the same fields" becomes false. **(body named this)** |
| 3 | `src/main/daemonConnection.test.ts:1381` | test name *"decodes an inbound turn_end into one turnEnd carrying turnId/stopReason (camelCase)"* | Enumerates the field set. **Body missed this.** #751 renamed its exact twin (`git show 739151c` — *"carrying turnId/seq/text"* → *"camelCase assistantDelta, conversation id and all"*). |
| 4 | `src/main/daemonConnection.test.ts:1390` | `expect(JSON.stringify(events)).not.toContain('conv-1')` | An **executable assertion that the id does not cross**. It must **invert** to `toContain`, carrying the comment #751 wrote at its twin (`:1362-1363`, guard at `:1364`). **Body missed this.** |
| 5 | `src/renderer/src/store/pushNotifyBridge.test.ts:110` | *"AC4: neither turnId nor stopReason may ride into the payload."* | Enumerates the arm's fields; there are now three. **Body missed this.** |

**The ordering trap on site 4.** Sites 3 and 4 are in the same test. The `toEqual` at `:1389` throws **before** `:1390` ever runs — measured, see § Probe. A developer who fixes `:1389`, re-runs, and sees green has not run `:1390` yet; it fails on the **next** run as a separate, surprising failure. Fix `:1389` and `:1390` in the same edit. This is the trap #751 hit one arm over.

**Do not gate AC4 on `git grep 'only the three known fields'`.** That pattern over-matches `inboundMessage.test.ts:2863` and `:3108` (unrelated `queue_state` / `modal_dismissed` payloads, correctly untouched), so it can never return 0 and reads as a false failure. Anchor greps to the five paths above.

**Correctly untouched, do not widen:** `events.ts:466` and `:489` say *"`conversation_id` dropped at the emit"* for `toolUse` / `toolResult` — those are #753 and #754's arms and are **still true** after this ticket.

## The fixture cascade — measured, not projected

I applied both production edits in this worktree, ran both `tsc` halves and the full vitest suite, and reverted. Results:

**`tsc --noEmit -p tsconfig.node.json` → ZERO errors.** The node half is clean; the one node-side fixture is inside a `toEqual` and is invisible to the compiler. Do not expect `npm run typecheck` to enumerate your work — it will show only the five web-side errors below and then look done.

**`tsc --noEmit -p tsconfig.web.json` → exactly 5 errors**, each `Property 'conversationId' is missing`:

| Site | Typed as |
|---|---|
| `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx:50` | element of `DaemonEvent[]` |
| `src/renderer/src/store/daemonEventBridge.test.ts:117` | argument to `translateDaemonEvent` |
| `src/renderer/src/store/modalBridge.test.ts:119` | element of `DaemonEvent[]` |
| `src/renderer/src/store/pushNotifyBridge.test.ts:30` | `const turnEnd: DaemonEvent` |
| `src/renderer/src/store/timelineBridge.test.ts:51` | `const event: DaemonEvent` |

**`vitest run` → 1 relevant failure:** `daemonConnection.test.ts:1389`, the `toEqual`. This is the sixth "gains" site and is **compiler-invisible** — only the test run finds it.

**Must NOT gain the field** (typed `ThreadEvent`, not `DaemonEvent`) — five sites, none of which the compiler will complain about, so a blind `replace_all` silently corrupts them:

`threadTimeline.ts:124` (the union) · `threadTimeline.test.ts:51` · `timelineBridge.ts:42` · `timelineBridge.test.ts:53` · `timelineStore.test.ts:31`

> **The adjacent-line inversion.** In `timelineBridge.test.ts`, line **`:51`** is a `DaemonEvent` input that **must gain** the field and line **`:53`** is the `ThreadEvent` expectation that **must not** — two lines apart, opposite requirements. Edit them by line number, never with `replace_all` across the file.

**e2e needs no change.** Every fake `turn_end` frame already carries `conversation_id` (`e2e/send-and-stream.spec.ts:57`, `e2e/thread-scroll-pin.spec.ts:98`) and is `satisfies TurnEndPayload` — the wire type, which this ticket does not touch. The e2e `turnEnd` hits are wire-level frames and local helper names, not the IPC arm.

## The `-XYZ` convention in `pushNotifyBridge.test.ts`

`:30` uses deliberately distinctive values (`'turn-XYZ'`, `'end_turn-XYZ'`) and the test at `:111` asserts `not.toContain('XYZ')` — proving no daemon field rides into the notification payload. When adding the field here, **use `conversationId: 'conv-XYZ'`**, not `'conv-1'`. A non-`XYZ` value leaves the existing leak guard vacuous for the new field, silently weakening a shipped AC4 check while the suite stays green. Then update the comment at `:110` (census site 5) to cover all three fields.

## Citation drift in `events.ts` — out of scope, and already the case

Growing the comment block at `:131` shifts every line below it, and nine comments across five files cite absolute `events.ts:<line>` numbers below that point (`threadTimeline.ts:103`, `conversationActivityStore.ts:6` and `:155`, `conversationActivityStore.test.ts:160`, `conversationDeletedBridge.ts:16`, `announcedModelStore.ts:15`/`:61`/`:79`/`:99`).

**Those citations are already stale on `main` today.** I resolved each one: `conversationActivityStore.ts:6` cites `:125,145,172,199` for four arms, but all four of those lines are now mid-comment; `threadTimeline.ts:103` cites `:384-391` for the `toolUse` arm, which is now `backgroundTaskRoster`. #751 grew this same block and shipped without repairing them.

**Explicitly out of scope for #752.** Repairing them would pull four more production files in, taking this ticket to six and past the split threshold for a change that is otherwise two files. It is also the wrong shape: the debt spans arms this ticket never touches, so it wants one sweep, not a fragment per widening — the #742/#743 citation-retirement precedent.

Two things follow for the developer:
- **Keep the new `events.ts` block short** (§ Design). Less drift added to a set that will be swept later.
- **Do not put an absolute `events.ts:<line>` reference in any comment you write.** Refer to arms by name.

**Recommended PO follow-up:** one ticket to retire all nine stale `events.ts:<line>` citations after #753/#754 land, when the block stops moving. Flagging here rather than filing it, since it spans the whole #675 family.

## State + concurrency model

None added. The emit is stateless and un-coalesced: N frames produce N events in arrival order. The added field brings **no** per-id buffer, dedup, last-seq memo, or ordering check. No new async task, timer, listener, or teardown path. `emitDaemonEvent` is a synchronous `webContents.send`.

## Error handling

| Failure | Where caught | Result |
|---|---|---|
| `conversation_id` missing | `parseTurnEndPayload` → `requireString` (`inboundMessage.ts:566`) | `WireDecodeError`, whole frame dropped, **nothing emitted** |
| `conversation_id` non-string | same | same |
| payload not an object | `inboundMessage.ts:563-565` | `WireDecodeError('malformed turn_end payload')` |

All three are pre-existing and already covered by `inboundMessage.test.ts:751-765`. Nothing surfaces to the UI: a dropped frame is silent by design — the misattribution alternative is worse than a missing turn boundary. The error messages name the failure **category** only and interpolate no field value.

## Testing strategy

Unit only (`npm test`, vitest). No e2e change.

**New — one test in `daemonConnection.test.ts`, beside #751's twin at `:1402-1421`:**

- Emit a `turn_end` plaintext built from `{ ...TURN_END, conversation_id: undefined }`, then one from `{ ...TURN_END, conversation_id: 42 }`.
- Assert neither throws, and that `sink.webContents.send.mock.calls.length` is **unchanged** across both — nothing crosses at all, not under a placeholder and not under an empty id.
- The `undefined` case is genuinely the *missing* case: `turnEndPlaintext` → `encodeEnvelope` → `JSON.stringify`, which **drops** an `undefined` property. Verify that chain holds before relying on it; if it did not, the test would be vacuous.
- Name it as a **guard** (the behaviour already holds), and comment that it pins the bare read at the emit — `?? ''` would turn the drop into a misattribution.

**Modified:**

- `daemonConnection.test.ts:1381` — rename (census 3); `:1389` — add `conversationId: 'conv-1'`; `:1390` — invert to `toContain`, with a comment saying the id must reach the renderer verbatim, never dropped and never defaulted.
- `timelineBridge.test.ts:50` — rename so it states the id **stops here** (#751's wording at `:36` is the model); `:51` gains the field, `:53` must not.
- `pushNotifyBridge.test.ts:30` — gains `conversationId: 'conv-XYZ'`; `:110` — comment covers three fields.
- `interactiveRoundtrip.test.tsx:50`, `daemonEventBridge.test.ts:117`, `modalBridge.test.ts:119` — one-token adds.

**Gates:** `npm run build` (both `tsc` halves + build) and `npm test`.

> **Known unrelated flake.** A full `vitest run` on the **clean** tree intermittently fails `src/main/transport/fakeRelayForwarder.test.ts` → *"rejects a pending whenReady() when close() runs before both legs connect"* with `Parse Error: Expected HTTP/, RTSP/ or ICE/`. I reproduced it during the probe and then ran that file alone on a clean tree: **8/8 pass**. It is not caused by this change — do not chase it, and re-run the file in isolation before treating any such failure as yours.

## Open questions

None blocking. One noted above for PO: the `events.ts` citation sweep, best filed once #753/#754 have landed.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds no boundary and moves none. The single untrusted→trusted crossing for this frame is `parseTurnEndPayload` (`inboundMessage.ts:562-570`), which is fail-closed and **unchanged** by this ticket: `requireString` at `:566` rejects a missing or non-string `conversation_id` and drops the entire frame before any emit. Downstream code holds the narrowed `TurnEndPayload` type only. The main→renderer IPC leg carries an already-validated value copied **by name** onto a fresh literal — never a spread — so a decoder that later grows a field cannot smuggle it across. Direction matters: this is main→renderer, the trusted→untrusted direction; it grants the renderer no capability and accepts nothing from it.
- **[Tokens, secrets, credentials]** No findings. `conversation_id` is a daemon-asserted **routing key**, not a credential: it authorises nothing, is not compared against any secret, and is not used to authenticate. It is already carried across this same IPC channel on five other arms (`assistantDelta` #751, `turnState` #724, `stallDetected` #732, `apiRetry`/`compacting` #742) and on `messageReceived`. No token, key, or raw frame is referenced by the widened arm — `TurnEndPayload` has exactly three string fields and `InnerFrameV2` / `QrPayload` / `HelloClientPayload` are not reachable from it. `stopReason` is untouched.
- **[File / storage operations]** Not applicable, and verified rather than assumed: the id reaches no filesystem path, no cache key, no lookup path, and nothing on this leg persists. `emitDaemonEvent` is an in-memory `webContents.send`. No `path.join`, no `fs` call, no `localStorage` / IndexedDB write is added or reached.
- **[Inter-process / Electron attack surface]** No findings. No new `contextBridge` API, no new `ipcMain.handle` / `.on` channel, no `webPreferences` change, no custom protocol or deep link, no navigation handler. The change is one field on an existing arm of an existing union on the existing `DAEMON_EVENT_CHANNEL`. The renderer's inbound surface is a discriminated union it already subscribes to; it gains one `string` it does not act on — `timelineBridge.ts:42` rebuilds a fresh `ThreadEvent` without it. Transport, keys, and the Noise handshake stay in the main process; nothing moves renderer-ward.
- **[Cryptographic primitives]** Not applicable. No RNG, no hashing, no key derivation, no comparison of any value against a secret (so no `timingSafeEqual` need), and no change to the Noise session, its nonce counters, or its framing. The ticket does not touch `src/main/transport/` at all.
- **[Network & I/O]** No findings. No socket, timeout, TLS setting, `maxPayload`, backoff, or reconnect path is touched. Frame handling is unchanged — the same frames are decoded by the same decoder; only one already-decoded field is now forwarded. A hostile relay gains nothing: it is content-blind and cannot reach inside the Noise session, and a hostile *daemon* supplying a garbage `conversation_id` produces at worst an event filed under an id no timeline holds — a dropped update, not a corruption, and only until #756 wires routing.
- **[Error messages, logs, telemetry]** No findings, and this one needed checking rather than asserting. `emitDaemonEvent` is log-free by construction, so the id reaches no sink on the IPC leg. The decode-side `turn_end` diagnostic (`inboundMessage.ts:1367-1372`) emits only `{ event, code: 'turn_end', bytes, hash }` — content-free, and pinned as such by `inboundMessage.test.ts:3415-3432` ("logs a turn_end content-free, never the turn_id / stop_reason"), which this ticket does not touch and must not break. `WireDecodeError` messages name the failure category only and interpolate no field value. Nothing new reaches the renderer DevTools console.
- **[Concurrency]** No findings. The emit is synchronous and stateless — no new async task, `setTimeout` / `setInterval`, listener, `AbortController`, or teardown path. No shared state is read-then-mutated across an `await`. Explicitly pinned in § State + concurrency: the added field brings no per-id buffer, dedup, last-seq memo, or ordering check, so no check-then-act race is introduced. Shutdown behaviour is unchanged.
- **[Threat model alignment]** Addressed. *Malicious relay:* content-blind and on-path only; it can drop, delay or reorder frames, none of which this change affects, and it cannot forge a `conversation_id` without breaking the Noise session. *Hostile daemon response:* covered by the unchanged fail-closed decode — a malformed `conversation_id` drops the frame; an attacker-chosen but well-formed one is a routing key that reaches no sink and is not yet routed on. *Renderer compromise reaching the transport:* unchanged — this leg is outbound to the renderer and exposes no new capability. *Token theft from disk:* not applicable; nothing is persisted. **Explicitly out of scope:** what a consumer *does* with the id once it routes on it — collision, spoofed-id targeting, and unbounded per-id state are #756's concern, and the arms this ticket's siblings widen (`toolUse` #753, `toolResult` #754) carry their own review.
- **[Deliberate non-hardening]** Called out so code-review does not read it as an omission: the emit reads `inbound.turnEnd.conversation_id` **bare**, with no `??` fallback and no re-validation. That is the security-relevant choice, not an oversight — re-validating would be redundant with `:566`, and a fallback would convert a fail-closed drop into a silent misattribution. The new test in § Testing pins the no-emit so a later `?? ''` cannot land quietly.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
