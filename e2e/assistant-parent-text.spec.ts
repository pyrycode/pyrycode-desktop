import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import { createCanonicalThread } from './fixtures/canonicalThread'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const ts = '2026-10-05T12:00:00Z'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'parent-text' }
const session = 'parent-text-session'
function parentThread() {
  let version = 1
  const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW, current_session_id: session },
    epoch: route.epoch, version, items: [] }] })
  const frame = (update: ThreadUpdate) => encodeEnvelope({ id: version, ts, ...update })
  const add = (id: number, kind: string, content: unknown, parent = 0, active = kind !== 'assistant_message'): Uint8Array => frame({
    type: 'thread_item_added', payload: { ...route, version: ++version, item: {
      id, order: id * 10, rev: 1, kind, content, parent, session, turn: 'parent-text-turn',
      status: active ? 'running' : 'finished', active, shown: true, summary: ''
    } satisfies ThreadItem }
  })
  const append = (id: number, text: string) => frame({ type: 'thread_text_append', payload: {
    ...route, version: ++version, item_id: id, base_rev: 1, rev: 2, text
  } })
  const finish = (id: number) => frame({ type: 'thread_item_changed', payload: {
    ...route, version: ++version, item_id: id, base_rev: 2, rev: 3, changes: { status: 'finished', active: false }
  } })
  return { options: { threadMode: 'canonical' as const, thread, helloAck: { capabilities: ['interactive', 'thread'] } }, add, append, finish }
}

test('streamed assistant text folds under its owner and follows expansion without inflating tool counts', async ({ launchPairedApp }) => {
  const facts = parentThread()
  const { page, daemon, app } = await launchPairedApp(facts.options)
  const use = (id: number, summary: string, name = 'Agent', parent = 0) => daemon.pushFrame(facts.add(
    id, name === 'Agent' || name === 'Task' ? 'agent' : 'tool_call', { name, input_summary: summary, result: null }, parent))
  const text = (id: number, value: string, parent = 0) => daemon.pushFrame(facts.add(id, 'assistant_message', { text: value }, parent))
  const owner = (id: string) => page.locator('.tool-row').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  const reply = (text: string) => page.locator('[data-thread-role="assistant"]').filter({ hasText: text })

  use(1, 'text-only')
  daemon.pushFrame(facts.add(2, 'assistant_message', { text: 'Helper first' }, 1, true))
  daemon.pushFrame(facts.append(2, ' grows'))
  daemon.pushFrame(facts.finish(2))
  text(3, 'Closed reply update committed')
  await expect(reply('Closed reply update committed')).toBeVisible()
  const a = owner('text-only')
  await expect(a.locator('.tool-row__count').last()).toHaveText('running · 0 tools')
  await expect(reply('Helper first grows')).toHaveCount(0)
  await a.locator('.tool-row__chip').click()
  await expect(reply('Helper first grows')).toBeVisible()
  await expect(reply('Helper first grows').locator('../..')).toHaveCSS('margin-inline-start', '16px')
  await a.locator('.tool-row__chip').click()
  await expect(a.locator('.tool-row__chip')).toHaveAttribute('aria-expanded', 'false')
  await expect(reply('Helper first grows')).toHaveCount(0)

  use(4, 'mixed-owner', 'Task')
  text(5, 'Main thread reply')
  text(6, 'Mixed first', 4)
  use(7, 'nested-read', 'Read', 4)
  text(8, 'Mixed last', 4)
  text(9, 'Helper later', 1)
  const b = owner('mixed-owner')
  await expect(b.locator('.tool-row__count').last()).toHaveText('running · 1 tool')
  await expect(reply('Main thread reply')).toBeVisible()
  await expect(reply('Mixed first')).toHaveCount(0)
  await b.locator('.tool-row__chip').click()
  await a.locator('.tool-row__chip').click()
  await expect(reply('Helper later')).toBeVisible()
  await expect(reply('Mixed last')).toBeVisible()
  await expect(page.locator('.conversation__thread > :visible')).toHaveText([
    /text-only.*0 tools/, /Helper first grows/, /Helper later/, /Closed reply update committed/,
    /mixed-owner.*1 tool/, /Mixed first/, /nested-read/, /Mixed last/, /Main thread reply/
  ])
  for (const value of ['Helper first grows', 'Helper later', 'Mixed first', 'Mixed last']) {
    await expect(reply(value)).toHaveCount(1)
  }
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(size, 800)
      window.show()
    }, width)
    await page.locator('.conversation__thread').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: `/tmp/builder-2223/assistant-expanded-${width}.png`, animations: 'disabled' })
  }
  await b.locator('.tool-row__chip').click()
  await expect(b.locator('.tool-row__chip')).toHaveAttribute('aria-expanded', 'false')
  await expect(reply('Mixed first')).toHaveCount(0)
  await expect(reply('Mixed last')).toHaveCount(0)
  await expect(owner('nested-read')).toHaveCount(0)
  await expect(reply('Main thread reply')).toBeVisible()
})

test('attributed text follows its owner when an enclosing tool run collapses', async ({ launchPairedApp }) => {
  const facts = parentThread()
  const { page, daemon } = await launchPairedApp(facts.options)
  daemon.pushFrame(facts.add(1, 'tool_call', { name: 'Read', input_summary: 'run-read', result: null }))
  daemon.pushFrame(facts.add(2, 'agent', { name: 'Agent', input_summary: 'run-agent', result: null }))
  daemon.pushFrame(facts.add(3, 'assistant_message', { text: 'Reply inside tool run' }, 2))
  daemon.pushFrame(facts.add(4, 'assistant_message', { text: 'Run reply update committed' }))
  await expect(page.getByText('Run reply update committed', { exact: true })).toBeVisible()
  const run = page.locator('.tool-run button')
  const agent = page.locator('.tool-row').filter({ has: page.locator('.tool-row__summary', { hasText: /^run-agent$/ }) })
  const reply = page.locator('[data-thread-role="assistant"]').filter({ hasText: 'Reply inside tool run' })
  await expect(run).toContainText('Using tools: 2')
  await expect(reply).toHaveCount(0)
  await run.click()
  await agent.locator('.tool-row__chip').click()
  await expect(reply).toBeVisible()
  await run.click()
  await expect(run).toHaveAttribute('aria-expanded', 'false')
  await expect(agent).toHaveCount(0)
  await expect(reply).toHaveCount(0)
  await run.click()
  await expect(reply).toBeVisible()
})
