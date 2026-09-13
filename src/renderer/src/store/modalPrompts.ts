// The outstanding modal prompts: the permission/trust prompts `claude` raises during a
// desktop-driven interactive session and has not yet resolved, each addressed by its one-time
// `modalId`. Pure renderer state — no IPC, no preload bridge, no transport, no React. Introduced
// alongside `sessionStore` and `threadTimeline` (Strangler Fig, ADR 0009): nothing cuts over here
// and no consumer imports this yet. The follow-up adds the modal wire types, the transport decode,
// the `DaemonEvent` arm, and the bridge that maps wire (snake_case) frames into the `ModalEvent`s
// this reducer consumes — the desktop analog of `daemonEventBridge` mapping `DaemonEvent` →
// `SessionAction`. Field names mirror the wire so that bridge is a thin rename. See ADR 0009.

/** The two shipped wire modal classes. There is no `destructive` class (ADR 0009). */
export type ModalClass = 'permission' | 'trust'

/** One selectable option. Array order is display/selection order — the store holds it verbatim. */
export interface ModalOption {
  id: string
  label: string
}

/** The held, outstanding prompt — what a `shown` event installs and a `dismissed` clears. */
export interface ModalPrompt {
  // #878: the conversation that raised this prompt — DAEMON-ASSERTED (the wire's `conversation_id`,
  // pyrycode#1065), narrowed to `string` once at `parseInboundMessage` (#870) and carried by name ever
  // since. Not client-owned, and never re-validated here. It is a SCOPING LABEL only — it authorises
  // nothing and selects no resource, so it needs no branded type; `selectHasOutstandingFor` is its one
  // reader. `modalId` remains the sole correlation key for ANSWERING (ADR 0009).
  conversationId: string
  modalId: string
  class: ModalClass
  title: string
  prompt: string
  options: readonly ModalOption[]
  defaultOptionId: string
  /** Untrusted display context; never answer authority, attributes, paths or logs. */
  reason?: unknown
  reasonType?: string
  blockedPath?: string
  description?: string
  defaultToNo?: boolean
}

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and defined here (not in
 * `src/shared/wire`); the follow-up's bridge maps the snake_case wire frames into these.
 *
 * The `shown` arm carries `conversationId` (#877) — the frame's `conversation_id` (pyrycode#1065,
 * decoded by #870), arriving on the `modalShown` `DaemonEvent` (#871) and copied BY NAME into the
 * fresh literal the bridge builds, never by spreading that event. REQUIRED, never optional: the wire
 * has it always-present and the decode fail-closes on absence, so an optional field would invent an
 * absence case the daemon never produces — and an assigned `undefined` survives the structured clone
 * across the IPC channel, so a later `'conversationId' in event` check would read true on an event
 * carrying nothing. The id is a daemon-asserted SCOPING KEY, not rendered text, so none of the
 * untrusted-display-text handling `title` / `prompt` / `options[].label` need attaches to it.
 *
 * #878 carries it one hop further: `reduceModal`'s `shown` arm copies it BY NAME onto the held
 * `ModalPrompt`, and `selectHasOutstandingFor` reads it to answer whether a given conversation has a
 * prompt waiting. It is a scoping key only: `modalId` remains the sole correlation key for ANSWERING a
 * prompt — `modal_answer` / `modal_cancel` carry no conversation id and the daemon resolves an answer
 * against its own outstanding-modal state (ADR 0009).
 */
export type ModalEvent =
  | {
      type: 'shown'
      conversationId: string
      modalId: string
      class: ModalClass
      title: string
      prompt: string
      options: readonly ModalOption[]
      defaultOptionId: string
      reason?: unknown
      reasonType?: string
      blockedPath?: string
      description?: string
      defaultToNo?: boolean
    }
  // `outcome`/`source` are carried for the follow-up consumer (a resolution toast) but NOT consulted
  // by the reduce — only `modalId` drives the clear — mirroring threadTimeline's carried-but-unused `seq`.
  | { type: 'dismissed'; modalId: string; outcome: string; source: 'remote' | 'local' | 'timeout' }
  // #249: a modal answer that round-tripped to a daemon `error`. Produced by the bridge from the
  // content-free `modalAnswerRejected` daemon event (#248) — it carries ONLY the `modalId` nonce, no
  // daemon error text (AC3). The answer path already cleared the prompt optimistically (#237), so this
  // installs a NEW, orthogonal surface, never re-surfacing `outstanding`.
  | { type: 'rejected'; modalId: string }
  // #249: a LOCAL user action — the user dismissed a rejection banner. Never produced by the bridge;
  // dispatched inline from the container, exactly as answer/cancel dispatch `dismissed` locally.
  | { type: 'rejectionDismissed'; modalId: string }
  // #415: the transport (re)connected. Fires on EVERY supervisor (re)handshake, including the first
  // connect. Reconciles the reconnecting server's prompts against the daemon's connect-time re-sends by
  // clearing them; that daemon then repopulates via `shown`, and absence = resolved-while-away. #510:
  // it clears that server's `resolved` entries too — both slices are per-connection truth.
  //
  // #1140 GIVES IT A PAYLOAD, and the payload is the whole point. Since #1117 the background process
  // holds one live connection per paired server, so `connected` means "THIS server's connection came
  // back", and a payload-free clear took down prompts another server is still waiting on. The set is
  // the conversations belonging to the reconnecting server, resolved by the CALLER (modalBridge's
  // composition root, through #1138's `selectConversationIdsFor`) — this reducer is a pure
  // `(state, event)` fold and reads no store, so whatever it needs must already be on the event. The
  // ids are CLIENT-HELD, off this app's own server-keyed conversation list, never a daemon-supplied
  // field naming a server.
  //
  // An EMPTY set is the honest reading of "this server's list has not arrived", not a wildcard: it
  // clears nothing and returns the same state (AC3, keeping #415's AC4 no-churn property). Nothing
  // else clears a prompt whose conversation appears in no server's list — only `reset` below does.
  | { type: 'reconnected'; conversationIds: ReadonlySet<string> }
  // #1140: the pairing that held these prompts has ended. A LOCAL action, dispatched by
  // `clearPairingScopedState` (the `rejectionDismissed` precedent — never produced by the bridge), and
  // the counterweight to scoping the arm above: once the reconnect clear is scoped, a NEW pairing's
  // first `connected` resolves an empty conversation list, matches nothing, and would leave the
  // departed machine's actionable permission prompts on screen for the life of the process.
  //
  // Payload-free, so no daemon-supplied id can steer which of a departed daemon's prompts outlive it,
  // and UNSCOPED across all three slices including `rejections`: every slice is scoped to the pairing
  // that ended and none has a cross-pairing meaning, so the arm returns the store to its initial state.
  // This is the one clear that reaches a prompt held for a conversation no server's list ever carried.
  | { type: 'reset' }

/**
 * The whole modal state: the ordered set of still-outstanding prompts, plus the rejection surface —
 * the arrival-ordered, de-duplicated `modalId`s of answers that round-tripped to a daemon `error`
 * (#249). `rejections` is ORTHOGONAL to `outstanding`: the answered prompt is already gone (#237), so a
 * rejection is new UI state, not a re-surfaced prompt. It holds bare `modalId` strings — the event is
 * content-free. Separate ownership records scope those IDs to a chat for the feedback's lifetime.
 */
export interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections: readonly string[]
  // Feedback ownership survives reconnect independently of resolved suppression records.
  rejectionOwners: readonly ResolvedModal[]
  // #195: the prompts that have LEFT `outstanding` via `dismissed` (answer/cancel/remote/timeout).
  // Internal reducer bookkeeping — no selector, no consumer reads it, inside this module or outside it.
  // It lets the `shown` arm tell a never-seen id (→ append) from a seen-then-resolved one (→ no-op), so
  // a duplicate delivery within one connection updates the prompt already shown rather than
  // re-surfacing an already-answered one. Disjoint from `outstanding` by construction. An answer is
  // dispatched optimistically even when the transport is down and the send is swallowed (`answerModal`
  // early-returns on a null driver), so a recorded id means "resolved as far as THIS connection saw" —
  // never "the daemon has it". The daemon's connect-time reconcile re-sends only STILL-OUTSTANDING
  // prompts, so anything re-sent after a handshake is genuinely unanswered and must re-surface.
  //
  // #510 made it PER-CONNECTION state rather than permanent, and #1140 narrows that one notch further:
  // it is per connection OF ONE SERVER. The `reconnected` arm drops only the reconnecting server's
  // entries, so a duplicate `shown` on a server whose link never dropped stays suppressed — clearing
  // the slice wholesale would re-surface, on the OTHER server, a prompt the operator already answered,
  // which is the exact bug this bookkeeping exists to prevent.
  //
  // THAT NARROWING IS WHY EACH ENTRY IS A RECORD RATHER THAN A BARE `modalId`. A prompt's conversation
  // is what a scoped clear matches on, and by the time an id is here the prompt it named is gone from
  // `outstanding`, so the conversation has to be recorded when the id is appended — which is exactly
  // where the information already is (the `dismissed` arm removes the prompt whose conversation it is).
  // MUST NOT BE PERSISTED: these ids are daemon-side and a re-pair to the same box reuses them, so a
  // suppression entry surviving to disk would silently swallow a genuine `shown` on a later pairing.
  // In-memory only; `reset` is what collects them at a pairing boundary.
  resolved: readonly ResolvedModal[]
}

/**
 * One suppression entry (#1140): a `modalId` that has left `outstanding`, plus the conversation it
 * belonged to. The conversation is COPIED off the held prompt at dismissal, never derived from the
 * `modalId` — the id is a one-time opaque nonce (ADR 0009) and computing a conversation from it would
 * misattribute every entry. It is a SCOPING LABEL only, exactly as on `ModalPrompt`: it authorises
 * nothing and selects no resource, so it needs no branded type.
 */
export interface ResolvedModal {
  conversationId: string
  modalId: string
}

/** Compile-time exhaustiveness guard: a new ModalEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled modal event: ${JSON.stringify(event)}`)
}

/**
 * Remove the prompt whose `modalId` matches, returning a new array. If none matches — an unknown or
 * already-dismissed id — return the SAME array reference, so the caller can return the same state
 * unchanged (deterministic no-op, non-throwing, per ADR 0009 / AC4). Mirrors `fillResult`'s
 * same-reference-on-no-match discipline.
 *
 * #1140: its sole caller now looks the prompt UP before calling — the `dismissed` arm needs the held
 * prompt's conversation to record it — so that arm's no-op returns before reaching here and this
 * function's same-reference path is no longer the one doing the work. Kept rather than inlined: the
 * contract is the discipline `removeRejection` and `dropListed` below also hold, and a helper that
 * cannot no-op is a trap for the next caller.
 */
function removeById(outstanding: readonly ModalPrompt[], modalId: string): readonly ModalPrompt[] {
  const next = outstanding.filter((p) => p.modalId !== modalId)
  return next.length === outstanding.length ? outstanding : next
}

/**
 * Append a `modalId` to the rejection list, de-duplicated: a repeat returns the SAME array reference so
 * the caller can return the same state unchanged (#248's FIFO window can, in a race, redeliver an id).
 * Mirrors `removeById`'s same-reference-on-no-change contract.
 */
function appendUnique(rejections: readonly string[], modalId: string): readonly string[] {
  return rejections.includes(modalId) ? rejections : [...rejections, modalId]
}

/**
 * Remove a `modalId` from the rejection list, returning a new array — or the SAME array reference when
 * no id matches (an unknown or already-dismissed id), a deterministic non-throwing no-op. Mirrors
 * `removeById` for the `readonly string[]` surface.
 */
function removeRejection(rejections: readonly string[], modalId: string): readonly string[] {
  const next = rejections.filter((id) => id !== modalId)
  return next.length === rejections.length ? rejections : next
}

/**
 * Append a suppression entry (#1140), de-duplicated on `modalId` — a repeat returns the SAME array
 * reference. The sibling of `appendUnique` for the record-shaped slice; the two stay separate rather
 * than one generic helper because they de-duplicate on different things (a whole string vs one field)
 * and collapsing them would hide which.
 */
function appendResolved(
  resolved: readonly ResolvedModal[],
  entry: ResolvedModal
): readonly ResolvedModal[] {
  return resolved.some((r) => r.modalId === entry.modalId) ? resolved : [...resolved, entry]
}

/**
 * Drop every row whose conversation is in the set, returning a new array — or the SAME array reference
 * when the set matches nothing, so the caller can hand the state object straight back (#1140). ONE
 * generic helper for both scoped slices, which is honest rather than merely terse: `outstanding` and
 * `resolved` are scoped by the same key, so a future change to what "belongs to this server" means has
 * one place to land, and the two slices cannot drift apart into a half-scoped clear.
 *
 * Membership is `Set.has`, never a bare object keyed by id: these conversation ids are the DAEMON's, and
 * `ServerOrigin`'s docblock (`shared/ipc/events.ts`) rules a `Set` for any consumer indexing by one — a
 * `__proto__` id would otherwise resolve onto `Object.prototype`. It scans own field VALUES and never
 * re-keys either slice by the conversation id, which is what keeps `selectHasOutstandingFor`'s
 * ordered-array contract (and the same prototype argument, made there) true.
 */
function dropListed<T extends { conversationId: string }>(
  rows: readonly T[],
  conversationIds: ReadonlySet<string>
): readonly T[] {
  const next = rows.filter((row) => !conversationIds.has(row.conversationId))
  return next.length === rows.length ? rows : next
}

/**
 * Pure reducer — no mutation, returns fresh state. `shown` is idempotent on `modalId` (#195): a
 * never-seen id appends, a re-delivered still-outstanding id updates in place, and a re-delivered
 * already-resolved id is a same-reference no-op WITHIN THE CURRENT CONNECTION — so a duplicate delivery
 * never double-shows. #510 scoped that last clause to a connection: `reconnected` clears `resolved`, so
 * the same id re-sent after a handshake DOES re-surface. #1140 scopes it once more, to a connection OF
 * ONE SERVER: the clear reaches only the reconnecting server's conversations, so a duplicate on a
 * server whose link never dropped is still suppressed while a re-send on the one that reconnected
 * re-surfaces. `dismissed` removes by id, recording the removed prompt's conversation and id as
 * resolved, or no-ops on an unknown id. `reset` (#1140) is the pairing boundary and the only unscoped
 * clear here.
 *
 * PURE, and that is what fixes the shape of the scoping: a `(state, event)` fold reads no store, so the
 * conversations belonging to the reconnecting server arrive ON the event and the caller is what resolves
 * them. Mirrors `reduceTimeline`: a `switch` on the sealed union with an `assertNever` default, and a
 * same-reference return when nothing changes so an unchanged slice does not churn selectors.
 */
export function reduceModal(state: ModalState, event: ModalEvent): ModalState {
  switch (event.type) {
    case 'shown': {
      // Check `resolved` first — the cheap duplicate-delivery early-out: a prompt the client already
      // answered/dismissed (optimistically, #237) must NOT re-surface WITHIN THE CURRENT CONNECTION.
      // Same-reference no-op. #510: ACROSS a reconnect it must re-surface, and does — the `reconnected`
      // arm clears the entry, so this check finds nothing after that server's handshake. #1140: the
      // match is on `modalId` alone, which stays the sole correlation key (ADR 0009) — the entry's
      // conversation scopes the CLEAR, never the lookup, so a re-delivered id is suppressed no matter
      // which conversation re-delivers it.
      if (state.resolved.some((r) => r.modalId === event.modalId)) return state
      const prompt: ModalPrompt = {
        // #878: COPIED from the event, never derived. `modalId` is a one-time, opaque nonce (ADR 0009)
        // and computing a conversation id from it would misattribute every prompt while pushing the
        // nonce into a value later consumers may render or key on.
        conversationId: event.conversationId,
        modalId: event.modalId,
        class: event.class,
        title: event.title,
        prompt: event.prompt,
        options: event.options,
        defaultOptionId: event.defaultOptionId,
        ...('reason' in event ? { reason: event.reason } : {}),
        ...('reasonType' in event ? { reasonType: event.reasonType } : {}),
        ...('blockedPath' in event ? { blockedPath: event.blockedPath } : {}),
        ...('description' in event ? { description: event.description } : {}),
        ...('defaultToNo' in event ? { defaultToNo: event.defaultToNo } : {})
      }
      // Re-delivery of a still-outstanding id: replace in place from the RE-DELIVERED fields
      // (match-and-replace takes the latest) — position + length preserved, no duplicate append.
      // Spread state so the orthogonal `rejections`/`resolved` surfaces survive a prompt install.
      const outstanding = state.outstanding.some((p) => p.modalId === event.modalId)
        ? state.outstanding.map((p) => (p.modalId === event.modalId ? prompt : p))
        : [...state.outstanding, prompt]
      return { ...state, outstanding }
    }
    case 'dismissed': {
      // The held prompt IS the record's source (#1140): its conversation is what a scoped clear will
      // later match on, and this is the last moment it is in hand. Looking it up first also serves as
      // the no-op guard, which is why the guard moved off `removeById`'s return.
      const dismissedPrompt = state.outstanding.find((p) => p.modalId === event.modalId)
      // Unknown/already-dismissed id: nothing to remove, and deliberately nothing recorded either — a
      // `dismissed` for a never-outstanding id must not poison `resolved`, or a later legitimate `shown`
      // of that id would be wrongly suppressed (ordering edge). It also means no entry can ever carry a
      // conversation this store did not hold a prompt for.
      if (dismissedPrompt === undefined) return state
      // Genuine removal — the single choke point where a prompt leaves `outstanding` (answer/cancel/
      // remote/timeout all dispatch `dismissed`). Record the id so a reconnect re-send no-ops (#195),
      // with the conversation COPIED off the prompt by name, never derived from the nonce.
      // Spread state so `rejections` survives a real clear (#249).
      const outstanding = removeById(state.outstanding, event.modalId)
      const resolved = appendResolved(state.resolved, {
        conversationId: dismissedPrompt.conversationId,
        modalId: event.modalId
      })
      return { ...state, outstanding, resolved }
    }
    case 'rejected': {
      const rejections = appendUnique(state.rejections, event.modalId)
      // Duplicate id: appendUnique returned the same array — return the same state (no churn).
      if (rejections === state.rejections) return state
      const owner = state.outstanding.find((p) => p.modalId === event.modalId)
        ?? state.resolved.find((p) => p.modalId === event.modalId)
      const rejectionOwners = owner ? appendResolved(state.rejectionOwners, {
        modalId: event.modalId, conversationId: owner.conversationId
      }) : state.rejectionOwners
      return { ...state, rejections, rejectionOwners }
    }
    case 'rejectionDismissed': {
      const rejections = removeRejection(state.rejections, event.modalId)
      // Unknown/already-dismissed id: removeRejection returned the same array — return the same state.
      return rejections === state.rejections ? state : {
        ...state, rejections,
        rejectionOwners: state.rejectionOwners.filter((r) => r.modalId !== event.modalId)
      }
    }
    case 'reconnected': {
      // #415: on every (re)handshake, clear `outstanding` so the daemon's connect-time re-sends are the
      // sole repopulation truth (a still-held prompt re-appends via `shown`, absence = resolved-while-away).
      // #510 DELIBERATELY REVERSES #415 AC3 and clears `resolved` too: both slices are per-CONNECTION
      // truth. Retaining `resolved` guarded nothing — the daemon's reconcile enumerates only STILL-
      // OUTSTANDING modals, so a prompt it already resolved is never re-sent — while costing the bug it
      // was meant to prevent: an answer clicked while the link was down is swallowed by the transport,
      // yet the retained id suppressed the daemon's re-delivery, so the user's explicit Allow decayed
      // into a deny-on-timeout with no way to re-answer. `rejections` still passes through the spread —
      // it has no daemon repopulation path.
      //
      // #1140 SCOPES BOTH SLICES TO THE RECONNECTING SERVER, and it is one filter over each rather than
      // two policies: `connected` means "THIS server's connection came back" (#1117, #1068), so #415's
      // rule holds unchanged FOR THAT SERVER while another server's outstanding decision stays on
      // screen. Scoping `outstanding` alone would compile and satisfy that sentence while trading one
      // cross-server leak for another — dropping server A's suppression entries lets a duplicate `shown`
      // on A's still-live connection re-surface a prompt the operator already answered, the exact bug
      // #195 exists to prevent — so the two slices are scoped together or not at all.
      //
      // Each slice is guarded independently, inside `dropListed`, so the same-reference-on-no-change
      // discipline survives: a slice the set does not touch keeps its reference (PermissionModal selects
      // `outstanding` under Object.is, so a fresh [] would re-render for no state change), and a
      // reconnect with nothing at all to clear returns the same state (AC4: no churn on the first
      // connect, on a server holding nothing here, or on one holding only unlisted conversations).
      const outstanding = dropListed(state.outstanding, event.conversationIds)
      const resolved = dropListed(state.resolved, event.conversationIds)
      if (outstanding === state.outstanding && resolved === state.resolved) return state
      return { ...state, outstanding, resolved }
    }
    case 'reset':
      // #1140: the pairing ended, so every slice goes — including `rejections`, which the reconnect arm
      // above deliberately never touches, and including prompts held for a conversation no server's list
      // ever carried, which no scoped clear can reach. Returns `initialModalState` BY REFERENCE (the
      // `reduceTimeline` / `reduceSession` `reset` shape), so a redundant clear at an already-empty store
      // is `Object.is`-identical and wakes no listener at all — the subscriber short-circuit the other
      // whole-store clears in `clearPairingScopedState`'s dep set carry.
      return initialModalState
    default:
      return assertNever(event)
  }
}

export const initialModalState: ModalState = { outstanding: [], rejections: [], rejectionOwners: [], resolved: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectItems`). */
export const selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding

/** Selector for the rejection surface (#249) — the read surface, returns the slice by reference. */
export const selectRejections = (s: ModalState): readonly string[] => s.rejections

/**
 * #878: does any outstanding prompt belong to this conversation? A selector FACTORY bound to one
 * `conversationId`, matching `selectActivityFor` / `selectRosterFor` / `selectBacklogFor`. The consumer
 * is the sidebar's status resolver, which lights an input-required dot — so it wants a boolean, not the
 * prompt.
 *
 * A `===` scan over the ordered array, deliberately: `outstanding` is NEVER re-keyed by the
 * conversation id. That id is a daemon-asserted string, and comparing own field VALUES has no prototype
 * hazard at all — a `'__proto__'` or `'constructor'` query cannot resolve onto `Object.prototype`, and
 * no assignment path exists to pollute one. The scan also preserves the array's referential stability,
 * which ADR 0009 § "Ordered array + scan-by-id, not a Map" chose the array for. Re-keying by this id
 * would reintroduce both hazards at once.
 *
 * No hoisted `EMPTY_*` constant and nothing to memoize — unlike the sibling selectors, which return
 * arrays: a `boolean` compares by value, so a fresh `false` is `Object.is`-identical to the last one and
 * a component binding this re-renders only when ITS conversation's answer flips.
 *
 * An unknown / never-seen id is a legitimate query answered `false`, not an error — the same
 * deterministic non-throwing discipline the reducer's unknown-`modalId` arms hold.
 */
export const selectHasOutstandingFor =
  (conversationId: string) =>
  (s: ModalState): boolean =>
    s.outstanding.some((p) => p.conversationId === conversationId)
