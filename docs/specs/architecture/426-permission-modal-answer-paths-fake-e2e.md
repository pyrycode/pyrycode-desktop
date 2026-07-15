# Spec: fake e2e — permission/trust modal answer paths (#426)

**Size:** S · **Security-sensitive:** no (test-only coverage of already-sec-reviewed verbs) · **UI-visible:** no new UI (Figma N/A — coverage of shipped screens)

Test-only. **Zero production change.** One new Playwright spec on the shared fake-stack fixtures, covering the five permission/trust modal answer paths end-to-end (renderer → IPC → main → Noise wire → decode). Every production path is already shipped; this pins the client wiring cheaply before the Tier-3 real-daemon twin.

## Files to read first

- `e2e/run-config-settings.spec.ts` (whole file, ~260 lines) — **the template.** Clone its shape: spec-local frame builders sealed via the production codec, a spec-held `captured: Envelope[]` array filled by a capturing `buildReplyFrames` closure, `daemon.pushFrame(...)` to surface an unsolicited prompt after launch, and outbound-frame assertions via `expect.poll(() => captured.filter(...).length)`. Your spec is the same skeleton with modal frames instead of `set_session_settings`.
- `e2e/fixtures/launchPairedApp.ts:60-142,199` — `SEEDED_ROW`, `seedConversationsFrame()` (reuse on your `list_conversations` arm — a scripted `buildReplyFrames` owns seeding the launch row), the `buildReplyFrames` seam, `daemon.pushFrame`, and the `PairedApp` handle (`{ page, app, daemon }`). Launch lands on `.conversation` with **Send enabled** — no extra un-inert step needed (unlike run-config's `session_transition`; the modal is not interactive-gated).
- `src/renderer/src/screens/conversation/PermissionModal.tsx` (whole file) — **the locator source.** Exact DOM/classes/roles/labels for list mode, confirm mode, and the rejection surface. Note: `PermissionModalView` renders one dialog for `outstanding[0]`; the leading **Cancel**/**Back** buttons carry their own classes; `RejectionSurfaceView` renders `role="alert"` banners with copy `"Your answer was rejected."` and a **Dismiss** button, and renders even when no prompt is outstanding.
- `src/renderer/src/screens/conversation/modalResolution.ts` — the answer semantics: `selectOption` routes the **default** option straight through to `answerPrompt` (one tap) and any **non-default** option to a confirm sub-step; both `answerPrompt`/`cancelPrompt` clear the prompt **optimistically** (local `dismissed` dispatch), independent of any daemon reply.
- `src/main/daemonConnection.ts:493-541` (error/reject correlation), `:1316-1364` (`answerModal`/`cancelModal` + `answer_token` mint), `:786-790` (`modal_dismissed` drains `outstandingAnswers`) — **the reject model.** See § State + concurrency; this is the load-bearing subtlety of the whole spec.
- `src/shared/wire/types.ts:426-500` — exact wire payload field names (`ModalShownPayload`, `ModalDismissedPayload`, `ModalAnswerPayload`, `ModalCancelPayload`, `WireModalOption`). Note snake_case: `default_option_id`, `option_id`, `answer_token`.
- `src/main/transport/modalResolutionEnvelope.ts` — confirms the outbound envelope `type`s are `'modal_answer'` / `'modal_cancel'` and the payload shapes.
- `src/main/transport/fakeDaemon.ts:141-156,419` — the `FakeDaemon` surface + `pushFrame`. Its own comment (line ~124/155) already anticipates "the modal e2e passes `[modalShownEnvelope]`".
- Prior gotchas (memory / lessons): `e2e/` is **not** in either tsconfig — run a standalone `tsc` pass on the new spec before considering it done (`npx tsc --noEmit e2e/permission-modal-answer-paths.spec.ts` won't work standalone; use the same typecheck approach the siblings use — see § Testing). A bare control frame **needs a present-empty payload** (`payload: {}`); `decodeEnvelope` throws on an absent payload.

## Context

The `PermissionModal` (mounted unconditionally at `ConversationScreen.tsx:201`) renders whenever `modalStore.outstanding[0]` exists — **driven purely by the store, not gated on the interactive-timeline flip (#179).** The whole stack is shipped: inbound decode (#201), the answerable dialog (#224/#237), the non-default second-confirm step (#226), outbound `modal_answer`/`modal_cancel` (#236), the rejection banner (#248/#249), and the `modal_dismissed` clear (#122/#201). Today only unit tests touch these paths; none has e2e coverage. This ticket adds that coverage on the shared fixtures, in line with the sibling fake-stack e2e specs (#451/#452/#423/#425/#456).

## Design

New file: **`e2e/permission-modal-answer-paths.spec.ts`**. Imports mirror `run-config-settings.spec.ts` exactly:

```ts
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, ModalShownPayload /* + the other modal payload types */ } from '../src/shared/wire/types'
```

### Two `test()` blocks (the #423 precedent — one-way per-launch state)

Split by the FIFO reject subtlety (§ State + concurrency), **not** by convenience:

**Block 1 — "answer paths clear the prompt and hit the wire" (one launch).** Covers AC2, AC3, AC4, AC6. The fake never returns a reject in this block, so `outstandingAnswers` residue is harmless (no `error` is ever pushed → `.shift()` is never called → no spurious rejection). Each path pushes a `modal_shown` with a **distinct `modal_id` and title**, drives it to completion, and asserts on frames filtered by that `modal_id`.

**Block 2 — "a rejected answer surfaces a dismissible banner" (fresh launch).** Covers AC5. A fresh launch means a fresh `dial()` → **empty `outstandingAnswers`**, so the one answer sent is the sole outstanding entry and the reject dequeues exactly it. This keeps the reject correlation precise without ordering tricks.

### Spec-local frame builders (contract sketches — seal one envelope each via the production codec, fixed `id`/`ts`, no `Date.now()`/randomness)

- `modalShownFrame(modalId: string, opts: { title: string; prompt: string; options: WireModalOption[]; defaultOptionId: string }): Uint8Array` — `encodeEnvelope({ id, type: 'modal_shown', ts, payload: ModalShownPayload })` with `class: 'permission'`, `default_option_id: opts.defaultOptionId`.
- `modalDismissedFrame(modalId: string): Uint8Array` — `type: 'modal_dismissed'`, `payload: { modal_id, outcome: 'remote', source: 'remote' }` (`outcome` is opaque, `source ∈ WireModalSource`).
- `modalErrorFrame(): Uint8Array` — `type: 'error'`, **`payload: {}`** (bare; **no `in_reply_to` needed** — see § Error handling). Block 2 only.

### Capturing fake (contract sketch)

One factory, parameterized so both blocks share it:

```ts
function capturingModalFake(captured: Envelope[], opts: { rejectAnswers: boolean }): (inbound: Uint8Array) => Uint8Array[]
```

Per inbound: `decodeEnvelope`, `captured.push(env)`, then switch:
- `'list_conversations'` → `[seedConversationsFrame()]` (renders the launch row).
- `'modal_answer'` → `opts.rejectAnswers ? [modalErrorFrame()] : []`.
- `'modal_cancel'` → `[]`.
- default → `[]`.

Block 1 passes `{ rejectAnswers: false }`; block 2 passes `{ rejectAnswers: true }`. (The double-decode — capture then discriminate — is pure and harmless, exactly as run-config's factory does.)

### Locators (scope everything inside the dialog)

```ts
const dialog = page.getByRole('dialog')                          // .permission-modal
const optionButton = (name: string) => dialog.getByRole('button', { name })   // Deny / Allow / Cancel / Back / Confirm
const banner = page.getByRole('alert')                           // .modal-rejection
```

Use `dialog.getByRole('button', { name })` for option/Cancel/Back/Confirm — labels are distinct and only one dialog is present at a time (single-dialog FIFO). The rejection banner is outside the dialog (renders with no outstanding prompt), so locate it on `page`.

## State + concurrency model

**The reject is FIFO by send order, NOT by `in_reply_to` — this is the whole reason for the two-block split.**

`answerModal` (main) pushes the answered `modal_id` onto an `outstandingAnswers: string[]` queue *after* the send succeeds (`daemonConnection.ts:1339`). A daemon `error` that does **not** correlate to a pending `set_session_settings` or `create_workspace_folder` request (by `in_reply_to`) falls through to `outstandingAnswers.shift()` and rejects the **oldest** outstanding answer (`:530-540`). The queue is:

- **populated only by `answerModal`** — `cancelModal` does not push, and a daemon `modal_dismissed` does not push;
- **drained** either by a matching `modal_dismissed` (accept, `:788-789` — `indexOf`/`splice` by `modal_id`) or by an `error` (reject, `shift()`);
- **reset on each `dial()`** (`:1408`) — i.e. once per launch.

Consequence for the spec:
- In **block 1**, happy answers (default-tap A, confirm B) push to the queue and are never drained (their prompts clear *optimistically*, and the fake never sends a `modal_dismissed` for them). That residue is inert because **no `error` is ever pushed in block 1**. Do not attempt a reject in block 1.
- In **block 2**, the fresh launch guarantees an empty queue, so the single answer is `outstandingAnswers[0]` when the `error` arrives → the reject dequeues exactly it → `modalAnswerRejected{ modalId }` → `rejections=[modalId]` → the banner renders.

**Surfacing prompts:** `daemon.pushFrame(modalShownFrame(...))` after launch — the same server-push hook `run-config-settings.spec.ts` uses. The push is async (fake → relay → main → IPC → renderer bridge → store), so wait on the dialog with a roundtrip headroom (reuse the sibling's `const ROUNDTRIP_TIMEOUT_MS = 15_000`).

**Optimistic clear:** `answerPrompt`/`cancelPrompt` dispatch the local `dismissed` unconditionally, so the dialog clears on click regardless of any daemon reply. Between block-1 paths, assert the prior dialog is gone (`await expect(dialog).toHaveCount(0)`) before pushing the next `modal_shown`.

## Error handling

- **`answer_token` is opaque and non-deterministic** — minted main-side via `crypto.randomUUID` (`daemonConnection.ts:1330`). The captured outbound `modal_answer` payload is `{ modal_id, option_id, answer_token }`. **Do NOT deep-equal the whole payload** (unlike run-config's `isDeepStrictEqual`). Match on `modal_id` + `option_id`, and assert `answer_token` is a present non-empty string. Sketch:

  ```ts
  const answersFor = (modalId: string, optionId: string) =>
    captured.filter(e => e.type === 'modal_answer'
      && (e.payload as ModalAnswerPayload).modal_id === modalId
      && (e.payload as ModalAnswerPayload).option_id === optionId
      && typeof (e.payload as ModalAnswerPayload).answer_token === 'string'
      && (e.payload as ModalAnswerPayload).answer_token.length > 0)
  ```

- **The reject `error` frame is bare** (`payload: {}`, no `in_reply_to`). Because the modal reject correlates by FIFO (not `in_reply_to`), an `error` with no `in_reply_to` short-circuits the settings/folder checks and falls straight to the modal shift. `reassembler?.fail('daemon-error')` runs first but is a no-op (no debug bundle in flight).

- The rejection banner is **content-free**: `modalId` is the React key only, never rendered. So the banner assertion is DOM-only (`role="alert"` present + copy text) — it cannot and must not assert *which* `modal_id` it corresponds to.

## Testing strategy

`npm run e2e` (Playwright). Each AC maps to assertions filtered by the path's own `modal_id`:

- **AC2 (default, one tap):** push `modal_shown` A (`default_option_id: 'deny'`). Tap **Deny** (the default). Assert `expect.poll(() => answersFor('…A', 'deny').length).toBe(1)` and the dialog clears (`dialog` count 0).
- **AC3 (non-default → confirm; Back vs Confirm):** push `modal_shown` B. Tap **Allow** (non-default) → confirm sub-step renders (assert the **Confirm**/**Back** buttons). Tap **Back** → the option list re-renders (assert **Allow** button visible again). Re-tap **Allow** → **Confirm** → assert **exactly one** `answersFor('…B', 'allow')` (`.toBe(1)`). The "exactly one" is the robust negative-guard: had Back wrongly sent a frame, the count would be 2. Dialog clears.
- **AC4 (cancel):** push `modal_shown` C. Tap **Cancel** → assert one captured `modal_cancel` with `payload.modal_id === '…C'`; dialog clears.
- **AC6 (remote dismiss):** push `modal_shown` E, assert the dialog renders. Push `modalDismissedFrame('…E')`, assert the dialog clears. Assert **zero** `modal_answer`/`modal_cancel` frames with `modal_id === '…E'` captured (guaranteed absence — E's controls were never clicked, so no frame is ever sent for it).
- **AC5 (reject; block 2):** fresh launch with `{ rejectAnswers: true }`. Push `modal_shown` D. Tap **Deny** (default, one-tap) → assert `answersFor('…D','deny')` captured. The fake replies with the bare `error` → assert the `role="alert"` banner appears with copy `"Your answer was rejected."`. Tap **Dismiss** → assert the banner clears (`await expect(banner).toHaveCount(0)`).

**Fixed literals only** (the fakeDaemon convention): reuse `const REPLY_ENVELOPE_ID = 1`, `const FIXED_TS = '2026-07-07T12:00:00.000Z'` from the sibling. Distinct `modal_id` + `title` per path so transitions and frame filters are unambiguous.

**Typecheck:** `e2e/` is in neither tsconfig ([[e2e-not-typechecked-by-project-config]]). Run whatever standalone `tsc` pass the siblings run (check how `run-config-settings.spec.ts` is type-verified in the repo's e2e tooling / CI) so the new spec's type errors are caught — do not rely on `npm run typecheck` alone.

**Secret hygiene** (carry verbatim from the siblings): every assertion reads DOM text/roles/counts and captured wire frames only; `modal_id`/`option_id`/`title`/`prompt` are non-secret routing & display literals; `answer_token` is asserted present-but-opaque, never pinned or logged. No failure diagnostic serializes a token, key, or plaintext.

## Open questions

- **None blocking.** The reject-as-reply mechanism (block 2's fake returns the `error` from the `modal_answer` arm) relies on `answerModal` pushing to `outstandingAnswers` synchronously before the async `error` round-trips back — verified in the code (`:1334` send, `:1339` push, both synchronous). If a runner ever races this, the equivalent fallback is to assert the `modal_answer` capture first, then `daemon.pushFrame(modalErrorFrame())` explicitly — but the reply path is deterministic and preferred.
