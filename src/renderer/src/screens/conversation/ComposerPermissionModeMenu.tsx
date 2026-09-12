import { useMemo } from 'react'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { useModelListStore, selectModelListFor, type ModelListEntry } from '../../store/modelListStore'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { useRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { publishedRowFor, useSessionSettingsConnected, changeConnectedSetting } from './RunConfigSections'
import { isAddressableSessionId } from './runSettingsControls'

// #682: the composer footer's PERMISSION MODE menu (Figma 115:3678) — the row's second control, between
// the Actions menu and the model trigger. It owns exactly three things: its entries, what picking one
// does, and the trigger's label and appearance. Everything else — the <button>, aria-haspopup,
// aria-expanded, the toggle, roving focus, Escape, outside-click and focus return — is
// ComposerOptionsMenu's. It adds NO prop to that component: four consumers share it.
//
// It assembles rather than invents. The panel is #838/#839/#840's, the inbound mode is #1020's, the
// outbound field is #1021's and the overlay is #256's — this file is the wiring plus two renderings.
//
// WHERE IT DEPARTS FROM ITS TWO NEIGHBOURS, because at a glance the three look interchangeable:
//
//   - ITS VOCABULARY IS CLIENT-OWNED, AND ONLY ONE ENTRY OF IT IS CONDITIONAL. The model and effort menus
//     read a daemon-published list (`model_list`), so each has a third rendering — an inert label that
//     opens nothing — for the three ways that list can be missing. This vocabulary is published by nobody:
//     neither the daemon nor claude tells this client which permission modes may be set, so there is no
//     list frame to wait for and no empty-list arm, and THERE IS NEVER "NOTHING TO OFFER" — every mode
//     that renders at all renders an OPERABLE trigger. That is not a relaxation of the sibling rule
//     against re-minting a deleted vocabulary (#976); it is the opposite situation, and the constants
//     below are the single place this client states it.
//
//     #1022 GAVE IT A `publishedRowFor` LOOKUP AND A MODEL-LIST STORE READ, which this paragraph used to
//     deny. It reads exactly one field of the matched row — `supports_auto_mode` — to drop ONE entry, and
//     the two claims around that are unchanged: the list is still never empty, and the trigger is still
//     never inert. What separates this control from its neighbours is now the direction of the read, not
//     its absence: their whole entry list is the daemon's, while this one subtracts a single named mode
//     from a list it owns. That asymmetry is a security property — see the note on the filter below.
//
//   - ITS LABEL IS LOOKED UP, unlike the effort trigger's. Claude publishes effort levels byte-identical
//     to what it accepts, so that control relabels nothing. Permission modes arrive as camelCase machine
//     identifiers (`acceptEdits`), and Figma 115:3678 draws the display form (`Auto`) — the shared panel's
//     `id`/`label` split exists for exactly this consumer, which its own docblock records by name.
//
// Its own file rather than ConversationScreen.tsx (~2700 lines and a declared merge hot-spot), the
// ComposerModelMenu.tsx / ComposerEffortMenu.tsx precedent, and it adds no CSS import: its styles live in
// conversation.css, whose single importer is ConversationScreen.tsx.

// THE WIRE CONTRACT IS ASYMMETRIC AND THAT ASYMMETRY IS THE WHOLE DESIGN. Measured from the daemon's
// `validPermissionMode` on 2026-09-03: the READ half reports six modes, the WRITE half accepts five —
// `bypassPermissions` is refused on `permission_mode`, deliberately, so the escalation keeps exactly one
// spelling on the wire: the `yolo` bit the run-configuration sheet's toggle already owns.
//
// So this control renders six labels and offers five entries. A session sitting in bypass shows
// `Bypass permissions` on the button and is offered the other five; picking one moves it out of bypass,
// because the daemon clears the bit for any mode it accepts. NOTHING HERE CAN MOVE A SESSION INTO BYPASS,
// and nothing here should try: adding the sixth entry "for symmetry" would put a one-click privilege
// escalation in the input footer. The two counts are pinned by name in ComposerPermissionModeMenu.test.tsx.

/** Display names for the six modes the daemon can report — the client's own copy, since neither the
 *  daemon nor claude publishes a display form. Each is a faithful rendering of its machine value and
 *  nothing shorter: `Bypass permissions` is emphatically not abbreviated to buy row width, because the
 *  one label naming a security posture is the last one to make ambiguous.
 *
 *  A mode outside this record renders VERBATIM (the RunningModelSection posture) — the reading
 *  runConfigSnapshot's own test assigns to this ticket. Read through permissionModeLabel below and NEVER
 *  by a bare index: the key is a daemon-controlled string. */
export const PERMISSION_MODE_LABELS: Readonly<Record<string, string>> = {
  default: 'Default',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions'
}

/** The five modes this control may submit, in the daemon's own declared order. `bypassPermissions` is
 *  absent, and its absence is a security property rather than an omission — see the header.
 *
 *  Five plain literals, deliberately: this is the daemon's declared vocabulary stated verbatim, and
 *  substituting AUTO_PERMISSION_MODE into the middle of it would obscure the one thing the list exists to
 *  say. The two are tied together by an assertion instead — the filtered mode must be a member of this
 *  list — so a rename cannot silently disable the filter. */
export const SETTABLE_PERMISSION_MODES: readonly string[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk'
]

/** #1022 — the one settable mode a MODEL can refuse, and therefore the only entry above that is
 *  conditional. Exported because both test tiers must name it to derive their expectations; a second copy
 *  typed into either would be free to drift from the string the filter actually removes. */
export const AUTO_PERMISSION_MODE = 'auto'

// The PANEL's accessible name, and a client-owned constant — NOT the trigger's visible text. The container
// puts no aria-label on the TRIGGER (ComposerOptionsMenu), so the button's accessible name stays its
// visible text and WCAG 2.5.3's label-in-name is unaffected; the name injected here reaches only the
// role="menu" panel, which has no visible label of its own.
//
// It is the control's own name. The run-configuration sheet has no permission section to borrow a heading
// from — this control is the first surface for the field — so the noun phrase is minted here.
export const COMPOSER_PERMISSION_MODE_MENU_LABEL = 'Permission mode'

// Figma 115:3678's `chevron-up-solid-full`, the same 8x4 instance the three sibling triggers draw.
// Module-private and duplicated rather than lifted, which is also the call taken for this glyph's CSS
// rule — see the note on .composer__actions-icon in conversation.css, which this ticket answers once for
// both. It points UP and does not flip on open, for ComposerActionsMenu's reason: reading the panel's
// `open` flag would mean a new prop on the surface four tickets share. The export's fill is dropped for
// currentColor so the glyph inherits the button's --color-primary.
const CHEVRON_PATH =
  'M3.59822 0.146303C3.82044 -0.0482491 4.18133 -0.0482491 4.40356 0.146303L7.81689 3.13463C8.03911 3.32918 8.03911 3.64514 7.81689 3.83969C7.59467 4.03424 7.23378 4.03424 7.01156 3.83969L4 1.20311L0.988445 3.83813C0.766222 4.03268 0.405333 4.03268 0.183111 3.83813C-0.0391111 3.64358 -0.0391111 3.32763 0.183111 3.13307L3.59644 0.144747L3.59822 0.146303Z'

/**
 * The display name for a mode, or the mode itself when this client does not know it.
 *
 * AN OWN-PROPERTY READ, and that is load-bearing rather than defensive style. The key is a
 * daemon-controlled string: a bare `PERMISSION_MODE_LABELS[mode]` returns a function for `constructor` and
 * an object for `__proto__`, neither of which is `undefined`, so a `?? mode` fallback does NOT catch them
 * — and a non-string reaching a JSX child position throws inside React, taking the conversation screen
 * down from one field of one daemon frame. `hasOwnProperty.call` is the guard; the record is never indexed
 * anywhere else in this file.
 */
function permissionModeLabel(mode: string): string {
  return Object.prototype.hasOwnProperty.call(PERMISSION_MODE_LABELS, mode)
    ? PERMISSION_MODE_LABELS[mode]
    : mode
}

/** What the trigger shows and what the menu offers.
 *
 *  There is no empty-`options` arm here, unlike both siblings: the entries are this client's own
 *  vocabulary less at most one mode, so the array is always four or five. `currentId` is the session's own
 *  mode VERBATIM — the machine value, not the display name — because the panel matches on `id`, and
 *  because a mode appearing in no entry (a session in bypass, a mode this client cannot name, or since
 *  #1022 a session running `auto` on a model that refuses it) must mark nothing through the panel's
 *  existing `option.id === currentId` branch rather than through a special case here. */
export interface ComposerPermissionModeMenuModel {
  label: string
  options: readonly ComposerOptionsPanelOption[]
  currentId: string
}

/**
 * The whole decision, as a pure function of the one input — so every rule is unit-testable as data rather
 * than only through markup (the sibling menus' property, kept even though this one's entries are fixed).
 *
 * TWO RENDERINGS, where the neighbours have three — and #1022 did NOT add a third:
 *
 *   permissionMode === ''   → null      no mode is known; draw nothing
 *   any other string        → the menu  four entries or five, never fewer and never none
 *
 * The first is #682's AC1 second half, and both neighbours ship it for the identical case one button
 * along.
 * `selectEffectiveSettings` resolves `permissionMode` to '' until a run-config snapshot has arrived, and
 * the snapshot lands on a turn-end edge, so that window is ordinary app startup rather than an edge case.
 * '' is ALSO the daemon's own reading for "no session was resolved" (runConfigStore) — one string reached
 * two ways, and both mean this control has nothing true to say. Every other rendering would draw an empty
 * gap where a label belongs; ContextUsageControl takes the same posture for its own unavailable reading
 * and #811's no-placeholder rule points the same way.
 *
 * The second covers the bypass reading with no branch of its own, which is the design rather than a
 * shortcut: the label names whatever the daemon reports (#682's "a session already in it still shows
 * bypassPermissions"), and the entries stay what it may send.
 *
 * #1022 — THE ENTRY LIST IS NOW FOUR OR FIVE, and the whole of that decision is `hidesAuto` below.
 *
 * THE FILTER CAN ONLY EVER SUBTRACT, AND ONLY EVER ONE NAMED MODE. The offered list is this client's own
 * constant MINUS `AUTO_PERMISSION_MODE`; it is never computed FROM the published row. That is the
 * security property: the worst a hostile or merely buggy daemon achieves by lying with
 * `supports_auto_mode: false` is removing one middle-permission entry, while `default` and `plan` — the
 * two safest options — are unconditional and cannot be hidden, and no row can ADD an entry, least of all
 * the escalation the header excludes. A design that derived the entries from the row instead would be
 * exploitable. It is also worth stating what this is NOT: the hide is a UX affordance, never an
 * authorization boundary. The daemon refuses a mode it does not accept and #256 rolls the optimistic
 * label back, so nothing here is relied on for safety.
 *
 * FAILING OPEN IS THE RULE, not a fallback (AC2): `auto` is offered wherever the client does not
 * positively know otherwise. Three inputs reach that reading and they are ONE reading, so they get one
 * condition and no branches — no frame has arrived for the conversation (`models` is null), the
 * conversation's published list is empty, and the session's model matches no row, which includes a row
 * whose `value` the daemon cut mid-token and which therefore simply misses.
 *
 * `=== false` RATHER THAN `!row.supports_auto_mode`. In the shipped path the two agree: parseModelList's
 * `requireBoolean` throws on a non-boolean and drops the whole frame, so a row that reaches the store
 * always carries a real boolean. The strict form is written anyway because it states the rule directly —
 * only a row SAYING false hides the entry — and because it stays correct on a path that bypasses the
 * narrower, which WireModelOption's docblock warns about for a frame reached through a bare `as` (there an
 * absent key reads `undefined`, and the loose form would act on a flag this client never received). It is
 * the decoder's own posture one layer down: checked on the TYPE, never on truthiness. `row === undefined`
 * is the outer guard for the same reason a `?? false` would be wrong: a miss is the unknown reading.
 *
 * THE ROW IS THE SESSION'S MODEL, resolved by exact equality on `value` through publishedRowFor — the
 * same string and the same rule both neighbouring triggers join, and #1022 was that helper's fifth
 * caller. #1168 NARROWED THAT SENTENCE and the count behind it: the two EFFORT surfaces now go through
 * `effortRowFor`, which is this same rule plus one substitution — an empty model, the wire's inherited
 * daemon default, looks up the row the daemon publishes for that default instead of missing every row.
 * THIS MENU DELIBERATELY DID NOT FOLLOW THEM, and the branch was put in that separate home precisely so
 * it could not: an empty model reaching this lookup would resolve the inherited-default row, and a row
 * saying `supports_auto_mode: false` would then hide the `auto` entry on every chat nobody has set a
 * model on. A miss stays the UNKNOWN reading here, which is what keeps that entry offered.
 * No family derivation, no substring, prefix, case fold or trim anywhere on this
 * path. The caller passes the EFFECTIVE model (pending pick > client-confirmed > snapshot base), which is
 * what makes picking a model that refuses `auto` drop the entry at once, and a rejected model pick bring
 * it back, with no code of its own here.
 */
export function composerPermissionModeMenuModel(
  models: ModelListEntry | null | undefined,
  model: string,
  permissionMode: string
): ComposerPermissionModeMenuModel | null {
  if (permissionMode === '') return null
  const row = publishedRowFor(models, model)
  const hidesAuto = row !== undefined && row.supports_auto_mode === false
  return {
    label: permissionModeLabel(permissionMode),
    currentId: permissionMode,
    options: SETTABLE_PERMISSION_MODES.filter(
      (mode) => !(hidesAuto && mode === AUTO_PERMISSION_MODE)
    ).map((mode) => ({
      id: mode,
      label: permissionModeLabel(mode)
    }))
  }
}

/**
 * The pure view: props in, markup out — no store read, no window.pyry and no state of its own, so both
 * arms server-render directly under the repo's `node` vitest environment. An absent selection callback
 * keeps the held value readable without offering a write.
 *
 * SECURITY — this is a render boundary for daemon-reported text, even though five of its six labels are
 * client-owned constants. `permissionMode` crossed the subprocess trust boundary and DECODED IS NOT
 * SANITIZED: #1020 made the shape trusted and nothing more. An unrecognised mode falls through
 * permissionModeLabel VERBATIM, so this element renders daemon text on that arm and is treated as a sink
 * unconditionally. It reaches exactly one JSX TEXT position, where React escapes it — never
 * dangerouslySetInnerHTML, never an attribute, a URL, a filename, a cache key or a log. Its one other
 * reach is `currentId`, which the panel uses for a string comparison and nothing else; no plain object is
 * keyed by it (permissionModeLabel's own-property guard is the one place it indexes anything), and nothing
 * on this path is logged at all.
 *
 * The label is LENGTH-BOUNDED at this boundary rather than trusted to the daemon's own bound: it sits in
 * its own element so .composer__permission-label can cap it and ellipsize. An unbounded string in a row
 * with a hard 20px height beside a nowrap context reading is a layout-level denial of that reading —
 * remotely triggerable by a hostile or merely buggy daemon.
 */
export function ComposerPermissionModeMenuView({
  model,
  permissionMode,
  models,
  onSelect
}: {
  model: string
  permissionMode: string
  models: ModelListEntry | null
  onSelect?: (mode: string) => void
}): JSX.Element | null {
  // Model and models remain required inputs. The container always knows both, so
  // an optional `models` would only hide the wiring seam: the model function stays green with the mount
  // unwired, and the failure is silent in the fail-open direction. The e2e drive is what catches that.
  const menu = composerPermissionModeMenuModel(models, model, permissionMode)
  if (menu === null) return null
  if (!onSelect) {
    return (
      <span className="composer__footer-button">
        <span className="composer__permission-label">{menu.label}</span>
      </span>
    )
  }

  return (
    <ComposerOptionsMenu
      options={menu.options}
      // AC2's marking. The panel renders aria-current="true" on the matching row and omits the attribute
      // entirely otherwise, so the marking needs no new prop — and a session in bypass, whose mode is in no
      // entry, marks nothing through that same branch.
      currentId={menu.currentId}
      onSelect={onSelect}
      ariaLabel={COMPOSER_PERMISSION_MODE_MENU_LABEL}
      triggerContent={
        <>
          <span className="composer__permission-label">{menu.label}</span>
          {/* aria-hidden is load-bearing: the trigger carries no aria-label, so its accessible name is
              computed from its contents, and the e2e locator matches this label exactly. */}
          <svg
            className="composer__permission-icon"
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
      triggerClassName="composer__footer-button composer__permission"
    />
  )
}

/**
 * The store-bound container — the sibling menus' recipe minus the model list, in a leaf so a snapshot tick
 * re-renders this control rather than the textarea and the send button beside it.
 *
 * `conversationId` arrives as a PROP rather than as a fifth store read, the settled house idiom that both
 * neighbours already follow: Composer already subscribes to `activeConversationId`, so the prop costs no
 * subscription. It is NOT the session id also read here — those are different identifiers, and a session
 * id keys nothing in the model-list map. #1022 added it; until then this container took no props at all,
 * which was the visible half of reading no per-conversation list.
 *
 * The host must be connected and the session addressable before a selection callback is offered.
 * The view retains its label without that callback; changeConnectedSetting rechecks current stores
 * before sending or recording an optimistic change, including calls saved before disconnect.
 */
export function ComposerPermissionModeMenu({
  conversationId
}: {
  conversationId: string | null
}): JSX.Element | null {
  const connected = useSessionSettingsConnected(conversationId)
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the zustand
  // selector: it returns a fresh object every call, which defeats Object.is and re-renders on every store
  // tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)
  // #1022 — the neighbours' selector verbatim. A useMemo-stable selector per id, since a fresh closure
  // each render would churn the subscription. A null conversation selects nothing THROUGH THE SAME PATH,
  // with no invented key and no second branch downstream, and `null` is a stable reference.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)

  // The pending optimistic overlay > the client-confirmed override > the snapshot base. This composition is
  // #682's AC3 second half and its AC4 in full, with no code of its own: it moves the label to the picked
  // mode at once, and returns it to the daemon-reported mode when the store drops the pending record on a
  // rejection. There is no local state here, and there must not be — a second copy of the displayed value
  // could disagree with the run-configuration sheet's.
  //
  // #1022 joins the model list on `effective.model` — the SAME composition, not the snapshot's model — so
  // picking a model that refuses `auto` drops the entry at once and a rejected model pick brings it back,
  // through this one expression and no code of its own.
  const effective = selectEffectiveSettings(snapshot, writeState)

  return (
    <ComposerPermissionModeMenuView
      model={effective.model}
      permissionMode={effective.permissionMode}
      models={models}
      // An arrow, so `window.pyry` is dereferenced at INTERACTION time and never during render — hoisting
      // it (or the deps object) would move the dereference into the render path, where window.pyry does not
      // exist under renderToStaticMarkup and every container smoke test would throw. The mode is submitted
      // as the entry's own machine value, which is a client-owned constant: this is the one footer menu
      // whose outbound value never came off the wire.
      onSelect={connected && isAddressableSessionId(sessionId)
        ? (value) => changeConnectedSetting(conversationId, { field: 'permissionMode', value })
        : undefined}
    />
  )
}
