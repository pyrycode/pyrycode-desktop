import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'

// #1179 — the plus on a Channels-tree workspace row, the dialog it opens, and what Create sends. Only
// this tier can answer any of it: `vitest.config.ts` sets `environment: 'node'` and every renderer spec
// is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (which tree
// draws which control, its name, #1178's markers) and `CreateChannelDialog.test.tsx` owns the dialog's
// own chrome. Everything below needs a running window — a click, a real focus, the disabled/enabled
// transitions as characters arrive, and a round trip to the fake.
//
// A DEDICATED FILE rather than an addition to `sidebar-workspace-create.spec.ts`, which owns the CHATS
// tree's plus and must pass with its existing assertions untouched (AC5). Its seed is a single
// UNPROMOTED row, so its render has no Channels group at all and its strict
// `.channel-list__workspace-create` locator still resolves to exactly one element even though both
// trees now draw that class.
//
// ⭐ THE SEED IS PROMOTED AND ITS cwd IS NOT THE FAKE'S CREATE DEFAULT. That single choice makes all
// THREE payload fields detectable by one number. `conversationStateFake` mints its created row from
// `is_promoted: payload.is_promoted ?? false`, `name: payload.name` and
// `cwd: payload.cwd ?? DEFAULT_CREATED_CWD` (`/fake/workspace`), and the sidebar files that row by
// promotion and then by cwd. So a create sent with a null `cwd` mints a SECOND group, and one sent
// with `is_promoted: false` mints a Chats group — either way `.channel-list__workspace` goes from 1 to
// 2. Row count and thread-opening are both blind to that difference; this count is not.
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion reads a number, a boolean, or the
// client-owned name this drive typed itself. The seed's name and cwd are never asserted on; the seed
// cwd is a fixed fake remote path, never resolved locally.

// Not `/fake/workspace`. See the seed note above — this is half the non-vacuity guard; the seed being
// promoted is the other half.
const WORKSPACE_CWD = '/fake/second-brain'

// The two plus names, the operator's words rather than the screen's constants.
const CREATE_CHANNEL_NAME = 'Create channel'
const CREATE_CHAT_NAME = 'Create chat'

// The name this drive types. Client-owned, so it is safe to assert on — and it is what tells a create
// that carried the name apart from one that sent `null`, which would render the "Untitled" placeholder.
const CHANNEL_NAME = 'Release notes'

const ROUNDTRIP_TIMEOUT_MS = 15_000

const seed = (over: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: WORKSPACE_CWD,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  ...over
})

test('the Channels workspace plus opens a Create channel dialog that creates a named channel in that workspace', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape): each launch pays a full handshake, and
  // the ordering below is load-bearing throughout — every absence or unchanged-state assertion sits
  // AFTER a positive, auto-waiting read of the same gesture's own effect.
  //
  // The stateful fake owns the list, so this seed fully replaces the fixture's default one. ONE row, so
  // `launchPairedApp`'s strict `.channel-list__row-open` click still resolves; PROMOTED, so it renders
  // under Channels — and so the Chats tree draws no group and no plus of its own.
  const buildReplyFrames = conversationStateFake({ conversations: [seed({})] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const rows = page.locator('.channel-list__row')
  const workspaceRow = page.locator('.channel-list__workspace')
  const createChannel = page.getByRole('button', { name: CREATE_CHANNEL_NAME })
  const createChat = page.getByRole('button', { name: CREATE_CHAT_NAME })
  const dialog = page.locator('.create-channel')
  const nameField = page.locator('.create-channel__input')
  const createAction = page.locator('.create-channel__create')
  const cancelAction = page.locator('.create-channel__cancel')

  // --- 1. AC1: exactly one plus, in the accessibility tree at rest, named "Create channel". The Chats
  // tree draws none, because a promoted-only list gives it no group — which is also what keeps
  // `sidebar-workspace-create.spec.ts`'s mirror image single-match. ---
  await expect(createChannel).toHaveCount(1)
  await expect(createChat).toHaveCount(0)
  await expect(rows).toHaveCount(1)
  await expect(workspaceRow).toHaveCount(1)
  await expect(dialog).toHaveCount(0)

  // --- 2. AC2: clicking the plus opens the dialog, titled and focused. Playwright counts an opacity-0
  // element as visible and moves the pointer onto it before clicking, which hovers the row on the way,
  // so no explicit hover is needed. ---
  await createChannel.click()
  await expect(dialog).toHaveCount(1)
  await expect(page.locator('.create-channel__title')).toHaveText(CREATE_CHANNEL_NAME)
  // The field is EMPTY and FOCUSED — the half a static render proves only as `autofocus=""`. React
  // moves focus on mount, so this is the running window's confirmation of that declaration.
  await expect(nameField).toBeFocused()
  await expect(nameField).toHaveValue('')

  // --- 3. AC2: Create is disabled while the name is blank or whitespace-only, and enables once real
  // characters arrive. Three states read in sequence, so the transition itself is what is asserted
  // rather than any one frame of it. ---
  await expect(createAction).toBeDisabled()
  await nameField.fill('   ')
  await expect(createAction).toBeDisabled()
  await nameField.fill(CHANNEL_NAME)
  await expect(createAction).toBeEnabled()

  // --- 4. AC2: Cancel closes the dialog and sends nothing. The close is read directly; that it SENT
  // NOTHING is proven at the end of the drive instead, by the final row count being exactly 2 — a
  // Cancel that fired a create would make it 3. So this needs no vacuous absence of its own. ---
  await cancelAction.click()
  await expect(dialog).toHaveCount(0)

  // --- 5. AC2: reopening starts from an empty field. A POSITIVE read, and the one that proves the
  // container re-seeds its state on open rather than keeping the typed name around. ---
  await createChannel.click()
  await expect(nameField).toHaveValue('')

  // --- 6. AC3: Create sends one createConversation and closes the dialog. ---
  await nameField.fill(CHANNEL_NAME)
  await createAction.click()

  // THE POSITIVE, AUTO-WAITING READS COME FIRST. Everything after them is an unchanged-state assertion,
  // and each of those would pass before the round trip even resolved if it led (the #1123 rule): the
  // group count is 1 at launch, the Chats plus count is 0, and the dialog is about to be gone anyway.
  await expect(rows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // …and the created channel's thread opened, carrying THE TYPED NAME. A create that sent `name: null`
  // would render the client's "Untitled" placeholder here instead, so this is the `name` assertion.
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(CHANNEL_NAME)

  await expect(dialog).toHaveCount(0)

  // ⭐ THE `cwd` AND `is_promoted` ASSERTION, AND THE ONLY ONE THAT CAN SEE EITHER. Both rows are in
  // ONE group, so the create carried this group's key rather than `null` (which the fake resolves to
  // its own `/fake/workspace`, minting a second group) AND landed in the Channels tree rather than the
  // Chats one (which would mint a Chats group for the same cwd, also making it 2).
  await expect(workspaceRow).toHaveCount(1)
  // The promotion half read a second way, differently shaped: an unpromoted row would give the Chats
  // tree a group, and that group would draw a "Create chat" plus.
  await expect(createChat).toHaveCount(0)
  // Still exactly two rows — which is the proof that the cancelled dialog in step 4 sent nothing.
  await expect(rows).toHaveCount(2)
})
