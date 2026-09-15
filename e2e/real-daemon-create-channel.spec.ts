import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) driving the CREATE-CHANNEL path — the Channels-tree
// workspace plus, its dialog, and the `create_conversation { is_promoted: true, name, cwd }` that Create
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
// ⭐ THE cwd TRAP, AND WHAT SEPARATES THE TWO OUTCOMES (AC3). The daemon defaults a null payload `cwd` to
// its own `-pyry-workdir`, and `seedRegistry` used to put the seeded conversation in that same directory —
// so a create whose `cwd` the daemon HONOURED and one it IGNORED would both land in the seed's workspace
// group, and "the new row joined that group" would pass either way. This is not hypothetical: the daemon
// ignores a payload `cwd` on `promote_conversation` deliberately (pyrycode/pyrycode#949), and
// `real-daemon-promote.spec.ts`'s header records it.
//
// #1283's `seedCwdSubdir` moves the seed one level DOWN, so the two outcomes render differently. Since
// #1485 every workspace on a host is drawn under BOTH trees, and a promoted-only list gives the Chats tree
// no rows — so it draws each group as an empty MIRROR, and the ordered label list is the Channels run
// followed by the Chats run:
//
//   honoured  → `.channel-list__workspace-label` reads ['<WORKSPACE_LABEL>', '<WORKSPACE_LABEL>'] — one
//               group holding both rows, mirrored once
//   defaulted → it reads ['<WORKSPACE_LABEL>', 'work', '<WORKSPACE_LABEL>', 'work'] — the created row
//               minted a second group, mirrored in turn
//
// The assertion is `toHaveText([…])` on the whole ordered label list, NOT a count, and the shape is
// deliberately self-diagnosing: a defaulted create fails with `work` in the diff (the daemon ignored the
// payload), while a daemon that canonicalised the path would fail with the SAME label FOUR times (one
// workspace split into two groups, each mirrored). A bare count reports every one of them as a number.
//
// This rests on a read of the daemon rather than a guess: `CreateConversation` resolves `cwd := defaultCwd`
// and overwrites it with `*p.Cwd` when the payload sets one, recording that string byte-for-byte — no
// cleaning, no `filepath.Abs`, no symlink resolution — and the client's `groupByWorkspace` keys on the raw
// `cwd` string. So the seed's registry path and the created row's path are the same key. `resolveSpawnDir`
// does validate the REQUESTED dir (confine to $HOME after symlink resolution, create if missing,
// trust-mark), and the seed sits inside the daemon's own workdir, so it is confined by construction.
//
// A SINGLE PROMOTED SEED, not the second seeded workspace the ticket sketches: one seed already separates
// the two outcomes, and a second would add a second KEY — two groups per tree, four labels — to reason
// around for no extra discrimination. #1485 retired the older form of this reason: the single seed already
// puts a group and a "Create chat" plus in the Chats tree, as its mirror.
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

// What the seeded workspace's group is LABELLED. `workspaceLabelFor` takes the last non-blank segment of
// the row's `cwd`, which the fixture sets to `<daemonHome>/work/<seedCwdSubdir>` — so this must equal the
// `seedCwdSubdir` above, and it must not be `work` (the daemon's own workdir basename, the label a
// defaulted create would mint). Kept as its own constant because it is the EXPECTED value of the cwd
// assertion, and reading an expected value off the fixture would be reading it off the thing under test.
const WORKSPACE_LABEL = 'channel-workspace'

// The workdir basename — what a create whose `cwd` the daemon IGNORED would be labelled. Never asserted
// on directly; it is here so the label above can be read against it at a glance.
const DAEMON_DEFAULT_LABEL = 'work'

// The name this drive types. Client-owned, so it is safe to assert on — and it is what tells a create that
// carried the name apart from one the daemon stored null, which renders `titleFor(null)` = "Untitled".
// No nonce: the daemon applies no uniqueness check on create, and each run gets a fresh registry.
const CHANNEL_NAME = 'Release notes'

// The plus's accessible name (`CREATE_CHANNEL_CONTROL_LABEL`) and the two mutually exclusive row
// affordances promotion is read from — `ChannelList`'s `Row` gives a promoted row Rename and no Save, an
// unpromoted one the reverse.
const CREATE_CHANNEL_NAME = 'Create channel'

test('real daemon creates a promoted, named channel in the requested workspace over the real wire', async ({
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
  const workspaceLabels = page.locator('.channel-list__workspace-label')
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
  await expect(workspaceLabels).toHaveText([WORKSPACE_LABEL, WORKSPACE_LABEL])
  expect(WORKSPACE_LABEL).not.toBe(DAEMON_DEFAULT_LABEL)
  await expect(rows).toHaveCount(1)
  await expect(createChannel).toHaveCount(1)
  await expect(saveControl).toHaveCount(0)
  await expect(dialog).toHaveCount(0)

  // --- Open the dialog from the workspace row's plus (AC1). Playwright counts an opacity-0 element as
  // visible and moves the pointer onto it before clicking, which hovers the row on the way, so no explicit
  // hover is needed. The container closes over the clicked group's `cwd`; the dialog itself never receives
  // it. ---
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

  // --- ⭐ AC3, the `cwd` arm, and the only assertion that can see it. Still exactly one workspace KEY —
  // one group per tree, both labelled after the requested one — so the create carried the clicked group's
  // key rather than null. A daemon that ignored it lands the row under its own `-pyry-workdir` and this
  // reads [WORKSPACE_LABEL, 'work', WORKSPACE_LABEL, 'work']. See the header for why the whole label list,
  // and not a count. ---
  await expect(workspaceLabels).toHaveText([WORKSPACE_LABEL, WORKSPACE_LABEL])

  // --- The dialog closed on Create (AC1). Ordered last: it is about to be gone anyway, so it proves
  // nothing on its own — it is here to catch a dialog that stayed open behind the created row. ---
  await expect(dialog).toHaveCount(0)
})
