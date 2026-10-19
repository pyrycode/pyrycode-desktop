import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

it('blocks PATH commands, absolute daemon commands and shell indirection before any process starts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'offline-guard-unit-'))
  const log = join(directory, 'attempts')
  try {
    const program = `const cp=require('node:child_process');
      for(const [name,args] of [['spawnSync',['claude',['--version']]],['execFileSync',['/tmp/pyry',[]]],['execSync',['pyry version']],['spawnSync',[process.execPath,[],{shell:true}]],['fork',['/tmp/no-script',[],{execPath:'/tmp/pyry'}]]]) {
        try { cp[name](...args); throw Error('guard did not reject') } catch(e) {
          if(e.message!=='Offline replay rejected an external process launch') throw e;
        }
      }`
    const result = spawnSync(process.execPath, ['--require', resolve('scripts/offline-replay-guard.cjs'), '-e', program],
      { env: { ...process.env, PYRY_OFFLINE_LAUNCH_LOG: log }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line).executable))
      .toEqual(['claude', 'pyry', 'shell', 'shell', 'pyry'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
