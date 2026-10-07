import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

const TS = '2026-07-07T12:00:00.000Z'
const USER = 'A user "quote"\nsecond line'
const PARTIAL = '# Heading\nA "literal" quote'
const SUFFIX = '\n```ts\nconst x = 1\n```'
const SOURCE = PARTIAL + SUFFIX
const DRAFT = '  Existing draft  '
const quote = (label: string, text: string): string => `${label}:\n"${text}"\n`
const assistant = (text: string, seq = 0) => encodeEnvelope({
  id: 20 + seq, type: 'assistant_delta', ts: TS,
  payload: { conversation_id: SEEDED_ROW.id, turn_id: 'reply-turn', seq, text }
})
const turnEnd = () => encodeEnvelope({
  id: 30, type: 'turn_end', ts: TS,
  payload: { conversation_id: SEEDED_ROW.id, turn_id: 'reply-turn', stop_reason: 'end_turn' }
})

async function openRow(page: Page, name: string): Promise<void> {
  await page.locator('.channel-list__row').filter({ hasText: name })
    .locator('.channel-list__row-open').click()
}

async function expectDraftEnd(input: Locator, value: string): Promise<void> {
  await expect(input).toHaveValue(value)
  await expect(input).toBeFocused()
  expect(await input.evaluate((node: HTMLTextAreaElement) =>
    [node.selectionStart, node.selectionEnd])).toEqual([value.length, value.length])
}

test('pointer and keyboard replies append current source, focus once, and send the edited quote intact', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({ conversations: [SEEDED_ROW] })
  const sent: SendMessagePayload[] = []
  const { page, daemon, app } = await launchPairedApp({ buildReplyFrames: inbound => {
    const frame = decodeEnvelope(inbound)
    if (frame.type === 'send_message') {
      sent.push(frame.payload as SendMessagePayload)
      return []
    }
    return fake(inbound)
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  const input = page.locator('.composer__input')
  await input.fill(USER)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  daemon.pushFrame(assistant(PARTIAL))
  const assistantRow = page.locator('.message-row--daemon').filter({ hasText: 'literal' })
  const reply = assistantRow.getByRole('button', { name: 'Reply to message' })
  await expect(reply).toBeVisible()
  await input.fill(DRAFT)
  await reply.click()
  let draft = `${DRAFT}\n${quote('Assistant', PARTIAL)}`
  await expectDraftEnd(input, draft)

  // The same mounted control must read the latest streamed source at activation.
  daemon.pushFrame(assistant(SUFFIX, 1))
  daemon.pushFrame(turnEnd())
  await expect(assistantRow.locator('.bubble__markdown')).toBeVisible()
  await reply.focus()
  await page.keyboard.press('Enter')
  draft += quote('Assistant', SOURCE)
  await expectDraftEnd(input, draft)

  const userRow = page.locator('.message-row--user').filter({ hasText: USER }).first()
  const userCopy = userRow.getByRole('button', { name: 'Copy message' })
  const userReply = userRow.getByRole('button', { name: 'Reply to message' })
  await userCopy.focus()
  await page.keyboard.press('Tab')
  await expect(userReply).toBeFocused()
  expect(await userReply.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  await page.keyboard.press('Space')
  draft += quote('User', USER)
  await expectDraftEnd(input, draft)

  // Layout and button state belong to the browser tier, including non-overlapping targets.
  const geometry = await assistantRow.evaluate(el => {
    const actions = el.querySelector('.message-actions') as HTMLElement
    const buttons = actions.querySelectorAll('button')
    const copy = buttons[0].getBoundingClientRect()
    const reply = buttons[1].getBoundingClientRect()
    const icon = actions.querySelector('.bubble__reply-icon') as HTMLElement
    const bounds = actions.getBoundingClientRect()
    return {
      width: bounds.width, gap: reply.top - copy.bottom,
      centre: (copy.top + reply.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
      icon: [icon.clientWidth, icon.clientHeight],
      colour: getComputedStyle(icon).backgroundColor,
      mask: getComputedStyle(icon).maskImage,
      opacity: getComputedStyle(buttons[1]).opacity
    }
  })
  expect(geometry.width).toBe(13)
  expect(geometry.gap).toBe(4)
  expect(Math.abs(geometry.centre)).toBeLessThan(1)
  expect(geometry.icon).toEqual([13, 12])
  expect(geometry.colour).toBe('rgb(50, 98, 141)')
  expect(geometry.mask).not.toBe('none')
  expect(geometry.mask).not.toContain('data:')
  // A CSS URL alone cannot prove the asset loaded under the renderer CSP.
  expect(await assistantRow.locator('.bubble__reply-icon').evaluate(async el => {
    const url = getComputedStyle(el).maskImage.slice(5, -2)
    const image = new Image()
    image.src = url
    await image.decode()
    return [image.naturalWidth, image.naturalHeight]
  })).toEqual([13, 12])
  expect(geometry.opacity).toBe('1')
  await reply.hover()
  expect(await reply.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: '/tmp/builder-1779/reply-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1779/reply-800.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await confirmCreateChat(page)
  await expect(input).toHaveValue('')
  await input.fill('Other conversation draft')
  await openRow(page, SEEDED_ROW.name as string)
  await expect(input).toHaveValue(draft)
  await expect(input).not.toBeFocused() // A remount must not replay the old focus request.
  await openRow(page, 'Untitled')
  await expect(input).toHaveValue('Other conversation draft')
  await openRow(page, SEEDED_ROW.name as string)

  // Editing uses the existing controlled path, with no caret replay on a draft render.
  await input.focus()
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0))
  await page.keyboard.type('prefix ')
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(7)
  await input.fill(`prefix ${draft}My answer  \n`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1].text).toBe(`prefix ${draft}My answer`.trim())
  expect(sent[1].conversation_id).toBe(SEEDED_ROW.id)
  await expect(input).toHaveValue('')
  await app.evaluate(({ clipboard }) => clipboard.writeText('reply-copy-probe'))
  await userCopy.click()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(USER)
})

test('covered replies focus when permission clears once, and pending focus is discarded on chat switch', async ({ launchPairedApp }) => {
  const other = { ...SEEDED_ROW, id: 'other-reply-chat', name: 'Other reply discussion' }
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  })
  daemon.pushFrame(encodeEnvelope({ id: 39, type: 'conversations', ts: TS,
    payload: { conversations: [SEEDED_ROW, other] } }))
  const input = page.locator('.composer__input')
  const reply = page.getByRole('button', { name: 'Reply to message' })
  const permission = page.locator('.permission-panel')
  const showPermission = (id: string): void => daemon.pushFrame(encodeEnvelope({
    id: 40, type: 'modal_shown', ts: TS, payload: {
      conversation_id: SEEDED_ROW.id, modal_id: id, class: 'permission',
      title: 'Read a file', prompt: 'Allow reading the file?', default_to_no: true,
      options: [{ id: 'deny', label: 'Deny' }], default_option_id: 'deny'
    }
  }))
  const dismissPermission = (id: string): void => daemon.pushFrame(encodeEnvelope({
    id: 41, type: 'modal_dismissed', ts: TS,
    payload: { modal_id: id, outcome: 'remote', source: 'remote' }
  }))
  daemon.pushFrame(assistant(SOURCE))
  daemon.pushFrame(turnEnd())
  await expect(reply).toBeVisible()
  await input.fill(DRAFT)
  showPermission('covered-reply')
  await expect(permission).toBeVisible()
  await expect(input).toBeHidden()
  await reply.click()
  await reply.press('Enter')
  const draft = `${DRAFT}\n${quote('Assistant', SOURCE)}${quote('Assistant', SOURCE)}`
  await expect(input).toHaveValue(draft)
  await expect(input).not.toBeFocused()
  await expect(permission).toBeVisible()
  dismissPermission('covered-reply')
  await expect(permission).toHaveCount(0)
  await expectDraftEnd(input, draft)

  // Once consumed, neither typing nor a later permission dismissal replays the request.
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 0))
  await page.keyboard.type('prefix ')
  expect(await input.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(7)
  showPermission('no-new-reply')
  await expect(permission.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  dismissPermission('no-new-reply')
  await expect(permission).toHaveCount(0)
  await expect(input).not.toBeFocused()
  await expect(input).toHaveValue('prefix ' + draft)

  // Leaving the intended pane cancels the request even if its permission clears elsewhere.
  showPermission('leaving-reply')
  await expect(permission).toBeVisible()
  await reply.click()
  const retained = 'prefix ' + draft + quote('Assistant', SOURCE)
  await expect(input).toHaveValue(retained)
  await openRow(page, other.name)
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(input).not.toBeFocused()
  await input.fill('Other draft')
  dismissPermission('leaving-reply')
  await openRow(page, SEEDED_ROW.name as string)
  await expect(input).toBeVisible()
  await expect(input).toHaveValue(retained)
  await expect(input).not.toBeFocused()
  await openRow(page, other.name)
  await expect(input).toHaveValue('Other draft')
})

test('reply isolates equal conversation ids across hosts', async ({ launchPairedApp }) => {
  const secondRow = { ...SECOND_SEEDED_ROW, id: SEEDED_ROW.id }
  const { page, servers } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  }, { secondServer: {
    buildReplyFrames: conversationStateFake({ conversations: [secondRow] })
  } })
  const input = page.locator('.composer__input')
  await openRow(page, secondRow.name as string)
  await input.fill('Second host draft\n')
  await openRow(page, SEEDED_ROW.name as string)
  await expect(input).toHaveValue('')
  servers[0].daemon.pushFrame(assistant(SOURCE))
  servers[0].daemon.pushFrame(turnEnd())
  const reply = page.getByRole('button', { name: 'Reply to message' })
  await expect(reply).toBeVisible()
  await reply.click()
  const firstDraft = quote('Assistant', SOURCE)
  await expectDraftEnd(input, firstDraft)
  await openRow(page, secondRow.name as string)
  await expect(input).toHaveValue('Second host draft\n')
  servers[1].daemon.pushFrame(assistant('Second host source'))
  servers[1].daemon.pushFrame(turnEnd())
  await expect(reply).toBeVisible()
  await reply.click()
  const secondDraft = `Second host draft\n${quote('Assistant', 'Second host source')}`
  await expectDraftEnd(input, secondDraft)
  await openRow(page, SEEDED_ROW.name as string)
  await expect(input).toHaveValue(firstDraft)
  await openRow(page, secondRow.name as string)
  await expect(input).toHaveValue(secondDraft)
})

test('reply appends and focuses in a reopened saved offline chat', async ({ launchPairedApp }) => {
  const { page, daemon, forwarder, servers } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  })
  daemon.pushFrame(assistant(SOURCE))
  daemon.pushFrame(turnEnd())
  await expect(page.getByRole('button', { name: 'Reply to message' })).toBeVisible()
  await expect.poll(async () => {
    const result = await page.evaluate(serverId => window.pyry.chatHistory({
      operation: 'readTimeline', serverId, conversationId: 'seed-conversation'
    }), servers[0].serverId)
    return result.status === 'stored' && result.snapshot.kind === 'timeline'
      ? result.snapshot.items.some(item => item.kind === 'assistantText' && item.text === SOURCE) : false
  }).toBe(true)
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await confirmCreateChat(page)
  const input = page.locator('.composer__input')
  await input.fill('Other offline draft')
  forwarder.closeClientLeg(4401)
  await openRow(page, SEEDED_ROW.name as string)
  await expect(page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
  await input.fill('Offline draft\n')
  const reply = page.getByRole('button', { name: 'Reply to message' })
  await expect(reply).toBeVisible()
  await reply.click()
  await expectDraftEnd(input, 'Offline draft\n' + quote('Assistant', SOURCE))
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await openRow(page, 'Untitled')
  await expect(input).toHaveValue('Other offline draft')
})

test('received history is saved for equal ids on different hosts and replies reopen offline', async ({ launchPairedApp }) => {
  const secondRow = { ...SECOND_SEEDED_ROW, id: SEEDED_ROW.id }
  const secondSource = 'Only the second host supplied this reply'
  const { page, servers } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] })
  }, { secondServer: {
    buildReplyFrames: conversationStateFake({ conversations: [secondRow] })
  } })
  const savedReplies = async (serverId: string) => {
    const result = await page.evaluate(host => window.pyry.chatHistory({
      operation: 'readTimeline', serverId: host, conversationId: 'seed-conversation'
    }), serverId)
    return result.status === 'stored' && result.snapshot.kind === 'timeline'
      ? result.snapshot.items.filter(item => item.kind === 'assistantText').map(item => item.text) : null
  }
  await openRow(page, SEEDED_ROW.name as string)
  servers[0].daemon.pushFrame(assistant(SOURCE))
  servers[0].daemon.pushFrame(turnEnd())
  const reply = page.getByRole('button', { name: 'Reply to message' })
  await expect(reply).toBeVisible()
  await expect.poll(() => savedReplies(servers[0].serverId)).toEqual([SOURCE])
  await openRow(page, secondRow.name as string)
  servers[1].daemon.pushFrame(assistant(secondSource))
  servers[1].daemon.pushFrame(turnEnd())
  await expect(reply).toBeVisible()
  await expect.poll(() => savedReplies(servers[1].serverId)).toEqual([secondSource])
  await expect.poll(() => savedReplies(servers[0].serverId)).toEqual([SOURCE])
  await expect(page.getByText(secondSource, { exact: true })).toBeVisible()

  servers[0].forwarder.closeClientLeg(4401)
  await openRow(page, SEEDED_ROW.name as string)
  await expect(page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
  await expect(reply).toHaveCount(1)
  await expect(page.getByText(secondSource, { exact: true })).toHaveCount(0)
  const input = page.locator('.composer__input')
  await input.fill('First host offline draft\n')
  await reply.click()
  await expectDraftEnd(input, 'First host offline draft\n' + quote('Assistant', SOURCE))
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect.poll(() => savedReplies(servers[0].serverId)).toEqual([SOURCE])
  await expect.poll(() => savedReplies(servers[1].serverId)).toEqual([secondSource])
})
