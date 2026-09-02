import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject
} from 'react'
import { initialFocusedOptionIndex, resolveComposerOptionsKey } from './composerOptionsKeyboard'
import { composerOptionsMaxWidthPx, composerOptionsShiftPx } from './composerOptionsPlacement'

// #838: the composer footer's shared options panel (Figma node 121:3879, "Options overlay") — ONE surface
// for five queued consumers: #680 Actions, #682 permission mode, #683 model and effort, and #694's
// slash-command type-ahead opening the same panel from the message box. This slice is that panel's
// RESTING APPEARANCE only, so none of the five builds its own; #839 places it, #840 opens it and drives it
// from the keyboard. Nothing in the app renders it when this ticket lands — that is intended, not a gap.
//
// Its own file rather than ConversationScreen.tsx (which is ~2700 lines and a merge hot-spot for the
// sibling tickets): five named future consumers across two later tickets want an addressable module, the
// PermissionModal.tsx / WorkspacePickerSheet.tsx / BackgroundTaskPanel.tsx precedent. It adds NO CSS
// import — its styles live in conversation.css and ConversationScreen.tsx:13 is that file's single
// importer, exactly as PermissionModal.tsx relies on.
//
// The posture is ThreadOverflowMenuView's: props in, markup out, no state, no effects, no store read and
// no window.pyry, so renderToStaticMarkup renders the current-value and no-current-value states directly
// and both stay unit-testable under the repo's `node` vitest environment.

// `id` is the stable identity — the wire/model value — and `label` is the visible row text. They are
// SEPARATE because #683's model menu shows `Opus 5` for `claude-opus-5` and #682's permission menu shows
// `Accept edits` for `acceptEdits`; matching the current value on the display string would force both
// tickets to invent a lookup. Ids are unique by caller contract: no runtime guard, because no such
// failure has been observed and React's own `key` warning already surfaces a duplicate in dev.
//
// #940 SHARPENED `label`'s TRUST TIER. Until the slash-command type-ahead landed, every consumer passed a
// client-owned constant here; that one passes WORKSPACE-AUTHORED text — a command name and its argument
// hint, written by whoever wrote the repository claude is running in, bounded but NOT sanitized by the
// daemon. So `label` may be untrusted, and the obligation lives with whatever renders it: an ordinary React
// text child only, never dangerouslySetInnerHTML, never an attribute, a URL, a filename, a cache key, a
// lookup path or a log (CLAUDE.md's daemon-text ruling). The row markup below is that boundary, and it is
// the whole of it. A menu adding a second visible field inherits this paragraph rather than rediscovering
// it — and #940 is also the precedent for NOT adding one: it carries a command description it deliberately
// never passes here, so the string reaches no DOM sink at all (the product decision on #934).
export interface ComposerOptionsPanelOption {
  id: string
  label: string
}

// Every prop is REQUIRED — the "a view that cannot answer is a bug" rule (ConversationScreen.tsx:2033).
//
// `currentId: string | null`, not optional: `null` is the ticket's "a menu of commands is a list of
// actions rather than a choice: same panel, no row highlighted", and it is a value a caller states rather
// than omits. A `currentId` matching no option highlights nothing through the SAME branch — no special
// case, no throw, so a stale model id cannot crash the panel.
//
// There is deliberately NO `open` prop and no trigger. The trigger belongs to #680/#682/#683, and a view
// that owns no trigger cannot own `aria-expanded`. Mounting IS opening: a consumer writes
// `{open && <ComposerOptionsPanel … />}`, which is where ThreadOverflowMenuView puts the same seam — and
// where ComposerOptionsMenu below keeps it, rather than growing the prop. `ariaLabel` therefore has to be
// injected — the panel cannot name itself when it does not know which control opened it.
//
// #840 added the last two. `focusedIndex` is REQUIRED like the rest; `panelRef` is the one optional prop,
// following ThreadOverflowMenuView's `triggerRef` convention exactly — an ordinary prop rather than
// forwardRef, omitted in tests, since a native <div> accepts ref={undefined} and a static render cannot
// exercise a ref anyway.
export interface ComposerOptionsPanelProps {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
  onSelect: (id: string) => void
  ariaLabel: string
  // Which row is in the tab order — the ROVING TABINDEX. A separate axis from `currentId`: the current
  // value is what the menu reads, the focused row is where the arrows are, and they coincide only on the
  // frame the panel opens. An index addressing no row marks none, the same no-special-case posture a stale
  // `currentId` gets; the container cannot produce one, since resolveComposerOptionsKey normalises.
  focusedIndex: number
  // A handle for the container to move DOM focus with. It arrived for focus, and #847 measures the panel's
  // width through the same ref for #839's right-edge clamp — the bonus that module's recipe anticipated.
  panelRef?: Ref<HTMLDivElement>
}

export function ComposerOptionsPanel({
  options,
  currentId,
  onSelect,
  ariaLabel,
  focusedIndex,
  panelRef
}: ComposerOptionsPanelProps): JSX.Element {
  return (
    <div ref={panelRef} className="composer-options" role="menu" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const isCurrent = option.id === currentId
        return (
          <button
            key={option.id}
            type="button"
            role="menuitem"
            // A roving tabindex (#840): one row in the tab order, the rest reachable only programmatically,
            // and the shipped `.composer-options__item:focus-visible` outline paints on whichever holds
            // real DOM focus. aria-activedescendant was rejected — it would need a generated unique id per
            // row (four consumers can share one screen) and it leaves focus on the panel, which makes that
            // outline dead and "returns focus to the trigger" unwritable.
            //
            // It sits BEFORE className deliberately: this file's tests match whole attribute runs, so
            // inserting an attribute between className and aria-current would break them (#838's code
            // review left that coupling as a NIT). Reorder these props only alongside those assertions.
            tabIndex={index === focusedIndex ? 0 : -1}
            // The base class STAYS on the current row — a modifier worn without its base is the vacuity
            // conversation.css:779-781 legislates against, and the row's whole treatment beyond the fill
            // hangs off the base.
            className={
              isCurrent
                ? 'composer-options__item composer-options__item--current'
                : 'composer-options__item'
            }
            // aria-current rather than branching the ROLE to menuitemradio: it is a global ARIA attribute
            // meaning exactly "the current item within a set", and branching the role on `currentId` would
            // make one panel two different widgets — which #694 (a type-ahead, not a menu) would then have
            // to fight. undefined omits the attribute entirely rather than emitting aria-current="false".
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelect(option.id)}
          >
            {/* An ordinary React text child: auto-escaped, no dangerouslySetInnerHTML, and never an
                attribute or URL sink. #940 feeds it workspace-authored command names and argument hints,
                so it is load-bearing per CLAUDE.md's daemon-text ruling — and it stays ONE child, which is
                what keeps the row's `white-space: nowrap` a complete answer to a name carrying the one
                measured sub-0x20 byte. */}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// #840: the store-free interaction container around the pure view above — the ThreadOverflowMenuView /
// ThreadOverflowMenu split (ConversationScreen.tsx:2653-2710), which already solves most of this shape and
// is deliberately extended rather than reinvented. Unlike ThreadOverflowMenu it is EXPORTED: #680 Actions,
// #682 permission mode and #683 model and effort live in other files, and three copies of an ARIA contract
// is three chances to get it wrong.
//
// THE TRIGGER'S BEHAVIOUR IS THE CONTAINER'S; ITS LABEL AND APPEARANCE ARE THE CONSUMER'S. The <button>,
// aria-haspopup, aria-expanded and the toggle are the parts four tickets would each get wrong, so they land
// once here. What the button READS and how it is DRAWN belong to whichever menu mounts it — this ticket
// draws no footer button. The container puts no aria-label on the trigger: `triggerContent` is visible text
// ("Max", "Opus 5"), so an aria-label would override it and break WCAG 2.5.3's label-in-name. An icon-only
// trigger would need one, and the fix then is one additive optional prop with no cascade.
//
// It shipped DORMANT: nothing mounted it when #840 landed, exactly as #838's panel and #839's clamp did.
// #680 is the first live host. The anchor still takes NO `style` prop — #839's `--composer-options-shift`
// is written imperatively by this container's own layout effect (#847), so no consumer sets it and none
// can: both refs the measurement needs are private here.
//
// Props are declared inline, as ThreadOverflowMenu's are: this is glue, and no consumer annotates them. A
// named ComposerOptionsMenuProps is worth exporting the day one wants to, and promoting it is additive.

// #847: the standard isomorphic alias — ConversationScreen.tsx:387-394's `useThreadLayoutEffect` verbatim,
// at module scope next to its only consumer exactly as that one sits next to its own. `document` exists in
// the window and NOT in vitest's `node` environment (vitest.config.ts:27), where the renderer tests
// server-render through renderToStaticMarkup and React 18 logs "useLayoutEffect does nothing on the server"
// once per render site. This component is reached by ComposerOptionsPanel.test.tsx,
// ComposerActionsMenu.test.tsx AND every one of the ~33 `<ConversationScreen` sites in
// ConversationScreen.test.tsx, so a raw useLayoutEffect would add ~40 lines of warning noise to every
// `npm test` run — the exact cost the sibling already measured and already solved.
//
// IT DOES NOT WEAKEN THE PRE-PAINT GUARANTEE, which is the whole reason the clamp wants a layout effect: in
// the window `document` exists, so this IS useLayoutEffect and the panel never paints unclamped; under
// renderToStaticMarkup neither hook runs, so the branch changes no behaviour anywhere it could be observed.
// Meeting `useEffect` on one branch of a paint-critical effect is not the mistake it looks like.
//
// DUPLICATED rather than lifted into a shared module: extracting it would mean editing
// ConversationScreen.tsx, a ~2700-line declared merge hot-spot, to refactor code this ticket does not
// otherwise touch. A third consumer is the moment to lift it out — conversation.css:1626-1628's "one
// consumer is not a pattern" call.
const useComposerOptionsLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/**
 * The panel's WINDOW FIT: #847's right-edge clamp plus #940's window-relative width bound, measured
 * together and written as two custom properties on the anchor.
 *
 * It was lifted out of `ComposerOptionsMenu` by #940 so the two hosts share one copy — what
 * conversation.css's "one consumer is not a pattern" rule asks for now that there are two. The type-ahead
 * anchors on the message box rather than on a footer button, so it could not reach the effect where it
 * lived (it closed over that component's private refs), and the alternative was a second copy of a
 * measure-and-write effect whose every hazard — the mandatory `px` unit, the `[active]`-only deps, the
 * listener's lifecycle — is carried in prose rather than in a type. The clamp half is the shipped body
 * moved verbatim, so `e2e/composer-options-clamp.spec.ts` stays its detector for both hosts.
 *
 * The width bound arrived in #940's rework, from the product decision on #934, and it is INERT for a host
 * whose stylesheet does not read `--composer-options-max-width` — see the ordering note inside, which is
 * the one place the two halves interact.
 *
 * `active` is the caller's "the panel is mounted right now" — `open` for the menu, a non-empty undismissed
 * row list for the type-ahead. It is the SOLE dependency, deliberately: see the deps note inside.
 */
export function useComposerOptionsClamp({
  anchorRef,
  panelRef,
  active
}: {
  anchorRef: RefObject<HTMLElement>
  panelRef: RefObject<HTMLElement>
  active: boolean
}): void {
  // #839 shipped the arithmetic (composerOptionsShiftPx) and the CSS hook (--composer-options-shift, read
  // by `.composer-options`'s `left`) and left both dormant, because no anchor had a real x-position until
  // a real footer button gave it one; #847 joined them. It lands in shared code rather than in a consumer:
  // wiring it once is what stops #680, #682, #683 and #940 each re-deriving it.
  //
  // A LAYOUT effect, unlike the focus effect below, and that difference is the point: the panel must never
  // paint at its unclamped position, so the correction has to land before paint. The focus effect's "focus
  // is not a paint concern" reasoning does not transfer. The alias above is how this gets to be a layout
  // effect without the server-render warning noise; see its comment.
  //
  // Deps are [active] and NOTHING else. Not `focusedIndex` — it changes on every arrow key and changes no
  // measurement. Not `options` — a consumer building its array inline hands a fresh reference every render,
  // which would churn an add/remove listener pair per render to re-measure something nothing asked for, and
  // every shipped consumer's option list is fixed for the lifetime of one opening. The two REFS are stable
  // objects and are correctly absent from the list.
  useComposerOptionsLayoutEffect(() => {
    if (!active) return
    const apply = (): void => {
      // Both nodes are attached whenever this runs — React sets refs before layout effects, and the panel
      // mounts in the same commit that flips `active`. Checked anyway, the focus effect's posture: a
      // missing node is a no-op, never a throw. No `!` and no cast.
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return
      // Named fields, so the transposition that matters (`panelWidth` ↔ `windowWidth`) is impossible by
      // inspection — composerOptionsPlacement.ts's whole reason for taking an object rather than three
      // positionals.
      const anchorLeft = anchor.getBoundingClientRect().left
      const windowWidth = window.innerWidth

      // #940's window-relative WIDTH BOUND, written BEFORE the panel is measured — and that order is the
      // whole correctness of pairing the two. `offsetWidth` below reads the panel's laid-out width, so
      // measuring first would feed the shift an UNBOUNDED width and pull a panel left by an overflow the
      // bound is about to remove. Writing it first costs one forced style-and-layout pass per open (and
      // per resize), inside a layout effect, before paint.
      //
      // It is written for EVERY host and consumed by whichever one's stylesheet reads the property: today
      // only the type-ahead's `.composer__row .composer-options` does, and the three footer menus inherit
      // a custom property no rule of theirs mentions, so their geometry is byte-for-byte what it was. That
      // is deliberate rather than lazy — a bound of this shape applied to the Actions panel would squash it
      // at the artificial widths e2e/composer-options-clamp.spec.ts drives, which is the detector for the
      // shift and must keep measuring the shift.
      anchor.style.setProperty(
        '--composer-options-max-width',
        `${composerOptionsMaxWidthPx({ anchorLeft, windowWidth })}px`
      )

      // `offsetWidth` is the recipe's chosen input: it rounds to an integer while the rect is fractional.
      // For a host that consumes the bound above this now reads a width that already fits, so the shift is
      // structurally 0 there and the panel is kept inside the window by its width rather than by a move —
      // the clamp stays wired because it is one shared effect, and because it is what still catches the
      // panel if that `max-width` declaration is ever dropped.
      const shift = composerOptionsShiftPx({
        anchorLeft,
        panelWidth: panel.offsetWidth,
        windowWidth
      })
      // THE UNIT IS NOT OPTIONAL. A bare number makes the whole `left` declaration invalid at
      // computed-value time, dropping the panel to `left: auto` and its static position — which for an
      // absolutely-positioned child of a flex container is the anchor's content-box start, 12px further
      // INTO the overflow. Both composerOptionsPlacement.ts and conversation.css state this from their own
      // sides; e2e/composer-options-clamp.spec.ts is the detector.
      //
      // Written imperatively on the anchor rather than hoisted into useState and passed as a `style` prop:
      // the declarative form re-renders the whole subtree per resize event to write a value the DOM already
      // holds, needs an `as CSSProperties` cast (CSSProperties has no index signature for custom
      // properties), keeps a second source of truth, and breaks the shipped assertion in
      // ComposerOptionsPanel.test.tsx, which pins the anchor's opening tag whole.
      anchor.style.setProperty('--composer-options-shift', `${shift}px`)
    }
    apply()
    // Re-measure on resize, so a window narrowed while the panel is open is corrected and a widened one
    // RELEASES a shift it no longer needs. IDEMPOTENT BY CONSTRUCTION: the panel is `position: absolute`,
    // so shifting it moves neither the anchor (an out-of-flow child is not a flex item) nor its own
    // `max-content` width, and `window.innerWidth` is independent of both — every input is invariant under
    // the shift, so a re-read converges instead of walking the panel further left. That is #839's stated
    // reason for naming `anchorLeft` rather than the panel's own measured left; do not "improve" the inputs.
    //
    // The listener copies the outside-click effect's lifecycle verbatim: attached only while active, torn
    // down by this cleanup when it goes false AND on unmount, so none outlives an open panel. The handler
    // takes no event argument, so it needs no WindowEventMap read.
    //
    // Neither property is cleared. The listener goes; the values stay. The anchor outlives the panel, the
    // panel that inherits them is unmounted, and the next open recomputes both before paint — so a stale
    // value is inherited by nothing and displayed never, and clearing them would be two more statements
    // defending an unobservable state.
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
    }
  }, [active])
}

export function ComposerOptionsMenu({
  options,
  currentId,
  onSelect,
  ariaLabel,
  triggerContent,
  triggerClassName
}: {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
  onSelect: (id: string) => void
  ariaLabel: string
  triggerContent: ReactNode
  triggerClassName: string
}): JSX.Element {
  // Component-local useState, never the session store (ADR 0006, the `sheetOpen` precedent), so the panel
  // resets to closed on remount for free — the same reason #276's container gets that property.
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Every exit routes through close() or through select(), which is close() plus the report. That single
  // path IS "every close path returns focus to the trigger" — there is no fourth way out to forget.
  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const select = (id: string): void => {
    setOpen(false)
    onSelect(id)
    triggerRef.current?.focus()
  }
  const toggle = (): void => {
    if (open) {
      close()
      return
    }
    // Where focus starts is decided on the closed→open transition, not on mount: `options` and `currentId`
    // are a consumer's live props, so the answer is only correct as of the moment the panel opens.
    setFocusedIndex(initialFocusedOptionIndex(options, currentId))
    setOpen(true)
  }

  // ONE keydown path, and it is a React handler on the anchor rather than #276's document listener. The
  // deviation is deliberate: that menu never moves focus into itself, so only a document listener could see
  // Escape; this one does, so the anchor's own handler sees every keystroke — the trigger's and the rows'
  // both — and a document keydown would merely double-handle Escape. That is what lets the whole key
  // contract live in one tested function instead of being split across two handlers.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return

    const outcome = resolveComposerOptionsKey({
      optionCount: options.length,
      focusedIndex,
      key: event.key
    })
    // `ignore` means "not ours": return before touching the event, so Tab still tabs and Space still reaches
    // the focused row's native button activation.
    if (outcome.type === 'ignore') return
    // Everything else is handled, so the default must not also run: it is what stops the arrows scrolling
    // the thread, and what stops Enter firing the focused row's native click ON TOP of the pick below.
    event.preventDefault()

    switch (outcome.type) {
      case 'focus':
        setFocusedIndex(outcome.index)
        break
      case 'pick':
        // Addressable by construction — `pick` is range-guarded, and the totality property in
        // composerOptionsKeyboard.test.ts is what keeps it so. No `!` and no cast.
        select(options[outcome.index].id)
        break
      case 'dismiss':
        close()
        break
    }
  }

  // #847's right-edge clamp, now one shared hook (#940 lifted it out when the type-ahead became its
  // second host). The refs it measures are still private to this component; what changed is that the
  // measure-and-write body lives once, above.
  useComposerOptionsClamp({ anchorRef, panelRef, active: open })

  // Move real DOM focus onto the focused row while the panel is open. Plain useEffect, not useLayoutEffect:
  // focus is not a paint concern, useLayoutEffect warns under renderToStaticMarkup, and #276's container
  // uses the plain one. querySelectorAll on the row class rather than children[i], so a future non-row child
  // (#694's "no matches" line is a named one) cannot silently shift the index; optional chaining throughout,
  // so a missing node is a no-op rather than a throw.
  useEffect(() => {
    if (!open) return
    const rows = panelRef.current?.querySelectorAll<HTMLElement>('.composer-options__item')
    rows?.[focusedIndex]?.focus()
  }, [open, focusedIndex])

  // Outside click keeps #276's shape verbatim: a document listener attached only while open and torn down
  // by the cleanup on close AND on unmount, so no listener outlives an open menu; the target narrowed with
  // `instanceof Node`, never an `as` cast; read through DocumentEventMap['mousedown'] rather than a bare
  // annotation, for the same shadowing reason ConversationScreen.tsx:2681-2683 records.
  //
  // close()'s .focus() runs BEFORE the browser's own mousedown focus action, so on this one path focus ends
  // where the user clicked rather than on the trigger. That is the correct outcome — returning focus to a
  // trigger the user just clicked away from would steal it — which is why no preventDefault is added here.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: DocumentEventMap['mousedown']): void => {
      const target = event.target
      if (target instanceof Node && anchorRef.current && !anchorRef.current.contains(target)) {
        close()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open])

  return (
    <div ref={anchorRef} className="composer-options-anchor" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {triggerContent}
      </button>
      {/* A real <button>, so Enter and Space activate the trigger natively — no handler of their own, and
          none is wanted: one would double-fire on top of the native activation. */}
      {open && (
        <ComposerOptionsPanel
          options={options}
          currentId={currentId}
          onSelect={select}
          ariaLabel={ariaLabel}
          focusedIndex={focusedIndex}
          panelRef={panelRef}
        />
      )}
    </div>
  )
}
