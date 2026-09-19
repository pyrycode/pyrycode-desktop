import {
  RECONNECT_SERVER_CHANNEL,
  isReconnectServerRequest
} from '../shared/ipc/reconnectServer'
import type { ConnectionRegistry } from './connectionRegistry'
import type { DiagnosticLog } from './diagnosticLog'

export interface ReconnectServerHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) => Promise<void>): void
  removeHandler(channel: string): void
}

/** Trigger one held connection; progress continues through existing daemon events. */
export function registerReconnectServerHandler(
  target: ReconnectServerHandleTarget,
  deps: {
    registry: Pick<ConnectionRegistry, 'reconnect'>
    diagnosticLog: DiagnosticLog
  }
): () => void {
  const { registry, diagnosticLog } = deps
  const listener = async (_event: unknown, request: unknown): Promise<void> => {
    if (!isReconnectServerRequest(request)) {
      diagnosticLog.event({ event: 'reconnect-server-refused', code: 'malformed-request' })
      return
    }
    diagnosticLog.event({ event: 'reconnect-server-requested' })
    try {
      registry.reconnect(request.serverId)
    } catch {
      // Drop exception details at the IPC boundary; never echo the request or its id.
      diagnosticLog.event({ event: 'reconnect-server-failed', code: 'dispatch-failed' })
    }
  }
  target.handle(RECONNECT_SERVER_CHANNEL, listener)
  return () => target.removeHandler(RECONNECT_SERVER_CHANNEL)
}
