import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'

type Hook = { queue?: { getSnapshot?: () => unknown }; next: Hook | null }
type Fiber = { memoizedState: Hook | null; child: Fiber | null; sibling: Fiber | null }
type ProofWindow = typeof window & {
  retainedProof: { capture: (text: string) => boolean; present: (text: string) => boolean }
}

test('a held deletion of A removes its retained thread while B stays open', async ({ launchPairedApp }) => {
  const aText = 'retained conversation A'
  const bText = 'retained conversation B'
  const fake = conversationStateFake({ conversations: [{ ...SEEDED_ROW, name: 'Conversation A', is_promoted: false }] })
  let held: readonly Uint8Array[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    const replies = fake(bytes)
    if (request.type === 'delete_conversation') { held = replies; return [] }
    if (request.type === 'request_session_settings') return [encodeEnvelope({
      id: 900, type: 'session_settings', ts: '2026-10-13T00:00:00Z', in_reply_to: request.id,
      payload: { session_id: 'fixture-session', model: 'sonnet', effort: 'high', yolo: false,
        permission_mode: 'default', used_tokens: 10, window_tokens: 100 }
    })]
    return replies
  } }, {
    onLaunched: async app => {
      const page = await app.firstWindow()
      await page.addInitScript(() => {
        let root: Fiber | undefined
        const getters = new Map<string, () => unknown>()
        Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          supportsFiber: true, inject: () => 1,
          onCommitFiberRoot: (_renderer: number, committed: { current: Fiber }) => { root = committed.current },
          onCommitFiberUnmount: () => {}, checkDCE: () => {}
        } })
        // Capture the actual mounted useSyncExternalStore getter, without modifying app state.
        const hasText = (snapshot: unknown, text: string): boolean => {
          if (typeof snapshot !== 'object' || snapshot === null || !('pending' in snapshot) || !Array.isArray(snapshot.pending)) return false
          return snapshot.pending.some(item => item?.kind === 'user_message' && item.content?.text === text) ||
            snapshot.pending.some(item => item?.item?.kind === 'userText' && item.item.text === text)
        }
        ;(window as ProofWindow).retainedProof = {
          capture: text => {
            const visit = (fiber: Fiber | null): void => {
              if (fiber === null) return
              for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                const get = hook.queue?.getSnapshot
                if (get && hasText(get(), text)) getters.set(text, get)
              }
              visit(fiber.child); visit(fiber.sibling)
            }
            if (root) visit(root)
            return getters.has(text)
          },
          present: text => { const get = getters.get(text); return get !== undefined && hasText(get(), text) }
        }
      })
      await page.reload()
    }
  })
  const rows = page.locator('[data-thread-role="user"]')
  const send = async (text: string): Promise<void> => {
    await page.getByPlaceholder('Message…').fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(rows).toContainText([text])
    expect(await page.evaluate(text => (window as ProofWindow).retainedProof.capture(text), text)).toBe(true)
  }
  const open = async (title: string): Promise<void> => {
    await page.locator('.channel-list__row').filter({ hasText: title }).locator('.channel-list__row-open').click()
  }
  const present = (text: string) => page.evaluate(text => (window as ProofWindow).retainedProof.present(text), text)
  await send(aText)
  await confirmCreateChat(page)
  await send(bText)
  await open('Conversation A')
  await expect(rows).toContainText([aText])
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Delete this conversation permanently? This cannot be undone.')).toBeVisible()
  expect(await present(aText)).toBe(true)
  expect(held).toHaveLength(0)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => held.length).toBe(1)
  expect(await present(aText)).toBe(true)
  await open('Untitled')
  await expect(rows).toContainText([bText])
  await expect(page.getByText('Sonnet', { exact: true })).toBeVisible()
  for (const reply of held) daemon.pushFrame(reply)
  // The row's disappearance is a receipt/re-list barrier, rather than an immediate absence check.
  await expect(page.locator('.channel-list__row').filter({ hasText: 'Conversation A' })).toHaveCount(0)
  await expect.poll(() => present(aText)).toBe(false)
  expect(await present(bText)).toBe(true)
  await expect(rows).toContainText([bText])
  await expect(page.locator('.conversation')).toHaveCount(1)
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveCount(1)
  await expect(page.getByText('Sonnet', { exact: true })).toBeVisible()
})
