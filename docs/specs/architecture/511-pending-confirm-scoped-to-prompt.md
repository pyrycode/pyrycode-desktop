# #511 — Scope the second-confirm marker to the prompt it was selected on

`security-sensitive` · size **S** · 2 production files, 2 test files, 0 new files

## Files to read first

Codegraph is **not initialized** for this repo (`codegraph_context` → "CodeGraph not initialized"), so
this list is grep/Read-derived, not graph-derived. Read these before writing code:

- `src/renderer/src/screens/conversation/PermissionModal.tsx:185-233` — the container. `:193` is the
  defective marker, `:198-204` the comment that asserts the ineffective net as intent, `:203` the
  derivation, `:214`/`:219`/`:221` the three setter call sites. **These 5 lines plus the comment are the
  entire production edit in this file.**
- `src/renderer/src/screens/conversation/PermissionModal.tsx:34-130` — `PermissionModalView`. Note that
  it already passes `prompt.modalId` as `onSelect`'s first argument (`:118`) — the prompt identity you
  need is *already* handed to the container's handler. The view's props do **not** change.
- `src/renderer/src/screens/conversation/modalResolution.ts:49-82` — `SelectOptionDeps` + `selectOption`,
  the React-free decision seam the new helper joins. **Neither changes** (see § Design).
- `src/renderer/src/store/modalPrompts.ts:132-200` — `reduceModal`. `:157` (`dismissed`) and `:178`
  (`reconnected`) are the two swap routes the regression tests drive through. `:151-153` is the
  in-place `shown` replace that keeps the option-id lookup load-bearing.
- `src/renderer/src/screens/conversation/modalResolution.test.ts:64-121` — the `selectOption` describe.
  Its `requestConfirm` spy assertion (`:100`, `toHaveBeenCalledWith('allow-once')`) must stay green;
  it is the reason `SelectOptionDeps` keeps its signature.
- `src/renderer/src/screens/conversation/PermissionModal.test.tsx:1-53, 135-175` — the harness header
  (why there is no DOM), `renderView`, `optionCount`, and the existing #226 confirm-mode describe your
  new mode assertions should mirror.
- `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx:68-112` — the precedent for
  driving the real store/reducer into a pure view render with no jsdom.
- `vitest.config.ts` — `environment: 'node'`. The "(deferred to #2)" note beside it is stale; treat the
  node env as fixed for this ticket (AC4).
- `docs/specs/architecture/226-second-confirm-allow-answer.md` — the confirm sub-step this ticket
  repairs; confirms the modal chrome is not drawn in Figma.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3

Verified via `get_metadata` on node `22:3`: the "Dialogs" section contains only the Rename, Save as
Channel, Create Folder, and Paste Code dialogs — the permission modal and its confirm sub-step are
**not drawn**, exactly as #226 recorded. `22-3` is the M3 dialog chrome reference `PermissionModal`
already follows (centered panel, leading-dismissive left action, trailing primary right action), and
both modes this ticket switches between are already shipped against it. **This ticket changes no
chrome, copy, layout, or token — only which of the two existing modes renders** — so no new node is
needed and there is no visual-fidelity work for the developer.

## Context

`PermissionModal.tsx:193` holds the #226 second-confirm marker as a bare option-id string with no tie
to the prompt it was selected on. The derivation at `:203` falls back to list mode only if the *new*
prompt happens to have no option with the same id — and the comment above it documents that as a
deliberate safety net.

**That net never fires.** Daemon option ids are a closed per-class vocabulary, not per-prompt nonces.
Confirmed against the daemon source of truth (QMD `pyrycode-docs`,
`knowledge/features/modalbridge-package.md` § "Class → option mapping", the `PermissionRequestForClass`
table):

| wire `class` | option ids (the entire set) | `default_option_id` |
|---|---|---|
| `permission` | `allow_once`, `allow_always`, `reject_once`, `reject_always` | `reject_once` |
| `trust` | `proceed`, `exit` | `exit` |

Every other modal class produces `ok=false` and is never surfaced. So two prompts of the same class
share their **entire** id set, and a held non-default id is *guaranteed* — not merely likely — to match
on the next prompt. The two classes' sets are disjoint, so the carry-over is same-class only; that is
no mitigation, since consecutive `permission` prompts are the common case.

The result: one click on Confirm can answer a prompt whose option list the user never saw, with a
permission-granting option. Three routes swap `outstanding[0]` under a live marker (`modalPrompts.ts:147`
remote `dismissed`, `:169` `reconnected`, and the empty-`outstanding` window — which does *not* self-heal,
because `ConversationScreen.tsx:240` mounts the container unconditionally so returning `null` never
unmounts it).

**Why now:** #510 (merged, `75fcfe1`, on `main`) made the `reconnected` arm clear `resolved` too, so
prompts whose re-delivery was previously suppressed now re-surface — widening route 2's exposure.

## Design

**The marker gets an identity. The correlation key becomes the prompt nonce, not the option id.**

The whole fix is a change of key. `modalId` is a `crypto/rand` UUIDv4 minted exactly once per surfaced
modal at the daemon's single mint site (`Registry.Record`), so it is *distinct per prompt* — the property
the marker needs and the option id never had.

### New in `modalResolution.ts` (the established React-free decision seam)

```ts
/** The held second-confirm marker: which option, on WHICH prompt. */
export interface PendingConfirm {
  readonly modalId: string
  readonly optionId: string
}

/** The rendered prompt's held option, or null (→ list mode). */
export function resolvePendingOption(
  prompt: ModalPrompt | undefined,
  pending: PendingConfirm | null
): ModalOption | null
```

`resolvePendingOption` returns the `ModalOption` only when **both** guards hold, and `null` otherwise:

1. `pending !== null` **and** `prompt !== undefined` **and** `pending.modalId === prompt.modalId` — the
   new guard, and the actual fix.
2. `prompt.options` contains an option whose `id === pending.optionId` — **retained**, and still
   load-bearing. Its job is redemoted, not removed: it is no longer the (broken) cross-prompt net, it is
   now the *within-prompt* net for a `shown` re-delivery that replaces the prompt in place with a changed
   option set (`modalPrompts.ts:151-153`), and it is how the `ModalOption` (needed for the confirm
   sentence's label) is obtained at all. **Do not delete it as newly-redundant.**

Pure, React-free, no logging, no throw — a total function over its two arguments. This is what makes
the fix provable under `environment: 'node'`.

### Changed in `PermissionModal.tsx` (5 lines + one comment)

- `:193` — `useState<PendingConfirm | null>(null)`; rename `pendingOptionId`/`setPendingOptionId` to
  `pending`/`setPending`.
- `:203` — `const pendingOption = resolvePendingOption(prompt, pending)`.
- `:214` — `requestConfirm: (optionId) => setPending({ modalId, optionId })`. `modalId` is the
  `onSelect` handler's own first parameter, which the view sourced from the prompt it actually rendered
  (`:118`) — so the identity is captured from the click, not re-read from a possibly-newer store.
- `:219`, `:221` — `setPending(null)` (unchanged shape).
- `:198-204` — **rewrite the comment.** It currently asserts the ineffective fallback as intended
  behaviour; leaving it would document a guarantee the code does not provide. It must state the real
  contract: the marker is scoped by `modalId`, the option-id lookup is the within-prompt net, and the
  ids are a closed daemon vocabulary (the reason the old net could never fire).

### What deliberately does *not* change

- **`selectOption` and `SelectOptionDeps` are untouched.** `requestConfirm` keeps its
  `(optionId: string) => void` signature; the container supplies the `modalId` from its own closure.
  The ticket is explicit that the classification is unaffected, and this keeps
  `modalResolution.test.ts:100` green — zero churn on an existing passing test.
- **`PermissionModalView`'s props are untouched** — still `pendingOption: ModalOption | null`. All three
  of its call sites (two test files, one container) keep compiling unchanged.
- **The modal store is untouched.** `outstanding` / `resolved` semantics are correct; the defect is
  entirely screen-local.

### Why derivation-only, with no clearing effect

The marker is never cleared on a prompt change, and that is the point. A stateless re-derivation on
every render means there is **no lifecycle to get wrong** and nothing to prove about a `useEffect` under
an SSR-only harness. A stale marker becomes *inert* — it can only ever match the prompt it was minted
against. AC2 (the empty-`outstanding` window) therefore becomes structurally true rather than defended:
`prompt === undefined` → `null`, and repopulation with a different `modalId` → mismatch → `null`.

**Deliberate consequence to name, so code-review does not read it as a leak:** if the *same* prompt
returns (a `reconnected` + daemon re-send of a still-outstanding prompt), the confirm sub-step is
restored with the held option. That is correct — the user did see that prompt's option list and did
select that option on it — and confirming answers the prompt they reviewed.

## State + concurrency model

One `useState` in one leaf component; no store slice, no async task, no timer, no listener, no
`AbortController`. Nothing to tear down.

The old design was a **check-then-act on shared state**: the marker was read at click time and acted on
at confirm time, with the store free to mutate in the gap. The fix removes the gap — `pending` and
`outstanding` are read in the *same render pass*, so the Confirm button only exists while the identity
currently matches.

The one remaining race is benign and worth stating: a click queued against a paint whose prompt has
since been swapped fires `answerPrompt(A.modalId, heldOption)` for prompt **A** — the prompt the user
actually reviewed. It can never fire against B. And an answer to an already-resolved A is inert
daemon-side: `Registry.Resolve` is a consume-and-retire one-shot (QMD, `modalbridge-package.md`
§ "first-answer-wins is structural in `Resolve`"), so the stale answer is dropped, not double-applied.

## Error handling

None added. `resolvePendingOption` is total: every failure mode (no prompt, no marker, wrong prompt,
missing option) collapses to `null`, which renders list mode — the fail-safe direction (show the options
again, require a fresh selection). No throw, no result type, no user-facing surface, no log call.
**Nothing from the prompt (`title` / `prompt` / option `label`) may be logged** — it is daemon-supplied
application content.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) + `npm run typecheck` / `npm run build`. **No DOM harness, no
new dependency, no new test file** (AC4).

### `modalResolution.test.ts` — a new `resolvePendingOption` describe

Fixtures must draw from the **real daemon vocabulary** — two `permission` prompts with distinct
`modalId`s and the *identical* option-id set `allow_once` / `allow_always` / `reject_once` /
`reject_always`, `defaultOptionId: 'reject_once'`. A pair with disjoint ids does not exercise the bug
(AC1). Scenarios:

- Marker armed on A's `allow_always`, rendered prompt is **A** → returns A's `allow_always` option.
- Marker armed on A's `allow_always`, rendered prompt is **B** → `null`. The headline assertion. **Also
  assert that B's option list genuinely contains `allow_always`**, so the test cannot pass vacuously
  through an accidental id mismatch.
- Rendered prompt `undefined` (the empty-`outstanding` window) → `null`.
- Marker `null`, rendered prompt A → `null`.
- Marker armed on A, rendered prompt is A **re-delivered without that option id** → `null` (the retained
  within-prompt net).
- The `trust` pair (`proceed` / `exit`, distinct `modalId`s), cross-prompt → `null` — the second closed
  vocabulary.

### `PermissionModal.test.tsx` — a new swap-regression describe

Drive the **real reducer** (`reduceModal` from `../../store/modalPrompts`) so the live routes are
exercised rather than hand-built arrays, then render `PermissionModalView` with the derived
`pendingOption` and assert the mode. Reuse the existing `optionCount` helper.

- **Route 1 — remote `dismissed` (AC1):** `shown(A)` → `shown(B)` → arm the marker on A → `dismissed`
  for A with `source: 'remote'` → assert `outstanding[0]` is B → derived `pendingOption` is `null` →
  markup is **list mode** (option buttons present, `permission-modal__cancel` present, no
  `permission-modal__confirm`, no confirm sentence).
- **Route 2 — `reconnected` + re-send (AC2):** `shown(A)` → `shown(B)` → arm on A → `reconnected` →
  **assert `outstanding.length === 0` at this point**, so the empty window is explicitly exercised and
  the test cannot silently skip it → `shown(B)` re-send → derived `pendingOption` is `null` → list mode.
- **AC3 positive control, same describe:** marker armed on A, rendered prompt A → the view renders
  **confirm mode** (`permission-modal__back` + `permission-modal__confirm` present, `optionCount === 0`).
  This is the **mutation control and it is not optional**: without it, a `resolvePendingOption` that
  simply returned `null` always would pass every negative test above. (#510's code review caught exactly
  this vacuous-pass shape — a new test satisfied by a no-op.)

The rest of AC3 (Back returns to the list without sending; Confirm answers *that* prompt with the held
option) is already covered and must stay green: the existing #226 describe
(`PermissionModal.test.tsx:137-175`) proves both modes' markup, and `modalResolution.test.ts` proves the
click→command wiring with plain spies. Do not duplicate them.

The existing container test (`PermissionModal.test.tsx:216-220`, empty-case → `''`) is unaffected — the
`useState` initial value stays `null`, only its type changes.

## Open questions

None blocking. One judgement call recorded above for code-review to confirm rather than re-litigate:
the same-`modalId` re-delivery deliberately restores the confirm sub-step (§ Why derivation-only).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] The defect itself is a trust-boundary error, and the fix closes it.** Daemon
  content (`title`, `prompt`, `options[].id/label`) is untrusted; the pending marker is client-owned
  trusted UI state. The old code correlated trusted state by an *untrusted, daemon-controlled,
  non-unique* key (`option.id`, drawn from a 4-value closed set). The fix correlates by `modalId` — a
  daemon-minted `crypto/rand` UUIDv4, one per surfaced modal (QMD `modalbridge-package.md` § "`modal_id`
  nonce — the single-writer security primitive"). The property relied on is **distinctness, not
  secrecy**, which is exactly what `Record`'s single-mint-site guarantees. No new boundary is created;
  an existing one is given a correct key.
- **[Trust boundaries] Residual, not exploitable in the threat model:** a peer that re-delivered the same
  `modalId` with *different* content could carry a confirm onto changed content (the `shown` in-place
  replace, `modalPrompts.ts:151-153`, combined with guard 2 still matching). Against the real daemon this
  is unreachable: `Record` mints a **fresh** id per surfaced modal and is the single mint site, and
  connect-time re-delivery replays the stored payload verbatim from `Registry.Snapshot()` — so the same
  `modalId` implies the same content by construction. It requires a compromised or impersonating daemon
  *inside* the Noise session, which ADR 025 places outside this client's threat model. Not a MUST FIX;
  named rather than silently assumed. (Checked per the #510 review lesson: a claim that "state X can only
  be set here" must enumerate who else sets X — here, the two `outstanding[0]` swap routes and the
  in-place `shown` replace.)
- **[Tokens, secrets, credentials] No findings.** No token path is touched. `answer_token` is minted
  MAIN-side in `daemonConnection.answerModal` (#236); the renderer payload carries only
  `modal_id` + `option_id`, asserted by the existing test at `modalResolution.test.ts:33-42`. `modalId`
  is an opaque correlation nonce, not a credential, so holding it in renderer React state adds no secret
  exposure and no new storage surface.
- **[File / storage operations] Not applicable — no filesystem or persistence surface.** The marker is
  in-memory React state scoped to one leaf component; it is not persisted, not serialised, and dies with
  the window. No path is constructed, no file is read or written.
- **[Inter-process / Electron attack surface] No findings; the change strictly narrows the surface.** No
  new IPC channel, no `contextBridge` addition, no preload change, no `webPreferences` change. The only
  bridge call remains `window.pyry.sendCommand`, still dereferenced inside handler closures at
  interaction time. The security-relevant effect is on IPC *semantics*: it removes the state in which a
  single click emits an `answerModal` for a prompt the user was never shown — a strict reduction in the
  set of commands the renderer can be induced to emit.
- **[Cryptographic primitives] Not applicable, with justification.** No primitive is introduced. The
  `modalId` comparison is a plain equality check, and `crypto.timingSafeEqual` is deliberately *not*
  warranted: `modalId` is not a credential and nothing is authorized by matching it client-side. Every
  answer is re-validated server-side against the daemon's own registry (`Lookup` then the one-shot
  `Resolve`), so a client-side match is a UI-routing decision, not an authorization decision.
- **[Network & I/O] Not applicable — no socket, frame, URL, timeout, or TLS surface is touched.** This is
  a renderer-local derivation; the transport is not on the change path.
- **[Error messages, logs, telemetry] No findings, with one explicit constraint.** The design adds no log
  call and no error path — `resolvePendingOption` is total and returns `null` on every failure mode.
  Constraint carried into § Error handling: the prompt's `title` / `prompt` / option `label` are
  daemon-supplied application content and must **not** be logged at any level, matching the daemon-side
  rule that the modal body is never logged.
- **[Concurrency] The fix removes a check-then-act race; no new async is introduced.** The old marker was
  read at click time and acted on at confirm time with the store free to mutate in the gap. Re-deriving
  every render closes the gap: Confirm exists only while the identity currently matches. The one residual
  ordering case — a click queued against a stale paint — can only fire `answerPrompt` for the prompt the
  user reviewed (never the swapped-in one), and is inert daemon-side because `Registry.Resolve` is a
  consume-and-retire one-shot. No timer, listener, `AbortController`, or long-lived task is created, so
  there is nothing to cancel on teardown.
- **[Threat model alignment] This ticket hardens against the in-scope adversary.** The relay is
  content-blind but **on-path**: it can drop, delay, and reorder. Reordering or delaying `modal_shown` /
  `modal_dismissed` frames is precisely what makes swap routes 1 and 2 reachable *without any daemon
  misbehaviour at all* — so the vulnerability is triggerable by the adversary ADR 025 explicitly models,
  not only by a hostile peer. Hostile-daemon content substitution is named above and deferred as out of
  scope (ADR 025). Renderer-compromise reach is unchanged: no new capability is exposed, and keys,
  sockets, and the Noise session remain main-process-only.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
