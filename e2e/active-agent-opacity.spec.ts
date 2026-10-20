import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ThreadItem, ThreadSummary } from '../src/shared/wire/thread'
import { capturePairedApp } from './fixtures/capturePairedApp'

for (const compact of [true, false]) for (const grouped of [true, false]) {
  test(`active agent stays emphasized: compact=${compact}, grouped=${grouped}`, async ({ launchPairedApp }, info) => {
    const route = { conversation_id: SEEDED_ROW.id, epoch: 'agent-opacity' }
    const projection = compact ? { projection: 'compact-v1' } : {}
    const base = (id: number) => ({ id, rev: 1, order: id, parent: 0, shown: true, session: 'session' })
    const message = (id: number, text: string): ThreadItem => ({ ...base(id), kind: 'assistant_message',
      active: false, status: 'done', summary: '', content: { text } })
    const headers: ThreadSummary[] = [
      { ...base(2), kind: 'agent', active: true, status: 'running', headline: 'Agent: Inspect the workspace',
        detail_omitted: true, subtree_version: 1, public_child_count: 0, has_public_children: false },
      // A pending tool named Agent must not acquire agent emphasis from its name.
      { ...base(4), kind: 'tool_call', active: true, status: 'running', headline: 'Agent: Ordinary pending tool',
        detail_omitted: true, subtree_version: 1 }
    ]
    const tools: ThreadItem[] = headers.map(header => ({ ...base(header.id), kind: header.kind,
      active: header.active, status: header.status, summary: '', content: { name: 'Agent',
        input_summary: header.id === 2 ? 'Inspect the workspace' : 'Ordinary pending tool', result: null } }))
    const items = [message(1, 'Opacity regression ready'), ...(!compact ? tools : []),
      ...(!grouped ? [message(3, 'Separate tool rows')] : [])]
    const { app, page } = await launchPairedApp({ threadMode: 'native', helloAck: {
      capabilities: ['interactive', 'thread', ...(compact ? ['thread_expansion', 'thread_compact'] : [])]
    }, buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'list_conversations') return [seedConversationsFrame({ ...SEEDED_ROW, current_session_id: 'session' })]
      if (request.type !== 'thread_catch_up') return []
      const frame = (payload: unknown) => encodeEnvelope({ id: 90, type: 'thread_items',
        ts: '2026-10-20T00:00:00Z', in_reply_to: request.id, payload })
      return [frame({ ...route, ...projection, version: 1, items, ...(compact ? { headers } : {}), final: false }),
        frame({ ...route, ...projection, version: 1, items: [], final: true,
          lower_order: 0, upper_order: 5, continuation: 0, older_exists: false })]
    } })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    await expect(page.getByText('Opacity regression ready', { exact: true })).toBeVisible()
    const run = page.locator('.tool-run button')
    const agent = page.locator('[data-read-row="2"] > .tool-row')
    const pending = page.locator('[data-read-row="4"] > .tool-row')
    if (grouped) {
      await expect(run).toHaveText('Using tools: 2')
      await run.click()
    } else await expect(run).toHaveCount(0)
    const measure = async () => {
      await expect(agent).toBeVisible()
      await expect(pending).toHaveCSS('opacity', '0.5')
      await expect(agent.locator('.tool-row__count').first()).toHaveText(compact ? 'running · 0 direct children' : 'Outcome pending')
      if (!compact) await expect(agent.locator('.tool-row__count').last()).toHaveText('running · 0 tools')
      // Opacity compounds through ancestors; checking the label alone can miss the faded box.
      const opacities = await agent.locator('.tool-row__name').evaluate(label => {
        const values: string[] = []
        for (let node: Element | null = label; node; node = node.parentElement) values.push(getComputedStyle(node).opacity)
        return values
      })
      expect(opacities.length).toBeGreaterThan(3)
      expect(opacities).toEqual(opacities.map(() => '1'))
    }
    await measure()
    if (grouped) {
      await run.click()
      await expect(agent).toHaveCount(0)
      await run.click()
      await measure()
    }
    const path = `/tmp/builder-2166/agent-compact-${compact}-grouped-${grouped}.png`
    await info.attach('active-agent-opacity', { body: await capturePairedApp(app, page, path), contentType: 'image/png' })
  })
}
