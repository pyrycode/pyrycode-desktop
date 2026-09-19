import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { attachmentStoredReplyFrames, attachmentRejectReplyFrames } from '../src/main/transport/fakeDaemon'
import type { AttachmentChunkPayload, RequestAttachmentPayload } from '../src/shared/wire/types'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAAGQCAIAAABkkLjnAAACz0lEQVR42u3SQQkAAAgEwYtiLtMZ1RKCn4FJsGyqB85FAoyFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsbCWGAsjIWxwFgYC2OBsTAWxsJYKmAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBbGkgBjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2NhLBUwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbH4sADgZVQK/cnv+wAAAABJRU5ErkJggg==', 'base64')
const artifacts = '/tmp/builder-1524-visual'

for (const kind of ['file', 'image'] as const) {
  test(`sent local ${kind}: actual upload, repeat activation, then missing-original fallback`, async ({ launchPairedApp }) => {
    const dir = await mkdtemp(join(tmpdir(), 'sent-local-'))
    const downloads = join(dir, 'downloads')
    await mkdir(downloads)
    const filename = kind === 'file' ? 'my original report.txt' : 'my original image.png'
    const original = join(dir, filename)
    await writeFile(original, kind === 'file' ? 'synthetic report' : PNG)
    const stored = new Map<string, AttachmentChunkPayload>()
    let retrievals = 0
    const success = attachmentStoredReplyFrames(0)
    try {
      const { page, app, userDataDir, daemon, servers } = await launchPairedApp({ buildReplyFrames: inbound => {
        const envelope = decodeEnvelope(inbound)
        if (envelope.type === 'attachment_chunk') {
          const chunk = envelope.payload as AttachmentChunkPayload
          stored.set(chunk.attachment_id, chunk)
          return success(inbound)
        }
        if (envelope.type === 'request_attachment') {
          retrievals++
          const ask = envelope.payload as RequestAttachmentPayload
          const chunk = stored.get(ask.attachment_id)
          return chunk === undefined ? [] : [encodeEnvelope({
            id: 900 + envelope.id, type: 'attachment_chunk', ts: '2026-09-19T12:00:00Z',
            in_reply_to: envelope.id, payload: chunk
          })]
        }
        return envelope.type === 'list_conversations' ? [seedConversationsFrame()] : []
      } })

      // Redirect only the native Downloads copy boundary to a temporary directory. A regression
      // must be observable without leaving a file or opening Finder on the operator's desktop.
      await app.evaluate(({ app, dialog, shell }, { original, downloads }) => {
        const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
        const path = process.getBuiltinModule('path') as typeof import('node:path')
        const copy = fs.copyFile
        const realDownloads = app.getPath('downloads')
        const record = { opened: [] as string[], revealed: [] as string[], copies: [] as string[] }
        ;(globalThis as any).__localAttachmentRecord = record
        fs.copyFile = async (source, target, flags) => {
          const targetPath = String(target)
          record.copies.push(targetPath)
          return copy(source, path.dirname(targetPath) === realDownloads
            ? path.join(downloads, path.basename(targetPath)) : target, flags)
        }
        Object.defineProperty(dialog, 'showOpenDialog', {
          value: async () => ({ canceled: false, filePaths: [original] }), configurable: true
        })
        Object.defineProperty(shell, 'openPath', {
          value: async (path: string) => { record.opened.push(path); return '' }, configurable: true
        })
        Object.defineProperty(shell, 'showItemInFolder', {
          value: (path: string) => { record.revealed.push(path) }, configurable: true
        })
      }, { original, downloads })
      const record = () => app.evaluate(() => (globalThis as any).__localAttachmentRecord as {
        opened: string[]; revealed: string[]; copies: string[]
      })

      if (kind === 'file') await page.getByRole('button', { name: 'Attach file', exact: true }).click()
      else {
        // A native path-backed File through Chromium's drag protocol reaches the real preload
        // webUtils path resolver; a page-constructed File would have no path and could not prove this.
        const session = await page.context().newCDPSession(page)
        const box = await page.locator('.composer__input').boundingBox()
        expect(box).not.toBeNull()
        for (const type of ['dragEnter', 'dragOver', 'drop']) await session.send('Input.dispatchDragEvent', {
          type, x: box!.x + 10, y: box!.y + 10,
          data: { items: [], files: [original], dragOperationsMask: 1 }
        })
        await session.detach()
      }
      await expect(page.locator('.composer__attachment')).toHaveCount(1)
      expect(stored.size).toBe(1)
      const uploaded = [...stored.values()][0]
      expect(uploaded.filename).toBe(filename)
      expect(uploaded.conversation_id).toBe(SEEDED_ROW.id)
      expect(JSON.stringify(uploaded)).not.toContain(dir)
      for (const owner of [
        { serverId: servers[0].serverId, conversationId: 'another-conversation' },
        { serverId: 'another-server', conversationId: SEEDED_ROW.id }
      ]) {
        const result = await page.evaluate(request => new Promise(resolve => {
          const off = window.pyry.onAttachmentOpenEvent(event => {
            if (event.attachmentId !== request.attachmentId) return
            off()
            resolve(event)
          })
          window.pyry.openAttachment(request)
        }), { ...owner, attachmentId: uploaded.attachment_id, localOnly: true })
        expect(result).toEqual({ type: 'failed', attachmentId: uploaded.attachment_id, reason: 'unavailable' })
      }
      expect((await record()).opened).toEqual([])
      await page.getByPlaceholder('Message…').fill('Here is my local attachment')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const control = page.locator(kind === 'file' ? 'button.bubble__file' : 'button.bubble__image-button')
      await expect(control).toBeVisible()
      const beforeRetrievals = retrievals
      for (let click = 1; click <= 2; click++) {
        await control.click()
        await expect.poll(async () => (await record()).opened.length).toBe(click)
        expect((await record()).opened).toEqual(Array(click).fill(original))
      }
      expect(retrievals).toBe(beforeRetrievals)
      expect((await record()).copies).toEqual([])
      expect((await record()).revealed).toEqual([])
      expect(await readdir(downloads)).toEqual([])
      expect((await readdir(dir)).sort()).toEqual(['downloads', filename].sort())
      expect(await readdir(userDataDir)).not.toContain('attachment-views')
      await mkdir(artifacts, { recursive: true })
      await page.screenshot({ path: join(artifacts, `${kind}.png`), animations: 'disabled' })

      if (kind === 'file') {
        const other = { ...SEEDED_ROW, id: 'another-conversation', name: 'Another discussion' }
        daemon.pushFrame(encodeEnvelope({ id: 999, type: 'conversations', ts: '2026-09-19T12:00:00Z',
          payload: { conversations: [SEEDED_ROW, other] } }))
        await page.locator('.channel-list__row-open').filter({ hasText: other.name }).click()
        await expect(control).toHaveCount(0)
        await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name }).click()
        await control.click()
        await expect.poll(async () => (await record()).opened.length).toBe(3)
        expect((await record()).opened[2]).toBe(original)
        expect((await record()).copies).toEqual([])
      }

      await rm(original)
      await control.click()
      if (kind === 'file') {
        await expect.poll(async () => (await record()).revealed.length).toBe(1)
        expect(retrievals).toBe(beforeRetrievals + 1)
        expect(await readdir(downloads)).toEqual(['my_original_report.txt'])
        expect(await readFile(join(downloads, 'my_original_report.txt'), 'utf8')).toBe('synthetic report')
      } else {
        await expect.poll(async () => (await record()).opened.length).toBe(3)
        expect((await record()).opened[2]).toBe(join(await realpath(userDataDir), 'attachment-views', `${uploaded.attachment_id}.png`))
      }
      expect((await record()).copies).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('cancelled and failed local uploads never register an original', async ({ launchPairedApp }) => {
  const dir = await mkdtemp(join(tmpdir(), 'failed-local-'))
  const original = join(dir, 'failed report.txt')
  await writeFile(original, 'synthetic report')
  let failedId: string | undefined
  const reject = attachmentRejectReplyFrames(0, 'attachment.storage_failed')
  try {
    const { app, page, servers } = await launchPairedApp({ buildReplyFrames: inbound => {
      const envelope = decodeEnvelope(inbound)
      if (envelope.type === 'attachment_chunk') {
        failedId = (envelope.payload as AttachmentChunkPayload).attachment_id
        return reject(inbound)
      }
      return envelope.type === 'list_conversations' ? [seedConversationsFrame()] : []
    } })
    await app.evaluate(({ dialog, shell }, path) => {
      let picks = 0
      ;(globalThis as any).__cancelledPicks = 0
      Object.defineProperty(dialog, 'showOpenDialog', {
        value: async () => {
          picks++
          if (picks === 1) {
            ;(globalThis as any).__cancelledPicks++
            return { canceled: true, filePaths: [] }
          }
          return { canceled: false, filePaths: [path] }
        }, configurable: true
      })
      Object.defineProperty(shell, 'openPath', { value: async () => { throw new Error('must not open') }, configurable: true })
    }, original)
    const attach = page.getByRole('button', { name: 'Attach file', exact: true })
    await attach.click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__cancelledPicks)).toBe(1)
    expect(failedId).toBeUndefined()
    await expect(page.locator('.composer__attachment')).toHaveCount(0)
    await attach.click()
    await expect(page.locator('.composer__attach-outcome')).toBeVisible()
    expect(failedId).toBeDefined()
    const result = await page.evaluate(request => new Promise(resolve => {
      const off = window.pyry.onAttachmentOpenEvent(event => {
        if (event.attachmentId !== request.attachmentId) return
        off()
        resolve(event)
      })
      window.pyry.openAttachment(request)
    }), { attachmentId: failedId!, serverId: servers[0].serverId, conversationId: SEEDED_ROW.id, localOnly: true })
    expect(result).toEqual({ type: 'failed', attachmentId: failedId, reason: 'unavailable' })
    await expect(page.locator('.composer__attachment')).toHaveCount(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a successful pasted image keeps the raster-copy fallback', async ({ launchPairedApp }) => {
  let uploaded: AttachmentChunkPayload | undefined
  const success = attachmentStoredReplyFrames(0)
  const { app, page, servers, userDataDir } = await launchPairedApp({ buildReplyFrames: inbound => {
    const envelope = decodeEnvelope(inbound)
    if (envelope.type === 'attachment_chunk') {
      uploaded = envelope.payload as AttachmentChunkPayload
      return success(inbound)
    }
    if (envelope.type === 'request_attachment' && uploaded !== undefined) return [encodeEnvelope({
      id: 900 + envelope.id, type: 'attachment_chunk', ts: '2026-09-19T12:00:00Z',
      in_reply_to: envelope.id, payload: uploaded
    })]
    return envelope.type === 'list_conversations' ? [seedConversationsFrame()] : []
  } })
  await app.evaluate(({ clipboard, nativeImage, shell }) => {
    const image = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOYe/oPSYhhVMOohuGrAQD66GQfBKFH6AAAAABJRU5ErkJggg==')
    if (image.isEmpty()) throw new Error('synthetic clipboard image must decode')
    Object.defineProperty(clipboard, 'readImage', {
      value: () => image, configurable: true
    })
    ;(globalThis as any).__pastedOpened = []
    Object.defineProperty(shell, 'openPath', {
      value: async (path: string) => { (globalThis as any).__pastedOpened.push(path); return '' }, configurable: true
    })
  })
  // Exercise the actual clipboard upload IPC, not an injected renderer completion.
  await page.evaluate(target => window.pyry.pasteAttachmentImage(target), {
    conversationId: SEEDED_ROW.id, serverId: servers[0].serverId
  })
  await expect(page.locator('.composer__attachment')).toHaveCount(1)
  expect(uploaded).toBeDefined()
  const result = await page.evaluate(request => new Promise(resolve => {
    const off = window.pyry.onAttachmentOpenEvent(event => {
      if (event.attachmentId !== request.attachmentId) return
      off()
      resolve(event)
    })
    window.pyry.openAttachment(request)
  }), { attachmentId: uploaded!.attachment_id, conversationId: SEEDED_ROW.id, serverId: servers[0].serverId, localOnly: true })
  expect(result).toEqual({ type: 'failed', attachmentId: uploaded!.attachment_id, reason: 'unavailable' })
  await page.getByPlaceholder('Message…').fill('Here is a pasted image')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('button.bubble__image-button').click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__pastedOpened.length)).toBe(1)
  expect(await app.evaluate(() => (globalThis as any).__pastedOpened)).toEqual([
    join(await realpath(userDataDir), 'attachment-views', `${uploaded!.attachment_id}.png`)
  ])
})
