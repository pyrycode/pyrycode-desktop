# Permission choice buttons

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and reading map.
- `docs/knowledge/features/conversation-shell-permission-modal.md`: per-pane drafts, native focus, continuous offer identity and rejection ownership.
- `docs/knowledge/features/modal-store-bridge.md`: scoped reconnect and pairing reset.
- `docs/knowledge/features/development-verification.md`, section “What each test tier proves”: static rendering cannot prove interaction or layout.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → `PermissionModalView`, `PermissionModal`: sole production view and mount.
- `src/renderer/src/screens/conversation/modalResolution.ts` → `answerPrompt`, `confirmPrompt`, `hasSessionPermission`: optimistic resolution and grant policy.
- `src/renderer/src/store/modalPrompts.ts` → `reduceModal`: ordered requests and continuous offer identity.
- `src/renderer/src/screens/conversation/promptResponseAvailability.ts` → `canRespondToPromptNow`: uniquely stamped connected owner.
- `src/renderer/src/store/activeConversationStore.ts`, `conversationListStore.ts`, `sessionStore.ts`: synchronous navigation, ownership and availability reads.
- `src/renderer/src/screens/conversation/conversation.css`: shared questionnaire styles and permission-specific scroll bounds.
- Existing permission unit, static-render and six named browser specs: retained FIFO, feedback, keyboard, offline and repeated-Bash proofs.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=756-9170

Read desktop and supplementary nodes 639:2451, 639:2666, 639:2882, 639:3099 and 640:2838. A background card with primary-container border contains title, prompt, context, optional grant and full-width choices in server order; Cancel follows outside it. Primary/on-primary tokens fill the supplied default; outlined primary choices become secondary-container tonal when armed. Reuse body/title tokens and existing checkbox glyph; retain bottom composer placement and bounded scrolling, adapting the mobile supplementary states to desktop. No in-scope image asset is introduced.

## Context

Replace radio selection and separate confirmation with one activation for the supplied default and two activations of the same non-default. Keep refusal, transport, feedback, notices, questionnaire precedence and hidden composer draft. Navigation-retained grants and inline placement remain #1818's work.

## Design

Use a small per-pane Zustand choice controller, with injected current-request reads, transition subscription and resolution effects. Its state holds an armed option and opted prompt snapshot. `activate(prompt, optionId)`, `toggle(prompt, checked)` and `cancel(prompt)` accept the displayed snapshot and reject stale callbacks. Only a second activation of the same currently supplied non-default reaches `confirmPrompt`; defaults use `answerPrompt` without a grant. Checkbox changes neither arm nor answer.

The current read joins the displayed active conversation, first outstanding request, unique stamped host and that host's status. No other host is a fallback. Every action rereads synchronously, before mutation/send, with no await. Preserve ordered options identity in `reduceModal` only across identical class, conversation, default and ID/label/order; include these fields in continuous offer identity. Display-only context re-delivery preserves consent.

`PermissionModalView` receives an armed option and activation callback. Keep all text escaped children and client-owned ARIA IDs; an armed choice references fixed “Activate this choice again to confirm.” copy. Native button Enter/Space supplies deliberate activation, with no panel shortcut. Preserve initial hinted Cancel focus.

Scope: five production files including one new controller; about 280 production, 390 test/helper and 75 plan lines (745 total), at most two new exports, two production consumers, five observable acceptance criteria, fewer than ten reject branches. The nearest analogue #1356 changed the same view and tests. Overlap: #1779 adds unrelated message-action CSS; edits here stay local.

## State + concurrency model

Subscribe synchronously to modal, active-conversation, conversation-list and session stores while the pane is mounted. Clear arm and consent on any request/choice/offer/owner invalidation, including removal then restoration before React paints, reset and scoped reconnect. Navigation clears both for this slice. Availability disables choices, checkbox and Cancel. Controller cleanup unsubscribes every source and invalidates retained callbacks; no async task or persistent draft is added.

## Error handling

Stale, absent, ambiguous or unavailable requests fail closed without sending or resolving. Existing answer/cancel helpers retain bridge-failure containment, content-free diagnostics and optimistic dismissal. Daemon rejection feedback retains its independent conversation-scoped lifetime. No new error copy or I/O boundary.

## Testing strategy

- Unit controller/reducer cases: default/second activation, switching arms, ordered choice/default/class/offer changes, restoration, ownership, navigation, disposal and stale answer/cancel/checkbox attempts; assert exact command counts and grant omission.
- Static markup: order, default and tonal styles, fixed accessible instructions, escaped text, permission-only ordered rules and disabled controls. Adapt the existing additional view caller.
- Focused fake transport: migrate permission answer, offline response and resolution-notice scenarios; preserve FIFO, peer resolution, rejection, hidden drafts, keyboard focus and wrapping/reachability at 800×600. Capture synthetic safe-default, unchecked, checked and armed states at desktop/minimum dimensions.
- Migrate three live consumers, preserving repeated Bash effect and session boundary proof. Authenticated post-verifier live execution belongs to the dispatcher per the ticket and shared practice; retain `needs-real-claude`, claim no unexecuted live pass.
- Final merge of main, pre-verify check and build, plus all changed fake specs.

## Open Questions

None. Reuse existing component/token and transport contracts; no dependency or wire change.

## Security review

**Verdict:** PASS

- [Trust boundaries] Existing typed answer/cancel IPC and daemon validation remain authority; renderer consent adds only the optional boolean. Current snapshot and unique owner are rechecked before all actions.
- [Tokens] No new credentials or secret lifecycle; main still mints answer tokens and holds secrets.
- [File/storage] No persistence, path operation or renderer web storage; prompt and consent remain memory-only.
- [Electron attack surface] No bridge, window or navigation policy changes. Daemon labels/context/rules remain escaped text; all ARIA metadata is client-owned.
- [Cryptography] No crypto or key/nonce changes; existing main Noise transport remains intact.
- [Network/I/O] No transport changes; unavailable owner blocks all decision controls, with no aggregate-status fallback.
- [Errors/logs] Preserve fixed rejection copy and existing content-free response diagnostics. Never log prompt text, option labels, rules or consent drafts.
- [Concurrency] MUST FIX addressed in design: render-only invalidation could resurrect consent after batched restoration. Synchronous subscriptions and reducer identity observe every transition; stale snapshots and disposed callbacks fail closed, no await separates validation and send.
- [Threat model] Hostile daemon text stays inert; reordered/replaced offers discard consent. Relay delay/reconnect invalidates requests through existing scoped clearing. Process isolation and safeStorage continue protecting secrets from renderer/disk threats; this ticket changes neither surface.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06

## Revisions

- 2026-10-06 — Verifier finding 1: `PermissionModal`'s controller snapshot reader now derives availability directly from the unique stamped owner and its current session status, without calling the diagnostic-emitting `canRespondToPromptNow`. Construction during render and every subscription refresh are side-effect-free. Action handlers still reread the same current stores synchronously; `permission-choice` and `permission-response` diagnostics remain in action paths. Focused production-wiring tests cover repeated populated/empty renders, silent unrelated transitions, synchronous ownership loss/restoration invalidation and fresh offline response guards. No state, transport or consent-policy change.
