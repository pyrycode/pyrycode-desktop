import type { RendererCommand } from '../shared/ipc/commands'
import type { DaemonConnection } from './daemonConnection'
import { bindServerOrigin, emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'

/** Validated IPC commands address a named host; unavailable routes still settle the caller. */
export function dispatchThreadQuery(command: Extract<RendererCommand, { type: 'queryThread' }>,
  route: (serverId: string) => Pick<DaemonConnection, 'queryThread'> | null, sink: DaemonEventSink): void {
  const connection = route(command.serverId)
  if (connection === null) {
    emitDaemonEvent(bindServerOrigin(sink, command.serverId), { type: 'threadQueryFailed',
      requestId: command.requestId, conversationId: command.query.payload.conversation_id,
      inReplyTo: 0, reason: 'unavailable' })
  } else connection.queryThread(command.query, command.requestId)
}
