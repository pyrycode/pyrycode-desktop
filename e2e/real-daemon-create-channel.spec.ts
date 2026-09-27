import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) driving the CREATE-CHANNEL path — the Channels-tree
// workspace plus, its dialog, and the `create_conversation { is_promoted: true, name, cwd: null }` that OK
// sends — against a REAL spawned `pyry` on #251's content-blind routing relay, gating on the `pyry` binary
// ALONE (no `claude`, no Anthropic credential). This is the real-daemon twin of the merged fake-stack spec
// #1179 (`sidebar-create-channel.spec.ts`): the same drive through the same shipped UI, with the in-process
// `conversationStateFake` swapped for the #439 realDaemon fixture.
//
// WHY THE FAKE TWIN CANNOT COVER THIS. `conversationStateFake` mints its created row FROM the request —
// `is_promoted`, `name` and `cwd` are echoed back out of the payload — so #1179 proves what the client
// SENDS and can prove nothing about what the daemon does with it. Every create this app had sent before
// #1179 carried `is_promoted: false, name: null`; the daemon's handler has always read all three fields,
// but no client had exercised the promoted branch. This spec is that first exercise, the way #443 followed
// promote, #439 rename and #441 the workspace picker.
//
// This spec captures NO outbound wire frame (unlike the fake twin): the daemon is a SEPARATE process behind
// the content-blind relay, so an in-process capture is unavailable here. Every assertion reads DOM text /
// visibility / counts only.
//
// The seed lives below the daemon's workdir. A `cwd: null` create must appear in a second workspace,
// labelled `work`, while a regression that sends the clicked seed path leaves only one group. Both
// trees mirror each group, so the ordered label list distinguishes those outcomes.
//
// pyry 0.27.0 canonicalises a created conversation's cwd, while the client's `groupByWorkspace` keys
// on the supplied string. The fixture therefore seeds a canonical path too, so the seed and created row
// share the same key. The seed remains a distinct subdirectory of the daemon's canonical workdir.
//
// A single promoted seed supplies the Channels plus and the contrasting non-default group.
//
// AND NOT A STRUCTURAL ATTRIBUTION OF THE ROW TO ITS GROUP: `renderServerTrees` renders a FLAT run of
// siblings (host, workspace head, rows, …) — 28 e2e specs depend on that ancestry — so there is no
// ancestor to scope a row locator by. The group's label list is the observable the DOM actually offers.
//
// A timeout on the leading row-count assertion is a GENUINE #949-class daemon gap (a missing or broken
// `create_conversation` handler answers `unsupported` on the real wire, no `conversation_created` fires,
// no re-list happens) — file it separately, do NOT paper over it with a longer timeout or a softened
// assertion. A `cwd` the daemon REJECTED (`protocol.malformed`, "conversation working directory not
// allowed") presents identically, and is itself a finding: the seed path is inside the daemon's $HOME.
//
// SECRET HYGIENE (the `security-sensitive` label): every assertion reads a count, or text this drive owns
// itself — WORKSPACE_LABEL and CHANNEL_NAME are spec constants, never daemon strings read into an expected
// value. The pairing payload is built the same way as the sibling real-daemon-* specs and never echoed into
// a message; nothing here logs or attaches. The worst a failure diagnostic prints is a directory BASENAME
// (`workspaceLabelFor` takes the last path segment) — never a full path, never the token, never a
// transcript.
//
// ADDING THIS FILE MAKES THE TIER'S FLOOR STALE: 16 specs → 17.
// `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a dispatcher environment variable outside this repo, so the bump
// is the operator's — see live-e2e-runbook.md § Automated coverage.

// All three declared EXPLICITLY, never left to a default. #1259's first gate run reddened at its opening
// assertion because the spec's prose called its seed promoted while the declaration was missing: a
// `test.use` omission is silent, and no typecheck or lint covers `e2e/`.
//   spawnClaude: false     — the daemon answers create_conversation without starting a turn (the mint no
//                            longer spawns claude), so this is the credential-light tier, not real-claude.
//   seedPromoted: true     — the Channels tree draws a workspace row, and therefore a plus, ONLY for a
//                            workspace holding a promoted conversation. `real-daemon-promote` and
//                            `real-daemon-workspace` both run `false` and render no Channels group at all,
//                            so copying either verbatim would leave nothing to click — and their
//                            `.channel-list__save` readiness gate does not carry over, because a promoted
//                            row wears Rename instead.
//   seedCwdSubdir          — the cwd trap above.
test.use({ spawnClaude: false, seedPromoted: true, seedCwdSubdir: 'channel-workspace' })

// --- Timeouts (mirror real-daemon-promote.spec.ts) ---------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — used only on the readiness gate.
const HANDSHAKE_TIMEOUT_MS = 45_000
// The create real-wire round-trip: create_conversation → conversation_created → re-list → re-render,
// traversing renderer → preload → main → Noise → relay → real daemon and back. At least as generous as the
// sibling real-daemon specs' value, NOT Playwright's 5s default.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Whole spec: handshake + one round-trip + dialog open + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 120_000

// The seed path and daemon default resolve to different visible workspace labels.
const WORKSPACE_LABEL = 'channel-workspace'

// The daemon's configured default workdir basename.
const DAEMON_DEFAULT_LABEL = 'work'

// The name this drive types. Client-owned, so it is safe to assert on — and it is what tells a create that
// carried the name apart from one the daemon stored null, which renders `titleFor(null)` = "Untitled".
// No nonce: the daemon applies no uniqueness check on create, and each run gets a fresh registry.
const CHANNEL_NAME = 'Release notes'

// The plus's accessible name (`CREATE_CHANNEL_CONTROL_LABEL`) and the two mutually exclusive row
// affordances promotion is read from — `ChannelList`'s `Row` gives a promoted row Rename and no Save, an
// unpromoted one the reverse.
const CREATE_CHANNEL_NAME = 'Create channel'

test('real daemon creates a promoted, named channel in its default workspace over the real wire', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // --- Pair against the real daemon, dial the test relay's /v1/client leg (real-daemon-* siblings). ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim; NOT pyry's emitted relay (which points at prod). The loopback affordance
    // (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  const rows = page.locator('.channel-list__row')
  const sections = page.locator('.channel-list__section')
  const renameControl = page.locator('.channel-list__rename')
  const saveControl = page.locator('.channel-list__save')
  const createChannel = page.getByRole('button', { name: CREATE_CHANNEL_NAME })
  const dialog = page.locator('.create-channel-overlay .modal')

  // --- Readiness gate: the PROMOTED seed's Rename pencil renders only after the whole chain — handshake
  // complete → session `connected` → the auto-fired `list_conversations` returned the seeded row → it
  // rendered under Channels. The real-daemon path lands on `route='list'` post-pairing (no opening
  // thread), so this gate stands in for the fake twin's land-in-thread. ---
  await expect(renameControl).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Baseline (AC2's "before"). ONE group per tree, both labelled after the seed's subdirectory: this
  // is what proves the fixture put the seed where this spec thinks it did, so the identical read after the
  // create is a claim about the DAEMON rather than about the seed. The second entry is #1485's empty mirror
  // in the Chats tree, resolving its label off this same row. One row; the plus is unique because each tree
  // names its OWN control — the mirror wears "Create chat", never a second "Create channel" (the older
  // reason given here, that a promoted-only list leaves the Chats tree without a group at all, is the very
  // claim #1485 retired); and no Save control, the promoted seed's half of the affordance split. ---
  await expect(sections).toHaveCount(2)
  await expect(page.locator('.channel-list__workspace')).toHaveCount(0)
  expect(WORKSPACE_LABEL).not.toBe(DAEMON_DEFAULT_LABEL)
  await expect(rows).toHaveCount(1)
  await expect(createChannel).toHaveCount(1)
  await expect(saveControl).toHaveCount(0)
  await expect(dialog).toHaveCount(0)

  // Open from the seed workspace row; the dialog retains its host but sends no seed path.
  await createChannel.click()
  await expect(dialog).toBeVisible()

  // --- Type a name and Create (AC1). The empty-and-focused field, the blank-name disabled state and the
  // whitespace-only case are #1179's fake-tier claims and are not re-litigated here at 45s a launch; the
  // enabled read is kept only so a click cannot land on a disabled button and time out opaquely. ---
  await page.locator('.create-channel__input').fill(CHANNEL_NAME)
  const createAction = page.locator('.create-channel-overlay .modal__action--confirm')
  await expect(createAction).toBeEnabled()
  await createAction.click()

  // --- THE POSITIVE, AUTO-WAITING READ COMES FIRST (AC2), and it is the only assertion below that is
  // false before the round trip resolves: create_conversation → the daemon mints a session RECORD (#677,
  // no claude process — it spawns lazily on the first send_message) → conversation_created → #515's
  // shouldRefreshList re-lists → the row renders. Everything after it is an unchanged-state read that
  // would pass against the pre-create render if it led. ---
  await expect(rows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- AC2, the `name` arm. `useConversationCreatedNav` opens the created conversation on the daemon's
  // reply, and the sidebar stays mounted beside the thread in the two-pane shell — so the current row is
  // the created one, and its title comes from the daemon's own list, not from anything the client kept
  // optimistically. Since #1097 the button's whole text is the title (the time is a sibling), so this is
  // an exact read. A create the daemon stored with a null name renders "Untitled" here. ---
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(CHANNEL_NAME)

  // --- AC2, the `is_promoted` arm, read off the row's own affordance (real-daemon-promote's idiom): the
  // two controls are disjoint by section by construction in `ChannelList`'s `Row`. Two Rename controls and
  // no Save control means BOTH rows are promoted; a create the daemon stored unpromoted would put the new
  // row in the Chats tree wearing Save-as-channel instead. ---
  await expect(renameControl).toHaveCount(2)
  await expect(saveControl).toHaveCount(0)

  // The second group is the daemon's default path, not the clicked workspace. The initial two labels
  // above establish the before state; this read cannot pass before the round trip.
  await expect(sections).toHaveCount(2)

  // --- The dialog closed on Create (AC1). Ordered last: it is about to be gone anyway, so it proves
  // nothing on its own — it is here to catch a dialog that stayed open behind the created row. ---
  await expect(dialog).toHaveCount(0)
})
