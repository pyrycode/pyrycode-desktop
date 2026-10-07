import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-10-07T00:00:00Z', payload
})
const delta = (text: string, turn = 'progressive') => frame('assistant_delta', {
  conversation_id: SEEDED_ROW.id, turn_id: turn, seq: 0, text
})
const settled = (turn = 'progressive') => frame('turn_end', {
  conversation_id: SEEDED_ROW.id, turn_id: turn, stop_reason: 'end_turn'
})

test('progressive presentation, parser/render reuse and raw-source settlement', async ({ launchPairedApp }) => {
  const { page, daemon, app } = await launchPairedApp({})
  const bubble = page.locator('[data-thread-role="assistant"]').last()
  const markdown = bubble.locator('.bubble__markdown')
  daemon.pushFrame(delta('**bold'))
  await expect(markdown).toHaveText('bold')
  await expect(markdown.locator('strong')).toHaveCount(0)
  await expect(bubble.locator('.bubble__cursor')).toBeVisible()
  daemon.pushFrame(delta('**\n\n[text](https://exa'))
  await expect(markdown).toContainText('text')
  await expect(markdown.locator('a')).toHaveCount(0)
  daemon.pushFrame(delta('mple.com)\n\n| A | B |\n---'))
  await expect(markdown.locator('a')).toHaveAttribute('href', 'https://example.com')
  await expect(markdown).toContainText('A B')
  await expect(markdown.locator('table')).toHaveCount(0)
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await page.screenshot({ path: `/tmp/builder-1751/pending-${width}.png`, animations: 'disabled' })
  }
  daemon.pushFrame(delta(' | ---\n\n```js\na\n'))
  await expect(markdown.locator('table')).toHaveCount(1)
  await expect(markdown.locator('pre code')).toHaveText('a\n')
  daemon.pushFrame(delta('```x'))
  await expect(markdown.locator('pre code')).toContainText('```x')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  daemon.pushFrame(delta('\n```\n\nlast\nline\n'))
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
  daemon.pushFrame(delta(' growing'))
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
  daemon.pushFrame(delta('\n\n[x][ref]\n\nnext\nline\n\n[ref]: https://example.com'))
  await expect(markdown.locator('a').filter({ hasText: /^x$/ })).toHaveCount(1)
  const streaming = await markdown.innerHTML()
  daemon.pushFrame(settled())
  await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
  expect((await markdown.innerHTML()).replace(/>\s+</g, '><')).toBe(streaming.replace(/>\s+</g, '><'))
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width)
    await page.screenshot({ path: `/tmp/builder-1751/progressive-${width}.png`, animations: 'disabled' })
  }

  daemon.pushFrame(delta('**unfinished', 'unfinished-end'))
  await expect(markdown).toHaveText('unfinished')
  daemon.pushFrame(settled('unfinished-end'))
  await expect(markdown).toHaveText('**unfinished')
  daemon.pushFrame(delta('**tool-settled', 'unfinished-tool'))
  await expect(markdown).toHaveText('tool-settled')
  daemon.pushFrame(frame('tool_use', {
    conversation_id: SEEDED_ROW.id, turn_id: 'unfinished-tool', tool_use_id: 'tool-1751',
    name: 'Read', input_summary: 'synthetic.ts'
  }))
  await expect(markdown).toHaveText('**tool-settled')
  await expect(bubble.locator('.bubble__cursor')).toHaveCount(0)
})
