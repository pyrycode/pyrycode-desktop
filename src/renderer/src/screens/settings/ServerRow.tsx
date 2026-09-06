import {
  useServerInfoStore,
  selectServers,
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
 * One Server row per paired server (#1148) — the pure, exported, props-in/markup-out list view. Renders
 * a fragment, so each row is a direct child of `.settings__section-body`: that is already a plain flex
 * column and each row carries its own padding, so N rows stack with settings.css untouched, and no
 * separator or spacing rule is added. The "Server" label repeats per row rather than being hoisted into
 * a section header, and the trailing chevron (Figma 17:16) stays omitted on every row.
 *
 * An EMPTY list renders exactly one `ServerRow` with a null value — the existing "not yet loaded"
 * placeholder, byte for byte. Nothing paired, nothing fetched yet and an unreadable collection all
 * arrive here as `[]` and share that rendering: no blank section, no empty row, and no distinct
 * "no servers" copy string.
 *
 * The loop lives on this EXPORTED VIEW rather than inside ServerRowControl because the container's
 * populated branch is unreachable under renderToStaticMarkup (zustand v5 reads getInitialState()), and
 * `e2e/` covers this row in neither tier — so on the container its only detector would be a vi.mock of
 * the store module, the ceremony ServerRow.test.tsx already declined in favour of injected props. Here
 * a two-entry injection is an ordinary server render.
 *
 * Keyed by `serverId`: unique by store construction (a repeated `server` id makes the whole collection
 * raise MalformedPairedServerRecordError, which collapses to the absent outcome before it reaches the
 * renderer) and stable across refetches, which index keys are not. A React key is a reconciliation
 * identity and never reaches the DOM, so this is not one of the attribute / URL / lookup-path sinks the
 * daemon-text rule closes.
 */
export function ServerRows({ servers }: { servers: ServerInfoValue[] }): JSX.Element {
  if (servers.length === 0) return <ServerRow serverInfo={null} />

  return (
    <>
      {servers.map((server) => (
        <ServerRow key={server.serverId} serverInfo={server} />
      ))}
    </>
  )
}

/**
 * The store-bound container (the ConnectionStatusIndicatorControl posture) — reads the `servers` slice
 * via the store's own selector and hands it to the pure list view. No effects, no window.pyry, no IPC:
 * a pure read, so the narrow slice re-renders the rows only when the loader resolves. The one-shot fetch
 * is owned by ServerInfoData (#340), mounted alongside this control in SettingsScreen.
 */
export function ServerRowControl(): JSX.Element {
  const servers = useServerInfoStore(selectServers)
  return <ServerRows servers={servers} />
}
