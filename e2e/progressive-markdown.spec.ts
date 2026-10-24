import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import { createCanonicalThread } from './fixtures/canonicalThread'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

function markdownThread() {
  const route = { conversation_id: SEEDED_ROW.id, epoch: 'progressive-markdown' }
  const session = 'progressive-session'
  let version = 1
  const revisions = new Map<number, number>()
  const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW, current_session_id: session },
    epoch: route.epoch, version, items: [] }] })
  const frame = (update: ThreadUpdate) => encodeEnvelope({ id: version, ts: '2026-10-07T00:00:00Z', ...update })
  const add = (id: number, text: string, tool = false) => {
    revisions.set(id, 1)
    const item: ThreadItem = { id, order: id * 10, rev: 1, session, turn: `turn-${id}`,
      kind: tool ? 'tool_call' : 'assistant_message', status: 'running', active: true, shown: true, summary: '',
      content: tool ? { name: 'Read', input_summary: 'synthetic.ts', result: null } : { text } }
    return frame({ type: 'thread_item_added', payload: { ...route, version: ++version, item } })
  }
  const revision = (id: number) => {
    const base_rev = revisions.get(id)
    if (base_rev === undefined) throw Error('Missing authored Markdown item')
    revisions.set(id, base_rev + 1)
    return { ...route, version: ++version, item_id: id, base_rev, rev: base_rev + 1 }
  }
  return { options: { threadMode: 'canonical' as const, thread, helloAck: { capabilities: ['interactive', 'thread'] } },
    add, append: (id: number, text: string) => frame({ type: 'thread_text_append', payload: { ...revision(id), text } }),
    finish: (id: number) => frame({ type: 'thread_item_changed', payload: { ...revision(id), changes: { status: 'finished', active: false } } }) }
}

test('indented pending headers and heading closers preserve streaming presentation', async ({ launchPairedApp }) => {
  const facts = markdownThread()
  const { page, daemon, app } = await launchPairedApp(facts.options)
  const bubble = page.locator('[data-thread-role="assistant"]').last()
  const markdown = bubble.locator('.bubble__markdown')
  for (const [index, prefix] of ['  ', '>   '].entries()) {
    const id = index + 1
    daemon.pushFrame(facts.add(id, prefix + '| A | B |\n'))
    await expect(markdown).toHaveText('A B')
    daemon.pushFrame(facts.append(id, (prefix.includes('>') ? '> ' : '') + '---'))
    await expect(markdown).toHaveText('A B')
    await expect(markdown.locator('table, h2')).toHaveCount(0)
    if (prefix.includes('>')) await expect(markdown.locator('blockquote')).toHaveText('A B')
    daemon.pushFrame(facts.append(id, ' | ---'))
    await expect(markdown.locator('table')).toHaveCount(1)
    daemon.pushFrame(facts.finish(id))
    await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
  }
  for (const [index, inline] of ['**bold', '`code'].entries()) {
    const id = index + 3
    const content = inline.slice(index === 0 ? 2 : 1)
    daemon.pushFrame(facts.add(id, '# ' + inline + ' #'))
    await expect(markdown.locator('h1')).toHaveText(content)
    daemon.pushFrame(facts.append(id, '##  \t\n'))
    await expect(markdown.locator('h1')).toHaveText(content)
    await expect(markdown.locator('strong, code')).toHaveCount(0)
    if (index === 0) {
      for (const width of [1280, 800]) {
        await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
        await page.screenshot({ path: `/tmp/builder-2223/rework-heading-${width}.png`, animations: 'disabled' })
      }
      daemon.pushFrame(facts.finish(id))
    } else {
      daemon.pushFrame(facts.add(5, '', true))
      await expect(page.locator('.tool-row__summary')).toHaveText('synthetic.ts')
      await expect(bubble.locator('.bubble__cursor')).toBeVisible()
      await expect(markdown.locator('h1')).toHaveText(content)
      daemon.pushFrame(facts.finish(id))
    }
    await expect(markdown.locator('h1')).toHaveText(inline)
    await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
  }
})

test('progressive presentation, parser/render reuse and raw-source settlement', async ({ launchPairedApp }) => {
  const facts = markdownThread()
  const { page, daemon, app } = await launchPairedApp(facts.options)
  const bubble = page.locator('[data-thread-role="assistant"]').last()
  const markdown = bubble.locator('.bubble__markdown')
  daemon.pushFrame(facts.add(1, '**bold'))
  await expect(markdown).toHaveText('bold')
  await expect(markdown.locator('strong')).toHaveCount(0)
  await expect(bubble.locator('.bubble__cursor')).toBeVisible()
  daemon.pushFrame(facts.append(1, '**\n\n[text](https://exa'))
  await expect(markdown).toContainText('text')
  await expect(markdown.locator('a')).toHaveCount(0)
  daemon.pushFrame(facts.append(1, 'mple.com)\n\n| A | B |\n---'))
  await expect(markdown.locator('a')).toHaveAttribute('href', 'https://example.com')
  await expect(markdown).toContainText('A B')
  await expect(markdown.locator('table')).toHaveCount(0)
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await page.screenshot({ path: `/tmp/builder-2223/pending-${width}.png`, animations: 'disabled' })
  }
  daemon.pushFrame(facts.append(1, ' | ---\n\n```js\na\n'))
  await expect(markdown.locator('table')).toHaveCount(1)
  await expect(markdown.locator('pre code')).toHaveText('a\n')
  daemon.pushFrame(facts.append(1, '```x'))
  await expect(markdown.locator('pre code')).toContainText('```x')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  daemon.pushFrame(facts.append(1, '\n```\n\nlast\nline\n'))
  await expect(markdown).toContainText('last')

  // V8 call counters measure actual mounted execution; identical DOM cannot prove memo skipped work.
  const initial = await cdp.send('Profiler.takePreciseCoverage')
  const frozenNames = new Set(initial.result.flatMap(script => script.functions)
    .filter(fn => /^FrozenMarkdown\d*$/.test(fn.functionName) && fn.ranges[0]?.count > 0).map(fn => fn.functionName))
  expect(frozenNames.size).toBeGreaterThan(0)
  const script = initial.result.find(script => script.functions.some(fn => fn.functionName === 'parseMarkdown'))
  expect(script).toBeDefined()
  if (script === undefined) throw new Error('Streaming parser missing from coverage')
  await cdp.send('Debugger.enable')
  const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })
  const parserOffset = scriptSource.indexOf('function parseMarkdown(')
  expect(parserOffset).toBeGreaterThan(0)
  const parsed: string[] = []
  const onPause = async (event: { callFrames: { callFrameId: string }[] }) => {
    const result = await cdp.send('Debugger.evaluateOnCallFrame', {
      callFrameId: event.callFrames[0].callFrameId, expression: 'source', returnByValue: true
    })
    if (typeof result.result.value === 'string') parsed.push(result.result.value)
    await cdp.send('Debugger.resume')
  }
  cdp.on('Debugger.paused', onPause)
  const breakpoint = await cdp.send('Debugger.setBreakpoint', { location: {
    scriptId: script.scriptId, lineNumber: scriptSource.slice(0, parserOffset).split('\n').length
  } })
  daemon.pushFrame(facts.append(1, ' growing'))
  await expect(markdown).toContainText('growing')
  expect(parsed.length).toBeGreaterThan(0)
  expect(parsed.every(source => !source.includes('bold'))).toBe(true)
  await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId })
  cdp.off('Debugger.paused', onPause)
  await cdp.send('Debugger.disable')
  const coverage = await cdp.send('Profiler.takePreciseCoverage')
  const functions = coverage.result.flatMap(script => script.functions)
  const calls = (name: string) => functions.filter(fn => fn.functionName === name)
    .reduce((sum, fn) => sum + (fn.ranges[0]?.count ?? 0), 0)
  expect(calls('parseMarkdown')).toBeGreaterThan(0)
  expect([...frozenNames].reduce((sum, name) => sum + calls(name), 0)).toBe(0)
  await cdp.send('Profiler.stopPreciseCoverage')
  await cdp.detach()

  // Definitions invalidate earlier frozen references, including already rendered content.
  daemon.pushFrame(facts.append(1, '\n\n[x][ref]\n\nnext\nline\n\n[ref]: https://example.com'))
  await expect(markdown.locator('a').filter({ hasText: /^x$/ })).toHaveCount(1)
  const streaming = await markdown.innerHTML()
  daemon.pushFrame(facts.finish(1))
  await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
  expect((await markdown.innerHTML()).replace(/>\s+</g, '><')).toBe(streaming.replace(/>\s+</g, '><'))
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await page.screenshot({ path: `/tmp/builder-2223/progressive-${width}.png`, animations: 'disabled' })
  }

  daemon.pushFrame(facts.add(2, '**unfinished'))
  await expect(markdown).toHaveText('unfinished')
  daemon.pushFrame(facts.finish(2))
  await expect(markdown).toHaveText('**unfinished')
  daemon.pushFrame(facts.add(3, '**tool-settled'))
  await expect(markdown).toHaveText('tool-settled')
  daemon.pushFrame(facts.add(4, '', true))
  await expect(page.locator('.tool-row__summary')).toHaveText('synthetic.ts')
  await expect(bubble.locator('.bubble__cursor')).toBeVisible()
  await expect(markdown).toHaveText('tool-settled')
  daemon.pushFrame(facts.finish(3))
  await expect(markdown).toHaveText('**tool-settled')
  await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
  const inspector = await page.context().newCDPSession(page)
  await inspector.send('Profiler.enable')
  await inspector.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  const punctuation = '2 * 3 '.repeat(100)
  daemon.pushFrame(facts.add(5, punctuation))
  await expect(markdown).toHaveText(punctuation.trim())
  const bounded = await inspector.send('Profiler.takePreciseCoverage')
  const parseCalls = bounded.result.flatMap(script => script.functions)
    .filter(fn => fn.functionName === 'parseMarkdown').reduce((sum, fn) => sum + fn.ranges[0].count, 0)
  expect(parseCalls).toBeGreaterThan(0)
  expect(parseCalls).toBeLessThanOrEqual(67)
  await inspector.send('Profiler.stopPreciseCoverage')
  await inspector.detach()
})
