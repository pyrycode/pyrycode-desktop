import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { HostedResourceResult } from './transport/hostedResources'
vi.mock('electron', () => ({ ipcMain: new EventEmitter() }))
import { ipcMain } from 'electron'
import { installHostedFetch } from './hostedFetch'

const origin = 'https://app-test.invalid', app = '22222222-2222-4222-8222-222222222222'
const input = () => ({ url: origin + '/api/value?b=%2f&a=&a=2', method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0, 255]) })
const disposals: (() => void)[] = []
afterEach(() => { for (const dispose of disposals.splice(0)) dispose() })
function setup() {
  const frame = { url: origin + '/' }, wc = { mainFrame: frame, isDestroyed: () => false }
  const replies: unknown[][] = [], denied = vi.fn(), signals: AbortSignal[] = []
  const completions: ((value: HostedResourceResult) => void)[] = []
  const request = vi.fn((_input: unknown, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise<HostedResourceResult>(resolve => { completions.push(resolve) })
  })
  const cancelRequests = vi.fn()
  const dispose = installHostedFetch(wc as unknown as WebContents, origin, app, '1.0.0', request, cancelRequests, denied)
  disposals.push(dispose)
  const event = { sender: wc, senderFrame: frame, reply: (...args: unknown[]) => replies.push(args), returnValue: null as unknown }
  const bind = () => { ipcMain.emit('hosted-fetch-bind', event); return event.returnValue }
  const token = bind()
  const send = (id = 1, value: unknown = input(), document: unknown = token, operation = 'request', sender = event) =>
    ipcMain.emit('hosted-fetch', sender, document, id, operation, value)
  const finish = async (index = completions.length - 1) => { completions[index]({ ok: false, error: 'aborted', uncertain: true }); await Promise.resolve() }
  return { frame, wc, replies, denied, signals, request, cancelRequests, dispose, event, bind, token, send, finish }
}

describe('hosted Fetch native boundary', () => {
  it('validates sender, frame, origin and document before requests or aborts', async () => {
    const h = setup()
    h.send()
    expect(h.request).toHaveBeenCalledOnce()
    for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: origin + '/' } }]) {
      h.send(2, input(), h.token, 'request', event as typeof h.event)
      h.send(1, input(), h.token, 'abort', event as typeof h.event)
    }
    h.send(2, input(), 'foreign'); h.send(1, input(), 'foreign', 'abort')
    h.frame.url = 'https://foreign.invalid/'
    h.send(2); h.send(1, input(), h.token, 'abort')
    expect(h.request).toHaveBeenCalledOnce()
    expect(h.signals[0].aborted).toBe(false)
    h.frame.url = origin + '/'
    h.send(1, undefined, h.token, 'abort')
    expect(h.signals[0].aborted).toBe(true)
    await h.finish()
    expect(h.replies).toEqual([['hosted-fetch-reply', h.token, 1, { error: 'aborted' }]])
  })

  it('rejects malformed bodies, headers, routes and identity selectors before native dispatch', () => {
    const h = setup()
    const invalid = [null, { ...input(), app_id: app }, { ...input(), body: new Uint8Array(32769) },
      { ...input(), headers: { authorization: 'secret' } }, { ...input(), headers: { accept: 'x'.repeat(1025) } },
      { ...input(), method: 'CONNECT' }, { ...input(), method: 'HEAD' }, { ...input(), url: origin + '/api/%2f' },
      { ...input(), url: 'https://foreign.invalid/api/value' }, { ...input(), url: origin + '/asset' },
      { ...input(), headers: { accept: 'x\r\ny' } }, { ...input(), url: origin + '/api/value#fragment' }]
    invalid.forEach((value, index) => h.send(index + 1, value))
    expect(h.request).not.toHaveBeenCalled()
    expect(h.replies).toHaveLength(invalid.length)
    expect(h.replies.every(reply => JSON.stringify(reply[3]) === '{"error":"network"}')).toBe(true)
  })

  it('rejects reused correlations and fences completion across document rebinding and retirement', async () => {
    const h = setup()
    h.send(); h.send()
    expect(h.request).toHaveBeenCalledOnce()
    expect(h.replies).toEqual([])
    const next = h.bind()
    expect(next).not.toBe(h.token)
    expect(h.signals[0].aborted).toBe(true)
    h.send(1, input(), next)
    await h.finish(0)
    expect(h.replies).toEqual([])
    await h.finish()
    expect(h.replies).toEqual([['hosted-fetch-reply', next, 1, { error: 'aborted' }]])
    h.send(2, input(), next)
    h.dispose()
    expect(h.signals[2].aborted).toBe(true)
    await h.finish()
    expect(h.replies).toHaveLength(1)
    h.send(3, input(), next)
    expect(h.request).toHaveBeenCalledTimes(3)
  })

  it('uses native authority and preserves encoded query and opaque body bytes', async () => {
    const h = setup()
    h.send()
    expect(h.request.mock.calls[0][0]).toMatchObject({ type: 'app_api_request', payload: {
      app_id: app, release_version: '1.0.0', path: '/api/value', query: 'b=%2f&a=&a=2', method: 'POST', body: 'AP8=' } })
    await h.finish()
  })

  it('authenticates document aborts and cancels the whole owner before individual signals', async () => {
    const h = setup()
    h.cancelRequests.mockClear()
    for (let id = 1; id <= 9; id++) h.send(id)
    for (const [token, event] of [['foreign', h.event], [h.token, { ...h.event, senderFrame: {} }]])
      ipcMain.emit('hosted-fetch', event, token, 0, 'abort-document')
    expect(h.cancelRequests).not.toHaveBeenCalled()
    h.cancelRequests.mockImplementation(signals => {
      expect(signals).toEqual(new Set(h.signals))
      expect([...signals].every(signal => !signal.aborted)).toBe(true)
    })
    ipcMain.emit('hosted-fetch', h.event, h.token, 0, 'abort-document')
    expect(h.cancelRequests).toHaveBeenCalledOnce()
    expect(h.signals.every(signal => signal.aborted)).toBe(true)
    ipcMain.emit('hosted-fetch', h.event, h.token, 0, 'abort-document')
    h.send(10)
    expect(h.request).toHaveBeenCalledTimes(9)
    h.cancelRequests.mockReset()
    const next = h.bind()
    h.send(1, input(), next)
    for (let index = 0; index < 9; index++) await h.finish(index)
    expect(h.replies).toEqual([])
    await h.finish()
    expect(h.replies).toEqual([['hosted-fetch-reply', next, 1, { error: 'aborted' }]])
  })
})
