import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { initialFocusedOptionIndex, resolveComposerOptionsKey } from './composerOptionsKeyboard'

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
  // A handle for the container to move DOM focus with. NOT the ref #839's right-edge clamp wants measured —
  // that wiring is #680's — though it is the same handle, which is a bonus rather than this ticket's business.
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
                attribute or URL sink. #694 feeds this workspace-authored command names, so this is
                load-bearing per CLAUDE.md's daemon-text ruling. */}
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
// It ships DORMANT: nothing mounts it when this ticket lands, exactly as #838's panel and #839's clamp did.
// #680 is the first live host. Note the anchor takes NO `style` prop — #839's `--composer-options-shift` is
// set by the consumer that can measure a real x-position, which is #680's half of the work, not this one's.
//
// Props are declared inline, as ThreadOverflowMenu's are: this is glue, and no consumer annotates them. A
// named ComposerOptionsMenuProps is worth exporting the day one wants to, and promoting it is additive.
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
