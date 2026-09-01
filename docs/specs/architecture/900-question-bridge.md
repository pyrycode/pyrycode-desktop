# #900 — bridge the two question `DaemonEvent` arms into the question store

## Files read

- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `subscribeModal`, `useModalBridge`,
  its local `assertNever` — the structure this slice clones, including the explicit fall-through null
  block closed by `assertNever` and the `connected → { type: 'reconnected' }` arm.
- `src/renderer/src/store/announcedModelBridge.ts` → `translateModelAnnounced`,
  `subscribeAnnouncedModel`, `AnnouncedModelData` — the fourth-independent-subscriber posture. Cloned
  for *posture*, not for form: it uses `default: return null`, which AC4 forbids here.
- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionBatchEvent`,
  `reduceQuestionBatches` (#898) — the target union, and the reducer's by-reference hold of
  `questions`, which is why `options` may pass by reference here.
- `src/renderer/src/store/questionBatchStore.ts` → `questionBatchStore`, `QuestionBatchStore.dispatch`
  (#899) — the singleton this bridge dispatches into, and its stated refusal of an `observe?` seam.
- `src/shared/ipc/events.ts` → the two question arms and the full 41-arm union — the case list, and
  the ruling that `source` is a plain `string` and not `WireModalSource`.
- `src/shared/wire/types.ts` → `WireQuestion`, `WireQuestionOption` — confirms `multi_select` is the
  family's one snake_case key and that `WireQuestionOption` has nothing to rename.
- `src/main/transport/inboundMessage.ts` → `parseQuestionShownPayload`, `parseQuestion`,
  `parseQuestionOption` — the element-wise fail-closed narrowing that makes `.map` here total, and the
  `MAX_PLAINTEXT_BYTES` guard that bounds a hostile batch.
- `src/main/daemonConnection.ts` → the two emit sites: both arms are live traffic, not dormant.
- `src/renderer/src/store/modalBridge.test.ts` → the `fakeBridge()` capture-the-listener idiom and the
  inverse-filter table this slice's tests mirror.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and none is owed. This slice adds one renderer
module with no rendered output: two plain functions and a hook returning `void`, landing dormant. The
visual-fidelity check is intentionally skipped; the panel slice (#851) carries it.

## Context

#898 landed the pure model, #899 the Zustand container. Nothing connects them to the transport. This
slice is that connection: a **fourth independent subscriber** on the shared daemon-event channel,
owning exactly `questionShown`, `questionDismissed` and `connected`. The three existing bridges keep
their `null` arms for both question types permanently; this slice edits none of them.

No ADR is warranted — ADR 0009 already governs this vertical, and this bridge is an instance of it.

## Design

One new production file, `src/renderer/src/store/questionBridge.ts`, cloning `modalBridge.ts`'s three
layers. No other production file changes.

**`translateQuestionEvent(event: DaemonEvent): QuestionBatchEvent | null`** — the pure choke point. A
`switch` with three owned cases, an explicit fall-through block returning `null` for the other 38 arms,
and a `default` calling a locally-defined `assertNever`. Every returned value is a fresh named-field
literal — never `return event`, never a spread (AC1). `questionShown → 'shown'`,
`questionDismissed → 'dismissed'`, `connected → { type: 'reconnected' }` ignoring `event.ack` (AC3).

**The per-question rebuild is the one thing that is not a filter.** `questions` maps each
`WireQuestion` to a fresh `Question` literal, renaming `multi_select` to `multiSelect` (AC2). The
compiler forces it: `readonly WireQuestion[]` is not assignable to `readonly Question[]`. Each
question's `options` is assigned **by reference** — `WireQuestionOption[]` *is* assignable to
`readonly QuestionOption[]`, so no cast and no copy. There is **no per-option rename**.

**AC4's null block is explicit case labels, not `default: return null`.** The `default` exists only to
call `assertNever`, so a 42nd arm is a compile error here until given a mapping. `modalBridge`'s form,
deliberately not `announcedModelBridge`'s.

**`subscribeQuestionBatches(onDaemonEvent, dispatch): () => void`** — the React-free seam, mirroring
`subscribeModal`. Returns the exact off handle `onDaemonEvent` returned. The listener translates,
guards on non-null, dispatches; it never throws into React.

**`useQuestionBridge(): void`** — the only production caller: a `useEffect` with an empty dependency
array returning the off handle as cleanup, so a StrictMode double-mount runs mount → cleanup → mount
and nets one live listener (AC5). `window.pyry` is dereferenced only inside the effect. **Ships
dormant** — not wired into `App.tsx`; #851 mounts it.

## State + concurrency model

The only state written is `questionBatchStore`'s `outstanding` slice, via
`questionBatchStore.getState().dispatch(...)` inside the hook's callback. The module holds no state of
its own — no `useState`, no `useRef`, no module-level mutable.

`dispatch` is synchronous with no `await`, so events cannot interleave and there is no check-then-act
race across a suspension point. The one lifecycle hazard is re-entrancy: zustand notifies subscribers
synchronously inside `setState`, so a subscriber dispatching during a notify would recurse. Nothing
does — this bridge dispatches from the preload callback and the panel slices only read.

Cancellation is the single off handle: subscribe on mount, handle returned as the effect cleanup,
nothing else to tear down — no timer, no `AbortController`, no long-lived promise.

## Error handling

No I/O and no parse on this leg, so there is no result type to return.

- **Malformed frame** — rejected upstream; `parseQuestion` narrows element-wise, so `.map` cannot
  receive a non-array or a question missing `options` / `multi_select`. `null` from this translator
  therefore means *not our arm*, never *bad data*.
- **Empty `questions`** — deliberately not handled here: `reduceQuestionBatches`' `shown` arm already
  makes it a same-reference no-op, and duplicating the check would put one policy in two places.
- **Unknown / already-dismissed id** — the reducer's unknown-id arm absorbs it. This translator does
  no matching at all.
- **Unrecognised dismissal `source`** — carried through as an opaque `string`, never read here, which
  satisfies the fail-closed reading rule (*resolved, cause unknown*, never an answer) by construction.
- **An unhandled `DaemonEvent` arm** — a compile error via `assertNever`, not a runtime path.

## Testing strategy

One new co-located spec, `src/renderer/src/store/questionBridge.test.ts` (vitest, `environment: 'node'`
— plain functions and spies, no DOM needed since the seam is injectable). Scenarios:

- `questionShown` → `shown`, exact `toEqual`, with `conversationId` and `questionBatchId` **distinct in
  the fixture** since both are `string` and tsc cannot catch a transposition.
- The rebuilt question carries `multiSelect` and **no `multi_select` key** — asserted on the key set,
  since an extra key survives a loose match.
- Each rebuilt question's `options` is the **same array reference** as the wire question's, and each
  option object is the same reference — AC2's by-reference contract.
- The translated event is not the input object, and carries no `type: 'questionShown'` residue — AC1.
- `questionDismissed` → `dismissed` carrying `outcome` / `source` verbatim, including an
  **unrecognised** `source`, proving the arm is not enum-checked.
- `connected` → a payload-free `reconnected`, ignoring the ack.
- An inverse-filter table of the other 38 arms, each expected `toBeNull()`.
- `subscribeQuestionBatches`: subscribes once; dispatches for an owned arm; dispatches nothing for an
  unowned arm; returns the injected off handle as its cleanup.
- End-to-end through a real `createQuestionBatchStore()` and the seam (no React): shown → dismissed on
  the same id drives `outstanding` `[1] → []`; a `connected` after a shown clears the held set.
- **AC5 without a DOM**: drive the StrictMode sequence against the seam — subscribe, cleanup,
  subscribe — then assert two subscribe calls, exactly one `off`, and that only the second listener
  delivers. That is the claim the hook makes, proven at the seam the hook uses.

## Open questions

- **Naming**: `subscribeQuestionBatches` vs `subscribeQuestions`. Resolved in favour of the former — it
  names what the store holds, matching `QuestionBatchEvent` / `questionBatchStore`.
- **Should dormancy be asserted by a test?** Leaning no: an import-graph assertion would be a new idiom
  in this repo for a fact the diff already shows. To be settled in Phase B and recorded under
  `## Revisions` if it changes.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, but the boundary must not be misread: `translateQuestionEvent` is
  a **shape** boundary, not a trust boundary. The untrusted→validated crossing already happened
  upstream in `parseQuestionShownPayload` / `parseQuestionDismissedPayload`. Nothing becomes *trusted*
  here. The four claude-authored strings (`question`, `header`, and every option's `label` /
  `description`) leave this translator exactly as untrusted as they entered, and the held `Question`
  type carries **no type-system signal** for that — `string` is `string` on both sides. A branded type
  is the only mechanism that would carry it, and minting one is a change across #898/#899's landed
  types, well outside this ticket. The mitigation is therefore documentation plus the render slice's
  obligation, which is why the docblock restating it is load-bearing rather than decorative. Verified
  concretely: the `.map` reads only fixed literal keys, so no untrusted string is ever used as a lookup
  key, a path, or a map key.
- **[Tokens, secrets, credentials]** No findings. `questionBatchId` is a one-time unguessable nonce
  that must never reach a log; this module imports no logger, calls no `console.*`, and takes no
  `observe?` diagnostics parameter (the refusal #899 recorded, for the same reason — one observer hands
  an arbitrary consumer the nonce and the four untrusted strings in a single line). The one theoretical
  sink is the local `assertNever`'s `JSON.stringify(event)` throw message, and it is **unreachable for
  the arms carrying sensitive content**: `assertNever` runs only in `default`, reachable only for a
  `type` matching none of the 41 cases, and both question arms have cases. So no nonce and no
  claude-authored byte can reach it. Keeping the house form (`questionBatches.ts`, `modalBridge.ts`,
  `timelineBridge.ts`) rather than diverging to a content-free throw is a checked choice, not an
  unexamined one. No token is created, stored, rotated or revoked on this leg.
- **[File / storage operations]** Not applicable, by a decision worth stating positively: the batch is
  held in **renderer memory only**. No filesystem path, no `localStorage` / `sessionStorage` /
  IndexedDB, no cache. Nothing persists the nonce or the untrusted text, so there is no at-rest
  artifact to encrypt, no traversal sink, and no TOCTOU window. A future "restore the panel across a
  restart" feature is what would introduce all three at once, and it is not this ticket.
- **[Inter-process / Electron attack surface]** No findings. The bridge adds **no IPC channel, no
  `ipcMain` handler, no `contextBridge` API** — it consumes the existing `window.pyry.onDaemonEvent`,
  dereferenced solely inside the effect and never during render. It never imports `ipcRenderer` and
  never touches keys, sockets or raw frames. It exposes no new capability: `subscribeQuestionBatches`
  takes `dispatch` as an injected parameter, so a caller must already hold a write path — the seam is a
  test affordance, not an authority grant. The store singleton stays module-scoped and is **not**
  attached to `window`, preserving #899's rule (a global would hand an injected script a live write
  path into renderer state).
- **[Cryptographic primitives]** Not applicable, with one active prohibition: this module performs no
  comparison at all — `questionBatchId` matching lives in `reduceQuestionBatches`' `removeById` and is
  deliberately plain `===`. Do **not** introduce `crypto.timingSafeEqual` here or there. It is a local
  routing decision between two values the client already holds, not a secret compared against a guess.
- **[Network & I/O]** Not applicable on this leg: no socket, no fetch, no timeout to set. Frame
  capping, TLS and relay-URL validation belong to the main-process transport;
  `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard is what bounds a hostile batch. Checked
  adversarially: the `.map` allocation is O(questions that actually arrived), never O(a claimed count),
  because the shape has no count field, and `options` passes by reference rather than being copied — so
  a hostile daemon cannot amplify allocation beyond the frame cap. This slice deliberately adds no
  question-count or string-length bound, matching `parseQuestionShownPayload`'s explicit "no contract
  bound is enforced here" ruling; `header`'s documented-12 / observed-14 cap is exactly the trap.
- **[Error messages, logs, telemetry]** No findings. MUST-NOT-log here: `questionBatchId` and the four
  claude-authored strings — plus, easier to miss, `outcome` and `source`, which are daemon-*asserted*
  but not daemon-*bounded*, so a compromised daemon puts arbitrary content at arbitrary length in
  either. The module emits nothing at all, satisfying this by construction. The listener cannot throw
  into React: `translateQuestionEvent` is total over the union, `.map` runs over an array
  `parseQuestion` already narrowed element-wise (`options` via `parseQuestionOption`, `multi_select`
  via `requireBoolean`), and the fresh literals cannot throw.
- **[Concurrency]** No findings. One subscribe on mount; the injected off handle is the effect cleanup,
  so a StrictMode double-mount nets exactly one live listener (AC5, proven at the seam). No timer, no
  `AbortController`, no promise outliving the window. `dispatch` is synchronous with no `await`, so
  there is no check-then-act race across a suspension point. The one named hazard is re-entrancy —
  zustand notifies synchronously inside `setState`, so a subscriber dispatching during a notify would
  recurse unbounded; nothing does.
- **[Threat model alignment]** *Hostile daemon* — addressed: the decode fail-closes upstream, and this
  translator adds no membership check that could reject valid traffic. The live risk it must not create
  is the **fail-closed reading rule inverted**: reading an unrecognised `source` as an answer would
  render a daemon safe-deny as the operator's own choice. This module satisfies the rule by never
  reading the field, only carrying it. *Renderer compromise reaching the transport* — addressed by
  process placement: nothing here reaches a key, a socket, or `ipcRenderer`. *Malicious / compromised
  relay* — out of scope for this leg; the relay is content-blind and its on-path behaviour is the
  supervisor's concern. *Token theft from disk* — not applicable, nothing is written to disk. Deferred
  and named: **bounding and escaping the four untrusted strings at the render boundary is #851's**, and
  it is the one obligation this slice hands onward rather than discharging.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

**2026-09-02 — both Open Questions resolved during implementation. Neither changed the design.**

- **Naming**: settled on `subscribeQuestionBatches`, as the plan proposed. It names what the store
  holds, matching `QuestionBatchEvent` / `questionBatchStore`.
- **Dormancy assertion**: settled as *no test*, as the plan leaned. An import-graph assertion would be
  a new idiom in this repo for a fact the diff already shows, and the claim is verified directly — no
  module under `src/` other than `questionBridge.ts` itself references `useQuestionBridge`, and
  `App.tsx` is untouched.

One thing the plan under-specified and the implementation settled: the AC5 proof needs a fake
`onDaemonEvent` that models a listener **set** with per-subscription off handles, not the single
captured listener `modalBridge.test.ts` uses. A single-listener fake cannot distinguish "the cleanup
ran" from "the second mount overwrote the first", which is exactly the claim under test. The spec's
`fakeBridge` therefore tracks live listeners and asserts the surviving listener delivers exactly once
after mount → cleanup → mount, plus handle identity (`cleanup` *is* the channel's own off handle)
rather than a call count.
