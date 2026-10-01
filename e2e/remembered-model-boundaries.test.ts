import { describe, expect, it, vi } from 'vitest'
import { createRememberedModel } from '../src/renderer/src/store/rememberedModel'
import { createRunSettingsWriteStore, selectEffectiveSettings, type SettingsChange } from '../src/renderer/src/store/runSettingsWriteStore'
import { foldWriteEvent, submitSettingsChange, subscribeRunSettingsWrite } from '../src/renderer/src/store/runSettingsWriteBridge'
import { createDaemonConnection } from '../src/main/daemonConnection'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { NoiseRelayDriverConfig } from '../src/main/transport/noiseRelayDriver'
import type { DiagnosticEvent, DiagnosticLog } from '../src/main/diagnosticLog'
import type { StampedDaemonEvent } from '../src/shared/ipc/events'
import { MAX_PLAINTEXT_BYTES } from '../src/shared/wire/types'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function background(diagnosticLog: DiagnosticLog) {
  let config: NoiseRelayDriverConfig | undefined
  const send = vi.fn()
  const sink = { isDestroyed: () => false, send: vi.fn<(channel: string, event: StampedDaemonEvent) => void>(),
    webContents: { send: (channel: string, event: StampedDaemonEvent) => sink.send(channel, event) } }
  const connection = createDaemonConnection({
    serverId: 'srv-1', sink, diagnosticLog, deviceName: 'test', clientVersion: '0.1.0',
    deviceKeypair: { ensure: async () => ({ privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) }) },
    pairedServer: { load: async () => ({ server: 'srv-1', relay: 'wss://relay.example/v1/client',
      token: 'test', server_static_pubkey: Buffer.alloc(32).toString('base64') }), save: async () => {} },
    createDriver: next => { config = next; return { sendMessage: send, stop: () => {} } }
  })
  const handshake = () => config?.onEvent({ type: 'handshake-complete', helloAck: encodeEnvelope({
    id: 1, type: 'hello_ack', ts: '2026-10-01T00:00:00Z',
    payload: { protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn' }
  }) })
  return { connection, sink, send, handshake }
}

describe('remembered model — production background failure settlement', () => {
  it.each(['build', 'send'] as const)('silently releases recall after background %s failure', async failure => {
    const value = failure === 'build' ? 'private-model'.repeat(MAX_PLAINTEXT_BYTES) : 'private-model'
    const storage = { read: vi.fn(() => value), write: vi.fn() }
    const recall = createRememberedModel(storage)
    const writes = createRunSettingsWriteStore()
    const listeners = new Set<(event: StampedDaemonEvent) => void>()
    const onDaemonEvent = (listener: (event: StampedDaemonEvent) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    }
    const offWrites = subscribeRunSettingsWrite(onDaemonEvent, event => foldWriteEvent({
      getPending: () => writes.getState().pending, dispatch: writes.getState().dispatch,
      rememberEffort: vi.fn(), rememberModel: recall.remember
    }, event), () => 'srv-1')
    const records: DiagnosticEvent[] = []
    const log = { event: (event: DiagnosticEvent) => { records.push(event) } }
    const { connection, sink, send, handshake } = background(log)
    // Model the asynchronous IPC hop, so command return cannot masquerade as settlement.
    sink.send.mockImplementation((_channel: string, event: StampedDaemonEvent) => {
      queueMicrotask(() => { for (const listener of listeners) listener(event) })
    })
    connection.start(); await tick()
    handshake(); await tick()
    if (failure === 'send') send.mockImplementationOnce(() => { throw Error('private-exception') })
    const outcomes = vi.fn()
    const submit = vi.fn((sessionId: string, change: SettingsChange, changeId: string) => submitSettingsChange({
      sessionId, dispatch: writes.getState().dispatch, mintChangeId: () => changeId,
      sendCommand: command => {
        if (command.type === 'setSessionSettings') connection.setSessionSettings(command.payload, command.changeId)
      }
    }, change))
    recall.start({ id: 'new', is_promoted: false, cwd: '/workspace', name: null,
      last_used_at: '', workspace_label: null }, 'srv-1', {
      onDaemonEvent, ownsTarget: () => true, canWriteTarget: () => true,
      subscribeOwnership: () => () => {}, writes, submit, mintChangeId: () => 'recall', log: outcomes,
      getModels: () => ({ models: [{ value, display_name: 'Choice', resolved_model: 'resolved',
        effort_levels: [], supports_auto_mode: false, truncated_fields: null }], droppedModels: 0 })
    }, () => {})
    const reply: StampedDaemonEvent = { type: 'runConfigReceived', serverId: 'srv-1',
      conversationId: 'new', sessionId: 'private-session', model: 'inherited', effort: '',
      yolo: false, permissionMode: 'default', used_tokens: 0, window_tokens: 0 }
    const beforeLogs = records.length
    for (const listener of listeners) listener(reply)
    expect(recall.pending.getState().target).toBe('new')
    expect(writes.getState().pending.size).toBe(1)
    expect(selectEffectiveSettings(null, writes.getState()).model).toBe(value)
    await tick()
    expect(sink.send.mock.calls.map(([, event]) => event).filter(event => event.type === 'sessionSettingsRejected')).toEqual([
      { type: 'sessionSettingsRejected', serverId: 'srv-1', changeId: 'recall' }
    ])
    expect(recall.pending.getState().target).toBeNull()
    expect(writes.getState().pending.size).toBe(0)
    expect(writes.getState().confirmed).toEqual({})
    expect(selectEffectiveSettings({ ...reply, usedTokens: 0, windowTokens: 0 }, writes.getState()).model).toBe('inherited')
    expect(writes.getState().error).toBeNull()
    expect(storage.write).not.toHaveBeenCalled()
    expect(storage.read()).toBe(value)
    expect(records.slice(beforeLogs)).toEqual([{ event: 'session-settings-write-failed', code: 'build-or-send-failed' }])
    expect(outcomes.mock.calls).toEqual([['started'], ['submitted'], ['rejected']])
    for (const listener of listeners) listener(reply)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(failure === 'build' ? 0 : 1)
    recall.cancel(); offWrites(); connection.stop()
  })
})
