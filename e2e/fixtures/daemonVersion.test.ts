import { describe, expect, it } from 'vitest'
import { DAEMON_IDENTITY_REJECTION, daemonIdentity } from './daemonVersion'

describe('daemonIdentity', () => {
  it('returns the source revision of a dev build, with or without the dev- prefix', () => {
    expect(daemonIdentity('pyry dev-1a2b3c4\n')).toBe('1a2b3c4')
    expect(daemonIdentity('pyry 1a2b3c4')).toBe('1a2b3c4')
    expect(daemonIdentity(`pyry dev-${'f'.repeat(40)}\n`)).toBe('f'.repeat(40))
  })

  it('returns the version of a release build, dropping a leading v', () => {
    expect(daemonIdentity('pyry 0.27.0\n')).toBe('0.27.0')
    expect(daemonIdentity('pyry v0.27.0\n')).toBe('0.27.0')
    expect(daemonIdentity('pyry 1.2.3-rc.1+build.5\n')).toBe('1.2.3-rc.1+build.5')
  })

  it('rejects any other output with one message naming both accepted forms', () => {
    for (const stdout of ['', 'pyry', 'pyry\n', 'pyry 0.27', 'pyry dev-XYZ1234', 'pyry 1a2b3c', 'pyrycode 0.27.0']) {
      expect(() => daemonIdentity(stdout), JSON.stringify(stdout)).toThrow(DAEMON_IDENTITY_REJECTION)
    }
    expect(DAEMON_IDENTITY_REJECTION).toContain('pyry dev-<hex>')
    expect(DAEMON_IDENTITY_REJECTION).toContain('pyry <major>.<minor>.<patch>')
  })
})
