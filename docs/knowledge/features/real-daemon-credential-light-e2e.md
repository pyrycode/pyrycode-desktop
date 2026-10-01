# Real-daemon credential-light e2e tier

A real spawned `pyry` daemon on the content-blind [fake routing relay](fake-routing-relay.md), gated on
the `pyry` binary **alone** — no `claude`, no Anthropic credential, no `.claude.json`. This is the
credential-light sibling of [real-claude liveness e2e](real-claude-liveness-e2e.md), for the
registry-backed user actions (rename, archive, restore, delete, recent-workspaces, create-folder,
change-workspace, session-settings, dequeue) that are pure registry ops daemon-side and never touch
claude.

Introduced in [#439](../codebase/439.md), split from #430. Extends the fixture chain
[#420](../codebase/420.md) extracted.

## What it does

The daemon-side registry actions never invoke claude, so proving them end-to-end doesn't need a claude
binary or an Anthropic credential — only the `pyry` binary. This tier exists to catch the class of gap
`real-claude.spec.ts` and the fake-daemon suite both miss: pyrycode/pyrycode#949, where the daemon defined
a wire type, payload, and registry op (`promote_conversation`) but registered **no handler**, so the real
wire answered `unsupported` — while the entire fake-daemon suite stayed green, because a fake answers
anything, and `real-claude.spec.ts` never exercises a registry action at all (it only proves the
send/stream turn). A real daemon with a real (if handler-missing) registry is the only thing that catches
this class of bug, and this tier makes that real daemon credential-light and cheap enough to run alongside
the operator's other pre-ship gates.

`e2e/real-daemon-rename.spec.ts` (#439) is the tier's liveness proof: pair against a claude-less spawned
daemon, wait for the seeded conversation's Rename pencil to render, rename it through the product UI, and
assert the new title lands in the channel list (old title gone). Sibling action specs reused the same
harness and shipped: [#440](../codebase/440.md) (conversation lifecycle — archive/restore/delete),
[#441](../codebase/441.md) (workspace — recent-workspaces + create-folder), [#443](../codebase/443.md)
(save-as-channel promote — the tier's **marquee case**, pins pyrycode/pyrycode#949 directly),
`e2e/real-daemon-session-settings.spec.ts` (#481 — see below), `e2e/real-daemon-create-channel.spec.ts`
(#1283 — the Channels-tree [Create-channel dialog](create-channel-dialog.md)'s promoted create, see
§ Proving a promoted create is genuine below), and `e2e/real-daemon-workspace-rename.spec.ts` (#1293 —
the [Edit workspace dialog](edit-workspace-dialog.md)'s rename, see § Proving `rename_workspace` is
genuine below). A sixth verb, dequeue, stayed **demoted to Inbox without shipping**: it needs a
sustained turn this claude-less mode can't run, so it stays an empty observable subset on this tier.

**set-session-settings was demoted once, under its original ticket #442, then revisited and shipped
under #481.** #442's verdict — "the confirmation never touches the DOM, optimistic-first" — is half true
and was read as the whole truth: `aria-checked` (and, at the time, the model row's current-mark) does
flip optimistically, before any daemon byte. But #558 later put `aria-busy` on the control element
itself, deleted only by a correlated reply, so the reply *does* gate a DOM transition — the **settling**,
not the value. #481 built the spec on that distinction: a write is asserted as a three-step sequence
(value flips optimistically → `aria-busy` clears, reply-gated → value re-read, still holding), so a
reject or a reconnect — both of which clear `aria-busy` without committing the value — fail on the third
step rather than passing on the overlay. This sharpens the tier's provability rule from #443's simpler
form: **a verb is provable here if its daemon reply gates some DOM transition — a busy/pending flag
settling counts, even when the displayed value itself renders optimistically — but the value must then
be re-read after the settle**, since settling alone doesn't distinguish a confirm from a reject. #443
remains the cleanest case of the rule's simpler form: the daemon's reply gates the value directly, with
no optimistic overlay in front of it at all.

`e2e/real-daemon-session-settings.spec.ts` shipped keyed on the Model rows, which then rendered from a
client-side catalog and so needed no daemon frame. #975 deleted that catalog and #976 followed it: since
then the Model rows and the Effort segments are both built from the daemon's published `model_list`
frame, which a claude-less spec never receives (the daemon only emits it from claude's own model
announcement) — so both controls became permanently unreachable on this tier, and the spec went red on
`main` the moment #975 merged, failing at the first sheet read and parking the whole
`e2e:real:gate` floor (issue #987). #987 re-keyed the round-trip onto `YoloSection`'s switch, the one
run-config control that takes no published rows — same write handler, same reply correlation, so
`set_session_settings` itself stays covered against the real wire, at the accepted cost of dropping
real-wire coverage of the model-specific `validModel` leg (still covered at the daemon's own unit tier).

[#440](../codebase/440.md) ran green against a live `pyry dev` build and confirmed all four registry
handlers this tier depends on (`create_conversation`, `archive_conversation`, `unarchive_conversation`,
`delete_conversation`) are wired — no #949-class gap found on that build. It also surfaced the tier's
first seed/title collision: unlike #439's rename spec (whose seed identity doesn't matter), #440's
`seedRegistry` seed and its FAB-created conversation can both render "Untitled" (the fixture writes no
`name`), so #440 established scoping created-vs-seed rows by **section affordance**
(`.channel-list__rename` on a promoted row vs. `.channel-list__save` on a non-promoted one) rather than
title text whenever a spec's seed and test-created row could collide on display string.

[#441](../codebase/441.md) is the first sibling to use `seedPromoted:false` (a Recent discussion, not a
Channel) — its `.channel-list__save` affordance doubles as the readiness gate, generalizing #440's
section-affordance idiom to a non-promoted seed. It drives the `WorkspacePickerSheet`'s (#383)
recent-workspaces and create-folder round-trips against the real daemon, ran green end-to-end on a live
`pyry` (2.4s, not just skip-clean), confirmed both `recent_workspaces` and `create_workspace_folder` are
wired with no #949-class gap, and established that a real-daemon "picker/dialog closed" assertion should
target a DOM element that renders unconditionally (here, `.workspace-picker__other`) rather than one
whose presence depends on the same daemon-derived round-trip already under test — a row-count-0 check
can pass vacuously if the daemon's reply content changes shape.

[#443](../codebase/443.md), the marquee case, promotes the seed through `SaveAsChannelDialog`'s scratch
("Keep in scratch") arm — the one path that sends `promote_conversation` alone, with no
`create_workspace_folder` prelude — and asserts the row moves from the "Chats" section (labelled
"Recent discussions" until [#709](../codebase/709.md)) to "Channels" only after the daemon's
`conversation_updated` reply drives a re-list; the dedicated
("Move to dedicated channel folder") branch was deliberately dropped from this tier since its
`create_workspace_folder` prelude is already real-wire-proven by #441 and the daemon's #949 handler
(Option B) ignores the promote payload's `cwd` entirely, leaving that branch's remaining contract a
client-only concern already covered by the fake twin #423. This is the sibling that most directly proves
\#949 is fixed — a pre-#949 binary would answer `unsupported` and this spec's core assertion would time
out.

### Proving a promoted create is genuine, not echoed (#1283)

`e2e/real-daemon-create-channel.spec.ts` is the real-daemon twin of the fake-tier
[Create-channel dialog](create-channel-dialog.md)'s `e2e/sidebar-create-channel.spec.ts`. The fake twin
mints its created row *from the request* — `conversationStateFake` uses the sent `is_promoted` and
`name`, and the sent `cwd` or its fixed default for null — so it proves what the client sends
and nothing about what the daemon
does with it. This is the first exercise of the daemon's promoted-create branch: every create the app had
sent before #1179 carried `is_promoted: false, name: null`.

**The cwd trap.** `create_conversation` resolves a null payload `cwd` to the daemon's own
`-pyry-workdir`. A seed in that same directory would let both the intended null request and an
accidental clicked-path request appear in one workspace group. The fixture's `seedCwdSubdir`
puts the seed one level below the workdir. The current spec expects a second group labelled
`work` after confirmation; a request carrying the clicked seed path leaves only the seed group.
The fake twin verifies the outgoing explicit null, while this real-daemon drive proves where the
daemon stores the promoted, named channel.

**A whitespace-only subdirectory name would have silently defeated the whole mechanism.** The client's
`workspaceLabelFor` trims each path segment as its display predicate, so a seed placed at a
whitespace-named subdirectory renders labelled after the *parent* segment — the daemon's own workdir
basename, `work`, the exact label a defaulted create mints. That would make the cwd assertion pass no
matter what the daemon did with the payload. `seedCwdSubdir` is validated with a whitelist
(`/^[A-Za-z0-9._-]+$/`, `.`/`..` rejected) rather than a `/`-and-`..` blacklist for this reason as much as
for path traversal, and the check runs before any resource is created so a bad value throws loudly at
setup instead of skipping clean.

**No structural way to scope a row to its group.** Both the Channels and Chats trees render a flat run of
siblings (host, workspace head, rows, …) that 28 other e2e specs already depend on, so there is no group
ancestor to scope a row locator by. The spec instead asserts the whole ordered list of
`.channel-list__workspace-label` texts, not a count — deliberately self-diagnosing: the intended
default create adds the workdir's `work` label, while a create in the clicked seed folder does not.
The ordered labels expose which group appeared; a bare count obscures that distinction.

### Proving `rename_workspace` is genuine, and the label-clearing trap a fresh registry hides (#1293)

`e2e/real-daemon-workspace-rename.spec.ts` is the real-daemon twin of #1180's
[Edit workspace dialog](edit-workspace-dialog.md) fake-tier spec, `sidebar-workspace-edit.spec.ts`. The
fake twin's `conversationStateFake` answers whatever `rename_workspace { path, label }` the client
sent, so it proves the frame leaves the app and nothing about whether a real `pyry` has a handler for
it — `rename_workspace` (pyrycode#2158 / pyrycode#2208) is a new daemon verb that shipped client-side
(#1289) against that fake alone. It reuses #1283's `seedCwdSubdir` option fixture unchanged — no
fixture change was needed.

**The label-clearing trap this spec exists to pin apart.** `requestRenameWorkspace`
([edit-workspace-dialog.md](edit-workspace-dialog.md)) sends `label: null` — the daemon's
clear-this-label value — exactly when the trimmed typed name equals `workspaceLabelFor(cwd)`, the
**folder segment**, not the label currently displayed. On a fresh registry the daemon holds no
`workspace_label` at all, so the row's pre-save label *is* that folder segment. A spec that typed a new
name equal to the seed's own folder would therefore send a **clear**, the row would fall back to that
same folder segment after the round trip, and the drive would run, click, and assert green while proving
nothing about a handler existing at all. The spec pins the two apart with a plain
`expect(NEW_LABEL).not.toBe(SEED_FOLDER)` beside the pre-read, asserted rather than trusted — the same
shape #1283's `DAEMON_DEFAULT_LABEL` guard uses. **Worth carrying to the next real-daemon spec that
types a name onto a workspace-shaped field:** check whether the client's own send logic special-cases
the value equal to the daemon's fallback display string before treating any assertion built on it as
non-vacuous.

**Diagnostic hygiene: no `cwd`/path assertion, unlike the fake twin.** The fake twin asserts the
dialog's path line renders the workspace `cwd`; this spec declines that read, because on the real tier
`cwd` is an absolute path under a temp `daemonHome` and a failing diff would print it whole. Every
value this spec asserts is a client-owned constant (`SEED_FOLDER`, `NEW_LABEL`), so the worst any
assertion here can print is a directory basename — `workspaceLabelFor` takes only the last
segment — the same posture #1283's spec settled on. Verified rather than assumed:
`playwright.real-claude.config.ts` enables no screenshot, trace or video, so a failure yields text
diffs only, never a window capture of the open dialog (the one surface that renders the full path).

**Two failure signatures, and a longer timeout must never paper over either.** A `pyry` predating
pyrycode#2208 omits `workspace_label` from its list reply; `requireStringOrNull` in
`parseConversationSummary` fails closed on the missing key, so the whole list decode throws and
**nothing renders** — the readiness gate (`.channel-list__rename`) times out on an empty sidebar. That
is a stale binary, fixed by rebuilding `pyry`. A daemon carrying the field but registering no
`rename_workspace` handler renders the sidebar normally and the label simply never moves off
`SEED_FOLDER` — the #949-class gap this tier exists to catch, and what the closing read
(`ROUNDTRIP_TIMEOUT_MS`) is tuned to catch rather than mask. A daemon that *rejects* the rename
presents identically to the second signature, since this verb is fire-and-forget and the client
surfaces no rejection at all (edit-workspace-dialog.md § Edge cases) — a red here is "the daemon did
not relabel", not yet definitively "the daemon has no handler".

No `requiredCapabilities` declared, as with every claude-less sibling on this tier: the #933 gate reads
the hello-ack **intersection** against the one capability string this client advertises
(`interactive`), and naming a workspace-specific string the daemon doesn't know would convert a
genuine missing-handler red into a permanent skip — which still counts against the gate floor and
parks the ticket forever.

## How it works

### Three option fixtures on the shared `realDaemon.ts` fixture

`e2e/fixtures/realDaemon.ts` ([#420](../codebase/420.md)) now exposes three additive Playwright **option
fixtures**, added across #439 and #1283:

```ts
type RealDaemonOptions = {
  spawnClaude: boolean    // default true  — the claude-spawning mode (real-claude.spec.ts)
  seedPromoted: boolean   // default false — the seeded conversation's is_promoted
  seedCwdSubdir: string   // default ''    — seeds cwd one level below the daemon's own workdir
}
```

A spec opts into the credential-light mode at file scope:

```ts
test.use({ spawnClaude: false, seedPromoted: true })
```

Defaults reproduce [real-claude liveness e2e](real-claude-liveness-e2e.md)'s exact prior behavior — that
spec sets none of the three options, so it still gets `spawnClaude: true` + `seedPromoted: false` +
`seedCwdSubdir: ''`, unchanged. `seedCwdSubdir: ''` also reproduces every pre-#1283 `real-*` spec's `cwd`
byte-for-byte, since it seeds the conversation at `workdir` itself exactly as before; only a spec that
opts into a non-empty value gets the seed placed in a subdirectory, and `SpawnedDaemon.workdir` keeps
meaning the daemon's `-pyry-workdir` either way — the #487 consumer that reads it is untouched.

**Why option fixtures, not a factory/sibling fixture.** The `relay → daemon → page` chain's dependency
order *is* the LIFO teardown (the app closes first so its supervisor can't churn-reconnect on the
daemon/relay drop). A factory fixture (the `launchPairedApp` shape) would collapse that chain and force
`real-claude.spec.ts` to change its call shape. Option fixtures are purely additive: an unmodified consumer
keeps its old call shape and old defaults.

### The `daemon` fixture's `spawnClaude` branch

`pyry` is resolved and skip-gated **unconditionally** — both modes spawn a real daemon. `claude`, the
`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` pair, and the operator's `.claude.json` are resolved and
skip-gated **only** inside `if (spawnClaude)`. So `spawnClaude: false` never skips on a missing claude
binary or credential — the whole point of the tier.

Spawn args are identical between modes except:

- **`-pyry-claude`.** `spawnClaude: true` → the resolved real `claude` binary (unchanged). `spawnClaude:
  false` → a harness-owned placeholder, `<daemonHome>/noop-claude.sh` (`#!/bin/sh` + `exit 0`, mode
  `0o755`), written fresh per test and cleaned up for free with the rest of `daemonHome`.
- **Post-`--` claude args** (`--model haiku --dangerously-skip-permissions`) — present only when
  `spawnClaude: true`; omitted entirely in claude-less mode, since no claude turn ever runs and passing
  claude flags to a non-claude placeholder would be misleading.

**Why a placeholder and not omitting the flag.** The credential-light invariant is "no real claude binary
or Anthropic credential required," not "flag absent." Pointing `-pyry-claude` at a harness-owned
executable removes all dependence on the daemon's own default resolution, which might otherwise fall back
to a PATH `claude` that a claude-less machine lacks. Precedent for daemon-side binary substitution:
`docs/lessons.md` records `/bin/sleep`-style fake-claude binaries used as `-pyry-claude` in the daemon's
own multi-session e2e.

**Why the placeholder is safe to never invoke.** `real-claude.spec.ts` documents the daemon spawning
claude lazily on the **first `send_message`**, not at boot (a cold-PTY spawn). None of the registry
actions this tier proves trigger a `send_message`, so the placeholder only has to be an executable path
the daemon accepts at flag-parse time — confirmed on the operator machine: the `exit 0` placeholder boots
the daemon fine and it registers on the relay without treating the immediate exit as a crash.

### Seed promotion is a per-spec option, not a shared default

`seedRegistry` takes a third param, `isPromoted: boolean`, threaded from the `seedPromoted` option,
replacing what was a hardcoded `"is_promoted":false` literal in the seeded `conversations.json`. This
matters because the sibling specs need both values independently: [#439](../codebase/439.md)'s rename spec
needs `seedPromoted: true` (a promoted row renders the `.channel-list__rename` pencil —
`partitionByPromotion` in `channelListViewModel.ts` puts `is_promoted: true` rows in the Channels section),
while the save-as-channel sibling (#443) needs an **unpromoted** row to test promoting it. Keeping this a
per-spec option instead of a shared default lets every sibling toggle it without touching the fixture.

### Readiness gate — rides the promoted-row render, not a bare row-visible check

The rename spec's readiness gate is `.channel-list__rename` becoming visible, not merely a row appearing.
This is stronger and more specific than a Send-enabled gate ([real-claude liveness
e2e](real-claude-liveness-e2e.md)'s readiness signal): the pencil rendering proves the whole chain — Noise
handshake complete → session `connected` → the auto-fired `list_conversations` round-trip returned the
seeded row → the row rendered **promoted** (in the Channels section, per `partitionByPromotion`). Sibling
specs choosing a different readiness gate should pick the strongest DOM signal available for their
scenario, not just "a row exists."

### Liveness integrity — why a real daemon round-trip is what's actually being proven

The renderer's rename dispatch is fire-and-forget — it never locally mutates the channel list. The new
title reaches the DOM only via the daemon's `conversation_updated` broadcast →
[`conversationListBridge.ts`](../../../src/renderer/src/store/conversationListBridge.ts)'s
`shouldRefreshList` → a fresh `list_conversations` request → re-render. So the new title appearing in
`.channel-list` is proof of a genuine daemon `rename_conversation` round-trip, not a renderer-side echo — a
missing or no-op handler (the exact #949 class this tier exists to catch) surfaces as an assertion timeout,
not a false pass. This is why the spec's error-handling stance is deliberate: a step-9 timeout is a
**genuine liveness signal**, and the harness must not weaken the assertion or add a manual re-request to
force a pass.

## Configuration and usage

Run via `npm run e2e:real-claude` (there is no separate `e2e:real-daemon` alias — the widened `real-*`
`testMatch`/`testIgnore` pair from #420 covers every `real-*` spec under the one command). A spec opts in
with:

```ts
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
test.use({ spawnClaude: false, seedPromoted: <true|false per scenario> })
```

Prerequisites: only `pyry` on `PATH` (or `PYRY_BIN`), built from a **#820-inclusive** tree (the
`rename_conversation` handler) in addition to the existing #854 requirement. No `claude`, no
`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`, no `~/.claude.json`.

## Edge cases and limitations

- **`e2e/` is not typechecked** by either project tsconfig (same as every other e2e fixture) — a fixture
  type error surfaces only via `npx playwright test --config playwright.real-claude.config.ts --list`
  compiling, not `npm run build`.
- **Process-group reaping is unchanged.** `reapDaemon`'s SIGTERM-then-SIGKILL process-group kill still
  applies cleanly in claude-less mode — it reaps `pyry` alone (no claude grandchild), or `pyry` + the
  placeholder in the unused long-lived-fallback case (see below).
- **A long-lived placeholder fallback exists but was not needed.** If some daemon build eagerly spawns
  claude at boot for the seeded active session and treats an immediate `exit 0` as a crash, the placeholder
  can be swapped for `#!/bin/sh` + `exec sleep 2147483647` (occupies the slot, reaps with the process
  group). Confirmed unnecessary on the operator's build as of #439 — the daemon spawns claude lazily on
  first `send_message`, matching `real-claude.spec.ts`'s own cold-PTY evidence.
- **The rename spec's readiness + liveness chain depends on the daemon echoing `is_promoted` and emitting
  `conversation_updated`.** Both were confirmed working against a real #820-inclusive daemon (#439); a
  future daemon regression in either would surface as a timeout in this spec, which is the tier doing its
  job, not a flake to paper over.
- **A fixture-seeded row and a spec-created row can render an identical title.** `seedRegistry` writes no
  `name`, so the seed and any name-less FAB-created conversation both render "Untitled" — confirmed by
  #440. A spec that needs to distinguish them (a re-entry click, a post-mutation survivor assertion) must
  scope by a structural signal (section membership, an affordance class) rather than title text.

## Related

- [#439 codebase notes](../codebase/439.md) — this tier's introduction, plus the rename liveness spec.
- [#440 codebase notes](../codebase/440.md) — the conversation-lifecycle (archive/restore/delete) sibling
  spec, the first of the four action specs to ship; confirmed all four registry handlers wired, no
  #949-class gap on that build.
- [#441 codebase notes](../codebase/441.md) — the workspace-actions (recent-workspaces + create-folder)
  sibling spec, the second to ship and the first to use `seedPromoted:false`; ran green end-to-end on a
  live daemon, no #949-class gap.
- [#443 codebase notes](../codebase/443.md) — the save-as-channel promote sibling, the tier's marquee
  case; pins pyrycode/pyrycode#949 directly and states the rule's simpler form: a daemon reply gating the
  value directly, no optimistic overlay. No `docs/knowledge/codebase/442.md` or `441.md`-style note exists
  for #481 or #987 — the frozen per-ticket archive stops at 2026-08-26, before both landed.
- [Create-channel dialog](create-channel-dialog.md) / #1179 — the Channels-tree workspace plus and its
  dialog; this tier's `real-daemon-create-channel.spec.ts` (#1283) is its real-daemon proof, and the
  first spec on this tier to exercise `create_conversation`'s promoted branch.
- [Edit workspace dialog](edit-workspace-dialog.md) / #1180 — the workspace row's hover pen and its
  rename dialog; this tier's `real-daemon-workspace-rename.spec.ts` (#1293) is its real-daemon proof.
- [Conversation workspace change § Workspace rename](conversation-workspace-change.md) / #1289 — the
  `rename_workspace` wire contract #1293 proves against a real `pyry` for the first time.
- [Session settings send](session-settings-send.md) / [#263](../codebase/263.md) — the outbound write half
  `real-daemon-session-settings.spec.ts` proves against a real daemon: `setSessionSettings`, the
  confirmed/rejected correlation, and the presence contract.
- [Run configuration write store](run-settings-write-store.md) / [#256](../codebase/256.md) — the pending
  overlay, `aria-busy` source, and the `settingsConfirmed`/`settingsRejected`/`reconnected` arms the
  spec's three-step write sequence is built on.
- [Run configuration store](run-config-store.md), [Model list wire types](model-list-wire-types.md) —
  the `model_list` frame #975 moved the Model rows onto, and the reason
  `real-daemon-session-settings.spec.ts` can no longer exercise them claude-less.
- [Conversation promote](conversation-promote.md) / [#273 codebase notes](../codebase/273.md) — the
  `promote_conversation` transport slice #443 exercises end-to-end against a real daemon for the first
  time.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#252](../codebase/252.md) — the credentialed
  sibling tier that proves the send/stream turn; this tier proves the registry actions the credentialed
  tier never exercises.
- [E2E test harness](e2e-harness.md) / [#40](../codebase/40.md) — the launch/teardown primitive both real-*
  tiers build on.
- [#420 codebase notes](../codebase/420.md) — extracted `e2e/fixtures/realDaemon.ts`, the fixture this
  tier's option fixtures were added to.
- pyrycode/pyrycode#949 — the `promote_conversation` gap this tier exists to catch.
- pyrycode/pyrycode#881, #822, #677 — the archive/unarchive, delete, and create handlers #440 confirmed
  registered against a live daemon.
- pyrycode/pyrycode#982, #887, #981 — the `recent_workspaces` and `create_workspace_folder` handlers
  #441 confirmed registered and live-verified against a real daemon.
- pyrycode/pyrycode#820 — the daemon-side `rename_conversation` handler the liveness spec rides.
