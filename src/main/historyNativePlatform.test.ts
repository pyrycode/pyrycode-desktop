import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

it('rejects the Linux/macOS native smoke on Windows before packaging', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "Object.defineProperty(process, 'platform', { value: 'win32' }); await import('./scripts/history-native-smoke.mjs')"],
  { encoding: 'utf8', timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr.trim()).toBe('history-native-smoke: unsupported-platform')
  expect(result.stdout).toBe('')
})
