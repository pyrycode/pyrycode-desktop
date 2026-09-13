# Permission context and initial Cancel focus

## Files read

- `src/shared/ipc/events.ts` → `DaemonEvent` — merged optional camelCase context contract.
- `src/main/transport/inboundMessage.ts` → `parseModalShownPayload` — reason comes from decoded JSON; optional strings/boolean are validated.
- `src/main/daemonConnection.ts` → modal-shown dispatch — explicit presence-preserving copy and content-free lifecycle logging.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `subscribeModal` — renderer translation and existing subscription teardown.
- `src/renderer/src/store/modalPrompts.ts` → `ModalPrompt`, `ModalEvent`, `reduceModal` — held prompts and replacement semantics.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → `PermissionModalView`, `PermissionModal` — presentation, local selection and response guards.
- `src/renderer/src/screens/conversation/modalResolution.ts` → `selectOption`, `resolvePendingOption` — supplied default and request-scoped confirmation authority.
- `src/renderer/src/screens/conversation/conversation.css` → permission-panel selectors — bounded scrollport, wrapping and stationary actions.
- `src/renderer/src/store/modalBridge.test.ts`, `modalPrompts.test.ts` → translator/reducer fixtures — presence and replacement checks.
- `src/renderer/src/screens/conversation/PermissionModal.test.tsx` → `renderView` — static rendering coverage.
- `e2e/permission-modal-answer-paths.spec.ts` → `shown`, `resolutions` — fake delivery, keyboard and constrained layout proof.
- `e2e/offline-held-responses.spec.ts` → `observeCommands`, `permission` — existing renderer-command and offline gate proof.
- `docs/knowledge/features/conversation-shell-permission-modal.md` §§ Presentation, Selection and confirmation — separate selection/confirmation; hidden questionnaire/draft retention.
- `docs/knowledge/features/modal-store-bridge.md`, `modal-prompt-model.md` — presence-preserving forwarding, prompt replacement and reconnect semantics.
- `docs/knowledge/features/development-verification.md` §§ What each test tier proves, Layout and input — effects require Electron proof; unbroken text needs width assertions.

Codegraph context returned “not initialized”; source searches and reads supplied the map instead.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913

Surrounding component: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

The inspected node is a vertical questionnaire panel: Pyry mark/title, bordered dark content box, single-choice rows and trailing outlined Cancel/filled Continue below a separator. Follow the approved 2026-09-13 adaptation: existing panel typography, spacing and colours, muted context below the prompt, description alongside reason and path on its own line inside the existing scrollport. No new assets or drawing are needed.

## Context and sizing

The merged transport contract reaches IPC but loses its context in two renderer copies. This ticket makes that information visible and applies its initial-focus hint without changing answer authority. No ADR is needed.

One deliverable: a contextual permission panel. Estimate about 420 written lines including this plan, tests and styles, matching refinement; three production TypeScript files plus the existing stylesheet, zero new exported symbols, zero consumer call sites needing migration, four acceptance criteria, zero new error/reject branches. Optional fields leave existing prompt literals valid. The nearest analogue is the overlapping portion of #1356, whose plan/implementation/wrapping commits were inspected. Refreshed remote feature branches: no overlap with the intended files.

## Design

- Add optional `reason?: unknown`, `reasonType?: string`, `blockedPath?: string`, `description?: string`, `defaultToNo?: boolean` to the existing prompt and shown-event shapes. Both `translateModalEvent` and `reduceModal` copy the five fields explicitly only when present; false/null/zero survive, and replacement removes omitted old context.
- `PermissionModalView` renders string reasons directly; other supplied JSON uses compact `JSON.stringify`. No truthiness test on reason. Render category independently: classifier → “The auto classifier could not approve this”; rule → “A permission rule asks”; other supplied categories → “Reason type: <category>”; uncategorized reason → “Reason:”. Category and reason share a text row. Description and path get independent secondary text rows, with path on its own line. No context container when all display fields are absent.
- Reuse theme body-small typography, muted on-surface-variant colour and spacing tokens. Apply pre-wrap/overflow-wrap anywhere to context; keep it inside the existing permission content scrollport. Preserve prompt/choice/action styling and the context-free markup.
- A Cancel ref and last-displayed-modal ref in the view apply focus once per newly displayed identity, only when `defaultToNo === true` and responses are available. Effect dependencies include identity, hint and availability, but same-identity updates and Back do not refocus. View unmount resets the marker. A prompt first shown offline does not later steal focus merely on an availability change.
- No Enter handler, preselection or answer change. Native button keyboard activation remains deliberate; `defaultOptionId`, `selectOption` and the existing synchronous availability checks remain authoritative.

## State + concurrency model

Context follows the existing daemon event → bridge → modal store → current-chat selection path. No new store, async work, timers or subscriptions. The focus effect performs one synchronous DOM operation and owns no resource requiring cleanup. Selection and confirmation markers retain their request identity and membership checks; queued prompts get fresh initial focus when displayed. Existing cancellation, reconnect reset, rejection ownership and hidden questionnaire/composer lifetime remain intact.

## Error handling and logging

No new I/O or failure class. Reason is JSON already decoded by the transport, so serialization does not introduce a new parser or fallback that could erase valid JSON meaning. Existing classified decode and modal lifecycle logs in main remain the shared content-free diagnostics. Never include context, paths or categories in logs or outbound commands.

## Testing strategy

- RED first: bridge/reducer tests cover all five fields, false/null/zero, absent own properties and replacement dropping old context. Static view tests cover absent context, reason-only/category-only, both mappings, unknown category plus reason, compact structured/null/false/zero reasons, independent description/path and escaped hostile strings.
- Extend the existing permission fake-transport spec: current-chat context delivery, Cancel focus for each new hinted prompt, Enter sends only cancel, absent/false focus unchanged, radio selection/Enter sends nothing, and native Continue/Confirm keyboard activation respects supplied defaults. Same-id delivery and Back must not steal focus.
- Extend its 800×600 long-content case with long reason/description/unbroken path, width assertions and reachable actions; preserve draft/questionnaire assertions. Capture normal context, constrained context and confirmation for visual comparison.
- Exercise a hinted prompt through the existing offline response spec; response buttons stay disabled while radio selection and Back work.
- Run touched Vitest files, `npm run build`, and the two touched fake-transport specs via the approved Electron helper. Full suites are the verifier/dispatcher gate; #1409 owns live session-offer proof.

## Open questions

None. Focus is initial only; reconnect-only availability changes do not reset it, and context never supplies approval authority.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/conversation-shell-permission-modal.md`, Presentation and Selection and confirmation, with reason/category fallbacks and the default-to-no initial focus behavior.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseModalShownPayload` validates optional field types; decoded reason remains untrusted JSON through `translateModalEvent`/`reduceModal`. `PermissionModalView` uses escaped React text children exclusively, including category/path/description and compact JSON.
- [Tokens, secrets, credentials] No credentials enter this change; existing main-side answer-token minting remains untouched. No new persistence or token lifecycle.
- [File/storage operations] `blockedPath` is text only: no filename, link, attribute, lookup or storage operation. Context stays in the existing in-memory prompt queue.
- [Electron attack surface] No new IPC capability, navigation, remote content or webPreferences change. Reason cannot create markup, handlers or URLs in the privileged renderer.
- [Cryptographic primitives] No crypto, keys, nonce changes or transport moved into the renderer; existing main ownership is unchanged.
- [Network & I/O] No new network request or parser; inherit the merged JSON decode/IPC contract. Session-offer behavior and its live proof belong to #1409.
- [Errors/logs/telemetry] Inherit content-free `modal-shown` and resolution diagnostics; no context values reach a log or error interpolation.
- [Concurrency] Initial focus is scoped to displayed modal identity. Same-request updates cannot steal deliberate focus. Existing synchronous response availability and pending-option identity checks remain at every answer/cancel action; the hint cannot enable offline responses or approve by itself.
- [Threat model alignment] Hostile daemon text remains inert, including markup-looking JSON and path strings. A misleading category/hint cannot select an option, change the supplied default or bypass confirmation. Relay secrecy, at-rest credential protection and main-process validation retain the existing transport contract; this renderer change introduces no new surface there.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

- 2026-09-13: Browser proof clarified the Back focus assertion: React reuses the Back/Cancel native button, so keyboard Back naturally retains focus on Cancel even without a focus effect. The test holds focus on the chat control while dispatching Back to detect an unwanted effect independently of native focus retention. The long-content typing scenario remains unhinted because spaces on an initially focused Cancel deliberately cancel; the dedicated hinted scenario proves that cancellation behavior. No production contract change.
