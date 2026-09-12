import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// The credential-light real-daemon tier (#439) driving the WORKSPACE RENAME path — the Channels-tree
// workspace row's hover pen, the Edit workspace dialog it opens, and the `rename_workspace { path, label }`
// that Save sends — against a REAL spawned `pyry` on #251's content-blind routing relay, gating on the
// `pyry` binary ALONE (no `claude`, no Anthropic credential). This is the real-daemon twin of the merged
// fake-stack spec #1180 (`sidebar-workspace-edit.spec.ts`): the same drive through the same shipped UI,
// with the in-process `conversationStateFake` swapped for the #439 realDaemon fixture.
//
// WHY THE FAKE TWIN CANNOT COVER THIS. The tier exists to catch exactly one class of gap
// (pyrycode/pyrycode#949, `promote_conversation`): the daemon defines the type, the payload and the
// registry op but registers NO handler, so the real wire answers `unsupported` while the whole fake suite
// stays green — because a fake answers anything. `rename_workspace` is a NEW daemon verb (pyrycode#2158 /
// pyrycode#2208) whose client half shipped in #1289 against a fake alone: `rename-workspace-command.spec.ts`
// proves the frame leaves the app, and the fake answers it. Nothing had yet asked a real `pyry` whether it
// has a handler. Workspace rename is a pure registry op daemon-side and never touches claude, so it proves
// deterministically and cheaply, the way the sibling action specs already do.
//
// This spec captures NO outbound wire frame (unlike the fake twin): the daemon is a SEPARATE process behind
// the content-blind relay, so an in-process capture is unavailable here. Every assertion reads DOM text /
// visibility / counts only.
//
// ⭐ THE NON-VACUITY MECHANISM, AND THE TRAP IT HAS TO CLEAR. `requestRenameWorkspace` sends `label: null`
// — the daemon's "clear this workspace's label" value — exactly when the trimmed name equals
// `workspaceLabelFor(cwd)`, THE FOLDER SEGMENT, and emphatically not when it equals the label the daemon
// currently holds. On a fresh registry the daemon holds no `workspace_label` at all, so the row's pre-save
// label IS that folder segment. A NEW_LABEL equal to SEED_FOLDER would therefore send a CLEAR, the row
// would fall back to the very same folder segment, and the drive would prove nothing while looking like it
// ran. The two are pinned apart by an assertion rather than by care — see the `not.toBe` beside the
// pre-read.
//
// The pre-read itself is the other half. It is a POSITIVE, auto-waiting text read and never an opening
// absence: `workspace-updated-relist.spec.ts` records why a `toHaveCount(0)` opening settles before the
// sidebar has rendered anything and proves nothing. Without it, the closing assertion would pass just as
// well against a daemon that held NEW_LABEL all along.
//
// ⭐ TWO FAILURE SIGNATURES, AND THEY MUST STAY APART. Do not paper over either with a longer timeout.
//   A — a `pyry` predating pyrycode#2208 omits `workspace_label` from its list reply.
//       `requireStringOrNull` in `parseConversationSummary` fails CLOSED on an absent key (deliberately:
//       defaulting it would let a stale daemon silently suppress a label set from another client), so the
//       whole list decode throws and NOTHING renders — the readiness gate below times out on an empty
//       sidebar. That is a STALE BINARY: rebuild `pyry` (the runbook's `PYRY_BIN` note).
//   B — a daemon carrying the field but registering no `rename_workspace` handler renders the sidebar
//       normally and the label simply never changes: the closing read times out with the row still
//       reading SEED_FOLDER. That is the #949-class gap this spec exists for — file it.
// A daemon that REJECTS the rename (`workspace.not_found`, `protocol.malformed`) presents identically to
// B, because this verb is fire-and-forget and the client surfaces no rejection at all — so a red here is
// "the daemon did not relabel", not yet "the daemon has no handler".
//
// NO `requiredCapabilities` DECLARED, deliberately. The #933 gate reads the hello-ack INTERSECTION and this
// client advertises exactly one capability string (`interactive`); a workspace string the daemon does not
// know would convert the genuine red this spec exists to produce into a permanent skip — which still counts
// against the tier floor and parks the ticket forever. A missing handler must red here; that is the point.
//
// SECRET HYGIENE (the `security-sensitive` label): every expected value below is a CLIENT-OWNED CONSTANT,
// never a daemon string read into an assertion — the one deliberate divergence from
// `real-daemon-rename.spec.ts`, which captures its `oldTitle` off the DOM. A constant is available here
// because `seedCwdSubdir` fixes the folder segment and a fresh registry holds no label, so there is nothing
// daemon-asserted to capture. The pairing payload is built as in the sibling real-daemon specs and
// referenced exactly once (`pairingArrival`'s invariant 2); `daemon.workdir` is NOT read at all, since that
// would put an absolute temp path into a variable a failure diff could print.
//
// AND THE PATH LINE IS DELIBERATELY NOT ASSERTED, where the fake twin does assert it. There the `cwd` is
// the fixed literal `/fake/workspace`; here it is an absolute path under a temp `daemonHome`, and a
// mismatch diff would print it whole. Declining that one read keeps the worst any assertion here can print
// down to a directory BASENAME (`workspaceLabelFor` takes the last segment) — `real-daemon-create-channel`'s
// posture. `playwright.real-claude.config.ts` enables no screenshot, trace or video, so a failure yields
// text diffs only and never a window capture of the open dialog, the one surface that renders the path.
//
// ADDING THIS FILE MAKES THE TIER'S FLOOR STALE: 17 specs → 18.
// `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a dispatcher environment variable outside this repo, so the bump
// is the operator's — see live-e2e-runbook.md § Automated coverage.

// The seeded conversation's directory, one level below the daemon's own `-pyry-workdir`, and therefore —
// on a registry holding no `workspace_label` — the label its workspace group renders BEFORE the save.
// Declared above `test.use` because that call consumes it at module scope.
//
// It must be a single plain segment (the fixture rejects anything else ahead of any resource creation) and
// it must not be `work`, the workdir basename a defaulted seed would be labelled after. It is also what
// makes the pre-read a spec-owned constant rather than a fixture-internal name.
const SEED_FOLDER = 'rename-seed'

// All three fixture options declared EXPLICITLY, never left to a default — #1259's first gate run reddened
// at its opening assertion because a spec's prose called its seed promoted while the declaration was
// missing. A `test.use` omission is silent, and no typecheck or lint covers `e2e/`.
//   spawnClaude: false  — rename is a pure registry op that runs no claude turn, so this is the
//                         credential-light tier, not real-claude.
//   seedPromoted: true  — the Channels tree draws a workspace HEAD ROW, and therefore a pen, only for a
//                         workspace holding a promoted conversation. `real-daemon-workspace.spec.ts` runs
//                         `false` and renders no Channels group at all, so copying that one would leave
//                         nothing to hover.
//   seedCwdSubdir       — the pre-read constant above.
test.use({ spawnClaude: false, seedPromoted: true, seedCwdSubdir: SEED_FOLDER })

// --- Timeouts (mirror real-daemon-create-channel.spec.ts) --------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two — used only on the readiness gate.
const HANDSHAKE_TIMEOUT_MS = 45_000
// The rename real-wire round-trip: rename_workspace → the daemon's correlated workspace_updated → #1288's
// inbound re-list → list_conversations → reply → re-render, traversing renderer → preload → main → Noise →
// relay → real daemon and back. At least as generous as the sibling real-daemon specs' value, NOT
// Playwright's 5s default.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Whole spec: handshake + dialog open + one round-trip + headroom. Well under the config's 300s default.
const SPEC_TIMEOUT_MS = 120_000

// The label this drive types. Client-owned, so it is safe to assert on, and it reads as a HUMAN LABEL that
// no folder in the daemon's tree could be named — which is the whole point of the field. It shares no
// substring with SEED_FOLDER, so neither assertion can pass on a partial match.
const NEW_LABEL = 'Kitchen Ledger'

// The daemon's own workdir basename — what the group would be labelled if the seed had landed in
// `-pyry-workdir` itself rather than the subdirectory above. Never asserted as present; it is here so the
// closing sweep can name that failure too.
const DAEMON_WORKDIR_LABEL = 'work'

// The pen's accessible name (`EDIT_WORKSPACE_CONTROL_LABEL`), restated here rather than imported from the
// code under test.
const EDIT_WORKSPACE_NAME = 'Edit workspace'

test('real daemon relabels a workspace driven from the Edit workspace dialog, visible on the row', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // --- Pair against the real daemon, dial the test relay's /v1/client leg (the real-daemon-* siblings). ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim; NOT pyry's emitted relay (which points at prod). The loopback affordance
    // (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const renameControl = page.locator('.channel-list__rename')
  const editWorkspace = page.getByRole('button', { name: EDIT_WORKSPACE_NAME })
  const dialog = page.getByRole('dialog', { name: 'Edit workspace' })
  const nameField = page.locator('.edit-workspace__input')
  const saveAction = dialog.getByRole('button', { name: 'OK', exact: true })

  // --- Readiness gate: the PROMOTED seed's Rename pencil renders only after the whole chain — handshake
  // complete → session `connected` → the auto-fired `list_conversations` returned the seeded row → it
  // rendered under Channels. The real-daemon path lands on `route='list'` post-pairing (no opening
  // thread), so this gate stands in for the fake twin's land-in-thread. A timeout HERE is failure
  // signature A above (a stale binary), not a missing rename handler. ---
  await expect(renameControl).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- THE PRE-READ (AC2's "before"), positive and auto-waiting. One workspace group, labelled after the
  // seed's own subdirectory — the array form pins the group count at one as well as the text. This is what
  // proves the fixture put the seed where this spec thinks it did, so the identical read after the save is
  // a claim about the DAEMON rather than about the seed. ---
  await expect(workspaceLabels).toHaveText([SEED_FOLDER])

  // ⭐ The trap, asserted rather than trusted (see the header): a NEW_LABEL equal to the folder segment
  // would make Save send `label: null`, the daemon would CLEAR the label, and the row would fall back to
  // SEED_FOLDER — a vacuous pass. Cheap, constant-only, and it fails at authoring time rather than on a
  // 45-second launch.
  expect(NEW_LABEL).not.toBe(SEED_FOLDER)
  expect(SEED_FOLDER).not.toBe(DAEMON_WORKDIR_LABEL)

  // --- Open the dialog from the workspace row's pen (AC1). Exactly ONE pen: a promoted-only list gives
  // the Chats tree no group, and the unknown-workspace group (which is withheld a pen) does not arise
  // here. Playwright counts an opacity-0 element as visible and moves the pointer onto it before clicking,
  // which hovers the row on the way, so no explicit hover is needed. ---
  await expect(editWorkspace).toHaveCount(1)
  await editWorkspace.click()
  await expect(dialog).toBeVisible()

  // --- The SECOND pre-read: the field opens seeded with the row's CURRENT label, which proves the dialog
  // opened on the workspace the pre-read just measured rather than on some other group. The path line under
  // it is deliberately not asserted — see the header. ---
  await expect(nameField).toHaveValue(SEED_FOLDER)

  // --- Type the new name and Save (AC1). `fill` clears the seeded value before typing. The enabled read is
  // kept only so a click cannot land on a disabled button and time out opaquely; the blank and over-long
  // refusals are #1180's fake-tier claims and are not re-litigated here at 45s a launch. ---
  await nameField.fill(NEW_LABEL)
  await expect(saveAction).toBeEnabled()
  await saveAction.click()

  // --- ⭐ THE CLOSING POSITIVE READ (AC2), and the only assertion below that is false before the round trip
  // resolves: rename_workspace → the daemon's registry mutation → the correlated workspace_updated →
  // #1288's inbound re-list → the reply → re-render. Nothing was patched locally; this client never awaits
  // or correlates the reply, so the text below can only have come from the daemon's own list. A timeout
  // here is failure signature B. ---
  await expect(workspaceLabels).toHaveText([NEW_LABEL], { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- AC2's negative half, stated explicitly. Redundant against the array equality above and kept anyway,
  // as both fake-tier siblings keep it: it is the assertion that NAMES the two failures — a label the save
  // never moved (SEED_FOLDER), and a seed that never left the daemon's own workdir (DAEMON_WORKDIR_LABEL).
  // Scoped to the label TEXT rather than to the markup: `workspace` is a substring of the class name on
  // every one of these elements. ---
  for (const text of await workspaceLabels.allTextContents()) {
    expect(text).not.toBe(SEED_FOLDER)
    expect(text).not.toBe(DAEMON_WORKDIR_LABEL)
  }

  // --- The dialog closed on Save (AC1). Ordered LAST because it is round-trip-blind: the container clears
  // its `editWorkspaceCwd` cell in the Save handler itself, so this would pass against a daemon that
  // answered nothing at all. It is here to catch a dialog left open over the relabelled row, and for no
  // stronger claim than that. ---
  await expect(dialog).toHaveCount(0)
})
