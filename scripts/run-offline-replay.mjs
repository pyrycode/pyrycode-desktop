import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { selectReplayProfile, withReplayBuildProfile, replayBuildEvidence } from './replay-build-profile.mjs'

const { profile, args: testArgs } = selectReplayProfile(process.argv.slice(2))
const temporary = mkdtempSync(join(tmpdir(), 'desktop-offline-replay-'))
const log = join(temporary, 'launches.jsonl')
const env = { ...process.env }
for (const name of Object.keys(env)) if (name.startsWith('OP_') ||
  /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|OPENAI_API_KEY$|CODEX_API_KEY$|PYRY_LIVE_|PYRY_BIN$|PYRY_CODEX_CAPTURE_HOME$|PYRY_CODEX_CAPTURE_BIN$|PYRY_DEV_AGENTS_TOKEN$)/.test(name)) delete env[name]
for (const name of ['claude', 'pyry', 'codex']) writeFileSync(join(temporary, name),
  '#!/bin/sh\necho denied >> "$PYRY_OFFLINE_LAUNCH_LOG"\nexit 98\n', { mode: 0o700 })
env.PATH = temporary + ':' + (env.PATH ?? '')
env.PYRY_OFFLINE_LAUNCH_LOG = log
env.NODE_OPTIONS = `--require "${resolve('scripts/offline-replay-guard.cjs')}"`
let result
try {
  await withReplayBuildProfile(profile, async () => {
    const executedBuild = replayBuildEvidence(profile)
    process.stdout.write(JSON.stringify({ replayExecutedBuild: executedBuild }) + '\n')
    env.PYRY_REPLAY_BUILD_PROFILE = profile
    const args = ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.recorded.config.ts', ...testArgs]
    if (process.platform === 'linux' && !(env.PYRY_E2E_DISPLAY === 'inherit' && env.DISPLAY)) {
      // Allocate the display before entering the guarded Node tree. Playwright's
      // normal shell-based display guardian remains forbidden inside that tree.
      if (!existsSync('/usr/bin/xvfb-run')) throw new Error('Offline Linux replay requires xvfb-run or an explicitly inherited DISPLAY')
      env.PYRY_E2E_DISPLAY = 'inherit'
      result = spawnSync('/usr/bin/xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24 -nolisten tcp -noreset', process.execPath, ...args], { env, stdio: 'inherit' })
    } else result = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
    if (result.error) throw new Error('Offline replay failed to launch')
    if (existsSync(log) && readFileSync(log, 'utf8').trim()) throw new Error('Offline replay attempted a forbidden executable')
    process.stdout.write(JSON.stringify({ offlineReplay: true, forbiddenLaunchAttempts: 0, exitCode: result.status }) + '\n')
    process.exitCode = result.status ?? 1
  })
} finally { rmSync(temporary, { recursive: true, force: true }) }
