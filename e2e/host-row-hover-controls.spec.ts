import { test, expect } from './fixtures/launchPairedApp'
import type { Locator } from '@playwright/test'

// #1185 — the ONE criterion of that ticket a running window can answer today, and the reason it gets a
// spec at all when the rest of the ticket is unit-only.
//
// The host row's pen and plus each draw only when their handler is passed, and #1185 SHIPS NO CALLER:
// the Edit host dialog (#1187) and the Add workspace dialog (#1189) pass them. So the drawn geometry
// (right 2 / right 28, 16 and 14, --color-primary) and "clicking fires that handler" are unobservable
// here and land with those two tickets, where the controls are drawn for the first time —
// `ChannelList.test.tsx` owns the markup contract in the meantime.
//
// What IS observable is the swap's GUARD, and it guards behaviour already in a user's hands. The dots
// give way only to a control that is actually drawn (`channels.css`'s `:has()`), so a production host
// row keeps its connection status on hover. Written the obvious way instead —
// `.channel-list__host:hover .channel-list__host-status { opacity: 0 }` — the shipped app would blank
// both dots into an empty slot on every hover for as long as #1187 and #1189 take. The unit tier cannot
// see that: `vitest.config.ts` sets `environment: 'node'` and every renderer spec is a
// `renderToStaticMarkup` string assertion, so no CSS is evaluated anywhere but here.
//
// ⭐ WHY THE WORKSPACE ROW IS IN THIS FILE. "The dots did NOT disappear" is the shape of assertion that
// passes for the wrong reason — a hover that never fired reads identically to a guard that worked. So
// the drive hovers a WORKSPACE row first and watches its plus come up, which is a positive, same-
// mechanism proof that `:hover` reaches this tree at all; and after moving to the host row it watches
// that plus go back down, which proves the pointer actually left. Only then is the host row's own read
// worth anything. Both of those are `.channel-list__workspace-create`'s shipped behaviour (#1178), not
// this ticket's — they are the instrument, not the subject.
//
// SECRET HYGIENE: every assertion reads a count or a computed opacity. No label, path or daemon text is
// asserted on or printed by a failing locator.

const HIDDEN_OPACITY = '0'
const SHOWN_OPACITY = '1'

// Two host rows from the one paired machine since #1070 — both sections draw its row whether or not they
// hold any of its conversations. Pinned so a change in that shape fails here rather than silently
// halving what the loop below checks.
const HOST_ROW_COUNT = 2

// Two connection dots per host row, four across the two.
const DOTS_PER_ROW = 2

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => window.getComputedStyle(el).getPropertyValue(prop), property)

test('the host row keeps its connection dots on hover while it draws no controls', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape). The fixture's default seed is all this
  // needs: one conversation under one workspace group, which is what puts a workspace row — and its
  // plus — in the Chats tree to serve as the instrument.
  const { page } = await launchPairedApp()

  const actions = page.locator('.channel-list__actions')
  const hostRows = page.locator('.channel-list__host')
  const hostLabel = hostRows.first().locator('.channel-list__host-label')
  const hostStatus = hostRows.first().locator('.channel-list__host-status')
  const workspaceLabel = page.locator('.channel-list__workspace-label')
  const workspacePlus = page.locator('.channel-list__workspace-create')

  // --- 1. The production row draws NEITHER control, which is the precondition every assertion below is
  // about. Read by accessible name as well as by class: a control present in the accessibility tree but
  // never revealed would pass the class count and fail this. ---
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expect(page.locator('.channel-list__host-add, .channel-list__host-edit')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add workspace' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit host' })).toHaveCount(0)

  // --- 2. At rest, with the pointer parked off every row: both dots up, in both rows. The fixture's
  // launch click left the pointer over the seeded conversation row, so reading an "at rest" opacity
  // without moving it first would be reading some row's hover state. ---
  await actions.hover()
  await expect(page.locator('.channel-list__host-dot')).toHaveCount(HOST_ROW_COUNT * DOTS_PER_ROW)
  for (let i = 0; i < HOST_ROW_COUNT; i++) {
    expect(await computed(hostRows.nth(i).locator('.channel-list__host-status'), 'opacity')).toBe(
      SHOWN_OPACITY
    )
  }

  // --- 3. THE INSTRUMENT, calibrated: hovering a workspace row's label reveals that row's plus. This is
  // #1178's shipped behaviour, and it is here to prove that a `hover()` in this window really does apply
  // `:hover` to a sidebar row — without which step 4's "the dots stayed up" would pass just as happily
  // against a hover that never fired. ---
  expect(await computed(workspacePlus, 'opacity')).toBe(HIDDEN_OPACITY)
  await workspaceLabel.hover()
  expect(await computed(workspacePlus, 'opacity')).toBe(SHOWN_OPACITY)

  // --- 4. THE CRITERION. Hover the host row's label — the same gesture, one level up the tree — and its
  // dots stay up, because this row draws no control for them to give way to. The workspace plus dropping
  // back to 0 is read FIRST and is the positive half: it is the same mechanism reporting that the
  // pointer genuinely left that row and arrived here, so the dot read below is a statement about the
  // guard rather than about a pointer that never moved. ---
  await hostLabel.hover()
  expect(await computed(workspacePlus, 'opacity')).toBe(HIDDEN_OPACITY)
  expect(await computed(hostStatus, 'opacity')).toBe(SHOWN_OPACITY)
  await expect(hostRows.first().locator('.channel-list__host-dot')).toHaveCount(DOTS_PER_ROW)

  // --- 5. And the row is unchanged in every other way the hover could have touched it: still no control
  // in the accessibility tree, still no fill (the drawing gives the Hover variant none). ---
  await expect(page.getByRole('button', { name: 'Add workspace' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit host' })).toHaveCount(0)
  expect(await computed(hostRows.first(), 'background-color')).toBe('rgba(0, 0, 0, 0)')
})
