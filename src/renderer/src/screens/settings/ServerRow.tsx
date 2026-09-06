import { useState } from 'react'
import {
  serverInfoStore,
  useServerInfoStore,
  selectServers,
  type ServerInfoValue
} from '../../store/serverInfoStore'
import { loadServerInfo } from '../../store/serverInfoLoader'
import { runUnpairServer } from './unpairServerAction'

// Client-owned copy — module-level constants (the SETTINGS_COPY idiom), never daemon strings. The
// placeholder is apostrophe-free (renderToStaticMarkup escapes '), U+2026 ellipsis (the 'Thinking…'
// idiom). It is a purposeful "not yet loaded" line, not an empty string — Settings mounts paired-only,
// so `null` is a momentary window that resolves within a tick, never a persistent "no server" state.
const SERVER_ROW_LABEL = 'Server'
const SERVER_ROW_LOADING = 'Loading…'

// #1162's unpair copy, same idiom: client-owned constants, apostrophe-free, U+2026 ellipsis. The
// prompt says "this server" rather than naming one — the serverId is daemon-authored text and may be
// rendered escaped as its own line, but never interpolated into copy the app speaks in its own voice
// (CLAUDE.md's operator ruling, 2026-08-20).
const UNPAIR_COPY = {
  unpair: 'Unpair',
  prompt: 'Forget this server?',
  cancel: 'Cancel',
  confirm: 'Confirm',
  busy: 'Forgetting…'
} as const

/**
 * The confirm state of the WHOLE list, held as one value rather than one per row (#1162).
 *
 * That is the structural half of "arming one row must leave every other row un-armed": with a single
 * armed id there is no second slot for a second armed row to live in, so the invariant is
 * unrepresentable-by-construction rather than maintained by a reset. Arming row B simply replaces the
 * value, and the row that was armed goes back to idle with nothing to clean up.
 */
export type UnpairPhase =
  | { kind: 'idle' }
  | { kind: 'confirming'; serverId: string }
  | { kind: 'unpairing'; serverId: string }

/**
 * One ROW's view of the action: its own flattened phase plus the three callbacks. Flattened here
 * because a row does not need to know which OTHER row is armed — `ServerRows` resolves the list-level
 * `UnpairPhase` against each row's id and hands down 'idle' to everyone else.
 *
 * `onArm` and `onConfirm` take the row's OWN serverId rather than the container reading it back out
 * of the phase. That is the second, different-fabric half of the ticket's constraint: the erase names
 * the row that rendered the button the operator clicked, so even if the armed id and the rendered row
 * ever disagreed, a second row's Unpair could not fire the first row's confirmed erase.
 *
 * Required, not optional, following PairedShellView's `paneKey` rule — forgetting to wire the action
 * is the exact regression the prop exists to prevent, so it is a compile error rather than a silent
 * `undefined` that would render a Settings screen with no way to forget anything.
 */
export interface ServerRowUnpair {
  phase: 'idle' | 'confirming' | 'unpairing'
  onArm: (serverId: string) => void
  onCancel: () => void
  onConfirm: (serverId: string) => void
}

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
 *
 * #1162 adds the trailing unpair action, as a SIBLING of the text column so the row's own flex
 * geometry places it (the column is `flex: 1 1 auto`, so the action lands at the trailing edge with
 * no new layout rule). It renders in the POPULATED branch only — the not-yet-loaded row has no
 * serverId to name and so nothing to erase. The root element's class is untouched: several existing
 * assertions count whole `class="settings__server-row"` attribute runs, which a second class on the
 * same element would silently defeat.
 */
export function ServerRow({
  serverInfo,
  unpair
}: {
  serverInfo: ServerInfoValue | null
  unpair: ServerRowUnpair
}): JSX.Element {
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
      {serverInfo === null ? null : (
        <UnpairAction serverId={serverInfo.serverId} unpair={unpair} />
      )}
    </div>
  )
}

/**
 * The row's trailing unpair affordance (#1162) — an inline, non-exported control mirroring
 * SettingsScreen's BackControl / PairAnotherServerRow posture. Pure: it renders the phase it is
 * given and reports intents; it owns no state and performs no effect.
 *
 * The two-phase shape is #166's `UnpairControl`, preserved verbatim through its deletion at #1061:
 * idle offers the verb, confirming asks and offers both answers, unpairing disables both so a
 * double-click cannot launch a second erase (belt-and-suspenders — `clearServer` is idempotent
 * regardless). What changed is only that the phase now arrives as a prop, because with N rows the
 * confirm is per row and one owner must arbitrate.
 *
 * Every button's TEXT is its accessible name; none carries an aria-label. Naming the server in one
 * would put daemon-authored text (`serverId` came off a pairing payload) into an attribute, which
 * CLAUDE.md forbids outright. So the labels repeat across rows and the rendered id line above is what
 * tells them apart — e2e addresses rows by position over the store's pinned order (oldest-paired
 * first) rather than by an accessible name.
 */
function UnpairAction({
  serverId,
  unpair
}: {
  serverId: string
  unpair: ServerRowUnpair
}): JSX.Element {
  if (unpair.phase === 'idle') {
    return (
      <div className="settings__server-row-unpair">
        <button
          type="button"
          className="settings__server-unpair"
          onClick={() => unpair.onArm(serverId)}
        >
          {UNPAIR_COPY.unpair}
        </button>
      </div>
    )
  }

  const busy = unpair.phase === 'unpairing'
  return (
    <div className="settings__server-row-unpair">
      <span className="settings__server-unpair-prompt">{UNPAIR_COPY.prompt}</span>
      <button
        type="button"
        className="settings__server-unpair"
        onClick={unpair.onCancel}
        disabled={busy}
      >
        {UNPAIR_COPY.cancel}
      </button>
      <button
        type="button"
        className="settings__server-unpair settings__server-unpair--confirm"
        onClick={() => unpair.onConfirm(serverId)}
        disabled={busy}
      >
        {busy ? UNPAIR_COPY.busy : UNPAIR_COPY.confirm}
      </button>
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
export function ServerRows({
  servers,
  unpair
}: {
  servers: ServerInfoValue[]
  unpair: { phase: UnpairPhase } & Omit<ServerRowUnpair, 'phase'>
}): JSX.Element {
  if (servers.length === 0) {
    return <ServerRow serverInfo={null} unpair={{ ...unpair, phase: 'idle' }} />
  }

  return (
    <>
      {servers.map((server) => (
        <ServerRow
          key={server.serverId}
          serverInfo={server}
          unpair={{ ...unpair, phase: rowPhase(unpair.phase, server.serverId) }}
        />
      ))}
    </>
  )
}

/**
 * Resolve the list-level phase against ONE row's id (#1162). `===` on the full id, never a prefix or
 * an `includes`: the e2e fixture's two ids are `fake-daemon` and `fake-daemon-2`, so a loose match
 * would arm both rows on one click. An armed id that names no rendered row resolves to 'idle'
 * everywhere, which keeps this total against a list that changed under the phase.
 */
function rowPhase(phase: UnpairPhase, serverId: string): ServerRowUnpair['phase'] {
  return phase.kind !== 'idle' && phase.serverId === serverId ? phase.kind : 'idle'
}

/**
 * The store-bound container (the ConnectionStatusIndicatorControl posture) — reads the `servers` slice
 * via the store's own selector and hands it to the pure list view. A pure read, so the narrow slice
 * re-renders the rows only when the loader resolves. The one-shot MOUNT fetch is owned by
 * ServerInfoData (#340), mounted alongside this control in SettingsScreen.
 *
 * #1162 gives it the confirm-phase state and the click-time wiring. It is still server-renderable:
 * the only state is a `useState` (ADR 0006 — screen-local, resets on unmount, so leaving and
 * re-entering Settings lands every row un-armed), and `window.pyry` is dereferenced INSIDE the
 * handler, never during render, exactly as the deleted UnpairControl and Composer.handleSubmit do.
 *
 * `onLastServerUnpaired` is threaded in rather than reached for: the route flip is a prop App hands
 * the shell, and there is no store path that shortcuts ServerRow → SettingsScreen → PairedShell.
 */
export function ServerRowControl({
  onLastServerUnpaired
}: {
  onLastServerUnpaired: () => void
}): JSX.Element {
  const servers = useServerInfoStore(selectServers)
  const [phase, setPhase] = useState<UnpairPhase>({ kind: 'idle' })

  const handleConfirm = (serverId: string): void => {
    setPhase({ kind: 'unpairing', serverId })
    void runUnpairServer(
      {
        unpairServer: window.pyry.unpairServer,
        // The SAME loader the mount fetch uses, so the refreshed rows and the "do any records
        // remain?" decision come from one read and cannot disagree. It resolves to the list it wrote.
        refreshServers: () =>
          loadServerInfo(window.pyry.serverInfo, serverInfoStore.getState().setServers),
        onLastServerUnpaired
      },
      serverId
    ).then(() => {
      // On the last-server path the route flips and this whole shell unmounts, so a setState after
      // unmount is a harmless React 18 no-op — the deleted UnpairControl's own posture. Otherwise the
      // list has just been refreshed: on success the armed row is gone with it, and on failure the row
      // is still there and returns to idle, un-armed, with the action as its own retry. The failure is
      // deliberately not escalated further — see runUnpairServer's header for why a per-server erase
      // must not reach the app-wide session store.
      setPhase({ kind: 'idle' })
    })
  }

  return (
    <ServerRows
      servers={servers}
      unpair={{
        phase,
        onArm: (serverId) => setPhase({ kind: 'confirming', serverId }),
        onCancel: () => setPhase({ kind: 'idle' }),
        onConfirm: handleConfirm
      }}
    />
  )
}
