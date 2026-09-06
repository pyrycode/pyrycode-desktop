import { useEffect, useMemo, useRef } from 'react'
import { useModelListStore, selectModelListFor, type ModelListEntry } from '../../store/modelListStore'
import { useRunConfigStore, selectSnapshot, runConfigStore } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId, sessionIdStore } from '../../store/sessionIdStore'
import {
  useRunSettingsWriteStore,
  selectEffectiveSettings,
  runSettingsWriteStore
} from '../../store/runSettingsWriteStore'
import { useLastEffortStore, selectLastEffort, lastEffortStore } from '../../store/lastEffortStore'
import { effortRowFor } from './RunConfigSections'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'

// #1169 — a new chat opens at the last effort level used. The footer's effort control draws nothing when
// the session carries no explicit effort (`SessionSettingsPayload.effort === ''`, the inherited daemon
// default), which is every session nobody has set a level on; and unlike the model there is nothing to
// fall back on, because claude's session-open line does not carry effort at all. So this file makes sure
// a session HAS one rather than reporting one nobody holds.
//
// IT SUPPLIES A VALUE AND A MOMENT, NOTHING ELSE. The write path is untouched: `changeSetting` →
// `submitSettingsChange` already sends one `set_session_settings` carrying the single changed field, and
// `runSettingsWriteStore` already holds the optimistic overlay and folds the confirm or reject back in.
// The value is the level `lastEffortStore` remembers (written on a daemon CONFIRM by `foldWriteEvent`);
// the moment is when the chat is open, its session id is addressable, and its published levels are known.
//
// THE VALUE REACHES THE LAUNCH ARGUMENTS RATHER THAN THE TURN STREAM. Since pyrycode#2085 the claude
// process starts on the first message while the conversation's session is minted and bound at creation,
// so a `set_session_settings` against a never-messaged conversation persists with no child running and
// the first message materialises the child with the setting already composed in. Nothing new is needed on
// the wire, and a per-message effort field would be the wrong shape.
//
// NEVER AN INVENTED LEVEL. The remembered value is only ever one the daemon published and then confirmed,
// and it is re-validated against the published levels before it is sent. With nothing usable the control
// stays blank — #988's constraint that nothing this client displays here is client-authored. Mobile ships
// a client-side `default_effort` preference it never applies; that is a display lie and is not mirrored.
//
// THE THREE BLOCKERS ARE WHAT MAKE THE MOMENT REACHABLE AT ALL, and none of them is re-implemented here:
// #1166's `requestConversationConfig` asks for the opened chat's run configuration and model list without
// waiting for a turn to end; #1167's `clearRunConfig` drops the previous chat's snapshot and write state,
// which is what makes a blank effort control reachable; #1168's `effortRowFor` resolves an unconfigured
// chat's inherited-default row, which is what makes its levels knowable. #1176 refuses a late reply
// naming another chat, so the snapshot and session id read below always describe the open one.

/**
 * Everything the decision reads. Gathered into one object rather than a parameter list because seven of
 * them are `string`-ish and a positional call would cross-wire silently.
 *
 * `effort` and `model` are `selectEffectiveSettings`' COMPOSED values (pending overlay > client-confirmed
 * override > snapshot base), not the raw snapshot: an apply that is already in flight or already
 * confirmed must read as an effort, which is what makes rule 4 a loop guard.
 *
 * `appliedFor` is the conversation id this leaf last applied for, or `null`. It is an input rather than
 * something the decision reads for itself so that every rule stays testable as data.
 */
export interface EffortDefaultInput {
  conversationId: string | null
  appliedFor: string | null
  sessionId: string | null
  effort: string
  model: string
  models: ModelListEntry | null | undefined
  remembered: string | null
}

/**
 * The whole decision, as a pure function: the level to apply, or `null`. `vitest.config.ts` is
 * `environment: 'node'` globally, so no test in this repo runs a React effect — every rule below is
 * unit-testable only because it is data rather than a branch inside the effect.
 *
 * THE RULES, IN ORDER:
 *
 *  1. No chat is open → there is no opening to apply to.
 *  2. Nothing remembered → nothing to apply (AC4's first arm). A fresh install, or a run in which every
 *     level so far was rejected.
 *  3. This chat's opening has already had its attempt → nothing. AC3's no-retry arm and the
 *     one-per-chat-opening rule, which are the same rule.
 *  4. The chat reports an effort of its own → nothing (AC2). It has already answered the question this
 *     file exists to answer, and applying anyway would silently overwrite the posture its operator set.
 *  5. No addressable session id → nothing. There is nothing to write to.
 *  6. The remembered level is not among the levels published for this chat's model → nothing (AC4's
 *     second arm). Levels are published PER MODEL, so a level carried over from one model may not exist
 *     for the next.
 *
 * WHY RULE 3 IS A MARKER AND NOT `runSettingsWriteStore.error`. The obvious guard is "a standing effort
 * rejection blocks the retry", and it is wrong: `changeDispatched` clears `error`, so an operator picking
 * a MODEL after the default was refused clears the guard while the chat's effort is still `''` — and the
 * refused level goes out again, once per unrelated setting change. That is reachable with no switch and
 * violates AC3 as written. The marker has no such coupling: nothing on the write path can clear it.
 * Pinned by a named test that dispatches exactly that unrelated model change.
 *
 * RULES 3 AND 4 ARE DIFFERENT FABRIC ON PURPOSE, and together they are what stops a self-inflicted write
 * loop against the daemon over the relay. Rule 4 is the store's composed truth about the session (the
 * optimistic overlay makes the effort non-empty in the same synchronous step the send is recorded, so a
 * second frame cannot go out); rule 3 is this leaf's own record of what it did (the only one that
 * survives a rejection's rollback). Both are deterministic code, neither is a counter.
 *
 * RULE 5 IS ALSO THE CROSS-CHAT GUARD. `isAddressableSessionId` is reused from `runSettingsControls`
 * rather than restated — `null` (never observed) and `''` (the daemon says it has no session to address)
 * are both inert. #1167's switch clears the session id, so between that clear and the new chat's reply
 * this rule is what stops a default being written into the session the operator just left, which is the
 * sharp hazard `subscribeRunConfig`'s docblock names. `changeSetting` re-checks it downstream as its own
 * gate; this rule is here so the decision is complete as data, not as a substitute for that gate.
 *
 * THAT GUARD COVERS BOTH INGRESSES INTO `sessionIdStore`, AND ONLY SINCE #1192 — worth naming, because
 * the argument above is about `runConfigReceived` alone and would be incomplete on its own. The other
 * ingress is `sessionIdBridge`'s `sessionTransition` marker, which is app-lifetime rather than
 * conversation-scoped; before #1192 it wrote `event.newSessionId` verbatim whichever chat the marker
 * described, so a marker fired by an eviction elsewhere could have satisfied rule 5 with a FOREIGN session
 * id in the window after a switch where the new chat's `model_list` had landed but its `runConfigReceived`
 * had not. #1192 gates that ingress on the marker naming the open conversation, which closes the window
 * for this decision and for the operator-driven footer controls alike. The conclusion is therefore
 * conditional on that gate rather than unconditional: a future widening of `subscribeSessionId`'s
 * attribution check re-opens it here, silently, because nothing in THIS file would change.
 *
 * RULE 6 IS A MEMBERSHIP SCAN BY EQUALITY, never an object keyed by claude-authored text — the
 * `EFFORT_LEVELS_FIELD` idiom, and the reason no `__proto__`-as-key hazard arises on a value that took a
 * round trip through local storage. It is ALSO the single trust boundary this feature adds: a persisted
 * level can only leave this function by being byte-identical to a level the daemon itself just published
 * for this chat's model, so the only strings that reach the wire are strings the daemon minted. No
 * fallback list, no repair, no normalisation, no case fold — #976 deleted the last client-side vocabulary
 * and nothing here re-mints one. `?? []` guards the shape rather than the type, for `EffortSection`'s
 * stated reason.
 *
 * `conversationId` is NOT used to address the write — the write addresses the SESSION id. It is here for
 * rule 1 and as rule 3's key.
 */
export function effortDefaultToApply(input: EffortDefaultInput): string | null {
  const { conversationId, appliedFor, sessionId, effort, model, models, remembered } = input
  if (conversationId === null) return null
  if (remembered === null) return null
  if (appliedFor === conversationId) return null
  if (effort !== '') return null
  if (!isAddressableSessionId(sessionId)) return null
  const levels = effortRowFor(models, model)?.effort_levels ?? []
  return levels.includes(remembered) ? remembered : null
}

/**
 * The headless leaf that runs the decision — mounted in the composer footer beside `ComposerEffortMenu`,
 * where the conversation id is already in hand and where its lifetime is the open chat's. It renders
 * `null`, so it adds no DOM node and no footer count, anchor or geometry assertion in `e2e/` can see it.
 *
 * WHY A SEPARATE LEAF rather than an effect inside `ComposerEffortMenu`. That container is a
 * display-and-pick control documented as reading no state beyond what it draws; folding a write policy
 * into it would fuse two unrelated concerns and make the control's own tests answer for a decision they
 * do not own. A `null`-rendering sibling costs some zustand subscriptions and no render.
 *
 * THE HOOKS ARE THE WAKE SIGNAL; THE EFFECT BODY RE-READS THE FOUR STORE-BACKED INPUTS. The effect
 * resolves the session id, the snapshot, the write state and the remembered level through `getState()`
 * rather than through the render-time closure, for two reasons that both matter. `main.tsx` wraps the app
 * in `React.StrictMode`, which double-invokes an effect against the SAME closure — a render-time `effort`
 * of `''` would still read `''` on the second invocation even though the first already dispatched. And the
 * composed effort is what rule 4 needs to be true of the STORE, not of a render that has already been
 * superseded. `RunSettingsWriteData` reads its own store the same way for the same class of reason. The
 * ref closes the double-send independently (a ref survives StrictMode's simulated remount), so the two
 * guards are genuinely independent rather than one restated.
 *
 * `models` IS THE ONE EXCEPTION and is deliberately taken from the render closure, so the sentence above
 * is four-of-five rather than universal. It is in the dependency array, so no wake is missed; and zustand
 * hands out the same object identity across a StrictMode double-invoke, so there is no stale-closure
 * hazard of the kind `getState()` exists to close. Re-reading it would mean rebuilding the memoised
 * per-conversation selector inside the effect for no change in outcome.
 *
 * `conversationId` arrives as a PROP rather than as another store read, the settled house idiom:
 * Composer already subscribes to `activeConversationId`, so the prop costs no subscription. It is NOT the
 * session id also read here — those are different identifiers, and a session id keys nothing in the
 * model-list map.
 *
 * Nothing here is async: no promise, no timer, no listener of its own, so there is no cancellation path
 * to define and no cleanup to return. The zustand subscriptions are hook-owned and unmount with the
 * conversation screen.
 *
 * NOTHING ON THIS PATH LOGS, and that is the decision rather than an omission: every value here is either
 * claude-authored text or a conversation-scoped identifier, and ADR 0007's content-free rule points the
 * same way as `ComposerEffortMenu`'s own "nothing on this path is logged at all".
 */
export function EffortDefaultData({
  conversationId
}: {
  conversationId: string | null
}): null {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the zustand
  // selector: it returns a fresh object every call, which defeats Object.is and wakes this leaf on every
  // store tick — ComposerEffortMenu's own note, one control over.
  const writeState = useRunSettingsWriteStore((s) => s)
  const remembered = useLastEffortStore(selectLastEffort)
  // A useMemo-stable selector per id — a fresh closure each render would churn the subscription. A null
  // conversation selects nothing THROUGH THE SAME PATH, with no invented key and no second branch, and
  // `null` is a stable reference.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)

  // The conversation id this leaf last applied for. A ref rather than state: it must not trigger a
  // re-render, and it is this leaf's own record rather than anything shared. One id, not a set — the
  // ticket's guard is "one per chat OPENING", so a switch away and back is a new opening and gets one
  // more attempt, which is bounded (a refused level costs exactly one frame) and needs a fresh operator
  // action each time.
  const appliedFor = useRef<string | null>(null)

  useEffect(() => {
    const effective = selectEffectiveSettings(
      selectSnapshot(runConfigStore.getState()),
      runSettingsWriteStore.getState()
    )
    const level = effortDefaultToApply({
      conversationId,
      appliedFor: appliedFor.current,
      sessionId: selectSessionId(sessionIdStore.getState()),
      effort: effective.effort,
      model: effective.model,
      models,
      remembered: selectLastEffort(lastEffortStore.getState())
    })
    if (level === null) return
    // BEFORE the send, so a throw out of `sendCommand` cannot leave this chat eligible for a retry on the
    // next tick. Rule 1 guarantees a non-null id here, but the compiler cannot see through the decision,
    // so the marker is written from the prop under its own narrowing rather than through a `!`.
    if (conversationId !== null) appliedFor.current = conversationId
    // An arrow body, so `window.pyry` is dereferenced at effect time and never during render — under
    // `renderToStaticMarkup` there is no window.pyry and the container smoke test would throw.
    changeSetting(
      {
        sessionId: selectSessionId(sessionIdStore.getState()),
        sendCommand: window.pyry.sendCommand,
        dispatch: runSettingsWriteStore.getState().dispatch
      },
      { field: 'effort', value: level }
    )
  }, [conversationId, sessionId, snapshot, writeState, models, remembered])

  return null
}
