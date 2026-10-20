import { expect, it, vi } from 'vitest'
import { withEffortScenarioProof } from './effortScenarioProof'

function fixture() {
  const pages = [0, 1].map(() => ({ closed: false, isClosed() { return this.closed } }))
  const proofs = pages.map(page => {
    const value = { events: [{}], footer: 'observed' }
    return {
      lastSnapshot: value as typeof value | undefined, samples: [{ eventCount: 1 }],
      snapshot: vi.fn(async () => { if (page.closed) throw new Error('closed snapshot'); return value }),
      dispose: vi.fn(async () => {})
    }
  })
  const attach = vi.fn(async (_value: unknown) => {})
  const observe = vi.fn(async (page: typeof pages[number]) => proofs[pages.indexOf(page)])
  const relaunch = vi.fn(async () => { pages[0].closed = true; return { page: pages[1] } })
  const run = (body: Parameters<typeof withEffortScenarioProof<typeof pages[number], typeof proofs[number]>>[3]) =>
    withEffortScenarioProof(pages[0], observe, attach, body)
  return { pages, proofs, attach, observe, relaunch, run }
}

it('relaunch rejection retains primary and pre-retirement proof', async () => {
  const f = fixture(), primary = new Error('replacement prerequisite')
  f.relaunch.mockImplementation(async () => { f.pages[0].closed = true; throw primary })
  await expect(f.run(async (_, handoff) => { await handoff(f.relaunch) })).rejects.toBe(primary)
  expect(f.proofs[0].snapshot).toHaveBeenCalledTimes(1)
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
  expect(f.observe).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(f.attach.mock.calls)).toContain('replacement-failed')
  expect(f.attach.mock.calls.at(-1)?.[0]).toMatchObject({
    process: 2, availability: 'unavailable',
    retiredProof: { process: 1, availability: 'current', events: [{}] }
  })
})

it('secondary failures preserve primary and finish cleanup', async () => {
  const f = fixture(), primary = new Error('original scenario')
  f.proofs[0].snapshot.mockRejectedValue(new Error('snapshot details'))
  f.proofs[0].dispose.mockRejectedValue(new Error('dispose details'))
  await expect(f.run(async () => { throw primary })).rejects.toBe(primary)
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
  expect(f.attach).toHaveBeenCalledTimes(1)
  const diagnostic = JSON.stringify(f.attach.mock.calls)
  expect(diagnostic).toContain('snapshot-failed')
  expect(diagnostic).toContain('disposal-failed')
  expect(diagnostic).not.toContain('details')
})

it('attachment failure cannot replace primary or prevent disposal', async () => {
  const f = fixture(), primary = new Error('scenario')
  f.attach.mockRejectedValue(new Error('attachment'))
  await expect(f.run(async () => { throw primary })).rejects.toBe(primary)
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
})

it('a failed required retirement observation prevents relaunch and leaves unavailable proof explicit', async () => {
  const f = fixture(), primary = new Error('required snapshot')
  f.proofs[0].lastSnapshot = undefined
  f.proofs[0].snapshot.mockRejectedValue(primary)
  await expect(f.run(async (_, handoff) => { await handoff(f.relaunch) })).rejects.toBe(primary)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
  expect(f.attach.mock.calls[0][0]).toMatchObject({ availability: 'unavailable' })
  expect(f.attach.mock.calls[0][0]).not.toHaveProperty('events')
})

it('retains proof for the final attachment if its first attachment failed', async () => {
  const f = fixture(), primary = new Error('first attachment')
  f.attach.mockRejectedValueOnce(primary)
  await expect(f.run(async (_, handoff) => { await handoff(f.relaunch) })).rejects.toBe(primary)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.attach.mock.calls.at(-1)?.[0]).toMatchObject({ retiredProof: {
    process: 1, availability: 'current', events: [{}]
  } })
})

it('preserves even an undefined thrown value through secondary disposal failure', async () => {
  const f = fixture()
  f.proofs[0].dispose.mockRejectedValue(new Error('secondary'))
  let completed = false
  const result = await f.run(async () => { throw undefined }).then(() => { completed = true }, error => error)
  expect(completed).toBe(false)
  expect(result).toBeUndefined()
})

it('unexpected closure fails with last available proof', async () => {
  const f = fixture()
  await expect(f.run(async () => { f.pages[0].closed = true })).rejects.toThrow('unexpected-closure')
  const diagnostic = JSON.stringify(f.attach.mock.calls)
  expect(diagnostic).toContain('last-available')
  expect(diagnostic).toContain('unexpected-closure')
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
})

it('successful handoff distinguishes process proof', async () => {
  const f = fixture()
  await f.run(async (initial, handoff) => {
    expect(initial.proof).toBe(f.proofs[0])
    const next = await handoff(f.relaunch)
    expect(next.page).toBe(f.pages[1])
    expect(next.proof).toBe(f.proofs[1])
  })
  expect(f.proofs.map(proof => proof.dispose.mock.calls.length)).toEqual([1, 1])
  expect(f.attach.mock.calls.map(([value]) => value)).toEqual([
    expect.objectContaining({ process: 1, phase: 'retirement', availability: 'current' }),
    expect.objectContaining({ process: 2, phase: 'final', availability: 'current' })
  ])
})

it.each(['initial', 'replacement'] as const)('required %s observation setup fails', async stage => {
  const f = fixture(), primary = new Error('observation setup')
  if (stage === 'initial') f.observe.mockRejectedValue(primary)
  else f.observe.mockResolvedValueOnce(f.proofs[0]).mockRejectedValue(primary)
  await expect(f.run(async (_, handoff) => { await handoff(f.relaunch) })).rejects.toBe(primary)
  const diagnostic = JSON.stringify(f.attach.mock.calls)
  expect(diagnostic).toContain('observation-failed')
  expect(diagnostic).toContain('unavailable')
})

it.each(['snapshot', 'dispose', 'attach'] as const)('required %s fails without an earlier error', async stage => {
  const f = fixture(), primary = new Error('required diagnostic')
  if (stage === 'attach') f.attach.mockRejectedValue(primary)
  else f.proofs[0][stage].mockRejectedValue(primary)
  await expect(f.run(async () => {})).rejects.toBe(primary)
  expect(f.proofs[0].dispose).toHaveBeenCalledTimes(1)
  expect(f.attach).toHaveBeenCalledTimes(1)
})
