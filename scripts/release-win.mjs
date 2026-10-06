#!/usr/bin/env node
// Builds the Windows installer on pyrybox and publishes it, with its update feed, as a GitHub
// release (#1774).
//
//   npm run release:win -- 0.2.0            build, draft, upload, verify, publish
//   npm run release:win -- 0.2.0 --dry-run  print the build commands, run nothing
//
// Run on the Mac. Rerunning a version resumes it: the source commit recorded on the first run is
// reused even after main moves, an incomplete draft is repaired, and an already published version
// is a no-op. The Apple Silicon Mac cannot run NSIS's makensis, so the installer is built in the
// electronuserland/builder:wine container on pyrybox. GitHub calls run as `gh api` on pyrybox, so
// its existing login publishes and no token reaches the Mac, the container or a file.
//
// Every side effect goes through four boundaries the tests replace with fakes: `exec` for local
// commands, `fs` for the local work directory, `host` for files and the build on pyrybox, and
// `github` for the release REST API.
import { spawnSync } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = 'pyrycode/pyrycode-desktop'
export const HOST = 'pyrybox'
// Pinned by digest so an upstream image change cannot run with the source unnoticed. Pulled
// 2026-10-06: node 24.15.0, wine 11.0.
export const WINE_IMAGE =
  'docker.io/electronuserland/builder:wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64'
// Relative to the pyry user's home on pyrybox, which is where ssh starts a command.
export const REMOTE_ROOT = 'pyrycode-desktop-release'
const REMOTE_GH = '~/.local/bin/gh'
const HELPER = process.env.PYRY_AUTOMATION_ACCESS ?? join(homedir(), '.local/bin/automation-access')
const KEYED = 'PYRY_DESKTOP_RELEASE_KEYED'

export class ReleaseError extends Error {}

/** A stable X.Y.Z with no `v`, no leading zeroes and no suffix, as numbers; otherwise null. */
export function parseVersion(text) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text)
  return match ? match.slice(1).map(Number) : null
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function assetNames(version) {
  const installer = `Pyrycode-Desktop-Setup-${version}.exe`
  return { installer, blockmap: `${installer}.blockmap`, feed: 'latest.yml' }
}

export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`
}

/** The top-level `version`, `path` and `sha512` of an electron-builder `latest.yml`. */
export function parseLatestYml(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const match = /^(version|path|sha512):\s*(.+?)\s*$/.exec(line)
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const isSha = (text) => typeof text === 'string' && /^[0-9a-f]{40}$/.test(text)
const stableVersionOf = (release) =>
  !release.draft && !release.prerelease && release.tag_name.startsWith('v')
    ? parseVersion(release.tag_name.slice(1))
    : null

/** The shell command, run on pyrybox, that turns the prepared tree into the installer. */
export function containerCommand(projectDir) {
  const cache = `"$HOME"/${shellQuote(`${REMOTE_ROOT}/cache`)}`
  const inside = 'npm ci --no-audit --no-fund && npx --no-install electron-builder --win --publish never'
  return [
    'podman run --rm',
    `-v "$HOME"/${shellQuote(projectDir)}:/project`,
    `-v ${cache}/electron:/root/.cache/electron`,
    `-v ${cache}/electron-builder:/root/.cache/electron-builder`,
    '-e ELECTRON_CACHE=/root/.cache/electron',
    '-e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder',
    // The container only packs; it never runs Electron, so skip its Linux binary download.
    '-e ELECTRON_SKIP_BINARY_DOWNLOAD=1',
    `-w /project ${WINE_IMAGE} sh -c ${shellQuote(inside)}`
  ].join(' ')
}

/**
 * The whole release transaction. Throws ReleaseError, never publishing, when anything is off.
 * deps: { exec, fs, host, github, log, workRoot, dryRun }
 */
export async function release(version, deps) {
  const { fs, github, log, dryRun } = deps
  const parsed = parseVersion(version)
  if (!parsed) {
    throw new ReleaseError(`"${version}" is not a stable X.Y.Z version, such as 0.2.0`)
  }
  const tag = `v${version}`
  const work = join(deps.workRoot, version)
  const statePath = join(work, 'state.json')
  const saved = fs.exists(statePath) ? JSON.parse(fs.read(statePath)) : null

  // 1. Validate against GitHub before building or writing anything.
  let sha = saved?.sha ?? null
  let draft = null
  if (!dryRun) {
    const releases = await github.listReleases()
    const forTag = releases.filter((r) => r.tag_name === tag)
    if (forTag.some((r) => !r.draft)) {
      log(`${tag} is already published. Nothing to do.`)
      return { status: 'already-published' }
    }
    if (forTag.length > 1) throw new ReleaseError(`More than one draft is named ${tag}; delete the extras`)
    draft = forTag[0] ?? null
    if (draft) {
      if (!isSha(draft.target_commitish)) {
        throw new ReleaseError(`Draft ${tag} targets ${draft.target_commitish}, not a commit; delete it`)
      }
      if (sha && draft.target_commitish !== sha) {
        throw new ReleaseError(`Draft ${tag} targets ${draft.target_commitish}, but this version was built from ${sha}`)
      }
      sha ??= draft.target_commitish
    }
    sha ??= await github.mainSha()
    const published = releases.map(stableVersionOf).filter(Boolean)
    const floor = published.length
      ? published.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
      : parseVersion(await github.packageVersion(sha))
    if (!floor) throw new ReleaseError('Cannot read the source version to compare against')
    if (compareVersions(parsed, floor) <= 0) {
      const what = published.length ? 'the latest published release' : 'the source package.json version'
      throw new ReleaseError(`${version} must be newer than ${floor.join('.')}, ${what}`)
    }
    const tagSha = await github.tagSha(tag)
    if (tagSha && tagSha !== sha) throw new ReleaseError(`Tag ${tag} already names ${tagSha}, not ${sha}`)
  } else {
    sha ??= '<main-sha>'
  }

  // 2. Pin the source commit for every later retry of this version.
  fs.mkdir(work)
  if (!saved) fs.write(statePath, JSON.stringify({ version, sha }) + '\n')
  log(`Release ${tag} from ${sha}. Work directory: ${work}`)

  // 3 and 4. Prepare the clone and build the installer, each skipped on retry once done.
  const names = assetNames(version)
  const remoteDir = `${REMOTE_ROOT}/${version}`
  const dist = `${remoteDir}/project/dist`
  const receipt = JSON.stringify({ version, sha })
  const source = join(work, 'source')
  if (!(fs.exists(join(work, 'prepared.json')) && fs.read(join(work, 'prepared.json')) === receipt)) {
    prepare(deps, source, sha, version)
    fs.write(join(work, 'prepared.json'), receipt)
  }
  const built = fs.exists(join(work, 'built.json')) && fs.read(join(work, 'built.json')) === receipt
  if (!(built && deps.host.exists(Object.values(names).map((n) => `${dist}/${n}`)))) {
    log(`Building the installer on ${HOST}`)
    deps.host.reset(`${remoteDir}/project`)
    deps.host.upload(source, `${remoteDir}/project`)
    deps.host.build(`${remoteDir}/project`)
    if (dryRun) {
      log('Dry run complete. Nothing was built, uploaded or published.')
      return { status: 'dry-run' }
    }
    fs.write(join(work, 'built.json'), receipt)
  }
  const local = inspectBuild(deps.host, dist, names, version)
  log(`Built ${names.installer}, ${local.files[names.installer].size} bytes`)

  // 5. Draft and upload, keeping only assets that are complete and identical.
  draft ??= await github.createDraft({
    tag,
    sha,
    name: `Pyrycode Desktop ${tag}`,
    body:
      `Windows installer built from main at ${sha}, for x64 and arm64.\n\n` +
      'Unsigned: Windows SmartScreen warns on first launch. Choose More info, then Run anyway.\n'
  })
  for (const name of Object.values(names)) {
    const want = local.files[name]
    const asset = draft.assets?.find((a) => a.name === name)
    const intact =
      asset?.state === 'uploaded' &&
      asset.size === want.size &&
      (!asset.digest || asset.digest === `sha256:${want.sha256}`)
    if (intact) continue
    if (asset) await github.deleteAsset(asset.id)
    log(`Uploading ${name}`)
    await github.uploadAsset(draft.id, name, `${dist}/${name}`)
  }

  // 6. Download everything back and check it before publishing.
  draft = await github.getRelease(draft.id)
  const verifyDir = `${remoteDir}/verify`
  deps.host.reset(verifyDir)
  for (const name of Object.values(names)) {
    const asset = draft.assets.find((a) => a.name === name && a.state === 'uploaded')
    if (!asset) throw new ReleaseError(`Draft ${tag} is missing ${name}; rerun to upload it`)
    await github.downloadAsset(asset.id, `${verifyDir}/${name}`)
  }
  for (const name of Object.values(names)) {
    if (deps.host.fileInfo(`${verifyDir}/${name}`).sha256 !== local.files[name].sha256) {
      // Deleted so a rerun uploads it again rather than trusting it by size.
      await github.deleteAsset(draft.assets.find((a) => a.name === name).id)
      throw new ReleaseError(`Downloaded ${name} differed from the build and was deleted; rerun to upload it again`)
    }
  }
  inspectBuild(deps.host, verifyDir, names, version)
  log('Downloaded assets match the build and the feed')

  // 7. Publish. GitHub creates the tag at the recorded commit.
  await github.publish(draft.id, { tag, sha })
  const after = await github.getRelease(draft.id)
  const tagSha = await github.tagSha(tag)
  if (after.draft || tagSha !== sha) {
    throw new ReleaseError(`Published ${tag}, but GitHub reports draft=${after.draft} and tag ${tagSha}; check it by hand`)
  }
  log(`Published ${tag}: ${after.html_url}`)
  return { status: 'published', sha }
}

function prepare({ exec, fs, log, dryRun }, source, sha, version) {
  log('Preparing an isolated clone')
  if (fs.exists(source)) fs.remove(source)
  exec('git', ['clone', '--quiet', `https://github.com/${REPO}.git`, source])
  exec('git', ['-C', source, 'checkout', '--quiet', '--detach', sha])
  const head = exec('git', ['-C', source, 'rev-parse', 'HEAD'], { capture: true }).stdout.trim()
  if (!dryRun && head !== sha) throw new ReleaseError(`Clone is at ${head}, not ${sha}`)
  exec('npm', ['ci', '--no-audit', '--no-fund'], { cwd: source })
  // Before the stamp: the settings spec pins the dev version vitest reads from package.json.
  exec('npm', ['test'], { cwd: source })
  // The stamp lives in this clone only, before the build so __APP_VERSION__ carries it.
  exec('npm', ['version', version, '--no-git-tag-version'], { cwd: source })
  exec('npm', ['run', 'build'], { cwd: source })
}

/** Checks a directory holding the three release files and returns their sizes and hashes. */
function inspectBuild(host, dir, names, version) {
  const feed = parseLatestYml(host.readText(`${dir}/${names.feed}`))
  if (feed.version !== version || feed.path !== names.installer) {
    throw new ReleaseError(`${dir}/latest.yml names ${feed.path} ${feed.version}, not ${names.installer} ${version}`)
  }
  const files = {}
  for (const name of Object.values(names)) files[name] = host.fileInfo(`${dir}/${name}`)
  if (files[names.installer].sha512 !== feed.sha512) {
    throw new ReleaseError(`${dir}/${names.installer} does not match the sha512 in latest.yml`)
  }
  if (!dir.endsWith('/verify')) {
    for (const arch of ['win-unpacked', 'win-arm64-unpacked']) {
      const config = host.readText(`${dir}/${arch}/resources/app-update.yml`)
      if (!/^owner: pyrycode$/m.test(config) || !/^repo: pyrycode-desktop$/m.test(config)) {
        throw new ReleaseError(`${arch}/resources/app-update.yml does not name ${REPO}`)
      }
    }
  }
  return { files }
}

// ---- Real boundaries ----

export function realExec(cmd, args, { cwd, capture = false, input, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit']
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new ReleaseError(`${cmd} failed with exit code ${result.status}: ${String(args.at(-1)).slice(0, 160)}`)
  }
  return { status: result.status, stdout: result.stdout ?? '' }
}

/** Prints commands instead of running them. Used by --dry-run. */
export function recordingExec(log) {
  return (cmd, args, opts = {}) => {
    log(`$ ${[cmd, ...args].map((a) => (/^[\w./:=@-]+$/.test(a) ? a : shellQuote(a))).join(' ')}` +
      (opts.cwd ? `   (in ${opts.cwd})` : ''))
    return { status: 0, stdout: '' }
  }
}

export const realFs = {
  exists: (p) => nodeFs.existsSync(p),
  read: (p) => nodeFs.readFileSync(p, 'utf-8'),
  write: (p, text) => nodeFs.writeFileSync(p, text, { mode: 0o600 }),
  mkdir: (p) => nodeFs.mkdirSync(p, { recursive: true, mode: 0o700 }),
  remove: (p) => nodeFs.rmSync(p, { recursive: true, force: true })
}

export function memoryFs() {
  const files = new Map()
  return {
    files,
    exists: (p) => files.has(p),
    read: (p) => files.get(p),
    write: (p, text) => void files.set(p, text),
    mkdir: () => {},
    remove: (p) => void files.delete(p)
  }
}

export function sshArgs(agentSocket) {
  return ['-o', `IdentityAgent=${agentSocket}`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST]
}

/** pyrybox, reached over ssh through `exec`. Paths are relative to the pyry user's home. */
export function sshHost(exec, ssh) {
  const run = (script, opts) => exec('ssh', [...ssh, script], opts)
  return {
    reset: (dir) => run(`rm -rf ${shellQuote(dir)} && mkdir -p ${shellQuote(dir)}`),
    upload: (localDir, dir) =>
      // A valid partial archive can extract successfully after tar fails. Require both exits.
      exec('bash', [
        '-o', 'pipefail',
        '-c',
        `COPYFILE_DISABLE=1 tar -C ${shellQuote(localDir)} --no-xattrs --exclude ./node_modules ` +
          `--exclude ./.git --exclude ./dist -cf - . | ssh ${ssh.map(shellQuote).join(' ')} ` +
          shellQuote(`tar -C ${shellQuote(dir)} -xf -`)
      ]),
    build: (projectDir) =>
      run(`mkdir -p ${REMOTE_ROOT}/cache/electron ${REMOTE_ROOT}/cache/electron-builder && ${containerCommand(projectDir)}`),
    exists: (paths) =>
      run(paths.map((p) => `test -f ${shellQuote(p)}`).join(' && '), { allowFailure: true }).status === 0,
    readText: (path) => run(`cat ${shellQuote(path)}`, { capture: true }).stdout,
    fileInfo: (path) => {
      const p = shellQuote(path)
      const out = run(
        `stat -c %s ${p} && sha256sum ${p} | cut -c1-64 && openssl dgst -sha512 -binary ${p} | base64 -w0`,
        { capture: true }
      ).stdout.split('\n')
      return { size: Number(out[0]), sha256: out[1], sha512: out[2] }
    }
  }
}

/** GitHub REST through `gh api` on pyrybox, so its own login is used. */
export function sshGitHub(exec, ssh) {
  const api = (args, opts = {}) =>
    exec('ssh', [...ssh, [REMOTE_GH, 'api', ...args.map(shellQuote)].join(' ') + (opts.suffix ?? '')], {
      capture: true,
      ...opts
    }).stdout
  const json = (args, opts) => JSON.parse(api(args, opts))
  const send = (method, path, body) => json(['-X', method, path, '--input', '-'], { input: JSON.stringify(body) })
  return {
    async listReleases() {
      const all = []
      for (let page = 1; ; page++) {
        const batch = json([`repos/${REPO}/releases?per_page=100&page=${page}`])
        all.push(...batch)
        if (batch.length < 100) return all
      }
    },
    mainSha: async () => api([`repos/${REPO}/commits/main`, '--jq', '.sha']).trim(),
    packageVersion: async (sha) =>
      json(['-H', 'Accept: application/vnd.github.raw+json', `repos/${REPO}/contents/package.json?ref=${sha}`]).version,
    async tagSha(tag) {
      const ref = json([`repos/${REPO}/git/matching-refs/tags/${tag}`]).find((r) => r.ref === `refs/tags/${tag}`)
      if (!ref) return null
      if (ref.object.type !== 'tag') return ref.object.sha
      return json([`repos/${REPO}/git/tags/${ref.object.sha}`]).object.sha
    },
    createDraft: async ({ tag, sha, name, body }) =>
      send('POST', `repos/${REPO}/releases`, { tag_name: tag, target_commitish: sha, name, body, draft: true }),
    getRelease: async (id) => json([`repos/${REPO}/releases/${id}`]),
    deleteAsset: async (id) => void api(['-X', 'DELETE', `repos/${REPO}/releases/assets/${id}`]),
    uploadAsset: async (releaseId, name, remotePath) =>
      void api([
        '-X', 'POST', '-H', 'Content-Type: application/octet-stream',
        `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        '--input', remotePath
      ]),
    downloadAsset: async (id, remotePath) =>
      void api(['-H', 'Accept: application/octet-stream', `repos/${REPO}/releases/assets/${id}`], {
        suffix: ` > ${shellQuote(remotePath)}`
      }),
    publish: async (id, { tag, sha }) =>
      void send('PATCH', `repos/${REPO}/releases/${id}`, {
        tag_name: tag, target_commitish: sha, draft: false, make_latest: 'true'
      })
  }
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((a) => a !== '--dry-run')
  if (rest.length !== 1 || !parseVersion(rest[0])) {
    console.error('Usage: npm run release:win -- X.Y.Z [--dry-run]   (a stable version such as 0.2.0, no v)')
    return 2
  }
  if (!dryRun && !process.env[KEYED]) {
    // Re-enter with the pyrybox key lent through a temporary agent, as container/deploy.sh does.
    const script = fileURLToPath(import.meta.url)
    const r = spawnSync(HELPER, ['with-pyrybox-key', 'env', `${KEYED}=1`, process.execPath, script, ...argv], {
      stdio: 'inherit'
    })
    return r.status ?? 1
  }
  const log = (line) => console.log(line)
  const exec = dryRun ? recordingExec(log) : realExec
  const ssh = sshArgs(dryRun ? '<temporary-agent>' : process.env.SSH_AUTH_SOCK)
  try {
    await release(rest[0], {
      exec,
      fs: dryRun ? memoryFs() : realFs,
      host: sshHost(exec, ssh),
      github: dryRun ? null : sshGitHub(exec, ssh),
      log,
      workRoot: join(homedir(), '.cache/pyrycode-desktop-releases'),
      dryRun
    })
    return 0
  } catch (error) {
    console.error(error instanceof ReleaseError ? `release:win: ${error.message}` : error)
    return 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === nodeFs.realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2))
}
