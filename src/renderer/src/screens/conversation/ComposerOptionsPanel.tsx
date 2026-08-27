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
// `{open && <ComposerOptionsPanel … />}`, which is where ThreadOverflowMenuView puts the same seam.
// `ariaLabel` therefore has to be injected — the panel cannot name itself when it does not know which
// control opened it.
export interface ComposerOptionsPanelProps {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
  onSelect: (id: string) => void
  ariaLabel: string
}

export function ComposerOptionsPanel({
  options,
  currentId,
  onSelect,
  ariaLabel
}: ComposerOptionsPanelProps): JSX.Element {
  return (
    <div className="composer-options" role="menu" aria-label={ariaLabel}>
      {options.map((option) => {
        const isCurrent = option.id === currentId
        return (
          <button
            key={option.id}
            type="button"
            role="menuitem"
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
