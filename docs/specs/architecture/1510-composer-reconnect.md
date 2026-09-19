# Composer connection-error recovery

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` — `shouldOfferRepair` and connection copy currently misclassify terminal closes.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ComposerErrorSlot`, `ComposerErrorSlotControl`, and `handleRepair` own priority, rendering and current-host resolution.
- `src/renderer/src/screens/conversation/composerSend.test.ts` and `ConversationScreen.test.tsx` — predicate and static-render coverage.
- `src/preload/index.ts`, `src/shared/ipc/reconnectServer.ts`, `src/main/reconnectServerHandler.ts`, `src/main/connectionRegistry.ts` — `reconnectServer`, `isReconnectServerRequest`, `registerReconnectServerHandler`, and registry `reconnect` already provide validated named-host dispatch and lifecycle logs.
- `e2e/unpair-repair.spec.ts`, `e2e/pairing-recovery.spec.ts`, `e2e/fixtures/launchPairedApp.ts`, `src/main/transport/fakeDaemon.ts` — geometry, sealed rejection and multi-host handshake fixtures.
- `docs/knowledge/features/conversation-shell-composer-repair-button.md`, `conversation-shell-composer-status.md`, `composer-send.md` — current priority and the static-render/store-initial-state testing seam.
- `docs/knowledge/features/development-verification.md` — positive completion evidence before absence assertions; Electron execution outside the macOS sandbox.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The input area's status row places a compact dark-red Error button at the right and bottom-aligns the activity group at the left. Reuse `button-small button-small--error` and its existing typography, radius and error tokens; only the connection-error button's text changes to `Connection error - Reconnect`. No new assets or CSS are needed.

## Context and sizing

A fatal relay close is not proof that stored pairing is invalid. One deliverable: offer the appropriate recovery for the open host's terminal error. Estimate approximately 450 written lines, two production files, no new exported types/components/stores, four acceptance criteria and no new state machine. No remote feature branch overlaps the five principal planned files after fetching origin.

Adding a required `onReconnect` prop reaches 32 static-render/production call sites, exceeding the ten-consumer boundary. Splitting that prop plumbing would create a slice consumed only by this recovery feature; the explicit one-consumer floor therefore wins. Keep the behavior and its proofs together, recording this overage rather than treating test calls as free. Codegraph is uninitialized; repository search supplied the call-site inventory.

## Design

Narrow `shouldOfferRepair` to non-retryable `pairing-rejected`. Add pure `shouldOfferReconnect`, accepting other non-retryable errors except `unpair` and `not-paired`, and client-owned `COMPOSER_RECONNECT_BUTTON_COPY` beside repair copy. The slot checks repair, then reconnect, then the existing chip and unchanged connected-only precedence. Both buttons use visible copy as accessible names; error data selects a branch and never enters markup or attributes.

Add required `onReconnect` to the pure slot. Its container re-reads the active conversation and conversation list at click time, uses `serverIdForOpenConversation`, and invokes `window.pyry.reconnectServer` only for a unique owner. Missing or ambiguous ownership has no effects. Repair continues to call `onRepairHost`.

## State, concurrency and error handling

No new store or long-lived task. Reconnect dispatch has no optimistic resets, credential operations, recovery navigation or local connected state; existing main-process lifecycle events remain authoritative. Await the IPC acknowledgement inside a caught async handler, without writing state afterward. Log only a static classification if the bridge rejects; existing handler/registry logs cover dispatch and transport progress. Main retains all transport cancellation and fresh Noise handshake ownership.

## Testing strategy

- RED then GREEN: table-driven predicate coverage for both gates, all non-error statuses, exclusions and retryability.
- Static markup proves exactly one button/chip, fixed accessible copy, sentinel-message isolation on both buttons, sentinel-code isolation on reconnect, and unchanged lower-priority occupants. Update all required prop consumers and obsolete terminal-error expectations.
- Fake-transport Playwright drives 4421 and bare 4401, reconnects only the open host with two hosts paired, and verifies connected completion, retained hosts/draft and absence of recovery. Existing repair drives switch to sealed `auth.invalid_token`.
- Reuse row geometry assertions (24 to 32 pixels, bottom alignment and icon offset). Capture the reconnect state at 800px width for comparison with the Figma reference.
- Run touched unit files, build, and touched fake-transport specs; full-suite regression belongs to the verifier.

## Open questions

None.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/conversation-shell-composer-repair-button.md` and the precedence description in `docs/knowledge/features/conversation-shell-composer-status.md` to record the repair/reconnect split. Update `docs/knowledge/features/composer-send.md` § 5 (Re-pair gate) and § 9 (Actionable-error button copy) for the narrowed gate and new reconnect copy constant, including the exact visible wording `Connection error - Reconnect`.

## Security review

**Verdict:** PASS

- Trust boundaries: `shouldOfferRepair` requires explicit typed pairing rejection; raw fatal closes cannot establish it. `ComposerErrorSlot` renders only client-owned copy, with sentinel tests for hostile fields.
- Tokens and storage: the new action never reads, deletes or replaces credentials; existing main-process safeStorage and pairing confirmation remain authoritative. No new file or browser-storage operations.
- Electron attack surface: reuse `reconnectServer` and `isReconnectServerRequest`; registry `reconnect` selects an existing held host. No new bridge, navigation, window or raw transport capability.
- Cryptography: existing connection reconnect owns fresh Noise handshake/ciphers; renderer receives no keys and cannot reset nonces.
- Network and I/O: one explicit user action targets one held host; no new URL handling, sockets, retries or TLS changes. Existing transport policies remain in force.
- Logs and errors: main handler emits fixed lifecycle classifications; renderer catch drops exception detail and emits a static code only. No daemon error or host value is logged by this change.
- Concurrency: resolve ownership synchronously at click time before IPC; no post-await store writes. Existing connection teardown and reconnect serialization are retained.
- Threat alignment: an untrusted relay close can offer reconnect but cannot trigger pairing replacement. Hostile error strings cannot become markup, attributes or logs. Transport isolation and storage protections are inherited without extending their surfaces.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-19
