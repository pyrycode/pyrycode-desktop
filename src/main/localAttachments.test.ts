import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalAttachments } from './localAttachments'
import type { DiagnosticEvent, DiagnosticLog } from './diagnosticLog'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup(openResult: boolean | Error = true) {
  const dir = await mkdtemp(join(tmpdir(), 'local-attachments-'))
  dirs.push(dir)
  const path = join(dir, 'my original report.txt')
  await writeFile(path, 'local attachment')
  const opened: string[] = []
  const logs: DiagnosticEvent[] = []
  const local = createLocalAttachments({
    open: async path => {
      opened.push(path)
      if (openResult instanceof Error) throw openResult
      return openResult
    },
    diagnosticLog: { event: event => logs.push(event) } as DiagnosticLog
  })
  const owner = { serverId: 'server-a', conversationId: 'conversation-a' }
  const request = { attachmentId: 'abcd-1234', ...owner }
  return { dir, path, opened, logs, local, owner, request }
}

describe('original local attachments', () => {
  it.each(['my original report.txt', 'my original image.png'])('opens %s repeatedly without copying', async filename => {
    const r = await setup()
    const path = join(r.dir, filename)
    await writeFile(path, 'chosen local contents')
    r.local.remember(r.request.attachmentId, path, r.owner)
    const before = await readdir(r.dir)
    for (let click = 0; click < 2; click++) {
      expect(await r.local.open(r.request)).toEqual({ type: 'opened', attachmentId: r.request.attachmentId })
    }
    expect(r.opened).toEqual([path, path])
    expect(await readdir(r.dir)).toEqual(before)
    expect(r.logs).toEqual([
      { event: 'attachment-local', code: 'registered' },
      { event: 'attachment-local', code: 'opened' },
      { event: 'attachment-local', code: 'opened' }
    ])
  })

  it('requires the exact owner and client ID, ignores filenames, and never reassigns an ID', async () => {
    const r = await setup()
    r.local.remember(r.request.attachmentId, r.path, r.owner)
    const other = { serverId: 'server-b', conversationId: 'conversation-b' }
    r.local.remember(r.request.attachmentId, join(r.dir, 'replacement'), other)
    for (const request of [
      { ...r.request, serverId: other.serverId },
      { ...r.request, conversationId: other.conversationId },
      { ...r.request, ...other },
      { ...r.request, attachmentId: 'received', filename: r.path },
      { attachmentId: r.request.attachmentId }
    ]) expect(await r.local.open(request)).toMatchObject({ type: 'failed', reason: 'unavailable' })
    expect(r.opened).toEqual([])
    const hostileName = { ...r.request, filename: '/daemon/chosen.command' }
    expect(await r.local.open(hostileName)).toMatchObject({ type: 'opened' })
    expect(r.opened).toEqual([r.path])
    const fresh = createLocalAttachments({ open: async () => { throw new Error('must not open') } })
    expect(await fresh.open(r.request)).toMatchObject({ reason: 'unavailable' })
  })

  it.each(['missing', 'unreadable', 'directory'])('falls back when the original becomes %s', async state => {
    const r = await setup()
    r.local.remember(r.request.attachmentId, r.path, r.owner)
    if (state === 'unreadable') await chmod(r.path, 0)
    else {
      await rm(r.path)
      if (state === 'directory') await mkdir(r.path)
    }
    try {
      expect(await r.local.open(r.request)).toEqual({ type: 'failed', attachmentId: r.request.attachmentId, reason: 'unavailable' })
      expect(r.opened).toEqual([])
    } finally {
      if (state === 'unreadable') await chmod(r.path, 0o600)
    }
  })

  it.each([false, new Error('secret /original/path')])('contains an OS-open failure', async outcome => {
    const r = await setup(outcome)
    r.local.remember(r.request.attachmentId, r.path, r.owner)
    expect(await r.local.open(r.request)).toEqual({ type: 'failed', attachmentId: r.request.attachmentId, reason: 'open-failed' })
    expect(r.logs.at(-1)).toEqual({ event: 'attachment-local', code: 'open-failed' })
  })
})
