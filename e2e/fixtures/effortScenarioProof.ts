type Proof = {
  snapshot: () => Promise<{ events: unknown[]; footer: string }>
  samples: unknown[]
  lastSnapshot?: { events: unknown[]; footer: string }
  dispose: () => Promise<void>
}

// One consumer: keep the scenario's error boundary and proof ownership together.
export async function withEffortScenarioProof<P extends { isClosed: () => boolean }, O extends Proof>(
  page: P, observe: (page: P) => Promise<O>, attach: (value: unknown) => Promise<void>,
  run: (initial: { page: P; proof: O }, handoff: (relaunch: () => Promise<{ page: P }>) => Promise<{ page: P; proof: O }>) => Promise<void>
): Promise<void> {
  let current: { page: P; proof: O } | undefined
  let process = 1
  let failure: { error: unknown } | undefined
  let retiredProof: { process: number; availability: string; events?: unknown[]; footer?: string; samples?: unknown[] } | undefined
  const lifecycle: { process: number; phase: string; eventCount?: number; sampleCount?: number }[] = []
  const event = (phase: string) => { lifecycle.push({ process, phase }) }
  const failed = (phase: string, error: unknown) => {
    failure ??= { error }
    event(phase)
  }
  const attempt = async (phase: string, action: () => Promise<void>) => {
    try { await action() } catch (error) { failed(phase, error) }
  }
  const install = async (next: P) => {
    event('observation-requested')
    try { current = { page: next, proof: await observe(next) } }
    catch (error) { failed('observation-failed', error); throw error }
    event('observing')
    return current
  }
  const finish = async (phase: 'retirement' | 'final') => {
    const owned = current
    current = undefined
    let value = owned?.proof.lastSnapshot
    let availability = value ? 'last-available' : 'unavailable'
    if (owned) {
      if (owned.page.isClosed()) {
        failed('unexpected-closure', new Error('Effort proof: unexpected-closure'))
      } else {
        await attempt('snapshot-failed', async () => {
          value = await owned.proof.snapshot()
          availability = 'current'
        })
      }
    }
    // Disposal and attachment each run even if capture or the other operation fails.
    if (owned) await attempt('disposal-failed', owned.proof.dispose)
    if (phase === 'retirement') retiredProof = { process, availability, ...value, samples: owned?.proof.samples }
    lifecycle.push({ process, phase, eventCount: value?.events.length,
      sampleCount: owned?.proof.samples.length })
    await attempt('attachment-failed', async () => attach({ process, phase, availability,
      ...value, samples: owned?.proof.samples, retiredProof: phase === 'final' ? retiredProof : undefined,
      lifecycle: [...lifecycle] }))
  }
  try {
    await run(await install(page), async relaunch => {
      event('retirement-requested')
      await finish('retirement')
      if (failure) throw failure.error
      event('relaunch-requested')
      process++
      let next: { page: P }
      try { next = await relaunch() }
      catch (error) { failed('replacement-failed', error); throw error }
      event('replacement-returned')
      return install(next.page)
    })
  } catch (error) {
    if (!failure) failed('scenario-failed', error)
  } finally {
    await finish('final')
  }
  if (failure) throw failure.error
}
