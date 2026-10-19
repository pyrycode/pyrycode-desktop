import { afterEach, expect, it, vi } from 'vitest'
import { readCertifiedCheckpoint } from './certifiedCheckpoint'

afterEach(() => vi.useRealTimers())

it('does not admit an expensive full read ahead of the certified write acknowledgement', async () => {
  vi.useFakeTimers()
  let acknowledged = false
  // A real full reader occupies main for seconds and can return the pre-write snapshot.
  const read = vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 3000))
    return 25
  })
  const inspecting = vi.fn(async () => acknowledged)
  const result = readCertifiedCheckpoint(inspecting, read)
  await vi.advanceTimersByTimeAsync(200)
  const readsBeforeAcknowledgement = read.mock.calls.length
  acknowledged = true
  await vi.runAllTimersAsync()
  expect(await result).toBe(25)
  expect(readsBeforeAcknowledgement).toBe(0)
  expect(read).toHaveBeenCalledOnce()
  expect(inspecting).toHaveBeenCalled()
})

it('treats unavailable inspection and pending acknowledgement as incomplete without repeating effects', async () => {
  vi.useFakeTimers()
  const unavailable = Symbol('unavailable')
  const inspecting = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(false).mockResolvedValue(true)
  const read = vi.fn(async () => 25)
  const result = readCertifiedCheckpoint(inspecting, read)
  await vi.advanceTimersByTimeAsync(200)
  expect(read).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  expect(await result).toBe(25)
  expect(read).toHaveBeenCalledOnce()
})

it.each([null, 20, 25])('returns the actual protected result %s after acknowledgement', async checkpoint => {
  const read = vi.fn(async () => checkpoint)
  expect(await readCertifiedCheckpoint(async () => true, read)).toBe(checkpoint)
  expect(read).toHaveBeenCalledOnce()
})

it('propagates fatal inspection failure without admitting a full read', async () => {
  const read = vi.fn(async () => 25)
  await expect(readCertifiedCheckpoint(async () => { throw new Error('inspection failed') }, read)).rejects.toThrow('inspection failed')
  expect(read).not.toHaveBeenCalled()
})
