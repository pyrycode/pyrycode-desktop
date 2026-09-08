import { useMemo } from 'react'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { useModelListStore, selectModelListFor, type ModelListEntry } from '../../store/modelListStore'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { useRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { useAnnouncedModelStore, selectAnnouncedModel } from '../../store/announcedModelStore'
import { publishedRowFor } from './RunConfigSections'
import { changeSetting } from './runSettingsControls'

// #988: the composer footer's MODEL menu (Figma 115:3683) — the SECOND live host of the shared options
// panel, and the first that offers a CHOICE rather than a list of actions. It owns exactly three things:
// its entries, what picking one does, and the trigger's label and appearance. Everything else — the
// <button>, aria-haspopup, aria-expanded, the toggle, roving focus, Escape, outside-click and focus
// return — is ComposerOptionsMenu's. It adds NO prop to that component, per the boundary
// ComposerActionsMenu.tsx:8-9 states: four consumers share it.
//
// It assembles rather than invents. The panel is #838/#839/#840's, the rows are #974's, the write is
// #256's and the match rule is #560/#975/#976's — this file is the wiring plus the three renderings.
//
// Its own file rather than ConversationScreen.tsx (~2700 lines and a declared merge hot-spot), the
// ComposerActionsMenu.tsx precedent verbatim, and it adds no CSS import: its styles live in
// conversation.css, whose single importer is ConversationScreen.tsx.

// The PANEL's accessible name, and a client-owned constant — NOT the trigger's visible text, which is
// where this menu departs from COMPOSER_ACTIONS_LABEL. This trigger reads claude-authored text, and
// aria-label is an ATTRIBUTE: a sink CLAUDE.md's daemon-text ruling forbids outright. The container puts
// no aria-label on the TRIGGER either (ComposerOptionsPanel.tsx:146-148), so the button's accessible name
// stays its visible text and WCAG 2.5.3's label-in-name is unaffected — the name injected here reaches
// only the role="menu" panel, which has no visible label of its own.
//
// It is not a model name, a family token or a descriptor (AC2): it is the control's own name, the word
// the run-configuration sheet's section header already uses.
export const COMPOSER_MODEL_MENU_LABEL = 'Model'

// Figma 115:3683's `chevron-up-solid-full`, the same 8x4 instance ComposerActionsMenu draws at 115:3677.
// Module-private and NOT exported, and duplicated rather than lifted into a shared glyph module: this
// repo has no icon module at all and inlines every glyph at its use site — CHEVRON_PATH
// (ComposerActionsMenu.tsx:53) and TOOL_ROW_CHEVRON_PATH (ConversationScreen.tsx:1019) are two
// module-private consts of this same family, each stating why it stayed private. The CSS extraction below
// is this ticket's because a standing comment assigns it; the glyph carries no such note.
//
// It points UP and does not flip on open, for ComposerActionsMenu.tsx:47-52's reason: reading the panel's
// `open` flag would mean a new prop on the surface four tickets share. The export's fill is dropped for
// currentColor so the glyph inherits the button's --color-primary.
const CHEVRON_PATH =
  'M3.59822 0.146303C3.82044 -0.0482491 4.18133 -0.0482491 4.40356 0.146303L7.81689 3.13463C8.03911 3.32918 8.03911 3.64514 7.81689 3.83969C7.59467 4.03424 7.23378 4.03424 7.01156 3.83969L4 1.20311L0.988445 3.83813C0.766222 4.03268 0.405333 4.03268 0.183111 3.83813C-0.0391111 3.64358 -0.0391111 3.32763 0.183111 3.13307L3.59644 0.144747L3.59822 0.146303Z'

/** #1053 — the three layers this control lays over one another, resolved in this order: a
 *  pending-or-confirmed PICK, then what claude ANNOUNCED for the running turn, then the snapshot's
 *  STORED choice, then nothing. The ticket settled that ordering and it is not re-litigated here: the
 *  announcement carries no ordering information relative to a pick (announcedModelStore holds one record
 *  with no sequence and no timestamp), so ranking it above a CONFIRMED pick would let a stale
 *  announcement beat the pick at the moment the daemon confirms — making a confirm and a rejection look
 *  identical.
 *
 *  '' MEANS "NOTHING AT THIS LAYER", uniformly across all three. That is this control's existing posture
 *  rather than a new decision: it already drew nothing for an unset session model. It is also what lets
 *  the container collapse `AnnouncedModel | null` to a string — AC4 names "no announcement" and "an
 *  announcement whose model is the empty string" in one clause, because no rendering here could tell
 *  them apart. The store's null-vs-'' distinction stays intact where it was established and where the
 *  run-configuration sheet reads it. */
export interface ComposerModelLayers {
  /** The pick made in this client: the pending optimistic value over the client-confirmed one. */
  picked: string
  /** claude's own identifier for the running turn, held verbatim. */
  announced: string
  /** The snapshot's stored explicit choice — '' on a session running the daemon's inherited default. */
  stored: string
}

/** The first layer with something to show, or '' when none has anything. */
function firstShown(...values: readonly string[]): string {
  return values.find((value) => value !== '') ?? ''
}

/** #1095 — the vendor prefix the family rule strips, and the ONE client-owned literal on this path.
 *
 *  It is a PREFIX STRIP, not a vocabulary, which is what keeps #988's AC2 ("no client copy naming a model
 *  concept") intact: there is no allow-list of family names here and there must not be one, so a family
 *  this client has never heard of derives through the same rule as a known one. Exact case, because no
 *  case fold exists anywhere on this path. */
const CLAUDE_IDENTIFIER_PREFIX = 'claude-'

/**
 * #1095 — the FAMILY of a model identifier, or '' when it names none.
 *
 * Juhana ruled on 2026-09-05 that the input footer shows the family and nothing else: no version, no date,
 * no context size. The version and the context window are always the newest, so on this surface they carry
 * no information — and the common case before this was a raw dated identifier, because claude announces an
 * identifier at least as specific as the one it was given. The FULL identifier stays in the
 * run-configuration sheet's Running model section, which this rule does not reach.
 *
 * THE WHOLE RULE: strip ONE leading `claude-` if present, take the leading run of ASCII letters,
 * upper-case its first letter and hold the rest as claude sent them. Exactly one `claude-` comes off — a
 * second is ordinary text and becomes the family, the rule answering honestly rather than looping.
 *
 * '' MEANS "NO FAMILY HERE", the same "nothing at this layer" firstShown already consumes, which is why
 * the source chain below composes with that helper instead of introducing a second nullability idiom. Its
 * callers turn '' into today's label, so an identifier this rule cannot read renders exactly as it renders
 * now.
 *
 * IT IS A VIEW-SIDE TRANSFORM ON A HELD-VERBATIM VALUE — the same tier as .composer__model-label's CSS
 * ellipsis one element up. It does not sanitize and does not claim to: the store still holds every string
 * verbatim, and the escaping is still React's at the one text position each label reaches. NOTHING FEEDS A
 * DERIVED LABEL BACK INTO A LOOKUP: publishedRowFor is still called with the raw string, `currentId` is
 * still a raw published `value`, and `onSelect` still dispatches a value a row carries. The only branch on
 * a derived label is `=== ''`, on this client's own answer.
 *
 * The regex is anchored, one character class, one greedy quantifier, no alternation and no nesting — so it
 * is linear on untrusted text with no backtracking, and the input is already bounded upstream. toUpperCase
 * rather than toLocaleUpperCase, on a character this same expression just proved to be [A-Za-z]: the fold
 * is locale-invariant by construction, so the Turkish-ı hazard cannot arise. It is display-only, and it
 * reaches no comparison — the MATCHING is still publishedRowFor's single `===` on raw strings, where "no
 * case fold, trim or split on this path" continues to hold in full.
 *
 * Unicode heads are deliberately out: a non-ASCII head yields '' and takes the verbatim fallback, which is
 * today's behaviour rather than a new refusal.
 */
function modelFamily(identifier: string): string {
  const bare = identifier.startsWith(CLAUDE_IDENTIFIER_PREFIX)
    ? identifier.slice(CLAUDE_IDENTIFIER_PREFIX.length)
    : identifier
  const head = /^[A-Za-z]+/.exec(bare)?.[0] ?? ''
  // charAt rather than [0] so the empty case needs no non-null assertion — '' returns '' from both halves.
  return head.charAt(0).toUpperCase() + head.slice(1)
}

/** What the trigger shows and what the menu offers.
 *
 *  `options` EMPTY is AC4's inert arm and is a different thing from a menu with rows: it never reaches
 *  ComposerOptionsMenu, which renders aria-haspopup and aria-expanded unconditionally and would open
 *  exactly the empty panel AC4 forbids. `currentId` is the value AC1 matched, or `null` when nothing
 *  matched — the panel marks nothing through the same branch, no special case. */
export interface ComposerModelMenuModel {
  label: string
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
}

/**
 * The whole decision, as a pure function of the two inputs — so every rule below is unit-testable as
 * data rather than only through markup (the COMPOSER_ACTIONS property, adapted to entries that are the
 * daemon's rather than the client's).
 *
 * THREE RENDERINGS:
 *
 *   no layer has anything               → null      nothing is known about the model; draw nothing
 *   something to show, no usable rows   → no options   AC4's inert label
 *   something to show and rows          → the menu
 *
 * The first is not in #988's ACs and was a decision that slice took; #1053's AC4 is now its criterion,
 * widened from "the session's model is unset" to "no layer has anything". It stays reachable in the app's
 * ordinary startup window — the run-config snapshot arrives on a turn end, and until then
 * selectEffectiveSettings resolves `model` to '' — but a session on the daemon's INHERITED DEFAULT sits
 * there permanently, which is what #1053 exists to answer. Every other rendering would draw an empty gap
 * where a label belongs. ContextUsageControl takes exactly this posture for its own unavailable reading,
 * and #811's no-placeholder rule points the same way. It invents no name for '' — the daemon's
 * held-verbatim "inherited default" — it just says nothing about it.
 *
 * TWO STRINGS COME OUT OF THE LAYERS AND THEY ARE NOT THE SAME STRING. The LABEL is the first layer with
 * something to show; the MARKING is the SESSION's model, which is the pick over the stored choice and
 * NEVER the announcement (#1053 AC5) — the daemon is set to what the session says, not to what claude
 * reported running. They collapse to one answer whenever a pick is in force and differ exactly in the
 * state this ticket exists for, so they are two lookups rather than one.
 *
 * BOTH resolve by exact equality on `value` through publishedRowFor — the one home of the rule, which
 * #988 exported and which RunningModelSection joins the announced identifier by. A MISS IS ORDINARY, not
 * an error, and it is the COMMON case for an announcement, which claude reports at least as specific as
 * what it was given. NO SUBSTRING, PREFIX, CASE FOLD OR TRIM IS APPLIED ANYWHERE ON THIS PATH, here or in
 * publishedRowFor — #1095's derivation is downstream of every lookup and feeds none of them.
 *
 * SINCE #1095 NEITHER LABEL IS THE PUBLISHED PROSE. The trigger and each row show a FAMILY (modelFamily
 * above): the trigger walks the matched row's `resolved_model` then its `value`, or the shown string on a
 * miss; a row reads its own `value` and never its `resolved_model`. Both fall back to what they rendered
 * before — `row ? row.display_name : shown` for the trigger, `display_name` for a row — when no family
 * derives. That fallback keeps #988's own decision intact: `row ? row.display_name : shown` rather than
 * `row?.display_name ?? shown`, so a matched row publishing an EMPTY display name stays a hit, where the
 * `??` form would print the value instead and quietly re-decide what a match means.
 *
 * The entries are EXACTLY the published rows, in the daemon's order — nothing deduped, dropped,
 * reordered or synthesised, and the derivation did not change that: two rows deriving to ONE family are
 * both shown, each still submitting its own `value`. `id` is the row's `value`, so onSelect(id) submits it
 * with no lookup; ComposerOptionsPanelOption splits id from label for precisely this menu. Two rows
 * sharing a `value` are both carried and both wear aria-current: bounded (both submit the same value, so
 * the pick is still right) and accepted, because AC2's "exactly the published rows" outranks the tidier
 * list.
 */
export function composerModelMenuModel(
  models: ModelListEntry | null | undefined,
  layers: ComposerModelLayers
): ComposerModelMenuModel | null {
  const shown = firstShown(layers.picked, layers.announced, layers.stored)
  if (shown === '') return null
  const row = publishedRowFor(models, shown)
  // The SESSION's model, which is the only thing a row may be marked current by. Exact equality stays the
  // whole rule here too: a daemon that published a row whose `value` is '' would have that row marked on
  // an inherited-default session, which is the lookup answering honestly rather than a case to guard.
  const sessionRow = publishedRowFor(models, firstShown(layers.picked, layers.stored))
  // #1095's SOURCE CHAIN for the trigger: on a hit the row's `resolved_model`, then that same row's
  // `value`; on a miss the shown string itself. `resolved_model` leads because the trigger's job is to
  // name what RUNS, and it is the one field naming the concrete identifier behind an alias. The `value`
  // step is an ORDINARY SECOND SOURCE rather than a guard against an unseen case: `resolved_model` is not
  // reliably populated, and the captured fixture WireModelOption's docblock cites carries the literal
  // `<unmeasured>` on four of its five rows.
  const family = row
    ? firstShown(modelFamily(row.resolved_model), modelFamily(row.value))
    : modelFamily(shown)
  // Today's label, kept as the fallback under the derivation rather than rewritten — so an identifier no
  // family derives from renders exactly as it renders now. `row ? row.display_name : shown` rather than
  // `row?.display_name ?? shown` for the reason above: a matched row publishing an EMPTY display name
  // stays a hit.
  const verbatim = row ? row.display_name : shown
  return {
    label: family === '' ? verbatim : family,
    currentId: sessionRow ? sessionRow.value : null,
    // A ROW READS ITS OWN `value`, NEVER ITS `resolved_model` (AC3), and that asymmetry with the trigger
    // is the point rather than an oversight. `value` is claude's argument vocabulary — `default` names no
    // family — and a row's job is to name a CHOICE. `default` IS its own choice: derived from
    // `resolved_model` it would wear the label of the row it resolves to, and the panel would show two
    // identical rows submitting different values. From `value` it reads the daemon's own word capitalised.
    // Two rows deriving to one label are both shown and each still submits its own `value`; `id` is
    // untouched, so nothing about the write changes.
    options: (models?.models ?? []).map((published) => {
      const rowFamily = modelFamily(published.value)
      return { id: published.value, label: rowFamily === '' ? published.display_name : rowFamily }
    })
  }
}

/**
 * The pure view: props in, markup out — no store read, no window.pyry and no state of its own, so both
 * arms server-render directly under the repo's `node` vitest environment. Every prop is REQUIRED, the "a
 * view that cannot answer is a bug" rule (ConversationScreen.tsx:2033).
 *
 * SECURITY — this is a render boundary for claude-authored text. `display_name`, `value` and, since
 * #1053, the ANNOUNCED identifier crossed the subprocess trust boundary and DECODED IS NOT SANITIZED
 * (modelListStore's and announcedModelStore's headers): #972 made the SHAPE trusted and nothing more, and
 * the daemon bounds (256 bytes for the announcement) without sanitizing. The announcement is a REPORT,
 * NEVER A CONTROL INPUT: the only thing this file branches on is whether it is '', its only other use is
 * as a lookup ARGUMENT to publishedRowFor (a `find` with `===` over an array, never a plain-object
 * index), and `onSelect` still dispatches only a value a published ROW carries — a hostile daemon cannot
 * make this control send a string it did not itself publish. Each reaches exactly one JSX TEXT
 * position, where React escapes it — never dangerouslySetInnerHTML, never an attribute, a URL, a
 * filename, a cache key, a lookup path or a log.
 *
 * SINCE #1095 those two text positions usually carry a DERIVED FAMILY instead (modelFamily above). That is
 * strictly less exposure, not more: a family is a `[A-Za-z]+` prefix with one character upper-cased, so a
 * control byte or a terminal escape can now reach the DOM only through the unchanged verbatim fallback —
 * the same path that carries it today. The positions themselves are the same two, and the derivation adds
 * no sink. `value` reaches four non-sink places, all the panel's:
 * `key={option.id}` (React's own keyed reconciliation, a Map internally), a string comparison against
 * currentId, the onSelect pass-through, and an array index. No plain object is keyed by any of it, and
 * nothing on this path is logged at all.
 *
 * The label is LENGTH-BOUNDED at this boundary rather than trusted to the daemon's own bound: it sits in
 * its own element so .composer__model-label can cap it and ellipsize. .composer__actions' `white-space:
 * nowrap` justification does NOT transfer — that one rests on the label being a client-owned constant,
 * and an unbounded name here would push the context reading out of a row with a hard 20px height.
 */
export function ComposerModelMenuView({
  layers,
  models,
  onSelect
}: {
  layers: ComposerModelLayers
  models: ModelListEntry | null
  onSelect: (value: string) => void
}): JSX.Element | null {
  const menu = composerModelMenuModel(models, layers)
  if (menu === null) return null

  // AC4. Not `options={[]}` through the shared menu, which would advertise a popup and open an empty
  // panel: an inert element with no role, no tabindex and no handler — the sheet's own operable-vs-inert
  // idiom (RunConfigSections.tsx:354-365) one layer down. The chevron goes with the interactivity it
  // claims: an up chevron is the design's "this opens a panel" mark, and drawing it here would be the
  // visual half of exactly the claim this arm refuses.
  if (menu.options.length === 0) {
    return (
      <span className="composer__footer-button">
        <span className="composer__model-label">{menu.label}</span>
      </span>
    )
  }

  return (
    <ComposerOptionsMenu
      options={menu.options}
      // AC2's marking, and the first consumer to pass a non-null one — ComposerActionsMenu passes null
      // because a list of actions is not a choice. This is a choice, and the panel already renders
      // aria-current="true" on the matching row and omits the attribute entirely otherwise, so the
      // marking needs no new prop: it is the value AC1 matched on.
      currentId={menu.currentId}
      onSelect={onSelect}
      ariaLabel={COMPOSER_MODEL_MENU_LABEL}
      triggerContent={
        <>
          <span className="composer__model-label">{menu.label}</span>
          {/* aria-hidden is load-bearing: the trigger carries no aria-label, so its accessible name is
              computed from its contents — and unlike the Actions trigger there is no client-owned
              constant to fall back on, so the e2e locator matches this label exactly. */}
          <svg
            className="composer__model-icon"
            viewBox="0 0 8 4"
            width="8"
            height="4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={CHEVRON_PATH} />
          </svg>
        </>
      }
      triggerClassName="composer__footer-button composer__model"
    />
  )
}

/**
 * The store-bound container — RunConfigSections' recipe, in a leaf so a snapshot tick re-renders this
 * control rather than the textarea and the send button beside it (ContextUsageControl's stated reason for
 * being a container at all). It read every store that recipe reads EXCEPT the announced model until
 * #1053; now it reads that one too, and each announcement writes a fresh object identity, so an
 * announcement re-renders this leaf and nothing else in the composer.
 *
 * `conversationId` arrives as a PROP rather than as a fifth store read, the settled house idiom
 * (RunConfigSections, ComposerSlot, BackgroundTaskPanel): Composer already subscribes to
 * `activeConversationId`, so the prop costs no subscription. It is NOT the session id also read here —
 * those are different identifiers, and a session id keys nothing in the model-list map.
 *
 * AC3's "sends nothing when there is no addressable session id" is met by changeSetting's OWN gate, not
 * by withholding the handler, and that differs from the sheet deliberately. The sheet withholds
 * `onChange` because its view branches OPERABILITY on handler presence; this view branches operability on
 * the ROWS (AC4). Withholding here would fuse two unrelated conditions into one rendering and make a
 * populated menu unopenable whenever the session id is unknown, which no AC asks for. changeSetting is
 * documented as the deterministic safety net behind that structural gate; here it is the whole gate, and
 * it has its own unit tests.
 */
export function ComposerModelMenu({ conversationId }: { conversationId: string | null }): JSX.Element | null {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the zustand
  // selector: it returns a fresh object every call, which defeats Object.is and re-renders on every store
  // tick — the composition runs in the render body instead (RunConfigSections.tsx:660-663).
  const writeState = useRunSettingsWriteStore((s) => s)
  // #1053 — the app-lifetime announcement, the same value the run-configuration sheet's Running model
  // section reads. It is DAEMON-scoped rather than conversation-scoped (translateModelAnnounced drops the
  // conversation id deliberately, and exitActiveConversation.ts records that), so a second conversation
  // with no pick and no stored choice shows this one. Accepted: the sheet already reads the same app-wide
  // value under the same conditions, and scoping the store is a store-plus-bridge change of its own.
  const announced = useAnnouncedModelStore(selectAnnouncedModel)
  // A useMemo-stable selector per id — a fresh closure each render would churn the subscription. A null
  // conversation selects nothing THROUGH THE SAME PATH, with no invented key and no second branch
  // downstream, and `null` is a stable reference.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)

  // THE PICK ALONE: the pending optimistic overlay over the client-confirmed override, with NO daemon
  // base under it — which is what a null snapshot means to selectEffectiveSettings, by its own documented
  // fallback to ''. Passing null rather than walking `pending` here is deliberate: that walk has one home,
  // and publishedRowFor's docblock is this file's own record of what a second copy of a rule costs. This
  // composition is also what moves the label to the picked value at once and what reverts it when the
  // store drops the pending record on a rejection — there is no local state here, and there must not be:
  // a second copy of the displayed value could disagree with the sheet's.
  const picked = selectEffectiveSettings(null, writeState).model

  return (
    <ComposerModelMenuView
      // #1053's four layers, `null` and a '' announcement collapsing to the same "nothing at this layer"
      // (AC4 names them as one clause). `truncated` is deliberately NOT read: this surface reports no cut
      // and clips every long name by CSS, and the sheet stays the full reading.
      layers={{
        picked,
        announced: announced?.model ?? '',
        stored: snapshot?.model ?? ''
      }}
      models={models}
      // An arrow, so `window.pyry` is dereferenced at INTERACTION time and never during render — hoisting
      // it (or the deps object) would move the dereference into the render path, where window.pyry does
      // not exist under renderToStaticMarkup and every container smoke test would throw
      // (ConversationScreen.tsx:2523-2526 and RunConfigSections.tsx:687-696 state this from both sides).
      onSelect={(value) =>
        changeSetting(
          { sessionId, sendCommand: window.pyry.sendCommand, dispatch: writeState.dispatch },
          { field: 'model', value }
        )
      }
    />
  )
}
