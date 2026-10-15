import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('packaged protected history commits and reopens with production encryption', async ({}, testInfo) => {
  test.setTimeout(300_000)
  const directory = await mkdtemp(join(tmpdir(), 'pyry-history-native-'))
  const result = await promisify(execFile)(process.execPath, ['scripts/history-native-smoke.mjs', directory],
    { timeout: 240_000, maxBuffer: 4 * 1024 * 1024 })
  console.log(result.stdout)
  await testInfo.attach('history-native.stdout', { body: result.stdout, contentType: 'text/plain' })
  await testInfo.attach('history-native.stderr', { body: result.stderr, contentType: 'text/plain' })
  expect(result.stdout).toContain('"executed":1,"passed":1,"failed":0,"skipped":0')
})
