import { describe, it, expect, vi } from 'vitest'
import { onCommand, type CommandSource } from './receiveCommand'
import { COMMAND_CHANNEL, sendMessageCommand } from '../shared/ipc/commands'

// A structural stand-in for Electron's ipcMain: only on/removeListener, spied. No Electron
// harness needed — the receiver is typed against the minimal source, not ipcMain.
function fakeSource(): CommandSource & {
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
} {
  return { on: vi.fn(), removeListener: vi.fn() }
}

describe('onCommand', () => {
  it('registers exactly one listener on the command channel', () => {
    const source = fakeSource()

    onCommand(source, vi.fn())

    expect(source.on).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(source.on).toHaveBeenCalledWith(COMMAND_CHANNEL, expect.any(Function))
  })

  it('forwards only the validated command, stripping the IpcMainEvent', () => {
    const source = fakeSource()
    const handler = vi.fn()
    onCommand(source, handler)
    const listener = source.on.mock.calls[0][1]

    const command = sendMessageCommand({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    const fakeEvent = { sender: 'must-not-be-forwarded' }
    listener(fakeEvent, command)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(command)
    expect(handler.mock.calls[0]).toHaveLength(1) // event stripped, command only
  })

  it('drops a malformed command without calling the handler', () => {
    const source = fakeSource()
    const handler = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onCommand(source, handler)
    const listener = source.on.mock.calls[0][1]

    listener({}, { type: 'connect', payload: {} })

    expect(handler).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('unsubscribes the exact listener it registered', () => {
    const source = fakeSource()

    const unsubscribe = onCommand(source, vi.fn())
    const listener = source.on.mock.calls[0][1]
    unsubscribe()

    expect(source.removeListener).toHaveBeenCalledTimes(1)
    expect(source.removeListener).toHaveBeenCalledWith(COMMAND_CHANNEL, listener)
  })
})
