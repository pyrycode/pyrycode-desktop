import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile, preview } from 'vite'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'
import { decodeEnvelope } from '../src/main/transport/codec'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'

type Fixture = {
  scope: (host: string, chat: string, epoch: string) => void
  batch: (items: ThreadItem[], version: number) => void
  update: (update: ThreadUpdate) => void
  replies: string[]
  paths: string[]
}
const fixtureSource = `
import { useState } from 'react';
import { useStore } from 'zustand';
import { createThreadItemStore } from './store/threadItemStore';
import { ThreadItemsTimeline } from './screens/conversation/ConversationScreen';
const threadStore = createThreadItemStore();
const replies = [], paths = [];
function ThreadFixture() {
  const [scope, setScope] = useState(null);
  const snapshot = useStore(threadStore, s => scope ? s.snapshot(scope.host, scope.chat) : null);
  window.threadFixture = { replies, paths,
    scope(host, chat, epoch) { threadStore.getState().acceptEpoch(host, chat, epoch); setScope({ host, chat, epoch }); },
    batch(items, version) { const s = threadStore.getState(); const b = s.beginBatch(scope.host, scope.chat, scope.epoch);
      b.applyItems(items, version); b.commit({ fromVersion: 0, version, ranges: [{ start: 0, end: version }] }); },
    update(update) { threadStore.getState().applyUpdate(scope.host, update); }
  };
  return snapshot ? <div className="conversation"><div className="conversation__covered">
    <ThreadItemsTimeline snapshot={snapshot} foldTools onReply={(role, text) => replies.push(role + ':' + text)}
      onOpenMarkdownPath={path => paths.push(path)} />
  </div></div> : <App />;
}
`
async function rendererFixture() {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve('electron.vite.config.ts'))
  const renderer = loaded!.config.renderer
  const outDir = await mkdtemp(join(tmpdir(), 'builder-1904-renderer-'))
  await build({ ...renderer, configFile: false, root: resolve('src/renderer'), base: './',
    plugins: [...renderer.plugins, { name: 'thread-items-fixture', enforce: 'pre', transform(code: string, id: string) {
      if (id.endsWith('/src/renderer/src/main.tsx')) return code.replace('<App />', '<ThreadFixture />') + fixtureSource
    } }], build: { ...renderer.build, outDir }, logLevel: 'silent' })
  return preview({ configFile: false, root: resolve('src/renderer'), build: { outDir },
    preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
}
const item = (id: number, kind: string, content: unknown, fields: Partial<ThreadItem> = {}): ThreadItem => ({
  id, rev: id, kind, order: id, status: 'done', active: false, shown: true, summary: `summary ${id}`, content, ...fields
})

for (const width of [1280, 800]) test(`authoritative items retain identity, actions and scroll at ${width}`, async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const asks: unknown[] = []
    const { page, app } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes)
      if (e.type === 'request_attachment') asks.push(e.payload)
      return e.type === 'list_conversations' ? [seedConversationsFrame()] : []
    } }, { rendererUrl: server.resolvedUrls!.local[0] })
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    let version = 100
    const revs = new Map<number, number>()
    const scope = async (host = 'host', chat = SEEDED_ROW.id, epoch = 'epoch') => page.evaluate(({ host, chat, epoch }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, chat, epoch), { host, chat, epoch })
    const batch = async (items: ThreadItem[]) => {
      for (const i of items) revs.set(i.id, i.rev)
      await page.evaluate(({ items, version }) => (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, version),
        { items, version: ++version })
    }
    const change = async (id: number, changes: Record<string, unknown> | string) => {
      const base_rev = revs.get(id)!, rev = ++version; revs.set(id, rev)
      const routing = { conversation_id: SEEDED_ROW.id, epoch: 'epoch', version, item_id: id, base_rev, rev }
      const update: ThreadUpdate = typeof changes === 'string'
        ? { type: 'thread_text_append', payload: { ...routing, text: changes } }
        : { type: 'thread_item_changed', payload: { ...routing, changes } }
      await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), update)
    }
    await scope()
    const initial = [
      item(10, 'user_message', { text: 'operator text', attachments: [{ attachment_id: 'supplied-file', filename: 'report.pdf' }] }, { status: 'delivered' }),
      item(20, 'assistant_message', { text: 'Initial **markdown**' }, { active: true, status: 'done' }),
      item(30, 'tool_call', { name: 'Read', input_summary: 'first tool', result: { is_error: false, result_summary: 'old result' } }),
      item(40, 'tool_call', { name: 'Read', input_summary: 'second tool' }, { active: true, status: 'running' })
    ]
    await batch(initial)
    const thread = page.getByLabel('Conversation history')
    const assistant = page.locator('[data-thread-role="assistant"]').first()
    await assistant.evaluate(el => { (window as unknown as { originalRow: Element }).originalRow = el })
    const run = page.locator('.tool-run button')
    await run.click()
    const first = page.locator('.tool-row').filter({ has: page.locator('.tool-row__summary', { hasText: 'first tool' }) })
    await first.locator('button').click()
    await expect(first.locator('.tool-row__result')).toHaveText('old result')
    const added: ThreadUpdate = { type: 'thread_item_added', payload: { conversation_id: SEEDED_ROW.id,
      epoch: 'epoch', version: ++version, item: item(50, 'notice', { text: 'Appended notice', level: 'info' }, { subtype: 'banner' }) } }
    await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), added)
    await expect(page.getByText('Appended notice', { exact: true })).toBeVisible()
    await change(20, ' revised')
    await expect(assistant).toContainText('revised')
    await expect(page.locator('.bubble__cursor')).toHaveCount(1)
    expect(await assistant.evaluate(el => el === (window as unknown as { originalRow: Element }).originalRow)).toBe(true)
    const toolAdded: ThreadUpdate = { type: 'thread_item_added', payload: { conversation_id: SEEDED_ROW.id,
      epoch: 'epoch', version: ++version, item: item(45, 'tool_call', { name: 'Read', input_summary: 'appended tool' }) } }
    await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), toolAdded)
    await expect(run).toContainText('Using tools: 3')
    await expect(run).toHaveAttribute('aria-expanded', 'true')
    await expect(first.locator('.tool-row__result')).toHaveText('old result')
    await change(30, { content: { name: 'Read', input_summary: 'first tool', result: {
      is_error: false, result_summary: 'current result', result_detail: '20 lines' } } })
    await expect(first.locator('.tool-row__result')).toHaveText('current result')
    await expect(first.locator('button')).toHaveAttribute('aria-expanded', 'true')
    await change(40, { active: false, status: 'interrupted' })
    await expect(run.getByRole('img', { name: 'Running', exact: true })).toHaveCount(0)
    await expect(page.locator('.tool-row__summary', { hasText: 'second tool' }).locator('..').locator('..').locator('..'))
      .toHaveClass(/tool-row--resolved/)
    await change(20, { active: false, content: { text: 'Current **markdown** [Read note](notes/report.md)' } })
    await page.locator('.message-row--daemon .bubble__copy:not(.bubble__reply)').first().click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Current **markdown** [Read note](notes/report.md)')
    await page.locator('.message-row--daemon .bubble__reply').first().click()
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.replies))
      .toEqual(['assistant:Current **markdown** [Read note](notes/report.md)'])
    await page.getByRole('button', { name: 'Read note' }).click()
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.paths)).toEqual(['notes/report.md'])
    await page.getByText('report.pdf', { exact: true }).click()
    await expect.poll(() => asks).toEqual([{ conversation_id: SEEDED_ROW.id, attachment_id: 'supplied-file' }])
    await capturePairedApp(app, page, `/tmp/builder-1904/items-${width}.png`)

    // A prepend joins the same expanded run and keeps expanded member state mounted.
    await batch([item(25, 'tool_call', { name: 'Read', input_summary: 'older tool' })])
    await expect(run).toHaveAttribute('aria-expanded', 'true')
    await expect(first.locator('.tool-row__result')).toHaveText('current result')
    for (const [host, chat, epoch] of [['other-host', SEEDED_ROW.id, 'epoch'], ['host', 'other-chat', 'epoch'], ['host', SEEDED_ROW.id, 'other-epoch']]) {
      await scope(host, chat, epoch); await batch(initial)
      await expect(run).toHaveAttribute('aria-expanded', 'false')
      await run.click(); await first.locator('button').click()
      await expect(first.locator('.tool-row__result')).toBeVisible()
    }
    await scope('host', SEEDED_ROW.id, 'scroll')
    await batch(Array.from({ length: 25 }, (_, index) => item(200 + index, 'assistant_message', { text: `Row ${index}\n\n` + 'A reading paragraph. '.repeat(15) })))
    const distance = () => thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(distance).toBeLessThanOrEqual(1)
    // Full authoritative revision while following stays at newest.
    await batch([item(224, 'assistant_message', { text: 'Newest growth\n\n' + 'More lines.\n\n'.repeat(30) }, { rev: ++version })])
    await expect.poll(distance).toBeLessThanOrEqual(1)
    await thread.focus(); await page.keyboard.press('Home')
    await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
    const viewed = page.locator('[data-thread-role="assistant"]').first()
    const top = (await viewed.boundingBox())!.y
    await batch([item(100, 'user_message', { text: 'Older page '.repeat(30) }, { status: 'delivered' })])
    await expect.poll(async () => (await viewed.boundingBox())!.y).toBeCloseTo(top, 0)
    expect(await distance()).toBeGreaterThan(100)
    const anchor = page.locator('[data-thread-role="assistant"]').nth(2)
    await thread.evaluate(el => new Promise<void>(resolve => {
      el.scrollTop = 420
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    const before = (await anchor.boundingBox())!.y
    await batch([item(100, 'user_message', { text: 'Revision above reader\n'.repeat(30) }, { status: 'delivered', rev: ++version })])
    await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
    expect(await distance()).toBeGreaterThan(100)
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})
