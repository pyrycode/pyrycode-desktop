// The release transaction of scripts/release-win.mjs (#1774), driven against fake command,
// filesystem, pyrybox and GitHub REST boundaries. The real Wine build and the first real publish
// are the ticket's operator acceptance, not this file's.
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => vi.fn(() => {
  throw new Error('a real process was spawned')
}))
vi.mock('node:child_process', () => ({ spawnSync: spawned }))

import {
  memoryFs,
  parseLatestYml,
  parseVersion,
  recordingExec,
  release,
  sshArgs,
  sshHost,
  WINE_IMAGE
} from './release-win.mjs'

const MAIN = 'a'.repeat(40)
const LATER_MAIN = 'b'.repeat(40)
const WORK = '/work'

type Asset = { id: number; name: string; state: string; size: number; digest?: string; content: string }
type Release = {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  target_commitish: string
  html_url: string
  assets: Asset[]
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const sha512 = (text: string): string => createHash('sha512').update(text).digest('base64')

/** pyrybox's files, as path → content, and the Wine build that fills them. */
function fakeHost() {
  const files = new Map<string, string>()
  let builds = 0
  return {
    files,
    builds: () => builds,
    reset: (dir: string) => {
      for (const path of [...files.keys()]) if (path.startsWith(`${dir}/`)) files.delete(path)
    },
    upload: () => {},
    build: (projectDir: string) => {
      builds++
      const version = projectDir.split('/')[1]
      const installer = `Pyrycode-Desktop-Setup-${version}.exe`
      const bytes = `installer ${version} build ${builds}`
      files.set(`${projectDir}/dist/${installer}`, bytes)
      files.set(`${projectDir}/dist/${installer}.blockmap`, `blockmap of ${bytes}`)
      files.set(
        `${projectDir}/dist/latest.yml`,
        `version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${sha512(bytes)}\npath: ${installer}\n` +
          `sha512: ${sha512(bytes)}\nreleaseDate: '2026-10-06T00:00:00.000Z'\n`
      )
      for (const arch of ['win-unpacked', 'win-arm64-unpacked']) {
        files.set(
          `${projectDir}/dist/${arch}/resources/app-update.yml`,
          'owner: pyrycode\nrepo: pyrycode-desktop\nprovider: github\n'
        )
      }
    },
    exists: (paths: string[]) => paths.every((p) => files.has(p)),
    readText: (path: string) => {
      const text = files.get(path)
      if (text === undefined) throw new Error(`no such remote file ${path}`)
      return text
    },
    fileInfo: (path: string) => {
      const text = files.get(path)
      if (text === undefined) throw new Error(`no such remote file ${path}`)
      return { size: text.length, sha256: sha256(text), sha512: sha512(text) }
    }
  }
}

/** GitHub's release REST state, reading uploads from and writing downloads to the fake host. */
function fakeGitHub(host: ReturnType<typeof fakeHost>, opts: { releases?: Release[]; packageVersion?: string } = {}) {
  const releases: Release[] = opts.releases ?? []
  const tags = new Map<string, string>()
  const calls: string[] = []
  let nextId = 100
  const failures = { upload: new Set<string>(), corrupt: new Set<string>() }
  const find = (id: number): Release => {
    const found = releases.find((r) => r.id === id)
    if (!found) throw new Error(`no release ${id}`)
    return found
  }
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const github = {
    mainShaValue: MAIN,
    listReleases: async () => (calls.push('listReleases'), copy(releases)),
    mainSha: async () => (calls.push('mainSha'), github.mainShaValue),
    packageVersion: async () => (calls.push('packageVersion'), opts.packageVersion ?? '0.1.0'),
    tagSha: async (tag: string) => (calls.push('tagSha'), tags.get(tag) ?? null),
    createDraft: async ({ tag, sha }: { tag: string; sha: string }) => {
      calls.push('createDraft')
      const created: Release = {
        id: nextId++, tag_name: tag, draft: true, prerelease: false, target_commitish: sha,
        html_url: `https://github.com/pyrycode/pyrycode-desktop/releases/tag/${tag}`, assets: []
      }
      releases.push(created)
      return copy(created)
    },
    getRelease: async (id: number) => (calls.push('getRelease'), copy(find(id))),
    deleteAsset: async (id: number) => {
      calls.push(`deleteAsset ${id}`)
      for (const r of releases) r.assets = r.assets.filter((a) => a.id !== id)
    },
    uploadAsset: async (releaseId: number, name: string, path: string) => {
      calls.push(`uploadAsset ${name}`)
      const content = host.readText(path)
      if (failures.upload.has(name)) {
        failures.upload.delete(name)
        find(releaseId).assets.push({ id: nextId++, name, state: 'starter', size: 0, content: '' })
        throw new Error('upload interrupted')
      }
      // A corrupted upload keeps the same size and carries no digest, so only the download catches it.
      const stored = failures.corrupt.delete(name) ? content.replace(/.$/, '#') : content
      find(releaseId).assets.push({ id: nextId++, name, state: 'uploaded', size: stored.length, content: stored })
    },
    downloadAsset: async (id: number, path: string) => {
      calls.push('downloadAsset')
      const asset = releases.flatMap((r) => r.assets).find((a) => a.id === id)
      if (!asset) throw new Error(`no asset ${id}`)
      host.files.set(path, asset.content)
    },
    publish: async (id: number, { tag, sha }: { tag: string; sha: string }) => {
      calls.push('publish')
      const target = find(id)
      target.draft = false
      target.target_commitish = sha
      tags.set(tag, sha)
    }
  }
  return { github, calls, releases, tags, failures }
}

/** Local commands, recorded; `git rev-parse HEAD` answers with the commit last checked out. */
function fakeExec() {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = []
  const failing = new Set<string>()
  let head = ''
  const exec = (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd })
    const line = [cmd, ...args].join(' ')
    for (const f of failing) if (line.includes(f)) throw new Error(`${f} failed`)
    if (args.includes('checkout')) head = args[args.length - 1]
    return { status: 0, stdout: args.includes('rev-parse') ? `${head}\n` : '' }
  }
  return { exec, calls, failing }
}

function setup(opts: Parameters<typeof fakeGitHub>[1] = {}) {
  const host = fakeHost()
  const gh = fakeGitHub(host, opts)
  const ex = fakeExec()
  const fs = memoryFs()
  const log = vi.fn()
  const deps = { exec: ex.exec, fs, host, github: gh.github, log, workRoot: WORK, dryRun: false }
  return { host, gh, ex, fs, deps }
}

const WRITES = ['createDraft', 'uploadAsset', 'deleteAsset', 'publish']
const writesIn = (calls: string[]): string[] => calls.filter((c) => WRITES.some((w) => c.startsWith(w)))

const published = (tag: string, id = 1): Release => ({
  id, tag_name: tag, draft: false, prerelease: false, target_commitish: 'main',
  html_url: '', assets: []
})

describe('parseVersion', () => {
  it('accepts a stable X.Y.Z only', () => {
    expect(parseVersion('0.2.0')).toEqual([0, 2, 0])
    expect(parseVersion('10.0.12')).toEqual([10, 0, 12])
    for (const bad of ['v0.2.0', '01.2.0', '0.02.0', '0.2', '0.2.0.1', '0.2.0-beta.1', '0.2.0+build', '', ' 0.2.0']) {
      expect(parseVersion(bad), bad).toBeNull()
    }
  })
})

describe('parseLatestYml', () => {
  it('reads the top-level keys, not the per-file ones', () => {
    const feed = parseLatestYml("version: 0.2.0\nfiles:\n  - url: x.exe\n    sha512: inner\npath: x.exe\nsha512: outer\nreleaseDate: '2026'\n")
    expect(feed).toEqual({ version: '0.2.0', path: 'x.exe', sha512: 'outer' })
  })
})

describe('release validation', () => {
  it('rejects a malformed version before any command, write or GitHub call', async () => {
    const { deps, gh, ex, fs } = setup()
    await expect(release('v0.2.0', deps)).rejects.toThrow('not a stable X.Y.Z')
    expect(gh.calls).toEqual([])
    expect(ex.calls).toEqual([])
    expect(fs.files.size).toBe(0)
  })

  it('rejects a version not newer than the latest published release, writing nothing', async () => {
    const { deps, gh, ex, fs } = setup({ releases: [published('v0.3.0', 1), published('v0.2.5', 2)] })
    await expect(release('0.2.9', deps)).rejects.toThrow('must be newer than 0.3.0')
    expect(writesIn(gh.calls)).toEqual([])
    expect(ex.calls).toEqual([])
    expect(fs.files.size).toBe(0)
  })

  it('before the first release, requires a version newer than the source package.json', async () => {
    const { deps, gh, ex, fs } = setup({ packageVersion: '0.1.0' })
    await expect(release('0.1.0', deps)).rejects.toThrow('must be newer than 0.1.0')
    expect(writesIn(gh.calls)).toEqual([])
    expect(ex.calls).toEqual([])
    expect(fs.files.size).toBe(0)
  })

  it('an already published version is a no-op: no build, no write, no tag or asset change', async () => {
    const { deps, gh, ex, fs } = setup({ releases: [published('v0.2.0')] })
    await expect(release('0.2.0', deps)).resolves.toEqual({ status: 'already-published' })
    expect(gh.calls).toEqual(['listReleases'])
    expect(ex.calls).toEqual([])
    expect(fs.files.size).toBe(0)
  })

  it('refuses a draft that targets another commit than the recorded one', async () => {
    const { deps, gh, ex, fs } = setup()
    fs.write(`${WORK}/0.2.0/state.json`, JSON.stringify({ version: '0.2.0', sha: MAIN }))
    gh.releases.push({ ...published('v0.2.0', 7), draft: true, target_commitish: LATER_MAIN })
    await expect(release('0.2.0', deps)).rejects.toThrow('targets')
    expect(writesIn(gh.calls)).toEqual([])
    expect(ex.calls).toEqual([])
  })

  it('refuses a pre-existing tag on another commit', async () => {
    const { deps, gh, ex } = setup()
    gh.tags.set('v0.2.0', LATER_MAIN)
    await expect(release('0.2.0', deps)).rejects.toThrow('already names')
    expect(writesIn(gh.calls)).toEqual([])
    expect(ex.calls).toEqual([])
  })
})

describe('release transaction', () => {
  it('builds from an isolated clone, uploads, verifies every download, then publishes', async () => {
    const { deps, gh, ex, host } = setup()
    await expect(release('0.2.0', deps)).resolves.toEqual({ status: 'published', sha: MAIN })

    const lines = ex.calls.map((c) => [c.cmd, ...c.args].join(' '))
    expect(lines[0]).toBe(`git clone --quiet https://github.com/pyrycode/pyrycode-desktop.git ${WORK}/0.2.0/source`)
    expect(lines).toContain(`git -C ${WORK}/0.2.0/source checkout --quiet --detach ${MAIN}`)
    expect(lines.slice(3)).toEqual(['npm ci --no-audit --no-fund', 'npm test', 'npm version 0.2.0 --no-git-tag-version', 'npm run build'])
    for (const c of ex.calls.slice(3)) expect(c.cwd).toBe(`${WORK}/0.2.0/source`)
    expect(host.builds()).toBe(1)

    const order = gh.calls.filter((c) => c !== 'getRelease' && c !== 'tagSha')
    expect(order).toEqual([
      'listReleases', 'mainSha', 'packageVersion', 'createDraft',
      'uploadAsset Pyrycode-Desktop-Setup-0.2.0.exe', 'uploadAsset Pyrycode-Desktop-Setup-0.2.0.exe.blockmap',
      'uploadAsset latest.yml', 'downloadAsset', 'downloadAsset', 'downloadAsset', 'publish'
    ])
    const [created] = gh.releases
    expect(created).toMatchObject({ tag_name: 'v0.2.0', draft: false, target_commitish: MAIN })
    expect(gh.tags.get('v0.2.0')).toBe(MAIN)
  })

  it('a failed check leaves no release; the retry prepares again and publishes', async () => {
    const { deps, gh, ex } = setup()
    ex.failing.add('npm test')
    await expect(release('0.2.0', deps)).rejects.toThrow('npm test failed')
    expect(writesIn(gh.calls)).toEqual([])
    ex.failing.clear()
    await expect(release('0.2.0', deps)).resolves.toMatchObject({ status: 'published' })
  })

  it('a failed upload leaves the draft unpublished; the retry keeps the commit, repairs and publishes', async () => {
    const { deps, gh, ex, host } = setup()
    gh.failures.upload.add('Pyrycode-Desktop-Setup-0.2.0.exe.blockmap')
    await expect(release('0.2.0', deps)).rejects.toThrow('upload interrupted')
    expect(gh.calls).not.toContain('publish')
    expect(gh.releases[0].draft).toBe(true)

    gh.github.mainShaValue = LATER_MAIN
    gh.calls.length = 0
    ex.calls.length = 0
    await expect(release('0.2.0', deps)).resolves.toEqual({ status: 'published', sha: MAIN })
    // Neither the clone nor the Wine build reruns, and only the broken asset is replaced.
    expect(ex.calls).toEqual([])
    expect(host.builds()).toBe(1)
    expect(writesIn(gh.calls)).toEqual([
      expect.stringMatching(/^deleteAsset /),
      'uploadAsset Pyrycode-Desktop-Setup-0.2.0.exe.blockmap',
      'uploadAsset latest.yml',
      'publish'
    ])
    expect(gh.calls).not.toContain('mainSha')
    expect(gh.releases).toHaveLength(1)
    expect(gh.releases[0]).toMatchObject({ draft: false, target_commitish: MAIN })
  })

  it('a hash mismatch after download leaves the draft unpublished; the retry re-uploads and publishes', async () => {
    const { deps, gh } = setup()
    gh.failures.corrupt.add('Pyrycode-Desktop-Setup-0.2.0.exe')
    await expect(release('0.2.0', deps)).rejects.toThrow('differed from the build')
    expect(gh.calls).not.toContain('publish')
    expect(gh.releases[0].draft).toBe(true)

    gh.calls.length = 0
    await expect(release('0.2.0', deps)).resolves.toMatchObject({ status: 'published' })
    expect(writesIn(gh.calls)).toEqual(['uploadAsset Pyrycode-Desktop-Setup-0.2.0.exe', 'publish'])
  })

  it('a feed that does not match its installer stops before any GitHub write', async () => {
    const { deps, gh, host } = setup()
    const build = host.build
    host.build = (dir: string) => {
      build(dir)
      host.files.set(`${dir}/dist/Pyrycode-Desktop-Setup-0.2.0.exe`, 'something else')
    }
    await expect(release('0.2.0', deps)).rejects.toThrow('does not match the sha512 in latest.yml')
    expect(writesIn(gh.calls)).toEqual([])
  })
})

describe('dry run', () => {
  it('records the whole pipeline, ending in the Wine-container call, and runs nothing', async () => {
    const log = vi.fn()
    const exec = recordingExec(log)
    const fs = memoryFs()
    await expect(
      release('0.2.0', {
        exec,
        fs,
        host: sshHost(exec, sshArgs('<temporary-agent>')),
        github: null,
        log,
        workRoot: '/nonexistent/releases',
        dryRun: true
      })
    ).resolves.toEqual({ status: 'dry-run' })

    expect(spawned).not.toHaveBeenCalled()
    const commands: string[] = log.mock.calls.map(([line]) => line).filter((l: string) => l.startsWith('$ '))
    expect(commands[0]).toContain('git clone --quiet https://github.com/pyrycode/pyrycode-desktop.git /nonexistent/releases/0.2.0/source')
    expect(commands.some((c) => c.startsWith('$ npm ci'))).toBe(true)
    expect(commands.some((c) => c.startsWith('$ npm version 0.2.0 --no-git-tag-version'))).toBe(true)
    expect(commands.some((c) => c.startsWith('$ npm run build'))).toBe(true)
    expect(commands.some((c) => c.startsWith('$ npm test'))).toBe(true)
    const last = commands[commands.length - 1]
    expect(last).toContain('podman run --rm')
    expect(last).toContain(WINE_IMAGE)
    expect(last).toContain('electron-builder --win --publish never')
    expect(last).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/)
    // Never the developer's checkout or main, and nothing pushed.
    for (const c of commands) {
      expect(c).not.toContain(process.cwd())
      expect(c).not.toMatch(/\bpush\b|checkout (--quiet )?main\b/)
    }
    expect(commands.filter((c) => c.includes('with-pyrybox-key'))).toEqual([])
    expect([...fs.files.keys()].every((k) => k.startsWith('/nonexistent/releases/0.2.0/'))).toBe(true)
  })
})
