// The single, typed seam an incoming renderer command passes through on the main side. The
// composition root (#11/transport) will call this once with Electron's ipcMain and a handler
// that builds a send_message Envelope; nothing is wired here yet. Mirror image of
// emitDaemonEvent (#18): reverse direction (inbound ipcMain.on, not outbound webContents.send),
// and — because the renderer is UNTRUSTED — it validates every command at the boundary.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { COMMAND_CHANNEL, isRendererCommand, type RendererCommand } from '../shared/ipc/commands'

/**
 * The minimal main-process surface the receiver needs. Electron's `ipcMain` satisfies this
 * structurally (its on/removeListener accept a `(event, ...args)` listener); the unit test
 * passes a fake `{ on: vi.fn(), removeListener: vi.fn() }`, so no Electron harness is
 * required. `event`/`command` are typed `unknown` on purpose — the first arg is stripped,
 * the second is validated before use.
 */
export interface CommandSource {
  on(channel: string, listener: (event: unknown, command: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, command: unknown) => void): void
}

/**
 * Register the single inbound handler for renderer commands. Returns an unsubscribe handle
 * that removes the exact listener it added. Validates each incoming command at the
 * untrusted→trusted boundary: only shape-valid commands reach `handler`; malformed input is
 * dropped (logged once as a fixed string, never with renderer data). The IpcMainEvent first
 * arg (.sender/.reply/.senderFrame/.ports) is never forwarded — it would leak a capability.
 */
export function onCommand(
  source: CommandSource,
  handler: (command: RendererCommand) => void
): () => void {
  const listener = (_event: unknown, raw: unknown): void => {
    if (isRendererCommand(raw)) {
      handler(raw)
    } else {
      console.warn('pyry:command — dropped malformed command')
    }
  }
  source.on(COMMAND_CHANNEL, listener)
  return () => source.removeListener(COMMAND_CHANNEL, listener)
}
