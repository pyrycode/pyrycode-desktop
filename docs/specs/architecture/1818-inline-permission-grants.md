# Inline permission cards and retained session consent

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries, test-first and reading map.
- `docs/knowledge/features/conversation-shell-permission-modal.md`: ordered choice identity, pure snapshots and fresh action guards.
- `docs/knowledge/features/conversation-shell-question-panel.md` → Composer placement: keep hidden questionnaire mounted.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin: direct-child growth follows only pinned readers.
- `docs/knowledge/features/development-verification.md` → What each test tier proves: static markup cannot establish interaction or scroll fidelity.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → Timeline, ComposerSlot, QuestionHistorySlot, useThreadScrollPin: trailing seam and composer lifetime.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → PermissionModalView, PermissionModal: sole card consumer, initial focus and ownership reads.
- `src/renderer/src/screens/conversation/permissionChoices.ts` → createPermissionChoices: fresh callbacks and pane-local arming.
- `src/renderer/src/store/modalPrompts.ts` → reduceModal: continuously ordered options/offer identities survive content-only delivery.
- `src/renderer/src/screens/conversation/modalResolution.ts` → hasSessionPermission, confirmPrompt: only explicit allow confirmation sends grants.
- `src/renderer/src/screens/conversation/promptResponseAvailability.ts` → canRespondToPromptNow: action-only diagnostics.
- `src/renderer/src/screens/conversation/conversation.css`: existing permission tokens and inner scroll caps.
- Existing permission unit, static and named fake/live specs: preserve transport/effect proofs.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=756-9170

Read desktop plus supplementary 639:2451, 639:2666, 639:2882, 639:3099 and behavior 640:2838. Retain existing background card, primary-container border, title-medium/body-large copy, server-ordered full-width outlined/default-filled choices, tonal armed choice, checkbox and external outlined Cancel. Adapt supplementary states to desktop; reuse existing tokens and assets. Only placement and scroll containment change.

## Context

Permission currently covers the composer and discards checked grants on navigation. Move its transient presentation into history without persisting it or changing response transport. One deliverable, estimated 200 production + 380 tests + 85 plan lines, one new exported factory, under ten consumers, five observable criteria and fewer than ten reject branches. No overlapping in-flight feature branches found after fetching origin. A separate ADR is unnecessary.

## Design

Always mount the trailing history wrapper with PermissionModal followed by the native-hidden questionnaire wrapper. Ensure the thread exists for empty/offline permission histories; restore ComposerSlot's normal composer/status/footer with its existing send gates and reply focus wiring.

Add `createPermissionConsent(read, subscribe)` beside the permission consumer: an in-memory map of checked outstanding prompts and their uniquely stamped server owner. Its read contract returns every outstanding prompt with `serverId: string | null`. It exposes guarded lookup/update and a teardown handle, with no persistence or IPC. The production instance subscribes for the renderer-process lifetime to modalStore and conversationListStore, independent of panes. Retention uses continuous options and alwaysAllow object identities plus modal/conversation/default/class/server ownership. Every removal, offer or ownership transition immediately evicts affected consent, even if restored before React paints.

Extend createPermissionChoices with optional retained consent dependency. Pane cleanup/navigation clears arm and local state only. Fresh refresh derives checked state from retention; response/cancel clears retained state. Keep strict displayed-object identity, active conversation, unique owner and connected checks. Call canRespondToPromptNow only on action admission. No other connected host fallback. Default responses remain single-activation without grants; supplied non-default allow_once/allow_always require two fresh activations and valid consent.

Remove permission height/title/inner-content caps so all actions scroll with history. Initial Cancel focus uses preventScroll. Observe the stable trailing wrapper through the existing direct-child ResizeObserver, including leaf-only growth.

## State + concurrency model

The retained map is renderer memory only, populated exclusively by admitted checkbox actions. Synchronous Zustand subscriptions observe every modal/owner transition before React batching, even with no active pane. Subscription reads never emit diagnostics. Pane subscriptions tear down on unmount; the retention observer lives with the app process and provides disposal for isolated tests. No new asynchronous jobs or transport changes. Status-only disconnect preserves consent while fresh availability guards disable actions; scoped reconnect/reset removes prompts and evicts consent.

## Error handling

Preserve typed IPC/main validation, remote-permission restrictions, optimistic resolution, refusal, rejection banners and owning-chat remote/timeout notices. Missing/duplicate/changed ownership invalidates consent. Stale/unavailable callback attempts produce existing content-free action codes and no command. No new I/O failure modes.

## Testing strategy

- Unit: retained consent across pane disposal, same-content delivery, every identity/ownership change and batched restoration while closed; stale action/default/trust/offline grant policy.
- Static: permission lives after rows in thread, composer/footer remain present, questionnaire retains native-hidden markup; no persistence.
- Focused fake transport: navigation retains check but loses arm, closed-chat invalidation, empty/offline placement, FIFO/peer resolution, composer/questionnaire drafts, minimum-width whole-card scrolling, pinned growth and held reader/focus position.
- Integrated synthetic captures: safe default, armed, checked/unchecked grant at desktop and 800×600; inspect against Figma.
- Preserve existing live repeated Bash effect and fresh-session permission proof. Change live selectors only if placement requires it; dispatcher owns named session-grant execution/pass acceptance under needs-real-claude. No live pass claimed here.
- Final main merge, pre-verify check, build and affected fake specs before PR.

## Open Questions

None. Retention uses the reducer's existing continuous identity rather than comparing restored text.

## Security review

**Verdict:** PASS

- Trust boundaries: retain parsed ModalPrompt only; createPermissionChoices guards displayed object, active chat, stamped owner and fresh availability before existing validated answer/cancel IPC. Daemon owns final grant authority.
- Tokens/secrets: no new credentials; answer tokens remain minted in main. Consent never reaches web storage, logs or command fields beyond allowed always_allow.
- File/storage operations: no file or storage operation added; transient card is outside saved timeline state. Untrusted paths/rules remain escaped text children.
- Electron attack surface: no new IPC API, navigation, remote content or webPreferences change. Existing main IPC validation and remote-permission restrictions remain.
- Cryptography: transport and Noise_IK_25519_ChaChaPoly_BLAKE2s remain in main; no keys/randomness introduced.
- Network/I/O: existing bounded transport, deadlines and guarded response helpers unchanged; status-only disconnect retains drafts but cannot admit commands.
- Errors/logs/telemetry: render and observer reads pure; action diagnostics use static codes only, never prompt content or grant drafts.
- Concurrency: MUST FIX addressed in design — retention observes all synchronous removals/offer/ownership transitions while pane unmounted; restored text cannot revive checks. Arming never survives navigation. No await between guard and response.
- Threat alignment: hostile daemon text remains inert; compromised relay cannot authorize a grant through renderer memory; compromised renderer still encounters main validation. Disk token theft and relay cryptography remain governed by existing safeStorage/transport design, unchanged here.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-10-07
