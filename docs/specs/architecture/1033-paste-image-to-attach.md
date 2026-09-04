# #1033 — paste an image from the clipboard into the message box to attach it

The third entry into #862's attach flow, after the button (#863) and the drop (#890). It is the
**keystroke half only**: #1032 already shipped `window.pyry.pasteAttachmentImage()`, the main-side
clipboard reader behind it, the `no-image` refusal and its sentence. What is missing is the decision
about whether a given paste is an attach or ordinary text, and the handler on the message box that
acts on it.

## Files read

| Path | Symbols | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/ComposerAttach.tsx` | `dragCarriesFiles`, `useAttachmentUpload`, `useComposerFileDrop`, `ComposerAttachOutcome` | The precedent for the pure decision function, and the hook that owns the clear-then-fire act this slice becomes the third member of. |
| `src/renderer/src/screens/conversation/ComposerAttach.test.tsx` | `describe('dragCarriesFiles')` | The static tier's shape for a types-list decision: one truthy table, one falsy table, `undefined` included. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | the `.composer` div, the `.composer__input` textarea, `attach`, `fileDrop` | The two candidate mount points and the standing rule that neither class run may change. |
| `src/renderer/src/screens/conversation/composerSlot.test.tsx` | the `class="composer__input"` assertion | A whole-attribute-run match on the textarea — the reason this slice adds no class. |
| `src/preload/index.ts` | `pasteAttachmentImage` | The ask: no argument, fire-and-forget, already typed into the renderer through `PyryApi`. Nothing to build here. |
| `src/main/attachmentUpload.ts` | `uploadClipboardImage`, `CLIPBOARD_IMAGE_FILENAME_PREFIX` | What the ask actually does — reads the clipboard in main, refuses `no-image`, otherwise joins the shared guard. Confirms the window never holds a byte. |
| `src/main/transport/attachmentTransfer.ts` | module header, `AttachmentTransferFailure` | **No per-transfer deadline.** A transfer whose chunks all went out waits indefinitely — which decides how the e2e must script the fake daemon (below). |
| `src/main/daemonConnection.ts` | the `daemon-error` case, `sentEnvelope` | An `error` frame whose `in_reply_to` names a sent chunk fails that transfer with the mapped outcome. This is the e2e's deterministic terminal. |
| `src/main/transport/inboundMessage.ts` | `narrowDaemonErrorOutcome` | `attachment.storage_failed` → `attachment-storage-failed`, the reason the sibling drop spec already renders. |
| `e2e/composer-file-drop.spec.ts` | the `drag` helper | The synthetic-event drive, and `dispatchEvent(…) === false` as the only observable proof that `preventDefault` ran. |
| `e2e/message-copy.spec.ts` | the `app.evaluate(({ clipboard }) => …)` seam | Touching the real OS clipboard from main, and the recorded decision to clobber it without restoring. |
| `docs/knowledge/features/attachment-upload.md` | § The paste ask, § the drive-through diagram | Records that #1032 left the whole chain unproven and assigned the proof here. |
| `docs/knowledge/features/composer-attach.md` | § the outcome slot | One nullable renders whichever event arrived last — why "exactly once, no second indicator" is true by construction. |

**Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized."** The reading list above came from grep and Read.

## Design source

**Figma:** N/A — echoed from the ticket. A paste has no affordance before it happens, and its outcome
renders through #863's existing composer copy. The ticket flags a separate design pass for showing the
pasted picture in the composer before send; this slice does not open it.

## Context

#1032 landed the entire background half. The renderer half is two additions and one prop:

1. `pasteCarriesImageOnly(types)` — a pure predicate over the advertised type list, `dragCarriesFiles`'s
   sibling.
2. `pasteImage()` — a third member of `useAttachmentUpload`, alongside `requestAttach` and `dropFile`,
   performing the same clear-then-fire act.
3. `onPaste` on the message box, which consults (1) and calls (2).

No ADR is warranted: this adds no contract, no channel and no new decision — it is the third consumer of
a shape #890 already established, and the reasoning belongs in `composer-attach.md`.

## Design

### The mount point: the textarea, not `.composer`

#890 spread its drop handlers onto the outer `.composer` div so a drop on the footer row would count.
**A paste takes the opposite call and mounts on the `.composer__input` textarea.** The reason is that
the handler's whole job is to *suppress a default*, and the textarea is the only element in the composer
that has one. Mounting on `.composer` would additionally intercept a paste made while a footer button
holds focus — a keystroke with no default to prevent and no text destination — turning an inert gesture
into an upload. Narrower is the correct call for a handler whose effect is to start a network transfer.

A `paste` fires on the focused element and bubbles, so both mount points are reachable; this is a choice
about *scope*, not about reachability.

**No class is added and no class run changes.** `onPaste` is a React event handler: it renders no
attribute at all under `renderToStaticMarkup`, so `composerSlot.test.tsx`'s whole-run match on
`class="composer__input"` — and `ConversationScreen.tsx`'s own `class="composer" hidden=""` runs — are
untouched by construction rather than by care.

### `pasteCarriesImageOnly(types: readonly string[] | undefined): boolean`

`dragCarriesFiles`'s shape verbatim — advertised types in, boolean out, `undefined` tolerated and
answering false. Two conjuncts:

- **It advertises an image.** True when the list holds `'Files'`, or any entry whose type begins
  `image/`. Both arms are needed and neither is redundant — see the measurement note below.
- **It advertises no plain text.** `'text/plain'` present ⇒ false, unconditionally, whatever else rides
  alongside.

The second conjunct is the ticket's stated rule and it is a security bound rather than a convenience:
a password-manager secret is `text/plain`, so it can never take the attach branch. It also keeps the
ordinary paste path — including a copied web-page selection that carries both flavours — completely
untouched.

**Why the image test is a disjunction, and why the breadth is measured rather than assumed.** Chromium
normalises the OS clipboard before exposing it to a page, and it is not self-evident from the DOM spec
whether a bitmap on the system clipboard surfaces as a bare `'Files'` entry (the file-item spelling) or
as an explicit `image/png` entry. Guessing one and shipping it risks a screenshot paste that silently
does nothing. The disjunction covers both spellings, and **the e2e spec captures the real list during a
real trusted paste and asserts what it contains**, so the breadth is evidence rather than defensiveness.

The one thing the `'Files'` arm admits that the `image/` arm would not is a *file* copied in Finder or
Explorer, which the ticket puts out of scope. That case is accepted, not overlooked: main reads the
clipboard itself, finds no bitmap, and reports `no-image`. The operator gets an honest refusal sentence
instead of silence — strictly better than the alternative failure, a screenshot paste doing nothing at
all. No byte, path or filename is involved either way.

### `pasteImage(): void` on `useAttachmentUpload`

```ts
pasteImage: () => void   // setOutcome(null); window.pyry.pasteAttachmentImage()
```

The third member of the hook that already owns this act for `requestAttach` and `dropFile`, reused for
consistency rather than re-implemented at the gesture site. The hook's docblock records *why* the clear
was originally built — a cancelled picker reports nothing at all, stranding a previous line. **That
reason does not arise here**: #1032's main-side path draws exactly one terminal for every ask, so the
clear on this member is for consistency of ownership, not for a stranding it prevents. The plan records
that so a later reader does not infer a hazard that isn't there.

`window.pyry` is dereferenced inside the closure only, never during render — the standing rule that
keeps every static render of the composer bridge-free.

### The handler

```tsx
onPaste={(event) => { if (!pasteCarriesImageOnly(event.clipboardData?.types)) return
                      event.preventDefault(); attach.pasteImage() }}
```

Three lines, and the early return is the whole of "text pastes stay text": a clipboard this predicate
declines is not consumed, not prevented and not reported — the default paste runs exactly as it does
today. `clipboardData` is read for `types` and nothing else; `getAsFile`, `getAsString` and `.files` are
never touched, which is AC3 stated as an absence at the only site that could violate it.

## State + concurrency model

No new state. The outcome nullable in `useAttachmentUpload` is the only state involved and it already
exists; this slice adds a third writer of the same clear. No store slice, no async task, no
subscription, no cancellation path — the ask is fire-and-forget and its terminal arrives on the
already-subscribed outcome channel whose unsubscribe handle is the existing effect's cleanup.

Two pastes in quick succession mint two independent uploads in main; the composer states whichever
terminal arrives last, exactly as it does for two concurrent picker uploads. That is #863's documented
behaviour and this slice neither improves nor regresses it.

## Error handling

No new failure mode reaches the renderer. Every terminal — `completed`, `refused` with either reason,
`failed` with a driver outcome — is already a member of `AttachmentUploadEvent` with a sentence in
`attachmentUploadCopy`, rendered through #863's single nullable slot. AC4's "exactly once, with no
second indicator beside it" is true by construction: one nullable, one render, latest event wins.

The handler itself has no failure branch. A clipboard that does not qualify is a return; one that does
is an ask that cannot fail locally.

## Testing strategy

**Static tier (vitest, `renderToStaticMarkup`, `environment: 'node'`)** —
`ComposerAttach.test.tsx` gains a `describe('pasteCarriesImageOnly')` block, `dragCarriesFiles`'s shape:

- true for the image spellings with no text: `['Files']`, `['image/png']`, `['image/png', 'Files']`,
  `['Files', 'text/html']`
- false for every list carrying `'text/plain'`, image alongside or not — the security bound, as a table
- false for `[]`, `undefined`, and for text-only and uri-list lists

**e2e (`e2e/composer-paste-image.spec.ts`, default fake tier — no `real-*` name, no
`needs-real-claude`)** — one `test()`, one launch, one continuous drive, the sibling specs' shape. Two
complementary halves:

1. **The branch matrix, synthetically.** `composer-file-drop.spec.ts`'s drive applied to `paste`: build
   a `DataTransfer` in page context, dispatch a `ClipboardEvent` on `.composer__input`, and read
   `dispatchEvent(…) === false` as the proof `preventDefault` ran. This is the only observable detector
   for the prevention — an untrusted event performs no default action, so watching the textarea proves
   nothing here. Image-only ⇒ prevented; image+text ⇒ not prevented; text-only ⇒ not prevented.

2. **The whole chain, for real** — the proof #1032 deliberately left unproven and assigned to this
   ticket. Seed the real OS clipboard from main (`clipboard.writeImage`, `message-copy.spec.ts`'s
   `app.evaluate` seam and its recorded clobber-without-restore decision), focus the message box, and
   drive a **trusted** paste with `webContents.paste()`. Then:
   - the real image clipboard produces a terminal in `.composer__attach-outcome` — the first end-to-end
     evidence that keystroke → predicate → ask → main's clipboard read → PNG encode → guard → transfer →
     wire → terminal → composer actually joins;
   - a real **text** clipboard pasted the same way lands its text in the message box and produces no
     outcome at all;
   - a page-side probe records `clipboardData.types` during the real image paste, and the spec asserts
     the predicate's own answer for that measured list is `true` — which is what makes the disjunction
     above evidence-backed rather than assumed.

   **The fake daemon must be scripted, because there is no per-transfer deadline.**
   `attachmentTransfer.ts` waits indefinitely for an answer, so an unanswered chunk yields no terminal
   and the assertion would hang to the suite timeout. `buildReplyFrames` answers an `attachment_chunk`
   with an `error` frame carrying `in_reply_to: <the chunk's envelope id>` and
   `code: 'attachment.storage_failed'`, which `daemonConnection`'s `daemon-error` case correlates via
   `sentEnvelope` and turns into `failed` / `attachment-storage-failed`. The expected sentence is
   derived by calling `attachmentUploadOutcomeCopy`, never typed out, so the spec cannot drift from the
   copy.

**Secret hygiene**, the sibling specs' standing rule: every literal is a non-secret invented value,
every assertion reads DOM text, classes, counts, a boolean or a list of format *names*. The seeded
image is a tiny invented PNG built in main; no member of `AttachmentUploadEvent` can hold a path, a
filename or a byte.

## Size

**2 production source files** (`ComposerAttach.tsx`, `ConversationScreen.tsx`), 1 consumer call site,
4 acceptance criteria, 0 reject branches, 0 new exported types/components/stores — every boundary well
inside the table.

**Total written work is expected at roughly 850–950 lines, over the 800-line ceiling, and that overage
is stated rather than split.** The deliverable is one behaviour and `pasteCarriesImageOnly` has exactly
one consumer — the handler beside it — which is the one-consumer floor the sizing guide places above
the ceiling; splitting the e2e drive off would separate a fix from its liveness test. The calibration
agrees: every merged slice in this family exceeded 800 lines of builder-written work (#863 ~1382,
#890 ~1104, #1032 ~881) and each landed well inside the builder's budget.

## Open questions

1. **What does Chromium actually advertise for an OS-clipboard bitmap?** Resolved by measurement in
   Phase B, in the e2e spec itself — the design is already robust to either answer, and the spec records
   which one is real.
2. **Does `webContents.paste()` deliver a trusted `paste` to the focused textarea under the Playwright
   Electron fixture?** If it does not, the chain-joins proof falls back to asserting the ask fired
   (a main-side recorder on the upload channel) while half 1 keeps the whole branch matrix. Recorded in
   `## Revisions` if the fallback is taken.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings, but one claim in the ticket needs narrowing in code, and that is
  SHOULD FIX below.** This slice widens no boundary: the renderer→main crossing is the already-shipped
  `ATTACHMENT_UPLOAD_CHANNEL` send in `pasteAttachmentImage`, which takes no argument, builds
  `{ source: ATTACHMENT_PASTE_SOURCE }` from a preload-owned literal, and is narrowed on the far side by
  `isAttachmentPasteRequest`. No renderer-supplied value reaches a path, a filename, a byte or the wire.
  The one new thing crossing is *that the ask happened*, which is the feature.
  The adversarial reading that matters: **`pasteCarriesImageOnly` is not a security control.** A
  compromised renderer calls `window.pyry.pasteAttachmentImage()` through `contextBridge` directly and
  never runs the predicate, so the `text/plain` refusal is the *ergonomic* half of the rule and main's
  own clipboard read is its enforcement — a text-flavoured secret yields an empty image and `no-image`.
  Checked the awkward case too: a secret copied as `text/html` only, riding beside a bitmap, passes the
  predicate — and still leaks nothing, because `clipboard.readImage()` reads the image flavour and
  uploads that. The two checks disagree about what "an image" is and the bound holds anyway, because
  the enforcing one is the one that touches bytes.

- **[Tokens, secrets, credentials] No findings.** No token, key or credential is in this slice's reach.
  The secret at risk is the *clipboard content*, and the handler reads `clipboardData.types` — a list of
  format **names** — and nothing else. `getAsFile`, `getAsString` and `.files` are never touched (AC3),
  the boolean the predicate returns is not stored, and no clipboard value reaches renderer state. A
  password-manager secret contributes the string `'text/plain'` and no more.

- **[File / storage operations] No findings — structurally, not by care.** This slice performs no
  filesystem call and names no path. The uploaded file's name is minted in main from
  `CLIPBOARD_IMAGE_FILENAME_PREFIX`, a client-owned constant the ask carries no field to influence, so
  there is no untrusted input to traverse with and no check-then-open gap to race.

- **[Inter-process / Electron attack surface] No findings; the residual is named under Threat model.**
  No new channel, no new bridge member, no `webPreferences` change. The honest examination: mounting
  `onPaste` does let *any* renderer script drive this handler with a synthesised `ClipboardEvent`. That
  grants nothing — the same script can call `pasteAttachmentImage()` directly, which is strictly easier
  — so the handler adds no capability an attacker did not already have.

- **[Cryptographic primitives] Not applicable, with the reason.** No randomness, comparison or key
  material in this slice. The transfer's `uploadId` is `randomUUID()` in main, untouched here.

- **[Network & I/O] OUT OF SCOPE, bounded, and deliberately not defended here.** A held-down paste starts
  one upload per keystroke and there is no client-side rate limit. Adding one would defend a failure
  nobody has observed, and would sit in the layer a compromised renderer bypasses — the wrong fabric.
  The bounds that do exist are the per-upload byte guard in `uploadClipboardImage`'s shared path and the
  daemon's `attachment.too_many_uploads` concurrency answer, which the ticket names as where this stays
  bounded. Recorded so a future ticket that observes a real flood knows the gap is here.

- **[Error messages, logs, telemetry] SHOULD FIX — and the hazard is created by this plan's own testing
  strategy.** The handler must log nothing: a `console.log` of `types` puts clipboard *shape* in DevTools
  and a diagnostic record puts it in a debug bundle an operator can send off-box, which would undo
  #1032's "NOTHING ABOUT THE CLIPBOARD IS LOGGED AT ALL". The specific risk is that § Testing strategy
  calls for **measuring** the advertised type list — that probe must live in
  `e2e/composer-paste-image.spec.ts` only and must never appear in `ComposerAttach.tsx` or
  `ConversationScreen.tsx`. Phase B check: no logging call and no `console.` in either production file's
  diff. No sentence rendered by `attachmentUploadCopy` carries clipboard content, so the outcome slot is
  not a channel either.

- **[Concurrency] No findings.** No async work, no timer, no `AbortSignal`, and no listener registered
  outside React's own delegation — `onPaste` lives and dies with the component. The outcome subscription
  it feeds already exists and its cleanup is the existing effect's unsubscribe handle, unchanged. Two
  fast pastes mint two independent uploads in main and the composer states the latest terminal, which is
  #863's documented behaviour for two concurrent uploads rather than a new race.

- **[Threat model alignment] OUT OF SCOPE, per the ticket's explicit instruction.** #1032's review named
  the residual: a compromised renderer can cause an *unprompted* upload of whatever image the operator
  happens to be holding. This ticket is where a gesture-bound ask would go if that residual were judged
  too wide. **It has not been, and this slice must not close it** — a confirmation added here is
  bypassed by the `contextBridge` call above, so it would cost an interruption on every legitimate paste
  and buy nothing against the attacker it names. No confirmation, no gesture correlation, no permission
  prompt. Malicious relay: unchanged and content-blind; this slice puts no new plaintext anywhere.
  Hostile daemon: every terminal it can cause is already a member of the closed `AttachmentUploadFailure`
  set with copy written for it, and this slice makes no new member reachable.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — both Open Questions resolved by measurement, and one e2e restructure they forced

**Open question 1 — what Chromium advertises for an OS-clipboard bitmap: `['Files']`, and nothing else.**
Measured in `e2e/composer-paste-image.spec.ts` by seeding a real bitmap with `clipboard.writeImage` and
driving a trusted paste, with a capture-phase probe recording the flavour list. There is **no
`image/png` entry**. The design's disjunction is therefore not defensive breadth — the `'Files'` arm is
the one that makes the feature work at all, and an `image/*`-only predicate would have shipped a
screenshot paste that silently did nothing. The `image/*` arm is kept for the page-image spelling. The
production docblock on `pasteCarriesImageOnly` now states the measurement rather than the open question.

**Open question 2 — `webContents.paste()` does deliver a trusted paste under the Playwright Electron
fixture.** The fallback the plan reserved was not needed; the chain-joins proof is driven by a gesture
Chromium performed itself, end to end.

**The e2e drive was restructured, and the reason is a design fact the plan had recorded and the first
draft still got wrong.** The plan (and the ticket) noted that the ask is *not* intercepted in this tier
— it crosses to the real main handler, which reads the real OS clipboard. The first draft ran the
synthetic branch matrix *before* seeding, so the synthetic image-only paste earned a terminal from
whatever the machine happened to be holding, and the spec's result depended on the operator's clipboard.
Seeding now happens before any paste can fire. Two consequences worth recording:

- The synthetic image-only arm now earns a **deterministic** terminal, so it proves the ask reaches the
  flow rather than merely that `preventDefault` ran.
- Both arms end in the same single slot, so a second "the sentence is present" assertion would have
  passed on the first arm's line. The fake daemon now rejects the first upload and later ones with
  **different** daemon codes (`attachment.storage_failed`, then `attachment.too_many_uploads`), making
  the trusted paste's terminal a fresh observation rather than a stale one. This is the vacuous-pass
  shape the repo's `?? ''` lesson warns about, in a different costume.

**One assertion was added that the plan did not name:** the fall-through arms assert the outcome line is
still standing. That is a stronger detector than `prevented === false` — it proves *no ask fired*,
because clearing the line on the gesture is something only the attach path (`pasteImage`) does. A
handler that prevented nothing but asked anyway passes the first check and fails this one.

No change to the design itself: the predicate, the hook member, the mount point and the security posture
are as committed.
