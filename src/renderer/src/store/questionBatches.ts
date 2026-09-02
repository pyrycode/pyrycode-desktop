// The outstanding question batches: the clarifying questions `claude`'s `AskUserQuestion` tool raises
// for the operator to choose from, each batch addressed by its one-time `questionBatchId`. Pure
// renderer state — no React, no Zustand, no IPC, no transport, and (deliberately) no imports at all.
// The question vertical's counterpart to `modalPrompts.ts`, whose discipline this clones under
// ADR 0009: renderer-local camelCase types, a sealed event union, a reducer returning the SAME state
// reference when nothing changes, and an ordered array scanned by id rather than a keyed container.
//
// Nothing imports this file when it lands. Its first consumer is the Zustand container (#899); the
// bridge that maps the `questionShown` / `questionDismissed` `DaemonEvent` arms into the events below
// is #900's. Field names mirror the wire so that bridge stays a thin rename.
//
// UNTRUSTED TEXT, HELD OPAQUELY. `Question.question`, `Question.header`, and every option's `label`
// and `description` are CLAUDE-AUTHORED: they crossed the subprocess trust boundary and the daemon
// NEITHER BOUNDS NOR SANITIZES them (nothing on the path strips control characters or terminal
// escapes). The fail-closed decode upstream made their SHAPE trusted and nothing more — `string`
// carries no signal for that. This module never inspects, parses, truncates or keys on them, and the
// RENDER slice owes the escaping: plain text only, never HTML (no innerHTML /
// dangerouslySetInnerHTML), never into an attribute, a URL, a filename, a cache key, a lookup path,
// or a log. The last three are the ones a paraphrase drops and the ones a question panel reaches for
// first, by keying a tab on `header` or memoising on `label`.

/**
 * One offered choice within a question. `label` and `description` are the COMPLETE key set.
 *
 * **There is no `id`** — unlike `ModalOption`'s `{ id, label }`. claude's answer protocol selects an
 * option by its `label`, so the label IS the option's identity. A near-verbatim clone of the modal
 * model grows an id here that the wire never carries; do not add one. There is no `defaultOptionId`
 * counterpart either — a question batch has no fail-safe default the way a permission modal does.
 *
 * Array position (in `Question.options`) is the display order; the state holds it verbatim.
 */
export interface QuestionOption {
  label: string
  description: string
}

/**
 * One question within a batch. Array position (in `QuestionBatch.questions`) is the canonical display
 * order — claude's own.
 *
 * `multiSelect` is the ONE renamed field in this family. The wire keeps `multi_select` snake_case
 * across IPC by settled house rule (the nested rows cross unchanged), so the held model declares its
 * own camelCase and #900's bridge renames per row. That is this vertical's one departure from the
 * modal family, where the bridge was a pure filter because the wire fields were already camelCase —
 * and it applies at BOTH nesting levels, since `options` hangs off each QUESTION here rather than off
 * the batch the way `ModalShownPayload.options` hangs off its payload. A reader pattern-matching off
 * the modal family gets that wrong by default. It is always present, so `false` is a STATED POSITION
 * rather than an absent key.
 */
export interface Question {
  question: string
  header: string
  options: readonly QuestionOption[]
  multiSelect: boolean
}

/**
 * The held, outstanding batch — what a `shown` event installs and a `dismissed` clears. The full
 * ordered question list is held TOGETHER because the panel's header tabs and Previous button need
 * every question at once.
 *
 * `conversationId` is a daemon-asserted DISPLAY-SCOPING label: it is what lets a client with several
 * live chats avoid rendering one conversation's questions in another. It authorises nothing.
 * `questionBatchId` is the sole correlation key, exactly as `modalId` is for a modal.
 */
export interface QuestionBatch {
  conversationId: string
  questionBatchId: string
  questions: readonly Question[]
}

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and defined here (not
 * imported from `src/shared/wire`); #900's bridge maps the wire-shaped `DaemonEvent` arms into these.
 *
 * There is NO answer arm, and that absence is the contract rather than an oversight: an answer resolves
 * a batch through the `dismissed` arm below like everything else, so this union needs no third clearing
 * shape.
 *
 * **THE DAEMON IS NO LONGER THE ONLY THING THAT DISMISSES A BATCH (#921).** #919/#920 landed the
 * `question_refused` frame and the command that sends it, and `refuseQuestionBatch` is the first LOCAL
 * caller of the `dismissed` arm: Cancel refuses the outstanding batch and clears it optimistically. It
 * reuses this arm unwidened, supplying CLIENT-OWNED constants for `outcome`/`source` that sit outside
 * both the producer's landed pair and `WireModalSource` — see that helper for why `'local'` in
 * particular would be the wrong value. See `QuestionBatchState` for why a `resolved` memory still does
 * not follow from that.
 */
export type QuestionBatchEvent =
  | {
      type: 'shown'
      conversationId: string
      questionBatchId: string
      questions: readonly Question[]
    }
  // `outcome` and `source` are carried for a later consumer but NOT consulted by the reduce — only
  // `questionBatchId` drives the clear — mirroring `ModalEvent`'s dismissed arm.
  //
  // `source` IS A PLAIN OPEN string AND DELIBERATELY NOT `WireModalSource`, which is the single most
  // likely mistake in this family: it compiles nowhere it should and passes everywhere it shouldn't.
  // That closed `{remote, local, timeout}` set has NO member the producer emits — `remote` and `local`
  // are ANSWERED outcomes belonging to the not-yet-landed answer half, and `timeout` is not emitted
  // either, because the dismissal arbiter is one closure the control server defers on every `Await`
  // return and cannot tell an elapsed approval window from a caller disconnect or a daemon shutdown.
  // All three terminal paths emit the ONE landed pair, `outcome: "unanswered"` with
  // `source: "no_answer"`. Closing the enum here would reject the only traffic that exists — and the
  // trap has teeth, because `timeout` is sitting in upstream's `testdata/question_dismissed.json`, a
  // SHAPE fixture minted before any producer existed. An arm typed `WireModalSource` and tested with
  // that value typechecks AND passes while rejecting every real frame.
  //
  // THE FAIL-CLOSED READING RULE IS WHAT MAKES THE OPEN TYPE SAFE, and it belongs to whatever later
  // reads `source` FOR DISPLAY: an unrecognised value means RESOLVED, CAUSE UNKNOWN, and NEVER an
  // answer. Backwards, it renders a daemon safe-deny as the operator's own choice. This reducer
  // satisfies the rule by clearing on ANY dismissal regardless of source — it never reads the field.
  //
  // No `conversationId`, and DO NOT ADD ONE "for symmetry with the batch": the absence is part of the
  // contract. A shape carrying both ids would admit a disagreeing pair someone has to adjudicate, and
  // a client holding the batch already knows its conversation.
  | { type: 'dismissed'; questionBatchId: string; outcome: string; source: string }
  // The transport (re)connected. Fires on EVERY supervisor (re)handshake, including the first connect.
  // Carries no payload — the reset needs nothing from the connect ack. See the reduce arm for why.
  | { type: 'reconnected' }

/**
 * The whole question state: the ordered set of still-outstanding batches.
 *
 * **NO `resolved` id-memory, and that is a decision rather than an omission.** `ModalState` carries a
 * `resolved: readonly string[]` slice (#195) and cloning it here would be the natural reflex. Do not.
 * That memory exists because the modal client answers OPTIMISTICALLY — `answerModal` dispatches
 * `dismissed` locally even when the send is swallowed by a downed transport — so it can hold an id the
 * daemon does not consider resolved. **THIS VERTICAL NOW RESOLVES OPTIMISTICALLY TOO (#921) AND STILL
 * DOES NOT WANT ONE**, so the earlier prediction here — that `resolved` arrives with the answer path,
 * on the modal vertical's #195/#249 precedent — is withdrawn rather than merely deferred. The premise
 * has changed; the conclusion has not, and it now rests on the daemon's re-delivery schedule instead of
 * on the absence of a local caller: the daemon re-asserts a batch ONLY AT CONNECT TIME, and both this
 * store and `questionPicksStore` already clear on `reconnected` BEFORE that reconcile installs
 * anything. So there is no mid-connection re-delivery for a memory to suppress. What a `resolved` slice
 * would actually do is outlive the reconnect and swallow the daemon's legitimate re-assertion of a
 * batch whose refusal never left the machine — and #510 is the record of that exact cost in the modal
 * family: the retained id suppressed a legitimate re-delivery, and an operator's explicit Allow decayed
 * into a timeout deny. A batch reappearing after a swallowed send is the HONEST outcome here: the
 * refusal did not land, so the ask is still live.
 */
export interface QuestionBatchState {
  outstanding: readonly QuestionBatch[]
}

/** Compile-time exhaustiveness guard: a new event arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled question event: ${JSON.stringify(event)}`)
}

/**
 * Remove the batch whose `questionBatchId` matches, returning a new array. If none matches — an
 * unknown or already-dismissed id — return the SAME array reference, so the caller can return the same
 * state unchanged (deterministic, non-throwing no-op). Mirrors `removeById` in `modalPrompts.ts`.
 *
 * Plain `===` on the id, deliberately, and not `crypto.timingSafeEqual`: this is a local routing
 * decision between two values the client already holds, not a secret compared against a guess.
 */
function removeById(
  outstanding: readonly QuestionBatch[],
  questionBatchId: string
): readonly QuestionBatch[] {
  const next = outstanding.filter((b) => b.questionBatchId !== questionBatchId)
  return next.length === outstanding.length ? outstanding : next
}

/**
 * Pure reducer — no mutation, returns fresh state, same reference when nothing changes so an unchanged
 * slice does not churn selectors. A `switch` on the sealed union with an `assertNever` default, and
 * every arm spreading `state` so a later field added to `QuestionBatchState` survives every arm (the
 * audit #249 recorded after two arms silently dropped a new one).
 *
 * NOTHING HERE LOGS, and that absence is load-bearing rather than incidental: `questionBatchId` is a
 * one-time UNGUESSABLE nonce that must never reach a log, and the four claude-authored strings must
 * not either. A "which batch did we drop?" diagnostic would put both into a sink in one line.
 */
export function reduceQuestionBatches(
  state: QuestionBatchState,
  event: QuestionBatchEvent
): QuestionBatchState {
  switch (event.type) {
    case 'shown': {
      // AN EMPTY QUESTION LIST INSTALLS NOTHING. An empty `questions` array is out of contract
      // daemon-side (a producer bug, not "claude asked nothing" — the opposite of `modelList`'s empty
      // array), but it crosses the transport unchanged because the transport polices type and not
      // membership, so what it means on screen is this module's call. A batch with no questions cannot
      // be answered and would put an un-answerable panel on screen. Same-reference no-op, matching the
      // unknown-id dismissal below; a later `dismissed` for that id is then an unknown-id no-op, which
      // stays consistent. Checked BEFORE the match, so an empty re-delivery also leaves a live batch
      // standing rather than replacing it with an unanswerable one.
      if (event.questions.length === 0) return state
      const batch: QuestionBatch = {
        // COPIED from the event by name, never derived and never spread from the event. Computing a
        // conversation id from the nonce would misattribute every batch while pushing an unguessable
        // value into one later consumers may render or key on; spreading the event would carry `type`
        // onto the held batch.
        conversationId: event.conversationId,
        questionBatchId: event.questionBatchId,
        questions: event.questions
      }
      // Re-delivery of a still-outstanding id: replace in place from the RE-DELIVERED fields (the
      // latest wins) — position and length preserved, no duplicate append. Carries over the #195
      // idempotency finding, which the array's id-addressing keeps a one-arm change.
      const outstanding = state.outstanding.some((b) => b.questionBatchId === event.questionBatchId)
        ? state.outstanding.map((b) => (b.questionBatchId === event.questionBatchId ? batch : b))
        : [...state.outstanding, batch]
      return { ...state, outstanding }
    }
    case 'dismissed': {
      const outstanding = removeById(state.outstanding, event.questionBatchId)
      // Unknown / already-dismissed id: `removeById` returned the same array — return the same state.
      // Absorbs a dismissal whose batch fell before a reconnect, or a double-dismiss race, without
      // killing the store. Nothing is recorded about the id: with no `resolved` slice there is no
      // ordering edge to guard, because a later legitimate `shown` of that id MUST re-surface.
      return outstanding === state.outstanding ? state : { ...state, outstanding }
    }
    case 'reconnected': {
      // On every (re)handshake, clear the held set so the daemon's connect-time re-send is the sole
      // repopulation truth FOR THE NEW CONNECTION (#415): a still-outstanding batch re-appends via
      // `shown`, and absence means resolved-while-away. An already-empty set keeps its reference — a
      // fresh `[]` would re-render a consumer selecting under `Object.is` for no state change — so a
      // reconnect holding nothing returns the same state.
      if (state.outstanding.length === 0) return state
      return { ...state, outstanding: [] }
    }
    default:
      return assertNever(event)
  }
}

export const initialQuestionBatchState: QuestionBatchState = { outstanding: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectOutstanding`). */
export const selectOutstandingBatches = (s: QuestionBatchState): readonly QuestionBatch[] =>
  s.outstanding

/**
 * Which batch, if any, belongs to this conversation? A selector FACTORY bound to one
 * `conversationId`, matching `selectHasOutstandingFor` / `selectActivityFor`. The desktop keeps
 * several chats live, so this is the panel's central read: it finds the batch for the conversation on
 * screen while other conversations' composers stay untouched.
 *
 * WHEN MORE THAN ONE HELD BATCH MATCHES, IT ANSWERS WITH THE FIRST IN INSERTION ORDER. The reducer
 * does not enforce one batch per conversation — nothing observed says the daemon raises two
 * concurrently, and enforcing it would invent a replacement rule for traffic no one has seen. Holding
 * the batches in one ordered collection scanned by id keeps that open (ADR 0009 § "Ordered array +
 * scan-by-id, not a Map") and keeps a future one-per-conversation rule a one-arm change.
 *
 * An `===` scan over the ordered array, deliberately: `outstanding` is NEVER re-keyed, by this id or
 * by anything else. Comparing own field VALUES has no prototype hazard at all — a `'__proto__'` or
 * `'constructor'` query cannot resolve onto `Object.prototype`, and no assignment path exists to
 * pollute one — and the scan preserves the array's referential stability. Re-keying would reintroduce
 * both hazards at once; keying by anything CLAUDE-AUTHORED (a `header` tab key, a `label` memo key)
 * would additionally put untrusted text in a lookup path, which is the named failure mode of this
 * family. The array is load-bearing here, not merely ADR parity.
 *
 * An unknown / never-seen conversation id is a legitimate query answered with `undefined`, not an
 * error — the same deterministic non-throwing discipline the reducer's unknown-id arm holds.
 * `undefined` (not `null`) matches `Array.prototype.find` and compares stably under `Object.is`, so a
 * component binding this re-renders only when ITS conversation's batch changes.
 */
export const selectBatchFor =
  (conversationId: string) =>
  (s: QuestionBatchState): QuestionBatch | undefined =>
    s.outstanding.find((b) => b.conversationId === conversationId)
