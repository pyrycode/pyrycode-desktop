import './settings.css'

// Client-owned copy — module-level constants (the EMPTY_THREAD_COPY idiom), never daemon strings. The
// scaffold renders no untrusted text, so there is no injection sink: this is why the slice is not
// security-sensitive.
const SETTINGS_COPY = {
  title: 'Settings',
  back: 'Back',
  connection: 'Connection'
} as const

/**
 * The Settings screen scaffold (#333) — the paired shell's `settings` view (Figma 17-2, chrome + the
 * Connection section header only). A pure, exported, server-renderable view: no store read, no effects,
 * no window.pyry — the scaffold carries no data. #334 mounts the store-bound Server row into the empty
 * `.settings__section-body`; the preference sections (Appearance/Defaults/…) are #151/#152.
 *
 * `onBack` is REQUIRED chrome — a Settings screen always has a back affordance, unlike ConversationScreen's
 * optional-gated BackControl. PairedShellView binds it to the shared `back` dispatch, which returns to the
 * channel-home `list` view (the absolute `back` arm — no stack-aware back needed, AC3).
 */
export function SettingsScreen({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <section className="settings" aria-label="Settings screen">
      <div className="settings__topbar">
        <BackControl onBack={onBack} />
        <h1 className="settings__title">{SETTINGS_COPY.title}</h1>
      </div>
      <div className="settings__body">
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.connection}</h2>
          {/* #334's mount point: the store-bound Server row (Figma 17:12) becomes this container's
              child. Empty in this slice — the scaffold ships the section, not its content. */}
          <div className="settings__section-body" />
        </section>
      </div>
    </section>
  )
}

// The leading back affordance of the Settings top bar (Figma 17:4 → arrow_back 17:5). Reuses
// ConversationScreen's BackControl shape/glyph (a 48px frame holding the 24px arrow_back), but is
// unconditional — the Settings screen always renders it, so onBack is required, not optional-gated.
// Icon-only, so aria-label supplies the accessible name (the .composer__send pattern); the SVG is
// aria-hidden.
function BackControl({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <button type="button" className="settings__back" aria-label={SETTINGS_COPY.back} onClick={onBack}>
      <svg
        className="settings__back-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
      </svg>
    </button>
  )
}
