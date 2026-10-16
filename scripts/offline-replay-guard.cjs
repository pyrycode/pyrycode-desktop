// Loaded before Playwright, its workers and Electron. Replay may launch only
// Node and Electron. Display allocation precedes this guard; shell/daemon/Claude launches fail.
const cp = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { syncBuiltinESMExports } = require('node:module')
const allowed = new Set([process.execPath, require('electron')])
const report = process.env.PYRY_OFFLINE_LAUNCH_LOG
const check = command => {
  const resolved = typeof command === 'string' && path.isAbsolute(command) ? command : ''
  if (allowed.has(resolved)) return
  if (report) fs.appendFileSync(report, JSON.stringify({ denied: true, executable: path.basename(String(command)) }) + '\n', { mode: 0o600 })
  throw new Error('Offline replay rejected an external process launch')
}
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const actual = cp[name]
  cp[name] = function(command, ...args) { if (args.some(value => value && typeof value === 'object' && !Array.isArray(value) && value.shell)) check('shell'); check(command); return actual.call(this, command, ...args) }
}
for (const name of ['exec', 'execSync']) cp[name] = () => { check('shell') }
syncBuiltinESMExports()
