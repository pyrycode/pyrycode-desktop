import { expect, it, vi } from 'vitest'
import { selectReplayProfile, withReplayBuildProfile, replayBuildEvidence } from './replay-build-profile.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { threadOpenOptions } from '../src/renderer/src/threadDeliveryPolicy'
import { threadOpenOptions as complete } from '../e2e/recordings/completeThreadPolicy'

it('requires an explicit supported profile and preserves Playwright arguments', () => {
  expect(selectReplayProfile(['--grep', 'question'])).toEqual({ profile: 'normal', args: ['--grep', 'question'] })
  expect(selectReplayProfile(['--profile', 'complete-thread', '--retries', '0']))
    .toEqual({ profile: 'complete-thread', args: ['--retries', '0'] })
  expect(() => selectReplayProfile(['--profile', 'compact'])).toThrow('Unknown replay build profile')
  expect(() => selectReplayProfile(['--profile'])).toThrow('Unknown replay build profile')
  expect(() => selectReplayProfile(['--profile', 'complete-thread', '--profile', 'complete-thread'])).toThrow('Unknown replay build profile')
})

it('keeps complete selection a build input and normal policy automatic', () => {
  expect(threadOpenOptions).toEqual({ projection: 'auto' })
  expect(complete).toBeUndefined()
})

it('reports built source identity and bundle hashes, and rejects a leftover wrong-profile build', () => {
  const output = mkdtempSync(join(tmpdir(), 'replay-build-evidence-'))
  try {
    mkdirSync(join(output, 'main'))
    const source = { profile: 'complete-thread', desktopRevision: 'a'.repeat(40), sourceDirty: false }
    writeFileSync(join(output, 'main/build-provenance.json'), JSON.stringify(source))
    writeFileSync(join(output, 'main/index.js'), 'current source bundle')
    expect(replayBuildEvidence('complete-thread', output)).toEqual({ ...source, bundles: {
      [join(output, 'main/build-provenance.json')]: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
      [join(output, 'main/index.js')]: createHash('sha256').update('current source bundle').digest('hex')
    } })
    expect(() => replayBuildEvidence('normal', output)).toThrow('Replay build profile mismatch')
  } finally { rmSync(output, { recursive: true, force: true }) }
})

for (const failure of ['none', 'build', 'replay']) it(`restores normal output after ${failure}`, async () => {
  const calls: string[] = []
  const build = vi.fn((profile: string) => {
    calls.push(profile)
    if (failure === 'build' && profile === 'complete-thread') throw new Error('build failed')
  })
  const run = () => { calls.push('replay'); if (failure === 'replay') throw new Error('replay failed') }
  const result = () => withReplayBuildProfile('complete-thread', run, build)
  if (failure === 'none') await result()
  else await expect(result()).rejects.toThrow(`${failure} failed`)
  expect(calls).toEqual(failure === 'build' ? ['complete-thread', 'normal'] : ['complete-thread', 'replay', 'normal'])
})

it('fails when normal restoration fails and leaves normal invocation untouched', async () => {
  await expect(withReplayBuildProfile('complete-thread', () => {}, profile => {
    if (profile === 'normal') throw new Error('restoration failed')
  })).rejects.toThrow('restoration failed')
  const build = vi.fn()
  await withReplayBuildProfile('normal', () => {}, build)
  expect(build).not.toHaveBeenCalled()
})
