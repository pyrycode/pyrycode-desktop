# Channel pin actions (#2085)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and reading map.
- `docs/knowledge/features/channel-list.md`: preserve row classes, pen reveal and authoritative pin partitioning from #2084.
- `docs/knowledge/features/daemon-connection.md`, `daemon-connection-conversation-routing.md`, `daemon-connection-registry.md` in the same folder: authenticated sends, unique observed-host claims, and mandatory registry view delegation.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: causal barriers, Linux replay and Electron SQLite prerequisites.
- `src/shared/wire/types.ts` → `SetConversationMutedPayload`, `EnvelopeType`: neighboring outbound contract.
- `src/shared/ipc/commands.ts` → `isRendererCommand`, `isSetConversationMutedPayload`: strict admission and host validation.
- `src/main/transport/setConversationMutedEnvelope.ts` → `buildSetConversationMuted`: pure envelope builder.
- `src/main/daemonConnection.ts` → `setConversationMuted`, `markConversationRead`: named-field rebuilding and authenticated writes.
- `src/main/connectionRegistry.ts` → `viewOf`; `src/main/index.ts` → command dispatch; `src/main/conversationRouter.ts` → `resolve`: owning connection routing.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `ChannelListView`, `renderBody`, `Row`, `canMutateHost`; `channels.css` → row/control geometry.
- Adjacent command, connection, registry and ChannelList tests; `e2e/sidebar-pinned.spec.ts`, `e2e/conversation-mute-command.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: existing fakes and processing barriers.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=869-13089

Read design context and screenshot, plus Pin `872:9638` and Unpin `872:9649`. Render their Font Awesome paths inline in a 12px SVG with `--color-primary`, immediately left of the pen. Reuse the pen's 28×24 hit area and control hover/name-pill treatment; reserve title space for both controls. Keep existing row typography, fills and host-down treatment. As explicitly requested, host-down unpin is disabled despite the full-strength design instance.

## Context

#2084 already supplies received pin state, persistence and global placement. This ticket supplies one useful behavior: reversible channel pinning through its owning host. Plumbing alone has only this consumer; pin/unpin are the two values of the same operation. Four observable acceptance behaviors remain together with their security and integration verification.

Analogue #1595 wrote about 534 lines including correlation machinery that pinning does not need. Budget: about 700–760 written lines including this plan, production and tests; two new exported interfaces (payload and builder input), no new component/store, at most five consumers to update, four acceptance behaviors, fewer than ten rejection branches. In-flight #1544 and #2101 touch connection/command wiring in different blocks; inspected diffs require no dependency. Keep additions local.

## Design

- Add `SetConversationPinnedPayload { conversation_id: string; pinned: boolean }` and `set_conversation_pinned` matching merged Core #3538. Add `buildSetConversationPinned(input): Uint8Array` beside mute's builder.
- Add a `setConversationPinned` renderer command with required `serverId` beside the two-field payload. Guard a non-empty string ID, strict present boolean, non-array payload with exactly those two own keys, and existing bounded host grammar. Host attribution never enters the wire payload.
- Main dispatch calls `router.resolve(conversation_id, serverId)?.connection.setConversationPinned(payload)`. No explicit-server shortcut: unknown, mismatch and multiple current claims refuse. Registry `viewOf` delegates to the chosen connection.
- `DaemonConnection.setConversationPinned(payload): void` requires a live authenticated driver, rebuilds exactly two fields, sends once and logs static sent/failure/refusal classifications. Catch encode/send failures without exposing exception text. No correlation map, retries, capability, pending state or result events.
- Container callback rechecks `canMutateHost` at activation and sends through existing preload `sendCommand`. Pass callback/connectivity into the pure view; Row receives a private pin-control description. All host Channels rows have pin, Pinned rows have unpin; Chats have none. Buttons are siblings of open/edit actions, visible at rest, disabled unless connected. Preserve `.channel-list__rename` and other existing tokens.
- Existing `conversationUpdated` bridge requests the owning host's list for correlated and unsolicited updates. Only that authoritative list changes `pinned_at` and placement; no optimistic mutation.

## State + concurrency model

No new state or async task. Existing per-host session status is read in the container and rechecked synchronously on activation. Main ownership lookup and send are synchronous; connection authentication is rechecked at send. Existing list fetch/cache and window subscription cleanup remain responsible for incoming state. Repeated writes remain independent and host timestamp idempotence stays daemon-owned.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Pin/unpin, held confirmation, correlated update then list | `sidebar-pin-actions.spec.ts`: visible actions await authoritative placement |
| Repeat pin; unsolicited update from another device | same spec: repeated requests retain placement and original timestamp order; unsolicited refresh is host-local |
| Error / older-host unknown type / local encode or send failure | same spec refusal barriers; connection units: local failures do not send or emit list mutations |
| Unknown, mismatched or ambiguous conversation ownership | same spec: preload attempts followed by accepted-list barriers send no writes |
| Disconnect after render, disconnected/error/connecting then recovery | same spec: stale callback and disabled controls; connected recovery enables writes; connection units reject pre-auth and stopped writes |
| Connection close/reopen | connection units: stopped writes stay inert; no new retained request identity |

## Error handling

Malformed IPC is rejected by existing command admission. Ownership refusal uses router's content-free diagnostic. Unauthenticated/offline and local encode/send failures log only fixed classifications and leave placement untouched. Daemon refusals use existing parsed error handling, with no new UI notice or raw error sink. Controls expose availability through disabled state.

## Testing strategy

Write failing tests before implementation. Unit tests cover exact encoded envelope for true/false; malformed IPC table including extra fields and invalid hosts; connection field rebuilding, authentication, repeated sends and local failures; registry delegate; static pin/unpin/chat markup and availability. Existing ownership-router units remain applicable.

One fake-transport Electron spec drives both hosts, real preload/IPC/registry/encryption, held confirmations, host-local re-lists, daemon refusals, offline/reconnect and stale activation. Fence negative assertions with a later accepted request/reply or received renderer event. Capture actual controls with long titles at 1280×800 and 800×600 and inspect against Figma. Run affected unit files through pre-verify after final main merge, build, focused e2e, and configured captured-client replay on Linux. No current-provider/live acceptance is required; dispatcher owns the complete application suite.

## Open Questions

None. Cleaner-shape check: retain the existing authoritative partition/list refresh rather than introduce pin state or copy mute's result-event machinery.

## Revisions

2026-10-18: Final geometry review found the existing chevron/pen slot convention overlaps hit areas by 8px. Pin and pen instead have adjacent 28px hit areas; right-align the pin glyph without padding to preserve the Figma 20px glyph pitch, center its hover paint on that glyph, and reserve 56px for both buttons. The focused Electron geometry assertion failed on the overlap before this correction.

2026-10-18 (verifier rework): Keep enabled-only pin hover outside the shared `:is(...)` list so its specificity cannot override the existing 22px edit and 24px create hover layers. Extend `sidebar-control-hover.spec.ts` to cover the pin's glyph-centered 20px layer and disabled hover. Update `sidebar-control-name-pill.spec.ts` to count both channel controls, scope each pill to its control and cover pin pointer/focus placement; both it and `sidebar-row-geometry.spec.ts` assert open → pin → edit keyboard order while retaining edit reveal/dialog and clipping checks. These repair the same row-control contract, add no independent behavior or lifecycle state, and keep total written work below 800 lines with unchanged exports, consumers and acceptance behaviors. No in-flight feature branch overlaps these repair files.

## Security review

**Verdict:** PASS

- [Trust boundaries] IPC guard is the single admission boundary; required observed host uses `resolve` current unique claims. Payload rebuilding bounds wire fields; renderer hints cannot select another host directly.
- [Tokens, secrets, credentials] No new credentials or credential storage. Existing main-only Noise connection and safeStorage are retained; renderer gets no keys or bytes.
- [File and storage operations] No new file/path operations or renderer persistence. Existing #2084 authoritative list cache remains unchanged.
- [Electron attack surface] Only one allowlisted command is added; exact own payload keys, strict boolean and existing bounded host validation precede dispatch. Existing privileged sender checks and isolated/sandboxed BrowserWindow remain unchanged. No navigation, remote content or raw IPC primitive is exposed.
- [Cryptographic primitives] Existing Noise codec/driver handles encryption and nonce lifetime unchanged; this command adds no crypto or secret comparison.
- [Network and I/O] Fixed envelope uses existing frame cap and authenticated relay lifecycle/timeouts. No new network destination, socket, reconnect policy or wait is added.
- [Errors, logs, telemetry] Only fixed event/code strings are logged; no IDs, daemon text, payloads, exceptions, keys or tokens. Existing bounded rotating logger remains the sink; no telemetry added.
- [Concurrency] Synchronous connectivity/ownership/auth checks; no retained pending write state to leak across redial, duplicate callback or shutdown. Existing teardown owns transport and incoming refresh subscriptions.
- [Threat model alignment] A malicious relay still sees only Noise ciphertext and may delay confirmation without moving rows. Existing safeStorage protects tokens. Hostile daemon updates retain existing typed decoding; compromised renderer cannot bypass exact payload admission, unique owning-host resolution or main-only transport boundaries.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-18
