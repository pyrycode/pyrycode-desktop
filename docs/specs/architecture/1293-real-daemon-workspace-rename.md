# #1293 — a real-daemon spec renames a workspace through the Edit workspace dialog

One new file, `e2e/real-daemon-workspace-rename.spec.ts`. Zero production files, zero fixture changes.

## Files read

- `e2e/real-daemon-rename.spec.ts` → the whole spec — the harness to copy: `test.use({ spawnClaude: false,
  seedPromoted: true })`, the `encodePairingPayload` + `pairFromUnpairedLaunch` drive, the three-timeout
  block, the readiness gate on `.channel-list__rename`.
- `e2e/real-daemon-create-channel.spec.ts` → the whole spec — the second worked example and the only
  `seedCwdSubdir` consumer; its `toHaveText([WORKSPACE_LABEL])` proves a promoted seed with a subdir
  renders exactly one `.channel-list__workspace-label`, which is this spec's pre-read locator.
- `e2e/real-daemon-workspace.spec.ts` → the whole spec — records the standing real-tier divergence: no
  outbound frame can be captured, the daemon being a separate process, so every assertion is DOM-facing.
- `e2e/sidebar-workspace-edit.spec.ts` → the whole drive — #1180's fake twin; the gesture sequence
  (pen → dialog → `.edit-workspace__input` → `.edit-workspace__save`) this spec reuses, and the
  negative-sweep idiom over `allTextContents()`.
- `e2e/workspace-updated-relist.spec.ts` → its step-1 comment — the ruling that an opening
  `toHaveCount(0)` settles before the sidebar renders and proves nothing; the pre-read must be positive.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions.seedCwdSubdir` (its `[A-Za-z0-9._-]+` guard bounds
  the constant this spec picks), `seedRegistry` (the seed carries no label field, so the daemon holds
  none), `SpawnedDaemon` — and the skip gate, which is AC3's cleanly-skips half.
- `playwright.config.ts` → `testMatch` / `testIgnore` — the filename `real-` prefix is what keeps this
  spec out of the default tier; AC3's third clause is satisfied by the name alone.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` → `requestRenameWorkspace` — **the trap
  this spec is designed around**: `label` is sent as `null` when the trimmed name equals
  `workspaceLabelFor(cwd)`, i.e. the folder segment.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `workspaceLabelFor`, `groupByWorkspace`
  — the label falls back to the `cwd`'s last segment when the daemon holds no `workspace_label`, which
  is what the pre-read will read on a fresh registry.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary` — `requireStringOrNull` on
  `workspace_label` fails closed on an absent key, which is failure signature A below.
- `docs/knowledge/features/edit-workspace-dialog.md` § How it works / § Edge cases — the `label: null`
  rule, the pen's withhold-by-key, and "no rejection is surfaced" (why a daemon refusal presents as a
  timeout here and not as a message).
- `docs/knowledge/features/conversation-workspace-change.md` § Workspace rename — the wire contract, and
  the fact that the reply is a `workspace_updated` **correlated to the requester**, so the sending
  client re-lists without depending on a broadcast reaching itself.
- `docs/knowledge/features/live-e2e-runbook.md` § Automated coverage — the PR-body obligation when a
  `real-*` spec is added.

## Design source

The ticket body carries no `## Figma` section, and correctly so: this ticket adds an e2e spec and
changes no rendered pixel. The surface it drives is #1180's, whose own dialog has no Figma node either
(verified 2026-09-08 and recorded in `edit-workspace-dialog.md` § How it works). Nothing here for a
visual-fidelity check to read.

## Context

The credential-light real-daemon tier (#439) exists to catch one class of gap: the daemon defines the
type, the payload and the registry op but registers **no handler**, so the real wire answers
`unsupported` while the whole fake suite stays green — pyrycode/pyrycode#949, `promote_conversation`.
`rename_workspace` (pyrycode#2158 / pyrycode#2208) is a new daemon verb whose client half shipped in
#1289 against a fake alone. Nothing has yet asked a real `pyry` whether it registers a handler for it.
Workspace rename is a pure registry op daemon-side and never touches claude, so it proves against a real
daemon deterministically and cheaply — #1283's shape one verb over.

No ADR is warranted; this adds no decision, only coverage.

## Design

One `test`, one launch, one continuous drive, mirroring the two worked examples.

**Fixture declaration** — all three named explicitly, never left to a default (the #1259 lesson: a
`test.use` omission is silent and nothing type-checks `e2e/`):

```ts
test.use({ spawnClaude: false, seedPromoted: true, seedCwdSubdir: SEED_FOLDER })
```

- `spawnClaude: false` — the credential-light tier; rename runs no claude turn.
- `seedPromoted: true` — the Channels tree draws a workspace head row, and therefore a pen, only for a
  workspace holding a promoted conversation. `real-daemon-workspace.spec.ts` runs `false` and renders no
  Channels group at all, so copying that one leaves nothing to hover.
- `seedCwdSubdir` — moves the seed below the daemon's own `-pyry-workdir`, so the pre-read is a
  spec-owned constant rather than the fixture-internal workdir basename `work`.

**`requiredCapabilities` is deliberately NOT declared.** The gate reads the hello-ack intersection and
this client advertises exactly one capability string; a workspace capability the daemon does not know
would turn the genuine red this spec exists to produce into a permanent skip. A missing handler must
red here.

**Constants** (all client-owned; none is read off the thing under test):

| Constant | Value shape | Role |
|---|---|---|
| `SEED_FOLDER` | a single plain segment, not `work` | the `seedCwdSubdir`, and therefore the label the row reads **before** the save |
| `NEW_LABEL` | a human label, no substring shared with `SEED_FOLDER` | what the drive types |
| `DAEMON_WORKDIR_LABEL` | `'work'` | never asserted present; names what a mis-seeded run would read |

**⭐ The non-vacuity mechanism, and the trap it must clear.** `requestRenameWorkspace` sends
`label: null` — the daemon's *clear this label* value — exactly when the trimmed name equals
`workspaceLabelFor(cwd)`, the **folder segment**. On a fresh registry the daemon holds no
`workspace_label`, so the row's pre-save label *is* that folder segment. A `NEW_LABEL` equal to
`SEED_FOLDER` would therefore send a clear, the row would fall back to the same folder segment, and the
drive would prove nothing while looking like it ran. The spec pins the two apart with a plain
`expect(NEW_LABEL).not.toBe(SEED_FOLDER)` beside the pre-read, so the premise is asserted rather than
assumed — the shape `real-daemon-create-channel.spec.ts` uses for its own `DAEMON_DEFAULT_LABEL` guard.

**Drive and assertion order.** Every absence or unchanged-state read sits after a positive,
auto-waiting read of the same gesture's own effect.

1. Pair from an unpaired launch with the daemon's `pairFields` and the test relay's `/v1/client` leg.
2. **Readiness gate** — `.channel-list__rename` visible under `HANDSHAKE_TIMEOUT_MS`. The promoted
   seed's Rename pencil renders only after handshake → `connected` → the auto-fired
   `list_conversations` returned the seeded row → it rendered under Channels.
3. **The pre-read (AC2's "before"), positive and auto-waiting**: `.channel-list__workspace-label` reads
   `[SEED_FOLDER]` — the array form pins the group count at one too. Never an opening absence.
4. Exactly one pen (`getByRole('button', { name: 'Edit workspace' })`) — a promoted-only list gives the
   Chats tree no group and therefore no second pen. Click it; the dialog becomes visible.
5. **The second pre-read**: `.edit-workspace__input` holds `SEED_FOLDER`, proving the dialog opened on
   the workspace the pre-read measured.
6. Fill `NEW_LABEL`, assert `.edit-workspace__save` enabled (so a click cannot land on a disabled button
   and time out opaquely), click.
7. **The closing positive read (AC2), under `ROUNDTRIP_TIMEOUT_MS`**: the labels read `[NEW_LABEL]`.
8. The negative half stated explicitly — a sweep of `allTextContents()` asserting no label reads
   `SEED_FOLDER` or `DAEMON_WORKDIR_LABEL`. Redundant against the array-equality above and kept anyway,
   as both fake-tier siblings keep it: it is the assertion that names the failure.
9. The dialog is gone. Ordered last: it closes synchronously in the Save handler, so it is
   round-trip-blind and proves nothing about the daemon on its own.

**No `.edit-workspace__path` assertion**, unlike the fake twin, and that is a hygiene decision rather
than an omission — see § Error handling.

**Timeouts** — the sibling values, unchanged: `HANDSHAKE_TIMEOUT_MS` 45s (readiness gate only),
`ROUNDTRIP_TIMEOUT_MS` 15s (the real-wire rename round trip), `SPEC_TIMEOUT_MS` 120s.

## State + concurrency model

None of this spec's own. It adds no store, no async task and no listener; the fixture chain
`relay → daemon → page` already forces LIFO teardown and reaps the daemon process group and both temp
dirs on every exit path, success and failure alike. The one round trip is awaited by Playwright's own
auto-waiting assertion, never by a hand-rolled poll or a `sleep`.

## Error handling

**Two failure signatures, and the spec's header must keep them apart:**

- **A — a stale `pyry`** predating pyrycode#2208 omits `workspace_label` from its list reply.
  `requireStringOrNull` in `parseConversationSummary` fails closed, the whole list decode throws, and
  **nothing renders**: the readiness gate at step 2 times out on an empty sidebar. Fix: rebuild `pyry`
  (the runbook's `PYRY_BIN` note).
- **B — a daemon with the field but no `rename_workspace` handler** renders the sidebar normally and
  the label simply never changes: step 7 times out with the label still reading `SEED_FOLDER`. This is
  the #949-class gap the spec exists for; file it, never soften the assertion or lengthen the timeout.

A daemon that *rejects* the rename (`workspace.not_found`, `protocol.malformed`) presents exactly as B,
because this verb is fire-and-forget and the client surfaces no rejection — `edit-workspace-dialog.md`
§ Edge cases records that. The header says so, so a red is not misdiagnosed as a missing handler.

**Diagnostic hygiene.** The seed's `cwd` is an absolute path under a temp `daemonHome`. Declining the
path-line assertion the fake twin makes keeps that path out of every failure diff: the worst any
assertion here can print is a directory **basename** (`workspaceLabelFor` takes the last segment), which
is `real-daemon-create-channel.spec.ts`'s stated posture. No locator used inside the dialog can
strict-violate onto `.edit-workspace__path` either — both are single-element class selectors.

## Testing strategy

The file *is* the test. It runs only under `npm run e2e:real-claude` / `npm run e2e:real:gate` (the
real config's `real-*` testMatch) and is excluded from the default `npm run e2e` by the same filename
rule — a structural property of the name, not a tag that can be forgotten. It skips cleanly when `pyry`
is unavailable, through the daemon fixture's own gate. Nothing in this repo type-checks `e2e/`, so the
new file gets an ad-hoc `tsc --noEmit` in Phase B on top of `npm run build`.

The tier grows from 17 `real-*.spec.ts` files to 18. `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a
dispatcher variable outside this repo, so the bump is the operator's — said in the PR body, per the
runbook's § Automated coverage. Not a docs deliverable here.

## Open questions

- **OQ-1: does the daemon's `rename_workspace` accept a `path` naming a subdirectory of its own
  workdir?** Expected yes — the lookup is exact equality against a stored conversation's `cwd`, and the
  seed's `cwd` is exactly that string. If it does not, the run reddens as signature B and the finding is
  a daemon-side ticket, which is this spec's purpose.
- **OQ-2: fixed literal or per-run nonce for `NEW_LABEL`?** Taking the fixed literal, on
  `real-daemon-create-channel.spec.ts`'s reasoning: each run gets a fresh `daemonHome` and therefore a
  fresh registry, so there is nothing to collide with, and a fixed value reads better in a failure diff.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the decision that makes it so: every expected value in this
  spec is a **client-owned constant**, never a daemon string read into an assertion. That is a
  deliberate divergence from `real-daemon-rename.spec.ts`, which captures `oldTitle` off the DOM before
  asserting it is gone. A constant is available here because `seedCwdSubdir` fixes the folder segment
  and a fresh registry holds no `workspace_label`, so there is nothing daemon-asserted to capture.
  `SEED_FOLDER` is itself bounded before it can name a directory, by `realDaemon.ts`'s
  `^[A-Za-z0-9._-]+$` guard, which runs ahead of any resource creation.
- **[Tokens, secrets, credentials]** No findings, contingent on one rule carried into Phase B:
  `pairFromUnpairedLaunch`'s invariant 2 — the payload is filled and referenced nowhere else. It must
  never reach a `test.step` title, an assertion message, or a `toHaveValue`. `daemon.pairFields` is
  destructured once, into `encodePairingPayload`, and `daemon.workdir` is **not read at all**: reading
  it would put an absolute temp path into a spec variable a diff could print.
- **[File / storage operations]** No findings. The spec performs no filesystem I/O and resolves no
  path. The only path-shaped value it supplies is `seedCwdSubdir`, guarded above. The seed's `cwd`
  never enters the spec's vocabulary, since the drive declines the path-line read — so there is no
  local resolution of daemon-asserted text anywhere in it.
- **[Inter-process / Electron attack surface]** No findings; the inherited posture is named rather than
  silently ridden. `withIsolatedElectronApp` sets `PYRY_ALLOW_LOOPBACK_RELAY` and
  `PYRY_TEST_SECRET_BACKEND`, both `app.isPackaged`-gated dev affordances that a packaged build never
  reads. This ticket adds no IPC channel, no `contextBridge` surface and no `webPreferences`.
- **[Cryptographic primitives]** No findings. Nothing is added; the real
  `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake is exercised end to end, which is the tier's purpose.
  The spec contains **no RNG at all** — OQ-2 takes a fixed literal over a `Date.now()` nonce, so there
  is no randomness to get wrong.
- **[Network & I/O]** No findings. A loopback `ws://` dial to the in-process fake relay, on #97's gated
  affordance. Timeout discipline is explicit and layered — 45s readiness, 15s round trip, 120s
  whole-spec under the config's 300s — so a daemon that never answers reddens on a bounded clock
  instead of pinning the worker open.
- **[Error messages, logs, telemetry]** The category with the real content here, two decisions:
  (a) the fake twin asserts `.edit-workspace__path` renders the workspace `cwd`; this spec **declines
  that assertion**, because on the real tier that `cwd` is an absolute path under a temp `daemonHome`
  and a mismatch diff would print it whole. The most any assertion here can print is a directory
  basename. (b) Verified rather than assumed: `playwright.real-claude.config.ts` enables **no
  screenshot, trace or video** — its own comment says a trace could capture more than DOM text — so a
  failure yields text diffs only, with no window capture of the one surface that renders the full path.
  The residual bound, stated: `toHaveValue` on `.edit-workspace__input` prints whatever the field
  holds, which is by construction the group's label (the daemon's `workspace_label`, or the folder
  segment) — never a token, key or transcript. No `console.*` and no `testInfo.attach` anywhere.
- **[Concurrency]** No findings. The spec owns no async task, timer or listener; the
  `relay → daemon → page` fixture chain reaps the daemon process group and both temp dirs on every exit
  path, skip included. The single round trip is awaited by an auto-waiting assertion, never a
  hand-rolled poll or a `sleep`.
- **[Threat model alignment]** Hostile-daemon-response is the live threat, and it is **deliberately
  unmitigated in one direction**: letting a daemon that lacks the handler redden is the entire point of
  the spec. What is bounded is the blast radius — a hostile or broken daemon can fail the run but
  cannot get its own strings into the output beyond a label-sized basename, and cannot make the client
  resolve a path it returns (`workspaceLabelFor` is string work only, and this drive reads no path).
  OUT OF SCOPE: the daemon-side authorization model for `rename_workspace` (whether any paired device
  may relabel any workspace) — that is pyrycode#2158's own surface, not this client's, and no desktop
  ticket picks it up.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
</content>
</invoke>
