import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { useRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { changeSetting } from './runSettingsControls'

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
//   - ITS ENTRIES ARE A CLIENT-OWNED CONSTANT. The model and effort menus read a daemon-published list
//     (`model_list`), so each has a third rendering — an inert label that opens nothing — for the three
//     ways that list can be missing. This vocabulary is published by nobody: neither the daemon nor claude
//     tells this client which permission modes may be set. So there is no list frame to read, no
//     empty-list arm, no `publishedRowFor` lookup and no model-list store read at all, and there is never
//     "nothing to offer" — every mode that renders at all renders an OPERABLE trigger. That is not a
//     relaxation of the sibling rule against re-minting a deleted vocabulary (#976); it is the opposite
//     situation, and the constants below are the single place this client states it.
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
 *  absent, and its absence is a security property rather than an omission — see the header. */
export const SETTABLE_PERMISSION_MODES: readonly string[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk'
]

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
 *  There is no empty-`options` arm here, unlike both siblings: the entries are a constant, so the array is
 *  always the same five. `currentId` is the session's own mode VERBATIM — the machine value, not the
 *  display name — because the panel matches on `id`, and because a mode appearing in no entry (a session
 *  in bypass, or a mode this client cannot name) must mark nothing through the panel's existing
 *  `option.id === currentId` branch rather than through a special case here. */
export interface ComposerPermissionModeMenuModel {
  label: string
  options: readonly ComposerOptionsPanelOption[]
  currentId: string
}

/**
 * The whole decision, as a pure function of the one input — so every rule is unit-testable as data rather
 * than only through markup (the sibling menus' property, kept even though this one's entries are fixed).
 *
 * TWO RENDERINGS, where the neighbours have three:
 *
 *   permissionMode === ''   → null      no mode is known; draw nothing
 *   any other string        → the menu  always the same five entries
 *
 * The first is AC1's second half, and both neighbours ship it for the identical case one button along.
 * `selectEffectiveSettings` resolves `permissionMode` to '' until a run-config snapshot has arrived, and
 * the snapshot lands on a turn-end edge, so that window is ordinary app startup rather than an edge case.
 * '' is ALSO the daemon's own reading for "no session was resolved" (runConfigStore) — one string reached
 * two ways, and both mean this control has nothing true to say. Every other rendering would draw an empty
 * gap where a label belongs; ContextUsageControl takes the same posture for its own unavailable reading
 * and #811's no-placeholder rule points the same way.
 *
 * The second covers the bypass reading with no branch of its own, which is the design rather than a
 * shortcut: the label names whatever the daemon reports (AC2's "a session already in it still shows
 * bypassPermissions"), and the entries stay the five it may send.
 */
export function composerPermissionModeMenuModel(
  permissionMode: string
): ComposerPermissionModeMenuModel | null {
  if (permissionMode === '') return null
  return {
    label: permissionModeLabel(permissionMode),
    currentId: permissionMode,
    options: SETTABLE_PERMISSION_MODES.map((mode) => ({
      id: mode,
      label: permissionModeLabel(mode)
    }))
  }
}

/**
 * The pure view: props in, markup out — no store read, no window.pyry and no state of its own, so both
 * arms server-render directly under the repo's `node` vitest environment. Every prop is REQUIRED, the
 * "a view that cannot answer is a bug" rule.
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
  permissionMode,
  onSelect
}: {
  permissionMode: string
  onSelect: (mode: string) => void
}): JSX.Element | null {
  const menu = composerPermissionModeMenuModel(permissionMode)
  if (menu === null) return null

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
 * It takes NO PROPS, which is the visible half of this control reading no per-conversation list: both
 * neighbours take `conversationId` solely to select their model-list slice, and there is nothing here to
 * select it for.
 *
 * AC3's "sends nothing when there is no addressable session id" is met by changeSetting's OWN gate, not by
 * withholding the handler. The run-configuration sheet withholds `onChange` because its view branches
 * OPERABILITY on handler presence; this view has no operability branch at all, so withholding would fuse
 * two unrelated conditions and make a populated menu unopenable whenever the session id is unknown, which
 * no AC asks for. changeSetting is documented as the deterministic safety net behind that structural gate;
 * here it is the whole gate, and it has its own unit tests.
 */
export function ComposerPermissionModeMenu(): JSX.Element | null {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the zustand
  // selector: it returns a fresh object every call, which defeats Object.is and re-renders on every store
  // tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)

  // The pending optimistic overlay > the client-confirmed override > the snapshot base. This composition is
  // AC3's second half and AC4 in full, with no code of its own: it moves the label to the picked mode at
  // once, and returns it to the daemon-reported mode when the store drops the pending record on a
  // rejection. There is no local state here, and there must not be — a second copy of the displayed value
  // could disagree with the run-configuration sheet's.
  const effective = selectEffectiveSettings(snapshot, writeState)

  return (
    <ComposerPermissionModeMenuView
      permissionMode={effective.permissionMode}
      // An arrow, so `window.pyry` is dereferenced at INTERACTION time and never during render — hoisting
      // it (or the deps object) would move the dereference into the render path, where window.pyry does not
      // exist under renderToStaticMarkup and every container smoke test would throw. The mode is submitted
      // as the entry's own machine value, which is a client-owned constant: this is the one footer menu
      // whose outbound value never came off the wire.
      onSelect={(value) =>
        changeSetting(
          { sessionId, sendCommand: window.pyry.sendCommand, dispatch: writeState.dispatch },
          { field: 'permissionMode', value }
        )
      }
    />
  )
}
