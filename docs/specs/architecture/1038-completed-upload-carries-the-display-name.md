# #1038 — the completed upload event names the file that was stored

## Files read

- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadEvent` (the `completed` arm), and the union's
  docblock — the CONTENT-FREE BY CONSTRUCTION paragraph and the `totalChunks` qualification. This module
  owns the claim this slice amends; the other five sites inherit it.
- `src/main/attachmentUpload.ts` → `driveUpload` — the one completion emit site, and the one place the
  bounded name already exists in scope. Also `readChosenFile` (where the picker/drop name is
  `basename(path)`), `clipboardImageFilename` and `CLIPBOARD_IMAGE_FILENAME_PREFIX` (where the paste name
  is minted client-side), and `trimToBytes` (the bound).
- `src/shared/wire/types.ts` → `ATTACHMENT_FILENAME_MAX_BYTES` — 255 bytes, the bound the hoisted value
  already carries.
- `src/shared/ipc/attachmentSave.ts` → `AttachmentSaveRequest`, `MAX_SAVE_FILENAME_LENGTH`,
  `isAttachmentSaveRequest` — the window's only onward use of the name, and the reason the design already
  expects the window to hold one. Its guard bounds at 4096 UTF-16 units, so a 255-byte value clears it.
- `src/main/attachmentFilename.ts` → `sanitizeAttachmentFilename` — what the save leg re-runs on whatever
  the window sends back, and therefore why nothing needs stripping here.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` → the module header's restatement of the
  content-free claim, and `attachmentUploadOutcomeCopy`'s `case 'completed'` arm (returns a constant —
  this slice ships no consumer, so it stays a constant).
- `src/main/attachmentUpload.test.ts` → `everyStringEmitted`, the *"leaks neither the path, the basename,
  nor a file byte"* test, and the paste-side *"lets no clipboard content reach an event or a log record"*
  test. These two are the whole of AC4's mechanism.
- `src/shared/ipc/attachmentUpload.test.ts` → the *"declares no field beyond the listed ones"* key-list
  walk — the type-side proof that gains one entry.
- `src/renderer/src/screens/conversation/ComposerAttach.test.tsx`,
  `src/renderer/src/screens/conversation/attachmentUploadCopy.test.ts` → the renderer construction sites.
- `e2e/composer-attach.spec.ts` (`COMPLETED`), `e2e/composer-paste-image.spec.ts`,
  `e2e/composer-file-drop.spec.ts` → the three specs restating the claim, one of which also constructs the
  arm.
- `docs/knowledge/features/attachment-upload.md` §§ Security, Testing → the family's recorded reviews;
  #1032's residual (an unprompted upload a compromised renderer can cause) is the one this slice's
  disclosure question composes with.

**Tooling gap, recorded rather than worked around:** every `mcp__codegraph__*` call in this repo fails
with *"CodeGraph not initialized"*, so the reading list above was built with Grep and Read. The cascade
was swept with two greps that carry no path filter — `'completed'` across `**/*.{ts,tsx}` (which is what
found the `e2e/` construction site that no gate typechecks) and the content-free prose across the same
glob.

## Context

`AttachmentSaveRequest` is `{ attachmentId, filename }`, and `attachmentSave.ts`'s header states outright
that the name comes from the renderer because *"main does not have it […] the renderer does have it, from
the settled attachment in the timeline."* Nothing supplies one today. The shipped save leg therefore
cannot be driven at all. This slice is the missing supply for that merged design, not a new capability:
one field, on one arm, in the main→window direction.

The claim being amended is `AttachmentUploadEvent`'s *"no member declares a field that can hold the file's
bytes, its host path, or its name."* The union's own docblock names this moment — *"A member that ever
wanted to carry more than a count owes this paragraph a re-read"* — and the re-read is that #862's
containment property is about the **renderer→main** direction (a compromised renderer cannot choose what
is opened, cannot name a file, cannot reach the wire) and is untouched here. What moves is what main tells
the window about a transfer the window's own operator started.

No ADR is warranted: this is a field on an existing union, argued inside the module that owns the claim.

## Design

### The type — `src/shared/ipc/attachmentUpload.ts`

The `completed` arm gains one **required** field:

```ts
| { type: 'completed'; uploadId: string; filename: string }
```

Required rather than optional, for the reason the `no-image` refusal already records one member up: an
optional field lets a consumer render `undefined` into a sentence instead of failing to build, and it
makes every construction site's omission silent. Required is what turns the cascade into a compile error.

Named `filename`, not `displayName`, because it is the same word the value already wears at both ends —
`AttachmentChunkPlanInput.filename` on the wire, `AttachmentSaveRequest.filename` on the way back — so the
window passes it through rather than renaming it in flight.

Three prose edits in this module, all of them narrowing a claim rather than deleting it:

- the CONTENT-FREE BY CONSTRUCTION paragraph — restated as: no member can hold the file's **bytes** or its
  **host path**; exactly one member carries its **name**, which is display text and is argued below.
- the `totalChunks` qualification — this is the paragraph that asked to be re-read, so it is answered
  rather than removed: `totalChunks` disclosed the file's approximate size, `filename` discloses what the
  operator called it, and both are inside the blast radius #862 accepts because the window already holds
  the whole timeline and its own user chose the file. The provenance split (below) is what makes that
  argument different for the paste entry rather than merely repeated.
- the arm's own line — documents the field's provenance, its bound, and that it is the *same* value that
  rode the wire.

### Provenance, and why it is the security argument rather than a footnote

| Entry | Name | Where it comes from |
|---|---|---|
| picker, drop | `basename(path)` in `readChosenFile` | the operator's own filename — one path component, no directory |
| paste | `clipboardImageFilename()` | a client-owned stem, a UTC stamp, `.png` — nothing about the clipboard |

The paste entry therefore discloses nothing at all: the string is minted in `src/main/attachmentUpload.ts`
from constants, so no clipboard content can reach the window through it. That is what AC2 asks for, and it
holds by construction rather than by a check.

### The emit — `src/main/attachmentUpload.ts`

One change in `driveUpload`: the bounded name is already built inline into the wire envelope as
`trimToBytes(file.filename, ATTACHMENT_FILENAME_MAX_BYTES)`. It is hoisted to a const above the `try` and
read twice — once by the envelope, once by the `completed` emit. **That hoist is the whole of AC1's "the
same bounded value, not a second differently-bounded copy":** a second `trimToBytes` call would be a
convention, one const read twice is a fact. All three entries funnel through this function, so the picker,
the drop and the paste are all served by the single site.

Nothing else in the flow moves. The refusal and failure emits are untouched, `progress` is untouched, and
the diagnostic log is untouched — no record gains a field (AC3, AC4).

**One prose amendment outside the ticket's named sweep, flagged deliberately.** The module header's
containment paragraph ends *"None of the three can read back what was sent."* The ticket lists
`attachmentUpload.ts:18-26` as untouched on the grounds that it is about the renderer→main direction —
true of the paragraph's body, but that closing sentence is a main→window readback claim and this slice
falsifies it. AC5 says no site is left asserting the claim this slice amends, so the sentence is qualified
in place (the display name is now read back; the bytes, the path and the host's answer are not). The edit
is that clause and nothing else; the picker/paste/drop sentences above it stay verbatim.

### The copy module — `src/renderer/.../attachmentUploadCopy.ts`

Comment-only. Its header restates the union's claim to argue *"there is no daemon text on this path — no
escaping obligation, no length bound."* That conclusion survives and its premise does not: the reconciled
comment says one member now carries the file's display name, that this module does not read it (the
`completed` arm returns a constant), and that the obligation the header disclaims arrives with the first
consumer — #1039 — not here. `attachmentUploadOutcomeCopy` is not touched.

## State + concurrency model

None. No store slice, no async task, no subscription, no cancellation path. The value is read from a local
const inside one already-`await`ed function and handed to the existing `emit`, on the same synchronous
tick as today's emit and after the same `terminal = true` fence — so the ordering guarantee that no late
progress report can interleave between the answer and the terminal is unchanged.

## Error handling

Unchanged; this slice adds no failure mode and no reject branch.

Two representability notes the implementation must not paper over:

- **An empty `filename` is representable and unreachable.** `trimToBytes` cannot empty a non-empty input
  (its bound is 255 bytes and no single code point exceeds that), and `basename` answers `''` only for `/`
  or `''` — the first is refused by `readChosenFile`'s `isFile()` gate, the second by
  `isAttachmentUploadRequest`. So nothing is added to guard it here; it is named so that #1039 does not
  *assume* non-empty when it renders.
- **A `\` in the value is legal and expected on macOS and Linux.** A file genuinely named `a\b.txt` yields
  a name containing one. This is why AC4's event-side proof is *single path component*, not *contains no
  separator* — see below.

## Testing strategy

Vitest only. Nothing renders and nothing is user-visible, so there is no Playwright behaviour to add — the
one e2e change is a typed construction site and three prose reconciliations.

**Type side** (`src/shared/ipc/attachmentUpload.test.ts`) — the key-list walk gains `'filename'` on the
completed row. It is a positive walk under a type annotation, so it is simultaneously the proof that the
field exists, that it is required, and that no *sixth* key crept in.

**Emitter side** (`src/main/attachmentUpload.test.ts`):

- The three whole-shape `toEqual`s on the completed event assert `filename` **against
  `uploads[0].filename`** — the value the driver was actually handed — rather than against a repeated
  literal. That is AC1 asserted as identity: a second `trimToBytes` call would still produce an equal
  string for a short name and would pass a literal comparison, and would diverge for a 255-byte one.
- A new case: a >255-byte UTF-8 basename, where the event's `filename` equals the wire's trimmed value and
  is strictly shorter than the file's real name. This is the assertion a divergent second bound fails.
- **AC4's split walk.** The existing test runs `everyStringEmitted` over events **and** records together
  and applies three checks to every string: no `NAME_STEM`, no `/`, no `\`. It splits:
  - *record side* — unchanged, all three checks, over records alone. The log's guarantee stays whole and
    unnarrowed.
  - *event side* — the completed arm's `filename` is lifted out; every other emitted string keeps all
    three checks unchanged, so a name leaking into `uploadId` or a `reason` still reddens.
  - *the lifted field* — proved to be a **single path component**, expressed as
    `basename(filename) === filename`. That is the claim the code actually guarantees, it is what
    `not.toContain('/')` was reaching for, and it correctly admits the legal-`\`-in-a-name case that
    copying `not.toContain('\\')` onto the event side would have wrongly failed.
- **The paste walk inverts.** The exhaustive string list gains the minted name in its `Object.values`
  position, sourced as `uploads[0].filename` so the list keeps proving event-equals-wire. The
  `CLIPBOARD_IMAGE_FILENAME_PREFIX` **absence** check becomes a **presence** check, and is joined by a
  match against the minted shape `^clipboard-image-\d{8}T\d{6}\.png$` — which is AC2's real proof, since a
  string of exactly that shape cannot carry a clipboard byte, a dimension or a flavour.

**Renderer side** — the three construction sites in `ComposerAttach.test.tsx` and the three in
`attachmentUploadCopy.test.ts` gain the field. Two new assertions carry the "ships with no consumer" fact:
the copy for a completed event does not contain the filename, and the rendered `ComposerAttachOutcome`
markup does not either — mirroring the shipped `uploadId` tests one block over. Both are guards that make
#1039's change deliberate rather than accidental.

**e2e** — `COMPLETED` in `e2e/composer-attach.spec.ts` gains the field; the spec's existing
`not.toContainText(COMPLETED.uploadId)` gains a sibling for the filename. Per this repo's recorded gap —
no tsconfig includes `e2e/` and Playwright strips types with esbuild — this file is typechecked **by hand**
with an ad-hoc `tsc --noEmit`, read by filename, since a green `npm run build` proves nothing about it.

## Open questions

1. Does the closing sentence of `src/main/attachmentUpload.ts`'s containment paragraph fall inside AC5's
   sweep or inside the ticket's deliberately-untouched list? **Resolved in this plan:** it is falsified by
   this slice, so AC5 governs; the amendment is scoped to that one clause and is called out in the PR body.
2. Should the event-side walk keep `not.toContain('\\')` on the lifted field? **Resolved:** no — the
   ticket's own trap note, and `basename(filename) === filename` is the stronger and honest claim.

## Size

Over the 800-line ceiling by design, at roughly the refiner's ~850 estimate, and it stays one ticket. The
only seam is *widen the type* / *emit the value*, and the first half is consumed by exactly one sibling,
changes nothing observable, and reddens no gate on its own — the sizing **floor**, which outranks the
ceiling. Counted honestly rather than massaged: 8 compile-forced typed construction sites plus 3
runtime-forced `toEqual` shapes and 2 walk rewrites is above a strict reading of the 10-call-site line
too, and the same floor argument covers it. Every other line holds — 3 production files, no new exported
type, 5 acceptance criteria, no new reject branch. The family's five shipped slices landed between 1062
and 1859 lines against this same ceiling.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings — but the boundary this slice touches is the reverse of the one the
  label is usually about.** The renderer→main boundary is untouched: `isAttachmentUploadRequest` and
  `isAttachmentPasteRequest` are unchanged, no new field enters main from the window, and #862's property
  (*a compromised renderer can make a picker appear; it cannot choose what it opens, and it cannot reach
  the wire*) survives verbatim. What moves is main→window, which is a **disclosure** question, not a
  validation one — there is nothing to validate, because main is the trusted side and the value it sends
  is one it derived itself. The plan documents this inversion in the union's docblock rather than leaving
  the reader to infer it.
- **[Tokens, secrets, credentials] No findings.** No token, key or credential is on this path. The
  hoisted value is `basename(path)` or a client-minted stem; `safeStorage`, the device token and the Noise
  static key are all untouched.
- **[File / storage operations] No findings, and one non-obvious reason it is not a traversal surface.**
  The value travels main→window and this slice gives it no filesystem consumer. Its *eventual* consumer is
  the save leg, where it crosses back as untrusted renderer text and `sanitizeAttachmentFilename` re-runs
  on the value main actually builds a path from — rewriting `\` to `_` and refusing traversal — so a
  window that mangles or forges the string cannot escape Downloads. That is why nothing is stripped here:
  stripping would create a second, divergent sanitiser, which `attachmentBytes.ts` already records as *the
  shape that ends with one of them being weaker than the other*.
- **[Inter-process / Electron attack surface] No findings.** No `contextBridge` API is added, no
  `ipcMain` channel is added, no `webPreferences` changes; the bridge in `src/preload/index.ts` forwards
  this union unchanged and gains no code. The renderer's capability set is identical before and after.
  `src/preload/index.ts`'s *"no path and no file byte"* stays true as written and is correctly on the
  ticket's do-not-touch list — a name is neither.
- **[Cryptographic primitives] N/A by design.** Nothing on this path is a primitive, a nonce or a
  comparison. `uploadId` remains `randomUUID` and is deliberately still not derived from the filename —
  `attachmentTransfer.ts`'s header records why (an id derived from a name leaks it through a field that
  looks safe), and this slice does not weaken it: the name now travels in a field that *says* it is a name.
- **[Network & I/O] No findings.** No wire change. The value already crosses the wire as
  `AttachmentChunkPlanInput.filename`, bounded to `ATTACHMENT_FILENAME_MAX_BYTES` (255), and this slice
  sends the *same const* to the window rather than a second copy — so no new bound, and no possibility of
  the two diverging. 255 bytes ≤ `MAX_SAVE_FILENAME_LENGTH` (4096 UTF-16 units), so the value the window
  holds clears the save leg's own guard.
- **[Error messages, logs, telemetry] No findings — and this is the category the plan most had to resist
  widening.** `DiagnosticEvent` gains nothing; no record carries the name, a path or a separator. The
  attractive mistake was to relax the emitter test's shared walk once the event legitimately carries a
  name, which would have silently narrowed the *log's* guarantee too. AC4's split is exactly the defence:
  the record side keeps all three checks and only the event side narrows, by one named field, still proved
  to be a single path component. The `\`-is-legal trap is handled by proving the right property rather
  than by copying the wrong assertion.
- **[Concurrency] No findings.** No async task, timer, listener or subscription is added. The const is
  read on the same tick as today's emit, after the existing `terminal = true` fence, so no interleaving is
  introduced.
- **[Threat model alignment] The one genuine widening, named and bounded.** A **compromised renderer**
  now learns the display name of a file its own operator attached, where before it learned only an opaque
  id. Assessed as inside the blast radius #862 already accepts and #864 already widened: that renderer
  holds the entire conversation timeline, and the file is one the operator chose in that same window. It
  is strictly narrower than the alternative reading — no host path, no directory, no byte, and for the
  paste entry no disclosure at all, since the string is minted from constants. It does **not** compose
  badly with #1032's recorded residual (a compromised renderer can cause an unprompted upload of an image
  the operator happens to be holding): that image's name is `clipboard-image-<UTC>.png`, so the widened
  field tells such a renderer nothing it did not already cause. A **hostile daemon** reaches this field not
  at all — the value never round-trips through the daemon; it is read from a main-process const.
- **[Threat model alignment] OUT OF SCOPE — the first consumer's obligations, deferred to #1039.** When
  the name is rendered it becomes the first operator-supplied string in composer copy, and it arrives with
  two obligations this slice deliberately does not discharge because it renders nothing: a **layout**
  bound (a 255-byte name needs the `max-width` + ellipsis treatment the footer's labels carry, not a raw
  interpolation), and **not assuming non-empty** (empty is representable and unreachable — see § Error
  handling). Both are named here so #1039 inherits them rather than rediscovering them. React's default
  escaping covers the injection axis, and CLAUDE.md's raw-markup-sink rule already forbids the rest.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
