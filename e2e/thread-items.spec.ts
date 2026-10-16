import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile, preview } from 'vite'
import type { ThreadTaskInputs } from '../src/renderer/src/screens/conversation/threadTaskPresentation'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'
import type { ConversationSummary } from '../src/shared/wire/types'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_RETRIEVAL_CHANNEL, ATTACHMENT_RETRIEVAL_EVENT_CHANNEL } from '../src/shared/ipc/attachmentRetrieval'
import { ATTACHMENT_BYTES_CHANNEL, ATTACHMENT_BYTES_EVENT_CHANNEL } from '../src/shared/ipc/attachmentBytes'
import { ATTACHMENT_OPEN_CHANNEL } from '../src/shared/ipc/attachmentOpen'
import type { AttachmentOpenRequest } from '../src/shared/ipc/attachmentOpen'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { test, expect, seedConversationsFrame, SEEDED_ROW, FIRST_SERVER_ID, SECOND_SERVER_ID, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'

type Fixture = {
  read: (row: Partial<ConversationSummary>, readerOpen?: boolean) => void
  readBatch: (items: ThreadItem[], version: number, completion: 'complete' | 'older' | 'incomplete' | 'abandon') => void
  repair: (version: number) => void
  probe: () => number[]
  readTargets: number[]
  readAttempts: { host: string; chat: string; target: number }[]
  receivedMark: () => number | undefined
  loseOwner: (host: string) => void
  connected: (host: string) => boolean
  precommitTargets: number[]
  send: (text: string, deviceId: string | null) => void
  sendConnection: (hostId: string, connected: boolean) => void
  actions: unknown[]
  activeChat: () => string | null
  unavailable: (host: string) => void
  reconnect: (host: string) => void
  scope: (host: string, chat: string, epoch: string) => void
  batch: (items: ThreadItem[], version: number) => void
  update: (update: ThreadUpdate) => void
  commitUpdate: (update: ThreadUpdate) => void
  taskInputs: (inputs: Omit<ThreadTaskInputs, 'onStopTask'>, callback?: boolean) => void
  turnRunning: (running: boolean) => void
  escapes: string[]
  stops: string[][]
  replies: string[]
  paths: string[]
}
const fixtureSource = `
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from 'zustand';
import { activeConversationStore } from './store/activeConversationStore';
import { sessionStore } from './store/sessionStore';
import { createThreadItemStore } from './store/threadItemStore';
import { ThreadItemsTimeline } from './screens/conversation/ConversationScreen';
import { createThreadSendStore } from './store/threadSendStore';
import { conversationListStore } from './store/conversationListStore';
import { ConversationListData } from './store/conversationListBridge';
import { conversationReadRouteStore } from './store/conversationReadRouteStore';
import { isConversationUnread } from './store/conversationUnread';
import { useReadPublication, createReadPublisher } from './store/conversationReadPublisher';
import { submitMessage } from './screens/conversation/composerSend';
const threadStore = createThreadItemStore();
const sends = createThreadSendStore(), actions = [];
const replies = [], paths = [], stops = [], escapes = [];
const readTargets = [], readAttempts = [], precommitTargets = [];
const savedLinks = new Map();
const readPublisher = createReadPublisher({ rows: () => conversationListStore.getState().conversations ?? [],
  connected: host => sessionStore.getState().statuses.get(host)?.type === 'connected',
  epoch: (host, chat) => conversationReadRouteStore.getState().epochFor(host, chat),
  send: command => { readTargets.push(command.payload.up_to);
    readAttempts.push({ host: command.serverId, chat: command.payload.conversation_id, target: command.payload.up_to });
    window.pyry.sendCommand(command); } });
function ThreadFixture() {
  useReadPublication(readPublisher);
  const [readInputs, setReadInputs] = useState(undefined);
  const [completeThrough, setCompleteThrough] = useState(0);
  const [scope, setScope] = useState(null);
  const [taskInputs, setTaskInputs] = useState({});
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false);
  const [turnRunning, setTurnRunning] = useState(false);
  const [connection, setConnection] = useState(undefined);
  const [receipts, setReceipts] = useState([]);
  const rows = useStore(conversationListStore, s => s.conversations);
  useEffect(() => window.pyry.onDaemonEvent(event => {
    if (['conversationUpdated', 'conversationDeleted', 'conversationsReceived'].includes(event.type))
      setReceipts(held => [...held, [event.type, event.serverId]]);
  }), []);
  const local = useStore(sends, s => scope ? s.select(scope.host, scope.chat) : null);
  const snapshot = useStore(threadStore, s => scope ? s.snapshot(scope.host, scope.chat) : null);
  window.threadFixture = { replies, paths, stops, escapes, turnRunning: setTurnRunning,
    readTargets, readAttempts, precommitTargets,
    connected(host) { return sessionStore.getState().statuses.get(host)?.type === 'connected'; },
    receivedMark() { return conversationListStore.getState().conversations?.find(r => r.id === scope.chat && r.serverId === scope.host)?.read_up_to; },
    loseOwner(host) { conversationListStore.getState().clearConversationsFor(host); },
    probe() { window.dispatchEvent(new Event('focus')); document.querySelector('.conversation__thread')?.dispatchEvent(new Event('scroll')); return [...readTargets]; },
    read(row, readerOpen = false) {
      const full = { id: scope.chat, serverId: scope.host, read_up_to: 0, ...row };
      setReadInputs({ row: full, readerOpen, publisher: readPublisher });
      conversationListStore.getState().setConversations([full], scope.host);
    },
    readBatch(items, version, completion) {
      const s = threadStore.getState(), b = s.beginBatch(scope.host, scope.chat, scope.epoch);
      b.applyItems(items, version);
      if (completion === 'complete' || completion === 'older') b.commit({ fromVersion: 0,
        version, ranges: items.filter(i => i.order > 0).map(i => ({ start: i.order, end: i.order + 1 })) });
      if (completion === 'complete') setCompleteThrough(version);
      if (completion === 'abandon') b.abandon();
      window.dispatchEvent(new Event('focus')); document.querySelector('.conversation__thread')?.dispatchEvent(new Event('scroll'));
      precommitTargets.push(...readTargets);
    },
    repair(version) { threadStore.getState().requireRepair(scope.host, scope.chat, scope.epoch, version); },
    actions,
    sendConnection(hostId, connected) { setConnection({ hostId, status: connected ? { type: 'connected',
      ack: { server_id: hostId, conn_id: 'fixture', protocol_version: '2', capabilities: [] } } : { type: 'disconnected' } }); },
    send(text, deviceId) { submitMessage(text, scope.chat, { serverId: scope.host, threadSend: { store: sends, deviceId },
      newMessageId: () => 'shared-id', sendCommand: command => actions.push([scope.host, command]) }); },
    taskInputs(inputs, callback = true) { setTaskInputs({ ...inputs, onStopTask: callback ? (host, chat, task) => stops.push([host, chat, task]) : undefined }); },
    activeChat() { return activeConversationStore.getState().activeConversation?.id ?? null; },
    unavailable(host) { savedLinks.set(host, sessionStore.getState().statuses.get(host));
      sessionStore.setState(s => ({ statuses: new Map(s.statuses).set(host, { type: 'disconnected' }) })); },
    reconnect(host) { sessionStore.setState(s => ({ statuses: new Map(s.statuses).set(host, savedLinks.get(host)) })); },
    scope(host, chat, epoch) { conversationReadRouteStore.getState().select(host, chat, epoch);
      threadStore.getState().acceptEpoch(host, chat, epoch); setReadInputs(undefined); setCompleteThrough(0); setScope({ host, chat, epoch }); },
    batch(items, version) { const s = threadStore.getState(); const b = s.beginBatch(scope.host, scope.chat, scope.epoch);
      b.applyItems(items, version); b.commit({ fromVersion: 0, version, ranges: [{ start: 0, end: version }] });
      sends.getState().settle(s.snapshot(scope.host, scope.chat)); },
    commitUpdate(update) { flushSync(() => window.threadFixture.update(update)); },
    update(update) { threadStore.getState().applyUpdate(scope.host, update);
      sends.getState().settle(threadStore.getState().snapshot(scope.host, scope.chat)); }
  };
  return snapshot ? <div className="conversation" onKeyDown={event => { if (event.key === 'Escape') escapes.push('bubble'); }}><div className="conversation__covered">
    <ConversationListData />
    <output hidden data-testid="read-state">{JSON.stringify({ receipts, scope,
      marks: (rows ?? []).map(row => [row.serverId, row.id, row.read_up_to,
        isConversationUnread(row)]) })}</output>
    <ThreadItemsTimeline snapshot={snapshot} backgroundTasksOpen={backgroundTasksOpen} onBackgroundTasksOpenChange={setBackgroundTasksOpen} readInputs={readInputs && { ...readInputs, completeThrough }} sendInputs={{ connection, local: { ...local, hostId: scope.host, conversationId: scope.chat },
      onAction: (host, command) => actions.push([host, command]) }} taskInputs={taskInputs} turnRunning={turnRunning} foldTools onReply={(role, text) => replies.push(role + ':' + text)}
      onOpenMarkdownPath={path => paths.push(path)} />
    <textarea className="composer__input" aria-label="Fixture composer" onKeyDown={event => {
      if (turnRunning && event.key === 'Escape' && !event.nativeEvent.isComposing) escapes.push('interrupt');
    }} />
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

for (const width of [1280, 800]) test(`publishes only committed visible authoritative read evidence at ${width}`, async ({ launchPairedApp }) => {
  const server = await rendererFixture(), outbound: { host: string; chat: string; target: number; request: number }[] = []
  let replyLists = true
  const reply = (host: string, seed: ConversationSummary) => (bytes: Uint8Array) => {
    const e = decodeEnvelope(bytes)
    if (e.type === 'mark_conversation_read') {
      const p = e.payload as { conversation_id: string; up_to: number }
      outbound.push({ host, chat: p.conversation_id, target: p.up_to, request: e.id })
    }
    return replyLists && e.type === 'list_conversations' ? [seedConversationsFrame(seed)] : []
  }
  try {
    const { page, app, servers } = await launchPairedApp({ threadMode: 'native', buildReplyFrames:
      reply(FIRST_SERVER_ID, { ...SEEDED_ROW, read_up_to: 0, latest_entry_id: 999 })
    }, { rendererUrl: server.resolvedUrls!.local[0], secondServer: { threadMode: 'native', buildReplyFrames:
      reply(SECOND_SERVER_ID, { ...SECOND_SEEDED_ROW, read_up_to: 0 }) } })
    await page.locator('.channel-list__row-open').first().click()
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await expect.poll(() => page.evaluate(host => (window as unknown as { threadFixture: Fixture }).threadFixture.connected(host), SECOND_SERVER_ID)).toBe(true)
    replyLists = false // Hold refreshes so acknowledgements, rather than list replacement, prove confirmation.
    await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(width, 800); w.show(); w.focus() }, width)
    const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const targets = () => page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.readTargets)
    const state = async () => JSON.parse(await page.getByTestId('read-state').textContent() ?? '{}') as {
      receipts: [string, string][]; marks: [string, string, number, boolean][] }
    const mark = async (host: string) => (await state()).marks.find(r => r[0] === host && r[1] === SEEDED_ROW.id)
    let frameId = 100
    const receive = async (host: string, type: 'conversation_updated' | 'conversation_deleted' | 'conversations', payload: unknown, request?: number) => {
      const before = (await state()).receipts.length
      servers.find(s => s.serverId === host)!.daemon.pushFrame(encodeEnvelope({
        id: ++frameId, type, ts: '2026-10-15T12:00:00Z', payload, in_reply_to: request }))
      const event = { conversation_updated: 'conversationUpdated', conversation_deleted: 'conversationDeleted', conversations: 'conversationsReceived' }[type]
      await expect.poll(async () => (await state()).receipts.slice(before)).toEqual([[event, host]])
      await settle() // Receipt state and list-derived read state have both committed before absence checks.
    }
    const acknowledge = (host: string, target: number, request?: number) => receive(host, 'conversation_updated', {
      id: SEEDED_ROW.id, name: SEEDED_ROW.name, cwd: SEEDED_ROW.cwd, is_promoted: false,
      last_used_at: SEEDED_ROW.last_used_at, workspace_label: null, read_up_to: target }, request)
    const attempts = () => page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.readAttempts)
    const delivered = () => outbound.map(({ host, chat, target }) => ({ host, chat, target }))
    const expected = (host: string, target: number) => ({ host, chat: SEEDED_ROW.id, target })
    const reconnect = async (host: string) => {
      await page.evaluate(host => { const f = (window as unknown as { threadFixture: Fixture }).threadFixture;
        f.unavailable(host); f.reconnect(host); f.probe() }, host)
      await settle()
    }
    const read = async (shown: number | undefined, readerOpen = false, readUpTo = 0) => {
      await page.evaluate(({ shown, readerOpen, readUpTo }) => (window as unknown as { threadFixture: Fixture }).threadFixture.read({
        last_shown_version: shown, read_up_to: readUpTo, latest_entry_id: 999 }, readerOpen), { shown, readerOpen, readUpTo })
      await settle()
    }
    const batch = async (items: ThreadItem[], version: number, completion: Parameters<Fixture['readBatch']>[2] = 'complete') => {
      await page.evaluate(({ items, version, completion }) => (window as unknown as { threadFixture: Fixture }).threadFixture.readBatch(items, version, completion), { items, version, completion })
      await settle()
    }
    const scope = async (host = FIRST_SERVER_ID, epoch = 'read') => {
      await page.evaluate(({ host, chat, epoch }) => (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, chat, epoch), { host, chat: SEEDED_ROW.id, epoch })
      await settle()
    }
    const focus = async (focused: boolean) => {
      await page.evaluate(focused => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
        window.dispatchEvent(new Event(focused ? 'focus' : 'blur')) }, focused)
      await settle()
    }
    const row = (id: number) => page.locator(`[data-read-row="${id}"]`)
    await scope()
    await read(undefined)
    const queued = item(500, 'user_message', { text: 'Unordered queue' }, { order: 0, status: 'queued' })
    await batch([item(7, 'assistant_message', { text: 'Committed reply' }), queued], 10)
    await expect(row(7)).toContainText('Committed reply')
    expect(await targets()).toEqual([])
    await read(0); expect(await targets()).toEqual([])
    await read(10)
    expect(await targets()).toEqual([])
    await batch([{ ...queued, rev: 501, shown: false }], 10)
    await expect.poll(targets).toEqual([10])
    await expect.poll(attempts).toEqual([expected(FIRST_SERVER_ID, 10)])
    await expect.poll(delivered).toEqual([expected(FIRST_SERVER_ID, 10)])
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.receivedMark())).toBe(0)
    // Sending alone leaves the received mark untouched; only an owning-daemon receipt confirms it.
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.probe())).toEqual([10])
    await page.evaluate(() => { const f = (window as unknown as { threadFixture: Fixture }).threadFixture;
      f.read({ last_shown_version: 11, read_up_to: 0 });
      f.readBatch([{ id: 7, rev: 11, kind: 'assistant_message', order: 7, shown: true, status: 'done', active: false,
        summary: 'reply', content: { text: 'Committed reply appended' } }], 11, 'complete');
      if (document.querySelector('[data-read-row="7"]')?.textContent?.includes('appended')) throw new Error('probe ran after commit');
      f.probe();
      if (f.readTargets.includes(11)) throw new Error('uncommitted target escaped');
    })
    await expect(row(7)).toContainText('appended')
    await expect.poll(targets).toEqual([10, 11])
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.precommitTargets)).not.toContain(11)

    await focus(false); await read(12)
    await batch([item(7, 'assistant_message', { text: 'Blurred append' }, { rev: 12 })], 12)
    await expect(row(7)).toContainText('Blurred append')
    expect(await targets()).toEqual([10, 11])
    await focus(true); await expect.poll(targets).toEqual([10, 11, 12])
    await read(13, true)
    await batch([item(7, 'assistant_message', { text: 'Reader-covered append' }, { rev: 13 })], 13)
    await expect(row(7)).toContainText('Reader-covered append')
    expect(await targets()).toEqual([10, 11, 12])
    await read(13); await expect.poll(targets).toEqual([10, 11, 12, 13])

    // Large shown rows require their own uncovered trailing edge, even with a hidden trailing item.
    await read(14, true)
    await batch([item(8, 'assistant_message', { text: 'Long reply. '.repeat(3000) }),
      item(999, 'turn_end', { stop_reason: 'end_turn' }, { order: 1000, shown: false })], 14)
    const thread = page.getByLabel('Conversation history')
    await thread.focus(); await thread.press('Home')
    await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
    await read(14)
    expect(await targets()).not.toContain(14)
    await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(targets).toContain(14)
    await expect(row(999)).toHaveCount(0)

    // A bottom chrome rectangle covers the row even though the scroller itself contains it.
    await read(15, true)
    await batch([item(9, 'assistant_message', { text: 'Obscured newest row' })], 15)
    await thread.evaluate(el => { el.scrollTop = el.scrollHeight;
      const cover = document.createElement('div'); cover.className = 'conversation__input-chrome'; cover.id = 'read-cover';
      cover.style.cssText = 'position:fixed;inset:0;z-index:100;pointer-events:none'; el.closest('.conversation__covered')!.append(cover) })
    await read(15); expect(await targets()).not.toContain(15)
    await page.evaluate(() => { document.getElementById('read-cover')!.remove(); (window as unknown as { threadFixture: Fixture }).threadFixture.probe() })
    await expect.poll(targets).toContain(15)

    // Full older pages and unfinished/abandoned catch-up never supply newest completion authority.
    await read(16)
    await batch([item(9, 'assistant_message', { text: 'Incomplete text' }, { rev: 16 })], 16, 'incomplete')
    await expect(row(9)).toContainText('Incomplete text'); expect(await targets()).not.toContain(16)
    await batch([item(9, 'assistant_message', { text: 'Abandoned text' }, { rev: 17 })], 17, 'abandon')
    await expect(row(9)).toContainText('Abandoned text'); expect(await targets()).not.toContain(16)
    await batch([item(1, 'user_message', { text: 'Older page' })], 20, 'older')
    await expect(row(1)).toContainText('Older page'); expect(await targets()).not.toContain(16)
    await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.repair(22))
    await read(22); expect(await targets()).not.toContain(22)
    await batch([item(9, 'assistant_message', { text: 'Repaired complete text' }, { rev: 22 })], 22)
    await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(targets).toContain(22)
    await expect.poll(() => delivered().at(-1)).toEqual(expected(FIRST_SERVER_ID, 22))
    await acknowledge(FIRST_SERVER_ID, 4, outbound.at(-1)!.request)
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 4, true])
    await page.evaluate(host => (window as unknown as { threadFixture: Fixture }).threadFixture.unavailable(host), FIRST_SERVER_ID)
    await read(23, true)
    await batch([item(10, 'assistant_message', { text: 'Not evidenced while reader open' })], 23)
    await page.evaluate(host => { // Link recovery retries the old evidence without upgrading to summary 23.
      (window as unknown as { threadFixture: Fixture }).threadFixture.reconnect(host)
    }, FIRST_SERVER_ID)
    await expect.poll(targets).toEqual([10, 11, 12, 13, 14, 15, 22, 22])
    await expect.poll(attempts).toEqual([10, 11, 12, 13, 14, 15, 22, 22].map(t => expected(FIRST_SERVER_ID, t)))
    await expect.poll(delivered).toEqual(await attempts())
    await acknowledge(FIRST_SERVER_ID, 22, outbound.at(-1)!.request)
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 22, true])
    const confirmed = await attempts()
    await reconnect(FIRST_SERVER_ID)
    expect(await attempts()).toEqual(confirmed) // A confirming receipt retires 22; hidden summary 23 cannot replace it.
    await read(23)
    await expect.poll(() => delivered().at(-1)).toEqual(expected(FIRST_SERVER_ID, 23))
    const priorEpoch = await attempts(), priorEpochRequest = outbound.at(-1)!.request
    await scope(FIRST_SERVER_ID, 'replacement')
    await read(24, true)
    await batch([item(10, 'assistant_message', { text: 'Replacement epoch' })], 24)
    await expect(row(10)).toContainText('Replacement epoch')
    await acknowledge(FIRST_SERVER_ID, 23, priorEpochRequest) // Late receipt from the discarded pending epoch.
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 23, true])
    await reconnect(FIRST_SERVER_ID)
    expect(await attempts()).toEqual(priorEpoch)
    expect(await targets()).not.toContain(24)
    await read(24)
    await expect.poll(targets).toContain(24)
    await capturePairedApp(app, page, `/tmp/builder-1936/read-${width}.png`)

    // A nested newest row is excluded while its actual ancestor is collapsed.
    await read(25, true)
    await batch([item(20, 'agent', { name: 'Agent', tool_use_id: 'parent', input_summary: 'Parent', input: {},
      result: { is_error: false, result_summary: 'launched' } }, { status: 'finished' }),
      item(21, 'assistant_message', { text: 'Nested newest content' }, { parent: 20 })], 25)
    await expect(row(21)).toBeHidden()
    await read(25); expect(await targets()).not.toContain(25)
    await row(20).getByRole('button').first().click()
    await expect(row(21)).toBeVisible()
    await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(targets).toContain(25)
    await expect.poll(() => delivered().at(-1)).toEqual(expected(FIRST_SERVER_ID, 25))
    const oldHostRequest = outbound.at(-1)!.request
    await receive(SECOND_SERVER_ID, 'conversations', { conversations: [{ ...SECOND_SEEDED_ROW,
      id: SEEDED_ROW.id, last_shown_version: 25, read_up_to: 0 }] })
    await scope(SECOND_SERVER_ID)
    await read(25); await batch([item(21, 'assistant_message', { text: 'Other host' })], 25)
    await expect(row(21)).toContainText('Other host')
    await expect.poll(async () => (await attempts()).at(-1)).toEqual(expected(SECOND_SERVER_ID, 25))
    await acknowledge(FIRST_SERVER_ID, 25, oldHostRequest) // Same ID and target, different owning daemon.
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 25, false])
    expect(await mark(SECOND_SERVER_ID)).toEqual([SECOND_SERVER_ID, SEEDED_ROW.id, 0, true])
    await reconnect(SECOND_SERVER_ID)
    await expect.poll(async () => (await attempts()).slice(-2)).toEqual([expected(SECOND_SERVER_ID, 25), expected(SECOND_SERVER_ID, 25)])
    expect(delivered().filter(a => a.host === SECOND_SERVER_ID)).toEqual([]) // Main retains its ambiguous-owner refusal.

    // Deletion and owner loss invalidate claims while their committed content and observer stay mounted.
    await page.evaluate(host => (window as unknown as { threadFixture: Fixture }).threadFixture.unavailable(host), SECOND_SERVER_ID)
    await receive(SECOND_SERVER_ID, 'conversation_deleted', { id: SEEDED_ROW.id })
    await receive(SECOND_SERVER_ID, 'conversations', { conversations: [] })
    const deleted = await attempts()
    await acknowledge(SECOND_SERVER_ID, 25)
    expect(await mark(SECOND_SERVER_ID)).toBeUndefined()
    await expect(row(21)).toContainText('Other host')
    await page.evaluate(host => { const f = (window as unknown as { threadFixture: Fixture }).threadFixture; f.reconnect(host); f.probe() }, SECOND_SERVER_ID)
    await settle(); expect(await attempts()).toEqual(deleted)
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 25, false])

    await scope(SECOND_SERVER_ID, 'owner-loss')
    await receive(SECOND_SERVER_ID, 'conversations', { conversations: [{ ...SECOND_SEEDED_ROW,
      id: SEEDED_ROW.id, last_shown_version: 26, read_up_to: 0 }] })
    await read(26); await batch([item(21, 'assistant_message', { text: 'Owner-loss content' }, { rev: 26 })], 26)
    await expect(row(21)).toContainText('Owner-loss content')
    await expect.poll(async () => (await attempts()).at(-1)).toEqual(expected(SECOND_SERVER_ID, 26))
    const ownerLost = await attempts()
    await page.evaluate(host => (window as unknown as { threadFixture: Fixture }).threadFixture.loseOwner(host), SECOND_SERVER_ID)
    await expect.poll(() => mark(SECOND_SERVER_ID)).toBeUndefined() // Committed list removal, not a timer-only absence.
    await acknowledge(SECOND_SERVER_ID, 26)
    await reconnect(SECOND_SERVER_ID)
    await expect(row(21)).toContainText('Owner-loss content')
    expect(await attempts()).toEqual(ownerLost)
    expect(await mark(FIRST_SERVER_ID)).toEqual([FIRST_SERVER_ID, SEEDED_ROW.id, 25, false])
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})

test('settles sends and targets genuine queue handles through authoritative terminal revisions', async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const { page, app } = await launchPairedApp({ threadMode: 'native',}, { rendererUrl: server.resolvedUrls!.local[0] })
    await page.locator('.channel-list__row-open').first().click()
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    const chat = 'snapshot-owning-chat'
    const scope = (host = FIRST_SERVER_ID, conversation = chat) => page.evaluate(({ host, conversation }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, conversation, 'sends'), { host, conversation })
    const connection = (connected: boolean) => page.evaluate(({ host, connected }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.sendConnection(host, connected), { host: FIRST_SERVER_ID, connected })
    let version = 1000
    const batch = (items: ThreadItem[]) => page.evaluate(({ items, version }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, version), { items, version: ++version })
    const change = (id: number, base_rev: number, changes: Record<string, unknown>) => page.evaluate(update =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), {
        type: 'thread_item_changed', payload: { conversation_id: chat, epoch: 'sends', version: ++version,
          item_id: id, base_rev, rev: version, changes }
      } satisfies ThreadUpdate)
    const actions = () => page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.actions)
    const row = (id: number) => page.locator(`[data-read-row="${id}"]`)
    const queued = (id: number, handle: number, text: string, device = 'device') => item(id, 'user_message', {
      text, device_id: device, message_id: 'shared-id', queued_msg_id: handle,
      attachments: [{ attachment_id: 'daemon-file', filename: 'daemon.pdf' }]
    }, { order: 0, active: true, status: 'queued', rev: version })
    await scope(); await connection(true)
    await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.send('local display path', 'device'))
    await expect(page.getByText('local display path', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Sending…', { exact: true })).toBeVisible()
    // Equal message ids from a peer or another scope cannot acknowledge the local send.
    await batch([queued(101, 8, 'peer truth', 'peer')])
    await expect(page.getByText('local display path', { exact: true })).toHaveCount(1)
    await scope(SECOND_SERVER_ID); await batch([queued(100, 7, 'other host truth')])
    await expect(page.getByText('local display path', { exact: true })).toHaveCount(0)
    await scope(); await expect(page.getByText('local display path', { exact: true })).toHaveCount(1)
    // The first own observation is a catch-up full item: acknowledgement was never supplied.
    const accepted = queued(100, 7, 'daemon normalized truth')
    await batch([accepted]); await batch([accepted])
    await expect(page.getByText('local display path', { exact: true })).toHaveCount(0)
    await expect(row(100)).toContainText('daemon normalized truth')
    await expect(row(100)).toContainText('daemon.pdf')
    await expect(page.getByText('Waiting for Claude', { exact: true })).toBeVisible()
    await expect(row(100).getByRole('button', { name: 'Send queued message now' })).toBeVisible()
    await page.screenshot({ path: '/tmp/builder-1906/queued.png', animations: 'disabled' })
    await row(100).getByRole('button', { name: 'Send queued message now' }).click()
    await expect.poll(actions).toContainEqual([FIRST_SERVER_ID, { type: 'sendQueuedNow', payload: { conversation_id: chat, queued_msg_id: 7 } }])
    await expect(row(100)).toContainText('daemon normalized truth')
    await connection(false); await expect(row(100).getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
    await connection(true)
    await change(100, accepted.rev, { order: 50, status: 'delivered', active: false })
    await expect(row(100)).toHaveCount(1)
    await expect(row(100).getByRole('button', { name: 'Send queued message now' })).toHaveCount(0)
    await expect(page.getByText('Waiting for Claude', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0)
    const dropped = queued(102, 9, 'drop truth')
    await batch([dropped]); await row(102).getByRole('button', { name: 'Drop queued message' }).click()
    await expect.poll(actions).toContainEqual([FIRST_SERVER_ID, { type: 'dequeueMessage', payload: { conversation_id: chat, queued_msg_id: 9 } }])
    await expect(row(102)).toHaveCount(1)
    await change(102, dropped.rev, { active: false, status: 'dropped', shown: false })
    await expect(row(102)).toHaveCount(0)
    const lost = queued(103, 7, 'restart loss')
    await batch([lost]); await change(103, lost.rev, { status: 'lost', active: false })
    await expect(row(103)).toContainText('Not delivered')
    await batch([queued(104, 7, 'reused queue id')])
    await expect(row(103).getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
    await expect(row(100).getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
    await expect(row(104).getByRole('button', { name: 'Drop queued message' })).toBeVisible()
  } finally { await server.httpServer.close() }
})

for (const width of [1280, 800]) test(`authoritative items retain identity, actions and scroll at ${width}`, async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const asks: unknown[] = []
    const { page, app } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes)
      if (e.type === 'request_attachment') asks.push(e.payload)
      return e.type === 'list_conversations' ? [seedConversationsFrame()] : []
    } }, { rendererUrl: server.resolvedUrls!.local[0] })
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    let version = 100
    const revs = new Map<number, number>()
    const scope = async (host = FIRST_SERVER_ID, chat = SEEDED_ROW.id, epoch = 'epoch') => page.evaluate(({ host, chat, epoch }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, chat, epoch), { host, chat, epoch })
    const batch = async (items: ThreadItem[], certifiedVersion = ++version) => {
      for (const i of items) revs.set(i.id, i.rev)
      await page.evaluate(({ items, version }) => (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, version),
        { items, version: certifiedVersion })
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
    for (const [host, chat, epoch] of [['other-host', SEEDED_ROW.id, 'epoch'], [FIRST_SERVER_ID, 'other-chat', 'epoch'], [FIRST_SERVER_ID, SEEDED_ROW.id, 'other-epoch']]) {
      await scope(host, chat, epoch); await batch(initial)
      await expect(run).toHaveAttribute('aria-expanded', 'false')
      await run.click(); await first.locator('button').click()
      await expect(first.locator('.tool-row__result')).toBeVisible()
    }
    await scope(FIRST_SERVER_ID, SEEDED_ROW.id, 'scroll')
    version = 1000
    await batch(Array.from({ length: 25 }, (_, index) => item(200 + index, 'assistant_message', { text: `Row ${index}\n\n` + 'A reading paragraph. '.repeat(15) })))
    const distance = () => thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(distance).toBeLessThanOrEqual(1)
    // Full authoritative revision while following stays at newest.
    await batch([item(224, 'assistant_message', { text: 'Newest growth\n\n' + 'More lines.\n\n'.repeat(30) }, { rev: ++version })])
    await expect.poll(distance).toBeLessThanOrEqual(1)
    await thread.focus(); await page.keyboard.press('Home')
    await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
    // Older-page completion changes the presentation without advancing its protocol watermark.
    for (const [id, certifiedVersion] of [[100, version], [101, 900]]) {
      await thread.focus(); await page.keyboard.press('Home')
      await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
      const firstRow = (await thread.locator(':scope > div').first().elementHandle())!
      const originalTop = (await firstRow.boundingBox())!.y
      await batch([item(id, 'user_message', { text: 'Older page '.repeat(30) }, { status: 'delivered' })], certifiedVersion)
      await expect.poll(async () => (await firstRow.boundingBox())!.y).toBeCloseTo(originalTop, 0)
    }
    expect(await distance()).toBeGreaterThan(100)
    const anchor = page.locator('[data-thread-role="assistant"]').nth(2)
    await thread.evaluate(el => new Promise<void>(resolve => {
      el.scrollTop = 420
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    const before = (await anchor.boundingBox())!.y
    await batch([item(100, 'user_message', { text: 'Revision above reader\n'.repeat(30) }, { status: 'delivered', rev: 899 })], 900)
    await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
    expect(await distance()).toBeGreaterThan(100)
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})


for (const realRetrieval of [false, true]) test(realRetrieval
  ? 'snapshot attachment scope through daemon retrieval'
  : 'snapshot attachment actions retain their host and conversation across reused IDs', async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const asks: { host: string; payload: unknown }[] = []
    const pictureId = '7a8b9c0d-1e2f-4a3b-8c9d-7e8f9a0b1c2d'
    const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    const replies = (host: string) => (bytes: Uint8Array) => {
      const e = decodeEnvelope(bytes)
      if (e.type === 'request_attachment') {
        asks.push({ host, payload: e.payload })
        const { attachment_id } = e.payload as { attachment_id: string }
        if (attachment_id === pictureId) return [encodeEnvelope({ id: e.id + 900, in_reply_to: e.id,
          type: 'attachment_chunk', ts: '2026-10-10T12:00:00Z', payload: {
            attachment_id, index: 0, total_chunks: 1, filename: 'picture.png', mime_type: 'image/png',
            size: picture.length, sha256: createHash('sha256').update(picture).digest('hex'), data: picture.toString('base64')
          } })]
      }
      return e.type === 'list_conversations'
        ? [seedConversationsFrame(host === FIRST_SERVER_ID ? SEEDED_ROW : SECOND_SEEDED_ROW)] : []
    }
    const { page, app } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: replies(FIRST_SERVER_ID) }, {
      rendererUrl: server.resolvedUrls!.local[0], secondServer: { threadMode: 'native', buildReplyFrames: replies(SECOND_SERVER_ID) }
    })
    await page.locator('.channel-list__row-open').first().click()
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await app.evaluate(({ ipcMain, shell }, channel) => {
      const opens: AttachmentOpenRequest[] = []
      ;(globalThis as unknown as { attachmentOpens: AttachmentOpenRequest[] }).attachmentOpens = opens
      ipcMain.on(channel, (_event, request) => opens.push(request))
      Object.defineProperty(shell, 'openPath', { value: async () => '', configurable: true })
    }, ATTACHMENT_OPEN_CHANNEL)
    const opens = () => app.evaluate(() => (globalThis as unknown as { attachmentOpens: AttachmentOpenRequest[] }).attachmentOpens)
    if (!realRetrieval) await app.evaluate(({ ipcMain }, channels) => {
      const asks: unknown[] = []
      ;(globalThis as unknown as { attachmentAsks: unknown[] }).attachmentAsks = asks
      // Renderer-only variant: scope reaches real preload; the sibling variant uses production retrieval.
      ipcMain.removeAllListeners(channels.retrieval)
      ipcMain.removeAllListeners(channels.bytes)
      ipcMain.on(channels.retrieval, (event, request) => {
        asks.push(request)
        event.sender.send(channels.retrievalEvent, request.attachmentId === channels.pictureId
          ? { type: 'completed', attachmentId: request.attachmentId, conversationId: request.conversationId, serverId: request.serverId }
          : { type: 'failed', reason: 'not-found', attachmentId: request.attachmentId, conversationId: request.conversationId, serverId: request.serverId })
      })
      ipcMain.on(channels.bytes, (event, request) => event.sender.send(channels.bytesEvent,
        { type: 'delivered', attachmentId: request.attachmentId, bytes: new Uint8Array(channels.picture) }))
    }, { retrieval: ATTACHMENT_RETRIEVAL_CHANNEL, retrievalEvent: ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
      bytes: ATTACHMENT_BYTES_CHANNEL, bytesEvent: ATTACHMENT_BYTES_EVENT_CHANNEL, picture: [...picture], pictureId })
    const retrievals = () => realRetrieval ? Promise.resolve(asks.map(a => {
      const p = a.payload as { conversation_id: string; attachment_id: string }
      return { serverId: a.host, conversationId: p.conversation_id, attachmentId: p.attachment_id }
    })) : app.evaluate(() => (globalThis as unknown as {
      attachmentAsks: { serverId: string; conversationId: string; attachmentId: string }[]
    }).attachmentAsks)
    const chat = 'snapshot-chat-B'
    const items = [
      item(10, 'user_message', { text: 'scoped attachments', attachments: [
        { attachment_id: 'supplied-file', filename: 'report.pdf' },
        { attachment_id: pictureId, filename: 'picture.png' }
      ] }, { status: 'delivered' }),
      item(20, 'notice', { attachment_id: 'offered-file', filename: 'offered.pdf' }, { subtype: 'attachment_offered' }),
      item(30, 'notice', { attachment_id: pictureId, filename: 'offered.png' }, { subtype: 'attachment_offered' })
    ]
    for (const host of [FIRST_SERVER_ID, SECOND_SERVER_ID]) {
      await page.evaluate(({ host, chat }) => {
        const f = (window as unknown as { threadFixture: Fixture }).threadFixture
        f.scope(host, chat, 'epoch')
      }, { host, chat })
      await page.evaluate(items => (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, 1000), items)
      expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.activeChat())).toBe(SEEDED_ROW.id)
      const images = page.getByRole('button', { name: 'Attached image' })
      await expect(images).toHaveCount(2)
      await expect.poll(() => images.locator('img').evaluateAll(rows => rows.every(row => row instanceof HTMLImageElement && row.complete && row.naturalWidth > 0) && rows.length === 2)).toBe(true)
      await expect.poll(async () => (await retrievals()).filter(a => a.serverId === host && a.attachmentId === pictureId).length).toBeGreaterThan(0)
      for (const name of ['report.pdf', 'offered.pdf']) await page.getByRole('button', { name, exact: true }).click()
      for (const index of [0, 1]) await images.nth(index).click()
      await expect.poll(async () => (await opens()).filter(o => o.serverId === host)).toHaveLength(4)
      expect((await opens()).filter(o => o.serverId === host)).toEqual([
        { conversationId: chat, serverId: host, attachmentId: 'supplied-file', localOnly: true },
        { conversationId: chat, serverId: host, attachmentId: 'offered-file', localOnly: true },
        { conversationId: chat, serverId: host, attachmentId: pictureId },
        { conversationId: chat, serverId: host, attachmentId: pictureId }
      ])
      await expect.poll(async () => (await retrievals()).filter(a => a.serverId === host)).toEqual(expect.arrayContaining([
        { serverId: host, conversationId: chat, attachmentId: 'supplied-file' },
        { serverId: host, conversationId: chat, attachmentId: 'offered-file' },
        { serverId: host, conversationId: chat, attachmentId: pictureId }
      ]))
    }
    // Availability must follow the snapshot host even while the globally selected host stays connected.
    await page.evaluate(host => (window as unknown as { threadFixture: Fixture }).threadFixture.unavailable(host), SECOND_SERVER_ID)
    await expect(page.getByRole('button', { name: 'report.pdf', exact: true })).toBeDisabled()
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})

test('a late retrieval disconnect cannot settle a switched thread with reused image IDs', async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const asks = new Map<string, number>()
    const pictureId = '7a8b9c0d-1e2f-4a3b-8c9d-7e8f9a0b1c2d'
    const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    const replies = (host: string) => (bytes: Uint8Array) => {
      const e = decodeEnvelope(bytes)
      if (e.type === 'request_attachment') asks.set(host, e.id)
      return e.type === 'list_conversations'
        ? [seedConversationsFrame(host === FIRST_SERVER_ID ? SEEDED_ROW : SECOND_SEEDED_ROW)] : []
    }
    const { page, servers } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: replies(FIRST_SERVER_ID) }, {
      rendererUrl: server.resolvedUrls!.local[0], secondServer: { threadMode: 'native', buildReplyFrames: replies(SECOND_SERVER_ID) }
    })
    await page.locator('.channel-list__row-open').first().click()
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await page.evaluate(() => {
      const outcomes: unknown[] = []
      ;(window as unknown as { retrievalOutcomes: unknown[] }).retrievalOutcomes = outcomes
      window.pyry.onAttachmentRetrievalEvent(event => outcomes.push(event))
    })
    // Actual IPC boundary: invalid host asks are silent even when another paired host is available.
    await page.evaluate(({ pictureId }) => {
      for (const serverId of [null, '', 7, 'x'.repeat(257)]) window.pyry.requestAttachment({
        serverId, conversationId: 'unlisted', attachmentId: pictureId
      } as never)
      window.pyry.requestAttachment({ serverId: 'unknown', conversationId: 'unlisted', attachmentId: pictureId })
    }, { pictureId })
    const outcomes = () => page.evaluate(() => (window as unknown as { retrievalOutcomes: unknown[] }).retrievalOutcomes)
    await expect.poll(outcomes).toEqual([{ type: 'failed', serverId: 'unknown', conversationId: 'unlisted', attachmentId: pictureId, reason: 'not-connected' }])
    expect(asks.size).toBe(0)
    for (const host of [FIRST_SERVER_ID, SECOND_SERVER_ID]) {
      await page.evaluate(host => {
        const f = (window as unknown as { threadFixture: Fixture }).threadFixture
        f.scope(host, 'unlisted', 'epoch')
      }, host)
      await page.evaluate(pictureId => (window as unknown as { threadFixture: Fixture }).threadFixture.batch([
        { id: 10, rev: 10, kind: 'user_message', order: 10, status: 'delivered', active: false, shown: true, summary: '',
          content: { text: 'picture', attachments: [{ attachment_id: pictureId, filename: 'picture.png' }] } }
      ], 100), pictureId)
      await expect.poll(() => asks.has(host)).toBe(true)
    }
    servers[0].forwarder.closeClientLeg(4401)
    await expect.poll(outcomes).toEqual(expect.arrayContaining([
      { type: 'failed', serverId: FIRST_SERVER_ID, conversationId: 'unlisted', attachmentId: pictureId, reason: 'connection-lost' }
    ]))
    // Receipt barrier above ensures the old host's terminal has actually crossed preload.
    const images = page.getByRole('button', { name: 'Attached image' })
    await expect(images.locator('img')).toHaveCount(0)
    servers[1].daemon.pushFrame(encodeEnvelope({ id: 9000, in_reply_to: asks.get(SECOND_SERVER_ID)!,
      type: 'attachment_chunk', ts: '2026-10-10T12:00:00Z', payload: {
        attachment_id: pictureId, index: 0, total_chunks: 1, filename: 'picture.png', mime_type: 'image/png',
        size: picture.length, sha256: createHash('sha256').update(picture).digest('hex'), data: picture.toString('base64')
      } }))
    await expect.poll(() => images.locator('img').evaluateAll(rows => rows.length === 1 && rows.every(row => row instanceof HTMLImageElement && row.complete && row.naturalWidth > 0))).toBe(true)
    await expect.poll(outcomes).toEqual(expect.arrayContaining([
      { type: 'completed', serverId: SECOND_SERVER_ID, conversationId: 'unlisted', attachmentId: pictureId }
    ]))
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})

for (const width of [1280, 800]) test(`supplied agents repair nesting and retain lifecycle, expansion and scroll at ${width}`, async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const { page, app } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => decodeEnvelope(bytes).type === 'list_conversations'
      ? [seedConversationsFrame()] : [] }, { rendererUrl: server.resolvedUrls!.local[0] })
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    let version = 1000
    const revisions = new Map<number, number>()
    const scope = async (host = FIRST_SERVER_ID, chat = SEEDED_ROW.id, epoch = 'agents') => page.evaluate(({ host, chat, epoch }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, chat, epoch), { host, chat, epoch })
    const batch = async (items: ThreadItem[]) => {
      for (const i of items) revisions.set(i.id, i.rev)
      await page.evaluate(({ items, version }) => (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, version),
        { items, version: ++version })
    }
    const change = async (id: number, changes: Record<string, unknown>) => {
      const base_rev = revisions.get(id)!, rev = ++version; revisions.set(id, rev)
      await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), {
        type: 'thread_item_changed', payload: { conversation_id: SEEDED_ROW.id, epoch: 'agents', version,
          item_id: id, base_rev, rev, changes }
      })
    }
    const agent = (id: number, fields: Partial<ThreadItem> = {}) => item(id, 'agent', {
      name: 'Agent', tool_use_id: `call-${id}`, input_summary: `agent-${id}`, input: { description: `agent-${id}` },
      task_id: `task-${id}`, task_link: { tasks: [{ task_id: `task-${id}`, tool_call_id: `call-${id}` }] },
      result: { is_error: false, result_summary: 'immediate launch result' }
    }, { status: 'running', active: true, session: 'prior-session', agent: 'claude', ...fields })
    const row = (id: number) => page.locator(`[data-read-row="${id}"]`)
    const chip = (id: number) => row(id).locator('.tool-row__chip')
    const thread = page.getByLabel('Conversation history')
    const distance = () => thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await scope()
    await batch([item(40, 'tool_call', { name: 'Read', input_summary: 'early child', result: {
      is_error: false, result_summary: 'child output' } }, { parent: 10 }),
      item(20, 'assistant_message', { text: 'Main reply' }, { active: true, session: 'prior-session', turn: 'main' }),
      item(41, 'tool_call', { name: 'Read', input_summary: 'root one' }),
      item(42, 'tool_call', { name: 'Read', input_summary: 'root two' })])
    const folded = page.locator('.tool-run button')
    await expect(folded).toHaveAttribute('aria-expanded', 'false')
    await folded.click()
    await expect(row(40)).toHaveClass(/depth-0/)
    await chip(40).click()
    await row(40).evaluate(el => { (window as unknown as { agentChild: Element }).agentChild = el })
    await batch([agent(10), agent(30)])
    await expect(page.locator('.agent-start-marker')).toHaveCount(2)
    expect(await thread.locator('[data-read-row]').evaluateAll(rows => rows.map(row => row.getAttribute('data-read-row'))))
      .toEqual(['20', '41', '42', '10', '40', '30'])
    await expect(row(40)).toHaveCount(1)
    await expect(row(40)).toBeHidden()
    await expect(folded).toHaveAttribute('aria-expanded', 'true')
    await expect(chip(10)).toContainText('running · 1 tool')
    await chip(10).click()
    await expect(row(40)).toBeVisible()
    await expect(row(40).locator('.tool-row__result')).toHaveText('child output')
    expect(await row(40).evaluate(el => el === (window as unknown as { agentChild: Element }).agentChild)).toBe(true)
    await change(40, { parent: 30 })
    await expect(row(40)).toBeHidden()
    await batch([item(35, 'tool_call', { name: 'Read', input_summary: 'older folded member' })])
    await expect(folded).toHaveAttribute('aria-expanded', 'true')
    await expect(chip(10)).toContainText('0 tools')
    await chip(30).click()
    await expect(row(40).locator('.tool-row__result')).toBeVisible()
    expect(await row(40).evaluate(el => el === (window as unknown as { agentChild: Element }).agentChild)).toBe(true)
    await chip(30).click()
    await page.locator('.agent-start-marker').filter({ hasText: 'agent-30' }).click()
    await expect(chip(30)).toHaveAttribute('aria-expanded', 'false')
    await expect(row(40)).toBeHidden()
    await change(20, { active: false, content: { text: 'Main reply complete' } })
    await batch([item(60, 'turn_end', { stop_reason: 'end_turn' }, { session: 'prior-session', turn: 'main' }),
      item(70, 'assistant_message', { text: 'work after main reply' }, { parent: 30, active: true })])
    await chip(30).click()
    await expect(row(70)).toBeVisible()
    await expect(chip(30)).toContainText('running ·')
    await expect(row(20).locator('.bubble__cursor')).toHaveCount(0)
    await expect(row(70).locator('.bubble__cursor')).toHaveCount(1)
    await change(30, { active: true, status: 'stopping' })
    await expect(chip(30)).toContainText('Stopping')
    await change(30, { active: false, status: 'stopped', ended_order: 65 })
    await expect(chip(30)).toContainText('Stopped')
    await expect(chip(30)).not.toContainText('running ·')
    expect(await thread.locator('[data-read-row]').evaluateAll(rows => rows.map(row => row.getAttribute('data-read-row'))))
      .toEqual(['20', '35', '41', '42', '60', '30', '40', '70', '10'])
    await chip(30).click()
    await page.locator('.agent-start-marker').filter({ hasText: 'agent-30' }).click()
    await expect(chip(30)).toHaveAttribute('aria-expanded', 'false')
    await chip(30).click()
    await capturePairedApp(app, page, `/tmp/builder-1937/agents-${width}.png`)

    await batch(Array.from({ length: 20 }, (_, i) => item(100 + i, 'assistant_message', { text: `Reading row ${i}\n\n` + 'Paragraph. '.repeat(100) })))
    await expect(row(119)).toContainText('Reading row 19')
    // Registered after React's target scroll listener: this records processed motion,
    // rather than treating a geometry read as acknowledgement of the queued event.
    await thread.evaluate(el => {
      const probe = { count: 0, top: el.scrollTop, remove: () => {},
        async ready(after: number): Promise<{ stable: boolean; processed: boolean }> {
          const sample = () => ({ top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight,
            width: el.clientWidth, anchor: el.querySelector('[data-read-row="100"]')!.getBoundingClientRect().top,
            count: probe.count, processedTop: probe.top })
          let previous = sample(), stable = true
          for (let frame = 0; frame < 20; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            const next = sample()
            if (JSON.stringify(next) !== JSON.stringify(previous)) stable = false
            previous = next
          }
          return { stable, processed: previous.count > after && previous.processedTop === previous.top }
        } }
      const onScroll = () => { probe.count++; probe.top = el.scrollTop }
      el.addEventListener('scroll', onScroll)
      probe.remove = () => el.removeEventListener('scroll', onScroll)
      ;(window as unknown as { agentScroll: typeof probe }).agentScroll = probe
    })
    const settled = async (after = -1) => {
      await expect.poll(() => page.evaluate(after => (window as unknown as {
        agentScroll: { ready: (after: number) => Promise<{ stable: boolean; processed: boolean }> }
      }).agentScroll.ready(after), after)).toEqual({ stable: true, processed: true })
    }
    await thread.focus(); await page.keyboard.press('End')
    await expect.poll(distance).toBeLessThanOrEqual(1)
    await settled()
    await change(10, { active: false, status: 'finished', ended_order: 125 })
    await expect(chip(10)).toContainText('Finished')
    await expect.poll(distance).toBeLessThanOrEqual(1)
    await settled()
    await thread.focus(); await page.keyboard.press('Home')
    await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
    await settled()
    const base_rev = revisions.get(40)!, rev = ++version; revisions.set(40, rev)
    // Force the update to commit in this task immediately after readiness. Without
    // the processing barrier, this schedule deterministically restores Home's anchor.
    const held = await row(100).evaluate(async (el, update) => {
      const thread = el.parentElement!
      const probe = (window as unknown as { agentScroll: { count: number;
        ready: (after: number) => Promise<{ stable: boolean; processed: boolean }> } }).agentScroll
      const after = probe.count
      el.scrollIntoView({ block: 'start' })
      let ready = await probe.ready(after)
      while (!ready.stable || !ready.processed) ready = await probe.ready(after)
      const before = el.getBoundingClientRect().top
      const aligned = before - thread.getBoundingClientRect().top
      const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight
      ;(window as unknown as { threadFixture: Fixture }).threadFixture.commitUpdate(update)
      return { before, aligned, distance }
    }, { type: 'thread_item_changed', payload: { conversation_id: SEEDED_ROW.id, epoch: 'agents', version,
      item_id: 40, base_rev, rev, changes: { parent: 10 } } } satisfies ThreadUpdate)
    expect(held.aligned).toBeCloseTo(0, 0)
    expect(held.distance).toBeGreaterThan(100)
    const anchor = row(100), before = held.before
    // The child count changes only after the new parent projection commits.
    await expect(chip(10)).toContainText('1 tool')
    await expect(chip(30)).toContainText('0 tools')
    await settled()
    await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
    await batch([item(5, 'user_message', { text: 'Older history. '.repeat(100) }, { status: 'delivered' })])
    await expect(row(5)).toContainText('Older history.')
    await settled()
    await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
    expect(await distance()).toBeGreaterThan(100)
    expect(await row(40).evaluate(el => el === (window as unknown as { agentChild: Element }).agentChild)).toBe(true)
    await expect(chip(10)).toHaveAttribute('aria-expanded', 'true')
    await expect(row(40).locator('.tool-row__result')).toBeVisible()
    await page.evaluate(() => (window as unknown as { agentScroll: { remove: () => void } }).agentScroll.remove())
    await thread.focus(); await page.keyboard.press('Home')
    await page.locator('.agent-start-marker').filter({ hasText: 'agent-10' }).click()
    await expect.poll(async () => {
      const card = (await row(10).boundingBox())!, viewport = (await thread.boundingBox())!
      return card.y >= viewport.y - 1 && card.y + card.height <= viewport.y + viewport.height + 1
    }).toBe(true)
    await expect(chip(10)).toHaveAttribute('aria-expanded', 'true')

    for (const [host, chat, epoch] of [['other-host', SEEDED_ROW.id, 'agents'], [FIRST_SERVER_ID, 'other-chat', 'agents'],
      [FIRST_SERVER_ID, SEEDED_ROW.id, 'reopened']]) {
      await scope(host, chat, epoch)
      await batch([agent(10, { status: 'finished', active: false, ended_order: 50 }),
        item(40, 'tool_call', { name: 'Read', input_summary: 'early child' }, { parent: 10 })])
      await expect(chip(10)).toContainText('Finished')
      await expect(chip(10)).not.toContainText('running ·')
      await expect(chip(10)).toHaveAttribute('aria-expanded', 'false')
      await expect(row(40)).toBeHidden()
    }
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve())) }
})

for (const width of [1280, 800]) test('supplied task controls retain lifecycle and scope at ' + width, async ({ launchPairedApp }) => {
  const server = await rendererFixture()
  try {
    const { page, app } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => decodeEnvelope(bytes).type === 'list_conversations'
      ? [seedConversationsFrame(SEEDED_ROW)] : [] }, { rendererUrl: server.resolvedUrls!.local[0] })
    await page.locator('.channel-list__row-open').first().click()
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    const scope = async (host = FIRST_SERVER_ID, chat = SEEDED_ROW.id, epoch = 'tasks') =>
      page.evaluate(({ host, chat, epoch }) => (window as unknown as { threadFixture: Fixture }).threadFixture.scope(host, chat, epoch), { host, chat, epoch })
    let version = 1000
    const batch = async (items: ThreadItem[]) => page.evaluate(({ items, version }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.batch(items, version), { items, version: ++version })
    const connection = (hostId: string, capabilities = ['stop_background_task']): ThreadTaskInputs['connection'] =>
      ({ hostId, status: { type: 'connected', ack: { server_id: hostId, conn_id: 'conn', protocol_version: '2', capabilities } } })
    const live = async (inputs: Omit<ThreadTaskInputs, 'onStopTask'>, callback = true) => page.evaluate(({ inputs, callback }) =>
      (window as unknown as { threadFixture: Fixture }).threadFixture.taskInputs(inputs, callback), { inputs, callback })
    const reading = { hostId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id, epoch: 'tasks', session: 'prior', agent: 'claude', taskId: 'raw-task' }
    const content = { task_id: 'raw-task', tool_use_id: 'launch-call', input: { description: 'Review races' },
      task_link: { task_id: 'raw-task', tool_call_id: 'launch-call' }, result: { is_error: false, result_summary: 'launch done' } }
    const work = item(10, 'agent', content, { session: 'prior', agent: 'claude', status: 'running', active: true })
    await scope()
    await batch([work, item(11, 'tool_call', content, { session: 'prior', agent: 'claude', status: 'finished', active: false }),
      item(12, 'agent', content, { session: 'other', agent: 'codex', status: 'finished', active: false })])
    await live({ connection: connection(FIRST_SERVER_ID), progress: [{ ...reading, progress: {
      currentActivity: 'Reading relay', subagentType: '', lastToolName: 'Read', totalTokens: 42000, toolUses: 7, durationMs: 65000, truncatedFields: null } }] })
    const pill = page.getByRole('button', { name: '1 task running', exact: true })
    await pill.click()
    const panel = page.getByRole('dialog', { name: 'Background tasks' })
    await expect(panel.locator('li')).toHaveCount(2)
    await expect(panel).toContainText('Running · 1')
    await expect(panel).toContainText('Finished · 1')
    await expect(panel).toContainText('Reading relay')
    await capturePairedApp(app, page, '/tmp/builder-1938/running-panel-' + width + '.png')
    const stop = panel.getByRole('button', { name: 'Stop task', exact: true })
    await expect(stop).toHaveCount(1)
    await stop.focus()
    await stop.press('Escape')
    await expect(panel).toHaveCount(0)
    await pill.click()
    const thread = page.getByLabel('Conversation history')
    await thread.focus()
    await thread.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.escapes)).toEqual([])
    await pill.click()
    await stop.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
    await expect(panel).toBeVisible()
    await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.turnRunning(true))
    await page.getByLabel('Fixture composer').press('Escape')
    await expect(panel).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.escapes))
      .toEqual(['bubble', 'interrupt', 'bubble'])
    await stop.press('Escape')
    await expect(panel).toHaveCount(0)
    await page.getByLabel('Fixture composer').press('Escape')
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.escapes))
      .toEqual(['bubble', 'interrupt', 'bubble', 'interrupt', 'bubble'])
    await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.turnRunning(false))
    await pill.click()
    await page.getByLabel('Fixture composer').press('Escape')
    await expect(panel).toHaveCount(0)
    await pill.click()
    await stop.click()
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.stops))
      .toEqual([[FIRST_SERVER_ID, SEEDED_ROW.id, 'raw-task']])
    await expect(panel).toContainText('Running')
    await expect(panel).not.toContainText('Stopping')
    await live({ connection: connection(FIRST_SERVER_ID), stops: [{ ...reading, pending: true }] })
    await expect(stop).toBeDisabled()
    await stop.evaluate(el => (el as HTMLButtonElement).click())
    await live({ connection: connection(FIRST_SERVER_ID), stops: [{ ...reading, pending: true, refused: true }] })
    await expect(stop).toBeEnabled()
    for (const inputs of [{ connection: connection(SECOND_SERVER_ID) }, { connection: connection(FIRST_SERVER_ID, []) }]) {
      await live(inputs)
      await expect(stop).toHaveCount(0)
    }
    await live({ connection: connection(FIRST_SERVER_ID) }, false)
    await expect(stop).toHaveCount(0)
    await live({ connection: connection(FIRST_SERVER_ID) })
    await expect(stop).toBeEnabled()
    await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), {
      type: 'thread_item_changed', payload: { conversation_id: SEEDED_ROW.id, epoch: 'tasks', version: ++version,
        item_id: 10, base_rev: 10, rev: version, changes: { status: 'stopping' } } })
    await expect(panel).toContainText('Stopping')
    await page.evaluate(update => (window as unknown as { threadFixture: Fixture }).threadFixture.update(update), {
      type: 'thread_item_changed', payload: { conversation_id: SEEDED_ROW.id, epoch: 'tasks', version: ++version,
        item_id: 10, base_rev: version - 1, rev: version, changes: { active: false, status: 'finished',
          content: { ...content, task_report: { summary: 'Review complete', truncated_fields: ['summary'] } } } } })
    await expect(pill).toHaveCount(0)
    await expect(stop).toHaveCount(0)
    await expect(panel).toContainText('Review complete')
    await expect(panel.locator('.background-task-panel__cut-summary')).toHaveText('Truncated by the daemon')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Background tasks', exact: true }).click()
    await expect(panel).toContainText('Finished · 2')
    await capturePairedApp(app, page, '/tmp/builder-1938/panel-' + width + '.png')
    await scope(SECOND_SERVER_ID)
    await batch([work])
    await expect(panel).toContainText('Review races')
    await expect(panel).not.toContainText('Review complete')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
    const escapesBeforeSwitch = await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.escapes.length)
    await thread.press('Escape')
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.escapes.length)).toBe(escapesBeforeSwitch + 1)
    await live({ connection: connection(SECOND_SERVER_ID), stops: [{ ...reading, pending: true }], progress: [{ ...reading, progress: {
      currentActivity: 'Wrong host', subagentType: '', lastToolName: '', totalTokens: 1, toolUses: 1, durationMs: 1, truncatedFields: null } }] })
    await pill.click()
    await expect(stop).toBeEnabled()
    await expect(panel).not.toContainText('Wrong host')
    await stop.click()
    expect(await page.evaluate(() => (window as unknown as { threadFixture: Fixture }).threadFixture.stops))
      .toEqual([[FIRST_SERVER_ID, SEEDED_ROW.id, 'raw-task'], [SECOND_SERVER_ID, SEEDED_ROW.id, 'raw-task']])
    await scope()
    await expect(panel).toContainText('Review complete')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(pill).toHaveCount(0)
    await page.getByRole('button', { name: 'Background tasks', exact: true }).click()
    await expect(panel).toContainText('Review complete')
    await scope(FIRST_SERVER_ID, 'another-chat')
    await batch([work])
    await expect(panel).toContainText('Review races')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await pill.click()
    await expect(panel).not.toContainText('Wrong host')
    await expect(stop).toHaveCount(0)
    await scope(FIRST_SERVER_ID, SEEDED_ROW.id, 'new-epoch')
    await expect(panel).toBeVisible()
    await expect(panel.locator('li')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Background tasks', exact: true })).toHaveCount(0)
  } finally { await new Promise<void>((resolve, reject) => server.httpServer!.close(error => error ? reject(error) : resolve())) }
})
