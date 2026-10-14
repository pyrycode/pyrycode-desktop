// Compatibility entry point for the pipeline's document guard.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agents = process.env.AGENTS_REPO_PATH || resolve(repo, '../pyrycode-desktop-agents')
const script = resolve(agents, 'bin/docs-guard.mjs')
if (!existsSync(script)) {
  console.error('Install pyrycode-desktop-agents beside this checkout or set AGENTS_REPO_PATH.')
  process.exit(2)
}
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { cwd: repo, stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
