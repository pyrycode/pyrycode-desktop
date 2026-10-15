import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import globalSetup, { planRunDisplay, RUN_DISPLAY_ENV_FLAG, startRunDisplay, xvfbOnPath } from './runDisplay'

describe('planRunDisplay', () => {
  it('starts its own display on Linux with Xvfb, even when the container set DISPLAY and the show-window flag', () => {
    expect(planRunDisplay({ DISPLAY: ':99', PYRY_E2E_SHOW_WINDOW: '1' }, 'linux', true)).toEqual({ kind: 'own' })
    expect(planRunDisplay({}, 'linux', true)).toEqual({ kind: 'own' })
    expect(planRunDisplay({ [RUN_DISPLAY_ENV_FLAG]: 'own' }, 'linux', true)).toEqual({ kind: 'own' })
  })

  it('leaves macOS and Windows alone, whatever is set', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(planRunDisplay({ [RUN_DISPLAY_ENV_FLAG]: 'own', PYRY_E2E_SHOW_WINDOW: '1' }, platform, false))
        .toEqual({ kind: 'inherit', reason: 'not-linux' })
    }
  })

  it('keeps the inherited display only when told to, or when there is no Xvfb to start', () => {
    expect(planRunDisplay({ [RUN_DISPLAY_ENV_FLAG]: 'inherit', DISPLAY: ':0' }, 'linux', true))
      .toEqual({ kind: 'inherit', reason: 'opted-out' })
    expect(planRunDisplay({ DISPLAY: ':0' }, 'linux', false)).toEqual({ kind: 'inherit', reason: 'no-xvfb' })
  })

  it('fails at setup rather than at every launch when no display can exist', () => {
    expect(() => planRunDisplay({}, 'linux', false)).toThrow(/install Xvfb/)
    expect(() => planRunDisplay({ [RUN_DISPLAY_ENV_FLAG]: 'own', DISPLAY: ':0' }, 'linux', false)).toThrow(/needs Xvfb/)
    expect(() => planRunDisplay({ [RUN_DISPLAY_ENV_FLAG]: 'yes' }, 'linux', true)).toThrow(/must be "own" or "inherit"/)
  })
})

// The real server, where there is one (the agent container and Linux machines with Xvfb installed).
// "Listening" is a real connection to the display's socket: the path socket where /tmp/.X11-unix is
// writable, else Linux's abstract socket of the same name.
function accepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ path })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}
async function listening(display: string): Promise<boolean> {
  const path = `/tmp/.X11-unix/X${display.slice(1)}`
  return (await accepts(path)) || (await accepts(`\0${path}`))
}

describe.skipIf(process.platform !== 'linux' || !xvfbOnPath())('startRunDisplay', () => {
  const saved = { DISPLAY: process.env.DISPLAY, flag: process.env[RUN_DISPLAY_ENV_FLAG] }
  afterEach(() => {
    if (saved.DISPLAY === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = saved.DISPLAY
    if (saved.flag === undefined) delete process.env[RUN_DISPLAY_ENV_FLAG]
    else process.env[RUN_DISPLAY_ENV_FLAG] = saved.flag
  })

  it('gives two concurrent runs two different displays, each listening until stopped', async () => {
    const [a, b] = await Promise.all([startRunDisplay(), startRunDisplay()])
    try {
      expect(a.display).toMatch(/^:\d+$/)
      expect(b.display).not.toBe(a.display)
      for (const { display } of [a, b]) expect(await listening(display)).toBe(true)
    } finally {
      await Promise.all([a.stop(), b.stop()])
    }
    for (const { display } of [a, b]) expect(await listening(display)).toBe(false)
  })

  it('global setup points the run at its own display and its teardown stops it', async () => {
    process.env.DISPLAY = ':99'
    delete process.env[RUN_DISPLAY_ENV_FLAG]
    const teardown = await globalSetup()
    const display = process.env.DISPLAY
    try {
      expect(teardown).toBeTypeOf('function')
      expect(display).not.toBe(':99')
      expect(await listening(display!)).toBe(true)
    } finally {
      await teardown?.()
    }
    expect(await listening(display!)).toBe(false)
  })

  it('global setup changes nothing under the opt-out', async () => {
    process.env.DISPLAY = ':99'
    process.env[RUN_DISPLAY_ENV_FLAG] = 'inherit'
    expect(await globalSetup()).toBeUndefined()
    expect(process.env.DISPLAY).toBe(':99')
  })
})
