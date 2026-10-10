import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope, EnvelopeType, ModalShownPayload, WireQuestion } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'

// All content is synthetic. Assert only routing fields; never serialize captured answer tokens.
const OPEN = SEEDED_ROW.id
const GRANT_OPTIONS = ['allow_once', 'allow_always', 'reject_once', 'reject_always'].map(id => ({ id, label: id }))
const OFFER = { offered: true, rules: ['Bash(touch:*)', 'Read(<example>)'] }
const grantShown = (id: string, over: Partial<ModalShownPayload> = {}): Uint8Array => shown(id, {
  options: GRANT_OPTIONS, default_option_id: 'reject_once', always_allow: OFFER, ...over
})
const OTHER = { ...SEEDED_ROW, id: 'other-chat', name: 'Other discussion' }
const OPTIONS = [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }]
const frame = (type: EnvelopeType, payload: unknown): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-07-07T12:00:00.000Z', payload })
const shown = (id: string, over: Partial<ModalShownPayload> = {}): Uint8Array =>
  frame('modal_shown', { conversation_id: OPEN, modal_id: id, class: 'permission',
    title: id, prompt: 'Allow reading the file?', options: OPTIONS, default_option_id: 'deny', ...over })
const dismissed = (id: string): Uint8Array =>
  frame('modal_dismissed', { modal_id: id, outcome: 'remote', source: 'remote' })
const question = (header: string): WireQuestion => ({ header, question: 'Choose ' + header,
  options: [{ label: 'First pick', description: 'A supplied choice' }], multi_select: true })
const questions = (id: string): Uint8Array => frame('question_shown', {
  conversation_id: OPEN, question_batch_id: id, questions: [question('Language'), question('Editor')]
})

function fake(captured: Envelope[], rows: ConversationSummary[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    return env.type === 'list_conversations' ? [frame('conversations', { conversations: rows })] : []
  }
}
function resolutions(captured: Envelope[], id: string, type = 'modal_answer', option?: string): number {
  return captured.filter((e) => {
    const payload = e.payload as { modal_id?: string; option_id?: string }
    return e.type === type && payload.modal_id === id && (option === undefined || payload.option_id === option)
  }).length
}
const panelFor = (page: Page): Locator => page.locator('.permission-panel')
const action = (panel: Locator, name: string): Locator => panel.getByRole('button', { name, exact: true })
const choose = async (panel: Locator, name: string): Promise<void> => {
  await panel.getByRole('button', { name, exact: true }).click()
}
const armed = (panel: Locator): Locator => panel.getByRole('status')
const rowFor = (page: Page, name: string): Locator => page.locator('.channel-list__row').filter({ hasText: name })
const openChat = async (page: Page, name: string): Promise<void> => {
  await rowFor(page, name).locator('.channel-list__row-open').click()
  await expect(rowFor(page, name).locator('.channel-list__row-open')).toHaveAttribute('aria-current', 'true')
}

test('navigation retains checked grant, clears arm and invalidates closed-chat transitions', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const rows = [SEEDED_ROW]
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, rows) })
  rows.push(OTHER)
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  const panel = panelFor(page), checkbox = panel.getByRole('checkbox')
  daemon.pushFrame(grantShown('retained'))
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  await choose(panel, 'allow_once')
  await openChat(page, OTHER.name)
  await expect(panel).toHaveCount(0)
  daemon.pushFrame(grantShown('retained', { description: 'Context-only redelivery while closed' }))
  await openChat(page, SEEDED_ROW.name!)
  await expect(checkbox).toBeChecked()
  await expect(armed(panel)).toHaveCount(0)
  await choose(panel, 'allow_once')
  expect(resolutions(captured, 'retained')).toBe(0)
  await choose(panel, 'allow_once')
  await expect.poll(() => resolutions(captured, 'retained')).toBe(1)
  expect((captured.find(e => e.type === 'modal_answer')!.payload as any).always_allow).toBe(true)

  daemon.pushFrame(grantShown('closed'))
  for (const changed of [
    { always_allow: { offered: false, rules: [] } },
    { options: [...GRANT_OPTIONS].reverse() },
    { options: GRANT_OPTIONS.map(o => ({ ...o, label: 'Changed ' + o.label })) },
    { default_option_id: 'allow_once' }, { class: 'trust' as const }
  ]) {
    await checkbox.press('Space')
    await expect(checkbox).toBeChecked()
    await choose(panel, 'allow_once')
    await openChat(page, OTHER.name)
    daemon.pushFrame(grantShown('closed', changed))
    daemon.pushFrame(grantShown('closed'))
    await openChat(page, SEEDED_ROW.name!)
    await expect(checkbox).not.toBeChecked()
    await expect(armed(panel)).toHaveCount(0)
  }
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  await openChat(page, OTHER.name)
  // Unique ownership disappears and returns before the pane is mounted.
  daemon.pushFrame(frame('conversations', { conversations: [OTHER] }))
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  await openChat(page, SEEDED_ROW.name!)
  await expect(checkbox).not.toBeChecked()
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  await openChat(page, OTHER.name)
  daemon.pushFrame(dismissed('closed'))
  daemon.pushFrame(grantShown('replacement'))
  await openChat(page, SEEDED_ROW.name!)
  await expect(panel).toContainText('replacement')
  await expect(checkbox).not.toBeChecked()
  expect(resolutions(captured, 'closed')).toBe(0)
})

test('inline arrival and growth follow pinned readers while focus preserves held position', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })
  for (let i = 0; i < 24; i++) {
    daemon.pushFrame(frame('assistant_delta', { conversation_id: OPEN, turn_id: 'turn-' + i, seq: 0, text: 'Reader row ' + i }))
    daemon.pushFrame(frame('turn_end', { conversation_id: OPEN, turn_id: 'turn-' + i, stop_reason: 'end_turn' }))
  }
  const thread = page.locator('.conversation__thread'), panel = panelFor(page)
  const distance = () => thread.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
  // Observe layout/resize delivery as well as native motion; never replace a held baseline after arrival.
  const settled = () => thread.evaluate(el => new Promise<number>(resolve => {
    const metrics = () => [el.scrollTop, el.scrollHeight, el.clientHeight]
    let last = metrics(), stable = 0
    const sample = (): void => {
      const next = metrics()
      stable = next.every((value, i) => Math.abs(value - last[i]) < 0.1) ? stable + 1 : 0
      last = next
      if (stable >= 20) resolve(el.scrollTop)
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  const replies = thread.locator('.bubble[data-thread-role="assistant"]')
  await expect(replies).toHaveCount(24)
  await expect(replies.last()).toHaveText(bubbleTextExactly('Reader row 23'))
  expect(await thread.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(500)
  await settled()
  await expect.poll(distance).toBeLessThanOrEqual(2)
  daemon.pushFrame(grantShown('Pinned card'))
  await expect(page.locator('.conversation__thread .permission-panel')).toContainText('Pinned card')
  await settled()
  await expect.poll(distance).toBeLessThanOrEqual(2)
  await choose(panel, 'allow_once')
  await expect(armed(panel)).toBeVisible()
  await settled()
  await expect.poll(distance).toBeLessThanOrEqual(2)
  await capturePairedApp(app, page, '/tmp/builder-1818/inline-armed.png')
  daemon.pushFrame(dismissed('Pinned card'))
  await expect(panel).toHaveCount(0)
  await page.mouse.move(0, 0)
  await settled()
  const box = await thread.boundingBox()
  if (box === null) throw new Error('the overflowing thread must be mounted')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const pinned = await settled()
  // A direct scrollTop write during metadata reflow can retain following through the geometry guard.
  // Trusted upward input releases following before native movement and resize delivery.
  await page.mouse.wheel(0, -500)
  await page.mouse.move(0, 0)
  const before = await settled()
  expect(before).toBeLessThan(pinned - 450)
  expect(before).toBeGreaterThan(0)
  expect(await distance()).toBeGreaterThan(450)
  daemon.pushFrame(grantShown('Held card', { default_to_no: true }))
  await expect(action(panel, 'Cancel')).toBeFocused()
  expect(await settled()).toBeCloseTo(before, 0)
  const cardHeight = await panel.evaluate(el => el.getBoundingClientRect().height)
  daemon.pushFrame(grantShown('Held card', { description: 'Content grows '.repeat(30) }))
  await expect(panel).toContainText('Content grows')
  await expect.poll(() => panel.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(cardHeight)
  expect(await settled()).toBeCloseTo(before, 0)
  await page.getByPlaceholder('Message…').fill('Draft remains available')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Draft remains available')
  expect(await settled()).toBeCloseTo(before, 0)
  await panel.getByRole('checkbox').scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await panel.getByRole('checkbox').focus()
  const checkboxBefore = await settled()
  await panel.getByRole('checkbox').press('Space')
  await expect(panel.getByRole('checkbox')).toBeChecked()
  expect(await settled()).toBeCloseTo(checkboxBefore, 0)
  await action(panel, 'allow_once').scrollIntoViewIfNeeded()
  const armBefore = await settled()
  expect(await distance()).toBeGreaterThan(2)
  await choose(panel, 'allow_once')
  await expect(armed(panel)).toBeVisible()
  expect(await settled()).toBeCloseTo(armBefore, 0)
  await expect(page.locator('.composer__footer')).toBeVisible()
})

test('one session checkbox grants only checked, explicitly confirmed supplied allow options', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })
  const panel = panelFor(page)
  const cases = [
    { option: 'allow_once', checked: true, grant: true },
    { option: 'allow_always', checked: true, grant: true },
    { option: 'allow_once', checked: false },
    { option: 'reject_once', checked: true },
    { option: 'reject_always', checked: true },
    { option: 'allow_once', checked: true, default: 'allow_once' },
    { option: 'allow_once', unavailable: true },
    { option: 'allow_once', trust: true },
    { cancel: true, checked: true }
  ]
  for (const [index, scenario] of cases.entries()) {
    const id = `grant-${index}`
    daemon.pushFrame(grantShown(id, { class: scenario.trust ? 'trust' : 'permission',
      default_option_id: scenario.default ?? 'reject_once',
      always_allow: scenario.unavailable ? { offered: false, rules: [] } : OFFER }))
    await expect(panel).toContainText(id)
    const checkbox = panel.getByRole('checkbox', { name: "Don't ask again this session for:", exact: true })
    if (scenario.trust || scenario.unavailable) await expect(checkbox).toHaveCount(0)
    else {
      await expect(checkbox).not.toBeChecked()
      await expect(panel.locator('.permission-panel__rules li')).toHaveText(OFFER.rules)
      if (index === 0) {
        await capturePairedApp(app, page, '/tmp/builder-1818/grant-unchecked.png')
        await panel.locator('.permission-panel__session-offer label').click()
        await expect(checkbox).toBeChecked()
        await checkbox.press('Space')
        await expect(checkbox).not.toBeChecked()
      }
      if (scenario.checked) await checkbox.press('Space')
      await expect(armed(panel)).toHaveCount(0)
      expect(resolutions(captured, id)).toBe(0)
    }
    if (index === 0) await capturePairedApp(app, page, '/tmp/builder-1818/grant-checked.png')
    if (scenario.cancel) await action(panel, 'Cancel').click()
    else {
      await action(panel, scenario.option!).press('Space')
      if (scenario.option !== (scenario.default ?? 'reject_once')) {
        await expect(armed(panel)).toBeVisible()
        expect(resolutions(captured, id)).toBe(0)
        await action(panel, scenario.option!).click()
      }
    }
    const type = scenario.cancel ? 'modal_cancel' : 'modal_answer'
    await expect.poll(() => resolutions(captured, id, type)).toBe(1)
    const payload = captured.find(e => e.type === type && (e.payload as any).modal_id === id)!.payload as Record<string, unknown>
    expect(payload.always_allow).toBe(scenario.grant ? true : undefined)
    expect(payload).not.toHaveProperty('rules')
    expect(payload).not.toHaveProperty('destination')
    await expect(panel).toHaveCount(0)
  }
})

test('same-ID changed, removed, reordered and restored offers clear opt-in during confirmation', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  const panel = panelFor(page)
  daemon.pushFrame(grantShown('continuous'))
  const checkbox = panel.getByRole('checkbox')
  await checkbox.press('Space')
  await action(panel, 'allow_once').press('Space')
  daemon.pushFrame(grantShown('continuous', { description: 'Same ordered offer' }))
  await expect(checkbox).toBeChecked()
  await expect(armed(panel)).toBeVisible()
  for (const replacement of [undefined, { offered: false, rules: [] },
    { offered: true, rules: ['Changed'] }, { offered: true, rules: [...OFFER.rules].reverse() }]) {
    daemon.pushFrame(grantShown('continuous', { always_allow: replacement }))
    if (replacement?.offered) await expect(checkbox).not.toBeChecked()
    else await expect(checkbox).toHaveCount(0)
    daemon.pushFrame(grantShown('continuous'))
    await expect(checkbox).not.toBeChecked()
    await expect(armed(panel)).toHaveCount(0)
    await checkbox.press('Space')
    await action(panel, 'allow_once').click()
  }
  daemon.pushFrame(dismissed('continuous'))
  daemon.pushFrame(grantShown('new request'))
  await expect(panel).toContainText('new request')
  await expect(checkbox).not.toBeChecked()
  await expect(armed(panel)).toHaveCount(0)
  await checkbox.press('Space')
  await action(panel, 'allow_once').press('Space')
  // Both transitions can reach the store before React renders. Restoring text is not restoring consent.
  daemon.pushFrame(grantShown('new request', { always_allow: { offered: false, rules: [] } }))
  daemon.pushFrame(grantShown('new request', { title: 'Restored offer' }))
  await expect(panel).toContainText('Restored offer')
  await expect(checkbox).not.toBeChecked()
  await action(panel, 'allow_once').click()
  expect(resolutions(captured, 'new request')).toBe(0)
  await action(panel, 'allow_once').click()
  await expect.poll(() => resolutions(captured, 'new request')).toBe(1)
  expect((captured.find(e => e.type === 'modal_answer')!.payload as any).always_allow).toBeUndefined()
})

test('complete long and unbroken rules wrap at 800×600 with reachable confirmation actions', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 800, height: 600 })
  const rules = ['Bash(' + 'a'.repeat(500) + ')', ...Array.from({ length: 15 }, (_, i) => `Read(${i} ${'long rule '.repeat(30)})`)]
  daemon.pushFrame(grantShown('Review session permission', { always_allow: { offered: true, rules } }))
  const panel = panelFor(page)
  await expect(panel.locator('.permission-panel__rules li')).toHaveText(rules)
  await panel.getByRole('checkbox').press('Space')
  await capturePairedApp(app, page, '/tmp/builder-1818/minimum-rules.png')
  for (const activation of [1, 2]) {
    const widths = await panel.locator('.permission-panel__content, .permission-panel__rules, .permission-panel__rules li').evaluateAll(nodes =>
      nodes.map(n => n.scrollWidth <= n.clientWidth + 1))
    expect(widths.every(Boolean)).toBe(true)
    await panel.locator('.permission-panel__rules li').last().scrollIntoViewIfNeeded()
    await expect(panel.locator('.permission-panel__rules li').last()).toBeInViewport()
    for (const button of await panel.locator('.permission-panel__choice').all()) {
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport()
    }
    await action(panel, 'allow_once').scrollIntoViewIfNeeded()
    await expect(action(panel, 'allow_once')).toBeInViewport()
    await action(panel, 'Cancel').scrollIntoViewIfNeeded()
    await expect(action(panel, 'Cancel')).toBeInViewport()
    expect(resolutions(captured, 'Review session permission')).toBe(0)
    await action(panel, 'allow_once').click()
    if (activation === 1) await capturePairedApp(app, page, '/tmp/builder-1818/minimum-armed.png')
  }
  await expect.poll(() => resolutions(captured, 'Review session permission')).toBe(1)
})

test('permission context and initial Cancel focus preserve deliberate keyboard response gates', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })
  const panel = panelFor(page)
  const chat = rowFor(page, SEEDED_ROW.name!).locator('.channel-list__row-open')
  for (const hint of [{}, { default_to_no: false }]) {
    const id = 'Unhinted ' + Object.keys(hint).length
    await chat.focus()
    daemon.pushFrame(shown(id, hint))
    await expect(panel).toContainText(id)
    await expect(chat).toBeFocused()
    daemon.pushFrame(dismissed(id))
    await expect(panel).toHaveCount(0)
  }

  daemon.pushFrame(shown('Review file access', { reason: 'The command accesses a protected file.',
    reason_type: 'classifier', description: 'Review the requested operation before continuing.',
    blocked_path: '/workspace/reports/summary.json', default_to_no: true }))
  await expect(panel).toContainText('The auto classifier could not approve this: The command accesses a protected file.')
  await expect(panel).toContainText('Review the requested operation before continuing.')
  await expect(panel).toContainText('/workspace/reports/summary.json')
  await expect(action(panel, 'Cancel')).toBeFocused()
  await expect(armed(panel)).toHaveCount(0)
  await expect(panel.getByRole('radio')).toHaveCount(0)
  await capturePairedApp(app, page, '/tmp/builder-1818/context.png')
  await page.keyboard.press('Enter')
  await expect.poll(() => resolutions(captured, 'Review file access', 'modal_cancel')).toBe(1)
  expect(resolutions(captured, 'Review file access')).toBe(0)

  const hintedDefault = { default_to_no: true, default_option_id: 'allow', reason: false }
  daemon.pushFrame(shown('Supplied affirmative default', hintedDefault))
  await expect(action(panel, 'Cancel')).toBeFocused()
  await expect(panel).toContainText('Reason: false')
  const defaultChoice = action(panel, 'Allow')
  await defaultChoice.focus()
  daemon.pushFrame(shown('Supplied affirmative default', { ...hintedDefault, description: 'Updated context' }))
  await expect(panel).toContainText('Updated context')
  await expect(defaultChoice).toBeFocused()
  expect(resolutions(captured, 'Supplied affirmative default')).toBe(0)
  await defaultChoice.press('Enter')
  await expect.poll(() => resolutions(captured, 'Supplied affirmative default', 'modal_answer', 'allow')).toBe(1)

  daemon.pushFrame(shown('Nondefault response', { default_to_no: true, reason_type: 'rule' }))
  await expect(action(panel, 'Cancel')).toBeFocused()
  await action(panel, 'Allow').press('Space')
  await expect(armed(panel)).toBeVisible()
  expect(resolutions(captured, 'Nondefault response')).toBe(0)
  await chat.focus()
  daemon.pushFrame(shown('Nondefault response', { default_to_no: true, description: 'Updated' }))
  await expect(panel).toContainText('Updated')
  await expect(chat).toBeFocused()
  await action(panel, 'Allow').press('Enter')
  await expect.poll(() => resolutions(captured, 'Nondefault response', 'modal_answer', 'allow')).toBe(1)
})

test('permission and trust use defaults and two activations; cancellation and peer resolution advance FIFO', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 1280, height: 800 })
  const panel = panelFor(page)
  daemon.pushFrame(shown('Default permission'))
  await expect(panel).toBeVisible()
  await expect(armed(panel)).toHaveCount(0)
  await expect(panel.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.permission-modal-overlay')).toHaveCount(0)
  await capturePairedApp(app, page, '/tmp/builder-1818/safe-default.png')
  await choose(panel, 'Deny')
  await expect.poll(() => resolutions(captured, 'Default permission', 'modal_answer', 'deny')).toBe(1)
  await expect(panel).toHaveCount(0)

  daemon.pushFrame(shown('Confirm permission'))
  await choose(panel, 'Allow')
  await expect(armed(panel)).toBeVisible()
  expect(resolutions(captured, 'Confirm permission')).toBe(0)
  await capturePairedApp(app, page, '/tmp/builder-1818/armed.png')
  await choose(panel, 'Allow')
  await expect.poll(() => resolutions(captured, 'Confirm permission', 'modal_answer', 'allow')).toBe(1)

  // The supplied default is authoritative even when it is affirmative.
  daemon.pushFrame(shown('Trust workspace', { class: 'trust', options: [
    { id: 'proceed', label: 'Proceed' }, { id: 'exit', label: 'Exit' }
  ], default_option_id: 'proceed' }))
  await choose(panel, 'Proceed')
  await expect.poll(() => resolutions(captured, 'Trust workspace', 'modal_answer', 'proceed')).toBe(1)

  daemon.pushFrame(shown('Replace options'))
  daemon.pushFrame(shown('Next request'))
  await choose(panel, 'Allow')
  await expect(armed(panel)).toBeVisible()
  daemon.pushFrame(shown('Replace options', { options: [OPTIONS[0]] }))
  await expect(armed(panel)).toHaveCount(0)
  daemon.pushFrame(shown('Replace options'))
  await expect(panel.locator('.permission-panel__choice')).toHaveCount(2)
  await expect(armed(panel)).toHaveCount(0)
  await choose(panel, 'Allow')
  daemon.pushFrame(dismissed('Replace options'))
  await expect(panel).toContainText('Next request')
  await expect(armed(panel)).toHaveCount(0)
  expect(resolutions(captured, 'Replace options')).toBe(0)
  daemon.pushFrame(shown('After cancel'))
  await action(panel, 'Cancel').click()
  await expect.poll(() => resolutions(captured, 'Next request', 'modal_cancel')).toBe(1)
  expect(resolutions(captured, 'Next request')).toBe(0)
  await expect(panel).toContainText('After cancel')
  await expect(armed(panel)).toHaveCount(0)
  daemon.pushFrame(dismissed('After cancel'))
  await expect(panel).toHaveCount(0)

  for (const env of captured.filter((e) => e.type === 'modal_answer')) {
    expect(Object.keys(env.payload as object).sort()).toEqual(['answer_token', 'modal_id', 'option_id'])
  }
})

test('chat-scoped FIFO and rejection feedback survive optimistic removal, switching and reconnect', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const rows = [SEEDED_ROW]
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: fake(captured, rows),
    reconnectResendFrames: [shown('Reconnect marker', { conversation_id: OTHER.id })]
  })
  rows.push(OTHER)
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  const panel = panelFor(page)
  daemon.pushFrame(shown('Other first', { conversation_id: OTHER.id, reason: 'Other chat context', default_to_no: true }))
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toBeVisible()
  await expect(rowFor(page, SEEDED_ROW.name!).locator('.channel-list__row-open')).toHaveAttribute('aria-current', 'true')
  await expect(panel).toHaveCount(0)
  daemon.pushFrame(shown('Open first'))
  daemon.pushFrame(shown('Open second'))
  await expect(panel).toContainText('Open first')
  await choose(panel, 'Allow')
  await openChat(page, OTHER.name)
  await expect(panel).toContainText('Other first')
  await expect(panel).toContainText('Reason: Other chat context')
  await expect(action(panel, 'Cancel')).toBeFocused()
  await expect(armed(panel)).toHaveCount(0)
  await openChat(page, SEEDED_ROW.name!)
  await expect(panel).toContainText('Open first')
  await expect(panel).not.toContainText('Other chat context')
  await expect(armed(panel)).toHaveCount(0)
  await choose(panel, 'Deny')
  await expect.poll(() => resolutions(captured, 'Open first')).toBe(1)
  await expect(panel).toContainText('Open second')

  // Delay rejection until the originating chat is no longer open.
  await openChat(page, OTHER.name)
  daemon.pushFrame(frame('error', {}))
  await expect(panel).toContainText('Other first')
  await expect(page.locator('.modal-rejection')).toHaveCount(0)
  await action(panel, 'Cancel').click()
  await expect.poll(() => resolutions(captured, 'Other first', 'modal_cancel')).toBe(1)
  await openChat(page, SEEDED_ROW.name!)
  const banner = page.locator('.modal-rejection')
  await expect(banner).toContainText('Your answer was rejected.')
  daemon.pushFrame(dismissed('Open second'))
  await expect(page.getByPlaceholder('Message…')).toBeVisible()
  await page.getByPlaceholder('Message…').fill('Feedback does not cover input')
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toHaveCount(0)
  forwarder.dropClientLeg()
  await expect(rowFor(page, OTHER.name).getByRole('img', { name: 'Input required' })).toBeVisible({ timeout: 15_000 })
  await expect(banner).toBeVisible()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Feedback does not cover input')
  daemon.pushFrame(questions('question-after-rejection'))
  const questionnaire = page.locator('.question-panel:not(.permission-panel)')
  await expect(questionnaire).toBeVisible()
  const bannerBox = await banner.boundingBox()
  const questionBox = await questionnaire.boundingBox()
  expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(questionBox!.y)
  await openChat(page, OTHER.name)
  await expect(banner).toHaveCount(0)
  await openChat(page, SEEDED_ROW.name!)
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toHaveCount(0)
  await expect(questionnaire).toBeVisible()
})

test('inline permission retains draft, questionnaire picks, Other across all questions while isolating hidden inputs', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: fake(captured, [SEEDED_ROW]) })
  await page.setViewportSize({ width: 800, height: 600 })
  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Retained draft')
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel,
      { type: 'completed', uploadId: 'retained-upload', filename: 'synthetic.pdf' })
  }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
  const attachment = page.locator('.composer__attachments')
  await expect(attachment).toBeVisible()
  daemon.pushFrame(questions('waiting-batch'))
  const questionnaire = page.locator('.question-panel:not(.permission-panel)')
  const other = questionnaire.getByRole('textbox', { name: 'Other. Type something.' }).first()
  const secondOther = questionnaire.getByRole('textbox', { name: 'Other. Type something.' }).nth(1)
  await questionnaire.locator('.question-panel__option').filter({ hasText: 'First pick' }).first().click()
  await other.fill('Retained first Other')
  await secondOther.fill('Retained editor Other')
  const longPath = '/workspace/reports/' + 'a'.repeat(180) + '.json'
  const longText = `Write the generated report to ${longPath}?\n` +
    'A complete explanation must wrap and remain reachable. '.repeat(160) + 'FINAL EXPLANATION'
  const allowLabel = `Allow writing ${longPath}`
  daemon.pushFrame(shown('Long permission', {
    title: 'Long permission ' + 'A complete title must wrap. '.repeat(80),
    prompt: longText, options: [OPTIONS[0], { id: 'allow', label: allowLabel }],
    reason: 'A long permission reason. '.repeat(100), reason_type: 'rule',
    description: 'Additional details. '.repeat(100), blocked_path: longPath
  }))
  const panel = panelFor(page)
  await expect(panel).toBeVisible()
  await expect(questionnaire).toBeHidden()
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue('Retained draft')
  await expect(page.locator('.composer__footer')).toBeVisible()
  await expect(attachment).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(panel.locator('.permission-panel__explanation')).toHaveText(longText)
  // Hidden focused inputs cannot retain keyboard input, focus, or a submit gesture.
  await action(panel, 'Cancel').focus()
  await page.keyboard.type('SHOULDNOTREACHHIDDENINPUT')
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[hidden]') !== null)).toBe(false)
  }
  expect(captured.filter((e) => ['send_message', 'question_answer', 'modal_answer'].includes(e.type))).toHaveLength(0)
  const scroll = page.locator('.conversation__thread')
  const expectNoHorizontalOverflow = async (): Promise<void> => {
    for (const element of [scroll, panel.locator('.permission-panel__title'), panel.locator('.permission-panel__explanation'),
      ...await panel.locator('.permission-panel__context-text').all()]) {
      const width = await element.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      expect.soft(width.scroll).toBeLessThanOrEqual(width.client)
    }
  }
  await expectNoHorizontalOverflow()
  const dimensions = await scroll.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(dimensions.scroll).toBeGreaterThan(dimensions.client)
  await action(panel, 'Cancel').scrollIntoViewIfNeeded()
    await expect(action(panel, 'Cancel')).toBeInViewport()
  await capturePairedApp(app, page, '/tmp/builder-1818/context.png')
  await panel.locator('.permission-panel__context').scrollIntoViewIfNeeded()
  await capturePairedApp(app, page, '/tmp/builder-1818/context.png')
  await expect(panel.locator('.permission-panel__context-text').last()).toHaveText(longPath)
  await panel.locator('.permission-panel__context-text').last().scrollIntoViewIfNeeded()
  await action(panel, 'Cancel').scrollIntoViewIfNeeded()
    await expect(action(panel, 'Cancel')).toBeInViewport()
  await capturePairedApp(app, page, '/tmp/builder-1818/context.png')
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await action(panel, allowLabel).scrollIntoViewIfNeeded()
  await choose(panel, allowLabel)
  await expect(armed(panel)).toBeVisible()
  await expectNoHorizontalOverflow()
  await action(panel, 'Cancel').scrollIntoViewIfNeeded()
    await expect(action(panel, 'Cancel')).toBeInViewport()
  await capturePairedApp(app, page, '/tmp/builder-1818/minimum-context-armed.png')
  expect(resolutions(captured, 'Long permission')).toBe(0)
  await choose(panel, 'Deny')
  await expect.poll(() => resolutions(captured, 'Long permission', 'modal_answer', 'deny')).toBe(1)
  await expect(questionnaire).toBeVisible()
  await expect(secondOther).toHaveValue('Retained editor Other')
  await expect(other).toHaveValue('Retained first Other')
  await expect(questionnaire.getByRole('checkbox', { name: /First pick/ }).first()).toBeChecked()
  daemon.pushFrame(frame('question_dismissed', { question_batch_id: 'waiting-batch', outcome: 'unanswered', source: 'no_answer' }))
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue('Retained draft')
  await expect(attachment).toBeVisible()
})
