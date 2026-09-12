# Add workspace destination preview

## Files read

- `src/shared/wire/types.ts` — `HelloAckPayload` carries the host greeting.
- `src/main/transport/helloExchange.ts` and its test — `parseHelloAck` validates optional fields without echoing values.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` and its test — `AddWorkspaceDialog` owns the bounded, host-scoped creation wait.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `hostRowLabel` defines the stored-label/Server fallback; the dialog mounts keyed by selected host.
- `src/renderer/src/store/hostLabelStore.ts` — `selectHostLabelFor` supplies the selected host's label.
- `src/renderer/src/store/sessionStore.ts` — `selectStatusFor` carries each connected host's ack.
- `src/renderer/src/store/conversationCreatedBridge.ts` — `requestNewWorkspaceChat` sends unnamed, unpromoted creates.
- `src/renderer/src/components/Modal.tsx` and `modal.css` — `Modal` supplies accessible header, close, footer and viewport scrolling.
- `src/renderer/src/screens/channels/channels.css` — existing Add workspace overlay and Edit host token mappings.
- `e2e/sidebar-add-workspace.spec.ts`, `e2e/fixtures/launchPairedApp.ts` — held creates and two-host fake transport.
- `e2e/fixtures/realDaemon.ts`, `e2e/real-daemon-create-channel.spec.ts` — `SpawnedDaemon.workdir` gives a fixture-owned filesystem root; claude-less creation pattern.
- `docs/knowledge/features/add-workspace-dialog.md` — preserve lifecycle and prove navigation by active row, not composer count.
- `docs/knowledge/features/modal-presentation.md` and `development-verification.md` — built-app icon and constrained scrolling evidence.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2110

Shared presentation: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

Read design context and visual reference: a blue modal with divided header and circular close icon, stacked Host, folder input and inline Absolute path preview rows, and centred Cancel/OK actions. Use the shared Modal at the reference's 640px panel width, label-large emphasized and body-medium tokens, a 41% input fill and the preview's full-opacity text on the panel; omit optional naming. Wrap long read-only text and scroll the panel at constrained heights.

## Context and scope

One deliverable: resolve and preview the selected host's destination before creating its workspace chat. Estimated 500–650 written lines including plan, tests and CSS; three production TypeScript files plus stylesheet, at most one new exported helper, no required existing consumer cascade, four AC and no added lifecycle rejection branches. The optional greeting property leaves existing constructors compatible. The analogue `bb4bbf8` changed 295 added/385 deleted lines plus its prior plan. Remote feature overlap check found none. Codegraph was uninitialized; repository reads and text search supplied context.

## Design

Add optional `workspace_root?: string` to `HelloAckPayload`; `parseHelloAck` uses the existing string validator only when the property is present. Absence stays absent; present non-string values throw `WireDecodeError` with static copy.

Keep a pure path resolver beside the dialog. Trim only the input's outside whitespace. Empty returns empty; a leading slash returns that input; otherwise require a base beginning with slash, remove its trailing slash run and append slash plus input. Do not trim or canonicalize the base, expand tilde or collapse dot segments. Missing/non-absolute bases yield no destination and fixed unavailable-location feedback for nonblank relative input.

The container selects only this server's status and host label. Its label uses the host row's stored nonblank label or `Server` fallback. The view derives preview and eligibility from the resolver; submission uses the same resolved value and synchronously rechecks selected-host connection and base before dispatch. If the greeting changed before a render, decline submission until the displayed destination catches up, preventing preview/send disagreement.

Adopt Modal inside the existing overlay; keep its scrim inert and add no Escape dismissal. Cancel and close share dismissal. The input stays autofocus and disabled while pending. Read-only label and preview are escaped text, never text-derived attributes; preview is a labelled live output. No optional name and no extra directory operation.

## State + concurrency model

Keep `AddWorkspaceStatus`, synchronous pending/closed refs, selected-host subscriptions and the 30-second timer. Settlement, cancel and unmount keep their cleanup. Connection loss enables editing with existing feedback. Reconnect never sends. Retry remains explicit and same-host result correlation remains unchanged. No new async task, store or IPC channel.

## Error handling

Preserve static disconnected, rejected and uncertain-timeout copy and content-free lifecycle diagnostics. Relative input without an absolute base adds local admission feedback; it never reaches a filesystem. The daemon owns remote restrictions and normalisation; absolute input remains usable on older hosts.

## Testing strategy

- RED first: decoder tests for optional string, absent compatibility and present non-string rejection; renderer tests for slash joins, blanks, unusable bases, escaping and modal controls.
- Fake browser spec retains all existing lifecycle drives while adopting modal locators. Add two different greeting bases, preview/send payload equality, omitted-base fallback, keyboard dismissal/retained Escape/backdrop policy, pending close, long text and normal/800px short-window captures.
- New real-daemon spec uses `spawnClaude: false`. Choose an absent nested path under fixture-owned `daemon.workdir`, assert parent/destination absence, submit through the dialog, observe new active chat and authoritative workspace, then stat both directories. Repeat against the same path and prove a second chat and reused directory identity.
- Builder runs focused unit tests, build and the changed fake browser spec. Dispatcher owns real spec execution with the dedicated daemon containing pyrycode#2378, recorded daemon revision/result and gate-floor adjustment for one added test. Skips are not acceptance.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/add-workspace-dialog.md` under “Connection and folder admission” and “Rendering and testing” with remote-base resolution, older-host fallback and the missing-folder proof. Record added real-tier coverage in `docs/knowledge/features/live-e2e-runbook.md` under “Current real-claude gate state”.

## Open questions

None. The design context has no reduced opacity on the preview row; retain its full-opacity text.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseHelloAck` validates type; the path remains untrusted remote display/command data. `selectStatusFor(serverId)` prevents another host supplying the base.
- Tokens: no generation, storage, credential or key changes; no new persistent data.
- File/storage operations: production does no local filesystem operation. Dot segments intentionally remain daemon-owned under the ticket contract. Test filesystem reads use only the test's fixture-owned path, never a daemon-reported path.
- Electron attack surface: reuse Modal's shipped close asset and existing typed create IPC; no new channels, remote renderer assets, navigation or BrowserWindow changes. Preview renders text, not markup or a value-derived attribute.
- Cryptography: unchanged Noise implementation and main-only transport; no nonce/key/RNG changes.
- Network/I/O: existing bounded envelope decoding and authenticated handshake remain authoritative. No new network request class or endpoint.
- Errors/logging: static validator and UI copy only; existing diagnostics contain lifecycle codes, never folder/base/label values.
- Concurrency: retain cleanup and synchronous guards; recheck the current greeting against the displayed resolution immediately before send. Cancel ends local waiting, not daemon execution.
- Threat model: hostile greeting values cannot execute markup or access local files; malformed field types fail closed. Relay delays remain bounded by the existing local deadline. Token-at-rest and renderer isolation mechanisms are unchanged and outside this change's surface.

**Reviewer:** builder, self-review per `builder/security-review.md`
**Date:** 2026-09-12
