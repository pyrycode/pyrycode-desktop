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
  non-empty string); accept an ask with **no** `serverId` key at all — the bare ask a sender emits for
  a chat the conversation list does not hold; accept an ask with an explicitly-`undefined` `serverId`,
  the structured-clone trap
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

## Compact attachment acceptance and reopening

An upload completing proves storage, not the accepted message's attachment facts.
`e2e/threadBodies.test.ts` exercises `compact full-root attachment authority through
main, repaired facts=false/true` through the real receiver, preload, compact runtime,
scoped send settlement and presentation adapter. ID-only historical content retires
the owning local row but produces no accepted attachment. Repaired full content
draws the daemon's ID/name, distinct from the optimistic metadata, after queued
acceptance, delivered replacement, repeated replacement and genuine catch-up with
separate data/final frames. A peer device cannot settle the send; existing
`threadSendStore.test.ts` controls additionally cover host/conversation isolation and
unusable identities. Neither comparison creates complete items, reads disk history,
resends or requests hidden body/child detail.

The historical input is `e2e/recordings/claude-attachment.json`, SHA-256
`6d54b1aa7ae9bf9a0967e30279439dab8cfe6dd12c574b78594da8e51b56aaba`, captured
from Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5` and daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`. Its queued root carries one
`attachment_ids` entry without `attachments`; changed content also lacks those
facts. This retained comparison does not invent a Desktop defect. Daemon
[#3693](https://github.com/pyrycode/pyrycode/issues/3693) records accepted stored
facts and [#3694](https://github.com/pyrycode/pyrycode/issues/3694) preserves them.
No Desktop production change was needed with the repaired full-root payload.

`e2e/real-compact-attachment.spec.ts` retains the normal automatic projection path.
Its `compact attachment survives owning echo, replacements, navigation and fresh
online restart` scenario uploads a synthetic image through the existing picker path,
observes owning queued/delivered roots, then checks exactly one accepted row, no
queued/local duplicate and a decoded 64px image. It exercises the existing open IPC;
only the picker and external viewer handoff are stubbed. Navigation and restart
each select a newly dispatched owning compact query and require its matching
delivered root's attachment ID/name before that same request's later successful
final. Observers filter host/conversation/device/message identity. Fresh restart
requires version zero, successful daemon retrieval, zero sends/body reads and
complete persisted history status `missing`.

A completed query plus a retained rendered row can pass while no fresh attachment
data arrived. `completedAttachmentDelivery` in `e2e/fixtures/compactAttachmentEvidence.ts`
pins root/request identity, delivered status, attachment facts and event order.
Its 11 focused tests reject retained/live roots, other requests, missing data/final,
reversed order and mismatched root/attachment/name/status. Keep replay's
[client-only evidence boundary](../../recorded-tests.md): the historical recording
and offline assertions cannot establish current daemon retrieval or provider behavior.
The unchanged live provider-color assertion remains separate.

For mounted SQLite checks, finish the Node unit gate before preparing Electron's
native dependency with `npm run rebuild:electron`. The unit gate prepares SQLite
for Node; overlapping it with mounted history inspection can produce `unreadable`
instead of the expected `missing`. Restore the Electron native build after that
gate, before launching the mounted scenario.

### Retained Linux attachment evidence

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2247#issuecomment-6386699705)
at `9ae4f170f48388f7d02e9986158d837b0224fa32`, authoritative stage
`7eb1249a52d062e41235e6ec3b91a779260b4df02d67ac3adcc3665dd1bb3461`, inspected
the corrected live report. The exact mounted scenario above was present and passed
on Linux, **1 executed, 1 passed, 0 failed, 0 skipped, retry 0**, starting
`2026-10-24T16:16:28.832Z`, report duration 9.506 seconds. Executed Desktop was
clean normal build `a1791abd6d6b1049daf2c87a668d048b5588b6ab`, after main merge
`928f28feba29`; the reviewed head adds evidence only. The daemon was
`/opt/pyry-test-daemon/pyry`, clean pyry 0.43.0, source
`94bd216633c49d6f87f775da1f492d321b90e0c3`, SHA-256
`e669aa7f717d41ba91ade23f84158ac4208dbc66563613e25bc49b090ad449ff`.
The verifier checked ancestry of both repairs (`478250b9` and `299d90fa`). Initial
and fresh-page owning handshakes each report `interactive=true`, `thread=true`,
`thread_expansion=true`, `thread_compact=true`.

Root id 1 retains attachment `16165e61-992a-40bf-8235-606bad1210d2`, filename
`compact-authority.png`, from queued rev 1 through delivered rev 7. Navigation's
version-zero request `192e3b7a-979a-43b3-8fcb-6a4cd0c42bc5` supplies its root at
event 69 and final at 70; fresh-process version-zero request
`8a1b0e18-5b27-400e-8ad9-bff47a0bfa02` supplies them at 37 and 38. Each barrier
precedes row/image assertions. Fresh reopening records one successful real daemon
retrieval, zero sends/body reads and complete-history `missing`. Required live
acceptance is satisfied, with no operator live hold remaining for this attachment
scenario. This establishes fresh online reopening, not complete compact persistence.

The controlled final-only predicate run executed 11 cases: **3 passed, 8 failed,
0 skipped**. The corrected targeted run executed/passed **199, 0 failed/skipped**
across correlation, full-root integration and scoped-settlement files. Final
pre-verify executed/passed all **11 affected cases, 0 failed/skipped**. The verdict
confirms all 11 correlation and 175 `threadBodies` cases present and passed in its
unit gate: **10,144 executed/passed, 0 failed, 3 skipped**. The supplied dispatcher
gate report separately gives **10,045 executed/passed, 0 failed, 3 skipped**, without
named-test evidence; keep these aggregates separate. Both report **542 application/
replay tests executed/passed, 0 failed, 4 skipped**; the verdict records no retries.
Those aggregate client results are separate from live acceptance. The unchanged
real attachment/provider-color scenario separately executed/passed **1, 0 failed/skipped**.

The [earlier failed verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2247#issuecomment-6386386281)
remains failed for missing root-to-request correlation. Its mounted report recorded
**1 executed/passed, 0 failed/skipped**, but cannot certify the fresh-delivery
assertion later repaired. Exploratory launch, sidebar-selection, SQLite/native
setup, interrupted-install and build-provenance failures remain failures, as does
the concurrent `unreadable` attempt. They are retained in the
[plan's evidence record](../../specs/architecture/2164-compact-attachment-continuity.md#request-correlated-linux-rework-acceptance).
The corrected report is `/tmp/builder-2164/rework/live-correlated.log`, SHA-256
`64995aae4479af7c0a84f73d2e48e8cd04a05693eaea7a7b215df447dd4e30d7`;
decoded `provenance.json`, `accepted-and-reopened.json`, `fresh-online-delivery.json`
and `complete-history-reading.json` accompany it. The accepted stage identifies
the retained evidence bundle when worker-local paths are unavailable. Verification
inspected these counted results; documentation runs only the docs guard. macOS is
outside this Linux ticket's verification scope.

## Related

- [Attachment upload](attachment-upload.md) — the parent document.
- [Attachment upload — the guard and the drive](attachment-upload-guard-and-drive.md) — the other child,
  `src/main/attachmentUpload.ts` in full.
- [Daemon connection — per-server routing](daemon-connection-routing.md) — `serverRouter.test.ts`'s
  coverage of the resolution these tests assume rather than re-prove.
