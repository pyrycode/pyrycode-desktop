// The correlation router (#1119): an ANSWER reaches the server that raised the thing it answers, and no
// other. Sibling to `conversationRouter.ts` (#1118), which closed the same hole for the ten commands that
// already carry a `conversation_id`. Five commands remain, and none of them carries one:
// `answerModal` / `cancelModal` (`modal_id`), `answerQuestions` / `refuseQuestions`
// (`question_batch_id`), and `setSessionSettings` (the daemon's own `session_id`). Until this module they
// all reached `registry.active`, whose members resolve to the LAST paired entry at call time — so with
// two servers paired, the answer to host A's permission modal went to whichever host was paired most
// recently, minting a fresh answer token on the wrong connection.
//
// ADR 0009 IS WHY THESE CANNOT BORROW #1118's INDEX: no `conversation_id` rides an ANSWER — the daemon
// resolves the correlation id against its own outstanding state. The inbound `modalShown` /
// `questionShown` events do carry one, but only as an outbound DISPLAY-SCOPING key, and resolving
// modal id → conversation → #1118's router buys a second hop plus a dependency on the conversation index
// happening to know that conversation, which it may not (`requestConversations` still reaches
// `registry.active` only). Resolving the correlation id straight to the server that minted it has no such
// dependency.
//
// A SIBLING MODULE RATHER THAN THREE MORE MAPS IN `conversationRouter.ts`, because the lifetime rules are
// opposite. That index only ever GROWS, since a conversation stays nameable for the process lifetime.
// A modal ends at `modalDismissed` / `modalAnswerRejected` and a batch at `questionDismissed`, and a long
// session raises many of both — a map that only grows is a leak in a process that runs for days. So these
// EVICT ON SETTLE, with an origin check #1118 has no place for (see `forget`). The cost of the split is
// the duplicated `originOf` below; the cost of merging would be one module whose docblock has to say
// "except for these three maps".
//
// REFUSING IS THE POINT, NOT A CONVENIENCE. There is no fallback to "the first connection" or "the most
// recent one" anywhere below. An answer token minted for host A's modal must not be put on host B's wire
// under any circumstance, which is the whole reason this resolution lives in the background process
// rather than as a field the window supplies: the renderer can name an ID, never a SERVER. A refused
// command reaches no connection method, so no token is minted at all — refusing is strictly safer than
// sending.
//
// LOG-FREE OF CONTENT BY CONSTRUCTION. Every diagnostic below is a pair of STRING LITERALS — no template,
// no interpolation, no variable in either position — so no correlation id is representable in a log line
// from here, not merely absent from one. That matters most for `questionBatchId`, the batch's one-time
// unguessable nonce (`events.ts`: "must never reach a log"); the answer tokens are secrets on the same leg
// and are equally out. `DiagnosticEvent` has no identifier-shaped field and no index signature, so logging
// one would additionally require widening a renderer-facing security contract (#126's allowlist, mirrored
// by `RendererDiagnosticEvent` and pinned by `receiveDiagnostic.test.ts`'s Omit) — deliberately out of
// scope for a main-process routing slice.
//
// Electron-free, socket-free and store-free, and it never calls a connection member — it looks one up and
// hands it back. Hence the type parameter, exactly as in `conversationRouter.ts`.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DaemonEvent } from '../shared/ipc/events'
import type { DiagnosticLog } from './diagnosticLog'

/**
 * Upper bound on EACH of the three indexes, in entries. `MAX_INDEXED_CONVERSATIONS`' constant and its
 * argument: at the cap a NEW id is not learned, so it REFUSES rather than mis-routes, while an EXISTING
 * id may still re-point (an overwrite does not grow the map).
 *
 * Eviction makes this unreachable in normal operation for the two settling spaces — it is here for the
 * daemon that sprays `modal_shown` and never dismisses, and for the session space, which has no settle
 * event at all and therefore inherits #1118's grow-and-cap posture whole.
 */
export const MAX_INDEXED_CORRELATIONS = 10_000

/**
 * Upper bound on one correlation id, in UTF-16 code units.
 *
 * The entry cap alone is not enough here. A correlation id is a daemon-supplied string bounded only by
 * `MAX_FRAME_BYTES` (256 KiB), so 10 000 entries of them is ~2.5 GB per index rather than the ≈1 MB of
 * short strings that cap's argument assumes. Real ids are UUID-shaped (36 characters), so 512 is an order
 * of magnitude above anything a conforming daemon mints, and an over-long id FAILS CLOSED: not learned,
 * therefore refused. Same idiom as the repo's other code-level caps (`MAX_SAFE_BYTES`,
 * `MAX_RETRIEVAL_IDENTIFIER_LENGTH`), not a stochastic rule.
 */
export const MAX_CORRELATION_ID_LENGTH = 512

/** Injected dependencies. Both are seams the tests override; neither is effectful here. */
export interface CorrelationRouterDeps<C> {
  /**
   * The registry's per-server accessor. `null` means that server has no live connection — an unpair, or a
   * server that was never paired at all.
   *
   * THIS LOOKUP IS THE BOUNDARY, not the index's own bookkeeping. A known id whose server has no entry
   * refuses on this side whether or not the map still holds the mapping, so an unpair cannot leave
   * anything routable. The deletion beside it (see `resolve`) is hygiene.
   */
  connectionFor: (serverId: string) => C | null
  /** The one content-free logger (#126), shared with every other transport consumer. */
  diagnosticLog?: DiagnosticLog
}

/** The handle the composition root holds for the process lifetime. */
export interface CorrelationRouter<C> {
  /**
   * Wrap one producer's sink: record the correlation→server mappings off each stamped event, forget the
   * ones that just settled, then forward the event UNCHANGED. Applied once per connection, NESTED with
   * #1118's wrapper in the `sink:` position of `createDaemonConnection` — see `originOf` for why that
   * position is the one that works.
   */
  observe(target: DaemonEventSink): DaemonEventSink
  /**
   * The connection that raised this modal, or `null` HAVING ALREADY REFUSED AND LOGGED — which is what
   * keeps the root's call sites one-liners (`routeModal(id)?.answerModal(payload)`) while leaving the
   * whole decision in a module the tests can drive.
   */
  routeModal(modalId: string): C | null
  /** The connection that raised this question batch, on `routeModal`'s terms. */
  routeQuestions(questionBatchId: string): C | null
  /** The connection whose session this id names, on `routeModal`'s terms. */
  routeSession(sessionId: string): C | null
}

/**
 * The three id spaces, as the static log vocabulary. Each value is half of a literal pair — never
 * concatenated with anything daemon-supplied.
 */
type CorrelationKind = 'modal' | 'question' | 'session'

/** One index plus the two cells its bookkeeping needs. Three of these exist, one per space. */
interface CorrelationIndex {
  readonly kind: CorrelationKind
  readonly entries: Map<string, string>
  /**
   * Latched, so a daemon spraying ids past a bound produces ONE record per index rather than one per row.
   * Covers the entry cap and the length guard together: both mean "this index is refusing to grow", and
   * splitting them would buy a second daemon-driven log line for no diagnostic gain.
   */
  capLogged: boolean
}

/**
 * Read the server origin off an event that has already been through `bindServerOrigin`. The twin of
 * `conversationRouter.ts`'s function of the same name, duplicated rather than shared: extracting it would
 * be a refactor of adjacent code, and the two modules are deliberately independent.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the wrapper's
 * parameter as `StampedDaemonEvent`: at a `DaemonEventSink`-typed hole the static type is the BARE union
 * (#1068 carries the stamp beside the union, not inside its arms), and a re-declared parameter would
 * compile only because method parameters are bivariant — sound-looking and unsound.
 *
 * `null` for the registry's not-paired stand-in (which raises nothing anyone answers) and for an unbound
 * producer (which `bindServerOrigin`'s header forbids); both are skipped rather than trusted.
 */
function originOf(event: DaemonEvent): string | null {
  if (!('serverId' in event)) return null
  const { serverId } = event
  return typeof serverId === 'string' && serverId.length > 0 ? serverId : null
}

/**
 * Build the router. Construction is synchronous and total: three maps and three latches, no store read,
 * no timer, no listener, no async work — so there is nothing here for `will-quit` to tear down, and no
 * check-then-act gap between learning a mapping and using it.
 */
export function createCorrelationRouter<C>(deps: CorrelationRouterDeps<C>): CorrelationRouter<C> {
  const { connectionFor, diagnosticLog } = deps

  // Maps, NEVER bare objects. Both the key and the value are daemon-supplied strings, and a
  // `Record<string, string>` written through `__proto__` is prototype pollution reachable from a hostile
  // or confused daemon. `events.ts`'s ServerOrigin docblock rules this for the server id ("if a consumer
  // indexes by it, THE INDEX IS A Map"); it holds identically for a modal id, a batch id and a session id,
  // which arrive on the same wire. Three separate maps, not one namespaced key space: an id learned as a
  // modal must not be routable as a session, and separate maps make that structural rather than a
  // convention a later arm could break.
  const modals: CorrelationIndex = { kind: 'modal', entries: new Map(), capLogged: false }
  const batches: CorrelationIndex = { kind: 'question', entries: new Map(), capLogged: false }
  const sessions: CorrelationIndex = { kind: 'session', entries: new Map(), capLogged: false }

  /**
   * Learn one id's owner. The stamp is the origin `bindServerOrigin` already wrote — this module adds no
   * second stamping path, and could not: it reads what the renderer reads, so an index can never disagree
   * with the surface the window renders.
   *
   * LAST WRITE WINS, and that is load-bearing rather than inherited. #1118 argued from conversations that
   * genuinely move hosts; a live modal id does not move hosts, so the first draft of this module made the
   * two settling spaces first-write-wins on the reasoning that a second server claiming a live nonce is
   * anomalous by construction. The security pass rejected it: BOTH RENDERER STORES ARE MATCH-AND-REPLACE
   * on a re-delivered id (`modalPrompts.ts`'s `shown` arm — "replace in place from the RE-DELIVERED
   * fields" — and `questionBatches.ts`'s identical arm), so refusing the re-point would render host B's
   * title, prompt and option labels while routing the answer to host A's modal: an approval attributed to
   * a prompt the operator never read, exactly the failure `events.ts` names ("showing them as having
   * approved something they never saw"). An index that DISAGREES with the screen is more dangerous than
   * one that obeys an anomalous re-point. What actually closes the cross-host case is `forget`'s origin
   * check plus the unguessability of the ids, not a write rule that can only desynchronise the two.
   *
   * A re-point that actually CHANGES the owner is logged — it is the one state change a hostile paired
   * host could use to claim another host's prompt (it would still need that host's unguessable nonce), so
   * it leaves a content-free trace in the bundle instead of none. An identical re-write logs nothing.
   */
  const learn = (index: CorrelationIndex, id: string, serverId: string): void => {
    // `''` is a real daemon answer on the session arms meaning "no session was resolved" (AC3) and is
    // never an address; the same guard covers the other two spaces for free.
    if (id.length === 0) return
    const held = index.entries.get(id)
    if (held === serverId) return
    const wouldGrow = held === undefined
    if (wouldGrow && (id.length > MAX_CORRELATION_ID_LENGTH || index.entries.size >= MAX_INDEXED_CORRELATIONS)) {
      if (!index.capLogged) {
        index.capLogged = true
        diagnosticLog?.event({ event: 'correlation-index-full', code: index.kind })
      }
      return
    }
    index.entries.set(id, serverId)
    if (!wouldGrow) {
      // One literal pair per space, spelled out rather than built from `index.kind`, so the log surface
      // stays greppable and no expression can ever place a daemon string in either field.
      if (index.kind === 'modal') diagnosticLog?.event({ event: 'modal-reindexed', code: 'reassigned' })
      else if (index.kind === 'question') diagnosticLog?.event({ event: 'question-reindexed', code: 'reassigned' })
      else diagnosticLog?.event({ event: 'session-reindexed', code: 'reassigned' })
    }
  }

  /**
   * Forget one settled id — the whole reason this module is not three more maps in `conversationRouter.ts`.
   *
   * ORIGIN-CHECKED, unlike anything in #1118. A delete keyed on the id alone would let a second paired
   * host retire host A's outstanding prompt by echoing its id in a `modal_dismissed` frame: a cross-host
   * denial of the operator's own permission prompt. Requiring the stamped origin to equal the held owner
   * makes such a frame a no-op. It cannot mis-route either way — the check removes the denial, not a
   * routing hazard.
   *
   * Refusing a post-settle answer costs nothing: a retired batch resolves nothing daemon-side, exactly as
   * a stale `modalId` resolves nothing under first-answer-wins (`events.ts`).
   */
  const forget = (index: CorrelationIndex, id: string, serverId: string): void => {
    if (index.entries.get(id) === serverId) index.entries.delete(id)
  }

  /** The arms that name an id and its server, or retire one. Every other arm is read for nothing. */
  const record = (event: DaemonEvent): void => {
    const serverId = originOf(event)
    if (serverId === null) return
    switch (event.type) {
      case 'modalShown':
        return learn(modals, event.modalId, serverId)
      case 'modalDismissed':
      case 'modalAnswerRejected':
        return forget(modals, event.modalId, serverId)
      case 'questionShown':
        return learn(batches, event.questionBatchId, serverId)
      case 'questionDismissed':
        return forget(batches, event.questionBatchId, serverId)
      // The daemon's own session id, NOT a conversation id — #501 is the standing bug about those two
      // being confused, and keeping this space in its own map read from its own arms is what keeps this
      // slice from confusing them further.
      //
      // THREE ARMS, BECAUSE THE STORE THE WINDOW ADDRESSES HAS TWO WRITERS. The id a `setSessionSettings`
      // carries is `sessionIdStore`'s (every footer control reads it through `selectSessionId`, and
      // `runSettingsWriteBridge.ts`'s `buildSettingsPayload` sends it verbatim), and that store is fed
      // BOTH by `runConfigSnapshot.ts`'s `subscribeRunConfig` (off `runConfigReceived`) AND by
      // `sessionIdBridge.ts`'s `subscribeSessionId` (off `sessionTransition.newSessionId`) — "neither
      // ingress is preferred; arrival order wins". This module's first draft read the run-config arms
      // only, on the premise that the store addresses whatever `runConfigReceived` last reported. It does
      // not, and the gap was reachable on ONE server: after a `/clear` the transition lands a new id in
      // the store while `runConfigSnapshot.ts` leaves the snapshot — and therefore the still-active
      // controls — untouched, and `runConfigLive.ts`'s refresh trigger fires on only two edges (a rising
      // `connected`, a running→not-running turn). Every model / effort / permission-mode change in
      // between would have refused with no frame on any wire, while `submitSettingsChange`'s
      // record-before-send overlay reported it applied. Reading the transition too is what makes this
      // index agree with the store the operator is reading, which is the same rule that made `learn`
      // last-write-wins. Safe on every `WireSessionTransitionReason`: the event is stamped, so it names
      // the right server; `''` is caught by `learn`'s first line; and an `idle_evict` marker mirrors the
      // previous id, so it is an identical re-write that logs nothing.
      case 'runConfigReceived':
      case 'sessionSettingsUpdated':
        return learn(sessions, event.sessionId, serverId)
      case 'sessionTransition':
        return learn(sessions, event.newSessionId, serverId)
      default:
        return
    }
  }

  /**
   * The body all three public members share: look the id up, refuse-and-log on either failure, or hand
   * back the connection. Written once so the safety property has one implementation rather than three.
   */
  const resolve = (index: CorrelationIndex, id: string, refusal: DiagnosticRefusal): C | null => {
    const serverId = index.entries.get(id)
    if (serverId === undefined) {
      diagnosticLog?.event({ event: refusal, code: 'unknown-correlation' })
      return null
    }
    const connection = connectionFor(serverId)
    if (connection === null) {
      // The refusal above is the boundary; this deletion is hygiene, applied at the one moment the stale
      // mapping could ever have mattered. There is deliberately NO reconcile-driven sweep on unpair:
      // `registry.reconcile()` is asynchronous, so a prune called beside it would run before the registry
      // had dropped anything and be a no-op on exactly the unpair path it was written for. #1118 ruled
      // this; inherited rather than re-litigated.
      index.entries.delete(id)
      diagnosticLog?.event({ event: refusal, code: 'server-not-connected' })
      return null
    }
    return connection
  }

  return {
    observe(target: DaemonEventSink): DaemonEventSink {
      return {
        // #518 IS PRESERVED ACROSS THE EXTRA HOP, and the ordering is emitDaemonEvent's own.
        // `target.webContents` is read ONLY inside `send`'s body — never here, never aliased or
        // destructured above — because on a real destroyed BrowserWindow that property read IS the throw.
        // Wrapping a destroyed target is therefore itself safe, and the index keeps recording while no
        // window exists, so a macOS window-close does not blind it.
        isDestroyed: () => target.isDestroyed(),
        webContents: {
          send: (channel: string, event: DaemonEvent): void => {
            // RECORD BEFORE FORWARD. This is the whole no-race argument: anything the window can name,
            // the index has already seen. Reversing these two lines would open a window in which a
            // renderer that acts on an event synchronously routes against a stale index.
            record(event)
            target.webContents.send(channel, event)
          }
        }
      }
    },
    routeModal: (modalId) => resolve(modals, modalId, 'modal-route-refused'),
    routeQuestions: (questionBatchId) => resolve(batches, questionBatchId, 'question-route-refused'),
    routeSession: (sessionId) => resolve(sessions, sessionId, 'session-route-refused')
  }
}

/**
 * The three refusal event names, as a closed set of literals. Naming the KIND in `event` and the REASON in
 * `code` is what satisfies AC4's "records which of the three kinds of answer was refused" on BOTH refusal
 * branches rather than only the unknown-id one, without widening `DiagnosticEvent` — which is
 * `{ event, code? }` with no identifier-shaped member and no index signature.
 */
type DiagnosticRefusal = 'modal-route-refused' | 'question-route-refused' | 'session-route-refused'
