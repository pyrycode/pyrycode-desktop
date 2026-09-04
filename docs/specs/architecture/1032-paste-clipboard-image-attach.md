# #1032 — upload the image on the clipboard, or say why not

A THIRD ENTRY into #862's finished attach flow, and the second one to widen the channel that #890
opened. Everything from the size guard onward already exists and is called, not copied. What a paste
changes is that there is no path at all: a screenshot on the clipboard is a bitmap the OS holds, so the
ask carries nothing and the background process reads the clipboard itself.

This slice is the half with no composer surface. The keystroke that fires the ask is #1033.

## Files read

Codegraph is not initialised in this repo (`codegraph_*` answers "CodeGraph not initialized" as a hard
error, not an empty result), so this list came from Grep/Read.

- `src/shared/ipc/attachmentUpload.ts` → `ATTACHMENT_UPLOAD_CHANNEL`, `isAttachmentUploadRequest`,
  `AttachmentUploadEvent` — the channel this slice widens for the second time, the guard whose refusal
  must stay as sharp as it is, and the union whose `refused` member has to split.
- `src/shared/ipc/attachmentUpload.test.ts` → the two union tests the ticket names as passing
  vacuously over a new member (`declares no field beyond the listed ones`, `discriminates on type
  across all four members`), and #890's guard table this slice's guard tests mirror.
- `src/main/attachmentUpload.ts` → `uploadAttachmentBytes`, `driveUpload`, `AttachmentUploadFile`,
  `AttachmentUploadDeps`, `reportRefused`, `LOG_EVENT` — the seam exported for this entry, and the
  header's Electron-free commitment that decides where the clipboard read may live.
- `src/main/attachmentUpload.test.ts` → `harness`, `everyStringEmitted`, `UUID_V4` — the leak-walk and
  fake-driver idiom this slice's new tests reuse rather than reinvent.
- `src/main/index.ts` → `attachmentUploadListener`, `pickerOpen`, `setPermissionRequestHandler` — the
  listener this slice widens, the flag that stays scoped to the dialog, and the permission allowlist
  whose standing instruction this ticket's security section owes an argument to.
- `src/preload/index.ts` → `requestAttachmentUpload`, `dropAttachmentFile`, `api` — the two shipped
  senders this slice sits beside, and the object `PyryApi` is inferred from (so `index.d.ts` needs no
  edit).
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` → `attachmentUploadOutcomeCopy`,
  `ATTACHMENT_UPLOAD_FAILURE_COPY` — the compiler-forced switch the split `refused` member reddens, and
  the `Record`/`Map` pair the new reason must NOT be added to (it is a refusal, not a failure).
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachOutcome`,
  `useAttachmentUpload` — read to confirm the outcome slot renders ANY event through
  `attachmentUploadOutcomeCopy`, so this slice needs no renderer component change at all.
- `docs/specs/architecture/890-composer-file-drop.md` — the nearest worked example of widening this
  channel, including the boundary-guard reasoning and the stated-not-split sizing precedent.
- `e2e/message-copy.spec.ts` — the standing regression guard for the permission-allowlist line, and the
  only place in this repo that drives the real OS clipboard. Read to price a spec here; left untouched.

## Design source

**Figma:** N/A — no new visual surface. The refusal sentence renders in #863's existing composer
outcome slot (`.composer__attach-outcome`), and the paste gesture has no affordance before it happens.
The verifier's visual-fidelity check is intentionally skipped for this slice.

## Context

#862 shipped the headless attach flow, #863 its outcome surface, #864 in-flight progress, #890 the
dropped-file entry. A pasted image is the third entry, and the first that cannot name a file.

**The presence discriminator is already taken, and that is the substance of this slice.** The shipped
listener tells two entries apart by presence alone: argument-free is the picker, an argument is a
dropped path. A third entry cannot be argument-free, and must not be mistaken for a path ask. Widening
that contract while keeping the guard's refusal exactly as sharp is the work here.

The design decision worth an ADR — that a THIRD ask on one channel is told apart by a named
discriminator on the new shape rather than by re-shaping either shipped one, so `RendererCommand` stays
out of it and there is still exactly one place a path enters main from the window — is recorded in the
two headers this slice corrects (`src/shared/ipc/attachmentUpload.ts`'s presence paragraph and
`src/main/index.ts`'s listener comment). The documentation phase owns whether that earns an ADR.

## Design

Five production files, the ticket's estimate exactly.

### 1. `src/shared/ipc/attachmentUpload.ts` — the paste ask, its guard, and the refusal split

Three additions and one split.

| Symbol | Contract |
|---|---|
| `ATTACHMENT_PASTE_SOURCE` | The literal `'clipboard-image'`. The one client-owned string on this ask. |
| `AttachmentPasteRequest` | `{ source: typeof ATTACHMENT_PASTE_SOURCE }` — one field, and it carries no information beyond "which entry". |
| `isAttachmentPasteRequest(value: unknown): value is AttachmentPasteRequest` | `isAttachmentUploadRequest`'s shape verbatim: narrow to non-null `object`, `in`-guard `source`, typeof the value actually found, then compare to the literal. |

**The ask carries nothing, and that is the design's central property here.** Where #890 had to admit a
host path because the OS hands a drop to the WINDOW, a clipboard is readable from the background
process. So the reverse cut is available and is taken: the ask names an entry and nothing else, and no
renderer-supplied value reaches a path, a filename, a byte or the wire. The discriminator is a
client-owned literal the guard compares against — a renderer cannot vary it without being refused.

**A named field rather than an empty object.** `{}` would be indistinguishable from a malformed ask and
would turn "anything object-shaped that is not a path ask" into an upload trigger, which is the guard
getting BLUNTER, not sharper. A named literal is the only shape that admits exactly one thing.

**The `refused` member splits in two**, and that shape is forced by the ticket's own measurement:
widening `reason` in place typechecks and then renders the too-large sentence, limit figure and all,
for a clipboard that held no image.

```ts
| { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
| { type: 'refused'; uploadId: string; reason: 'no-image' }
```

Two members sharing one `type` is what makes the build go red: narrowing on `type === 'refused'` yields
both, so `event.limitBytes` no longer typechecks in `attachmentUploadOutcomeCopy` until that arm
branches on `reason`. `limitBytes` is ABSENT from the new member rather than optional — a no-image
refusal has no limit to state, and an optional field would let the same sentence render with
`undefined` in it.

The new member is declared BELOW the shipped one with its own docblock, and the shipped `refused`
docblock stays bound to the `too-large` member it documents — a declaration inserted between a docblock
and its symbol orphans it, and no gate in this repo catches that.

`AttachmentUploadFailure` is NOT touched. AC2 rules the no-image case out of it; it is a refusal.

### 2. `src/preload/index.ts` — the third sender

One new `api` member beside the two shipped ones:

```ts
pasteAttachmentImage: () => void
```

Argument-free at the bridge, sending `{ source: ATTACHMENT_PASTE_SOURCE }` on
`ATTACHMENT_UPLOAD_CHANNEL`. It is the closest of the three to `requestAttachmentUpload`'s posture —
the window names an intent and the background process owns everything else — and it is deliberately
NOT `dropAttachmentFile`'s shape: no `File`, no `webUtils`, no path resolution, nothing to throw.

`PyryApi` is inferred from `api`, so `src/preload/index.d.ts` needs no edit. #1033 is the only caller.

### 3. `src/main/attachmentUpload.ts` — the clipboard entry

```ts
export type ClipboardImageReader = () => Uint8Array | null
export const CLIPBOARD_IMAGE_MIME_TYPE = 'image/png'
export const CLIPBOARD_IMAGE_FILENAME_PREFIX = 'clipboard-image'
export async function uploadClipboardImage(
  readClipboardImage: ClipboardImageReader,
  deps: AttachmentUploadDeps
): Promise<void>
```

The reader is a PARAMETER, not a member of `AttachmentUploadDeps` — `uploadAttachmentFile(path, deps)`'s
shape, and for its reason: the Electron-derived input stays out of the shared deps object so the module
graph never touches `electron` and the other two entries do not carry a collaborator they cannot use.

Behaviour: call the reader; a `null` or ZERO-LENGTH result emits exactly one
`{ type: 'refused', reason: 'no-image' }` under a freshly minted `randomUUID` and returns; otherwise
`driveUpload(randomUUID(), { bytes, filename: <minted>, mimeType: CLIPBOARD_IMAGE_MIME_TYPE }, deps)`.

**The zero-length check is not redundant with the composition root's `isEmpty()`.** They are different
fabric on purpose: the root asks Electron whether the clipboard holds an image, this asks whether any
bytes actually arrived. Routing an empty array on into the flow is not merely inelegant — zero bytes
passes the size guard and goes on to attempt a real upload of an empty file.

**A throwing reader is caught and reported as the same refusal.** `NEITHER FUNCTION EVER REJECTS` is
this module's header commitment and the licence for the composition root's bare `void`; a contract is
not a guarantee for an INJECTED seam, which is the argument `driveUpload`'s existing catch already
makes. Inventing a fourth outcome for a branch a conforming Electron never takes would buy a union
member for nothing — from the composer's seat "the clipboard did not yield an image" is the same fact
either way. The caught object is dropped unexamined, matching `readChosenFile`.

**The minted filename** is `${CLIPBOARD_IMAGE_FILENAME_PREFIX}-<UTC stamp>.png`, built from
`toISOString()` with the separators stripped — client-owned pattern, filename-safe on every platform.
UTC and never a local getter: no TZ is pinned anywhere in this repo, so a local stamp would read
differently on a machine in another zone, and the sole existing formatter in this repo uses UTC getters
for the same reason. Two pastes inside one second mint the same display name; the daemon keys on
`attachment_id` (a fresh UUID per call), so the collision is cosmetic. `uploadAttachmentBytes`
documents that a caller owes a display name and not a bounded one, and `driveUpload` trims to
`ATTACHMENT_FILENAME_MAX_BYTES` anyway — this name is far inside it by construction.

`uploadAttachmentBytes` stays exported and unchanged: it is `driveUpload`'s public seam and this entry
is the one the ticket reserved it for, but the clipboard branch belongs above it, not inside it.

**Logging.** The refusal logs `{ event: LOG_EVENT, code: 'no-image' }` — the module's static event name
and a client-owned code, with `bytes` OMITTED (it is optional on `DiagnosticEvent`, so nothing is
invented). The success path's records are `driveUpload`'s, unchanged. Nothing derived from the image is
logged: no length before the guard, no dimensions, no flavour.

### 4. `src/main/index.ts` — the third arm and the clipboard read

The listener gains one arm, ordered AFTER the path guard:

```
request === undefined            → picker arm (#862), byte-for-byte unchanged
isAttachmentUploadRequest(req)   → path arm (#890), byte-for-byte unchanged
isAttachmentPasteRequest(req)    → clipboard arm (this slice)
otherwise                        → DROPPED: no clipboard read, no filesystem call, no event
```

**Path-first is what makes AC3 literally true.** An ask carrying a valid `path` reaches the drop arm
exactly as it does today, including one that also carries extra keys — the shipped guard's documented
"extras are accepted and never read" posture is unchanged, and no ask that works today changes arm.

The clipboard read is injected at the composition root, `saveDebugBundle`'s seam:

```ts
const readClipboardImagePng = (): Uint8Array | null => { /* readImage(); isEmpty() ? null : toPNG() */ }
```

`clipboard` joins the existing `electron` import. The PNG buffer is handed on as a true `Uint8Array`
VIEW honouring `byteOffset`/`byteLength` — `readChosenFile`'s idiom, and it matters more here because a
small `Buffer` from native code may sit in a pooled `ArrayBuffer`.

`pickerOpen` is neither read nor set by this arm, for #890's recorded reason: a paste opens no dialog.
Repetition is therefore unbounded on it, bounded by the per-upload byte guard and the daemon's
concurrency answer — see the security section.

The `deps` object is the one both shipped arms already share; nothing about it changes.

Plus the comment correction at the listener's "TWO ENTRIES, ONE LISTENER, TOLD APART BY PRESENCE"
paragraph, which is no longer the whole truth.

### 5. `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` — one sentence

`case 'refused'` becomes a nested `switch (event.reason)` with no `default`, so a third refusal reason
trips TS2366 on `attachmentUploadOutcomeCopy` exactly as a new event member does today. The `too-large`
arm is unchanged, limit figure and all.

The new sentence names the CLIPBOARD as the reason, so the reader learns why nothing was attached
rather than that something failed. It states no limit and interpolates nothing.

`ATTACHMENT_UPLOAD_FAILURE_COPY` and its `Map` are NOT touched: `no-image` is not an
`AttachmentUploadFailure`.

**No `ComposerAttach.tsx` change.** `ComposerAttachOutcome` already renders any non-`progress` event
through `attachmentUploadOutcomeCopy`, so the new refusal reaches the existing slot with its existing
`role="status"`.

## State + concurrency model

No store, no new async task, no renderer state at all. `uploadClipboardImage` is one call that never
rejects, started from the listener with a bare `void` — the licence the module's header already grants.

The clipboard read is SYNCHRONOUS and happens before any `await`, so there is no check-then-act gap
between "the clipboard holds an image" and "these are the bytes": one read produces both facts. The
clipboard changing after the read cannot affect the upload, because nothing re-reads it.

Two pastes in a row start two independent transfers with distinct ids, which is #862's design. The
listener registration and its `will-quit` removal are unchanged.

## Error handling

| Failure | Where it is answered | What the operator sees |
|---|---|---|
| Malformed / unrecognised ask | `isAttachmentPasteRequest` in main | nothing: no clipboard read, no event |
| An ask carrying a bad `path` | `isAttachmentUploadRequest` (unchanged) | nothing |
| Clipboard holds no image | root's `isEmpty()` → `null` → refusal | the new client-owned sentence |
| Clipboard yields zero bytes | `uploadClipboardImage`'s length check | the same sentence |
| The read itself throws | `uploadClipboardImage`'s catch | the same sentence |
| PNG over the client byte bound | #862's size guard in `driveUpload` | the existing `refused` line with the limit |
| Transport / daemon failure | #861's driver, unchanged | the existing `failed` line |

Exactly one terminal per ask that reaches an arm; a dropped ask emits none, which is every sibling
attachment channel's posture and the reason there is nothing for a looping renderer to drive.

## Testing strategy

**Unit (vitest, node):**

- `src/shared/ipc/attachmentUpload.test.ts` (extend) — `isAttachmentPasteRequest` accepts the
  well-formed ask and one carrying extra keys; rejects `null`, `undefined`, a string, a number, an
  array, `{}`, a wrong `source` literal, a non-string `source`, a `{ path }` ask, and a
  `__proto__`-carrying fixture built with `JSON.parse` (never an object literal — a literal creates no
  own key and would pass vacuously). Plus MUTUAL EXCLUSIVITY in both directions: neither guard accepts
  the other's ask, which is what keeps the discriminator sharp.
  The two union tests are extended DELIBERATELY, per AC4: the field walk gains the new member (proving
  it declares `type`/`uploadId`/`reason` and nothing else — no `limitBytes`), and the stale
  `all four members` count is replaced by one that counts REFUSAL REASONS as well as types, so a
  second variant on an existing `type` cannot again pass unnoticed.
- `src/main/attachmentUpload.test.ts` (extend) — `uploadClipboardImage` over the shipped `harness`:
  the bytes reach the driver verbatim (edge byte values, no transcoding), `mime_type` is `image/png`,
  `filename` matches the minted pattern, `attachment_id` is a fresh UUID and two calls differ, and
  exactly one `completed` is emitted. Then the three no-image inputs — reader returns `null`, returns a
  zero-length array, and THROWS — each producing exactly one `refused`/`no-image` with no `limitBytes`
  key and the driver never called. Plus the leak walk (`everyStringEmitted`) over a reader returning
  recognisable bytes: nothing but the type, the reason and the uploadId reaches an event or a record,
  and the no-image log record carries no `bytes` field.
- `attachmentUploadCopy.test.ts` (extend) — the no-image sentence is non-blank, differs from the
  too-large sentence and from every `ATTACHMENT_UPLOAD_FAILURE_COPY` value, names the clipboard, states
  no byte figure, and does not contain the `uploadId`. The too-large arm's shipped assertions stay
  green, which is what proves the split did not disturb it.

**No Playwright spec in this slice, stated rather than skipped.** Nothing in the fake tier can fire
this ask: the keystroke that calls `pasteAttachmentImage` is #1033, and this slice adds no composer
surface. Driving it through `app.evaluate` would prove the composition root but would also clobber the
machine's clipboard without restoring it, which `e2e/message-copy.spec.ts` already records as the price
of that route. #1033 adds the gesture and is the slice that can pay it once, for the whole chain. The
composition-root join and the preload are this repo's untested glue, as they are for every other
channel.

## Open questions

1. **Does `clipboard.readImage()` answer `isEmpty()` on a text-only clipboard on every platform?**
   Expectation: yes, and the ticket's technical note states it. Confirm against Electron's typings in
   Phase B. If it does not hold, nothing changes: the zero-length check in `uploadClipboardImage` is
   the deterministic second fabric behind it and produces the same refusal.
2. **Does splitting `refused` redden anything beyond `attachmentUploadOutcomeCopy`?** Expectation: no —
   the ticket measured that both union tests pass over a new member, and the only other reader of
   `limitBytes` is that switch arm. Confirm by `npm run build` in Phase B before writing the copy, so
   the red is observed rather than assumed.

## Size — stated, not split

Re-counted against this written plan: **5** production source files (the boundary exactly), **2** new
exported types (`AttachmentPasteRequest`, `ClipboardImageReader`), **1** consumer call site needing a
simultaneous update (`attachmentUploadOutcomeCopy`, and that break is the point), **4** acceptance
criteria, and no state machine with reject-branch fan-out.

The one boundary this trips is total written work: ~1300 lines against the 800 ceiling. Stated rather
than split, on the sizing FLOOR, which wins when the two disagree. The available cuts are all
one-consumer slices: a guard with no arm behind it emits nothing and proves nothing, and a union member
with no emitter and no sentence is unverifiable on its own. Every slice of this family has landed over
the ceiling and shipped clean — #890 at 1482 and #862 at 1529, both this channel and this five-file
shape.

## Revisions

**2026-09-04 — Phase B.** Both open questions resolved with no design change; two test-level details
differ from what this plan sketched.

1. **Open question 1 — `clipboard.readImage()` / `isEmpty()`.** Confirmed against Electron's shipped
   typings: `npm run build` typechecks `image.isEmpty()` and `image.toPNG()` as used at the composition
   root. The zero-length check in `uploadClipboardImage` stays as the deterministic second fabric
   behind it, and it is covered by its own case in the refusal table test.
2. **Open question 2 — does the `refused` split redden anything beyond the copy switch?** Observed, not
   assumed: after the union change and before the copy was written, `npm run typecheck` reported
   exactly one error — TS2339 on `limitBytes` in `attachmentUploadOutcomeCopy`. Nothing else in the
   repo reads that field, and `e2e/composer-attach.spec.ts`'s pushed `too-large` refusal is unchanged.
3. **The union test's second axis is compiler-forced, not counted.** The plan said the stale
   `all four members` count would be replaced by one that "counts refusal reasons as well as types". It
   is instead a `Record<Extract<AttachmentUploadEvent, { type: 'refused' }>['reason'], true>`, so a
   third refusal reason fails to TYPECHECK there rather than being counted correctly by accident — the
   `ATTACHMENT_UPLOAD_FAILURE_COPY` mechanism, applied to the axis that went stale.
4. **The main-side leak walk asserts an exhaustive string list, not substring absence.** The first
   attempt searched each emitted string for `String(bytes.length)`, which matched a digit inside the
   `uploadId` — a check that fails or passes by accident rather than by fact. Naming every string that
   may cross (`completed`, the id, and the two log records' fields) admits nothing at all and cannot
   collide, so it is the stronger form as well as the stable one.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The design adds ONE untrusted→trusted crossing — a second
  accepted shape on `ATTACHMENT_UPLOAD_CHANNEL` — and it is explicit rather than scattered: a single
  named guard (`isAttachmentPasteRequest`) in the shared module, applied at the one receiver, in
  `isAttachmentUploadRequest`'s shape. What crosses is a client-owned literal compared against a
  constant, so the accepted set is exactly one value and a renderer cannot vary it at all. Downstream,
  NOTHING from the ask is read: `uploadClipboardImage` takes no field off it. This is the narrowest of
  the three entries — narrower than #890's path, which is a claim main must open to test.
- **[The clipboard-read capability — the finding this ticket is labelled for]** STATED AND ACCEPTED,
  with the argument owed in full rather than by analogy. `src/main/index.ts`'s permission allowlist
  carries a standing instruction that it must never grow to `clipboard-read` or
  `clipboard-sanitized-read`, on the grounds that reading exfiltrates whatever the user last copied,
  routinely a password-manager secret. **This slice does not touch that allowlist and adds no renderer
  permission at all** — the renderer never reads the clipboard and gains no ability to. What it adds is
  the other shape that comment names: a main-side handler acting on the clipboard for the renderer.
  The comment argued, about WRITING, that the permission was the narrower of the two routes. For a READ
  the conclusion inverts, and the reason is the outcome union:
  - **The content never returns to the window.** `AttachmentUploadEvent` is content-free by
    construction — no member declares a field that can hold a byte, a pixel, a dimension or a decoded
    string, and this slice's new member declares three keys, all client-owned. Granting
    `clipboard-read` would hand the renderer the clipboard's TEXT in the renderer's own address space;
    this hands it a `completed` or a `refused`. Those are not the same capability, which is exactly why
    the allowlist stays untouched and this route is taken instead.
  - **A text-flavoured secret cannot become an attachment however the ask is forged.** The background
    process reads the clipboard ITSELF and trusts nothing the window claims about it; a text-only
    clipboard yields an empty image and a refusal. There is no field on the ask that could redirect the
    read, because there is no field on the ask.
  - **What genuinely widens, bounded:** a compromised renderer can cause an UNPROMPTED upload of an
    image the operator happens to be holding, to the paired daemon — and, by looping the ask, one per
    call, since `pickerOpen` is deliberately not consulted (#890's recorded reasoning: it is scoped to
    the dialog). Bounds: the destination is the already-paired host and not an attacker's, so this is
    disclosure to a party the renderer can already send arbitrary text to over the command channel;
    each transfer is capped by #862's per-upload byte guard; the daemon answers past its own
    concurrency bound with `attachment-too-many-uploads`; and a renderer compromised badly enough to
    reach this already holds `window.pyry`, which sends to the daemon and unpairs. The marginal
    capability is "an image the user copied, in addition to everything the window already renders". A
    client-side concurrency cap belongs with #861's bound rather than here.
  - **Not deferred silently:** if the residual is later judged too wide, the fix is a gesture-bound
    ask (a main-side confirmation, or correlating the ask to a real key event), which is #1033's
    surface and not this slice's — named here rather than left implied.
- **[Tokens, secrets, credentials]** Not applicable, and the decision that makes it so: the ask carries
  no credential and the outcome union carries no content. The adjacent secret-ish value is the
  CLIPBOARD ITSELF, and the whole finding above is about it. No token, key or Noise material is read,
  written or logged on this path.
- **[File / storage]** No findings, and the category is nearly vacuous by design: this entry names no
  path, resolves none, and writes nothing to disk. There is no traversal surface because there is no
  filesystem call at all — the byte source is memory. No TOCTOU: the read is synchronous and produces
  the bytes and the "is there an image" verdict in one call, so there is no gap to swap in. This is
  strictly less filesystem exposure than either shipped entry.
- **[Electron attack surface]** No MUST FIX. `sandbox: true` / `contextIsolation: true` /
  `nodeIntegration: false` are unchanged. The new `contextBridge` member exposes neither `ipcRenderer`
  nor `clipboard`, takes NO argument, fixes the channel in its closure and returns `void` — the
  narrowest of the three senders, and it cannot address another channel or leak a value back into the
  main world. `setPermissionRequestHandler` is untouched, so `e2e/message-copy.spec.ts` remains its
  regression guard and this ticket adds nothing for that guard to miss. Navigation guards
  (`will-navigate`, `isSameTarget`) are untouched.
  **SHOULD FIX, folded into the design:** the arm order is load-bearing, not stylistic. If the paste
  guard ran BEFORE the path guard, an ask carrying both keys would change arm relative to today's
  behaviour, which AC3 forbids. Phase B keeps `isAttachmentUploadRequest` first and the tests assert
  mutual exclusivity in both directions.
- **[Cryptographic primitives]** Not applicable: no randomness beyond `randomUUID` for the upload id
  (`node:crypto`, already reviewed under #862), no comparison against a secret, no key handling. The
  discriminator comparison is against a public client-owned constant, so constant-time comparison is
  not the relevant property.
- **[Network & I/O]** No findings. No socket, URL, timeout or TLS setting is introduced; the transfer a
  paste starts is #861's, with its shipped chunk bound and #862's byte bound applied before a byte goes
  on the wire. The PNG is encoded in the main process and its length is guarded before the plan is
  built, so a very large screenshot is refused rather than streamed — the same bound a picked file gets.
  The only thing added to the path is a third way to START one, bounded above.
- **[Error messages, logs, telemetry]** No findings, as a decision rather than an omission. A rejected
  ask is dropped with no event AND no log, matching every sibling channel and denying a looping
  renderer a way to drive the main-process logger. The no-image refusal logs one static event name and
  one client-owned code, with `bytes` omitted so no figure is invented; nothing derived from the image
  — length, dimensions, flavour — is logged anywhere, which is AC4 at the log as well as at the event.
  The caught reader error is dropped unexamined, matching `readChosenFile`'s errno posture.
- **[Concurrency]** No findings. No long-lived task, timer, listener or `AbortController` is added; the
  one registration and its `will-quit` removal are unchanged. No check-then-act across an `await`: the
  clipboard read is synchronous and happens before the first one. `pickerOpen`'s check-then-set stays
  synchronous ahead of its own `await` and is untouched by this arm. Concurrent pastes are independent
  transfers with distinct ids, and repetition is the bounded residual named above.
- **[Threat model alignment]** A malicious relay stays content-blind and on-path; a paste starts the
  same Noise-wrapped transfer. Token-at-rest is untouched. A hostile daemon's blast radius is unchanged
  — the outcome union grows by one client-owned literal, and `attachmentUploadOutcomeCopy` selects
  rather than interpolates, so no daemon value reaches a sentence. **Renderer compromise reaching the
  transport** is the threat this label is for: process isolation still denies the renderer the keys, the
  token and the socket, and what it gains is bounded by the clipboard finding above — an unprompted
  upload of a held image to the already-paired host, never the clipboard's contents in its own hands.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
