import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { requestContract } from './recording-contract.mjs'

const mode = process.argv[2]
if (!['capture', 'verify'].includes(mode)) throw new Error('Choose capture or verify')
if (!process.env.PYRY_BIN) throw new Error('Set PYRY_BIN to an isolated source-stamped test daemon')
const temporary = mkdtempSync(join(tmpdir(), 'desktop-client-capture-'))
const output = mode === 'capture' ? process.env.PYRY_CLIENT_RECORDING_DIR && resolve(process.env.PYRY_CLIENT_RECORDING_DIR) : join(temporary, 'captures')
if (!output) throw new Error('Set PYRY_CLIENT_RECORDING_DIR to a new directory outside the checkout')
if (!relative(process.cwd(), output).startsWith('..')) throw new Error('Capture candidates must stay outside the source checkout')
if (existsSync(output)) throw new Error('Capture output already exists; choose a new directory')
mkdirSync(output, { mode: 0o700 })
const reportDirectory = join(temporary, 'reports')
mkdirSync(reportDirectory, { mode: 0o700 })
const run = (args, env = process.env, capture = false) => {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Client recording command failed')
  return result.stdout
}
const tests = report => {
  const found = []
  const walk = suite => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) found.push({ file: spec.file,
      title: spec.title, expectedStatus: test.expectedStatus, results: test.results ?? [] })
    for (const child of suite.suites ?? []) walk(child)
  }
  walk(report)
  return found
}
const countReport = file => {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const entries = tests(report)
  const allowedFixme = 'real claude picks up a saved channel system prompt at Reset session'
  for (const test of entries) {
    if (test.title === allowedFixme && test.expectedStatus === 'skipped' && test.results.every(r => r.status === 'skipped')) continue
    if (test.results.length !== 1 || test.results[0].status !== 'passed') throw new Error('Client recording coverage did not execute every eligible scenario exactly once')
  }
  if (report.errors?.length) throw new Error('Client recording run has setup or top-level errors')
  return { executed: entries.filter(t => t.results.some(r => r.status === 'passed')).length,
    skipped: entries.filter(t => t.expectedStatus === 'skipped').length, durationMs: report.stats.duration }
}
const expectedFiles = readdirSync('e2e').filter(name => /^real-[^/]*\.spec\.ts$/.test(name)).sort()
const names = (directory) => readdirSync(directory).filter(name => name.endsWith('.json')).sort()
const baseline = names('e2e/recordings')
let failure, live, permission
try {
  try {
    // The recorder's fixture rejects dirty source at setup and publication too.
    run(['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.client-tests.json'])
    run(['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', 'e2e/recordings/capture.config.ts'])
    const env = { ...process.env, PYRY_CLIENT_RECORDING_DIR: output, PLAYWRIGHT_JSON_OUTPUT_FILE: join(reportDirectory, 'live.json') }
    run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.client-capture.config.ts', '--reporter=list,json,./e2e/reporters/zeroExecutedGate.ts'], env)
    live = countReport(env.PLAYWRIGHT_JSON_OUTPUT_FILE)
    const observedFiles = [...new Set(tests(JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE))).map(t => t.file.split('/').at(-1)))].sort()
    if (JSON.stringify(observedFiles) !== JSON.stringify(expectedFiles)) throw new Error('Live scenario discovery omitted a source file')
    env.PYRY_RECORDING_OUTPUT = join(output, 'permission-allow.json')
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = join(reportDirectory, 'permission.json')
    run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.capture.config.ts', '--reporter=list,json,./e2e/reporters/zeroExecutedGate.ts'], env)
    permission = countReport(env.PLAYWRIGHT_JSON_OUTPUT_FILE)
  } catch (error) { failure = error }
  finally {
    try { run(['node_modules/electron-vite/bin/electron-vite.js', 'build']);
      run(['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json']);
      run(['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.web.json']) } catch (error) { failure ??= error }
  }
  if (readFileSync('out/main/index.js', 'utf8').includes('__desktopExchangeCapture')) throw new Error('Normal build contains the recorder')
  if (failure) throw failure
  if (names(output).length !== live.executed + permission.executed) throw new Error('Live assertions passed without publishing every capture')
  if (mode === 'verify') {
    if (JSON.stringify(names(output)) !== JSON.stringify(baseline)) throw new Error('Committed recordings do not cover the live inventory')
    const replay = (directory, report) => {
      const env = { ...process.env, PYRY_CLIENT_RECORDING_DIR: directory, PYRY_RECORDING_FILE: join(directory, 'permission-allow.json'),
        PLAYWRIGHT_JSON_OUTPUT_FILE: join(reportDirectory, report) }
      run(['scripts/run-offline-replay.mjs', '--reporter=list,json,./e2e/reporters/zeroExecutedGate.ts'], env)
      const counts = countReport(env.PLAYWRIGHT_JSON_OUTPUT_FILE)
      if (counts.executed !== live.executed + permission.executed) throw new Error('Live and replay scopes differ')
      return counts
    }
    const committed = replay(resolve('e2e/recordings'), 'committed.json')
    const fresh = replay(output, 'fresh.json')
    const drift = []
    for (const name of baseline) {
      const before = JSON.parse(readFileSync(join('e2e/recordings', name))), after = JSON.parse(readFileSync(join(output, name)))
      if (requestContract(before) !== requestContract(after)) drift.push(name)
    }
    process.stdout.write(JSON.stringify({ verified: drift.length === 0, live: { executed: live.executed + permission.executed,
      durationMs: live.durationMs + permission.durationMs }, committedReplay: committed, freshReplay: fresh, drift,
      fixtureSetSha256: createHash('sha256').update(Buffer.concat(baseline.map(name => readFileSync(join(output, name))))).digest('hex') }) + '\n')
    if (drift.length) throw new Error('Fresh capture changed a recorded request contract; review a replacement')
  } else process.stdout.write(JSON.stringify({ captured: live.executed + permission.executed, output }) + '\n')
} catch (error) {
  // Fresh evidence remains private and reviewable when drift or a check fails.
  process.stderr.write(JSON.stringify({ captureCandidates: output, reports: reportDirectory }) + '\n')
  throw error
} finally {
  if (!process.exitCode && mode === 'capture') rmSync(temporary, { recursive: true, force: true })
}
