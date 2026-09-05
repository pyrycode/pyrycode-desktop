# Attachment upload — testing

Child of [Attachment upload](attachment-upload.md) — split out 2026-09-06 because folding #1129's
routing-key coverage into the parent's `## Testing` section pushed it over the 50000-byte cap
`npm run check:docs` enforces. This document is the whole of that section: the channel-contract guard
tests, the flow-module tests, the copy tests, and the e2e proof. See the parent for the channel
contract, the composition root, the bridge, the data flow, the error table, the security review and
the edge cases these tests cover.

- **`src/shared/ipc/attachmentUpload.test.ts`** — the two channel constants are distinct from each other
  and from `DAEMON_EVENT_CHANNEL` / `COMMAND_CHANNEL`; the union is value-free beyond the fields listed,
  a positive walk over `Object.keys` rather than an absence assertion. **(#890)** `isAttachmentUploadRequest`
  accepts a well-formed request and one carrying extra keys; rejects `null`, `undefined`, a string, a
  number, an array, `{}`, a non-string `path`, an empty `path`, a path one over `MAX_UPLOAD_PATH_LENGTH`,
  and a `__proto__`-carrying literal built with `JSON.parse` (never as an object literal — a literal
  `{ __proto__: {...} }` creates no own key at all and would pass the guard vacuously). **(#1032)**
  `isAttachmentPasteRequest` accepts the well-formed ask and one carrying extra keys; rejects the same
  hostile shapes as above plus a wrong `source` literal, a non-string `source`, and a `{ path }` ask — and
  **mutual exclusivity is asserted in both directions**, neither guard accepting the other's ask, which is
  what keeps the discriminator sharp with three shapes on one channel. The field-walk gained the fifth
  member (proving it declares `type`/`uploadId`/`reason` and nothing else — no `limitBytes`); the stale
  `all four members` count was replaced by a compiler-forced `Record` over refusal reasons, per § The
  paste ask above.
- **The routing-key describe (#1129), stated as a scenario table rather than restated per guard.** Both
  `isAttachmentUploadRequest` and `isAttachmentPasteRequest` accept an ask naming a server (`serverId` a
  non-empty string); accept an ask with **no** `serverId` key at all — the bare ask every shipped sender
  emits today; accept an ask with an explicitly-`undefined` `serverId` — the structured-clone trap
  ([[structured-clone-preserves-an-undefined-property]]) stated as a test rather than as a comment; accept
  `serverId: ''` — type, not emptiness, refused one layer later by `serverRouter.resolve`; and reject a
  non-string `serverId`, table-driven over the shapes a hostile or buggy renderer can produce (a number, a
  boolean, `null`, an array, an object). A new assertion also states outright that `serverId` is no longer
  an unread extra key, alongside the existing extra-keys acceptance, which stays true for every other key.
  No test exists for `src/main/index.ts`'s `buildDeps`/`servers.route` wiring itself — see the note below,
  and [Daemon connection — per-server routing § The attachment upload names its server](daemon-connection-routing.md)
  for why the routing decision is proven at `serverRouter.test.ts` instead.
- **`src/main/attachmentUpload.test.ts`** — against real temp files (the `saveDebugBundle.test.ts`
  posture) and a fake `upload` / `emit` / `DiagnosticLog`: a small file uploads with byte-identical
  `bytes`, a basename `filename`, a table-derived `mime_type`, and a `randomUUID`-shaped `attachment_id`;
  a file of exactly `ATTACHMENT_MAX_UPLOAD_BYTES` uploads and one byte more is refused with `upload`
  never called; a missing path and a directory both emit `failed: 'unreadable'` with `upload` never
  called and the path absent from every emitted field and log record; every representative
  `AttachmentTransferFailure` row round-trips onto `failed.reason`; two concurrent runs mint distinct
  ids and emit two independent terminals; a >255-byte UTF-8 basename trims to ≤255 bytes and still
  decodes cleanly, and the `completed` event's `filename` is asserted **against `uploads[0].filename`**
  — the value the driver was actually handed — rather than a repeated literal, so a second, divergent
  `trimToBytes` call would fail this at exactly 255 bytes where a literal comparison would not (#1038);
  `uploadAttachmentBytes` drives the same guard and terminals without touching disk.
  **The >255-byte trim could not be proven through the path route** — 255 bytes sits at or under every
  host filesystem's own component limit, so no file could be created to exercise it — and is proven at
  `uploadAttachmentBytes` instead, which both routes share.
  **The general leak walk (`everyStringEmitted`) is split, not relaxed, since #1038 (`eventStrings`).**
  Before, one walk ran over events and records together and asserted three checks — no `NAME_STEM`, no
  `/`, no `\` — against every string either side emitted. Now that `completed` legitimately carries a
  name, that walk would assert the opposite of what the channel promises, so it splits: the **record**
  side keeps all three checks over every string, unchanged, since the log stays content-free; the
  **event** side keeps all three checks over every string *except* `completed.filename`, which is lifted
  out and proved a **single path component** instead — `basename(filename) === filename` — rather than
  `not.toContain('\\')`, which a legally-named `a\b.txt` would fail (`\` is a legal filename character on
  macOS and Linux). A name leaking into `uploadId` or a `reason` still reddens on the event side. **(#1032)**
  `uploadClipboardImage` over the same `harness`: bytes reach the driver verbatim, `mime_type` is
  `image/png`, `filename` matches the minted pattern, `attachment_id` is a fresh UUID each call, exactly
  one `completed` is emitted; the three no-image inputs (`null`, zero-length, a throwing reader) each
  produce exactly one `refused`/`no-image` with no `limitBytes` key and the driver never called. The
  paste-side leak walk is an **exhaustive string list**, not a substring search — the first draft's
  `not.toContain(String(bytes.length))` matched a digit inside the `uploadId` by accident, so naming
  every string that may cross replaced it, admitting nothing at all and unable to collide.
  **Inverted by #1038, not merely widened:** the list gains the minted name, sourced from
  `uploads[0].filename` so the same line proves window-equals-wire; the `CLIPBOARD_IMAGE_FILENAME_PREFIX`
  check flips from an *absence* assertion (the prefix reaching the window used to be the leak) to a
  *presence* one, joined by a whole-string match against the minted shape
  `^clipboard-image-\d{8}T\d{6}\.png$` — a string of exactly that shape has no room for a clipboard byte,
  a dimension or a flavour, which is AC2's actual proof.
- **`attachmentUploadCopy.test.ts` (#1032)** — the no-image sentence is non-blank, differs from the
  too-large sentence and from every `ATTACHMENT_UPLOAD_FAILURE_COPY` value, names the clipboard, states no
  byte figure, and doesn't contain the `uploadId`; the too-large arm's shipped assertions stay green,
  proving the split didn't disturb it. See [Composer attach's copy
  section](composer-attach.md#attachmentuploadcopyts---the-copy-is-a-selection-not-a-rendering). **No new
  member was added for #1129's `ambiguous-server` refusal** — see [the parent's § Composition
  root](attachment-upload.md) for why the existing `not-connected` sentence covers it.
- **The whole-chain e2e proof landed with #1033, not here.** `e2e/composer-paste-image.spec.ts` seeds a
  real bitmap on the real OS clipboard and drives a trusted `webContents.paste()`, paying
  `e2e/message-copy.spec.ts`'s already-accepted clobber-without-restore price once for the entire chain —
  keystroke → predicate → this ask → `uploadClipboardImage` → guard → transfer → wire → terminal. It also
  measured what this file's design left open: a real OS-clipboard bitmap advertises `['Files']` only, with
  no `image/png` entry. See [Composer attach § Testing the paste
  entry](composer-attach-paste.md#testing-the-paste-entry) for the drive and its two-different-daemon-code trick
  against a vacuous pass.
- **No test for `index.ts`'s wiring or the preload members, `dropAttachmentFile` and `pasteAttachmentImage`
  included (#890, #1032, #1129)** — the
  composition root and the preload are Electron-bound and untested here by existing convention; the
  path-carrying leg is proven instead by the shared guard's unit tests above plus this file's existing
  real-temp-file coverage of `uploadAttachmentFile`, since a page-built `File` in the e2e tier has no real
  path to carry across the boundary in the first place. `buildDeps`'s per-ask resolution and the
  routing outcomes it produces are the same reason: the resolution itself is `serverRouter.test.ts`'s
  coverage, unchanged by this ticket, and `src/main/index.ts` has no unit test in this repo and never has.
  See [Composer attach § Testing the drop
  entry](composer-attach.md) for what the e2e tier proves about the gesture itself.
- **The progress gate (#864)** — a fake driver reports arbitrary `(sent, total)` pairs before
  resolving; a transfer whose total is under `ATTACHMENT_PROGRESS_MIN_CHUNKS` emits no `progress`
  event at all (AC2); one at or above it emits `progress` then exactly one terminal (AC3); every
  emitted `progress` event carries exactly its four declared keys, walked positively.
- **A `queueMicrotask`-seeded "after the terminal" report proves the wrong thing.** The fixture for "no
  progress survives the terminal" needs reports that land once the driver has already answered. The
  first draft seeded them with `queueMicrotask`, which runs *before* the awaiting `driveUpload` resumes
  from its own `await` — so those reports arrived while the transfer was still legitimately in flight,
  and the test measured the in-flight case while claiming to measure the post-terminal one; it only
  caught the missing `terminal` guard by accident. `setTimeout(..., 0)` is the fixture that actually
  runs after the whole microtask chain that emits the terminal, and is what `reportingHarness`'s `after`
  parameter uses in `attachmentUpload.test.ts`. The general shape: a same-tick microtask callback cannot
  stand in for "after an async function's caller observed its resolution" — only a macrotask can.

**No e2e spec was added or edited for #1129.** The behaviour that changes is per-server routing, which
the single-daemon fixture cannot exercise at all — with one held connection every arm behaves exactly as
before, which is what AC5 asked `npm run e2e` to demonstrate with no spec edits, and it does.

## Related

- [Attachment upload](attachment-upload.md) — the parent document.
- [Attachment upload — the guard and the drive](attachment-upload-guard-and-drive.md) — the other child,
  `src/main/attachmentUpload.ts` in full.
- [Daemon connection — per-server routing](daemon-connection-routing.md) — `serverRouter.test.ts`'s
  coverage of the resolution these tests assume rather than re-prove.
