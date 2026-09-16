# #1515 — carry the reset phase and handoff across to the window

Emit #1514's decoded `resetting` frame as a `DaemonEvent` arm carrying the conversation id, the
`active` edge and both closed-set tokens. Ships dormant: all four exhaustive bridges no-op it until
its two consumers land (#1516 the channel-list dot, #1517 the composer status row).

## Files read

- `src/shared/wire/types.ts` → `ResettingPayload`, `WireResetPhase`, `WireResetHandoff` — the decoded
  shape this arm mirrors, and the source of the two closed sets. Its contract block is where the
  four-row edge table and the "narrowed is not trusted" posture live; the arm restates only what the
  IPC boundary decides differently.
- `src/main/transport/inboundMessage.ts` → `parseResettingPayload`, the `{ kind: 'resetting' }` arm
  — the fail-closed decode this emit sits behind, and the confirmation that the arm takes no
  `FrameTimestamp` and that `decodeHistoryEvent` gained nothing.
- `src/shared/ipc/events.ts` → `BaseDaemonEvent`, `DaemonEvent`, `HistoryTimelineEvent`,
  `DaemonEventWithOrigin` — the union to extend, the history union to leave alone, and the
  `daemonTs` mix-in the new arm declines. The `rateLimited` and `contextUsage` arms at its tail are
  the shape to copy; the `WireTurnState` import precedent is how the two wire tokens join the import
  list.
- `src/main/daemonConnection.ts` → the `rate-limited` case in the inbound switch inside
  `createDaemonConnection`, and `emitDaemonEvent` — the emit to copy (fresh literal, copied by name,
  no `daemonTs`), and the log-free sink.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent` — the session-store bridge;
  its `rateLimited` case is the permanent-no-op precedent this arm follows.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent` — the grouped fall-through case
  list the new tag joins, with a paragraph of its own in the shared comment.
- `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent` — same grouped shape.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` (the arm), plus
  `timelineTargetFor` and `liveJoinKeyFor` (neither needs an edit — see Design §4).
- `src/renderer/src/store/conversationActivityBridge.ts` → its `default` arm — the proof that #1516's
  file needs no edit here.
- `docs/knowledge/features/daemon-event-bridge.md` § the `rateLimited` row — the lesson that a
  reading must not be folded into that store's *connection*-status scalar, which decides this arm's
  disposition in the same file.
- `docs/knowledge/features/daemon-event-channel-sealed-union-history-recent.md` § the #1319 entry —
  the per-field rationale format a dormant carry arm is expected to carry.

## Design source

**Figma:** N/A — no UI-visible change. AC4 makes it explicit: nothing renders and no store is
written on this ticket. The visual-fidelity check is intentionally skipped; #1516 and #1517 each
carry their own Figma anchor.

## Context

#1514 landed the decode: `parseInboundMessage` narrows a `resetting` frame into
`{ kind: 'resetting'; resetting: ResettingPayload }`. Nothing reads it — the inner switch in
`createDaemonConnection` has no case for the kind and no `assertNever`, so today the arm falls
through silently. This ticket gives it its emit.

The slice ships **dormant**, the #1319 posture: the arm exists on the union and crosses IPC, and
every exhaustive bridge no-ops it until a consumer lands. #1319 is the precedent to follow rather
than `compacting`'s, and the two differ on exactly two points — `compacting` stamps `daemonTs` and
sits in `HistoryTimelineEvent` too, and this arm does neither.

No ADR is warranted: the arm makes no decision the union's existing precedents have not already
made. The two closed-set tokens crossing unwidened is the `WireTurnState` precedent, and the absent
timestamp is the `thinkingProgress` / `rateLimited` one.

## Design

### 1. The union arm — `src/shared/ipc/events.ts`

One arm appended to `BaseDaemonEvent` after the `contextUsage` arm at its tail:

```ts
| {
    type: 'resetting'
    conversationId: string
    active: boolean
    phase: WireResetPhase
    handoff: WireResetHandoff
  }
```

`WireResetPhase` and `WireResetHandoff` join the named wire imports this file already pulls from
`src/shared/wire/types.ts` — the `WireTurnState` precedent. **Neither is widened to `string` on this
boundary.** Widening would throw away the closed set #1514 established one layer down and would
hand every consumer an open switch where a four-value one is available. The cost is real and
accepted: a daemon that adds a fifth phase fails the decode upstream, which is #1514's call, already
made.

`active` crosses as the `boolean` it is. It is the edge the window gates on, and it is the only
field a consumer may branch on — which is what makes carrying the two empty strings on the falling
edge load-bearing rather than tidy.

**Both empty strings cross as the contract's own zero value.** Not `undefined`, not an absent key.
The daemon writes both keys on every frame (no `omitempty`), `''` is Go's zero value and is a
declared member of both sets, and a consumer that saw a missing key could not tell a falling edge
from a malformed one. Structured clone preserves an `undefined` property across the bridge, so the
distinction between "absent" and "present and empty" is one the IPC boundary can actually keep — and
the `'conversationId' in event` ban in `timelineBridge`'s `timelineTargetFor` docblock is the
standing lesson about what happens when a probe is used instead of a required field.

**No `daemonTs`.** The mix-in marks the arms `decodeHistoryEvent` draws, which need (`type`, `ts`)
as the join key between a served page and what the live stream already drew. #1514 keeps `resetting`
armless there — a stored `resetting` is skipped rather than served, so there is no page half to join
against. `rateLimited` and `thinkingProgress`, not `apiRetry` or `compacting`, are the precedent.
**The type cannot catch a stray stamp**: `daemonTs` is optional on every arm of this union, so only
the emit site and its round-trip test hold this. AC2 is a test obligation, not a type obligation.

`HistoryTimelineEvent` gains nothing. `resetting` has no replay ring upstream.

The arm's comment block restates, in the house form the union's recent arms use: the four-row edge
table's consequence (the rising edge re-fires as the phase advances, so a consumer must not treat a
second rising edge as a duplicate); daemon STATE by the queueState rule (#720) — no `turn_id`, opens
and closes no turn; **narrowed is not trusted** — a hostile daemon can send any of the sixteen
combinations, so a consumer handles all of them and branches no security-relevant behaviour on
either token; `handoff: 'written'` carries **no path**, so nothing downstream can resolve, join,
open or link one; and the standing warning that **the falling edge may never arrive** — a daemon
killed mid-reset sends no `active: false`, so an indicator cleared only by that frame pins forever
and the clearing path needs an independent trigger. That last one is a contract this arm rides
forward to #1516 and #1517; nothing on this leg can defend it.

### 2. The emit — `src/main/daemonConnection.ts`

One `case 'resetting':` in the inbound switch inside `createDaemonConnection`, placed beside the
`rate-limited` case it copies. A **fresh four-property literal**, every field copied **by name** from
the already-decoded payload — never a spread of `inbound.resetting`, so a decoder that later grows a
field cannot smuggle it across IPC. All four decoded fields cross; there is nothing to leave behind.

`emitDaemonEvent` is log-free by construction and #1514's decode-side log line is pinned
content-free. That stays true here: nothing decoded reaches a log on this leg. It matters — the
phase-and-handoff pair beside the id discloses which conversation the operator reset and whether a
handoff note was written, which is a fact about the operator's workflow rather than about the frame.

Deliberately stateless: no dedup, no coalescing, no timer, no last-value memo, none keyed by the id.
The rising edge re-fires as the phase advances, so suppressing a repeat would eat a real transition.
Not compile-forced — this inner switch has no `assertNever`, so the round-trip test is what guards
the emit.

### 3. The four forced no-op arms

Each is a single `case 'resetting':` plus a paragraph in its file's shared comment. They cannot be
deferred: `tsc` fails the build the moment the union gains an arm none of them handles.

| Bridge | Disposition | Grounds |
|---|---|---|
| `translateDaemonEvent` | **PERMANENT** | The session store holds connection status and messages. A reset is orthogonal to whether the socket is up, and there is no status scalar here for it to flip. |
| `translateModalEvent` | **PERMANENT** | Not a permission prompt: no `modal_id`, nothing daemon-side waiting on an answer, and the frame gates no action claude wants to take. |
| `translateQuestionEvent` | **PERMANENT** | Not an ask: unsolicited, nothing outstanding, no answer to give. It reports what the daemon is doing to a session, not what claude wants from the operator. |
| `translateTimelineEvent` | **DORMANT** — #1517 flips it | The `compacting`-flipped-at-#496 shape. A reset is transient thread chrome; whether it becomes an owned arm is #1517's call, and its status row is the surface. |

Saying which each one is rather than calling all four dormant is this file family's own comment
convention, and the three permanent ones each name why nothing in their switch will ever claim the
arm.

### 4. What needs no edit, and why

- `timelineTargetFor` (same file) ends in `default`, not `assertNever` — its docblock says so
  explicitly and gives the reason. No case.
- `liveJoinKeyFor` reads `event.daemonTs` generically rather than switching on `type`. An arm with
  no stamp yields `undefined` and joins nothing, which is correct.
- `conversationActivityBridge.ts` has a `default` arm. It is #1516's file, not this ticket's.
- `decodeHistoryEvent` and `HistoryTimelineEvent` — no replay ring, per §1.

`npm run build` is the deterministic check that this list is complete: any fifth exhaustive switch
is a compile error, not a judgement call.

## State + concurrency model

No state. The emit is a pure function of one decoded frame, launches no async work, holds no timer
and registers no listener, so there is nothing to cancel and nothing to tear down. No store slice is
written on this ticket and no component subscribes.

The one ordering fact worth naming: events reach the window in emit order over the existing channel,
so a `wrapping_up` → `restarting` → falling-edge sequence arrives in that order. Nothing here
depends on it; #1516 and #1517 inherit it.

## Error handling

No new failure mode and no new reject branch. The decode upstream is fail-closed — a missing or
mistyped field drops the whole frame without emitting — so this case only ever runs on a fully
validated payload. There is no partial-emit path and nothing for a result type to carry.

The failure this leg deliberately does **not** defend is the absent falling edge (§1). It is a
consumer-side concern with no defence at this boundary, and the arm's comment carries it forward.

## Testing strategy

Vitest only — node environment, no DOM, nothing to click. All five suites are unit-level.

- `src/main/daemonConnection.test.ts` — the round-trip, beside the existing `rate-limited` one:
  - a rising `wrapping_up` / `pending` frame emits exactly one event with the four expected fields
    and **nothing else**, asserted with `toEqual` on the whole literal so a stray property fails;
  - the `restarting` / `written` rising edge emits its own event (the re-fire, not a duplicate);
  - **the falling edge crosses with both empty strings intact** — asserted so that `undefined` and
    an absent key both fail. `toEqual` ignores an undefined-valued property, so the empty-string
    assertion is the one that pins the difference, and a separate `Object.keys` / `in` check pins
    presence;
  - **no `daemonTs`** on the emitted literal (AC2) — the type cannot catch this, so the test must;
  - one frame in, exactly one event out (no dedup, no coalescing).
- `daemonEventBridge.test.ts`, `modalBridge.test.ts`, `questionBridge.test.ts`,
  `timelineBridge.test.ts` — one case each: a `resetting` event yields no action / `null` from that
  file's translator (AC3). Each bridge's own test, not one shared test, because each pins a separate
  decision.
- AC4 (nothing observable changes) is proven by the four bridge tests together with the absence of
  any store or component edit in the diff — there is no render to assert against.

Fixtures are inline literals in each spec, matching the `rate-limited` tests' shape. No new fake and
no new helper.

## Open questions

1. **Does any fifth exhaustive `DaemonEvent` switch exist that the ticket's list of four misses?**
   Resolve by `npm run build` in Phase B rather than by grep — a missing case is a compile error.
   If one appears, it gets the same treatment and is recorded under `## Revisions`.
2. **Does the emit's placement in the inbound switch matter?** Expected: no, beside `rate-limited`
   is a readability choice. Confirm nothing in the switch falls through into a neighbouring case.

## Revisions

**2026-09-16 — Phase B.** Both Open Questions resolved; **no design change**, so nothing above is
superseded.

1. **No fifth exhaustive `DaemonEvent` switch exists.** `npm run build` passes with exactly the four
   bridge cases in the diff, so the ticket's list of four was complete. `timelineTargetFor`,
   `liveJoinKeyFor` and `conversationActivityBridge.ts` each needed no edit, as Design §4 predicted.
2. **Placement is a readability choice only.** The emit sits beside the `rate-limited` case it
   copies; both cases `return`, so nothing falls through into a neighbour, and the neighbouring
   `context-usage` suite stays green.

One implementation note with no design consequence: the diagnostic-log capture helper in
`daemonConnection.test.ts` is `captureLog`, and it needs its records cleared after the handshake
before a per-frame logging assertion means anything — the `rate-limited` logging test's own shape.

The ticket names no documentation requirement and has no **Documentation handoff** section. Nothing
pending beyond the family's standing convention: the documentation phase folds this arm's per-field
rationale into `docs/knowledge/features/daemon-event-channel-sealed-union-history-recent.md` and the
per-bridge dispositions into `daemon-event-bridge.md`, `modal-store-bridge.md` and the timeline
overview, the way #1319's were. **Not written on this ticket** — those paths belong to the
documentation phase.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. There is exactly one boundary and it is upstream of this
  change: `parseResettingPayload` in `src/main/transport/inboundMessage.ts`, which fail-closes the
  whole frame on any malformed field. This leg holds a parsed `ResettingPayload` only and adds no
  second parse site. The IPC hop main → renderer is the second boundary, and it runs in the safe
  direction: the renderer receives already-typed data and sends nothing back on this arm. **Narrowed
  is not trusted** is the finding worth stating rather than assuming — `WireResetPhase` and
  `WireResetHandoff` are closed *unions*, which is a compile-time invitation to read a value as
  settled fact. It is a claim by a peer. A hostile daemon can send any of the sixteen
  (`active`, `phase`, `handoff`) combinations, so the arm's comment obliges consumers to handle all
  of them and forbids branching security-relevant behaviour on either token.
- **[Tokens, secrets, credentials]** Not applicable by design: no field on this path is a secret, no
  token is read, minted, stored or compared, and nothing touches `safeStorage`. The frame carries
  four daemon-authored non-secret values.
- **[File / storage operations]** Not applicable, and one point is worth making explicitly rather
  than by omission: `handoff: 'written'` describes a file the daemon wrote and **the payload carries
  no path**. Nothing here resolves, joins, opens, links or stats anything — the token is a
  three-value status, not a locator. Nothing is persisted on this leg; the arm is transient.
- **[Inter-process / Electron attack surface]** No findings. The arm adds no `contextBridge` API, no
  `ipcMain` channel and no `webPreferences` change: it rides the existing `DaemonEvent` channel,
  which is main → renderer only. The transport stays in the background process — the renderer sees
  four already-typed scalars and never a socket, a key or a raw byte.
- **[Cryptographic primitives]** Not applicable. No RNG, no hash, no comparison against a secret, no
  Noise-handshake code touched. The Noise variant constant is unchanged.
- **[Network & I/O]** Not applicable on this leg. No socket is opened, no URL is parsed, no timeout
  or payload cap is set or changed — the frame arrives through the existing relay read path with its
  existing limits. The emit is synchronous and allocates one fixed-shape literal per frame, so a
  flooding daemon costs one small object per frame and nothing unbounded. **Nothing here schedules,
  allocates or iterates from a daemon-supplied value**; there is no count or duration on this arm to
  do it from.
- **[Error messages, logs, telemetry]** No findings, and this is the category that most needed the
  walk. **Nothing decoded reaches a log on this leg or upstream**: `emitDaemonEvent` is log-free by
  construction and #1514's decode-side line is pinned content-free. The disclosure being protected is
  specific — the phase-and-handoff pair beside the conversation id reveals which conversation the
  operator reset and whether a handoff note was written, a fact about the operator's workflow rather
  than about this frame. The four bridge no-op cases are part of this defence and not a formality:
  each file's `assertNever` stringifies the **whole event** into an `Error` message, so a missing
  case would put the conversation id and both tokens into a stack trace and a crash reporter. That is
  the concrete exploit path for an omitted case, and it is why all four land in this ticket rather
  than in a follow-up.
- **[Concurrency]** No findings. The emit launches no async work, owns no timer, registers no
  listener and holds no mutable state — so there is no cancellation path to thread, no
  check-then-act race across an `await`, and nothing to tear down on window close. The deliberate
  absence of a per-conversation memo is what keeps it that way: a dedup cache would be the only
  mutable state on this leg, keyed by a daemon-supplied id and fed by a daemon-supplied stream.
- **[Threat model alignment]** Hostile-daemon response: addressed — #1514's fail-closed parse plus
  the "narrowed is not trusted" contract above. Malicious on-path relay: unchanged by this ticket;
  the relay is content-blind and cannot read inside the Noise session, and a dropped or reordered
  frame lands as a missing or out-of-order edge, which the absent-falling-edge warning already
  covers. Renderer compromise reaching the transport: unchanged — this arm gives the renderer four
  scalars and no capability. **OUT OF SCOPE:** an indicator that pins forever because the falling
  edge never arrived is a consumer-side availability bug with no defence at this boundary; the arm's
  comment names it and #1516 / #1517 each own the independent clearing trigger on their own surface.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-16

## One-ticket boundary — the stated overage

Six production source files, one over the boundary's five. It is not split, and the reason is the
floor rule rather than a rationalization about mechanical edits: four of the six are a single `case`
line each, and they are **not deferrable** — the union arm does not compile without them, so a child
ticket carrying them alone could not build and a child carrying the arm alone could not build
either. The four have exactly one consumer, the arm itself, which is the floor rule's own test.
Floor wins over ceiling: state the overage, build it as one ticket.

Every other line of the table holds: ~670 lines of total written work against 800, no new exported
name (one anonymous arm on an existing union), four consumer call sites against ten, four acceptance
criteria against five, and no new reject branch at all.
