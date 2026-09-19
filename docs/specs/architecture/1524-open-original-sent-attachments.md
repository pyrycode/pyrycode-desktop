# Open original sent attachments

## Context

Ticket #1524 fixes activation creating a Downloads copy of a file the user already has.
The upload currently discards the local path. Retain it only for this main-process
lifetime; the existing retrieval, save and raster-image fallback remain available.
This is one behavior across file and image activation, not a new persistent store.

## Files read

- `src/main/attachmentUpload.ts` → `uploadAttachmentFile`, `driveUpload`: client UUID, guarded local read, success terminal shared by picker and drop.
- `src/main/index.ts` → `buildDeps`, attachment upload/open listeners: resolved host, native picker, OS handoff and app lifetime.
- `src/main/serverRouter.ts` → `createServerRouter`: `resolve` returns the actual server ID even for an unnamed sole host.
- `src/main/conversationRouter.ts` → `createConversationRouter`: conversation routing is mutable; do not re-resolve upload ownership after awaiting completion.
- `src/main/attachmentSave.ts` → `createAttachmentSave`: existing sanitized exclusive-create Downloads fallback.
- `src/main/attachmentOpen.ts` → `createAttachmentOpen`: existing raster signature gate and derived image fallback.
- `src/shared/ipc/attachmentOpen.ts` → `AttachmentOpenRequest`, `isAttachmentOpenRequest`: extend the existing narrow channel with optional owner and local-only intent.
- `src/renderer/src/screens/conversation/downloadAttachment.ts` → `downloadAttachment`, `attachmentDownloadDeps`: original-first activation followed by existing retrieve/save sequence.
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → `BubbleAttachmentImage`: add owner to the existing activation, without changing markup.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `attachmentAskTarget`: reuse the upload's conversation/host targeting.
- `e2e/fixtures/launchPairedApp.ts`, `src/main/transport/fakeDaemon.ts` → `launchPairedApp`, attachment stored replies: exercise a real local upload against the fake transport.
- `e2e/attachment-image-open.spec.ts` → OS-open recorder pattern, safely avoids opening a real native viewer.
- `docs/knowledge/features/attachment-upload.md`, `attachment-save.md`, `attachment-open.md`: keep paths main-only; preserve filename cleanup, collision handling and fallback signature checks.
- `docs/knowledge/features/development-verification.md`: await each positive OS-open result before asserting absence of copies.

Codegraph context returned “not initialized”; callers and definitions were inspected directly.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4605

The file row is a horizontal document glyph with extension overlay, a 12px gap and body-small filename in inverse-primary. Reuse the existing row and tokens unchanged.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=120-3848

The right-aligned user bubble stacks body-medium text, a rounded image thumbnail and a small timestamp/copy row. Keep `AttachmentThumbnail` and its appearance within desktop layout https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 unchanged. Both node contexts and screenshots were read.

## Design

Add `createLocalAttachments` in `src/main/localAttachments.ts`, constructed once in main.
It retains an immutable first association per client attachment ID: absolute original
path, resolved server ID, and upload conversation ID. `remember` has no renderer or
daemon caller. The upload seam in `buildDeps` resolves a target before awaiting
the transfer and records only an `ok` result for a local picker/drop path. Paste,
cancel, read refusal, failed upload and thrown upload never register anything.

Extend `AttachmentOpenRequest` with optional `conversationId`, `serverId` and
`localOnly`. Validate their shape and bound the conversation like retrieval.
Legacy unscoped requests retain raster fallback. Main resolves the requested server
against the held registry, then `localAttachments.open` requires exact attachment,
server and conversation equality. No filename participates in registration or lookup.
The original is opened read-only, checked as a regular file, and closed before the
injected OS-open call. Return existing `opened`, `unavailable` or `open-failed` events.

File-row activation first sends an owner-scoped `localOnly` open request. Subscribe
before sending; unsubscribe on the correlated terminal. Only `unavailable` proceeds
to the current retrieval/save flow. OS refusal reports `open-failed` without making
a duplicate. Image activation supplies the same owner to its existing request;
main tries the original, then uses `createAttachmentOpen` only on `unavailable`.
Thumbnail retrieval still supplies the existing preview cache, independently of activation.
No new IPC channel, preload method, dependency, markup or wire type is needed.

## State + concurrency model

The map belongs to the main-process lifetime and survives chat/window navigation.
Capture the resolved server and input conversation before awaiting upload; subsequent
selection changes cannot change either. First registration wins, so an ID cannot be
reassigned. Concurrent clicks independently open the same original without any write.
No timer, subscription or background job is added in main. Renderer open listeners
end on their bounded local operation's terminal; retrieval retains its existing lifecycle.

## Error handling

No association or wrong owner, missing/unreadable original, and a directory replacing
the original all return `unavailable`. OS rejection or exception is `open-failed`.
Drop filesystem/OS error objects without inspection; they can carry paths. Log only
static registration/open/unavailable/failure codes through `DiagnosticLog`.
Existing download cleanup/collision handling and image-type refusal remain unchanged.

## Testing strategy

- RED unit tests for owner isolation, immutable registration, repeat opens of spaced filenames and images, missing/unreadable originals, OS refusal and content-free events/logs, with temporary files and recorded OS calls.
- Extend open-request guard tests and renderer sequencing tests; existing retrieval/save tests continue proving fallback behavior.
- Fake-transport Playwright: choose a real temporary file through the stubbed native picker, await successful upload, send, activate repeatedly and record the exact OS path; cover image activation, cancelled/failed uploads and missing-original fallback. No renderer-only completion injection.
- Capture file/image bubble state in that focused spec for visual comparison. Run touched unit specs, `npm run build`, and that Playwright spec with approved macOS execution. No live Claude gate required.

## Scope check

Five production files: new local map, main composition root, shared open request,
file activation helper and image component. Estimate 650–750 written lines including
tests and this plan; one new exported factory, two updated renderer consumers, four
acceptance criteria, and fewer than ten failure branches. The #814 analogue added
826 lines across six files; reusing its IPC/save/open drivers avoids that expansion.
Refreshed remote feature branches; none overlap the planned files.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/attachment-upload.md`
§ Data flow with successful main-lifetime path registration; `attachment-save.md`
§ The copy driver with original-first file activation; and `attachment-open.md`
§ The driver with owner-scoped local preference and preserved raster fallback.
The ticket contains no additional documentation-only acceptance criterion.

## Open questions

None. Original files use the user's current default handler and current file contents;
the association is a path preference, not an immutable snapshot of the uploaded bytes.

## Security review

**Verdict:** PASS

- **Trust boundaries:** the existing guarded upload supplies a main-minted UUID; only successful local-file uploads register. Open requests must match the recorded server and conversation. A daemon filename cannot supply a path, register an association or change its owner.
- **Tokens/secrets:** no token changes. Original paths remain in main memory and never enter IPC outcomes, wire messages or logs; no persistence or renderer storage.
- **File operations:** original paths come only from the existing picker/drop boundary. Open-then-stat rejects unavailable/non-regular files without reading their contents. No new file writes. The OS API requires a path, so a same-user process can replace that path between the read check and OS handoff; this is the existing user-selected local-file trust boundary, not a daemon-controlled path. No atomic-write requirement arises.
- **Electron surface:** extend one guarded attachment request, never a general path opener. The broad default handler applies only to an original the user uploaded under that owner; received/pasted files still pass the raster gate. Existing sandbox, navigation denies and context isolation remain unchanged.
- **Cryptography:** reuse `randomUUID` in `uploadAttachmentFile`; no new crypto, comparison of secrets, keys or nonce lifecycle.
- **Network/I/O:** no new network operation or retry; existing bounded transfer and teardown stay intact. Local-first file activation also works without retrieving bytes. No relay/TLS changes.
- **Errors/logs:** static outcome codes only, no exception objects, IDs, filenames or paths. Tests inspect exact event/log shape.
- **Concurrency:** capture resolved ownership before awaiting; never derive it from the current selected chat at completion. No mutable owner update, persistent file, or long-lived new job.
- **Threat alignment:** hostile daemon data cannot register local paths; a compromised renderer can request only previously registered owner/ID matches, not arbitrary local paths through this extension. Local file modification by the same OS user and the user's default application remain trusted. Relay, safeStorage and daemon parsing contracts are unchanged.

**Reviewer:** builder, self-review using `builder/security-review.md`.
**Date:** 2026-09-19.

## Revisions

### 2026-09-19 — verifier triage: sidebar inspection read

The dispatcher failed in the sidebar naming-retry test while reading
`workspaceAttempts`; its launch-fate report shows the app remained alive and
exited cleanly. The attachment changes do not touch this spec or its launch
fixtures. The precise underlying protocol error was not retained by that run,
so an attachment regression or a specific V8 cause cannot be inferred from it.

Additional files read: `e2e/fixtures/mainProcessRead.ts` → `readMainProcess` and
`NOT_YET_AVAILABLE`; its unit tests; `e2e/chat-history-recording.spec.ts` → the
confirmed-deletion counter polls; `docs/knowledge/features/e2e-harness.md`
§ Tolerating a transient inspection-context loss on reads. Ticket #1502 records
the same live-app failure signature and the existing read-only tolerance.

Apply that helper only to the observed `workspaceAttempts` read in
`e2e/sidebar-add-workspace.spec.ts`. Poll for a nonempty string for at most five
seconds, retaining the successful value instead of performing a second read.
Never replay the listener installation, clicks or pushed events. Other errors
still propagate through the existing helper. Inject one transient error at this
read seam to prove RED before the change and GREEN afterward; then the real
Electron read must supply the attempt ID used by the existing isolation checks.
No production, IPC, security or visual contract changes. This rework adds one
test-file edit and this revision, staying below the original 800-line budget.

Documentation handoff additionally pending: `docs/knowledge/features/e2e-harness.md`
§ Tolerating a transient inspection-context loss on reads should list the sidebar
naming-retry read as a consumer of the existing helper.
