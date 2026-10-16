import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { requestContract } from './recording-contract.mjs'

// Run from the repository root. A candidate is explicit and never replaces committed evidence.
const mode = process.argv[2]
if (!['capture', 'verify'].includes(mode)) throw new Error('Choose capture or verify')
if (!process.env.PYRY_BIN) throw new Error('Set PYRY_BIN to an isolated test daemon executable')
if (mode === 'capture' && !process.env.PYRY_RECORDING_OUTPUT) throw new Error('Set PYRY_RECORDING_OUTPUT to a new candidate file')
const temporary = mkdtempSync(join(tmpdir(), 'desktop-recording-'))
const output = mode === 'capture' ? resolve(process.env.PYRY_RECORDING_OUTPUT) : join(temporary, 'candidate.json')
if (existsSync(output)) throw new Error('Recording output already exists')
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { env, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Recording command failed')
}
let failure
try {
  try {
    run('npm', ['run', 'typecheck'])
    run('./node_modules/.bin/electron-vite', ['build', '--config', 'e2e/recordings/capture.config.ts'])
    run('./node_modules/.bin/playwright', ['test', '--config', 'playwright.capture.config.ts'],
      { ...process.env, PYRY_RECORDING_OUTPUT: output })
    if (!existsSync(output)) throw new Error('Capture produced no verified recording')
  } catch (error) { failure = error }
  finally {
    // Always remove the capture adapter from the built app, even on a failed live scenario.
    try { run('npm', ['run', 'build']) } catch (error) { failure ??= error }
  }
  if (failure) throw failure
  if (readFileSync('out/main/index.js', 'utf8').includes('__desktopExchangeCapture'))
    throw new Error('Normal build still contains the test recorder')
  if (mode === 'verify') {
    const env = { ...process.env }
    for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'PYRY_LIVE_CLAUDE_TOKEN', 'PYRY_BIN']) delete env[name]
    delete env.PYRY_RECORDING_FILE
    run('./node_modules/.bin/playwright', ['test', '--config', 'playwright.recorded.config.ts'], env)
    env.PYRY_RECORDING_FILE = output
    run('./node_modules/.bin/playwright', ['test', '--config', 'playwright.recorded.config.ts'], env)
    const candidate = JSON.parse(readFileSync(output, 'utf8'))
    const committed = readFileSync('e2e/recordings/permission-allow.json')
    if (requestContract(candidate) !== requestContract(JSON.parse(committed)))
      throw new Error('Current daemon changed the recorded request contract; capture and review a replacement fixture')
    // Metadata only. No application messages or login material in command output.
    process.stdout.write(JSON.stringify({ verified: true, scenario: candidate.scenario.id, source: candidate.source,
      committedRecordingSha256: createHash('sha256').update(committed).digest('hex'),
      candidateSha256: createHash('sha256').update(readFileSync(output)).digest('hex') }) + '\n')
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
