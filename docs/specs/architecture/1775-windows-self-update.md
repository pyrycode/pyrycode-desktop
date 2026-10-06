# Windows self-update

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries, test tiers and evidence.
- `docs/knowledge/features/windows-packaging.md`, `electron-builder.yml`, `package.json`, `electron.vite.config.ts`: packaged GitHub feed, unsigned NSIS, production dependency inclusion and unchanged Windows user-data directory.
- `docs/knowledge/features/channel-list.md`, `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelListView`, `channels.css` → `.channel-list__tree`: fixed sidebar and scrolling seam.
- `src/renderer/src/screens/conversation/conversation.css` → `.button-small`, notification actions: shared small-button typography and text-action treatment.
- `docs/knowledge/features/chat-history.md`, `src/main/index.ts` → `flushHistory`, quit/close handlers: renderer acknowledgement then queued-operation drain.
- `src/main/diagnosticLog.ts` → `DiagnosticLog`, `docs/knowledge/features/diagnostic-log.md`: static diagnostics only.
- `src/preload/index.ts` → `api`, `src/preload/reconnectServer.test.ts`: fixed-channel narrow bridge and injected Electron tests.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `e2e/pairing-authentication.spec.ts`: fake-transport launch and main-process IPC injection without production test switches.
- `builder/security-review.md`, `builder/ui-work.md`, `docs/visual-review.md` in the agents repository: security audit and design evidence requirements.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=806-11062
Read section screenshot, high-fidelity states `806:11624` and notes `806:11658`. Pinned row follows the tree, within the existing 20px sidebar inset: separator, 12px gap, 20px edgeless Update asset, 8px icon/text gap, body-medium title, body-small caption and 4px text gaps. Ready uses the shared small-button typography with Secondary outline; Later/Dismiss use label-medium text actions. Theme roles are on-surface, on-surface-variant, primary, inverse-primary at 60% separator opacity, background and error for the failed caption only. No banner or fill.

## Context

One end-to-end deliverable: silently fetch the packaged Windows release and offer installation. #1774's merged feed is present on main. Unsigned installation trusts release publishers; sha512 verifies transfer integrity only. Surface installation and pairing continuity remain operator acceptance, not pipeline evidence.
Overlapping branches #1658 (channel CSS) and #1659 (main command routing) edit separate blocks; additions stay local.
Sizing: approximately 770 written lines including plan, source, config and tests; generated lockfile excluded. Five new exported types/components/stores, fewer than ten consumer updates, five observable acceptance groups and at most ten classified reject branches. The current #1604 comparison includes later merged work; its broad refactoring is not needed here.

## Design

- `src/shared/ipc/appUpdate.ts`: fixed state/query/action channels, `AppUpdateState` (`idle`, `ready` with `version: string | null`, `failed`) and `AppUpdateAction` (`restart`, `dismiss`). Reconstruct state with only these fields. Version accepts ASCII stable X.Y.Z only, no leading zeroes, maximum 64 characters.
- `src/main/appUpdate.ts`: `selectAppUpdateEligibility({isPackaged, platform})` checks unpackaged first. `createAppUpdateController` accepts a lazy updater factory, diagnostic logger and `beforeInstall(): Promise<void>`. Gated factory is never invoked in dev or on other platforms. Minimal exported updater port supports configuration, three events, check result/download promise and install.
- Main uses a lazy `electron-updater` runtime dependency compatible with electron-builder 26. No feed override, credentials, notification call or development updater configuration. Disable its logger before checking; enable autoDownload and autoInstallOnAppQuit, disable web installers.
- Controller owns current state and subscriptions. Only `update-downloaded` during downloading marks verified/ready. Available starts downloading; error events and rejected check/download promises classify by phase. Terminal transitions are idempotent.
- `registerAppUpdate` binds snapshot and commands to the controller, validates command literals and trusted current-window main-frame senders, and broadcasts only projected state. Main unregisters on will-quit.
- Preload subscribes before requesting the snapshot. Each subscription ignores its snapshot after any newer event and after cleanup, and projects all state before delivery. It exposes only `onAppUpdate` and `sendAppUpdateAction`.
- `src/renderer/src/store/appUpdateStore.ts` holds the app-wide state. ChannelList's effect binds the bridge with cleanup; its view receives an optional row slot outside the tree. `AppUpdateRow` renders state and sends discriminated actions, independent of host state.

## State + concurrency model

Main owns one controller per process. Internal phase is checking/downloading/ready/failed; dismissed remains latched for the launch, without clearing verified installation eligibility or autoInstallOnAppQuit. Duplicate failure/download events cannot revive a dismissed row. One start/check and one restart are allowed. Restart awaits a shared quit-drain promise before installation; normal quit awaits that same drain. Registry stops before flush; drained windows bypass their close blockers before updater installation. Controller disposal cancels the check result's pending download token and removes its listeners/subscribers; late completions cannot publish. Renderer remount fetches main's latest dismissed/current state.

## Error handling

Check/offline errors log static check-failed and remain idle. Download/integrity errors log static download-failed and show failed once. Startup construction failure stays idle with static startup-failed. Malformed/untrusted IPC commands and unverified restart are inert with static refusal diagnostics. Drain/install exceptions become static install-failed with no raw exception crossing IPC. Snapshot bridge rejection remains invisible. No errors, URLs, paths, notes, installer names or feed metadata reach logs or renderer state.

## Testing strategy

Test first with adjacent Vitest specs, faking updater events/promises and IPC. Cover false-first selector/property access and gated construction, once-only check, available silence, verified ready/version bounds, invisible check failures, both download rejection channels, dismissal/duplicates, fresh process, late subscription, teardown/cancellation and exactly-once install after delayed drain. Preload tests cover fixed channels, projection, late snapshot/event race and unsubscribe.
Static-render row tests pin copy, ready/failed/actions and idle absence. One fake-transport Playwright spec bundles the production controller into scratch, injects a fake updater at main's IPC seam, and uses the actual preload and mounted row for Restart now/Later/Dismiss, navigation/remount and pinned geometry. No production fake-updater switch or real download/installer. Capture ready/failed at 1280x800 and ready at 800x600 and compare with Figma. Final main merge, pre-verify and build; scoped e2e only (full tier belongs to dispatcher). No live specs changed.

## Open Questions

None. Figma notes mention showing failure after an unsuccessful previous install; the ticket's explicit acceptance contract defines per-process download/verification failure and invisible check failures, so no persistent install-outcome inference is added.

## Security review

**Verdict:** PASS

- [Trust boundaries] `createAppUpdateController` accepts only a library-verified downloaded event as install authority; `validateUpdateVersion` projects the single bounded feed text field. IPC never supplies feed metadata or installation paths.
- [Tokens] No new credentials, keys or storage; public packaged GitHub configuration is consumed in main. Existing paired hosts retain safeStorage and their user-data directory.
- [File/storage] Updater owns cache and installer verification; app code constructs no paths from metadata. No update data persisted by the renderer. Existing history drain remains ahead of installer execution.
- [Electron surface] Fixed snapshot/action channels only; exact command discriminants and current-window main-frame checks. No generic IPC/feed/installer API. Existing isolation, sandbox and navigation guards remain intact.
- [Cryptography] Library sha512 checks establish integrity, not publisher authenticity. Unsigned builds trust anyone who can publish this repository's releases; signing is outside this ticket's packaging contract.
- [Network/I/O] Packaged public GitHub feed uses library HTTPS defaults; no TLS bypass, custom credentials or renderer-controlled URL. Web installers disabled; library cancellation token is cancelled on disposal. One startup attempt, no retry loop.
- [Errors/logs] Library logger disabled before checking. Only static lifecycle/error codes logged, never versions, raw errors, release notes, URLs or paths. Both event and rejected promises are handled.
- [Concurrency] Single main owner; terminal transitions and restart latches reject duplicates. Subscribe-before-snapshot prevents stale startup overwrite. Shared drain is awaited before quitAndInstall, and shutdown cleans listeners/cancels pending download.
- [Threat alignment] Compromised release publisher can ship arbitrary code (accepted unsigned trust boundary). Malicious metadata cannot reach renderer sinks beyond validated version text. Compromised renderer can request only verified installation/dismissal. Relay/daemon/token threat protections are unchanged and owned by existing transport and secure-store features.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06
