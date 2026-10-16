import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { NOT_YET_AVAILABLE, readMainProcess } from './fixtures/mainProcessRead'
import { daemonIdentity } from './fixtures/daemonVersion'
import { watchPhaseReconnect, readPhaseReconnect } from './fixtures/phaseReconnectEvidence'

// Channel posts append daemon-owned assistant entries without starting a Claude turn.
// This acceptance uses real daemon storage and a fully exited, protected desktop profile.
test.use({ spawnClaude: false, seedPromoted: true, requiredCapabilities: ['interactive', 'thread'] })

test('a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(240_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN ?? 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  expect(revision, 'thread acceptance requires a source-stamped isolated daemon binary').toMatch(/^[a-f0-9]{7,40}$/)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })
  const channel = `history-open-${Date.now()}`
  const baseline = `saved baseline ${Date.now()}`
  const marker = `closed desktop post ${Date.now()}`
  const closedPosts = Array.from({ length: 205 }, (_, index) => `${marker} row ${String(index).padStart(3, '0')}`)
  const post = async (text: string): Promise<void> => {
    try {
      await promisify(execFile)(process.env.PYRY_BIN ?? 'pyry', ['channel',
        `-pyry-socket=${join(dirname(daemon.workdir), '.pyry', 'test.sock')}`, 'post',
        '--name', channel, '--text', text], { timeout: 45_000 })
    } catch { throw new Error('channel post failed') } // Never print argv, payload or child output.
  }
  await withIsolatedElectronApp(async initial => {
    const { page, app } = initial
    await watchPhaseReconnect(page)
    await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
    await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: 45_000 })
    await page.locator('.channel-list__rename').click()
    await page.locator('.edit-channel__input').fill(channel)
    await page.getByRole('dialog', { name: 'Edit channel', exact: true })
      .getByRole('button', { name: 'OK', exact: true }).click()
    const row = page.locator('.channel-list__row-open').filter({ hasText: channel })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await post(baseline)
    await expect(page.locator('.conversation__thread .bubble').filter({ hasText: baseline })).toHaveCount(1)
    // Inspect only this fixture's synthetic conversation registry, never pairing credentials.
    const registry = JSON.parse(await readFile(join(dirname(daemon.workdir), '.pyry', 'test', 'conversations.json'), 'utf8'))
    const conversationId: string = registry.conversations.find((c: { name?: string }) => c.name === channel).id
    const savedText = () => page.evaluate(async ({ serverId, conversationId }) => {
      const authoritative = await window.pyry.chatHistory({ operation: 'readThread', serverId, conversationId })
      if (authoritative.status === 'stored' && authoritative.snapshot.kind === 'daemon-items')
        return authoritative.snapshot.thread.items.flatMap(item => item.content !== null && typeof item.content === 'object' &&
          'text' in item.content && typeof item.content.text === 'string' ? [item.content.text] : []).join('\n')
      const result = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'timeline'
        ? result.snapshot.items.flatMap(item => 'text' in item ? [item.text] : []).join('\n') : ''
    }, { serverId: daemon.pairFields.server, conversationId })
    await expect.poll(savedText).toContain(baseline)
    expect(await readPhaseReconnect(page)).toMatchObject({ interactive: true, thread: true })
    const savedCheckpoint = await page.evaluate(async ({ serverId, conversationId }) => {
      const result = await window.pyry.chatHistory({ operation: 'readThread', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
    }, { serverId: daemon.pairFields.server, conversationId })
    if (savedCheckpoint !== null) {
      const fresh = await initial.relaunch(async () => { for (const text of closedPosts) await post(text) })
      await fresh.app.evaluate(({ ipcMain }) => {
        const asks: { type: string; version?: number }[] = []
        ;(globalThis as any).__threadHistoryAsks = asks
        ipcMain.on('pyry:command', (_event, command) => {
          if (command.type === 'queryThread') asks.push({ type: command.query.type, version: command.query.payload.version })
          if (command.type === 'requestHistory') asks.push({ type: 'legacy' })
        })
      })
      await fresh.page.locator('.channel-list__row-open').filter({ hasText: channel }).click()
      const thread = fresh.page.locator('.conversation__thread')
      await expect(thread).toContainText(closedPosts.at(-1)!, { timeout: 45_000 })
      await expect(thread).toContainText(baseline)
      const asks = await fresh.app.evaluate(() => (globalThis as any).__threadHistoryAsks as { type: string; version?: number }[])
      expect(asks[0]).toEqual({ type: 'thread_catch_up', version: savedCheckpoint })
      expect(asks.some(ask => ask.type === 'legacy')).toBe(false)
      // A separately authenticated fresh profile has no saved checkpoint and must page the newest window.
      const pair = await daemon.mintPairing()
      await withIsolatedElectronApp(async ({ page: clean, app: cleanApp }) => {
        await cleanApp.evaluate(({ ipcMain }) => {
          const asks: string[] = []
          ;(globalThis as any).__threadPageAsks = asks
          ipcMain.on('pyry:command', (_event, command) => {
            if (command.type === 'queryThread') asks.push(command.query.type)
            if (command.type === 'requestHistory') asks.push('legacy')
          })
        })
        await pairFromUnpairedLaunch(clean, encodePairingPayload({ ...pair, relay: `${relay.url}/v1/client` }))
        await clean.locator('.channel-list__row-open').filter({ hasText: channel }).click()
        const history = clean.locator('.conversation__thread')
        await expect(history).toContainText(closedPosts.at(-1)!, { timeout: 45_000 })
        const coverage = () => clean.evaluate(async ({ serverId, conversationId }) => {
          const result = await window.pyry.chatHistory({ operation: 'readThread', serverId, conversationId })
          return result.status === 'stored' && result.snapshot.kind === 'daemon-items'
            ? result.snapshot.thread.ranges[0]?.start : undefined
        }, { serverId: daemon.pairFields.server, conversationId })
        await expect.poll(coverage).toBeDefined()
        // Queries default to 50 public rows; these posts also create divider rows.
        // One older page cannot cover all 205 posts. Each trusted upward input
        // must make progress; no automatic paging or retry can satisfy this walk.
        for (let step = 0; step < 12 && await history.getByText(baseline, { exact: true }).count() === 0; step++) {
          const before = await coverage()
          const asks = await cleanApp.evaluate(() => (globalThis as any).__threadPageAsks.filter((type: string) => type === 'thread_page').length)
          await history.evaluate(el => { el.scrollTop = 0 })
          await history.press('ArrowUp')
          await expect.poll(() => cleanApp.evaluate(() => (globalThis as any).__threadPageAsks.filter((type: string) => type === 'thread_page').length)).toBe(asks + 1)
          await expect.poll(coverage).toBeLessThan(before!)
        }
        await expect(history).toContainText(baseline, { timeout: 45_000 })
        const transcript = await history.innerText()
        let previous = transcript.indexOf(baseline)
        for (const text of closedPosts) {
          const position = transcript.indexOf(text)
          expect(position).toBeGreaterThan(previous)
          expect(transcript.indexOf(text, position + text.length)).toBe(-1)
          previous = position
        }
        expect(await cleanApp.evaluate(() => (globalThis as any).__threadPageAsks.includes('legacy'))).toBe(false)
      })
      await testInfo.attach('thread-saved-history-evidence', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ daemonRevision: revision, savedCheckpoint, resumed: true, legacyRequests: 0 })) })
      return
    }
    await expect(page.locator('.bubble__cursor')).toHaveCount(0)
    // Establish served/display evidence for the baseline rather than legacy live-only rows.
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await page.locator('.archive__back').click()
    await row.click()
    await expect.poll(() => page.evaluate(async ({ serverId, conversationId }) => {
      const result = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'timeline'
        ? result.snapshot.served?.ids.length ?? 0 : 0
    }, { serverId: daemon.pairFields.server, conversationId })).toBeGreaterThan(0)
    expect(await savedText()).not.toContain(marker)
    await expect(page.locator('.conversation__thread .bubble').filter({ hasText: marker })).toHaveCount(0)
    const child = app.process()
    const { app: reopened, page: fresh } = await initial.relaunch(async () => {
      await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
      // The unique post is created only after full process exit; it cannot be in the saved timeline.
      for (const text of closedPosts) await post(text)
    })
    await reopened.evaluate(({ ipcMain }) => {
      const proof = { asks: [] as string[] }
      ;(globalThis as any).__openingHistoryProof = proof
      ipcMain.on('pyry:command', (_event, command) => { if (command.type === 'requestHistory') proof.asks.push(command.payload.cursor) })
    })
    await expect(fresh.locator('.channel-list__row-open').filter({ hasText: channel })).toBeVisible({ timeout: 45_000 })
    await fresh.locator('.channel-list__row-open').filter({ hasText: channel }).click()
    const thread = fresh.locator('.conversation__thread')
    await expect(thread).toContainText(closedPosts.at(-1)!, { timeout: 20_000 })
    await expect(thread).toContainText(baseline)
    // Inspection can disappear while Electron remains alive. Poll only this read;
    // listener installation, posts and trusted input must never be replayed.
    const asks = async (): Promise<string[]> => {
      let observed: string[] | undefined
      await expect.poll(async () => {
        const value = await readMainProcess(reopened, () => (globalThis as any).__openingHistoryProof.asks as string[])
        if (value === NOT_YET_AVAILABLE) return false
        observed = value
        return true
      }, { timeout: 5_000, message: 'history request inspection is available' }).toBe(true)
      if (observed === undefined) throw new Error('history request inspection unavailable')
      return observed
    }
    await expect.poll(async () => (await asks()).length).toBe(1)
    expect(await asks()).toEqual([''])
    const gap = thread.locator('[data-history-gap]')
    await expect(gap).toHaveCount(1)
    const coverage = () => fresh.evaluate(async ({ serverId, conversationId }) => {
      const result = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'timeline'
        ? { ids: result.snapshot.served?.ids.length ?? 0, gaps: result.snapshot.gaps?.length ?? 0 } : null
    }, { serverId: daemon.pairFields.server, conversationId })
    await expect.poll(async () => (await coverage())?.gaps).toBe(1)
    for (let step = 0; step < 10 && await gap.count() > 0; step++) {
      const before = (await asks()).length
      const ids = (await coverage())!.ids
      await gap.evaluate(el => el.scrollIntoView({ block: 'center' }))
      await fresh.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect((await asks()).length).toBe(before)
      await thread.focus()
      await fresh.keyboard.press('ArrowUp')
      await expect.poll(async () => (await asks()).length).toBe(before + 1)
      await expect.poll(async () => (await coverage())?.ids).toBeGreaterThan(ids)
      await expect(thread.getByText('Loading earlier messages…', { exact: true })).toHaveCount(0)
      expect((await asks()).length).toBe(before + 1)
    }
    await expect(gap).toHaveCount(0)
    const transcript = await thread.innerText()
    let previous = transcript.indexOf(baseline)
    for (const text of closedPosts) {
      const position = transcript.indexOf(text)
      expect(position).toBeGreaterThan(previous)
      expect(transcript.indexOf(text, position + text.length)).toBe(-1)
      previous = position
    }
  })
})
