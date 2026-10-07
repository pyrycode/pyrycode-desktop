import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

for (const mode of ['automatic', 'explicit', 'terminal'] as const) {
  test(`accepted disconnected messages drain and settle: ${mode}`, async ({ launchPairedApp }) => {
    const sends: SendMessagePayload[] = []
    const otherSends: SendMessagePayload[] = []
    const { page, app, daemon, forwarder, servers } = await launchPairedApp({ buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type === 'list_conversations') return [seedConversationsFrame()]
      if (frame.type === 'send_message') sends.push(frame.payload as SendMessagePayload)
      return []
    } }, { secondServer: mode === 'terminal' ? { buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type === 'list_conversations') return [seedConversationsFrame(SECOND_SEEDED_ROW)]
      if (frame.type === 'send_message') otherSends.push(frame.payload as SendMessagePayload)
      return []
    } } : undefined })
    await page.setViewportSize({ width: mode === 'terminal' ? 800 : 1280, height: 800 })
    if (mode === 'terminal') await page.locator('.channel-list__row').filter({ hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
    const push = (type: string, fields: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
      id: 77, type, ts: '2026-10-07T12:00:00Z', payload: { conversation_id: SEEDED_ROW.id, ...fields }
    }))
    push('turn_state', { state: 'responding' })
    push('assistant_delta', { turn_id: 'first', seq: 0, text: 'Earlier running reply' })
    await expect(page.getByText('Earlier running reply', { exact: false })).toBeVisible()

    // Hold accepted renderer commands at the existing IPC boundary, then deliver them during
    // the real reconnect gap. Pause only the synthetic pairing read to make that gap observable.
    await app.evaluate(({ ipcMain }) => {
      const listeners = ipcMain.listeners('pyry:command')
      ipcMain.removeAllListeners('pyry:command')
      const pending: { event: unknown; command: any }[] = []
      ipcMain.on('pyry:command', (event, command) => {
        if (command.type === 'sendMessage') pending.push({ event, command })
        else for (const listener of listeners) listener(event, command)
      })
      const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
      const original = fs.readFile
      let release: () => void = () => {}
      let reject: () => void = () => {}
      const gate = new Promise<void>((resolve, fail) => {
        release = resolve
        reject = () => fail(new Error('synthetic pairing read failure'))
      })
      const pairingFile = Buffer.from('pyrycode.paired_server').toString('base64url') + '.bin'
      fs.readFile = (async (file: any, options: any) => {
        if (String(file).endsWith(pairingFile)) await gate
        return original(file, options)
      }) as typeof fs.readFile
      ;(globalThis as any).__delivery1853 = {
        pending,
        forward: () => { for (const { event, command } of pending.splice(0)) for (const listener of listeners) listener(event, command) },
        resume: (fail: boolean) => { fs.readFile = original; if (fail) reject(); else release() }
      }
    })
    try {
    const composer = page.getByPlaceholder('Message…')
    for (const text of ['Held message one', 'Held message two']) {
      await composer.fill(text)
      await composer.press('Enter')
      await expect(page.locator('.message-row--user', { hasText: text })).toHaveCount(1)
    }
    await expect.poll(() => app.evaluate(() => (globalThis as any).__delivery1853.pending.length)).toBe(2)
    const accepted = await app.evaluate(() => (globalThis as any).__delivery1853.pending.map((entry: any) => entry.command.payload))
    if (mode === 'automatic') {
      forwarder.dropClientLeg()
      await expect(page.getByRole('button', { name: 'Stop the running turn', exact: true })).toBeDisabled()
    } else await page.evaluate(serverId => window.pyry.reconnectServer(serverId), servers[0].serverId)
    await app.evaluate(() => (globalThis as any).__delivery1853.forward())
    await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(2)
    await expect(page.locator('.message-row--queued')).toHaveCount(0)
    expect(sends).toHaveLength(0)
    await page.screenshot({ path: `/tmp/builder-1853/waiting-${mode}.png` })
    if (mode === 'terminal') {
      await page.locator('.channel-list__row').filter({ hasText: SECOND_SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
      await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(0)
      await composer.fill('Other host draft stays here')
    }
    await app.evaluate((_electron, fail) => (globalThis as any).__delivery1853.resume(fail), mode === 'terminal')
    if (mode === 'terminal') {
      await page.locator('.channel-list__row').filter({ hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
      await expect(page.getByText('Not sent', { exact: true })).toHaveCount(2)
      await page.screenshot({ path: '/tmp/builder-1853/not-sent-800.png' })
      expect(sends).toHaveLength(0)
      await page.getByRole('button', { name: 'Connection error - Reconnect', exact: true }).click()
    }
    await expect.poll(() => sends).toEqual(accepted)
    await expect(page.getByText('Waiting for connection', { exact: true })).toHaveCount(0)
    const queued = sends.map((p, i) => ({ queued_msg_id: i + 7, message_id: p.message_id, text: p.text, ts: '' }))
    push('queue_state', { queued })
    await expect(page.locator('.message-row--queued')).toHaveCount(2)
    push('turn_end', { turn_id: 'first', stop_reason: 'end_turn' })
    for (let i = 0; i < 2; i++) {
      push('message', { ...queued[i], role: 'user', text: 'receipt must preserve original text' })
      push('queue_state', { queued: queued.slice(i + 1) })
      push('assistant_delta', { turn_id: `answer-${i}`, seq: 0, text: `Answer ${i}` })
      push('turn_end', { turn_id: `answer-${i}`, stop_reason: 'end_turn' })
      await expect(page.getByText(`Answer ${i}`, { exact: false })).toBeVisible()
    }
    const rows = page.locator('.conversation__thread [data-thread-role]')
    const before = await rows.allTextContents()
    push('message', { ...queued[0], role: 'user', text: 'duplicate ignored' })
    push('assistant_delta', { turn_id: 'barrier', seq: 0, text: 'Replay barrier' })
    await expect(page.getByText('Replay barrier', { exact: false })).toBeVisible()
    expect((await rows.allTextContents()).slice(0, -1)).toEqual(before)
    for (let i = 0; i < 2; i++) {
      expect(before.findIndex(text => text.includes(i === 0 ? 'Held message one' : 'Held message two')))
        .toBeLessThan(before.findIndex(text => text.includes(`Answer ${i}`)))
    }
    await expect(page.getByText('receipt must preserve original text', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Not sent', { exact: true })).toHaveCount(0)
    expect(sends).toEqual(accepted)
    expect(otherSends).toHaveLength(0)
    } finally {
      await app.evaluate(() => (globalThis as any).__delivery1853.resume(false))
    }
  })
}
