import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// #1431 — the Channel info sheet's edit action against a PROMOTED channel, at the fake tier because
// this is the half of the ticket a renderer spec cannot reach. `vitest.config.ts` sets
// `environment: 'node'`, so the static tests beside `ChannelInfoSheetView` prove which WORD the pill
// renders and nothing more: the container's `renameOpen` starts false, a server render never fires a
// click, and which MODAL the word opens is therefore only observable here.
//
// The chat arm keeps its own coverage where it already lives — `offline-conversation-actions.spec.ts`
// and `conversation-create-rename.spec.ts` both drive this pill on a non-promoted conversation
// (`SEEDED_ROW` and the minted `created-1`) and both still find **Edit chat**. This spec is their
// promoted twin, deliberately narrow: one sheet, one click, one dialog.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*`
// testIgnore).
//
// SECRET HYGIENE: every assertion reads DOM text, visibility or counts. The seed name is a non-secret
// display literal, the system prompt box is never filled, and the pairing plumbing (synthetic token,
// fake static key) lives in the launchPairedApp fixture and is never echoed.

// ONE seed, PROMOTED and named. Promoted is the whole point — it is what `partitionByPromotion` reads
// to file the row under "Channels" and what `PairedShell`'s `onOpen` carries into the active-conversation
// snapshot the sheet reads. Exactly one, because `launchPairedApp` reaches the thread by clicking a
// single strict `.channel-list__row-open`. Fixed literals only — no Date.now(), no randomness (the
// fakeDaemon convention).
const SEED: ConversationSummary = {
  id: 'seed-channel',
  name: 'Promoted channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}

test('the Channel info sheet opens Edit channel, not Edit chat, for a promoted channel', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [SEED] })
  })
  await page.setViewportSize({ width: 1280, height: 800 })

  // launchPairedApp lands IN the seeded row's thread, having clicked it — so `activateConversation`
  // has already recorded the row, `is_promoted` and all, as the open chat's snapshot.
  const editChannelPill = page
    .locator('.channel-info__actions')
    .getByRole('button', { name: 'Edit channel', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Edit channel', exact: true })

  // The operator's own route to the sheet: the thread overflow menu.
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()

  // AC, first half — the WORD. Asserted as a pair: the channel word present AND the chat word absent,
  // because a sheet showing both would mean the branch fell through rather than chose.
  await expect(editChannelPill).toBeVisible()
  await expect(
    page.locator('.channel-info__actions').getByRole('button', { name: 'Edit chat', exact: true })
  ).toHaveCount(0)

  // AC, second half — the MODAL. The zero-count here is what makes the click below load-bearing: the
  // dialog is proven absent with the pill already on screen, so its arrival afterwards cannot be
  // something the sheet had open all along.
  await expect(dialog).toHaveCount(0)
  // Scoped to `.conversation`, which is what separates this entry point from the sidebar's. The
  // Channels pen opens THE SAME dialog from outside that subtree, so an unscoped click would leave the
  // spec unable to say which of the two routes answered.
  await editChannelPill.click()
  await expect(dialog).toBeVisible()

  // Seeded with the channel the sheet was opened over, through `titleFor`.
  await expect(dialog.getByRole('textbox', { name: 'Channel name:', exact: true }))
    .toHaveValue(SEED.name!)
  // The CONTAINER mounted, not merely its view: this line is what `EditChannelDialog` renders while its
  // `request_system_prompt` is outstanding, and `conversationStateFake` answers that verb never — so the
  // dialog sits in its reading arm permanently at this tier. Its presence proves the subscription and
  // the ask, which a bare view mount would not have.
  //
  // Located by CLASS and not by text, because the sheet BEHIND this dialog says the same sentence: its
  // own `SystemPromptSection` is in its own reading arm at this tier, under `.system-prompt__empty`. A
  // `getByText` here resolves to both and strict-violates — the two namespaces are the only thing that
  // tells the modal's line from the sheet's.
  await expect(page.locator('.edit-channel__reading')).toBeVisible()
  await mkdir('/tmp/builder-1431-visual', { recursive: true })
  await page.screenshot({ path: '/tmp/builder-1431-visual/edit-channel-from-sheet.png' })

  // Cancel closes the DIALOG alone and leaves the sheet standing — the chat arm's behaviour, kept.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(editChannelPill).toBeVisible()
})
