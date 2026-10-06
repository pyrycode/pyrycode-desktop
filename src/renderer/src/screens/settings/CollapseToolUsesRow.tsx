import {
  collapseToolUsesPrefStore,
  selectCollapseToolUses,
  useCollapseToolUsesPrefStore
} from '../../store/collapseToolUsesPrefStore'

const COLLAPSE_TOOL_USES_LABEL = 'Collapse assistant tool uses'

export function CollapseToolUsesRowView({ enabled, onToggle }: {
  enabled: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="settings__notifications-row">
      <div className="settings__notifications-row-text">
        <p className="settings__notifications-row-label">{COLLAPSE_TOOL_USES_LABEL}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={COLLAPSE_TOOL_USES_LABEL}
        className={enabled ? 'settings__switch settings__switch--on' : 'settings__switch'}
        onClick={() => onToggle(!enabled)}
      >
        <span className="settings__switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}

export function CollapseToolUsesRowControl(): JSX.Element {
  const enabled = useCollapseToolUsesPrefStore(selectCollapseToolUses)
  return <CollapseToolUsesRowView enabled={enabled}
    onToggle={(next) => collapseToolUsesPrefStore.getState().setCollapseToolUses(next)} />
}
