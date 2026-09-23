import { useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import {
  selectMcpStatusFor,
  selectMcpStatusUnavailableFor,
  useMcpStatusStore,
  type McpStatusReport
} from '../../store/mcpStatusStore'

// The daemon's own servers, registered on every non-bypass spawn. Client-owned constants: a claude-authored
// `name` is compared against them for display filtering only, never for any behaviour.
const MCP_BUILT_IN_SERVER_NAMES: readonly string[] = ['pyry_approve', 'pyry_files']
const DISPLAY_BOUND = 256
// Client-owned: the refusal carries only a reason literal, so no daemon text can reach this line.
const MCP_STATUS_UNAVAILABLE = 'The daemon could not report MCP status right now.'

/** Ask once, on the sheet opening; main owns routing and diagnostics, and the store bridge receives the
 *  answer or the refusal. No retry: the next open asks again. */
export function requestMcpStatus(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestMcpStatus', payload: { conversation_id: conversationId } })
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

/**
 * The MCP servers section of the Channel info sheet: a pure function of the held report (or its absence),
 * the unavailable mark and the Show built-in state. The mark only appends a notice; held rows stay. Every row string is untrusted claude text rendered as React children only;
 * rows are keyed by position because a `name` is never a key.
 */
export function McpServersSectionView({
  report,
  showBuiltIn,
  unavailable,
  onShowBuiltInChange
}: {
  report: McpStatusReport | null
  showBuiltIn: boolean
  unavailable: boolean
  onShowBuiltInChange: (next: boolean) => void
}): JSX.Element {
  const notice = unavailable && <p className="channel-info__empty">{MCP_STATUS_UNAVAILABLE}</p>
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
            <span className="channel-info__row-label channel-info__mcp-name">{bounded(server.name)}</span>
            <span className="channel-info__row-value channel-info__mcp-status">
              <span className={`mcp-server-dot mcp-server-dot--${toneOf(server.status)}`} aria-hidden="true" />
              <span>{bounded(server.status)}</span>
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

/** Store-bound container; Show built-in is UI-local and off each time the sheet opens. */
export function McpServersSection({ conversationId }: { conversationId: string }): JSX.Element {
  const report = useMcpStatusStore(selectMcpStatusFor(conversationId))
  const unavailable = useMcpStatusStore(selectMcpStatusUnavailableFor(conversationId))
  const [showBuiltIn, setShowBuiltIn] = useState(false)
  return (
    <McpServersSectionView
      report={report}
      showBuiltIn={showBuiltIn}
      unavailable={unavailable}
      onShowBuiltInChange={setShowBuiltIn}
    />
  )
}
