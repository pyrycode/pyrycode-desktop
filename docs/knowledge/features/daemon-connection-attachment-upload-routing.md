# The attachment upload names its server, and the stand-in retires (#1129)

Split out of [Daemon connection — per-server routing](daemon-connection-routing.md) 2026-09-07 to keep that document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

The last consumer of `registry.active`, and a different surface from the six #1120 moved: the upload
arrives on its own IPC channel behind `isAttachmentUploadRequest` / `isAttachmentPasteRequest`
(`src/shared/ipc/attachmentUpload.ts`), never through the `onCommand` switch, so it could not simply
join #1120's `serverId?: string` arms — it needed its own optional field on both guarded ask shapes,
checked by a channel-local `hasValidServerId` that restates rather than imports #1120's
`hasValidServerId` in `commands.ts` (no production module under `src/shared/ipc/` imports a sibling;
see [Attachment upload § The request body and its guard](attachment-upload.md) for the guard itself).
The **resolver is #1120's, unchanged** — `servers.resolve` / `servers.route` are consumed exactly as
shipped, with no new outcome, no new refusal shape and no second resolver minted.

**The routing decision moved from listener-construction time to send time, per upload — the ticket's
one real design call.** Before #1129 the listener's single `deps` object was built once, hoisted to the
top of `attachmentUploadListener`, and shared by all three arms (drop, paste, picker) so they could not
drift into reporting on different channels. #1129 turns that object into a factory,
`buildDeps(serverId)`, called exactly once **inside whichever arm the ask selects** — never at the top
of the listener — so `servers.route` (which logs `server-route-refused` on both its refusal branches)
is reached only after the guards have already discriminated a well-formed ask from a malformed one.
Resolving earlier would hand a looping renderer, sending garbage that matches neither guard, the exact
lever `src/main/index.ts`'s neither-guard-matched return exists to deny it. The factory shape is
*stronger* than the old hoisted literal, not weaker: there is still exactly one construction site and
one call per ask, and it is now structurally impossible for two arms to be handed differently-built
`emit`s, because there is one body rather than one object anyone could copy.

**The refusal is surfaced through the existing `upload` seam as `not-connected`, rather than decided
before the flow module runs.** `driveUpload` (`src/main/attachmentUpload.ts`) mints the `uploadId`,
calls `deps.upload` exactly once, and emits exactly one terminal from what it returns — machinery that
already exists and is already tested. A refusal decided at the composition root, before `driveUpload`
runs, would have no id to address itself to and would have to hand-write that exactly-one-terminal
property by hand. The cost is one sentence's honesty: "Not connected — the file was not sent." is exactly
right for `server-not-connected` and imprecise for `ambiguous-server`, where the client is connected to
more than one host and simply cannot choose. Accepted, because `resolve` already collapses both
refusals into one `null` — a distinct composer sentence would need either a vaguer sentence than the one
already shown, or a re-derivation of the resolver's own branch at the call site, duplicating a decision
`serverRouter.ts` owns — and because minting a distinct `AttachmentUploadFailure` member would
compile-force a fourth production file (`attachmentUploadCopy.ts`) for a sentence with no differently
actionable instruction behind it, until #1086 gives the composer a server surface to name. The
operator-facing diagnostic stays precise regardless: `resolve` logs `ambiguous-server` vs
`server-not-connected` under `server-route-refused` either way.

**The picker arm has no ask object at all**, so it has nowhere for a routing key to ride and takes the
resolver's unnamed path unconditionally — the sole connection when the registry holds exactly one
entry, a refusal when it holds more. `buildDeps(undefined)` is called after the `pickerOpen` gate, so a
suppressed second picker builds nothing.

**No renderer sender was wired to send a `serverId` in this slice.** The composer has no per-server
surface to source one from until #1086 lands, so both shipped senders
(`dropAttachmentFile`/`pasteAttachmentImage`, `src/preload/index.ts`) still emit the bare ask, and every
upload today still takes the unnamed path — single-server behaviour is unchanged byte-for-byte. See
[Attachment upload](attachment-upload.md) and [Attachment upload — the guard and the
drive](attachment-upload-guard-and-drive.md) for the channel-contract and guard detail, and
`docs/specs/architecture/1129-attachment-upload-server-routing.md` for the full plan and security
review.

With #1129 landed, every entry point into a daemon connection resolves through one of three indexes —
`router` (a conversation id), `correlations` (a modal, question-batch or session id) or `servers` (about
a whole server, or nothing at all) — and refuses what it cannot resolve. There is no default connection
left anywhere in this process, and a new entry point picks its index by what it is *about*, never by
adding a fourth.
