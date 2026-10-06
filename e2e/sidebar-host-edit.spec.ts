import { writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { HOST_LABEL_SET_CHANNEL } from '../src/shared/ipc/hostLabel'
import { SERVER_INFO_CHANNEL } from '../src/shared/ipc/serverInfo'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import {
  test,
  expect,
  seedConversationsFrame,
  FIRST_SERVER_ID,
  SECOND_SERVER_ID
} from './fixtures/launchPairedApp'

// #1299 — the dialog the host row's pen opens, and the rename that leaves. Only this tier can answer any
// of it: `vitest.config.ts` sets `environment: 'node'` and every renderer spec is a
// `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (which rows draw the
// pen, the seed collapse) and `EditHostDialog.test.tsx` owns the dialog's own markup and the write
// helper's outcome routing. Everything below is what needs a running window — a click, a typed field, a
// real IPC round trip to the background process, and a relaunch off the same user-data dir.
//
// A DEDICATED FILE, `sidebar-workspace-edit.spec.ts`'s stated reason: `host-row-hover-controls.spec.ts`
// owns the pen's own reveal and drawn box and must pass with its assertions untouched, so the dialog gets
// its own launch exactly as that one did.
//
// Name writes stay local through `window.pyry.setHostLabelFor`. Opening also reads the host prompt;
// saving an unchanged prompt must send no additional frame, which step 6 proves.
//
// ⭐ `hostLabel` AND `secondServer` LIVE ON THE SECOND ARGUMENT. Nothing typechecks `e2e/`, so one placed
// in the first is dropped SILENTLY with no gate red — leaving a drive that passes without ever having had
// a label, and a "second server" that was never paired.
//
// SECRET HYGIENE, and a DEPARTURE from `host-label-sidebar.spec.ts` / `host-row-per-server.spec.ts` stated
// rather than left silent. Those two never assert the label by VALUE, comparing character counts instead,
// because the host-name field at pairing sits directly below the pairing-code field and a mis-paste of the
// payload into it is an anticipated mistake. Every label in THIS drive is a fixed spec-owned literal that
// the drive itself types, so a failure diff can print only what this file wrote — never operator or daemon
// text. The pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never
// echoed.

// The three names this drive gives machine A, in the order it gives them. Chosen to share no substring
// with each other, with the fallback word, or with any locator here — so a build that never wrote, or one
// that wrote the wrong cell, cannot pass any assertion by accident. Fixed literals: deterministic, no
// Date.now()/randomness, per the fakeDaemon convention.
const OLD_LABEL = 'Pyrybox Attic'
const NEW_LABEL = 'Kitchen Ledger'

// The client-owned word a machine with no stored label shows (`HOST_ROW_FALLBACK_LABEL`). Restated here
// rather than imported: it is what the user reads, so a copy change must redden this file loudly rather
// than be re-blessed by the value under test.
const FALLBACK_LABEL = 'Server'

// FOUR host rows: one per paired machine, in EACH section (#1070). Both machines' seeds are unpromoted, so
// the Chats tree is the populated one and the Channels tree holds the two rows alone.
const HOST_ROW_COUNT = 2

// Document order is the paired-server list's order — oldest-paired first — repeated per section, so the
// Channels tree's rows are 0 (machine A) and 1 (machine B) and the Chats tree's are 2 and 3. POSITION IS
// THE ONLY HANDLE, and deliberately so: the server id reaches no attribute, class name or text on this row
// (`HostRow`'s ban list), so there is nothing to filter on. The count assertion is what makes the
// arithmetic safe (`host-row-per-server.spec.ts`'s idiom).
const A_ROWS = [0]
const B_ROWS = [1]

// The round trip is one in-process IPC hop, but the assertions after it auto-wait, so they carry headroom
// for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// #1300 — the two captions on the identity block, restated rather than imported for the FALLBACK_LABEL
// reason above: they are what the user reads, so a copy change must redden this file loudly.
const ID_CAPTION = 'Server identity:'
const RELAY_CAPTION = 'Relay address:'

// #1300's relay URL is a DYNAMIC loopback port, so it is read off the fixture handle and never written as
// a literal. This is the shape `launchPairedApp` paired each machine with, and `serverInfoHandler` answers
// `relayUrl` straight off that at-rest record — so what the dialog shows is exactly this string.
//
// Extending this drive's own secret-hygiene rule to the new assertions: both comparands are HARNESS-owned
// — a fixture constant and a URL this run's own forwarder minted — so a failure diff on this tier can
// still print only what the harness wrote, never operator or daemon text.
const relayUrlOf = (url: string): string => `${url}/v1/client`

async function capture(app: ElectronApplication, page: Page, path: string): Promise<void> {
  // The Linux fixture keeps its window hidden; capturePage paints it without showing or focusing it.
  const paint = () => app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true, stayAwake: true })
    return image.toPNG().toString('base64')
  })
  await paint()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  writeFileSync(path, Buffer.from(await paint(), 'base64'))
}

test('the host row’s pen renames the machine, clears it, and the name outlives a sidebar remount', async ({
  launchPairedApp
}, testInfo) => {
  // ONE launch for the drive, a SECOND for the relaunch criterion. The ordering inside launch 1 is
  // load-bearing throughout: every absence or unchanged-state assertion sits AFTER a positive,
  // auto-waiting read of the same gesture's own effect.
  //
  // The counting reply builder wraps the fixture's own default (`buildReply: () => seedConversationsFrame()`)
  // rather than replacing it, so the sidebar is seeded exactly as every other spec's is and the only thing
  // added is a tally of how many frames the client sent. Step 6 reads that tally; nothing else does, and it
  // records a NUMBER, never a byte of any frame.
  let inboundFrames = 0
  const { app, page, servers } = await launchPairedApp(
    {
      buildReply: (bytes) => {
        inboundFrames += 1
        const env = decodeEnvelope(bytes)
        if (env.type === 'request_host_system_prompt') return encodeEnvelope({
          id: 900, ts: '2026-10-05T00:00:00Z', type: 'host_system_prompt', in_reply_to: env.id,
          payload: { system_prompt: 'Stored instructions', default_system_prompt: 'Default instructions' }
        })
        return seedConversationsFrame()
      }
    },
    { hostLabel: OLD_LABEL, secondServer: {} }
  )

  await page.setViewportSize({ width: 1280, height: 800 })
  const hostRows = page.locator('.channel-list__host')
  const hostLabels = page.locator('.channel-list__host-label')
  const dialog = page.getByRole('dialog', { name: 'Edit host' })
  const nameField = dialog.getByRole('textbox', { name: 'Host name:' })
  const save = dialog.getByRole('button', { name: 'OK', exact: true })
  const pens = page.locator('.channel-list__host-edit')
  // #1300 — the two identity lines of whichever dialog is open. `.edit-host__detail` is the whole
  // captioned line; `allTextContents` therefore returns caption + value concatenated, which is what
  // `identityLines` below builds its expectations to match. Reading the LINE rather than a value span is
  // deliberate: it pins the caption to its value, so a build that swapped the two captions fails here.
  const identityLines = page.locator('.edit-host__detail')
  const identityRead = async (): Promise<string[]> =>
    (await identityLines.allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim())
  // `expectLabels`'s idiom above: an auto-waiting poll compared with toEqual, so the read retries while
  // the dialog paints AND the comparison stays EXACT. Exactness is load-bearing here and a substring
  // check would not do — `fake-daemon` is a prefix of `fake-daemon-2`, so a `toContainText` would pass
  // against the wrong machine's row, which is precisely what AC2 exists to catch.
  const expectIdentity = async (serverId: string, relayUrl: string): Promise<void> => {
    await expect
      .poll(identityRead, { timeout: ROUNDTRIP_TIMEOUT_MS })
      .toEqual([`${ID_CAPTION}${serverId}`, `${RELAY_CAPTION}${relayUrl}`])
  }

  const labelsRead = async (): Promise<string[]> =>
    (await hostLabels.allTextContents()).map((text) => text.trim())
  const expectLabels = async (a: string, b: string): Promise<void> => {
    await expect
      .poll(labelsRead, { timeout: ROUNDTRIP_TIMEOUT_MS })
      .toEqual([a, b].map((value) => value.trim()))
  }

  // --- 1. THE OPENING POSITIVE READ, and the reason this drive proves anything. Machine A carries the
  // label typed at ITS pairing, machine B carries none and falls back — the "one named, one unnamed" shape
  // `LaunchControl.hostLabel` produces, since it types into the FIRST pairing form only. Without this,
  // step 5 would pass just as well against a build that had shown NEW_LABEL all along. An auto-waiting
  // read rather than an absence: the label arrives on the keyed one-shot invoke settling after the sidebar
  // mounts. ---
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expectLabels(OLD_LABEL, FALLBACK_LABEL)

  // --- 2. AC1: the pen opens a dialog whose field holds THAT row's stored label, and Cancel writes
  // nothing. Playwright counts an opacity-0 element as visible and moves the pointer onto it before
  // clicking, which hovers the row on the way, so no explicit hover is needed. ---
  await pens.first().click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText('Edit host')
  await expect(nameField).toHaveValue(OLD_LABEL)
  // #1300/AC1: the dialog names WHICH machine this row is — machine A's own server id and relay URL,
  // each under its own caption, above the Host name field. Both comparands come from the harness rather than
  // from a literal: the id is the fixture's exported constant and the relay URL is this run's own
  // ephemeral loopback port, which no literal could name.
  await expectIdentity(FIRST_SERVER_ID, relayUrlOf(servers[0].forwarder.url))
  // AC1's sink clause, checked on the live DOM rather than on a server render: no element inside the open
  // dialog carries a `title`; only the client-owned close control carries an `aria-label`. The title
  // through `aria-labelledby`, and the untrusted label reaches the field's `value` and nothing else. Since
  // #1300 this covers the two identity lines too, which is AC3's live half: neither value reaches an
  // attribute, and the relay URL in particular reaches no `href`.
  expect(await dialog.locator('[title]').count()).toBe(0)
  await expect(dialog.locator('[aria-label]')).toHaveAttribute('aria-label', 'Close dialog')
  await expect(dialog.locator('img')).toHaveCount(1)
  await expect(dialog.locator('img')).toHaveAttribute('alt', '')
  expect(await dialog.locator('a').count()).toBe(0)
  await capture(app, page, testInfo.outputPath('normal-1280x800.png'))
  await expect(dialog).toHaveCSS('width', '640px')
  await expect(nameField).not.toBeFocused()
  await page.locator('.edit-host-overlay__scrim').click({ position: { x: 4, y: 4 } })
  await expect(dialog).toBeVisible()
  await nameField.focus()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await nameField.fill('Discard this draft')
  // Traverse the ready prompt and its reset before Unpair host and the footer.
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('textbox', { name: 'Host system prompt:' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Reset to default', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Unpair host', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expectLabels(OLD_LABEL, FALLBACK_LABEL)

  // --- 2b. #1300/AC2: MACHINE B's pen opens a dialog carrying B's OWN id and relay, not A's. This is the
  // criterion the unit tier cannot reach — it needs two machines actually paired, which `secondServer`
  // gives this launch — and it is what pins the container's lookup to the id the clicked pen closed over
  // rather than to `servers[0]`. Row index 1 is machine B in the Channels tree (document order is the
  // paired-server list's, oldest first, repeated per section), and the count assertion in step 1 is what
  // makes that arithmetic safe. Machine B carries no label, so its field opens EMPTY while its identity
  // lines are fully populated — the two are independent, which is itself worth pinning. ---
  // Open the second host from the Chats tree using the keyboard.
  await pens.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expectIdentity(SECOND_SERVER_ID, relayUrlOf(servers[1].forwarder.url))
  await expect(nameField).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close dialog' }).focus()
  await page.keyboard.press('Space')
  await expect(dialog).toHaveCount(0)

  // --- 3. AC2/AC3: Save is ENABLED on a blank name — the departure from the Edit workspace dialog — and
  // saving one clears the stored label, so both of machine A's rows read the generic word again. The
  // enabled read comes first: a disabled Save would make the click below a no-op that step 4 could then
  // misread as a successful clear. ---
  await pens.first().click()
  await nameField.fill('   ')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(dialog).toHaveCount(0)
  await expectLabels(FALLBACK_LABEL, FALLBACK_LABEL)

  // --- 4. AC1's second half, and it cannot be faked: reopening now shows an EMPTY field, because the
  // dialog seeds from what is STORED and step 3 cleared it. A dialog seeding from what the ROW displays
  // would put the generic word in the box here. ---
  await pens.first().click()
  await expect(nameField).toHaveValue('')
  await expect(dialog.getByRole('textbox', { name: 'Host system prompt:' })).toHaveValue('Stored instructions')

  // --- 5. AC2/AC4: type a name, press Save, and BOTH of machine A's host rows show it — while machine B's
  // two rows keep their own answer, which is the isolation claim. Every hop ran for real: the click
  // reached the container, the container reached `window.pyry.setHostLabelFor`, main trimmed and persisted
  // it under machine A's key, and the answer came back through the same mapper the reads use. ---
  const framesBeforeSave = inboundFrames
  await nameField.fill(`  ${NEW_LABEL}  `)
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expectLabels(NEW_LABEL, FALLBACK_LABEL)

  // --- 6. No frame leaves for a name-only save after its prompt read. The tally is compared AFTER step 5's
  // positive read has settled, so this is a mutation check on a value that had every opportunity to move —
  // not a read taken before the work happened. A rename routed through `sendCommand` instead would have
  // sealed a frame to the fake and incremented it. ---
  expect(inboundFrames).toBe(framesBeforeSave)

  // --- 7. AC2's last clause — THE NAME OUTLIVES THE RENDERER STATE THAT DISPLAYED IT, proven by a
  // REMOUNT rather than by a relaunch, and the substitution is stated rather than quietly made.
  //
  // ⭐ WHY NOT A RELAUNCH. A `reuseUserDataDir` launch deliberately never connects — launch 1's persisted
  // relay URL cannot reach this launch's fresh forwarder — so no `list_conversations` reply ever arrives,
  // `conversationListStore` stays at its not-yet-loaded `null`, and `renderBody`'s first gate returns
  // null: that window draws no headers, no rows and NO HOST ROWS AT ALL. There is nothing for a sidebar
  // assertion to read on a relaunched window, so the literal criterion is unobservable in this tier. (The
  // disk half — that main's store survives process death — is `src/main/hostLabelStore.test.ts`'s.)
  //
  // What a remount proves is the half this ticket could actually get wrong: that the name reached MAIN'S
  // AT-REST STORE and is not merely sitting in the renderer singleton the Save wrote. `ChannelList`
  // remounts on the return from Settings (`PairedShell` keeps it mounted across list↔thread but not
  // across that route), and its remount re-runs `HostLabelData`'s keyed one-shot, which writes whatever
  // MAIN answers into every slot UNCONDITIONALLY. So a write that never persisted would come back
  // `not-stored` here and both of machine A's rows would fall back to the generic word — which is exactly
  // what makes this a detector and not a re-read of the store that was just written. ---
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const settings = page.locator('section[aria-label="Settings screen"]')
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: 'Back' }).click()
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expectLabels(NEW_LABEL, FALLBACK_LABEL)

  // The negative half stated explicitly, where it matters most. Without it, "the rows show a string" would
  // pass against a build whose write never left the renderer, since the fallback word is a string too.
  for (const index of A_ROWS) {
    expect((await hostLabels.nth(index).textContent())?.trim()).not.toBe(FALLBACK_LABEL)
  }
  for (const index of B_ROWS) {
    expect((await hostLabels.nth(index).textContent())?.trim()).toBe(FALLBACK_LABEL)
  }
})

for (const exit of ['Cancel', 'Close dialog']) {
  test(`failed saves can retry and ${exit} stays available during saving`, async ({ launchPairedApp }) => {
    const { app, page } = await launchPairedApp({}, { hostLabel: OLD_LABEL })
    // Hold odd requests before returning a failure; even requests use the real persistence handler.
    await app.evaluate(({ ipcMain }, channel) => {
      const original = (ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>>
      })._invokeHandlers.get(channel)
      if (!original) throw new Error('Host label handler missing')
      let calls = 0
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        calls += 1
        if (calls % 2 === 0) return original(event, request)
        await new Promise<void>(resolve => ipcMain.once('test:release-host-save', () => resolve()))
        return { status: 'error' }
      })
    }, HOST_LABEL_SET_CHANNEL)
    const pen = page.locator('.channel-list__host-edit').first()
    const dialog = page.getByRole('dialog', { name: 'Edit host' })
    const field = dialog.getByRole('textbox', { name: 'Host name:' })
    const ok = dialog.getByRole('button', { name: 'OK', exact: true })
    await pen.click()
    await field.fill(NEW_LABEL)
    await ok.click()
    await expect(field).toBeDisabled()
    await expect(ok).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeEnabled()
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-host-save') })
    await expect(dialog.getByText('Could not save that name', { exact: true })).toBeVisible()
    await expect(field).toBeEnabled()
    await expect(ok).toBeEnabled()
    await ok.click()
    await expect(page.locator('.channel-list__host-label').first()).toHaveText(NEW_LABEL)
    await expect(dialog).toHaveCount(0)
    await pen.click()
    await ok.click()
    await expect(ok).toBeDisabled()
    await dialog.getByRole('button', { name: exit, exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
}

test('long host details wrap at minimum width and all controls remain reachable in a short window', async ({ launchPairedApp }, testInfo) => {
  const { app, page } = await launchPairedApp()
  const server = { serverId: `host-${'x'.repeat(900)}`, relayUrl: `wss://relay.example/${'y'.repeat(1400)}` }
  await app.evaluate(({ ipcMain }, { channel, server }) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ status: 'available', servers: [server] }))
  }, { channel: SERVER_INFO_CHANNEL, server })
  await page.reload()
  await page.setViewportSize({ width: 800, height: 600 })
  await page.locator('.channel-list__host-edit').first().click()
  const dialog = page.getByRole('dialog', { name: 'Edit host' })
  const values = dialog.locator('.edit-host__detail-value')
  await expect(values).toHaveText([server.serverId, server.relayUrl])
  await expect(dialog).toHaveCSS('width', '640px')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  for (const value of await values.all()) {
    expect(await value.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(20)
    expect(await value.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await capture(app, page, testInfo.outputPath('long-800x600.png'))
  await page.setViewportSize({ width: 800, height: 240 })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const close = dialog.getByRole('button', { name: 'Close dialog' })
  await close.focus()
  await page.keyboard.press('Tab')
  const field = dialog.getByRole('textbox', { name: 'Host name:' })
  await expect(field).toBeFocused()
  await expect(field).toBeInViewport()
  // The synthetic identity has no paired transport, so its failed prompt read stays outside tab order.
  await expect(dialog.getByRole('textbox', { name: 'Host system prompt:' })).toBeDisabled()
  // #1422 inserted the Unpair host button between the field and the footer — it sits in the content
  // area below the field, so document order puts it here. Asserted rather than skipped over: this is the
  // one place the new control's KEYBOARD reachability is proven, and at 800x240 it must scroll into view
  // like every other control in this sweep.
  await page.keyboard.press('Tab')
  const unpair = dialog.getByRole('button', { name: 'Unpair host', exact: true })
  await expect(unpair).toBeFocused()
  await expect(unpair).toBeInViewport()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeInViewport()
  await capture(app, page, testInfo.outputPath('short-footer-800x240.png'))
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await expect(close).toBeInViewport()
  await capture(app, page, testInfo.outputPath('short-header-800x240.png'))
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
})

// #1422 — AC2's transition, and the ONE part of the unpair slot that needs a running window. Every ARM's
// markup (idle, confirming, in flight, failed) is `EditHostDialog.test.tsx`'s, and the erase→refresh→
// route-or-clear decision behind a confirmed answer is `unpairServerAction.test.ts`'s and
// `settings-per-server-unpair.spec.ts`'s. What neither tier can answer is what a CLICK does: this file's
// own header states why (`environment: 'node'`, every renderer spec a `renderToStaticMarkup` string).
//
// ⭐ DELIBERATELY NON-DESTRUCTIVE. It arms and disarms and never confirms, so nothing is erased and the
// drive needs no second pairing to survive its own assertions. The claim under test is precisely that
// clicking the verb does NOT unpair — the host rows are still there afterwards — which is the half of AC2
// a confirming drive could not distinguish from a working erase.
test('the Unpair host button arms a confirmation instead of unpairing, and discards it on close', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()
  await page.setViewportSize({ width: 1280, height: 800 })
  const hostRows = page.locator('.channel-list__host')
  const dialog = page.getByRole('dialog', { name: 'Edit host' })
  const slot = dialog.locator('.edit-host__actions')
  const verb = slot.getByRole('button', { name: 'Unpair host', exact: true })
  // The SLOT's answers, scoped to `.edit-host__actions` — the footer carries its own 'Cancel' and a
  // dialog-wide locator would match both. That separate addressability is what
  // `EditHostDialog.test.tsx` pins in markup; this is the live half of it.
  const slotCancel = slot.getByRole('button', { name: 'Cancel', exact: true })
  const confirm = slot.getByRole('button', { name: 'Confirm', exact: true })
  const rowsBefore = await hostRows.count()
  expect(rowsBefore).toBeGreaterThan(0)

  await page.locator('.channel-list__host-edit').first().click()
  await expect(dialog).toBeVisible()
  await expect(verb).toBeVisible()
  await expect(confirm).toHaveCount(0)

  // --- AC2: the click ARMS. The verb leaves its slot, the prompt and both answers take it, and nothing
  // is erased — the rows are all still there and the dialog is still open on the same machine. ---
  await verb.click()
  await expect(slot.getByText('Forget this host?', { exact: true })).toBeVisible()
  await expect(confirm).toBeEnabled()
  await expect(slotCancel).toBeEnabled()
  await expect(verb).toHaveCount(0)
  await expect(hostRows).toHaveCount(rowsBefore)
  // Arming freezes nothing: the rename half of the dialog is still usable behind a confirmation.
  await expect(dialog.getByRole('textbox', { name: 'Host name:' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeEnabled()

  // --- AC2: the slot's Cancel DISARMS, returning the slot to the idle button without closing. ---
  await slotCancel.click()
  await expect(verb).toBeVisible()
  await expect(confirm).toHaveCount(0)
  await expect(dialog).toBeVisible()

  // --- AC2: an armed state does not survive a close. Re-arm, leave by the footer's own Cancel, reopen,
  // and the slot is idle — the container re-seeds the status cell on every open, so there is no armed
  // state to carry. The footer's Cancel is reached from the footer, never from the slot. ---
  await verb.click()
  await expect(confirm).toBeVisible()
  await dialog.locator('.modal__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.channel-list__host-edit').first().click()
  await expect(verb).toBeVisible()
  await expect(confirm).toHaveCount(0)
  // Nothing was erased by any of it.
  await expect(hostRows).toHaveCount(rowsBefore)
})

// #1361: the real build and renderer image policy must allow the shared close asset.
test('shared Modal close image decodes in the built app', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp()
  await page.locator('.channel-list__host-edit').first().click()
  const closeImage = page.getByRole('dialog', { name: 'Edit host' }).locator('.modal__close img')
  await expect(closeImage).toHaveJSProperty('naturalWidth', 28)
})
