# #1283 — a real-daemon spec creates a channel through the Create channel dialog and reads it back promoted

## Files read

- `e2e/real-daemon-promote.spec.ts` → the whole spec — the template this one clones: the pairing drive, the
  three timeout constants, the readiness gate, and the "assert the row's own affordance, not the section
  header" idiom that reads promotion off the DOM.
- `e2e/real-daemon-workspace.spec.ts` → the whole spec — the sibling that already proves a daemon-side
  workspace verb on this tier, and the source of the "a timeout here is a genuine daemon gap, never
  something to paper over" framing.
- `e2e/real-daemon-conversation-lifecycle.spec.ts` → its FAB-create step — the only existing real-tier proof
  that `create_conversation` round-trips, and the one that records `cwd: null → daemon default = the harness
  -pyry-workdir`. That sentence is what makes the cwd trap concrete.
- `e2e/sidebar-create-channel.spec.ts` → the whole spec — #1179's fake-tier twin, and the source of the
  non-vacuity mechanism this plan reuses: make the seed's `cwd` differ from the create default so a
  defaulted create mints a *second* workspace group.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions`, the `daemon` fixture, `seedRegistry` — the option
  fixture pattern (`seedPromoted`, `skipPermissions`) the new option follows, and the single place the
  seeded conversation's `cwd` is written.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`, `workspaceLabelFor` —
  the grouper keys on the **raw `cwd` string, normalised in no way**, and the label is the last non-blank
  path segment. Both facts are load-bearing below.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow`, `CREATE_CHANNEL_CONTROL_LABEL`,
  `RENAME_CONTROL_LABEL`, `SAVE_AS_CHANNEL_CONTROL_LABEL` — the plus's accessible name, the workspace
  label element, and the two mutually exclusive row affordances promotion is read from.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialogView` — the dialog's
  class names (`.create-channel`, `.create-channel__input`, `.create-channel__create`).
- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state → two lessons that change
  how this ticket is built: **`test.use` omissions are silent** (#1259's first gate run reddened because the
  prose said "promoted" and the declaration was missing — no typecheck or lint covers `e2e/`), and the tier's
  `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor is an operator-owned dispatcher variable that goes stale the
  moment a spec is added.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md` → the package overview for this tier.

Read outside this repo, to settle the cwd question against the actual daemon rather than by guessing
(sibling checkout at `~/Workspace/Projects/pyrycode`, read-only):

- `internal/relay/handlers/create_conversation.go` → `CreateConversation` — the handler.
- `cmd/pyry/main.go` → `resolveSpawnDir` — the requested-cwd validator.

## Design source

**Figma:** N/A — this ticket adds one Playwright spec and one additive test-fixture option. No production
code and no rendered surface change, so the visual-fidelity check is intentionally skipped. The UI it drives
was drawn and shipped by #1179.

## Context

#1179 shipped the Channels-tree workspace plus and its Create channel dialog, and with it the first create
this client has ever sent carrying `is_promoted: true` and a non-null `name`. Its fake-tier proof asserts the
payload against `conversationStateFake`, which mints its row *from the request* — so it proves what the
client sends and can prove nothing about what the daemon does with it. This ticket is the real-daemon proof
of that write path, the same way #443 followed promote, #439 followed rename and #441 followed the workspace
picker.

No ADR is warranted: the tier, the fixture and the partition-by-filename convention all already exist, and
this adds one spec to them.

### What the daemon actually does (read, not assumed)

The three claims the spec rests on were settled by reading `CreateConversation` and `resolveSpawnDir`
upstream, because a wrong guess here surfaces only as a red on the operator's machine:

1. **The recorded `cwd` is the payload's value, byte-for-byte.** `CreateConversation` resolves
   `cwd := defaultCwd` and overwrites it with `*p.Cwd` when the payload sets one; the registry row and the
   `conversation_created` reply both carry that string with no cleaning, no `filepath.Abs`, no symlink
   resolution. So `groupByWorkspace`'s raw-string key genuinely matches the seeded row's `cwd`, and the
   "both rows land in one group" reading is sound rather than luck. (This mattered: had the daemon
   canonicalised, `/var/folders/…` from `mkdtemp` versus `/private/var/folders/…` would have split one
   workspace into two groups and reddened a *correct* daemon.)
2. **A null `cwd` falls back to `defaultCwd`, the daemon's `-pyry-workdir`.** That is the trap the ticket
   names, and it is what the detector below separates.
3. **A requested `cwd` is validated, not trusted.** `resolveSpawnDir` expands a leading `~`, confines the
   path to `$HOME` after symlink resolution on both sides, **creates it if missing**, and trust-marks the
   realpath; an escape is a non-retryable `protocol.malformed`. The seed cwd this plan chooses sits *inside*
   the daemon's own workdir, so it is confined by construction and the validator is a no-op on it.

There is no name validation and no promoted-name uniqueness check on the create path, so the typed name
needs no nonce (each run gets a fresh registry anyway).

## Design

### The fixture: one additive option

`RealDaemonOptions` gains `seedCwdSubdir: string`, defaulting to `''` — the `seedPromoted` / `skipPermissions`
pattern, so every existing `real-*` spec stays byte-identical without touching a line.

- `''` → the seeded conversation's `cwd` is `workdir`, exactly as today.
- a non-empty value → the fixture creates `<workdir>/<value>` (mode `0o700`, beside the existing `work`
  `mkdir`) and `seedRegistry` writes that path as the conversation's `cwd`.

`SpawnedDaemon.workdir` is unchanged: it stays the daemon's `-pyry-workdir`, which is what #487's consumer
means by it. Only the argument `seedRegistry` receives moves.

The option is constrained to a **single, plain path segment** — it must match `/^[A-Za-z0-9._-]+$/` and be
neither `.` nor `..`, or the fixture throws at setup. It is spec-authored constant text today, and the guard
is what keeps it that way: it makes "this option can never name a directory outside the daemon's workdir" a
structural property rather than a comment a future spec can ignore. Same reasoning `withIsolatedElectronApp`
records for never taking a path parameter.

The character class is doing a **second** job the security pass surfaced, and it is the reason the guard is a
whitelist rather than a `/`-and-`..` blacklist: a whitespace-only value (`'   '`) names a legal directory,
but `workspaceLabelFor` trims each segment as its usability predicate, walks past it, and labels the group
`work` — the daemon's own default basename. That would make AC3's detector pass whatever the daemon did with
the `cwd`, which is the exact vacuity this ticket exists to prevent. Rejecting it at the fixture is cheaper
than discovering it as a silently-green operator run.

The `mkdir` goes **inside the existing `try`, immediately after the `work` one**, so the `finally`'s
`cleanup` reaps it with `daemonHome` on every exit path — setup failure, test failure and success alike. A
directory created before `daemonHome` is tracked would leak on a raised setup.

### The spec: `e2e/real-daemon-create-channel.spec.ts`

`test.use({ spawnClaude: false, seedPromoted: true, seedCwdSubdir: <constant> })`. All three are declared
explicitly — the runbook's #1259 lesson is that a `test.use` omission is invisible to every gate except the
operator's live run.

- `spawnClaude: false` — the daemon answers `create_conversation` without starting a turn (the mint no
  longer spawns claude), so this is the credential-light tier, not the real-claude one.
- `seedPromoted: true` — the Channels tree draws a workspace row, and therefore a plus, only for a workspace
  holding a promoted conversation. This is the option the two specs the ticket warns about set to `false`,
  and it is why their `.channel-list__save` readiness gate does not carry over: a promoted seed carries
  `.channel-list__rename` instead.

The drive: pair → readiness gate on the promoted seed's Rename control → baseline reads → click the plus →
type a name → Create → the four post-round-trip assertions.

### ⭐ The cwd trap, and what separates the two outcomes

One seed, promoted, whose `cwd` is **`<workdir>/<subdir>` and therefore not the daemon's create default**.
That single choice is the whole mechanism, and it is the same one #1179's fake twin uses against
`conversationStateFake`'s `DEFAULT_CREATED_CWD`:

| | Channels-tree workspace labels after the create |
|---|---|
| daemon honoured the requested `cwd` | `['<subdir>']` — one group, both rows in it |
| daemon ignored it and used `defaultCwd` | `['<subdir>', 'work']` — the created row minted a second group |

The assertion is `expect(page.locator('.channel-list__workspace-label')).toHaveText([WORKSPACE_LABEL])` —
the full ordered list of labels, not a count. That shape is deliberately self-diagnosing: a defaulted create
fails with `work` visible in the diff (the daemon ignored the payload), while a hypothetical
canonicalising daemon fails with the same label twice (one workspace split in two). A bare
`toHaveCount(1)` would report both as the same number.

Why this and not a second seeded workspace, which is the route the ticket sketches: one seed already
separates the two outcomes, and a second one would put a group in the Chats tree as well, adding a "Create
chat" plus and a second `.channel-list__workspace-label` to reason around for no extra discrimination.

Why not attribute the row to its group structurally instead: the two trees render a **flat** run of siblings
(host, workspace head, rows, …) — `renderServerTrees` says so and 28 e2e specs depend on it — so there is no
ancestor to scope a row locator by. The group's label list is the observable the DOM actually offers.

### Reading the other two fields back

- **`is_promoted`** — the row's own affordance, `real-daemon-promote`'s idiom: `ChannelList`'s `Row` gives a
  promoted row `Rename` and no `Save as channel`, and an unpromoted one the reverse, disjoint by
  construction. Two Rename controls and zero Save controls after the create is the promotion proof; a create
  the daemon stored unpromoted would put the row in the Chats tree wearing `Save as channel`.
- **`name`** — `.channel-list__row-open[aria-current="true"]` reads the typed name. The created row is
  active because `useConversationCreatedNav` opens it on the daemon's `conversation_created`, and its title
  comes from the daemon's own list, not from anything the client optimistically kept. A create the daemon
  stored with a null name renders `titleFor(null)` = `Untitled` here instead.

### Ordering: every absence sits behind a positive, auto-waiting read

`expect(rows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })` leads, because it is the only assertion that
is false before the round trip resolves. The label list, the affordance counts and the dialog's disappearance
are all unchanged-state or already-true reads that would pass against the pre-create render if they led.

## State + concurrency model

Nothing is added. The spec consumes the existing `relay → daemon → page` fixture chain, whose LIFO teardown
(page closes first, then the daemon's process group, then the relay) already guarantees the app's supervisor
cannot churn-reconnect on the drop. The fixture's `try/finally` reaps the new subdirectory too, because it
lives under `daemonHome`, which `cleanup` already removes recursively.

The one long-lived async job the spec introduces is Playwright's own auto-waiting, bounded by the three
timeout constants.

## Error handling

- **A missing or broken daemon handler** surfaces as a timeout on the leading row-count assertion. That
  timeout is the intended loud signal — file it as a daemon gap, never soften the assertion or lengthen the
  timeout.
- **A rejected `cwd`** (`protocol.malformed`, `conversation working directory not allowed`) surfaces the same
  way: no `conversation_created`, no re-list, the row count stays 1. The chosen seed path is inside the
  daemon's `$HOME` and inside its own workdir, so reaching this is itself a finding.
- **No machine without `pyry`ever fails**: the fixture skip-gates on the binary before creating any resource,
  so the spec is an unrun test on the agent machine rather than a red one.

## Testing strategy

This ticket *is* a test, so the strategy is about what proves the test itself rather than what the test
proves.

- **Not vitest.** Nothing here is a pure derivation; the fixture option is spawn-harness wiring, matching
  how `seedPromoted` and `skipPermissions` shipped untested at the unit tier.
- **Not runnable by this agent.** The real-claude tiers are the operator's gate, not the builder's, and the
  spec skips on any machine without `pyry`. What stands in:
  - `npx playwright test --list` against **both** configs — proves AC4 mechanically (the default tier does
    not collect the file, the real-claude tier does) without executing anything.
  - an ad-hoc `tsc --noEmit` over the spec, because no tsconfig includes `e2e/` and Playwright strips types
    with esbuild — a type error in a spec surfaces in no gate at all.
  - `npm run build`, the salvage/QA gate, unchanged production code notwithstanding.
- **AC5 is the operator's run.** `npm run e2e:real:gate` reports the executed count; adding this file takes
  the tier from 16 specs to 17, so `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` — a dispatcher environment variable
  that lives outside this repo — goes stale until the operator bumps it. Flagged in the spec header, the
  PR body and here; it is not a change this ticket can make.

## Open questions

- **Does `.channel-list__row-open` contain only the row title, or the relative time as well?** The fake twin
  asserts `toHaveText(CHANNEL_NAME)` on it and passes with a timestamped seed, so the time is a sibling —
  confirm against `Row` in Phase B and fall back to `toContainText` only if the markup says otherwise.
- **Does the tier's per-file test count stay 1:1 with the executed count?** The runbook's "16 specs" and the
  floor of 16 agree today; if a real-\* file ever holds two tests the PR note should say 17 files rather than
  17 tests.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** One new boundary, and it is the reverse of the usual direction: `seedCwdSubdir`
  crosses from spec source → `path.join` → `mkdir` → the daemon's registry JSON → and then back out through
  the sidebar as the `cwd` of a `create_conversation` the drive itself sends. Explicit and single-sited: the
  `daemon` fixture is the only place the value is read, and the single-segment guard above is the only place
  it is validated. The *other* direction — daemon text reaching the spec — is deliberately never trusted: no
  assertion reads a daemon-supplied string into a comparison; every expected value is a client- or
  spec-owned constant (`WORKSPACE_LABEL`, `CHANNEL_NAME`) and the daemon's `cwd` is observed only as the
  basename `workspaceLabelFor` derives.
- **[Tokens]** No finding, and the reason is worth stating rather than assumed. The pairing token reaches the
  spec as `daemon.pairFields.token`, goes straight into `encodePairingPayload`, and is typed into the app by
  `pairFromUnpairedLaunch` — the sibling `real-daemon-*` path exactly. Nothing in this spec logs, attaches,
  or asserts on it. The one place a value could reach a diagnostic is a Playwright assertion failure, and the
  worst it prints is a directory **basename** (`work`, the seed subdir) plus the name this drive typed —
  never a full path, never the token, never a transcript. `decodePairFields`'s "never echo stdout" posture is
  untouched.
- **[File / storage]** SHOULD FIX, addressed in the design above rather than deferred: the new
  `mkdir(join(workdir, seedCwdSubdir))` is the § 3 path-traversal shape — untrusted-shaped input
  concatenated into a filesystem path. The whitelist guard (`/^[A-Za-z0-9._-]+$/`, `.`/`..` rejected) makes
  an escape unrepresentable rather than merely unlikely; `/`, `..`, absolute paths and whitespace names are
  all rejected before any syscall. No TOCTOU (`mkdir` with `recursive`, not check-then-open). Scope: mode
  `0o700` under the run's `mkdtemp` `daemonHome`, reaped by the fixture's existing `cleanup` — nothing lands
  in a shared or synced directory, and no secret is written by the new code.
- **[Electron attack surface]** No finding. Zero production code, no new IPC channel, no `webPreferences`
  change. The spec consumes the two existing `app.isPackaged`-gated dev affordances — the loopback-relay
  acceptance and the keychain-free secret backend — through `withIsolatedElectronApp` verbatim, relaxing no
  validation of its own; a packaged build reads neither flag.
- **[Cryptographic primitives]** No finding, by a deliberate omission: unlike `real-daemon-workspace`'s
  `folder-${Date.now()}`, this spec uses **no** nonce at all, because the daemon applies no uniqueness check
  on `create_conversation`'s name and each run gets a fresh registry. So there is no weak-randomness
  construct here to mistake for a security primitive.
- **[Network & I/O]** No finding. No new network code; the relay is the test's own in-process
  `startFakeRoutingRelay` on loopback, and every wait is bounded by the three timeout constants
  (`HANDSHAKE_TIMEOUT_MS`, `ROUNDTRIP_TIMEOUT_MS`, and a `SPEC_TIMEOUT_MS` well under the config's default),
  so a wedged daemon fails the spec rather than pinning a worker.
- **[Error messages / logs]** No finding. The spec emits nothing — no `console.*`, no `testInfo.attach`. The
  fixture's one new throw names the option and the rejected segment, which is spec-source constant text by
  construction and never a full path. `PYRY_E2E_DAEMON_LOG` stays opt-in and off in the gate.
- **[Concurrency]** SHOULD FIX, addressed in the design above: the new `mkdir` must sit inside the fixture's
  existing `try` so `cleanup` reaps the directory on a raised setup. Placement is the whole of it — there is
  no new async ownership, no new listener, and no new cancellation path; the `relay → daemon → page` LIFO
  teardown is unchanged.
- **[Threat model]** Two of the four desktop threats are structurally absent on this tier and are named
  rather than skipped. *Malicious relay*: out of scope here — the relay is the test's own in-process fake on
  loopback, and the on-path threat is the live gate's concern. *Renderer compromise reaching the transport*:
  unreachable, no production code changes. *Hostile daemon response* is the one that is genuinely live: the
  daemon is a real `pyry`, and the spec's answer is the read-side posture described under Trust boundaries —
  it compares against its own constants and never lets a daemon string become an expected value.
- **[Out of scope]** The tier's `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor goes stale (16 → 17). It is an
  operator-owned dispatcher variable outside this repo; the operator bumps it, per the runbook.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
