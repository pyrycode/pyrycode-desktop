import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject
} from 'react'
import type { WireSlashCommand } from '@shared/wire/types'
import {
  selectSlashCommandListFor,
  useSlashCommandListStore
} from '../../store/slashCommandListStore'
import {
  ComposerOptionsPanel,
  useComposerOptionsClamp,
  type ComposerOptionsPanelOption
} from './ComposerOptionsPanel'
import { resolveComposerOptionsKey } from './composerOptionsKeyboard'
import { slashCommandTypeAheadRows, completeSlashCommand } from './slashCommandTypeAhead'

// #940 — the slash-command type-ahead's MOUNT: #939's decisions, drawn on #838's shared panel, over the
// composer's message box, reading #954's per-conversation list. The last slice of #694, and the one that
// makes the whole family observable.
//
// Its own file rather than ConversationScreen.tsx (~3,200 lines and a declared merge hot-spot) — the
// ComposerActionsMenu.tsx precedent verbatim. It adds no CSS import: its styles live in conversation.css,
// whose single importer is ConversationScreen.tsx.
//
// THE SPLIT IS THE SAME ONE EVERY SIBLING HERE MADE. Nothing in this repo can click — vitest.config.ts
// sets `environment: 'node'`, there is no jsdom and no @testing-library — so everything decidable is a
// total function or a pure view a server render executes, and the hook at the foot is the useState and
// the wiring, thin enough to be correct by inspection. The transitions are
// e2e/slash-command-type-ahead.spec.ts's.
//
// A DIFFERENT CONTROL FROM THE ACTIONS MENU (#680), deliberately: that is a footer button holding three
// fixed entries, this is a type-ahead over every command the session has, and its trigger is the textarea
// itself. Where they overlap they do the same thing — the command travels as ordinary message text through
// the composer's one send path. No new message type, no new IPC arm, no wire change.
//
// SECURITY. `name`, `argument_hint`, `description` and every alias are WORKSPACE-AUTHORED — a lower trust
// tier than claude's own words — and the daemon bounds them without sanitizing them. This module is the
// render boundary that owes the sanitization, and it discharges it as: ordinary React text children only
// (the panel's row markup), a row identity that is an INDEX rather than a name, a width bound in the
// stylesheet that is the window's own (below), and NO DIAGNOSTIC ANYWHERE — no console call, no thrown
// error carrying a row, not even a content-free one. `0x0a` is the only sub-0x20 byte measured across the
// capture's 51 entries' four string fields, so the control character that actually occurs is the one that
// splits a log line.
//
// The DESCRIPTION is not rendered at all — the product decision taken on #934 — so of those four fields
// only `name` and `argument_hint` reach the DOM, through the one label expression in
// `slashCommandTypeAheadOptions`. That is a narrowing of this module's exposure and not a substitute for
// any of the measures above: the two fields that do reach it are authored by exactly the same party.

/**
 * The panel's accessible name, and the e2e locator that finds it.
 *
 * A module-level client-owned constant, the COMPOSER_ACTIONS_LABEL / SEND_LABEL convention, and it
 * inherits their warning: e2e/slash-command-type-ahead.spec.ts locates the panel by this exact string, so
 * IT IS A LOAD-BEARING LOCATOR. It also has to differ from `Actions` under the same role — two panels on
 * one screen — which Playwright's strict mode would otherwise catch as an ambiguity.
 */
export const SLASH_COMMAND_TYPE_AHEAD_LABEL = 'Slash commands'

/**
 * The container's own interaction state, keyed by THE TEXT IT WAS DECIDED FOR.
 *
 * Both fields answer a question the row list cannot: which row is highlighted, and whether the panel was
 * closed while its rows still match. Keying them to the text is what makes every reset a DERIVATION rather
 * than an effect — see `slashCommandTypeAheadStateFor`.
 */
export interface SlashCommandTypeAheadState {
  text: string
  highlightedIndex: number
  dismissed: boolean
}

const INITIAL_STATE: SlashCommandTypeAheadState = { text: '', highlightedIndex: 0, dismissed: false }

/**
 * The interaction state for `text`: the held cell when it was decided for this same text, a fresh one
 * otherwise.
 *
 * ONE RULE ANSWERS BOTH OF THIS CONTAINER'S OWN QUESTIONS, which is why they are one cell rather than two.
 *
 * WHERE THE HIGHLIGHT LANDS AFTER A NARROWING — the decision #939 left here by name. Any edit puts it back
 * on the first row, which is the best-ranked one (that module concatenates prefix matches ahead of
 * contained ones ahead of maybes), and the same expression is `initialFocusedOptionIndex`'s answer for a
 * command list with no current value. Keeping a stale index instead would leave the mark on a row the user
 * never aimed at, or on none at all.
 *
 * WHEN A DISMISSED PANEL RE-OPENS — the next edit, in either direction, and nothing else. It cannot be
 * inferred from the rows: Escape must leave the typed text alone (so the rows still match), and completing
 * an un-hinted command leaves the fragment intact and still matching, which is exactly why #939's own doc
 * comment says the container closes it on pick. Both write `dismissed` against the text as of that moment,
 * so a pick's own completion does not re-open the panel on top of itself.
 *
 * Total, and it allocates nothing on the unchanged path — the held cell comes back BY REFERENCE, so a
 * render that changed no text sets no state and schedules no re-render.
 */
export function slashCommandTypeAheadStateFor(
  held: SlashCommandTypeAheadState,
  text: string
): SlashCommandTypeAheadState {
  return held.text === text ? held : { text, highlightedIndex: 0, dismissed: false }
}

/**
 * The published rows as panel options: `/name` with the argument hint after it, and the row's INDEX as its
 * identity.
 *
 * THE DESCRIPTION IS NOT PASSED ON, and its absence is the product decision taken on #934 (2026-09-02)
 * rather than an omission: a row carries the command name and its argument hint, and the description stays
 * out of the DOM entirely. That makes this function the whole of the answer — the field is read from no
 * row here, so it reaches no markup, no attribute and no measurement downstream, and the strictest reading
 * of "workspace-authored text this control renders" covers `name` and `argument_hint` only. If the
 * descriptions come back, they come back with a drawing behind them.
 *
 * THE ID IS THE INDEX AND NEVER THE NAME, which is `slashCommandListStore`'s stated obligation on this
 * slice and closes a real failure rather than a stylistic one: `name` is workspace-authored, is not an
 * identifier (one measured name is `__remote-workflow`), and carries no uniqueness anywhere on the wire —
 * two rows may share one, which as a React `key` is a collision and as an id is an ambiguous pick. An
 * index is client-generated, so no untrusted text reaches a key, a lookup or a comparison.
 *
 * The hint rides IN the label rather than in a third field: it is part of what the user is picking, the
 * panel needs no rule of its own for it, and a field the panel would only ever concatenate is a second
 * copy to keep in agreement. The emptiness test is `!== ''`, literal and untrimmed, matching
 * `completeSlashCommand`'s — the two must agree about which rows are hinted, and the daemon bounds that
 * field without sanitizing it, so normalising a hint of `" "` would be normalisation nothing asked for.
 */
export function slashCommandTypeAheadOptions(
  rows: readonly WireSlashCommand[]
): readonly ComposerOptionsPanelOption[] {
  return rows.map((row, index) => ({
    id: String(index),
    label: row.argument_hint === '' ? `/${row.name}` : `/${row.name} ${row.argument_hint}`
  }))
}

/**
 * The panel for `rows`, or NOTHING when there are none.
 *
 * THE GATE IS `rows.length > 0`, and #939's doc comment names the trap it avoids: `[]` is truthy in
 * JavaScript, so `rows.length && …` renders a bare `0` into the composer and `rows && …` renders the whole
 * panel over an empty list. Returning `null` from a view rather than gating at the call site keeps that
 * one line where a static render can execute it.
 *
 * THE HIGHLIGHT IS `currentId`, NOT `focusedIndex`, and that inversion is the whole difference between a
 * type-ahead and the footer menus. DOM focus must never leave the message box — the user is still typing —
 * so no row can be focused, and the shipped `:focus-visible` outline that marks a footer menu's row would
 * never paint. What does paint is `.composer-options__item--current`, the fill the panel already gives the
 * row matching `currentId`, which also carries `aria-current="true"`. `focusedIndex` is therefore passed
 * as `-1`: the value the panel documents as marking no row, which keeps every row out of the tab order, so
 * Tab from the message box still reaches the send button rather than diving into a list.
 *
 * The ARIA reading is deliberate and its limit is stated rather than hidden. The panel stays a `role="menu"`
 * of `role="menuitem"` rows, because a type-ahead's proper `aria-activedescendant` was rejected by #840 for
 * a reason that still holds — a generated unique id per row, with four consumers on one screen — and
 * `role="combobox"` on the composer's textarea would change the semantics of a control ~15 shipped
 * locators address. So for a screen-reader user the panel is discoverable but the highlight is not
 * announced, and the feature degrades to exactly today's behaviour: a command typed by hand still sends.
 * #934's drawing is where a real combobox can be taken up deliberately.
 */
export function SlashCommandTypeAheadPanel({
  rows,
  highlightedIndex,
  onPick,
  panelRef
}: {
  rows: readonly WireSlashCommand[]
  highlightedIndex: number
  onPick: (index: number) => void
  panelRef?: Ref<HTMLDivElement>
}): JSX.Element | null {
  if (rows.length === 0) return null

  return (
    <ComposerOptionsPanel
      options={slashCommandTypeAheadOptions(rows)}
      currentId={String(highlightedIndex)}
      // The id is the index as a string, so this is the round trip of that one mapping and nothing else.
      // `Number` on a value this module minted cannot be NaN; the pick path is range-guarded regardless.
      onSelect={(id) => onPick(Number(id))}
      ariaLabel={SLASH_COMMAND_TYPE_AHEAD_LABEL}
      focusedIndex={-1}
      panelRef={panelRef}
    />
  )
}

/**
 * The container: the store read, the interaction state, the keyboard, and the element to mount.
 *
 * It returns the two refs the composer attaches rather than reaching for DOM nodes itself — the anchor,
 * whose left edge the panel positions against and whose custom property the clamp writes, and the message
 * box, which a MOUSE pick has to hand focus back to.
 *
 * `handleKeyDown` reports whether it CONSUMED the keystroke, and that boolean is the whole of "Enter
 * completes, it does not send": the composer returns before `shouldSubmitOnKeyDown` is ever consulted, so
 * there is no second send path and no second copy of the `canSend` gate. A second Enter meets a closed
 * panel, is not consumed, and sends through the shipped path exactly as a typed message does.
 */
export function useSlashCommandTypeAhead({
  text,
  conversationId,
  onComplete
}: {
  text: string
  conversationId: string | null
  onComplete: (text: string) => void
}): {
  anchorRef: RefObject<HTMLDivElement>
  inputRef: RefObject<HTMLTextAreaElement>
  panel: ReactNode
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
} {
  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Component-local useState, never the session store (ADR 0006's "ephemeral single-value screen-local
  // state"), so the panel resets to closed on remount for free.
  const [held, setHeld] = useState<SlashCommandTypeAheadState>(INITIAL_STATE)

  // A useMemo-stable selector per id, the keyed-selector precedent one screen up: a fresh selector every
  // render would re-subscribe on every keystroke. A null conversation selects nothing THROUGH THE SAME
  // PATH — no invented key, no second branch downstream — and `null` is a stable reference, so this leaf
  // never re-renders for a menu published to another conversation.
  const selectEntry = useMemo(
    () => (conversationId === null ? () => null : selectSlashCommandListFor(conversationId)),
    [conversationId]
  )
  const entry = useSlashCommandListStore(selectEntry)

  const state = slashCommandTypeAheadStateFor(held, text)
  // THE JOIN, and this slice's one hazardous line. `entry?.commands ?? null` keeps the store's two
  // readings apart all the way into the decision: `null` is "no frame has arrived for this conversation",
  // a normal and permanent state under best-effort delivery, while `commands: []` is "claude published an
  // empty menu". Both close the panel, through the same return, and neither is an error.
  const rows = slashCommandTypeAheadRows(text, entry?.commands ?? null)
  const open = rows.length > 0 && !state.dismissed

  // The panel's window fit, through the hook this ticket lifted out of ComposerOptionsMenu. This control
  // is the one host that consumes BOTH halves: the width bound (#934's decision — the panel may grow until
  // it is 40px clear of the window's right edge) is what keeps this list inside the window at the 800px
  // minimum, and #847's shift is then structurally 0 here because a bounded panel never overflows.
  useComposerOptionsClamp({ anchorRef, panelRef, active: open })

  // Keep the highlighted row in view. The panel caps its height and scrolls (conversation.css), and
  // because this control never moves DOM focus there is nothing to scroll the list for us — a footer menu
  // gets it free from .focus(). `block: 'nearest'` moves as little as possible; querySelectorAll on the
  // row class rather than children[i], so a future non-row child cannot silently shift the index, and
  // optional chaining throughout, so a missing node is a no-op rather than a throw. Plain useEffect: a
  // scroll is not a paint concern, and useLayoutEffect warns under renderToStaticMarkup.
  useEffect(() => {
    if (!open) return
    const rowNodes = panelRef.current?.querySelectorAll<HTMLElement>('.composer-options__item')
    rowNodes?.[state.highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, state.highlightedIndex])

  /** Put a row's completion in the box and close the panel. Total: an index addressing no row is a no-op. */
  const complete = (index: number): void => {
    const row = rows[index]
    if (row === undefined) return
    const completed = completeSlashCommand(row)
    // Dismissed against the COMPLETED text, which is what stops the panel re-opening on top of its own
    // completion: an un-hinted command leaves the fragment intact and still matching (#939), so the text
    // alone cannot close it. The next keystroke changes the text and re-opens it.
    setHeld({ text: completed, highlightedIndex: 0, dismissed: true })
    onComplete(completed)
    // The keyboard path is already here; the MOUSE path is not — a click moves focus onto the row button,
    // which then unmounts, stranding focus on <body> with the composer unusable. One call covers both.
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    // The keystroke that COMMITS an IME composition belongs to the IME, not to this panel: an Enter must
    // neither complete nor send, and the arrows drive the candidate window. Read off the native event, as
    // composerSend's own gate is — `event.isComposing` is a compile error, which is what keeps this
    // untested glue honest.
    if (event.nativeEvent.isComposing) return false

    const outcome = resolveComposerOptionsKey({
      optionCount: rows.length,
      focusedIndex: state.highlightedIndex,
      key: event.key
    })
    // `ignore` means "not ours": report false before touching the event, so every other key still types
    // into the box and the composer's own Enter still sends when the panel is closed.
    if (outcome.type === 'ignore') return false
    // Everything else is handled here and must not also run its default: it is what stops an arrow moving
    // the caret through the draft, and what stops Enter inserting a newline ON TOP of the completion.
    event.preventDefault()

    switch (outcome.type) {
      case 'focus':
        setHeld({ text, highlightedIndex: outcome.index, dismissed: false })
        break
      case 'pick':
        complete(outcome.index)
        break
      case 'dismiss':
        // Escape leaves the typed text alone — only this flag moves.
        setHeld({ ...state, dismissed: true })
        break
    }
    return true
  }

  return {
    anchorRef,
    inputRef,
    panel: open ? (
      <SlashCommandTypeAheadPanel
        rows={rows}
        highlightedIndex={state.highlightedIndex}
        onPick={complete}
        panelRef={panelRef}
      />
    ) : null,
    handleKeyDown
  }
}
