import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function selectReplayProfile(argv) {
  const args = [...argv], index = args.indexOf('--profile')
  if (index === -1) return { profile: 'normal', args }
  if (args[index + 1] !== 'complete-thread') throw new Error('Unknown replay build profile')
  args.splice(index, 2)
  if (args.includes('--profile')) throw new Error('Unknown replay build profile')
  return { profile: 'complete-thread', args }
}

function build(profile) {
  const args = ['node_modules/electron-vite/bin/electron-vite.js', 'build']
  if (profile === 'complete-thread') args.push('--config', 'e2e/recordings/complete-thread.config.ts')
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(`Replay ${profile} build failed`)
}

export async function withReplayBuildProfile(profile, run, buildOutput = build) {
  if (profile === 'normal') return await run()
  try { await buildOutput(profile); return await run() }
  finally { await buildOutput('normal') }
}

export function replayBuildEvidence(profile, output = 'out') {
  const bundles = {}
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:js|cjs|mjs|html|css|json)$/.test(path)) bundles[path] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  visit(output)
  const source = JSON.parse(readFileSync(join(output, 'main/build-provenance.json'), 'utf8'))
  if (source.profile !== profile) throw new Error('Replay build profile mismatch; rebuild the selected application')
  return { ...source, bundles }
}
