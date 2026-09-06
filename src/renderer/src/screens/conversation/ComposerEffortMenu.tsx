import { useMemo } from 'react'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { useModelListStore, selectModelListFor, type ModelListEntry } from '../../store/modelListStore'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { useRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { effortRowFor } from './RunConfigSections'
import { changeSetting } from './runSettingsControls'

// #989: the composer footer's EFFORT menu (Figma 115:3688) — the row's last control before the context
// reading, and ComposerModelMenu's assembly one button to the right. It owns exactly three things: its
// entries, what picking one does, and the trigger's label and appearance. Everything else — the
// <button>, aria-haspopup, aria-expanded, the toggle, roving focus, Escape, outside-click and focus
// return — is ComposerOptionsMenu's. It adds NO prop to that component: four consumers share it.
//
// It assembles rather than invents. The panel is #838/#839/#840's, the levels are #974's, the write is
// #256's and the match rule is #560/#975/#976's — this file is the wiring plus the three renderings.
//
// WHERE IT DEPARTS FROM ITS NEIGHBOUR is worth stating once, because the two look interchangeable: the
// model trigger LOOKS UP its label (a row's display_name, joined on the session's model), while this
// one's label IS the session's value. Claude's own control displays these levels lowercase and
// byte-identical to the machine values, so there is no display convention to reproduce and no
// relabelling to do — the row lookup (effortRowFor since #1168) is used here only to find the LEVELS.

// The PANEL's accessible name, and a client-owned constant — NOT the trigger's visible text. This
// trigger reads claude-authored text, and aria-label is an ATTRIBUTE: a sink CLAUDE.md's daemon-text
// ruling forbids outright. The container puts no aria-label on the TRIGGER either
// (ComposerOptionsPanel's ComposerOptionsMenu), so the button's accessible name stays its visible text
// and WCAG 2.5.3's label-in-name is unaffected — the name injected here reaches only the role="menu"
// panel, which has no visible label of its own.
//
// It is the control's own name, the word the run-configuration sheet's section header already uses.
export const COMPOSER_EFFORT_MENU_LABEL = 'Effort'

// Figma 115:3688's `chevron-up-solid-full`, the same 8x4 instance ComposerActionsMenu draws at 115:3677
// and ComposerModelMenu at 115:3683. Module-private and duplicated rather than lifted, which is the
// same call taken for this glyph's CSS rule — see .composer__actions-icon in conversation.css, whose
// standing note fires on this ticket and is answered there once for both. It points UP and does not
// flip on open, for ComposerActionsMenu's reason: reading the panel's `open` flag would mean a new prop
// on the surface four tickets share. The export's fill is dropped for currentColor so the glyph
// inherits the button's --color-primary.
const CHEVRON_PATH =
  'M3.59822 0.146303C3.82044 -0.0482491 4.18133 -0.0482491 4.40356 0.146303L7.81689 3.13463C8.03911 3.32918 8.03911 3.64514 7.81689 3.83969C7.59467 4.03424 7.23378 4.03424 7.01156 3.83969L4 1.20311L0.988445 3.83813C0.766222 4.03268 0.405333 4.03268 0.183111 3.83813C-0.0391111 3.64358 -0.0391111 3.32763 0.183111 3.13307L3.59644 0.144747L3.59822 0.146303Z'

/** What the trigger shows and what the menu offers.
 *
 *  `options` EMPTY is AC3's inert arm and is a different thing from a menu with rows: it never reaches
 *  ComposerOptionsMenu, which renders aria-haspopup and aria-expanded unconditionally and would open
 *  exactly the empty panel AC3 forbids.
 *
 *  `currentId` is the session's effort itself rather than a looked-up level, because the options' ids
 *  ARE the levels. A value appearing in no published level marks nothing through the panel's existing
 *  `option.id === currentId` branch — no special case, no null arm, and no reason to withhold the menu:
 *  the daemon may narrow a list for a session already running a level outside it. */
export interface ComposerEffortMenuModel {
  label: string
  options: readonly ComposerOptionsPanelOption[]
  currentId: string
}

/**
 * The whole decision, as a pure function of the three inputs — so every rule below is unit-testable as
 * data rather than only through markup (ComposerModelMenu's property, and the only way a menu whose
 * entries are the daemon's can be asserted at all under a static render that cannot open the panel).
 *
 * THREE RENDERINGS:
 *
 *   effort === ''                    → null           the session's effort is not known; draw nothing
 *   effort, and no published levels  → no options     AC3's inert label
 *   effort and levels                → the menu
 *
 * The first is AC1's second half, and #988 shipped it for the identical case one button to the left.
 * selectEffectiveSettings resolves `effort` to '' until a run-config snapshot has arrived, and the
 * snapshot lands on a turn-end edge, so that window is ordinary app startup rather than an edge case.
 * Every other rendering would draw an empty gap where a label belongs; ContextUsageControl takes the
 * same posture for its own unavailable reading and #811's no-placeholder rule points the same way.
 * THE SHEET TAKES THE OPPOSITE POSTURE on this same field — RunConfigSections' EffortSection renders a
 * present, empty `run-config__effort-current` line, "inventing no distinction the snapshot does not
 * carry". Two shipped precedents, opposite outcomes; the footer follows its own neighbour.
 *
 * THE SECOND IS ONE ARM COVERING ALL THREE nothing-to-offer readings — no frame has arrived for the
 * conversation, the session's model matches no published row, and the matched row publishes an empty
 * list. `effort_levels` collapses absent, null and [] into one position by wire contract, precisely
 * because a client's behaviour is identical for all three, so there is one case here and not two.
 *
 * AND NEVER A FALLBACK. An absent, unmatched or empty list must not mean "offer every level": there is
 * no level list in this repo to fall back to — #976 deleted the last one — and re-minting one here
 * would put a second copy of the vocabulary back in the place it was removed from.
 *
 * THE ROW IS THE SESSION'S MODEL, resolved by exact equality on `value` — the same string and the same
 * rule EffortSection and the model trigger both join. No family derivation, no substring, prefix, case
 * fold or trim anywhere on this path — `value` is an argument (`default`, `sonnet`, `opus[1m]`), not a
 * parseable identifier.
 *
 * #1168 MOVED THAT LOOKUP FROM publishedRowFor TO effortRowFor, the one home the two EFFORT surfaces
 * share, and it is the whole of that slice here. An empty model is the wire's inherited daemon default
 * rather than an absence, and it now resolves the row the daemon publishes for that default instead of
 * missing every row — so an unconfigured chat reaches the MENU rendering above where it used to reach
 * the inert one permanently, which measured live is the common case rather than an edge. Nothing else
 * moved: the label, the currentId, the options mapping, the `effort === ''` rendering and both arms are
 * untouched, and with no inherited-default row published this still resolves nothing and still draws the
 * inert label. The three OTHER callers of publishedRowFor keep missing on an empty model deliberately —
 * effortRowFor's docblock names them and why, one being the permission-mode trigger beside this one.
 *
 * `?? []` guards the shape rather than the type: `effort_levels` is a non-optional `string[]`, but
 * WireModelOption's docblock records that a frame reached through a bare `as` can yield undefined, and
 * EffortSection writes the same expression for the same reason.
 *
 * `truncated_fields` is deliberately NOT read. The shared panel's option is { id, label } with one text
 * child, so a cut report here would need either a new prop on a component four tickets share
 * (forbidden) or client copy fused into a daemon-authored node (rejected in EffortSection's cut-marker
 * rationale). A cut-to-nothing list therefore collapses into the inert arm beside no-list-yet, and the
 * run-configuration sheet remains the surface that reports both readings.
 *
 * The entries are EXACTLY the published levels, in the daemon's order — nothing deduped, dropped,
 * reordered or synthesised. `id` is the level itself, so onSelect(id) submits it with no lookup. A
 * REPEATED published level is therefore a duplicate React key in a panel that takes no new prop: it is
 * carried anyway, because AC2's "exactly the published levels" outranks a tidier list and both entries
 * submit the identical string, so the pick is still correct. EffortSection reaches the same conclusion
 * by keying on the array index, which the shared panel does not offer; the panel's key is #838's and is
 * not reopened here.
 */
export function composerEffortMenuModel(
  models: ModelListEntry | null | undefined,
  model: string,
  effort: string
): ComposerEffortMenuModel | null {
  if (effort === '') return null
  const levels = effortRowFor(models, model)?.effort_levels ?? []
  return {
    label: effort,
    currentId: effort,
    options: levels.map((level) => ({ id: level, label: level }))
  }
}

/**
 * The pure view: props in, markup out — no store read, no window.pyry and no state of its own, so both
 * arms server-render directly under the repo's `node` vitest environment. Every prop is REQUIRED, the
 * "a view that cannot answer is a bug" rule.
 *
 * SECURITY — this is a render boundary for claude-authored text, and the tier is HIGHER than the
 * workspace-authored strings the slash-command list holds. Every string in `effort_levels` crossed the
 * subprocess trust boundary and DECODED IS NOT SANITIZED (modelListStore's header): #972 made the SHAPE
 * trusted and nothing more, and the daemon bounds without sanitizing. No control byte is measured in
 * these short labels, but one is permitted rather than excluded. Each level reaches exactly one JSX
 * TEXT position, where React escapes it — never dangerouslySetInnerHTML, never an attribute, a URL, a
 * filename, a cache key, a lookup path or a log. A level additionally reaches four non-sink places, all
 * the panel's: `key={option.id}` (React's own keyed reconciliation, a Map internally rather than a
 * plain-object index), a string comparison against currentId, the onSelect pass-through, and an array
 * index. No plain object is keyed by any of it, and nothing on this path is logged at all.
 *
 * The label is LENGTH-BOUNDED at this boundary rather than trusted to the daemon's own bound: it sits
 * in its own element so .composer__effort-label can cap it and ellipsize. The measured vocabulary is
 * six characters at most, but the string is claude-authored, and an unbounded one in a row with a hard
 * 20px height beside a nowrap reading is a layout-level denial of that reading — remotely triggerable
 * by a hostile or merely buggy daemon.
 */
export function ComposerEffortMenuView({
  model,
  effort,
  models,
  onSelect
}: {
  model: string
  effort: string
  models: ModelListEntry | null
  onSelect: (level: string) => void
}): JSX.Element | null {
  const menu = composerEffortMenuModel(models, model, effort)
  if (menu === null) return null

  // AC3. Not `options={[]}` through the shared menu, which would advertise a popup and open an empty
  // panel: an inert element with no role, no tabindex and no handler — the sheet's own
  // operable-vs-inert idiom one layer down. The chevron goes with the interactivity it claims: an up
  // chevron is the design's "this opens a panel" mark, and drawing it here would be the visual half of
  // exactly the claim this arm refuses.
  if (menu.options.length === 0) {
    return (
      <span className="composer__footer-button">
        <span className="composer__effort-label">{menu.label}</span>
      </span>
    )
  }

  return (
    <ComposerOptionsMenu
      options={menu.options}
      // AC2's marking. The panel renders aria-current="true" on the matching row and omits the
      // attribute entirely otherwise, so the marking needs no new prop — and an effort matching no
      // published level marks nothing through that same branch.
      currentId={menu.currentId}
      onSelect={onSelect}
      ariaLabel={COMPOSER_EFFORT_MENU_LABEL}
      triggerContent={
        <>
          <span className="composer__effort-label">{menu.label}</span>
          {/* aria-hidden is load-bearing: the trigger carries no aria-label, so its accessible name is
              computed from its contents — and there is no client-owned constant to fall back on, so the
              e2e locator matches this label exactly. */}
          <svg
            className="composer__effort-icon"
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
      triggerClassName="composer__footer-button composer__effort"
    />
  )
}

/**
 * The store-bound container — ComposerModelMenu's recipe verbatim, in a leaf so a snapshot tick
 * re-renders this control rather than the textarea and the send button beside it.
 *
 * `conversationId` arrives as a PROP rather than as a fifth store read, the settled house idiom:
 * Composer already subscribes to `activeConversationId`, so the prop costs no subscription. It is NOT
 * the session id also read here — those are different identifiers, and a session id keys nothing in the
 * model-list map.
 *
 * AC4's "sends nothing when there is no addressable session id" is met by changeSetting's OWN gate, not
 * by withholding the handler, and that differs from the sheet deliberately. The sheet withholds
 * `onChange` because its view branches OPERABILITY on handler presence; this view branches operability
 * on the LEVELS (AC3). Withholding here would fuse two unrelated conditions into one rendering and make
 * a populated menu unopenable whenever the session id is unknown, which no AC asks for. changeSetting
 * is documented as the deterministic safety net behind that structural gate; here it is the whole gate,
 * and it has its own unit tests.
 */
export function ComposerEffortMenu({
  conversationId
}: {
  conversationId: string | null
}): JSX.Element | null {
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the
  // zustand selector: it returns a fresh object every call, which defeats Object.is and re-renders on
  // every store tick — the composition runs in the render body instead.
  const writeState = useRunSettingsWriteStore((s) => s)
  // A useMemo-stable selector per id — a fresh closure each render would churn the subscription. A null
  // conversation selects nothing THROUGH THE SAME PATH, with no invented key and no second branch
  // downstream, and `null` is a stable reference.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)

  // The pending optimistic overlay > the client-confirmed override > the snapshot base. This
  // composition is also what moves the label to the picked level at once and what reverts it when the
  // store drops the pending record on a rejection — there is no local state here, and there must not
  // be: a second copy of the displayed value could disagree with the sheet's.
  const effective = selectEffectiveSettings(snapshot, writeState)

  return (
    <ComposerEffortMenuView
      model={effective.model}
      effort={effective.effort}
      models={models}
      // An arrow, so `window.pyry` is dereferenced at INTERACTION time and never during render —
      // hoisting it (or the deps object) would move the dereference into the render path, where
      // window.pyry does not exist under renderToStaticMarkup and every container smoke test would
      // throw. The level is submitted VERBATIM and never repaired: no client-side allowlist is added,
      // which would be a second copy of the vocabulary #976 deleted, and the daemon's closed inbound
      // enum refusing a level it published is an upstream asymmetry that surfaces here as an ordinary
      // rejection.
      onSelect={(value) =>
        changeSetting(
          { sessionId, sendCommand: window.pyry.sendCommand, dispatch: writeState.dispatch },
          { field: 'effort', value }
        )
      }
    />
  )
}
