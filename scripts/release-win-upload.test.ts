// Exercise the real command boundary with local fake tar/SSH executables, never a remote host.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { memoryFs, realExec, release, shellQuote, sshArgs, sshHost } from './release-win.mjs'

describe('source archive transfer', () => {
  it.each([
    { tarStatus: 1, sshStatus: 0 },
    { tarStatus: 0, sshStatus: 23 },
    { tarStatus: 1, sshStatus: 23 }
  ])('stops before building or publishing when tar=$tarStatus and SSH=$sshStatus', async ({ tarStatus, sshStatus }) => {
    mkdirSync('/tmp/builder-1774', { recursive: true })
    const scratch = mkdtempSync('/tmp/builder-1774/transfer-')
    const source = join(scratch, 'work/0.2.0/source')
    const bin = join(scratch, 'bin')
    mkdirSync(source, { recursive: true })
    mkdirSync(bin)
    writeFileSync(join(source, 'package.json'), '{}\n')
    // Emit a valid partial archive: extraction succeeds even though the producer reports failure.
    writeFileSync(join(bin, 'tar'), `#!/bin/sh\n/usr/bin/tar -C ${shellQuote(source)} -cf - package.json || exit $?\nexit ${tarStatus}\n`, { mode: 0o700 })
    writeFileSync(join(bin, 'ssh'), `#!/bin/sh
for script do :; done
PATH=/usr/bin:/bin /bin/sh -c "$script" || exit $?
case "$script" in
  'tar '*) printf extracted > ${shellQuote(join(scratch, 'extracted'))}; exit ${sshStatus} ;;
esac
`, { mode: 0o700 })
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    try {
      const sha = 'a'.repeat(40)
      const fs = memoryFs()
      const workRoot = join(scratch, 'work')
      const receipt = JSON.stringify({ version: '0.2.0', sha })
      fs.write(join(workRoot, '0.2.0/state.json'), receipt)
      fs.write(join(workRoot, '0.2.0/prepared.json'), receipt)
      // The saved prepared clone avoids running git/npm; only the transfer uses realExec.
      const host = sshHost((cmd, args, opts) => realExec(cmd, args, { ...opts, cwd: scratch }), sshArgs('<fake-agent>'))
      const build = vi.fn(() => { throw new Error('Wine build reached after failed transfer') })
      const github = {
        listReleases: async () => [], packageVersion: async () => '0.1.0', tagSha: async () => null,
        createDraft: vi.fn(), publish: vi.fn()
      }
      await expect(release('0.2.0', {
        exec: vi.fn(), fs, host: { ...host, build }, github, log: vi.fn(), workRoot, dryRun: false
      })).rejects.toThrow(`failed with exit code ${sshStatus || tarStatus}`)
      expect(readFileSync(join(scratch, 'extracted'), 'utf-8')).toBe('extracted')
      expect(existsSync(join(scratch, 'pyrycode-desktop-release/0.2.0/project/package.json'))).toBe(true)
      expect(build).not.toHaveBeenCalled()
      expect(github.createDraft).not.toHaveBeenCalled()
      expect(github.publish).not.toHaveBeenCalled()
      expect(fs.exists(join(workRoot, '0.2.0/built.json'))).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
