import { useMemo } from 'react'
import { composerModelMenuModel, type ComposerModelLayers } from './ComposerModelMenu'
import { selectDisplayedEffort } from './ComposerEffortMenu'
import type { WireAgent, WireModelOption } from '@shared/wire/types'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId, sessionIdStore } from '../../store/sessionIdStore'
import {
  useModelListStore,
  selectModelListFor,
  type ModelListEntry
} from '../../store/modelListStore'
import {
  useAnnouncedModelStore,
  selectAnnouncedModelFor,
  type AnnouncedModel
} from '../../store/announcedModelStore'
import { useReportedContextStore, selectReportedContextFor } from '../../store/reportedContextStore'
import { contextTokenSource } from './contextTokenSource'
import {
  useRunSettingsWriteStore,
  runSettingsWriteStore,
  selectEffectiveSettings,
  selectError,
  selectPendingFields,
  type SettingsChange
} from '../../store/runSettingsWriteStore'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'
import { contextUsagePercent } from './contextUsage'
import {
  conversationListStore,
  useConversationListStore,
  selectConversations,
  selectConversationAgentFor,
  type ConversationListState
} from '../../store/conversationListStore'
import { sessionStore, useSessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'

/** Subscribe to the conversation's owner, never the last host whose status changed. */
export function useSessionSettingsConnected(conversationId: string | null): boolean {
  const rows = useConversationListStore(selectConversations)
  const serverId = serverIdForOpenConversation(rows, conversationId)
  return useSessionStore(s => serverId !== null && s.statuses.get(serverId)?.type === 'connected')
}

/** #1651 — which agent runs the conversation these controls configure. The owner is resolved exactly as
 *  `useSessionSettingsConnected` resolves it, then #1649's `selectConversationAgentFor` answers from that
 *  host's own rows. A null id or an owner that cannot be attributed answers Claude, the wire's reading of
 *  an absent agent. It returns a primitive, so the subscription is Object.is-stable. */
export const selectAgentForConversation =
  (conversationId: string | null) =>
  (s: ConversationListState): WireAgent => {
    const serverId = serverIdForOpenConversation(selectConversations(s), conversationId)
    return serverId === null || conversationId === null
      ? 'claude'
      : selectConversationAgentFor(serverId, conversationId)(s)
  }

/** The hook every settings control reads its conversation's agent through, with a useMemo-stable selector
 *  per id so a fresh closure per render does not churn the subscription. */
export function useConversationAgent(conversationId: string | null): WireAgent {
  const selectAgent = useMemo(() => selectAgentForConversation(conversationId), [conversationId])
  return useConversationListStore(selectAgent)
}

/** Re-read ownership and status at the action boundary, including for pre-opened controls. */
export function sessionSettingsConnected(conversationId: string | null): boolean {
  const serverId = serverIdForOpenConversation(
    selectConversations(conversationListStore.getState()), conversationId
  )
  return serverId !== null && sessionStore.getState().statuses.get(serverId)?.type === 'connected'
}

export function changeConnectedSetting(conversationId: string | null, change: SettingsChange): void {
  const sessionId = selectSessionId(sessionIdStore.getState())
  if (!sessionSettingsConnected(conversationId) || !isAddressableSessionId(sessionId)) {
    window.pyry.sendDiagnostic({ event: 'session-settings', code: 'unavailable' })
    return
  }
  window.pyry.sendDiagnostic({ event: 'session-settings', code: 'submitted' })
  changeSetting(
    { sessionId, sendCommand: window.pyry.sendCommand, dispatch: runSettingsWriteStore.getState().dispatch },
    change
  )
}

// The Run configuration sheet's Model / Effort / YOLO sections (Figma node 20-100 subtree
// 20:111/20:130/20:143). #188 rendered them read-only; #257 makes them INTERACTIVE — selecting a
// model, picking an effort, or toggling YOLO submits the change for the current session. The
// container/pure-view split mirrors LogDataSection: RunConfigView is props-in/markup-out (no store
// read, no window.pyry → server-renderable with no mock), and RunConfigSections is thin glue.
//
// This slice owns NONE of the optimistic/confirm/reject/rollback logic — that is #256's
// runSettingsWriteStore. The displayed value is #256's composed selectEffectiveSettings (pending
// overlay > client-confirmed override > snapshot base); a control just submits an intent via
// changeSetting and renders the store's composed result. Operability keys off HANDLER PRESENCE: a
// section given a handler is operable, a section given none renders exactly #188's inert markup — which
// is the whole AC5 gate at the view layer, since the container withholds the handler until a session id
// exists (sessionIdStore, #259).

// #975 — the published-row lookup, re-anchored on the daemon-published rows now that MODEL_CATALOG is
// gone. String equality only: no toLowerCase, no includes, no startsWith, no trim, no regex.
//
// #976 GAVE IT A SECOND CALLER AND THAT IS WHY IT IS NAMED FOR THE RULE RATHER THAN FOR EITHER USE.
// The two callers join DIFFERENT STRINGS through the SAME rule, and conflating the two inputs is the
// easy mistake: `RunningModelSection` joins what claude ANNOUNCED for the running turn, while
// `EffortSection` joins the SESSION's model — the same string the Model rows mark a row selected by.
// One home for the rule is what keeps a substring match from creeping back into one of two copies.
//
// The key is `value` and nothing else. It is the field the deleted catalog lookup already compared —
// `entry.family` was the token a row submitted, and `value` is the argument a row submits now — so the
// rewrite moves the lookup onto real published data without changing what it compares.
// `resolved_model` is deliberately NOT the key: the wire contract excludes it, and joining on it would
// give the exactness guard an exception, since a row's own resolved_model is routinely a superstring
// of its own `value` ('haiku' → 'claude-haiku-4-5-20251001'). That field is DISPLAYED on each row's
// second line instead, which is where an alias's current resolution reaches the operator.
//
// A MISS IS ORDINARY, NOT AN ERROR, and stays the common case: claude echoes an identifier at least as
// specific as the one it was given, so an announced identifier need not appear in any published row.
// The verbatim fallback is the correct outcome then — the operator sees the true running identifier
// rather than a display name inferred from a resemblance. Widening this into a substring match to make
// it fire more often would reintroduce exactly what #560 exists to stop.
//
// #988 GAVE IT A THIRD CALLER AND IS WHY IT IS EXPORTED. The composer footer's model menu joins the
// SESSION's model — EffortSection's input, not RunningModelSection's — for both its trigger label and its
// row marking. Exporting is the whole change: copying the four-line body into that file would be the
// second copy this docblock exists to prevent, and lifting the rule into a new co-located module would be
// a refactor that ticket does not need. It stays declared here, beside the two of three callers that
// already read it.
//
// #1168 DID NOT TOUCH IT, and that is a decision rather than an omission — see effortRowFor below. Some
// callers resolve an empty model to the inherited-default row and some must not, and the cheapest way to
// be sure of the second group is that this body never learned about the case. #1423 kept it that way when
// it moved a fourth surface into the first group: it changed one call site in ComposerModelMenu.tsx, not
// this rule.
//
// #1651 MADE THE AGENT PART OF THE RULE. A merged list carries both agents' rows, and a model of the other
// agent is refused on a session, so a row matches only when its `value` is equal AND it belongs to the
// conversation's agent. The agent is a required argument so no caller can join across agents by omission.
export function publishedRowFor(
  models: ModelListEntry | null | undefined,
  model: string,
  agent: WireAgent
): WireModelOption | undefined {
  return models?.models.find((row) => row.value === model && rowAgent(row) === agent)
}

// #1651 — which agent offers a row. An untagged row is Claude's, the wire rule `agentFromWire` states, so a
// daemon that sends no tags reads exactly as it did before.
function rowAgent(row: WireModelOption): WireAgent {
  return row.agent ?? 'claude'
}

/** #1651 — the rows one agent offers, in the daemon's order: the only rows a conversation's model lists may
 *  show. Nothing is reordered or deduped; `[]` when no list has arrived. */
export function modelRowsFor(
  models: ModelListEntry | null | undefined,
  agent: WireAgent
): readonly WireModelOption[] {
  return (models?.models ?? []).filter((row) => rowAgent(row) === agent)
}

// #1168 — the row `value` the daemon publishes for its own inherited default. One of the measured set
// ModelSection's docblock records (`default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`), and
// pyrycode#2124's captured `initialize` reply reports it resolving to `claude-sonnet-5`: the daemon
// publishes the inherited default as an ORDINARY ROW, which is what makes this a join rather than a
// fallback list.
//
// Client-owned, and it meets daemon strings only by being handed to publishedRowFor's `===` — the
// EFFORT_LEVELS_FIELD idiom in this same file: a linear scan by equality, never an object keyed by
// claude-authored text. It is deliberately NOT exported. The tests seed the literal themselves, so
// changing this value has to fail a test rather than be followed silently by one.
const INHERITED_DEFAULT_MODEL_VALUE = 'default'

/**
 * #1168 — the row whose `effort_levels` an effort surface offers, and the ONE home of that rule for both
 * of them: EffortSection below and composerEffortMenuModel in ComposerEffortMenu.tsx.
 *
 * It is publishedRowFor with ONE substitution, on the lookup ARGUMENT: the empty model — which the wire
 * contract calls the inherited daemon default and explicitly NOT absent (`WireSessionSettings.model`) —
 * looks up INHERITED_DEFAULT_MODEL_VALUE instead. Every other model is passed through untouched, and the
 * comparing is still entirely publishedRowFor's single `===`. So no family derivation, no substring, no
 * prefix, no case fold and no trim exists on this path, before or after the substitution: `''` is the
 * only input that takes the branch, and ` `, `Default` and `default-x` all miss exactly as they did.
 *
 * WHY A SEPARATE FUNCTION RATHER THAN A BRANCH INSIDE publishedRowFor. That helper has five callers
 * joining three different strings, and the case belongs to some of them and not others:
 * `RunningModelSection` joins what claude ANNOUNCED (a different identifier answering a different
 * question — an announcement of `''` is a real one the daemon emitted and renders verbatim); and
 * `composerPermissionModeMenuModel` reads `supports_auto_mode` off the row it resolves, so it would
 * start hiding the `auto` entry on every inherited-default chat — a behaviour change to a third control,
 * invisible to every criterion #1168 was judged by. Both are pinned by tests in their own files.
 *
 * Model marking is decided separately by composerModelMenuModel. This helper keeps the saved/picked
 * model's internal default resolution for effort offerings, regardless of the announced running row.
 *
 * IT IS A JOIN, NEVER A VOCABULARY. With no inherited-default row published, or no `model_list` frame
 * received, this returns `undefined` and both surfaces render exactly what they rendered before #1168 —
 * the sheet's UNKNOWN line and the footer's inert label. #976 deleted the last client-side level list and
 * nothing here re-mints one: the only client-owned string added is the row value to look up, and the
 * levels themselves stay entirely the daemon's.
 *
 * PRECEDENCE, so a cold read need not guess: the empty-model branch resolves to
 * INHERITED_DEFAULT_MODEL_VALUE and consults no other row. A daemon publishing a row whose `value` is
 * literally `''` is not a case this path arbitrates — one rule, one answer. ComposerModelMenu's docblock
 * keeps its own separate answer to that question for its own control, and #1168 does not reopen it.
 */
export function effortRowFor(
  models: ModelListEntry | null | undefined,
  model: string,
  agent: WireAgent
): WireModelOption | undefined {
  // #1651: the substitution is Claude's. The `default` row is a Claude row, and a new Codex conversation
  // starts with no model, so on Codex the empty model resolves no row and offers no levels.
  if (model === '') return agent === 'claude' ? publishedRowFor(models, INHERITED_DEFAULT_MODEL_VALUE, agent) : undefined
  return publishedRowFor(models, model, agent)
}

// #975 — the Model section's two non-populated readings, which the store deliberately keeps apart and
// this section must not collapse. They read as DIFFERENT SENTENCES, not one sentence in two places
// (the BackgroundTaskPanel convention): the first is the not-yet-known reading in the sheet's existing
// vocabulary, the second a positive statement that claude offered nothing. Client-owned and
// apostrophe-free — renderToStaticMarkup escapes ' → &#x27;. Neither may contain 'Current model': the
// selection marker is asserted by COUNT at several unit sites and page-wide in e2e.
const RUN_CONFIG_MODELS_UNKNOWN_COPY = 'Model list not yet known'
const RUN_CONFIG_MODELS_EMPTY_COPY = 'No models offered'

/** #975 — the frame-level truncation report, distinct from a row's own. `models.length +
 *  droppedModels` is the list's true size; this notice states the missing half rather than the sum,
 *  the shipped `partialListCopy` shape (BackgroundTaskPanel), which also dodges pluralisation — "1 not
 *  shown" and "3 not shown" both read correctly, so the repo gains no pluralisation machinery.
 *
 *  `droppedModels` is a number, so this renders no untrusted string. */
function partialModelListCopy(droppedModels: number): string {
  return `Partial list (${droppedModels} not shown)`
}

// #560 — client-owned copy for the running-model surface, the RUN_CONFIG_ERROR_COPY convention.
// Apostrophe-free (renderToStaticMarkup escapes ' → &#x27;).
//
// Neither literal may contain 'Current model': the sheet's selection marker is asserted by COUNT at six
// unit sites and page-wide in e2e, and this copy renders in EVERY existing RunConfigView test (the prop
// is optional and its absence is the not-yet-known state).
const RUN_CONFIG_RUNNING_UNKNOWN_COPY = 'Running model not yet known'

// Deliberately echoes BACKGROUND_TASK_PANEL_CUT_COPY / UNRECOGNIZED_TRUNCATED_COPY's vocabulary so the
// app says the same thing the same way about the same daemon behaviour. #975 reuses this one sentence
// for the published rows' own cut report rather than minting a second: the sentence is identical and
// only the ATTRIBUTION differs, which position and the distinct classes already carry.
const RUN_CONFIG_CUT_COPY = 'Truncated by the daemon'

// #976 — the Effort section's one client-owned sentence, the RUN_CONFIG_MODELS_EMPTY_COPY convention:
// a POSITIVE statement that the selected model exposes no effort control, not an absence of
// information. Client-owned and apostrophe-free — renderToStaticMarkup escapes ' → &#x27;. It contains
// no level name, so it cannot satisfy a segment assertion by accident.
//
// There is deliberately NO second constant for the nothing-matched reading: that one renders the
// session's effort VALUE and nothing else (see EffortSection).
const RUN_CONFIG_EFFORT_EMPTY_COPY = 'No effort levels offered'

// The field name `truncated_fields` uses to report this row's effort list as cut. A client-owned
// literal compared against daemon strings by `Array.prototype.includes` — a linear scan by `===`, NOT
// an index lookup, so no object is ever keyed by claude-authored text on this path.
const EFFORT_LEVELS_FIELD = 'effort_levels'

// AC4 error copy — field-scoped and client-owned. #269 strips the daemon message, so the surfaced copy
// is derived from the rejected FIELD, not daemon text. Apostrophe-free by design: renderToStaticMarkup
// escapes ' → &#x27; (the #188/#279 lesson), so keeping the strings clean keeps them readable. This map
// is the single source of the copy; each section reads its own key. The em-dash is not escaped.
// `permissionMode` (#1021) is required by the total Record and RENDERS NOWHERE in this sheet, which
// draws an error line only for its three sections. The footer owns the permission-mode menu.
const RUN_CONFIG_ERROR_COPY: Record<SettingsChange['field'], string> = {
  model: 'Could not change the model — try again.',
  effort: 'Could not change the effort — try again.',
  yolo: 'Could not change auto-accept — try again.',
  permissionMode: 'Could not change the permission mode — try again.'
}

// One field's rejection line — a role="alert" live region so a screen reader announces the failure on
// arrival, styled with the --color-error accent (the only error role token; no new theme token, per
// CLAUDE.md). Rollback itself is automatic in #256 (the pending marker is deleted, so the effective
// value stops showing the requested value); this line is only the visible surface (AC4).
function RunConfigError({ field }: { field: SettingsChange['field'] }): JSX.Element {
  return (
    <p className="run-config__error" role="alert">
      {RUN_CONFIG_ERROR_COPY[field]}
    </p>
  )
}

/**
 * The pure section view — renders all four sections (headers + bodies) from primitive props. No
 * store read, no window.pyry, so it server-renders under renderToStaticMarkup with no mock. The
 * Context window section is the last child so it sits between YOLO and the sibling Log-data section.
 *
 * `onChange` present ⇒ the Model/Effort/YOLO controls are operable and each submits a single-field
 * SettingsChange; absent ⇒ #188's read-only markup (the AC5 gate at the view layer). The three narrow
 * per-control callbacks are derived from the single `onChange` here, so the SettingsChange construction
 * lives in exactly one place. `errorField` is the last-rejected field (or null) — it flags at most one
 * section's error line (AC4).
 *
 * `pending` (#558) marks the controls of a change the daemon has not confirmed yet, so an optimistic
 * value stops rendering identically to a settled one. It is #256's selectPendingFields verbatim — typed
 * as that selector's return type so a parallel pending representation is a compile error, not a review
 * catch. NOT shaped like `errorField`: the store's `pending` is keyed by changeId so two fields can be
 * outstanding at once, and these three booleans are independent. Omitted ⇒ nothing is marked (AC5).
 *
 * `models` (#975, and #976's effort segments read the SAME prop rather than a second one) is the
 * conversation's published model list — #974's HELD ENTRY, passed straight down
 * and never a derived array, which is what keeps the store's by-reference guarantees intact at the
 * render boundary. Optional, and its absence IS the `null` reading ("no frame has arrived"), the
 * `announced` prop's shape: that is what keeps this view server-renderable with no store and no mock.
 */
export function RunConfigView({
  model,
  modelLayers,
  effort,
  yolo,
  usedTokens,
  windowTokens,
  onChange,
  errorField,
  pending,
  announced,
  models,
  agent = 'claude'
}: {
  model: string
  modelLayers?: ComposerModelLayers
  effort: string | null | undefined
  yolo: boolean
  usedTokens: number
  windowTokens: number
  onChange?: (change: SettingsChange) => void
  errorField?: SettingsChange['field'] | null
  pending?: ReturnType<typeof selectPendingFields>
  announced?: AnnouncedModel | null
  models?: ModelListEntry | null
  /** #1651 — the conversation's agent; absent reads Claude. */
  agent?: WireAgent
}): JSX.Element {
  const selectedModel = composerModelMenuModel(models, modelLayers ?? {
    picked: '', stored: model, announced: announced?.model ?? ''
  }, agent)?.currentId ?? null
  // #975/#976: the submitted string is a published row's `value` — or, for effort, a published level —
  // VERBATIM, never normalised on the way out, which is the half of the round-trip these lines own.
  const onModel = onChange ? (value: string): void => onChange({ field: 'model', value }) : undefined
  const onEffort = onChange ? (level: string): void => onChange({ field: 'effort', value: level }) : undefined
  const onYolo = onChange ? (next: boolean): void => onChange({ field: 'yolo', value: next }) : undefined
  // The marking is independent of operability: the view marks whatever it is told. In production the
  // combination cannot arise (the container withholds onChange until a session id exists, and without
  // one nothing can be dispatched, so `pending` is empty), so gating one on the other would be logic
  // for an unreachable state.
  return (
    <>
      {/* #560: what is running, then what you can switch to. Placed BEFORE the rows deliberately —
          reading order first, and it keeps the surface out of the last model row's open-ended
          segmentFor chunk in the tests. */}
      <RunningModelSection announced={announced} models={models} agent={agent} />
      <ModelSection
        model={selectedModel}
        models={models}
        agent={agent}
        onSelect={onModel}
        error={errorField === 'model'}
        busy={pending?.model}
      />
      <EffortSection
        effort={effort}
        model={model}
        models={models}
        agent={agent}
        onSelect={onEffort}
        error={errorField === 'effort'}
        busy={pending?.effort}
      />
      <YoloSection yolo={yolo} onToggle={onYolo} error={errorField === 'yolo'} busy={pending?.yolo} agent={agent} />
      <ContextWindowSection usedTokens={usedTokens} windowTokens={windowTokens} agent={agent} />
    </>
  )
}

// #560 — the running-model surface: what claude ANNOUNCED for the running turn (#587 decodes it off the
// `system` / `init` line, #588 holds it), as opposed to the daemon's persisted OVERRIDE the Model rows
// below configure. Its exact lookup remains independent of the inherited radio selection rule. Header + column body, cloning the Context window idiom (Figma 20:149 / 20:151); the
// design draws no running-model surface and no not-yet-known state.
//
// SECURITY — this is the render boundary for `announced.model`. It is untrusted, model-influenced text
// that crossed the subprocess trust boundary; the daemon bounds it at 256 bytes but sanitizes nothing
// (announcedModelStore.ts:46-51), and #588 had no DOM sink so it inherited the obligation. It reaches
// exactly ONE JSX text position, where React escapes it. It is never dangerouslySetInnerHTML, never an
// attribute value, never a URL, and it selects nothing beyond which catalog display name is shown —
// nothing this app sends is derived from it, and this surface dispatches nothing at all.
//
// Three branches, and two of them are easy to get wrong:
//
//  - The MARKER branches on `truncated` ALONE, never on which path the value took. The flag is the
//    daemon's report about the identifier it delivered; suppressing it on the resolve path would let a
//    daemon hide its own cut report by sending a value that happens to equal a catalog token. The
//    hit+truncated combination is only reachable from a non-conforming daemon, and renders both readings
//    honestly rather than silently dropping one.
//  - `{ model: '', truncated: false }` takes the VERBATIM path: a real announcement the daemon emitted
//    (announcedModelStore.ts:58-65), so the value element renders present and empty rather than
//    collapsing into the not-yet-known sentinel — collapsing would erase the store's deliberate
//    null-vs-'' distinction one layer above where it was established.
//
// The cut marker is a SIBLING ELEMENT holding a client-owned constant, never text concatenated into the
// value (the BackgroundTaskPanel.tsx:236-255 / ConversationScreen.tsx:485-500 idiom):
// `{announced.model}{truncated && ' (truncated)'}` would fuse client copy and daemon text into one node,
// so an identifier ending in those same words would be indistinguishable from the sheet's own claim.
// Nothing here slices, measures, re-joins or re-sinks the identifier to produce the marker.
function RunningModelSection({
  announced,
  models,
  agent
}: {
  announced?: AnnouncedModel | null
  models?: ModelListEntry | null
  agent: WireAgent
}): JSX.Element {
  const row = announced ? publishedRowFor(models, announced.model, agent) : undefined
  return (
    <>
      <p className="status-sheet__section-header">Running model</p>
      <div className="run-config__running">
        {announced ? (
          // #975: BOTH paths are now daemon-authored — the hit renders a published row's display name,
          // the miss the announced identifier verbatim. The provenance claim that used to stand here
          // (a client-owned name on one path) stopped being true when the rows stopped being the
          // client's. Both are still safe as escaped inert text in this one JSX text position, which is
          // the obligation that actually matters; what changed is only who wrote the string.
          <p className="run-config__running-value">{row ? row.display_name : announced.model}</p>
        ) : (
          <p className="run-config__running-unknown">{RUN_CONFIG_RUNNING_UNKNOWN_COPY}</p>
        )}
        {announced?.truncated ? <p className="run-config__running-cut">{RUN_CONFIG_CUT_COPY}</p> : null}
      </div>
    </>
  )
}

// #558 — the in-flight marker. aria-busy goes on the element that OWNS the field's controls (the group
// here, since the field has three of them), which is both the a11y marker and the CSS hook — the
// aria-current idiom below, and likewise OMITTED rather than rendered "false" so nothing-in-flight is
// byte-identical to #188's markup. Load-bearing: the RunConfigError <p> must stay a SIBLING of this
// wrapper, never a descendant — aria-busy on an ancestor tells assistive technology to withhold the
// subtree's announcements, which would silently suppress #269's role="alert" rejection line on the very
// field the operator was told is in flight.
//
// #975 — THE ROWS ARE THE DAEMON'S. The section renders one row per published entry, in the daemon's
// order, excluding the internal default row. Labels and descriptors remain published text;
// selection comes from the shared composerModelMenuModel decision.
//
// THREE READINGS, NEVER TWO. `null` (no frame has arrived, a normal and permanent state under
// best-effort delivery) and a present entry holding `models: []` (claude published an empty list) are
// different sentences in different elements. Collapsing them would erase the distinction one layer
// above where the store deliberately established it, and neither renders an empty control or a stale
// menu.
//
// SECURITY — this is the render boundary for `display_name`, `value` and `resolved_model`. They are
// claude-authored, unsanitized text that crossed the subprocess trust boundary (the daemon bounds and
// does not sanitize; #972 made the SHAPE trusted and nothing more). Each reaches exactly one JSX text
// position, where React escapes it. None reaches a raw-markup sink, an attribute, a URL, a filename, a
// cache key, a lookup path or a log — and nothing on this path is logged at all.
//
// THE KEY IS THE ARRAY INDEX, and that is a security decision rather than a style one: a key is a
// lookup path, and `display_name` / `value` are exactly the claude-authored strings the store's header
// forbids using as one. There is also nothing for a stable key to preserve — each frame REPLACES the
// conversation's list wholesale, rows never reorder within a render, and claude may legitimately
// publish two rows sharing a `value`.
function ModelSection({
  model,
  models,
  agent,
  onSelect,
  error,
  busy
}: {
  model: string | null
  models?: ModelListEntry | null
  agent: WireAgent
  onSelect?: (value: string) => void
  error?: boolean
  busy?: boolean
}): JSX.Element {
  const entry = models ?? null
  // #1651: only the conversation's own agent's rows. An agent offering none reads the empty sentence; the
  // frame-level partial notice above still reports the entry's own drops.
  const rows = modelRowsFor(entry, agent).filter(row => row.value !== 'default')
  return (
    <>
      <p className="status-sheet__section-header">Model</p>
      {/* The frame-level truncation report, and a SIBLING of the branch below rather than a child of
          any arm: the count belongs to the ENTRY, not to the list, so an entry reporting drops beside
          zero carried rows must still show it. It is a strictly different report from a row's own
          `truncated_fields` and neither may be collapsed into the other — a sheet surfacing one and
          silently dropping the other presents a cut list as complete.

          A boolean comparison, never `{entry.droppedModels && …}`: React renders the number `0` as a
          text node, so the truthiness form would print a bare `0` into the sheet on every complete
          list. `0` is a value here, never consulted for truthiness. `> 0` rather than `!== 0` so a
          nonsense negative count degrades to "no notice" rather than to a notice claiming -1. */}
      {entry !== null && entry.droppedModels > 0 && (
        <p className="run-config__model-partial">{partialModelListCopy(entry.droppedModels)}</p>
      )}
      <div className="run-config__model-list" aria-busy={busy ? 'true' : undefined}>
        {entry === null ? (
          <p className="run-config__model-unknown">{RUN_CONFIG_MODELS_UNKNOWN_COPY}</p>
        ) : rows.length === 0 ? (
          <p className="run-config__model-empty">{RUN_CONFIG_MODELS_EMPTY_COPY}</p>
        ) : (
          rows.map((row, index) => {
            // EXACT EQUALITY, and the whole of the selection rule: no substring, no prefix, no case
            // fold, no trim, anywhere on this path. It is also the half of the round-trip this line
            // owns — the row submits its `value` verbatim, the optimistic overlay holds that same
            // string, and this comparison re-selects the row it came from. The moment either side
            // normalises, the two stop being the same string.
            const isSelected = row.value === model
            // The daemon's report that it cut this row's own text. `null` and `[]` say the identical
            // thing per the wire contract, so the test is on length rather than on presence.
            const isCut = (row.truncated_fields?.length ?? 0) > 0
            // onSelect present ⇒ the row is an operable button submitting its published `value`.
            // Absent ⇒ #188's inert row (no role/tabindex/handler). Click is the baseline affordance;
            // keyboard activation (Enter/Space) is a deliberate non-goal here.
            return (
              <div
                className="run-config__model-row"
                key={index}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(row.value) : undefined}
              >
                {isSelected ? (
                  // The filled M3 radio. Its accessible name lets a screen reader announce which model
                  // is active; the empty siblings are decorative (aria-hidden).
                  <span
                    className="run-config__radio run-config__radio--selected"
                    role="img"
                    aria-label="Current model"
                  />
                ) : (
                  <span className="run-config__radio" aria-hidden="true" />
                )}
                <div className="run-config__model-text">
                  <p className="run-config__model-name">{row.display_name}</p>
                  {/* The concrete identifier this row's `value` resolves to right now, so the operator
                      can see what an alias means BEFORE the first turn rather than inferring it from an
                      announcement after it. Rendered unconditionally: an empty one is a present, empty
                      line, inventing no distinction the wire does not carry. It is not reliably
                      populated — a row may carry the literal `<unmeasured>`, which renders escaped and
                      verbatim, because it is what the daemon said. */}
                  <p className="run-config__model-descriptor">{row.resolved_model}</p>
                  {/* The cut marker is a SIBLING ELEMENT holding a client-owned constant, never text
                      concatenated into a daemon-authored node: `{row.display_name}{isCut && ' (cut)'}`
                      would fuse the two into one node, and a label ending in those same words would
                      then be indistinguishable from the sheet's own claim. */}
                  {isCut ? <p className="run-config__model-cut">{RUN_CONFIG_CUT_COPY}</p> : null}
                </div>
              </div>
            )
          })
        )}
      </div>
      {error ? <RunConfigError field="model" /> : null}
    </>
  )
}

// #976 — THE SEGMENTS ARE THE SELECTED MODEL'S, and the hardcoded five are gone. Reasoning-effort
// support is per model: measured live against claude 2.1.220 on 2026-08-21, Haiku publishes no levels
// at all while the other rows publish all five, so a fixed strip offered Haiku five choices it cannot
// use and asked the daemon for something it will not do.
//
// THE ROW IS THE SESSION'S MODEL, resolved by exact equality on `value` — the same string and the same
// rule the Model rows above mark a row selected by. Not `announced.model`, which is a different
// identifier for a different question, and not a family derived from `value`, which is not parseable.
//
// #1168 MOVED THIS ONE CALL FROM publishedRowFor TO effortRowFor, which is the whole of that slice here.
// An empty model is the wire's inherited daemon default, not an absence, and it now resolves the row the
// daemon publishes for that default rather than missing every row. Everything below is unchanged and
// applies its shipped readings to whatever that row carries: the four inputs still map to the same three
// renderings, the cut report is still read per field, and no arm, element or sentence was added. The
// Model rows above and the running-model line still call publishedRowFor directly and are unmoved.
//
// FOUR INPUTS, THREE RENDERINGS:
//
//   no matching row (no frame yet, or the model matches nothing published)  → the current effort as text
//   a row publishing levels                                                 → one segment per level
//   a row publishing [] with no cut reported                                → the offers-none sentence
//   a row publishing [] BESIDE A REPORTED CUT                               → the current effort as text
//
// The first collapse is deliberate and it is the OPPOSITE POSTURE to the Model section directly above,
// whose header states THREE READINGS, NEVER TWO. That section keeps "no frame has arrived" and "claude
// published an empty list" in different elements because it is arguing about a different field. Here
// both mean the identical thing to the client — it has been told no level is accepted — so it offers
// none and states the value the session is actually running. Do not carry the neighbour's rule across
// by resemblance.
//
// THE FOURTH INPUT ROW IS A WRITTEN CONTRACT MUST, NOT AN INVENTED DISTINCTION. `effort_levels`
// collapses absent, null and empty into one `[]`, so a `truncated_fields` naming it is the ONLY signal
// separating "cut to nothing, or shortened" from "this model exposes no effort control", and it must
// be read as UNKNOWN, never as *none* — read as *none*, a cut list silently removes a control the
// model actually supports (WireModelOption's docblock; modelListStore's header names this section as
// the reader that owes it).
//
// AND NEVER A FALLBACK. An absent, null or unmatched list must not mean "offer all five": that would
// re-mint the vocabulary this slice deletes, in the one place it is being deleted from, and it would
// pass every test the old five-value constant passed.
//
// SECURITY — this is the render boundary for every string in `effort_levels`. They are claude-authored,
// unsanitized text that crossed the subprocess trust boundary (the daemon bounds and does not sanitize;
// #972 made the SHAPE trusted and nothing more). Each reaches exactly one JSX text position, where
// React escapes it. None reaches a raw-markup sink, an attribute, a URL, a filename, a cache key, a
// lookup path or a log — and nothing on this path is logged at all. THE KEY IS THE ARRAY INDEX, the
// Model section's decision unchanged and a security one rather than a style one: a key is a lookup
// path, each frame REPLACES the list wholesale, and claude may legitimately publish a repeated level.
//
// The submitted level is the published string VERBATIM and is never repaired. That is a real change in
// what this client sends — `set_session_settings.effort` used to carry a client-owned constant — and it
// is the Model section's shipped posture applied to a second field. No client-side allowlist is added:
// it would be a second copy of the vocabulary in the very place this ticket removes one. Upstream's
// inbound `validEffort` is a CLOSED enum at the five measured levels while `validModel` was widened for
// these rows, so a level claude adds later, or one cut mid-token, is published here and REFUSED on the
// way back. That asymmetry is upstream's; the refusal surfaces through the shipped RunConfigError line
// and #256's automatic rollback, which is the honest outcome and needs no defence here.
function EffortSection({
  effort,
  model,
  models,
  agent,
  onSelect,
  error,
  busy
}: {
  effort: string | null | undefined
  model: string
  models?: ModelListEntry | null
  agent: WireAgent
  onSelect?: (level: string) => void
  error?: boolean
  busy?: boolean
}): JSX.Element {
  const row = effortRowFor(models, model, agent)
  const levels = row?.effort_levels ?? []
  // `null` and `[]` say the identical thing per the wire contract, so the test is membership rather
  // than presence. Read PER FIELD: a report naming only `display_name` says nothing about this list.
  const isCut = row?.truncated_fields?.includes(EFFORT_LEVELS_FIELD) ?? false
  // The one place the collapse above is written down. A cut empty list is UNKNOWN, so it lands here
  // beside the unmatched row rather than in the offers-none arm.
  const nothingKnown = row === undefined || (levels.length === 0 && isCut)
  return (
    <>
      <p className="status-sheet__section-header">Effort</p>
      {/* #558: the group, not a segment — the field's controls are one field. #976 keeps the wrapper
          and its marker in ALL THREE readings: an effort change can still be in flight when the
          section has nothing to offer (the operator picks a level, then a model_list frame or a model
          change empties the levels), so a pending effort must stay marked whatever is inside. The
          RunConfigError <p> remains a SIBLING of this wrapper for the reason stated above it. */}
      <div className="run-config__effort" aria-busy={busy ? 'true' : undefined}>
        {nothingKnown ? (
          // The session's effort VALUE, alone in its own node with no client-owned prefix beside it —
          // concatenating the two provenances into one node is what the cut-marker rationale forbids,
          // and claude's own control displays these values lowercase and byte-identical, so there is
          // no display convention to reproduce. An empty effort renders a present, empty line,
          // inventing no distinction the snapshot does not carry.
          <p className="run-config__effort-current">{effort}</p>
        ) : levels.length === 0 ? (
          <p className="run-config__effort-empty">{RUN_CONFIG_EFFORT_EMPTY_COPY}</p>
        ) : (
          levels.map((level, index) => {
            // EXACT EQUALITY, and the whole of the selection rule: no substring, no prefix, no case
            // fold, no trim. `high` is a substring of `xhigh` and a row publishes both, so a matcher
            // that widened here would mark two segments. It is also the half of the round-trip this
            // line owns — the segment submits its level verbatim, the optimistic overlay holds that
            // same string, and this comparison re-selects the segment it came from.
            const isSelected = level === effort
            // aria-current is both the a11y marker and the CSS selection hook (no modifier class); the
            // fill/outline styles key off `[aria-current='true']`. onSelect present ⇒ the segment is an
            // operable button submitting its exact level; absent ⇒ #188's inert segment.
            return (
              <span
                className="run-config__effort-segment"
                key={index}
                aria-current={isSelected ? 'true' : undefined}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(level) : undefined}
              >
                {level}
              </span>
            )
          })
        )}
        {/* The daemon's report that it cut THIS row's level list, in every reading: a shortened list
            must not be presented as complete, and an empty-because-cut one says why it is offering
            nothing. A SIBLING element holding a client-owned constant, never text concatenated into a
            daemon-authored node — `{level}{isCut && ' (cut)'}` would fuse the two, and a level ending
            in those same words would be indistinguishable from the sheet's own claim. */}
        {isCut ? <p className="run-config__effort-cut">{RUN_CONFIG_CUT_COPY}</p> : null}
      </div>
      {error ? <RunConfigError field="effort" /> : null}
    </>
  )
}

function YoloSection({
  yolo,
  onToggle,
  error,
  busy,
  agent
}: {
  yolo: boolean
  onToggle?: (next: boolean) => void
  error?: boolean
  busy?: boolean
  agent: WireAgent
}): JSX.Element {
  // #1656: the caption names the conversation's agent, a client-owned name the agent selects.
  const agentName = agent === 'codex' ? 'Codex' : 'Claude'
  return (
    <>
      <p className="status-sheet__section-header">YOLO mode</p>
      <div className="run-config__yolo">
        <div className="run-config__yolo-text">
          <p className="run-config__yolo-title">Auto-accept tool calls</p>
          <p className="run-config__yolo-caption">
            {`${agentName} runs commands without asking for confirmation. Use carefully.`}
          </p>
        </div>
        {/* role="switch" + aria-checked reflects state honestly. onToggle present ⇒ #257 makes it live:
            drop aria-readonly, become focusable, and toggle the current value on click (AC3). Absent ⇒
            #188's read-only switch (aria-readonly, no handler). #558's aria-busy goes on the switch
            ITSELF — unlike Model/Effort the field has exactly one control and it IS the switch, while
            .run-config__yolo also wraps the title/caption. It marks without disabling: LogDataSection
            pairs aria-busy with `disabled`, but taking that half would contradict the store's deliberate
            last-write-wins for rapid same-field changes. It contributes nothing to the accessible name,
            so the aria-label/aria-checked/aria-readonly the e2e specs assert on are untouched. */}
        <span
          className={yolo ? 'run-config__switch run-config__switch--on' : 'run-config__switch'}
          role="switch"
          aria-checked={yolo}
          aria-readonly={onToggle ? undefined : 'true'}
          aria-label="Auto-accept tool calls"
          aria-busy={busy ? 'true' : undefined}
          tabIndex={onToggle ? 0 : undefined}
          onClick={onToggle ? () => onToggle(!yolo) : undefined}
        >
          <span className="run-config__switch-knob" aria-hidden="true" />
        </span>
      </div>
      {error ? <RunConfigError field="yolo" /> : null}
    </>
  )
}

// The token-abbreviation helper (Figma "146K" / "200K"): 1000+ collapses to a K-suffixed thousands
// count; under 1000 stays a raw count (an early-session "500"). Unexported — covered through the
// section's render assertions, so the public surface stays unchanged.
function abbreviateTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

// Context window (Figma 20:149 header + 20:151 body): the session's context-window usage gauge. The
// header and the explainer always render; the usage line + fill bar render only when a real window
// size is known.
//
// #811 EXTRACTED the guard and the arithmetic into contextUsagePercent — the composer footer's reading
// is a second surface for the same number, and a second clamp beside this one is a drift waiting to
// happen. `pct !== null` is the single load-bearing branch, exactly as `windowTokens > 0` was: it
// collapses the daemon's "usage unavailable" signal (window_tokens === 0, a foreground session or no
// transcript yet), the not-yet-loaded default (the container coalesces null → windowTokens: 0) and a
// stray negative into one path, and the division only runs inside it — so there is no NaN, no Infinity,
// no divide-by-zero (AC5). #811 also added a finiteness term, which closes this gauge's `width: NaN%`
// on a daemon frame carrying an overflowing token count. The percentage is still clamped to [0, 100] so
// an over-full session reads "100% used" and the fill never overflows its track. See contextUsage.ts.
function ContextWindowSection({
  usedTokens,
  windowTokens,
  agent
}: {
  usedTokens: number
  windowTokens: number
  agent: WireAgent
}): JSX.Element {
  const pct = contextUsagePercent(usedTokens, windowTokens)
  // #1656: the explainer writes the agent's name in lowercase, as the Claude copy always has.
  const agentName = agent === 'codex' ? 'codex' : 'claude'
  return (
    <>
      <p className="status-sheet__section-header">Context window</p>
      <div className="run-config__context">
        {pct !== null ? (
          <>
            <p className="run-config__context-usage">
              {`${pct}% used (${abbreviateTokens(usedTokens)} of ${abbreviateTokens(windowTokens)} tokens)`}
            </p>
            {/* role="progressbar" + the aria-value* triple names the gauge honestly for a screen
                reader; the inline width is the only per-render style (Figma 20:153/20:154). */}
            <div
              className="run-config__context-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Context window usage"
            >
              <div className="run-config__context-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="run-config__context-unavailable">Context usage unavailable</p>
        )}
        <p className="run-config__context-explainer">
          {`When full, oldest messages get dropped from ${agentName}'s view (delimiter still shows; old ` +
            'messages stay in your scroll).'}
        </p>
      </div>
    </>
  )
}

/**
 * The container: reads three read-only slices — the session id (#259), the daemon snapshot (#187), and
 * the write state (#256) — and wires the controls at interaction time. The displayed Model/Effort/YOLO
 * uses shared model-selection and displayed-effort decisions; effective settings still determine
 * effort offerings and YOLO. usedTokens/windowTokens still come straight from the snapshot (coalesced null → 0)
 * exactly as #188. Unidirectional: it dispatches only via submitSettingsChange and sends one command per
 * interaction; no setter is ever called during render.
 *
 * The AC5 gate is structural: `onChange` is built ONLY when a session id is known, so under SSR (session
 * id null) the controls render inert and the window.pyry.sendCommand closure is never constructed — the
 * container server-renders with no bridge mock (the LogDataSection / composer discipline).
 *
 * #975 adds `conversationId` as a PROP rather than a fifth store read, the settled house idiom
 * (`ComposerSlot`, `BackgroundTaskPanel`, both fed from `activeConversation` one scope up). It is NOT
 * the session id already in scope: those are different identifiers, a session id keys nothing in the
 * model-list map, and reaching for it would compile clean, typecheck clean and render the
 * not-yet-known line forever.
 */
export function RunConfigSections({ conversationId }: { conversationId: string | null }): JSX.Element {
  const connected = useSessionSettingsConnected(conversationId)
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // Select the RAW write state (stable identity between dispatches). Not selectEffectiveSettings as the
  // zustand selector: it returns a fresh object every call, which would defeat Object.is and re-render on
  // every store tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)
  // #560: a fourth narrow-slice read, passed straight down — no derivation here, no setter. A repeat
  // announcement produces a fresh record identity and so re-renders this section with identical output;
  // that is anticipated by the store and needs no memoisation.
  //
  // #1146 made it per-conversation, so this is a useMemo-stable selector per id exactly like the model
  // list below it — a fresh closure each render would churn the subscription, and a null conversation
  // selects nothing THROUGH THE SAME PATH, with no invented key and no second branch downstream. A
  // conversation that has announced nothing reads `null` here even while another chat's announcement is
  // held, which is the whole of this ticket: the sheet says nothing rather than the other server's model.
  const selectAnnounced = useMemo(
    () => (conversationId === null ? () => null : selectAnnouncedModelFor(conversationId)),
    [conversationId]
  )
  const announced = useAnnouncedModelStore(selectAnnounced)
  // #975: a useMemo-stable selector per id (the ComposerSlashCommandTypeAhead / BackgroundTaskPanel
  // idiom) — a fresh closure each render would churn the subscription. A null conversation selects
  // nothing THROUGH THE SAME PATH, with no invented key and no second branch downstream, and `null` is
  // a stable reference. The selector hands back the HELD ENTRY ITSELF, so a list published for another
  // conversation leaves this one Object.is-identical and does not re-render the sheet.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)
  // #1421: a THIRD instance of the same useMemo-stable per-id selector idiom, for claude's own context
  // reading — the display source since #1421, with the snapshot's transcript-derived pair as the fallback.
  // A fresh closure each render would churn the subscription; a null conversation selects nothing through
  // the same path, with no invented key and no second branch downstream.
  const selectReported = useMemo(
    () => (conversationId === null ? () => null : selectReportedContextFor(conversationId)),
    [conversationId]
  )
  const reported = useReportedContextStore(selectReported)
  const agent = useConversationAgent(conversationId)

  const effective = selectEffectiveSettings(snapshot, writeState)
  // #558: derived from the SAME writeState reference in the SAME render pass as `effective` — that is
  // what makes the displayed value and its marking incapable of disagreeing. A second
  // useRunSettingsWriteStore subscription for pending could tear them apart, showing an optimistic
  // value with no marker, which is exactly the state this ticket exists to prevent.
  const pending = selectPendingFields(writeState)
  const errorField = selectError(writeState)
  // #1421: WHICH pair the gauge draws, decided by the same function the composer footer's reading calls —
  // so the two surfaces cannot disagree for one conversation. Resolved HERE and handed down as the two
  // primitive props the view already takes, which is what keeps RunConfigView props-in/markup-out and
  // ContextWindowSection untouched (the announced/models discipline one scope up).
  //
  // It also settles the gauge's INTERNAL consistency for free: the section derives its percentage from the
  // same two integers it abbreviates into `(X of Y tokens)`, so one winning pair makes the drawn triple
  // consistent by construction rather than by three edits that agree (Figma 20:152).
  //
  // The fallback fires on an ABSENT reading only. A present reading whose maximum is zero still wins and
  // lands in ContextWindowSection's shipped unavailable branch via contextUsagePercent's window guard —
  // never back on the transcript figure. The `?? 0` coalescing the container used to spell here now lives
  // inside contextTokenSource, written once for both surfaces.
  const contextTokens = contextTokenSource(reported, snapshot)

  const onChange =
    // Both null and '' withhold the handler: null is "never observed", '' is the daemon saying it
    // has no session to address. See isAddressableSessionId (#491).
    connected && isAddressableSessionId(sessionId)
      ? (change: SettingsChange): void => changeConnectedSetting(conversationId, change)
      : undefined

  return (
    <RunConfigView
      model={effective.model}
      modelLayers={{
        picked: selectEffectiveSettings(null, writeState).model,
        stored: snapshot?.model ?? null,
        announced: announced?.model ?? ''
      }}
      effort={selectDisplayedEffort(snapshot, writeState)}
      yolo={effective.yolo}
      usedTokens={contextTokens.usedTokens}
      windowTokens={contextTokens.windowTokens}
      onChange={onChange}
      errorField={errorField}
      pending={pending}
      announced={announced}
      models={models}
      agent={agent}
    />
  )
}
