import {
  usePushNotificationPrefStore,
  selectPushNotificationsEnabled,
  pushNotificationPrefStore
} from '../../store/pushNotificationPrefStore'

// #409: the single row of the Settings "Notifications" section (Figma 17:64). It renders the client-owned
// push-notification preference (#408) as an on/off switch and, on toggle, writes the negated value back
// through the store setter. Renderer-only: no wire types, no daemon command (a UX boolean is not a secret);
// this slice adds no data path — it reads selectPushNotificationsEnabled and writes
// setPushNotificationsEnabled on the existing #408 store.
//
// Two exports mirror the ServerRow/ArchivedCountRow two-part idiom (plus one callback prop the
// ArchivedCountRow lacks): the pure view (the tested seam) and the store-bound Control. No useState, no
// picker sheet (unlike DefaultWorkspaceRow) — this row is a pure read + one interaction-time write.

// Client-owned copy — a module-level constant (the SERVER_ROW_LABEL / DEFAULT_WORKSPACE_ROW_LABEL idiom),
// never a daemon string. Figma-verbatim (17:66): lowercase "claude", apostrophe-free so renderToStaticMarkup
// leaves it untouched (the standing desktop lesson).
const PUSH_TOGGLE_LABEL = 'Push notifications when claude responds'

/**
 * The pure, exported, props-in/markup-out view (the ServerRow/ArchivedCountRow tested seam) — the storage-row
 * layout with a leading text column (the label) and a trailing M3 switch.
 *
 * The switch is a native <button type="button" role="switch"> (Figma 17:67 track / 17:68 knob, drawn in the
 * on-position): a native button is focusable and activates its onClick on BOTH Space and Enter with no
 * onKeyDown handler — this is what satisfies the keyboard AC, unlike the run-config <span role="switch"> that
 * click-fires only. `aria-checked={enabled}` reflects the preference honestly. `role="switch"` computes its
 * accessible name from author, not contents, and the switch is a sibling of the label <p> (not its parent),
 * so an explicit `aria-label` set to the same copy constant ties the accessible name to the visible label
 * (AC4). The knob is a decorative, aria-hidden child; `settings__switch--on` shifts it to the on-position.
 */
export function PushNotificationRowView({
  enabled,
  onToggle
}: {
  enabled: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="settings__notifications-row">
      <div className="settings__notifications-row-text">
        <p className="settings__notifications-row-label">{PUSH_TOGGLE_LABEL}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={PUSH_TOGGLE_LABEL}
        className={enabled ? 'settings__switch settings__switch--on' : 'settings__switch'}
        onClick={() => onToggle(!enabled)}
      >
        <span className="settings__switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * The store-bound container (the ArchivedCountRowControl posture) — reads the current preference via the
 * store's own selector and hands the boolean to the pure view. No effects, no useState, no window deref, no
 * IPC: a pure read plus one interaction-time write. The setter is dereferenced inside the onToggle callback
 * only (never at render), and the write goes through the setter (not a two-way binding), so unidirectional
 * state is preserved — the DefaultWorkspaceRow onChoose discipline.
 */
export function PushNotificationRowControl(): JSX.Element {
  const enabled = usePushNotificationPrefStore(selectPushNotificationsEnabled)
  return (
    <PushNotificationRowView
      enabled={enabled}
      onToggle={(next) => pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)}
    />
  )
}
