import { expect, it } from 'vitest'
import { installPausedClock } from './pausedClock'

it('pauses at the requested instant even when the install acknowledgement consumes real time', async () => {
  const instant = new Date('2026-10-01T12:00:00Z')
  let now = 0
  await installPausedClock({ clock: {
    install: async ({ time }: { time: Date }) => { now = time.getTime() + 5_000 },
    pauseAt: async (time: Date) => {
      if (time.getTime() < now) throw Error('Cannot fast-forward to the past')
      now = time.getTime()
    }
  } } as any, instant)
  expect(now).toBe(instant.getTime())
})
