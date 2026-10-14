# Live Codex channel proof (#1809)

## Files read

- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions`, `test`, `resolveOnPath`, `reapDaemon`: existing opt-in gates, spawn and cleanup ownership.
- `e2e/fixtures/realDaemon.test.ts` → registered daemon fixture seam: fake process/socket boundaries with real temporary filesystem resources.
- `e2e/real-claude-effort-default.spec.ts` → `observe`, `turn`: acknowledged settings, genuine published models and nonempty completed turns.
- `e2e/sidebar-create-channel.spec.ts` → picker scenarios: dialog, host targeting, selection and confirmation selectors.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialog`: host-local cache and create fields.
- `docs/knowledge/features/create-channel-dialog.md` → model cache and compatible remembered effort travel in create; opening the dialog requests no models.
- `docs/knowledge/features/live-e2e-runbook.md` → Current real-claude gate state: suite totals cannot establish named Luna acceptance.
- `docs/knowledge/features/development-verification.md` → Live-test diagnosis: record executable identity; dispatcher owns live acceptance.
- `internal/e2e/realclaude/codex_conversation_live_test.go` in daemon repo → `requireCodexCapture`, `startCodexConversationHarness`: empty version-probe home, persistent dedicated sign-in linked to daemon instance.

## Design source

Figma: [closed choice](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=578-3014), [open list](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=578-3197), [shared modal](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942).
Preserve the reviewed #1658 implementation: `ChannelForm` model field between name and prompt, flat dropdown, shared `Modal` and existing colour/type/spacing tokens. No new visual implementation.

## Context

A real Luna reply must prove channel model selection and inherited Low effort through the app. Main lacked the picker, and the existing fixture never provisioned the daemon's Codex home.
Normally merged preserved `feature/1658` at `22775f0901d19e606e3055eb365d19d783c56335`, including documentation, into `feature/1809`; retain current-main fixes and the original worktree. This explicitly requested history import is the only documentation change in this builder stage. No reverse blocker on #1658.
Overlaps: #1364 changes Electron relaunch; #1544 changes Claude stdio prompt arguments; both are separate blocks from the additive Codex fixture option. #1658 history is imported, not a dependency wait.
Sizing: one deliverable, about 650–700 newly written lines including this plan, no new exported declarations, one option consumer, five observable acceptance criteria, fewer than ten reject branches. Imported history is not newly written work. No ADR needed.

## Design

Add `codexCapture: boolean`, default false, to `RealDaemonOptions` and the registered fixture. Only true invokes local `requireCodexCapture(testInfo)` returning the selected PATH executable and canonical dedicated directory.
Resolve the operator home before fixture HOME isolation. Reject equal/descendant paths under either `~/.codex` or `~/.pyry`, comparing lexical locations and canonical locations, including symlinks in supplied paths and protected roots. Canonicalize existing ancestors when a protected root is missing. Validate before binary probing, Claude credential reads or daemon use. Never inspect sign-in contents.
Unset `PYRY_CODEX_CAPTURE_HOME`, missing/non-directory capture home, absent executable or version below 0.156.1 skip with fixed identifying reasons. Unexpected path/probe errors fail with content-free diagnostics. Probe `codex --version` with an empty fixture-owned `CODEX_HOME` and bounded subprocess lifetime; accept supported stable versions and later versions, reject prerelease of the minimum release. Delete that home in `finally`.
After seeding the instance, link the canonical directory at `<daemonHome>/.pyry/test/codex-home`, then add `-pyry-codex=<selected executable>` before pass-through Claude arguments. Never copy files. Non-opt-in gates, environments and arguments stay unchanged.
Add `e2e/real-claude-codex-channel.spec.ts` with scenario-only observation helpers. Use real Claude bootstrap on Opus and `seedPromoted: false`. Confirm Low by a settings acknowledgement plus fresh settings read. Poll fresh model-list requests for the seeded conversation until its target host publishes a Codex Luna row; fail within a bounded deadline. Select that published row in Create channel, confirm, then inspect the new conversation's settings and footer before its first message. Do not write model/effort settings on the new channel.
Assert completed nonempty assistant output correlated to the new conversation, with the published display name in the footer before send and after completion, never Default. Attach `daemon-revision` and published row evidence. No injected state or direct-wire creation.

## State + concurrency model

No new application state. Fixture owns probe home/process and daemon home/process group; all teardown awaits process termination before removing fixture paths. Persistent capture-home ownership remains with the operator, who serializes use across Desktop and daemon live runs. Recursive cleanup removes the symlink without following its target.
Observer lifetime is one isolated Electron page; closing it destroys subscriptions. Polling is sequential, bounded and targets the seeded conversation on its paired host. No shared harness or cross-spec mutable state.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Default/non-opt-in fixture invocation | unit: unchanged non-opt-in behavior |
| Opt-in missing prerequisite | unit: unset, missing home, absent/old Codex |
| Protected location, descendant or symlink alias | unit: protected locations and aliases rejected before probing |
| Version probe and supported minimum | unit: isolated version probing; minimum supported version |
| Link before daemon spawn | unit: permitted dedicated home and link-before-spawn |
| Successful use then teardown | unit: target preserved during successful cleanup |
| Setup failure after link/spawn | unit: target preserved during failed setup cleanup |
| Repeated real model-list reply during async publication | live: real GPT-6 Luna channel replies with Low effort from creation |
| Seeded chat → distinct new channel → first turn | same live scenario: channel identity, acknowledged Low, footer and completion |

## Error handling

Unsafe home is a failure even when other prerequisites are absent. Prerequisite skips name only static variable/tool/version requirements. Version subprocess output, launch errors and credential paths never enter reports. Normal daemon readiness/pairing failure semantics stay intact; setup failure still unwinds owned resources.

## Testing strategy

- Test first through the registered fixture with fake executable/process/socket boundaries and temporary test-owned directory trees; no live sign-in.
- Cover unset/missing capture home, absent/old/minimum Codex, protected equal/descendant locations, supplied-path and protected-root symlink aliases, permitted home, isolated probe, link order, unchanged opt-out, and successful/failed setup preservation.
- Run scoped fixture tests, imported picker unit tests, pre-verify and build after final main merge; run `e2e/sidebar-create-channel.spec.ts` fake-transport coverage and capture closed/open picker states.
- Collect the new live scenario; dispatcher owns its execution and full real-* gate per AC5. Required report: scenario collected/executed/passed, attachments and branch/main identities. Missing prerequisites or skip is pending evidence, never a pass.

## Open Questions

None. Dedicated credentials are operator-provisioned; builder neither fetches nor copies them. Live acceptance belongs to the dispatcher.

## Documentation handoff

Pending documentation stage:
- `docs/knowledge/features/live-e2e-runbook.md`, Prerequisites and Automated coverage: dedicated-home setup; new spec and portable `npx playwright test --config playwright.real-claude.config.ts e2e/real-claude-codex-channel.spec.ts --reporter=json`; skip/failure meanings; serialize this sign-in across Desktop and daemon capture/live tests; daemon may update config; credentials linked, never copied; runner `~/.codex` and production `~/.pyry` forbidden.
- Same path, Current real-claude gate state: record only supplied named execution evidence, daemon identity and combined delivery revisions.
- After landing, supply named Luna result and daemon identity to #1658 documentation/PR #1720 handoff; preserve `22775f09` and refresh stale missing-coverage/evidence statements in `docs/knowledge/features/create-channel-dialog.md`. Later stages own reconciliation.

## Security review

**Verdict:** PASS

- [Trust boundaries] Environment paths enter only `requireCodexCapture`; lexical and canonical protected-root checks precede all credential-home/daemon use. Real model events remain parsed by existing main transport.
- [Tokens, secrets, credentials] Dedicated sign-in is linked, never copied/read/logged. Empty isolated version home prevents probe access to operator credentials. Operator owns provisioning and serialized use.
- [File/storage] Canonicalize target and protected roots including existing ancestor aliases; reject protected descendants before use. Probe and daemon cleanup targets come only from fixture `mkdtemp`; recursive removal does not follow the link. Operator-controlled directory must remain stable during the run; defending against a hostile same-user filesystem mutator is outside this fixture's trust model.
- [Electron] No new IPC or window settings; imported reviewed picker retains existing escaped text and main-only transport boundary.
- [Cryptography] No new primitives, tokens or keys; existing Noise and app credential storage unchanged.
- [Network/I/O] Probe, model publication and turn deadlines are bounded; existing local relay/Noise fixture retained.
- [Errors/logs] Fixed errors discard subprocess diagnostics and paths. Attach only daemon revision and public model rows, never sign-in files, tokens or environment.
- [Concurrency] Probe and daemon are awaited/reaped before cleanup; persistent target is never removed. Operator serializes shared sign-in use; no parallel scenario using it is added.
- [Threat alignment] Relay and hostile response parsing inherit main transport isolation. Renderer gains no credentials. Protection here prevents accidentally using production homes or copying single-use renewal keys; same-user credential theft and new protocol defenses are outside this ticket, with existing daemon/app ownership unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-11
