import { createContext, runInContext } from 'node:vm'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { createMainProcessControl } from './mainProcessControl'

afterEach(() => vi.useRealTimers())

function harness(timeoutMs = 5_000) {
  const context = createContext({ Buffer, setTimeout, clearTimeout, Date,
    require: (id: string) => id === 'electron' ? { counter: 0 } : createRequire(import.meta.url)(id) })
  let loss: 'before' | 'after' | undefined
  let calls = 0
  const send = vi.fn(async (_method: string, params: { expression: string; awaitPromise: boolean }) => {
    calls++
    if (params.awaitPromise) throw Error('Protocol error (Runtime.evaluate): Promise was collected')
    const current = loss; loss = undefined
    if (current === 'before') throw Error('Execution context was destroyed')
    const value = runInContext(params.expression, context)
    if (current === 'after') throw Error('Execution context was destroyed')
    return { result: { value } }
  })
  const control = createMainProcessControl({ send }, { timeoutMs, pollMs: 1 })
  return { control, context, send, lose: (when: typeof loss) => { loss = when }, calls: () => calls }
}

it.each(['before', 'after'] as const)('executes a mutation once when the dispatch acknowledgement is lost %s execution', async when => {
  const h = harness()
  h.lose(when)
  expect(await h.control.evaluate(() => { (globalThis as any).effects = ((globalThis as any).effects ?? 0) + 1; return 7 })).toBe(7)
  expect(runInContext('effects', h.context)).toBe(1)
  expect(h.send.mock.calls.every(([, params]) => params.awaitPromise === false)).toBe(true)
})

it('retains an asynchronous operation and polls completion without starting it again', async () => {
  const h = harness()
  const result = await h.control.evaluate(async () => {
    (globalThis as any).effects = ((globalThis as any).effects ?? 0) + 1
    await new Promise(resolve => setTimeout(resolve, 5))
    return { done: true }
  })
  expect(result).toEqual({ done: true })
  expect(runInContext('effects', h.context)).toBe(1)
  expect(h.calls()).toBeGreaterThan(1)
})

it('preserves arguments and falsy, structured and undefined results', async () => {
  const h = harness()
  for (const value of [undefined, null, false, 0, '', [], { a: undefined, b: 7n }, new Date(0), new Uint8Array([1, 2])])
    expect(await h.control.evaluate((_electron, arg) => arg, value)).toEqual(value)
})

it('propagates a callback failure without rerunning the callback', async () => {
  const h = harness()
  await expect(h.control.evaluate(() => {
    (globalThis as any).effects = ((globalThis as any).effects ?? 0) + 1
    throw Error('controlled callback failure')
  })).rejects.toThrow('controlled callback failure')
  expect(runInContext('effects', h.context)).toBe(1)
})

it('preserves Playwright non-serializable result semantics for cleanup callbacks', async () => {
  const h = harness()
  expect(await h.control.evaluate(() => ({ listener: () => {} }))).toBeUndefined()
})

it('does not mistake a callback error for a lost inspector acknowledgement', async () => {
  const h = harness()
  await expect(h.control.evaluate(() => { throw Error('Execution context was destroyed') }))
    .rejects.toThrow('Execution context was destroyed')
  expect(h.send).toHaveBeenCalledOnce()
})

it('propagates an unrelated inspector failure immediately', async () => {
  const fatal = Error('inspector closed')
  const send = vi.fn(async () => { throw fatal })
  await expect(createMainProcessControl({ send }).evaluate(() => true)).rejects.toBe(fatal)
  expect(send).toHaveBeenCalledOnce()
})

it('bounds a permanently unavailable inspector and a non-settling command', async () => {
  vi.useFakeTimers()
  const send = vi.fn(async () => { throw Error('Execution context was destroyed') })
  const unavailable = createMainProcessControl({ send }, { timeoutMs: 100, pollMs: 1 }).evaluate(() => true)
  const unavailableCheck = expect(unavailable).rejects.toThrow('Main-process control timed out')
  await vi.advanceTimersByTimeAsync(101)
  await unavailableCheck
  const h = harness(100)
  const pending = h.control.evaluate(() => new Promise(() => {}))
  const pendingCheck = expect(pending).rejects.toThrow('Main-process control timed out')
  await vi.advanceTimersByTimeAsync(101)
  await pendingCheck
  expect(runInContext('Object.values(globalThis).filter(v => v instanceof Map).length', h.context)).toBe(0)
})

it('never executes an expired dispatch that arrives after the caller has timed out', async () => {
  vi.useFakeTimers()
  const h = harness(100)
  let expression = ''
  h.send.mockImplementation(async (_method, params) => {
    expression = params.expression
    return new Promise(() => {})
  })
  const result = h.control.evaluate(() => { (globalThis as any).lateMutation = true })
  const check = expect(result).rejects.toThrow('Main-process control timed out')
  await vi.advanceTimersByTimeAsync(101)
  await check
  runInContext(expression, h.context)
  expect(runInContext('globalThis.lateMutation', h.context)).toBeUndefined()
})
