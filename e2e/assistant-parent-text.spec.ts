import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

const ts = '2026-10-05T12:00:00Z'
const common = { conversation_id: SEEDED_ROW.id, turn_id: 'parent-text-turn' }
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({ id: 1, type, ts, payload })

test('streamed assistant text folds under its owner and follows expansion without inflating tool counts', async ({ launchPairedApp }) => {
  const { page, daemon, app } = await launchPairedApp()
  const use = (id: string, name = 'Agent', parent?: string) => daemon.pushFrame(frame('tool_use', {
    ...common, tool_use_id: id, name, input_summary: id, parent_tool_use_id: parent
  }))
  const delta = (text: string, parent?: string) => daemon.pushFrame(frame('assistant_delta', {
    ...common, seq: 0, text, parent_tool_use_id: parent
  }))
  const owner = (id: string) => page.locator('.tool-row').filter({
    has: page.locator('.tool-row__summary', { hasText: new RegExp(`^${id}$`) })
  })
  const reply = (text: string) => page.locator('[data-thread-role="assistant"]').filter({ hasText: text })

  use('text-only')
  delta('Helper first', 'text-only')
  delta(' grows', 'text-only')
  const a = owner('text-only')
  await expect(a.locator('.tool-row__count')).toHaveText('running · 0 tools')
  await expect(reply('Helper first grows')).toHaveCount(1)
  await expect(reply('Helper first grows')).toBeHidden()
  await a.locator('.tool-row__chip').click()
  await expect(reply('Helper first grows')).toBeVisible()
  await expect(reply('Helper first grows').locator('../..')).toHaveCSS('margin-inline-start', '16px')
  await a.locator('.tool-row__chip').click()
  await expect(reply('Helper first grows')).toBeHidden()

  use('mixed-owner', 'Task')
  delta('Main thread reply')
  delta('Mixed first', 'mixed-owner')
  use('nested-read', 'Read', 'mixed-owner')
  delta('Mixed last', 'mixed-owner')
  delta('Helper later', 'text-only')
  const b = owner('mixed-owner')
  await expect(b.locator('.tool-row__count')).toHaveText('running · 1 tool')
  await expect(reply('Main thread reply')).toBeVisible()
  await expect(reply('Mixed first')).toBeHidden()
  await b.locator('.tool-row__chip').click()
  await a.locator('.tool-row__chip').click()
  await expect(reply('Helper later')).toBeVisible()
  await expect(reply('Mixed last')).toBeVisible()
  await expect(page.locator('.conversation__thread > :visible')).toHaveText([
    /text-only.*0 tools/, /Helper first grows/, /Helper later/,
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
    await page.screenshot({ path: `/tmp/builder-1789/expanded-${width}.png`, animations: 'disabled' })
  }
  await b.locator('.tool-row__chip').click()
  await expect(reply('Mixed first')).toBeHidden()
  await expect(reply('Mixed last')).toBeHidden()
  await expect(owner('nested-read')).toBeHidden()
  await expect(reply('Main thread reply')).toBeVisible()
})

test('attributed text follows its owner when an enclosing tool run collapses', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp()
  for (const [tool_use_id, name] of [['run-read', 'Read'], ['run-agent', 'Agent']]) {
    daemon.pushFrame(frame('tool_use', { ...common, tool_use_id, name, input_summary: tool_use_id }))
  }
  daemon.pushFrame(frame('assistant_delta', { ...common, seq: 0, text: 'Reply inside tool run', parent_tool_use_id: 'run-agent' }))
  const run = page.locator('.tool-run button')
  const agent = page.locator('.tool-row').filter({ has: page.locator('.tool-row__summary', { hasText: /^run-agent$/ }) })
  const reply = page.locator('[data-thread-role="assistant"]').filter({ hasText: 'Reply inside tool run' })
  await expect(run).toContainText('Using tools: 2')
  await expect(reply).toBeHidden()
  await run.click()
  await agent.locator('.tool-row__chip').click()
  await expect(reply).toBeVisible()
  await run.click()
  await expect(agent).toBeHidden()
  await expect(reply).toBeHidden()
  await run.click()
  await expect(reply).toBeVisible()
})
