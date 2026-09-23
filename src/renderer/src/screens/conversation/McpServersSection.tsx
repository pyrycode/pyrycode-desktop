import { useEffect, useId, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import {
  mcpStatusStore,
  selectMcpReconnectRefusedFor,
  selectMcpReconnectingFor,
  selectMcpStatusFor,
  selectMcpStatusUnavailableFor,
  selectMcpToggleRefusedFor,
  selectMcpTogglingFor,
  useMcpStatusStore,
  type McpStatusReport
} from '../../store/mcpStatusStore'

// The daemon's own servers, registered on every non-bypass spawn. Client-owned constants: a claude-authored
// `name` is compared against them for display filtering only, never for any behaviour.
const MCP_BUILT_IN_SERVER_NAMES: readonly string[] = ['pyry_approve', 'pyry_files']
const DISPLAY_BOUND = 256
// Client-owned: the refusal carries only a reason literal, so no daemon text can reach this line.
const MCP_STATUS_UNAVAILABLE = 'The daemon could not report MCP status right now.'
// Client-owned: every refusal is one merged outcome (not authorized, unknown server, no live child, failed
// actuation), and the event carries no cause or daemon text, so this line names none.
const MCP_RECONNECT_REFUSED = 'The daemon refused to reconnect the MCP server.'
// Client-owned, for the same reasons: the toggle refusal is one merged outcome and names no cause.
const MCP_TOGGLE_REFUSED = 'The daemon refused to change the MCP server.'

/** Ask once, on the sheet opening; main owns routing and diagnostics, and the store bridge receives the
 *  answer or the refusal. No retry: the next open asks again. */
export function requestMcpStatus(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestMcpStatus', payload: { conversation_id: conversationId } })
}

/** One press: begin the wait, then send one reconnect. `serverName` is the row's untrusted claude text and
 *  crosses unchanged, which is the daemon's contract; it is never a key, an attribute or a log field. */
export function reconnectMcpServer(
  sendCommand: (command: RendererCommand) => void,
  beginWait: (conversationId: string) => void,
  conversationId: string,
  serverName: string
): void {
  beginWait(conversationId)
  sendCommand({ type: 'reconnectMcpServer', payload: { conversation_id: conversationId, server_name: serverName } })
}

/** One flip: begin the wait, then send one toggle to the opposite of the shown state. `serverName` crosses
 *  unchanged under the same rules as a reconnect's. */
export function toggleMcpServer(
  sendCommand: (command: RendererCommand) => void,
  beginWait: (conversationId: string) => void,
  conversationId: string,
  serverName: string,
  enabled: boolean
): void {
  beginWait(conversationId)
  sendCommand({ type: 'toggleMcpServer', payload: { conversation_id: conversationId, server_name: serverName, enabled } })
}

// Bound in code points so a surrogate pair is never split; `…` marks a display cut.
function bounded(text: string): string {
  const characters = Array.from(text)
  return characters.length > DISPLAY_BOUND ? `${characters.slice(0, DISPLAY_BOUND).join('')}…` : text
}

// `status` is claude's open-set word. Only the exact words pick a tone; the class comes from this closed
// set, never from the word itself, and the word is shown verbatim beside the dot.
function toneOf(status: string): 'connected' | 'failed' | 'other' {
  if (status === 'connected') return 'connected'
  if (status === 'failed') return 'failed'
  return 'other'
}

// A server is off exactly when claude reports `disabled`, its word for a server turned off; any other word is
// on. The switch reads only this, never a requested state, so it cannot show a state the daemon never entered.
function isOn(status: string): boolean {
  return status !== 'disabled'
}

/**
 * The MCP servers section of the Channel info sheet: a pure function of the held report (or its absence),
 * the unavailable mark, the reconnect and toggle wait and refusal marks, and the Show built-in state. The marks only append
 * notices; held rows stay. Every row string is untrusted claude text rendered as React children only;
 * rows are keyed by position because a `name` is never a key.
 */
export function McpServersSectionView({
  report,
  showBuiltIn,
  unavailable,
  reconnecting,
  reconnectRefused,
  toggling,
  toggleRefused,
  onShowBuiltInChange,
  onReconnect,
  onToggle
}: {
  report: McpStatusReport | null
  showBuiltIn: boolean
  unavailable: boolean
  reconnecting: boolean
  reconnectRefused: boolean
  toggling: boolean
  toggleRefused: boolean
  onShowBuiltInChange: (next: boolean) => void
  onReconnect: (serverName: string) => void
  onToggle: (serverName: string, enabled: boolean) => void
}): JSX.Element {
  // Row ids come from React and the row position, never the name, so the name stays out of every attribute.
  const idBase = useId()
  // One outstanding actuation of either kind disables every control in the section.
  const busy = reconnecting || toggling
  const notice = (
    <>
      {unavailable && <p className="channel-info__empty">{MCP_STATUS_UNAVAILABLE}</p>}
      {reconnectRefused && <p className="channel-info__empty">{MCP_RECONNECT_REFUSED}</p>}
      {toggleRefused && <p className="channel-info__empty">{MCP_TOGGLE_REFUSED}</p>}
    </>
  )
  if (report === null) {
    return (
      <>
        <p className="status-sheet__section-header">MCP servers</p>
        <p className="channel-info__empty">No MCP report has arrived yet.</p>
        {notice}
      </>
    )
  }
  const shown = showBuiltIn
    ? report.servers
    : report.servers.filter((server) => !MCP_BUILT_IN_SERVER_NAMES.includes(server.name))
  return (
    <>
      <p className="status-sheet__section-header">MCP servers</p>
      <label className="channel-info__row">
        <span className="channel-info__row-label">Show built-in</span>
        <input
          type="checkbox"
          className="channel-info__mcp-toggle"
          checked={showBuiltIn}
          onChange={(event) => onShowBuiltInChange(event.target.checked)}
        />
      </label>
      {shown.map((server, index) => (
        <div className="channel-info__mcp-server" key={index}>
          <div className="channel-info__row">
            <span className="channel-info__row-label channel-info__mcp-name" id={`${idBase}-mcp-name-${index}`}>
              {bounded(server.name)}
            </span>
            <span className="channel-info__row-value channel-info__mcp-status">
              <span className={`mcp-server-dot mcp-server-dot--${toneOf(server.status)}`} aria-hidden="true" />
              <span>{bounded(server.status)}</span>
              {/* The tone's split: anything but exactly `connected` offers the control. While one reconnect
                  is outstanding every control in this section is disabled, so a press cannot send twice. */}
              {toneOf(server.status) !== 'connected' && (
                <button
                  type="button"
                  className="button-small channel-info__mcp-reconnect"
                  disabled={busy}
                  onClick={() => onReconnect(server.name)}
                >
                  Reconnect
                </button>
              )}
              {/* Every row, a working server included. The accessible name is the rendered name, by reference. */}
              <button
                type="button"
                role="switch"
                aria-checked={isOn(server.status)}
                aria-labelledby={`${idBase}-mcp-name-${index}`}
                className={isOn(server.status) ? 'channel-info__mcp-switch channel-info__mcp-switch--on' : 'channel-info__mcp-switch'}
                disabled={busy}
                onClick={() => onToggle(server.name, !isOn(server.status))}
              >
                <span className="channel-info__mcp-switch-knob" aria-hidden="true" />
              </button>
            </span>
          </div>
          {server.error !== '' && <p className="channel-info__mcp-error">{bounded(server.error)}</p>}
        </div>
      ))}
      {shown.length === 0 && (
        <p className="channel-info__empty">
          {report.servers.length === 0 ? 'Claude reported no MCP servers.' : 'Only built-in servers are reported.'}
        </p>
      )}
      {report.droppedServers > 0 && (
        <p className="channel-info__empty">
          {`Partial list: ${report.droppedServers} more servers were left out by the daemon.`}
        </p>
      )}
      {notice}
    </>
  )
}

/** Store-bound container; Show built-in is UI-local and off each time the sheet opens. The sheet unmounts
 *  this on close, so the cleanup ends an outstanding reconnect or toggle wait: a daemon that never answers (or a send
 *  main dropped as inert) cannot leave the control stuck past a reopen. */
export function McpServersSection({ conversationId }: { conversationId: string }): JSX.Element {
  const report = useMcpStatusStore(selectMcpStatusFor(conversationId))
  const unavailable = useMcpStatusStore(selectMcpStatusUnavailableFor(conversationId))
  const reconnecting = useMcpStatusStore(selectMcpReconnectingFor(conversationId))
  const reconnectRefused = useMcpStatusStore(selectMcpReconnectRefusedFor(conversationId))
  const toggling = useMcpStatusStore(selectMcpTogglingFor(conversationId))
  const toggleRefused = useMcpStatusStore(selectMcpToggleRefusedFor(conversationId))
  const [showBuiltIn, setShowBuiltIn] = useState(false)
  useEffect(() => () => {
    mcpStatusStore.getState().endMcpReconnectWait(conversationId)
    mcpStatusStore.getState().endMcpToggleWait(conversationId)
  }, [conversationId])
  return (
    <McpServersSectionView
      report={report}
      showBuiltIn={showBuiltIn}
      unavailable={unavailable}
      reconnecting={reconnecting}
      reconnectRefused={reconnectRefused}
      toggling={toggling}
      toggleRefused={toggleRefused}
      onShowBuiltInChange={setShowBuiltIn}
      onReconnect={(serverName) => reconnectMcpServer(
        window.pyry.sendCommand,
        mcpStatusStore.getState().beginMcpReconnect,
        conversationId,
        serverName
      )}
      onToggle={(serverName, enabled) => toggleMcpServer(
        window.pyry.sendCommand,
        mcpStatusStore.getState().beginMcpToggle,
        conversationId,
        serverName,
        enabled
      )}
    />
  )
}
