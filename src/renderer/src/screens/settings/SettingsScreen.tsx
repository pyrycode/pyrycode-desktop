import './settings.css'
import { ServerInfoData } from '../../store/serverInfoLoader'
import { ServerRowControl } from './ServerRow'
import { DefaultWorkspaceRowControl } from './DefaultWorkspaceRow'
import { PushNotificationRowControl } from './PushNotificationRow'
import { ArchivedCountRowControl } from './ArchivedCountRow'

// Client-owned copy — module-level constants (the EMPTY_THREAD_COPY idiom), never daemon strings. The
// scaffold renders no untrusted text, so there is no injection sink: this is why the slice is not
// security-sensitive.
const SETTINGS_COPY = {
  title: 'Settings',
  back: 'Back',
  connection: 'Connection',
  defaults: 'Defaults for new conversations',
  notifications: 'Notifications',
  storage: 'Storage',
  about: 'About',
  pairAnother: 'Pair another server'
} as const

// The running build's version line (#350, Figma 17-108). __APP_VERSION__ is the compile-time constant
// substituted by the Vite `define` in both build configs, fed from package.json's `version` — a static,
// client-owned, non-secret string known at build time, so it needs no main→renderer bridge (the opposite
// of the daemon-sourced serverInfo row above). The Figma's "build a8f3c2d" sub-line (17-109) is out of
// scope — desktop has no wired build-metadata source yet.
const VERSION_LINE = `Version ${__APP_VERSION__}`

/**
 * The Settings screen (#333 scaffold + #334 Server row) — the paired shell's `settings` view (Figma
 * 17-2, chrome + the Connection section). A thin composition point, still server-renderable: it takes an
 * `onBack` callback and mounts the store-bound Server row into the Connection section-body. The remaining
 * preference sections (Appearance/Defaults/…) are #151/#152.
 *
 * `onBack` is REQUIRED chrome — a Settings screen always has a back affordance, unlike ConversationScreen's
 * optional-gated BackControl. PairedShellView binds it to the shared `back` dispatch, which returns to the
 * channel-home `list` view (the absolute `back` arm — no stack-aware back needed, AC3).
 *
 * `onPairAnother` (#152) is the also-required Connection-section entry that re-opens the pairing flow to
 * switch daemons. PairedShellView binds it to the `openPairServer` dispatch; the pairing screen's own
 * confirm/cancel drive the two exits, so this screen only fires the forward-nav intent.
 *
 * `onUnpaired` (#1162) is the third, and it fires on strictly fewer occasions than its name suggests:
 * the per-server Unpair action forgets one server on its own, and only when the erase leaves NO record
 * behind does it reach this callback — the app's pairing has then genuinely ended, so PairedShellView
 * hands down the same `onUnpaired` the conversation screen gets, already bound to the shell's
 * `applyPairingChange(deps, 'unpaired')` clear-then-navigate. Required for the same reason
 * `onPairAnother` is: a Settings screen that cannot forget a server is the regression the prop exists
 * to prevent.
 */
export function SettingsScreen({
  onBack,
  onPairAnother,
  onUnpaired
}: {
  onBack: () => void
  onPairAnother: () => void
  onUnpaired: () => void
}): JSX.Element {
  return (
    <section className="settings" aria-label="Settings screen">
      <div className="settings__topbar">
        <BackControl onBack={onBack} />
        <h1 className="settings__title">{SETTINGS_COPY.title}</h1>
      </div>
      <div className="settings__body">
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.connection}</h2>
          {/* #334: the store-bound Server row (Figma 17:12). ServerInfoData is the headless one-shot
              loader — mounting it here (not app-level) fires window.pyry.serverInfo() on Settings-open
              and writes the store; ServerRowControl reads that store and renders the row. DOM order is
              immaterial — the loader renders null. */}
          <div className="settings__section-body">
            <ServerInfoData />
            <ServerRowControl onLastServerUnpaired={onUnpaired} />
            {/* #152: the "Pair another server" nav row (Figma 17:18) — directly below the Server row.
                Re-opens the pairing flow to switch daemons; the trailing chevron marks it as a real
                forward-nav affordance (unlike the static Server/Storage rows, whose chevrons #334/#351
                omitted). onPairAnother dispatches the paired shell's openPairServer nav. */}
            <PairAnotherServerRow onActivate={onPairAnother} />
          </div>
        </section>
        {/* #404: the "Defaults for new conversations" section (Figma 17:37 header / 17:56 row) — sits
            between Connection and Storage to preserve the mobile design's relative vertical order (Defaults
            y=322 above Storage y=910), the same placement discipline #351 used for Storage. A single
            store-bound Default-workspace row; no loader to mount (the row reads the client-owned
            defaultWorkspaceStore #403 directly, and the picker mounts its own RecentWorkspacesData while
            open). The row is interactive — activating it opens the recent-workspaces picker (#383). */}
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.defaults}</h2>
          <div className="settings__section-body">
            <DefaultWorkspaceRowControl />
          </div>
        </section>
        {/* #409: the Notifications section (Figma 17:62 header / 17:64 row) — sits between Defaults and
            Storage to preserve the mobile design's relative vertical order (Notifications y=610 above Storage
            y=910), the same placement discipline #404/#351 used. A single store-bound push-toggle row; no
            loader to mount — the row reads and writes the client-owned pushNotificationPrefStore (#408)
            directly. The Figma section's second row "Notification sound" (17:69) is out of scope (no client-
            or daemon-side infrastructure). */}
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.notifications}</h2>
          <div className="settings__section-body">
            <PushNotificationRowControl />
          </div>
        </section>
        {/* #351: the Storage section (Figma 17-91…17-97) — sits between Connection and About to preserve
            the mobile design's relative vertical order (Storage y=910 above About y=1056). A single
            store-bound archived-count row; no loader to mount (unlike #334's ServerInfoData) — the
            conversation list is kept live app-level, so ArchivedCountRowControl is a pure store read. */}
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.storage}</h2>
          <div className="settings__section-body">
            <ArchivedCountRowControl />
          </div>
        </section>
        {/* #350: the About section (Figma 17-104…17-108) — same header treatment as Connection, with a
            single static version readout. No store, no loader, no null matrix: the value is a build-time
            constant, so this stays inline (a container/pure-view split would be over-engineering). */}
        <section className="settings__section">
          <h2 className="settings__section-header">{SETTINGS_COPY.about}</h2>
          <div className="settings__section-body">
            <div className="settings__about-row">
              <p className="settings__about-version">{VERSION_LINE}</p>
            </div>
          </div>
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

// The "Pair another server" Connection row (Figma 17:18) — an inline, non-exported control mirroring
// BackControl's inline-component + inline-SVG posture. It is a <button>, so its text ("Pair another
// server") IS the accessible name (no aria-label); the trailing chevron SVG is aria-hidden. The glyph is
// the Material chevron_right (viewBox 0 0 24 24 rendered at 20×20, currentColor), the mobile forward-nav
// affordance kept here because the row navigates (unlike the static #334 Server / #351 Storage rows).
function PairAnotherServerRow({ onActivate }: { onActivate: () => void }): JSX.Element {
  return (
    <button type="button" className="settings__pair-another-row" onClick={onActivate}>
      <span className="settings__pair-another-label">{SETTINGS_COPY.pairAnother}</span>
      <svg
        className="settings__pair-another-chevron"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
      </svg>
    </button>
  )
}
