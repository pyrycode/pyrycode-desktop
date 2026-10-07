import { useMemo } from 'react'
import type { WireAgent, WireModelOption } from '@shared/wire/types'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { useModelListStore, selectModelListFor, type ModelListEntry } from '../../store/modelListStore'
import { useRunConfigStore, selectSnapshot } from '../../store/runConfigStore'
import { useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { useRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { useAnnouncedModelStore, selectAnnouncedModelFor } from '../../store/announcedModelStore'
import {
  publishedRowFor,
  modelRowsFor,
  useConversationAgent,
  useSessionSettingsConnected,
  selectConnectedModel,
  usePendingAgentSwitchRow
} from './RunConfigSections'
import { isAddressableSessionId } from './runSettingsControls'

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

/** The footer and sheet share these layers. Picks outrank announcements for explicit labels;
 * inherited marking uses the announcement only until a client choice is made. */
export interface ComposerModelLayers {
  /** Pending optimistic choice over the client-confirmed choice; empty means no pick. */
  picked: string
  /** Running-turn identifier, held verbatim; empty means no announcement. */
  announced: string
  /** Saved choice; empty/default is inherited, null means no snapshot has arrived. */
  stored: string | null
}

/** The first layer with something to show, or '' when none has anything — `null` (#1495) being nothing at
 *  a layer exactly as '' is, so both chains below read through it with no second branch.
 *
 *  BOTH TESTS ARE EXPLICIT, and the null one is not redundant even though `stored` is last in both chains
 *  today: a bare `value !== ''` lets a null PASS the predicate, and the result is right only because
 *  `?? ''` launders it at the end. A later nullable layer in front of another would silently answer
 *  "nothing" for the layers behind it. The predicate states the rule instead of inheriting it from an
 *  ordering. A truthiness test is the opposite error and is what the guard below must not become. */
function firstShown(...values: readonly (string | null)[]): string {
  return values.find((value) => value !== '' && value !== null) ?? ''
}

/** #1095 — the vendor prefix the family rule strips, and the ONE client-owned literal on this path.
 *
 *  It is a PREFIX STRIP, not a vocabulary, which is what keeps #988's AC2 ("no client copy naming a model
 *  concept") intact: there is no allow-list of family names here and there must not be one, so a family
 *  this client has never heard of derives through the same rule as a known one. Exact case, because no
 *  case fold exists anywhere on this path. */
const CLAUDE_IDENTIFIER_PREFIX = 'claude-'

/** Strip one Claude prefix, then capitalize the leading ASCII-letter family.
 * Used only for the designated inherited matching tier and escaped display labels. */
function modelFamily(identifier: string): string {
  const bare = identifier.startsWith(CLAUDE_IDENTIFIER_PREFIX)
    ? identifier.slice(CLAUDE_IDENTIFIER_PREFIX.length)
    : identifier
  const head = /^[A-Za-z]+/.exec(bare)?.[0] ?? ''
  // charAt rather than [0] so the empty case needs no non-null assertion — '' returns '' from both halves.
  return head.charAt(0).toUpperCase() + head.slice(1)
}

/** #1651 — one row's label in the menu, keyed on the ROW's own agent. A Claude row keeps #1095's family
 *  rule over its `value`, falling back to `display_name`. A Codex row shows `display_name` exactly as the
 *  daemon sends it: no Codex name is ever built on the client, from `value`, `family` or anything else. */
export function composerModelRowLabel(row: WireModelOption): string {
  if (row.agent === 'codex') return row.display_name
  const rowFamily = modelFamily(row.value)
  return rowFamily === '' ? row.display_name : rowFamily
}

/** What the trigger shows and what the menu offers.
 *
 *  `options` EMPTY is AC4's inert arm and is a different thing from a menu with rows: it never reaches
 *  ComposerOptionsMenu, which renders aria-haspopup and aria-expanded unconditionally and would open
 *  exactly the empty panel AC4 forbids. `currentId` is the visible row position matched, or `null` when nothing
 *  matched — the panel marks nothing through the same branch, no special case. */
export interface ComposerModelMenuModel {
  label: string
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
}

/** A unique match wins; ambiguity stops before a less precise tier can override it. */
function inheritedModelRow(
  rows: readonly WireModelOption[],
  announced: string,
  defaultResolution: string
): WireModelOption | undefined {
  if (announced === '') {
    const candidates = defaultResolution === '' ? [] : rows.filter(row => row.resolved_model === defaultResolution)
    return candidates.length === 1 ? candidates[0] : undefined
  }
  const family = modelFamily(announced)
  const tiers = [
    (row: WireModelOption): boolean => row.value === announced,
    (row: WireModelOption): boolean => row.resolved_model === announced,
    (row: WireModelOption): boolean => family !== '' && modelFamily(row.value) === family
  ]
  for (const matches of tiers) {
    const candidates = rows.filter(matches)
    if (candidates.length > 0) return candidates.length === 1 ? candidates[0] : undefined
  }
  return undefined
}

/** One selection decision for the footer and sheet. Effective settings still govern offerings. */
export function composerModelMenuModel(
  models: ModelListEntry | null | undefined,
  layers: ComposerModelLayers,
  agent: WireAgent = 'claude',
  pendingSwitchRow: WireModelOption | null = null
): ComposerModelMenuModel | null {
  if (pendingSwitchRow === null && layers.stored === null && layers.picked === '' && layers.announced === '') return null
  const visibleRows = (models?.models ?? []).filter(row => row.value !== 'default')
  const rows = modelRowsFor(models, agent).filter(row => row.value !== 'default')
  const options = visibleRows.map((row, index) => ({ id: String(index), label: composerModelRowLabel(row) }))
  const explicit = layers.picked !== '' || (layers.stored !== null && layers.stored !== '' && layers.stored !== 'default')
  const resolution = agent === 'claude' ? publishedRowFor(models, 'default', agent)?.resolved_model ?? '' : ''
  const defaultResolution = resolution === '<unmeasured>' ? '' : resolution
  const sessionRow = explicit
    ? rows.find(row => row.value === firstShown(layers.picked, layers.stored))
    : inheritedModelRow(rows, layers.announced, defaultResolution)
  const shown = firstShown(layers.picked, layers.announced, layers.stored)
  const row = explicit ? publishedRowFor(models, shown, agent) : sessionRow
  let label: string
  if (agent === 'codex') {
    const codexShown = explicit ? shown : layers.announced
    const codexRow = publishedRowFor(models, codexShown, agent)
    label = codexShown === '' ? COMPOSER_MODEL_MENU_LABEL : codexRow ? codexRow.display_name : codexShown
  } else if (explicit) {
    const family = row ? firstShown(modelFamily(row.resolved_model), modelFamily(row.value)) : modelFamily(shown)
    label = family || (row ? row.display_name : shown)
  } else if (row) {
    label = firstShown(modelFamily(row.resolved_model), modelFamily(row.value)) || row.display_name
  } else {
    label = firstShown(
      modelFamily(layers.announced),
      modelFamily(defaultResolution),
      COMPOSER_MODEL_MENU_LABEL
    )
  }
  const selectedIndex = pendingSwitchRow
    ? visibleRows.findIndex(row => row.value === pendingSwitchRow.value &&
      (row.agent ?? 'claude') === (pendingSwitchRow.agent ?? 'claude') &&
      row.display_name === pendingSwitchRow.display_name && row.resolved_model === pendingSwitchRow.resolved_model)
    : visibleRows.findIndex(row => row === sessionRow)
  return { label: pendingSwitchRow ? composerModelRowLabel(pendingSwitchRow) : label,
    currentId: selectedIndex < 0 ? null : String(selectedIndex), options }
}

/**
 * The pure view: props in, markup out — no store read, no window.pyry and no state of its own, so both
 * arms server-render directly under the repo's `node` vitest environment. An absent selection callback
 * keeps the held value readable without offering a write.
 *
 * SECURITY — this is a render boundary for claude-authored text. `display_name`, `value` and, since
 * #1053, the ANNOUNCED identifier crossed the subprocess trust boundary and DECODED IS NOT SANITIZED
 * (modelListStore's and announcedModelStore's headers): #972 made the SHAPE trusted and nothing more, and
 * the daemon bounds (256 bytes for the announcement) without sanitizing. The announcement is a REPORT used
 * to locate the running row for marking; `onSelect` still dispatches only a value a published ROW carries — a hostile daemon cannot
 * make this control send a string it did not itself publish. Each reaches exactly one JSX TEXT
 * position, where React escapes it — never dangerouslySetInnerHTML, never an attribute, a URL, a
 * filename, a cache key, a lookup path or a log.
 *
 * SINCE #1095 those two text positions usually carry a DERIVED FAMILY instead (modelFamily above). That is
 * strictly less exposure, not more: a family is a `[A-Za-z]+` prefix with one character upper-cased, so a
 * control byte or a terminal escape can now reach the DOM only through the unchanged verbatim fallback —
 * the same path that carries it today. The positions themselves are the same two, and the derivation adds
 * no sink. Panel IDs are client-owned row positions. A click recovers the published row
 * for agent-aware dispatch; neither its value nor its label is logged.
 *
 * The label is LENGTH-BOUNDED at this boundary rather than trusted to the daemon's own bound: it sits in
 * its own element so .composer__model-label can cap it and ellipsize. .composer__actions' `white-space:
 * nowrap` justification does NOT transfer — that one rests on the label being a client-owned constant,
 * and an unbounded name here would push the context reading out of a row with a hard 20px height.
 */
export function ComposerModelMenuView({
  layers,
  models,
  agent = 'claude',
  pendingSwitchRow = null,
  onSelect
}: {
  layers: ComposerModelLayers
  models: ModelListEntry | null
  /** #1651 — the conversation's agent; absent reads Claude. */
  agent?: WireAgent
  pendingSwitchRow?: WireModelOption | null
  onSelect?: (row: WireModelOption) => void
}): JSX.Element | null {
  const menu = composerModelMenuModel(models, layers, agent, pendingSwitchRow)
  if (menu === null) return null

  // AC4. Not `options={[]}` through the shared menu, which would advertise a popup and open an empty
  // panel: an inert element with no role, no tabindex and no handler — the sheet's own operable-vs-inert
  // idiom (RunConfigSections.tsx:354-365) one layer down. The chevron goes with the interactivity it
  // claims: an up chevron is the design's "this opens a panel" mark, and drawing it here would be the
  // visual half of exactly the claim this arm refuses.
  if (!onSelect || menu.options.length === 0) {
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
      // marking uses the matched visible row position.
      currentId={menu.currentId}
      onSelect={id => {
        const row = models?.models.filter(row => row.value !== 'default')[Number(id)]
        if (row) onSelect(row)
      }}
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
 * The host must be connected and the session addressable before a selection callback is offered.
 * The view retains its label without that callback; changeConnectedSetting rechecks current stores
 * before sending or recording an optimistic change, including calls saved before disconnect.
 */
export function ComposerModelMenu({ conversationId }: { conversationId: string | null }): JSX.Element | null {
  const connected = useSessionSettingsConnected(conversationId)
  const sessionId = useSessionIdStore(selectSessionId)
  const snapshot = useRunConfigStore(selectSnapshot)
  // The RAW write state (stable identity between dispatches). NOT selectEffectiveSettings as the zustand
  // selector: it returns a fresh object every call, which defeats Object.is and re-renders on every store
  // tick — the composition runs in the render body instead (RunConfigSections.tsx:660-663).
  const writeState = useRunSettingsWriteStore((s) => s)
  // #1053 — the announcement for THIS conversation, the same value the run-configuration sheet's Running
  // model section reads for it. It was daemon-scoped rather than conversation-scoped until #1146, so a
  // second conversation with no pick and no stored choice showed the previous daemon's announcement; the
  // store is keyed now and this reads its own chat's or nothing. A useMemo-stable selector per id, like
  // the model list below — a fresh closure each render would churn the subscription, and a null
  // conversation selects nothing through the same path.
  const selectAnnounced = useMemo(
    () => (conversationId === null ? () => null : selectAnnouncedModelFor(conversationId)),
    [conversationId]
  )
  const announced = useAnnouncedModelStore(selectAnnounced)
  // A useMemo-stable selector per id — a fresh closure each render would churn the subscription. A null
  // conversation selects nothing THROUGH THE SAME PATH, with no invented key and no second branch
  // downstream, and `null` is a stable reference.
  const selectModels = useMemo(
    () => (conversationId === null ? () => null : selectModelListFor(conversationId)),
    [conversationId]
  )
  const models = useModelListStore(selectModels)
  const agent = useConversationAgent(conversationId)
  const pendingSwitchRow = usePendingAgentSwitchRow(conversationId)

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
      //
      // THE STORED LAYER IS THE ONE THAT DOES NOT COLLAPSE (#1495). `?? null` rather than `?? ''`, and
      // `??` does not fire on '' — so a snapshot naming no model still arrives as '' and takes #1423's
      // inherited-default branch, while NO SNAPSHOT arrives as null and takes none. The announcement above
      // keeps collapsing for the reason stated there: no rendering can tell its two readings apart. This
      // one has told them apart since #1423, which is what made the flattening a defect rather than a
      // simplification.
      layers={{
        picked,
        announced: announced?.model ?? '',
        stored: snapshot?.model ?? null
      }}
      models={models}
      agent={agent}
      pendingSwitchRow={pendingSwitchRow}
      // An arrow, so `window.pyry` is dereferenced at INTERACTION time and never during render — hoisting
      // it (or the deps object) would move the dereference into the render path, where window.pyry does
      // not exist under renderToStaticMarkup and every container smoke test would throw
      // (ConversationScreen.tsx:2523-2526 and RunConfigSections.tsx:687-696 state this from both sides).
      onSelect={connected && isAddressableSessionId(sessionId)
        ? (row) => selectConnectedModel(conversationId, row)
        : undefined}
    />
  )
}
