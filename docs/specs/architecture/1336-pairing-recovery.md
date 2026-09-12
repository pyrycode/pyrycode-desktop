# #1336 — Retained hosts and pairing recovery

## Files read

- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `narrowDaemonErrorOutcome`: existing client-owned error classification boundary.
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `onDriverEvent`, `emitFailed`, `dial`: connection-local failure and generation ownership.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody`, `renderServerTrees`, `HostRowControl`, `HostConnectionDotsControl`: saved-host enumeration and independent connection legs.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`, `PairedShellView`: pairing origin, retained conversation activation and screen routing.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`, `ConnectionBannerControl`, `ComposerErrorSlotControl`, `daemonLeg`: singular status consumers and destructive repair handler.
- `src/renderer/src/store/sessionStore.ts` → `SessionState`, `selectStatusFor`: per-origin states preserve unreported versus disconnected.
- `src/renderer/src/screens/pairing/PairingScreen.tsx` → `PairingScreen`, `ReviewCard`: existing input and fingerprint confirmation.
- `src/main/pairingHandler.ts` → `registerPairingHandler`; `src/main/pairedServerStore.ts` → `createPairedServerStore`; `src/main/connectionRegistry.ts` → `createConnectionRegistry`: confirmation persists by server ID and reconciles only changed records.
- `src/main/secretBackend.ts` → `selectSecretEncryption`: test encryption is gated out of packaged builds.
- `src/renderer/src/screens/channels/channels.css`, `src/renderer/src/pairedShell.css`, `src/renderer/src/screens/pairing/pairing.css`: host control slots and narrow-pane layout.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `seedConversationsFrame`; `e2e/multi-server-launch.spec.ts`: real pairing with synthetic credentials and independently driven daemons.
- `docs/knowledge/features/channel-list.md` and `channel-list-host-row.md`: saved-host join direction, title tokens and independent relay/daemon dots.
- `docs/knowledge/features/paired-shell-routing.md` § origin-aware cancel: cancellation preserves the prior route and pane key.
- `docs/knowledge/features/session-store.md` § One slot per server: undefined status must not become a settled offline state for automatic decisions.
- `docs/knowledge/features/conversation-shell.md`, `development-verification.md`: static renders cannot prove effects, interaction or overflow; positive completion evidence must precede absence checks.

Codegraph context was unavailable (index not initialized); source reads supplied this map and the caller check.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=486-1068

The failed host retains its workspace subtree, with a red server glyph and title-small label, separate daemon and relay dots, and a primary-colored plug repair glyph immediately beside them. Keep existing row geometry, using error and primary theme tokens; the repair control is visible at rest and keyboard accessible.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966

Retain the Channels and Chats trees and existing compact host/workspace hierarchy inside the fixed sidebar.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2901

Reuse the existing filled pairing field, fingerprint confirmation, Pair/Confirm and Cancel controls. Recovery adapts that form to the main pane beside the sidebar; its hero inset shrinks and supporting copy wraps at the 800px window floor.

## Context and scope

An invalid saved credential can briefly connect and then fail; the following send/close errors overwrite the useful cause while a missing list hides the host. This is one recovery deliverable: classification supplies the host recovery flow, not an independently useful plumbing ticket. Chat restoration remains #1339.

Estimate: approximately 750 written lines including production, tests, CSS, asset and this plan. Five TypeScript production files, two stylesheets, no new exported type/component/store, ten simultaneous callback consumer updates, five acceptance criteria and fewer than ten decision branches. The nearest analogue #1303 added 843 lines; this plan keeps coverage focused. Remote feature branches were refreshed and the proposed files have no overlap.

## Design

- Add `pairing-rejected` to the existing decoded error outcome, solely for an exact decoded `auth.invalid_token` code. Raw daemon error text never crosses IPC or enters logs.
- `createDaemonConnection` latches rejection in its own closure. Its failure choke point emits a client-owned `pairing-rejected` code and exactly: “Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.” Subsequent generic failures retain it; a valid handshake clears it for that connection. The existing generation fence excludes replaced drivers.
- Render saved IDs against an empty view-only row list when conversations are null, without changing the store's null meaning. Thread an optional host recovery callback through the existing sidebar hierarchy. Failed rows render the repair glyph; rejected daemon dots have a distinct accessible label while relay state remains independently derived.
- The shell owns an optional recovery target server ID and the existing pairing return route. Manual sidebar and composer entries resolve a saved host, preserve held stores, and open the same `PairingScreen` in the pane. Other pairing entry routes retain existing behavior. Cancellation returns to the captured list/thread; successful confirm uses existing credential upsert/reconciliation and returns without clearing another host or held conversations.
- Replace the three thread-local singular status reads with a shared in-file hook resolving the open conversation's server from the saved conversation list, then selecting that server's status. Missing attribution is disconnected, never a fallback to another host. The composer repair handler delegates to shell navigation and no longer calls `runUnpair`; Settings keeps explicit removal.

## State + concurrency model

- Existing `SessionState.statuses`, restricted to `ServerInfoState.servers`, is connection truth. A pure shell decision helper reports healthy, waiting, or the first rejected host in saved order. Any connected host is healthy; any unreported/connecting host defers opening; settled offline/generic failures alone do nothing.
- A shell-local outage latch permits one automatic opening. Cancellation or navigation away consumes it for that outage. A connected saved host resets the latch; later loss of the last usable host may open recovery again. Manual repair remains available regardless of suppression.
- The shell subscribes through Zustand and an effect; no timers, new transport subscriptions, or new long-lived tasks. The pairing container retains its existing bounded one-shot IPC calls. Existing connection generation and stop paths own transport cancellation.

## Error handling

Authentication classification precedes request-specific error correlation because it rejects the connection. Existing generic errors, malformed input behavior and pairing validation/persistence result types remain in force. Only classified rejection shows the exact notice. Ordinary offline and connecting states retain their own accessible statuses.

## Testing strategy

- RED then GREEN: decoder unit cases for exact rejection versus unknown/malformed error payloads; connection unit cases for connected → rejection → send/terminal failure, successful reconnect reset, and independent connections.
- Static renderer cases for saved hosts before list, failed row markup and accessible recovery, shell recovery layout, per-host decision ordering/defer/healthy behavior.
- Focused fake-transport Playwright: startup with persisted pairing against a rejecting endpoint before any list; cancellation/manual keyboard reopening; 800px input/confirmation layout; same-host credential replacement without restart; mixed hosts with healthy chat send/reply; last-host rejection and outage suppression/rearm.
- Run touched Vitest files, `npm run build`, then the focused fake-transport spec using the approved Electron launcher. Full regression gates belong to the verifier/dispatcher; no live Claude tier is required.

## Open questions

None. Reuse existing pairing validation and confirmation; no new credential format or wire contract.

## Documentation handoff

Pending for the documentation stage: “The documentation stage updates the existing channel-list, paired-shell routing and session-store topics to describe retained hosts, non-destructive recovery and per-host connection decisions.” Paths and sections: `docs/knowledge/features/channel-list.md` § What it does; `docs/knowledge/features/paired-shell-routing.md` § The pure view + container and origin-aware cancel; `docs/knowledge/features/session-store.md` § One slot per server. Builder does not edit these shared topics.

## Security review

**Verdict:** PASS

- Trust boundaries: exact comparison in `narrowDaemonErrorOutcome` produces a client-owned category; `emitFailed` produces constant UI copy. Server origin comes from registry binding, never an inbound field.
- Credentials: recovery reuses `registerPairingHandler` confirmation and encrypted credential replacement. No unpair, new secret storage, token logging or renderer persistence is introduced.
- Storage: existing per-user secure store remains responsible for encryption and atomic writes; unavailable keychain remains a typed persist failure. Recovery adds no path or filename derived from input.
- Electron: no new IPC channel, window, navigation capability or preload API. Existing pairing validation and isolated renderer boundaries remain the enforcement points.
- Cryptography: existing Noise implementation and fresh-session reconnect remain unchanged; no key/nonce reuse, custom primitive or comparison to a secret is added.
- Network/I/O: existing relay validation, max frame size, reconnect/backoff and teardown are reused. Classification reads only bounded, decoded plaintext; no transport reaches the renderer.
- Logs: reuse shared diagnostics with static event/code fields only. Do not log pairing code, host label, raw error payload, token or fingerprint.
- Concurrency: connection-local latch cannot clear another host. Generation fencing ignores old driver events; automatic opening uses currently saved IDs and one outage latch. Pairing does not clear held stores.
- Threat alignment: hostile error text can select only the allowlisted rejection category and cannot supply notice copy. Compromised relay/disk and renderer isolation continue under the existing transport and secure-storage contracts; this ticket introduces no alternative path around them.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-12


## Revisions

- 2026-09-12: Build verification showed `DaemonErrorOutcome` also determines attachment-transfer failures. Keep its contract unchanged: `parseInboundMessage` instead adds optional `pairingReject: 'pairing-rejected'`, like its existing request-specific rejection categories. `onDriverEvent` consumes this separate category before correlation. The trust boundary and exact comparison remain unchanged; no attachment consumer needs modification.
- 2026-09-12: Interaction proof requires navigation while another host is healthy to leave the outage latch armed for a later last-host failure. `leaveRecovery` consumes the latch only when no saved host is connected. Existing composer recovery and model-refusal tests now stage per-host attribution rather than a singular status.
- 2026-09-12: Visual verification exposed the pane's wash intercepting an unpositioned recovery section and Vite inlining the supplied plug into a CSP-blocked data URL. Position the recovery section above its wash and serve the unchanged Figma SVG from `src/renderer/public/repair-plug.svg`; retain the existing CSP. The 800px Playwright case checks glyph loading and captures input and fingerprint confirmation.
- 2026-09-12 (verifier rework): Migrate `e2e/host-row-per-server.spec.ts` to the planned per-host composer contract. The verifier reproduced its stale expectation that B's failure shows repair in A's composer. After B's dots change and its daemon reports offline, assert A's editable input, enabled Send, absent connection error/recovery UI, and unchanged connected dots in both trees. Production behavior and design remain unchanged.
- 2026-09-12 (navigation lifecycle rework): The verifier found that `leaveRecovery` consumed a pending automatic decision on ordinary navigation. Consume only when leaving an actual recovery pane during an outage; defer the automatic decision on other routes without consuming it. Add interaction cases for selecting a held thread while another saved host is connecting or unreported, then settling that host offline.
- 2026-09-12 (confirmation lifetime rework): Fence `onPairServerPaired` navigation with a shell-local generation captured by the initiating flow. Starting another flow, leaving pairing, or unmounting the shell invalidates the generation. Credential persistence, registry reconciliation and saved-host refresh still complete; an obsolete callback cannot clear or replace the newer pane. Cover delayed confirmation delivery followed by a healthy-thread selection and by switching recovery hosts. Security re-review: PASS; generation ownership changes navigation only, introduces no credential sink or IPC capability, and preserves the existing encrypted save and content-free diagnostics. Rework touches one existing production file, the focused interaction spec and this plan; no exported contract or visual design changes.
