# Explicit host repair (#1354)

## Files read

- `src/renderer/src/PairedShell.tsx` — `automaticRecoveryTarget`, `PairedShell`, `PairedShellView`, `openRecovery`, `leaveRecovery`, `onPairServerPaired`: automatic entry is separable from manual navigation and completion lifetime guards.
- `src/renderer/src/pairingRecovery.test.tsx` — automatic selection tests become obsolete; `HostRow`, `daemonLeg` and recovery markup assertions remain relevant.
- `e2e/pairing-recovery.spec.ts` — startup, last-host failure, pending-host status and delayed-confirmation interactions provide the existing proof surface.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`, `seedConversationsFrame`: real IPC/Noise over isolated fake hosts, including initial pairing and a second saved host.
- `src/renderer/src/screens/pairing/PairingScreen.tsx` — `PairingScreen` invokes the captured completion callback after confirmation; parent lifetime fencing must remain.
- `docs/knowledge/features/paired-shell.md` and `paired-shell-routing.md` § “Host recovery and navigation lifetime” — origin-aware cancellation, retained state and generation checks.
- `docs/knowledge/features/channel-list-host-row.md` § “The host row” and `session-store.md` § “One slot per server” — preserve failure styling, per-host accessible status and classified rejection notice.
- `docs/knowledge/features/development-verification.md` § “Evidence that cannot pass too early” — await a positive delivery/completion barrier before asserting absent navigation.
- `CLAUDE.md`, `package.json`, `playwright.config.ts` — file/process boundaries and scoped test/build commands.

Codegraph reported an uninitialized index; source reads and text search confirmed that the removed helper has only its in-file effect and unit test as consumers.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=486-1068 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966

Read both design contexts and screenshots. The sidebar is a column of host/workspace/channel trees with compact title/body typography; the failed host has an error-colored label and server icon, a primary-colored plug repair button and two trailing status dots. Preserve the existing `ChannelList`/`HostRow` tokens, assets and dark atmospheric background; this change adds no visual surface.

## Change

Remove `automaticRecoveryTarget`, its status-driven opening effect, `recoveryConsumed` and their now-unused type imports from `PairedShell`. Connection changes continue updating status presentation but cannot initiate repair or change routes. Keep `openRecovery` as the explicit sidebar/composer entry, with its saved-host check, captured return route, same-host no-op and content-free `opened` diagnostic. Keep cancellation and `pairingGeneration` invalidation on navigation/unmount, saved-host refresh and guarded completion navigation unchanged. Normal retries, Pair new host, initial setup, stores, transport, credentials and styling do not change. Update the origin comment to describe only manual recovery.

This is one deliverable: user-controlled recovery navigation. Estimate approximately 220–250 written lines including test changes and this plan; one production file, two test files, no new exported types/components/stores, no consumer signature updates, two acceptance criteria and no new error/reject branches. The #1336 analogue added 553 lines across these surfaces; this ticket removes its automatic path. The refreshed remote feature-branch check found no overlap in the three planned files.

## Testing strategy

- RED: adapt the existing fake-transport spec first and run against unchanged production. Startup and last-host rejection must fail because repair opens without a click.
- Preserve static assertions for status labels, failed host styling, the named repair button and rejection notice beside the sidebar; delete the removed selector's test and unused fixtures.
- Prove startup rejection before any list keeps the empty list view and saved host, then keyboard repair, cancel and successful same-host confirmation work at 800×800.
- Prove last-connected-host rejection, repeated failures and reconnection followed by rejection preserve the current thread/list and held rows. Check retained draft/timeline, host count and rejection status after positive delivery barriers. Preserve healthy-host send/reply and composer repair/cancel.
- Adapt connecting/unreported-host cases so settling offline never navigates; explicitly open repair and cancel, then deliver another failure and verify the held thread persists.
- Retain delayed confirmation coverage for a newer thread and another host's recovery input, using saved-order refresh as the completion barrier.
- Run `npm test -- src/renderer/src/pairingRecovery.test.tsx`, `npm run build`, and the focused `e2e/pairing-recovery.spec.ts` through the approved Electron helper. Capture the existing manual form/confirmation and retained failed-host thread, inspect them against Figma, and record paths/viewports in the PR. Full suites belong to the verifier/dispatcher.

No new asynchronous work, store shape, cancellation path or error mode is introduced. No open questions remain.

## Documentation handoff

Pending for the documentation stage: “The documentation stage updates `docs/knowledge/features/paired-shell-routing.md` under ‘Host recovery and navigation lifetime’ to state that only explicit user actions open repair and connection events never reopen it. Align the existing automatic-recovery descriptions in `paired-shell.md`, `session-store.md` and `channel-list-host-row.md` in the same directory. Preserve manual recovery and stale-confirmation behavior; #1336 remains implementation history.”

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings: status-driven navigation is removed; `openRecovery` still restricts manual targets to saved server IDs. No IPC input or validation contract changes.
- [Tokens / storage / cryptography] No findings: this deletion neither generates nor persists credentials, changes crypto or adds a renderer storage sink. The existing `PairingScreen` confirmation flow and main-process secure persistence remain responsible for same-host replacement.
- [Electron attack surface] No findings: no new channel, window, external content or privilege. `PairedShellView` retains React text rendering and fixed rejection copy.
- [Network & I/O] No findings: no socket, retry, framing, timeout or relay policy changes; connection events only update existing presentation.
- [Errors / logs] No findings: remove the obsolete `automatic` diagnostic with the effect. Keep static `opened` and `cancelled` diagnostics; no payload, label, credential or daemon text is newly logged.
- [Concurrency] No findings: deleting outage-consumption state must not delete `pairingGeneration`. Preserve navigation/unmount invalidation and the generation comparison in `onPairServerPaired`; both stale-destination interactions exercise it.
- [Threat model] No findings: an on-path peer provoking repeated rejection loses the ability to open repair. Existing transport/disk/renderer security boundaries remain unchanged; no additional security behavior is deferred by this plan.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-12
