import {
  useServerInfoStore,
  selectServerInfo,
  type ServerInfoValue
} from '../../store/serverInfoStore'

// Client-owned copy — module-level constants (the SETTINGS_COPY idiom), never daemon strings. The
// placeholder is apostrophe-free (renderToStaticMarkup escapes '), U+2026 ellipsis (the 'Thinking…'
// idiom). It is a purposeful "not yet loaded" line, not an empty string — Settings mounts paired-only,
// so `null` is a momentary window that resolves within a tick, never a persistent "no server" state.
const SERVER_ROW_LABEL = 'Server'
const SERVER_ROW_LOADING = 'Loading…'

/**
 * The Connection section's Server row (Figma 17:12) — the pure, exported, props-in/markup-out view. The
 * ConnectionStatusIndicator precedent (#330): a dumb view whose populated/null matrix is proven by
 * directly server-rendering it with injected props, kept separate from the store-bound container so
 * SettingsScreen stays server-renderable.
 *
 * Always renders the "Server" label. When `serverInfo` is present, renders `serverId` as the primary
 * identity line and `relayUrl` as a secondary line beneath it (both auto-escaped React children — never
 * dangerouslySetInnerHTML); when `null`, renders a single loading placeholder in place of the values (no
 * blank <p>). The empty two-dot host slot (Figma 90:4) renders in BOTH states — a class-labelled mount
 * target for #330's future indicator, carrying NO aria-label="Connection status" (that is #330's marker;
 * rendering it here would collide — AC4). The mobile row's trailing chevron (17:16) is omitted — desktop
 * has no server-detail screen for it to navigate to.
 */
export function ServerRow({ serverInfo }: { serverInfo: ServerInfoValue | null }): JSX.Element {
  return (
    <div className="settings__server-row">
      <div className="settings__server-row-text">
        <p className="settings__server-row-label">{SERVER_ROW_LABEL}</p>
        {serverInfo === null ? (
          <p className="settings__server-row-id">{SERVER_ROW_LOADING}</p>
        ) : (
          <>
            <p className="settings__server-row-id">{serverInfo.serverId}</p>
            <p className="settings__server-row-relay">{serverInfo.relayUrl}</p>
          </>
        )}
        <div className="settings__server-status-slot" />
      </div>
    </div>
  )
}

/**
 * The store-bound container (the ConnectionStatusIndicatorControl posture) — reads the single
 * `serverInfo` slice via the store's own selector and hands it to the pure view. No effects, no
 * window.pyry, no IPC: a pure read, so the narrow slice re-renders the row only when the loader resolves.
 * The one-shot fetch is owned by ServerInfoData (#340), mounted alongside this control in SettingsScreen.
 */
export function ServerRowControl(): JSX.Element {
  const serverInfo = useServerInfoStore(selectServerInfo)
  return <ServerRow serverInfo={serverInfo} />
}
