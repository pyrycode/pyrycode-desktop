import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const temporary = mkdtempSync(join(tmpdir(), 'desktop-offline-replay-'))
const log = join(temporary, 'launches.jsonl')
const env = { ...process.env }
for (const name of Object.keys(env)) if (name.startsWith('OP_') ||
  /^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|PYRY_LIVE_CLAUDE_TOKEN|PYRY_BIN|PYRY_CODEX_CAPTURE_HOME|PYRY_CODEX_CAPTURE_BIN|PYRY_DEV_AGENTS_TOKEN)$/.test(name)) delete env[name]
for (const name of ['claude', 'pyry', 'codex']) writeFileSync(join(temporary, name),
  '#!/bin/sh\necho denied >> "$PYRY_OFFLINE_LAUNCH_LOG"\nexit 98\n', { mode: 0o700 })
env.PATH = temporary + ':' + (env.PATH ?? '')
env.PYRY_OFFLINE_LAUNCH_LOG = log
env.NODE_OPTIONS = `--require "${resolve('scripts/offline-replay-guard.cjs')}"`
let result
try {
  result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.recorded.config.ts', ...process.argv.slice(2)],
    { env, stdio: 'inherit' })
  if (result.error) throw new Error('Offline replay failed to launch')
  if (existsSync(log) && readFileSync(log, 'utf8').trim()) throw new Error('Offline replay attempted a forbidden executable')
  process.stdout.write(JSON.stringify({ offlineReplay: true, forbiddenLaunchAttempts: 0, exitCode: result.status }) + '\n')
  process.exitCode = result.status ?? 1
} finally { rmSync(temporary, { recursive: true, force: true }) }
