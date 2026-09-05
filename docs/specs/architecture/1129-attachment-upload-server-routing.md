# 1129 — the attachment upload names its server, and an ambiguous one is refused

Follow-up to #1120; the last entry point on `registry.active`, and the one that retires it.

## Files read

- `src/main/serverRouter.ts` → `createServerRouter`, `ServerRouter.resolve`, `ServerRouter.route`,
  `ServerTarget` — the resolver this slice consumes unchanged. Its header states the three outcomes,
  the "no fallback to the first or most recent connection" rule, and that the id from the window is
  untrusted and resolved against the registry rather than believed. Note for the design below:
  **`resolve` collapses both refusals into one `null`** and distinguishes them only in the diagnostic
  it emits (`server-route-refused` + `ambiguous-server` / `server-not-connected`).
- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadRequest`, `isAttachmentUploadRequest`,
  `AttachmentPasteRequest`, `isAttachmentPasteRequest`, `ATTACHMENT_PASTE_SOURCE`,
  `AttachmentUploadFailure`, `AttachmentUploadEvent` — the channel contract this ticket widens, and
  the paste ask's "nothing else" property (AC4's first assertion site).
- `src/main/index.ts` → the `whenReady` composition root: `servers` (the `createServerRouter` call),
  the stand-in binding `const connection = registry.active` and the header paragraph above it,
  `readClipboardImagePng`, and `attachmentUploadListener` with its three arms and one `deps`.
- `src/main/attachmentUpload.ts` → `AttachmentUploadDeps.upload`, `driveUpload`, `uploadAttachmentFile`,
  `uploadClipboardImage` — the flow module. Electron-free by design; `driveUpload` mints the
  `uploadId` with `randomUUID`, calls `deps.upload` **exactly once**, and emits exactly one terminal
  from its result. This is the seam the refusal is surfaced through.
- `src/main/transport/attachmentTransfer.ts` → `AttachmentTransferResult`, `AttachmentTransferFailure`
  — the `upload` seam's return type. Its failure set already contains `not-connected`; widening it
  would cascade into `daemonConnection` and the shared re-declaration.
- `src/shared/ipc/commands.ts` → `hasValidServerId` (module-private) and the `serverId?: string` arms
  of `RendererCommand` — #1120's optional-field rule, which this slice mirrors rather than imports.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` →
  `ATTACHMENT_UPLOAD_FAILURE_COPY` — the `Record<AttachmentUploadFailure, string>` mirror that makes a
  new failure literal compile-force a fourth production file and a user-facing sentence.
- `src/preload/index.ts` → `dropAttachmentFile`, `pasteAttachmentImage` — the two senders, and AC4's
  second assertion site ("takes no argument at all").
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `pasteImage` — AC4's third assertion
  site ("IT CARRIES NOTHING").
- `src/shared/ipc/attachmentUpload.test.ts` → the `isAttachmentUploadRequest` /
  `isAttachmentPasteRequest` describes and the "side by side" describe — the extra-keys acceptances at
  the top of each, and the both-shapes ask that makes the drop arm's ordering load-bearing.
- `docs/knowledge/features/daemon-connection-routing.md` § "The command shape", § "The boundary
  guard's optional-field trap", § "What's left on `active`" — #1120's recorded reasoning for the
  optional field, for `''` being accepted at the guard and refused at the resolver, and for
  `DiagnosticEvent` staying `{ event, code? }`.
- `docs/knowledge/features/attachment-upload.md`, `composer-attach-paste.md`,
  `attachment-upload-guard-and-drive.md` — the channel's own prior lessons.

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo answers "CodeGraph not
initialized", so the reading list above was built with Grep and Read.

## Design source

**Figma:** N/A — no UI is added or changed. The only renderer file this slice touches is a docblock in
`ComposerAttach.tsx` (AC4). The visual-fidelity check is intentionally skipped.

## Context

`registry.active` (#1117) is the stand-in the composition root binds so that call sites written for a
single connection keep working while the registry holds many. #1118, #1119 and #1120 moved everything
that arrives through the `onCommand` switch off it. What is left is one binding with one consumer:
`deps.upload` in `attachmentUploadListener`. With two servers paired, a dropped, pasted or picked file
uploads to whichever host was paired most recently, regardless of which chat is open.

This slice moves that last consumer onto `servers` and deletes the binding, so the stand-in is retired
rather than shrunk again.

No ADR is warranted. The decision this ticket makes — where the refusal is decided and what the user
reads — is a channel-local one and belongs in this plan and in the package overview, not in a new
decision record. The design record for server routing as a whole is already
`docs/specs/architecture/1120-server-scoped-command-routing.md`.

## Design

### 1. The ask carries an optional routing key — on **both** guarded shapes

`AttachmentUploadRequest` and `AttachmentPasteRequest` each gain `serverId?: string`. Optional, for
#1120's recorded reason: no renderer sender has a per-server surface to source an id from until #1086
lands, so a required field would be a compile-forced edit in senders that have nothing to supply.

**The paste ask's "nothing else" property is extended, not broken — and this is AC4's first branch.**
The property is that no renderer-supplied value reaches *a filename, a byte, or the wire* on the paste
path. A server id reaches none of those three. It is resolved against the registry's held entry set by
`connectionFor` and then discarded; it is never interpolated into a log line (`DiagnosticEvent` has no
identifier-shaped field), never a path segment, never a wire field, and never a capability — the window
can name a server it has already paired, it cannot conjure one. What the ask still carries no way to
express is the image itself: the bytes are read in the background process, from the clipboard, after
the ask arrives, and `uploadClipboardImage` still takes no field off the ask whatsoever. The one field
that *selects an arm* is still a client-owned literal the renderer cannot vary.

The alternative AC4 offers — source the id somewhere other than the paste ask — has no candidate. The
ask is the only thing main receives on that path. Declining to widen it would leave paste as the one
entry that can never name a server, and would push the same three docblock amendments into a later
ticket with strictly less context than this one has. So all three sites are amended here:

- `AttachmentPasteRequest`'s docblock (`src/shared/ipc/attachmentUpload.ts`)
- `pasteAttachmentImage`'s docblock (`src/preload/index.ts`) — the sender still takes no argument and
  still supplies no id, so its literal claim survives; what is amended is the "nothing renderer-supplied
  reaches … at all" paragraph, which now names the routing key and says why it sits inside the property.
- `pasteImage`'s docblock (`src/renderer/src/screens/conversation/ComposerAttach.tsx`) — same
  qualification, one sentence.

The picker arm has no ask object at all, so it has nowhere for an id to ride and takes the unnamed
path — exactly as AC1 requires.

### 2. The guards learn the optional-field rule, locally

Both guards gain an `absent-or-`undefined`-or-string` check on `serverId`, via **one module-local
helper in `attachmentUpload.ts` shared by both**, mirroring `hasValidServerId` in `commands.ts`:

```ts
function hasValidServerId(value: object): boolean   // absent | undefined | string
```

- **Absent-or-undefined-or-string, and every word is load-bearing.** Structured clone preserves an own
  property whose value is `undefined` across the IPC bridge, so `'serverId' in value` alone is wrong in
  both directions: a present-key *check* reads `{ serverId: undefined }` as a supplied value, and a
  present-key *rejection* refuses the ordinary bare ask every shipped sender emits.
- **Type, not emptiness.** `''` is accepted here and refused one layer later — `serverRouter.resolve`
  takes the named branch for a present string and no held entry's id is `''`.
- **Duplicated deliberately, not shared by import.** No production module under `src/shared/ipc/`
  imports from a sibling today (only the test files cross-import), and each channel module states its
  own boundary rules in full — both guards here already re-implement the object/null/`in` checks that
  every sibling guard also has. Exporting `commands.ts`'s helper would make this the first production
  cross-import in the directory and add a fourth production file for three lines. The two copies are
  cross-referenced by symbol in both docblocks so a reviewer can see they agree on purpose. This is
  *not* the divergent-checks shape `attachmentBytes.ts` argues against: that is two gates on one value,
  where one can be weaker; this is one gate each on two different values on two different channels.

`serverId` therefore stops being an unread extra key and becomes a read field with a rule. The existing
"accepts extra keys" acceptances are unaffected — neither uses `serverId` — and a new test states the
distinction outright.

### 3. The refusal is surfaced through the existing `upload` seam, as `not-connected`

**This is the plan's main call, and it is the cheap answer, taken on the merits rather than on cost.**

The listener's single `deps` object becomes a factory called exactly once per ask, **after an arm has
been selected**:

```ts
const buildDeps = (serverId: string | undefined): AttachmentUploadDeps => ({ … })
```

whose `upload` arrow resolves at send time:

```ts
upload: (input, onProgress) => {
  const target = servers.route(serverId)
  return target === null
    ? Promise.resolve({ ok: false, outcome: 'not-connected' })
    : target.uploadAttachment(input, onProgress)
}
```

Four things this buys, and one it costs.

**The window gets exactly one terminal with the right id, from machinery that already exists (AC3).**
`driveUpload` mints the `uploadId`, calls `deps.upload` once, and emits exactly one terminal from its
result. A refusal decided *before* the flow module runs has no id to address itself to, so it would have
to mint one at the root and hand-write the exactly-one property that `driveUpload` already proves.

**No second resolver, and no re-derivation of the resolver's branch (AC2).** `resolve` returns one
`null` for both refusals. Any distinct user-facing literal would therefore need either a sentence vague
enough to cover both — no more honest than the one already there — or a re-derivation of
`serverId === undefined` at the call site, which mints a second copy of the decision the resolver owns.
`serverRouter.ts`'s header is explicit that the decision lives in the tested module and not in
hand-written blocks at the untested root.

**No fourth production file, no new sentence, no widened transport union.** A new
`AttachmentUploadFailure` member compile-forces `attachmentUploadCopy.ts`; and because `driveUpload`
assigns an `AttachmentTransferFailure` straight into `reason`, returning a new literal from this arrow
would *also* mean widening `AttachmentTransferFailure` in `src/main/transport/attachmentTransfer.ts`,
which `daemonConnection` and the shared re-declaration both consume.

**Honesty, weighed and accepted.** "Not connected — the file was not sent." is exactly right for
`server-not-connected`. For `ambiguous-server` it is imprecise: the client is connected, to more than
one host, and has no way to choose. It is accepted because there is no action the sentence could invite
today — the composer has no server surface until #1086 — so a truer literal would differentiate a
message the user can do nothing differently about. The distinction is not lost: `resolve` already logs
`server-route-refused` with `ambiguous-server` vs `server-not-connected`, so the operator-facing
diagnostic is precise while the composer sentence is coarse. **When #1086 gives the composer a server
to name, a truer literal becomes worth minting** — and at that point the resolver would need to report
*which* refusal it made, which is a change to `serverRouter.ts`, not to this channel.

**The cost:** the file is read from disk (or the clipboard is read) before the refusal, because the
route is resolved at send time. That is not a regression — it is exactly today's shape on an unpaired
launch, where the sole stand-in entry's `uploadAttachment` answers `not-connected` after the same read.
AC5's "single-server behaviour is untouched" is satisfied by construction: with one held entry,
`servers.route(undefined)` answers that entry and the arrow reduces to today's expression.

### 4. One `deps` object per ask stays one

`deps` is shared by all three arms deliberately, so they cannot drift into reporting on different
channels or forwarding progress differently. Exactly one arm runs per ask — each returns — so exactly
one `buildDeps` call happens per ask. The factory makes this *stronger* than the current inline literal,
not weaker: there is still one construction site, and it is now structurally impossible to hand two arms
differently-built `emit`s, because there is one body rather than one object anyone could copy.

The factory is called **inside each arm, never at the top of the listener**. That is what preserves the
property at the neither-guard return: `servers.route` is reached only from `upload`, `upload` is reached
only from the flow module, and the flow module is reached only from a matched arm — so a malformed ask
still returns having emitted no event and written no log line, and a looping renderer is still denied
any lever on the main-process logger (AC3).

### 5. The stand-in is retired (AC5)

`const connection = registry.active` is deleted — it has no other consumer. The header paragraph above
it is rewritten from "what is left on this stand-in is ONE entry point" to a statement that the stand-in
is retired: every entry point now resolves through `router`, `correlations` or `servers`, and a new one
must pick the index that matches what it is about. `ConnectionRegistry.active` itself stays (out of
scope; it has its own coverage in `connectionRegistry.test.ts`).

## State + concurrency model

No store slice, no new async task, no new subscription, no new timer, no new listener registration.
`createServerRouter` holds no state and installs no observer, so nothing here needs teardown and
`will-quit`'s existing `removeListener` for `ATTACHMENT_UPLOAD_CHANNEL` is unchanged.

The one ordering fact worth stating: resolution moves from **listener-construction time** (today's
`registry.active`, bound once at startup and re-resolved internally per call) to **send time, per
upload**. There is no check-then-act gap — the lookup and its use are one expression in one tick, as
`serverRouter.ts`'s header states — and the registry is consulted afresh for every upload, so a server
unpaired between the ask and the send refuses rather than reaching a stopped connection. Concurrent
uploads to two servers are independent: each ask builds its own `deps` and resolves its own target.

## Error handling

- **Unresolvable route** → `{ ok: false, outcome: 'not-connected' }` from the `upload` arrow →
  `driveUpload` emits `{ type: 'failed', uploadId, reason: 'not-connected' }` → the composer renders
  `ATTACHMENT_UPLOAD_FAILURE_COPY['not-connected']`. Exactly one terminal, existing literal, existing
  sentence.
- **Malformed ask** (matches neither guard, including an ask whose `serverId` is a non-string) →
  dropped: no filesystem call, no clipboard read, no event, no log.
- **Every other failure** is unchanged: `unreadable`, `too-large`, `no-image`, and the daemon's
  verdicts all keep today's shapes and literals.
- No exception is introduced. `servers.route` is total and non-throwing; the arrow returns a resolved
  promise on the refusal branch, so `driveUpload`'s existing `try` around `deps.upload` stays a backstop
  rather than becoming a live branch.

## Testing strategy

Vitest, `src/shared/ipc/attachmentUpload.test.ts` — the guards are the testable half, and the routing
decision itself is already covered by `serverRouter.test.ts` (`src/main/index.ts` has no unit test in
this repo and never has; #1118's recorded reason for putting the decision in the resolver).

Per guard (`isAttachmentUploadRequest`, `isAttachmentPasteRequest`), as scenarios:

- accepts an ask naming a server (`serverId` a non-empty string)
- accepts an ask with **no** `serverId` key — the bare ask every shipped sender emits today
- accepts an ask with an explicitly-`undefined` `serverId` — the structured-clone trap, stated as a
  test rather than as a comment
- accepts `serverId: ''` — type, not emptiness; refused one layer later by the resolver
- rejects an ask whose `serverId` is a non-string, table-driven over the shapes a hostile or buggy
  renderer can produce (number, boolean, null, array, object)
- states that `serverId` is no longer an unread extra key, alongside the existing extra-keys acceptance
  which stays true for every other key

No new e2e spec. The behaviour that changes is per-server routing, which the single-daemon fixture
cannot exercise at all; with one held entry every arm behaves exactly as today, which is what AC5 asks
`npm run e2e` to demonstrate with no spec edits.

`needs-real-claude` is not applicable: no wire behaviour changes, only which connection a frame is
handed to. This will be re-checked at the end of implementation per the routing overview's standing
instruction.

## Open questions

1. **Does anything outside `src/preload/index.ts` construct an upload or paste ask literal that the
   narrowed guards would now refuse?** A repo-wide search for the two type names and the two channel
   constants found production constructions in the preload alone, plus the guard tests. To be
   re-confirmed against the built tree in Phase B, since a non-string `serverId` is the only newly
   rejected shape and no sender emits the field at all.
2. **Does `buildDeps` belong before or after the `pickerOpen` gate in the picker arm?** After — a
   suppressed second picker should build nothing, and the deps are only needed once the dialog resolves
   with a choice.

Each is resolved in Phase B; anything that changes the design above is recorded under `## Revisions`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding that changes the design. The design adds exactly one untrusted
  value crossing renderer→main, and it crosses two explicit named gates: shape at
  `isAttachmentUploadRequest` / `isAttachmentPasteRequest`, existence at `serverRouter.resolve` →
  `ConnectionRegistry.connectionFor`. Nothing downstream holds it: the arrow passes it to `route` and
  discards it, and `ServerTarget.serverId` — the *resolved* key, not the renderer's string — is not
  read on this path at all (this channel takes `route`, not `resolve`, precisely because it has no
  per-server state to key). Verified rather than assumed: `connectionFor` is
  `entries.find((entry) => entry.serverId === serverId)` — an array scan with `===`, never an object
  key — so `__proto__` / `constructor` / `toString` are ordinary non-matching strings here and refuse
  on the `server-not-connected` branch like any other unknown id. There is no prototype chain to reach
  and no `Object.prototype` member to hand back as a connection.

- **[Trust boundaries / renderer compromise]** The real widening, named rather than glossed: a
  compromised renderer gains the ability to **choose which already-paired server** receives a dropped
  or pasted file, where today it gets whichever host was paired most recently. It does not gain the
  ability to reach a server the operator has not paired — `connectionFor` is the boundary and the
  window can name a server, not conjure one. Accepted, on three grounds: the same choice has existed
  for every conversation-scoped command since #1118 and for six server-scoped ones since #1120, so
  this is not a new capability class; the refusal-by-default posture means the *unnamed* path still
  cannot pick a server at all; and the mitigation that would actually matter — the operator seeing and
  confirming the destination — is #1086's per-server composer surface, which does not exist yet and is
  explicitly out of scope here. Declining to widen the paste ask would not remove this: the drop ask
  carries the same key, and paste would simply be unroutable rather than safe.

- **[Trust boundaries / clipboard oracle]** A pre-existing property this slice must not be read as
  introducing. A looping compromised renderer can send paste asks and distinguish `no-image` from any
  other terminal, learning whether the clipboard currently holds an image. With a bogus `serverId` the
  refusal now lands before any frame reaches the wire, so the oracle is quiet. It was already quiet:
  the same loop on a disconnected or unpaired launch reads the clipboard and answers `no-image` or
  `not-connected` with no wire traffic today, and the renderer already knows the connection status
  because it renders it. Refusing *before* the clipboard read would require deciding the refusal at the
  composition root, which means minting an upload id outside `driveUpload` and hand-writing the
  exactly-one-terminal property — trading a proven invariant for a bit that is already obtainable. If
  it is ever wanted, it is a change to `uploadClipboardImage`'s own shape, filed separately; § Scope
  Discipline forbids taking it here.

- **[Tokens, secrets, credentials]** Not applicable, as a design decision rather than an absence:
  `serverId` is a routing key, never a credential, and it is *looked up* rather than *compared against
  a held secret*. That distinction is worth stating because the pattern "compare an untrusted string to
  a value main holds" otherwise pattern-matches to the timing-attack category — `crypto.timingSafeEqual`
  is not applicable, because the set of valid ids is not secret (the renderer already holds the paired
  record list) and learning it grants nothing. No token, key, or Noise material is read, written,
  logged, or stored by any line this slice adds.

- **[File / storage operations]** No finding. The id reaches no path segment, no filename, no cache
  key and no `fs` call: `driveUpload` names the file from `basename(path)` or from
  `clipboardImageFilename`'s client-owned stem, both untouched here, and this channel writes nothing to
  disk at all. No `path.join`, no `existsSync`-then-open, no temp file, no atomic-rename obligation is
  introduced. The one path in this channel — the drop's — keeps `MAX_UPLOAD_PATH_LENGTH` and the
  empty-string refusal exactly as shipped.

- **[Inter-process / Electron attack surface]** No finding. No new channel, no new `contextBridge`
  member, no new `ipcMain` registration, no `webPreferences` change and no new renderer permission —
  the standing instruction that the allowlist must never grow to `clipboard-read` is untouched, and the
  preload still exposes two argument-shaped senders that fix their own channel constant.
  **Considered and deliberately declined: a length bound on `serverId`.** The path field has
  `MAX_UPLOAD_PATH_LENGTH`, so its absence here is a real asymmetry. It is declined because the id is
  looked up and discarded — it reaches no map key (this channel holds no per-server state; #1120 is
  where the memo-keyed-by-resolved-id decision was made and it stands), no log line, no path, no wire —
  so an oversized value costs one transient allocation the structured clone has already paid for, and
  both guards already accept unbounded *unread* extra keys today. A bound here that `hasValidServerId`
  in `commands.ts` lacks would be the divergent-rule shape rather than defence in depth.

- **[Cryptographic primitives]** Not applicable. No RNG is added (`randomUUID` in `driveUpload` is
  unchanged and unreached by this slice), no primitive is selected, no Noise state is touched, and no
  `(key, nonce)` pair is created or reused. The refusal path puts nothing on the wire, so it cannot
  perturb a session's nonce counters.

- **[Network & I/O]** No finding. No socket, frame, timeout, TLS setting or reconnect policy is added
  or changed; a refused upload sends nothing. One amplification question walked explicitly: a
  well-formed ask carrying a bogus id *does* produce a `server-route-refused` log line, unlike a
  malformed ask. That is the same deliberate asymmetry #1120 shipped — an ask main *refuses to
  recognise* is silent, an ask it recognises and then refuses is observable — and it is
  self-limiting here in a way it is not on the command channel, since reaching the log costs a full
  file read and chunk plan first.

- **[Error messages, logs, telemetry]** No finding, with one implementation constraint. The refusal
  reaches the user as the existing `not-connected` sentence, which carries no daemon text, no path and
  no errno; the diagnostic is the resolver's existing static `{ event: 'server-route-refused', code }`
  pair. **SHOULD FIX (Phase B, verifier-checkable):** the implementation must add **no** `diagnosticLog`
  call in `attachmentUploadListener` and must not interpolate `serverId` into any string. The resolver's
  two static pairs are the whole of this slice's logging, and `DiagnosticEvent` stays `{ event, code? }`
  — a server id is structurally unrepresentable there, and widening it would drag the renderer-facing
  `projectDiagnosticEvent` contract along.

- **[Concurrency]** No finding. No state, timer, listener or long-lived task is added, so there is
  nothing new for `will-quit` to tear down. Two concurrent uploads are independent: each ask builds its
  own `deps` and resolves its own target, and neither shares mutable state with the other. The
  resolution is one expression in one tick, so there is no check-then-act gap; a server unpaired between
  the ask and the send resolves to `null` and refuses, and one stopped between the resolution and
  `uploadAttachment` answers `not-connected` / `connection-lost` through the terminal that already
  covers it. `driveUpload` calls `deps.upload` exactly once, so `route` runs once per upload — a future
  retry loop would resolve twice and could legitimately resolve differently, which is correct behaviour
  rather than a race, and is not a live branch today.

- **[Threat model alignment]** No finding. Malicious relay, hostile daemon and token-theft-from-disk are
  all untouched — no wire change, no parse change, no at-rest change — and a refused upload never
  reaches the daemon at all, so the hostile-daemon surface strictly shrinks on that path. Renderer
  compromise reaching the transport is the live threat and is answered above: process isolation is
  unchanged, the renderer still holds no key, no socket and no byte, and what it gains is a routing key
  resolved against entries this process already holds. **OUT OF SCOPE, named:** the operator-visible
  destination for an attachment (#1086), and the removal of `ConnectionRegistry.active` itself (a
  separate cleanup the ticket carves out).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

## Revisions

### 2026-09-06 — Open Questions resolved; one addition to the amendment set

Both Open Questions resolved without changing the design.

1. **Nothing outside the preload constructs an ask literal.** A repo-wide sweep for the two type names,
   the two channel constants and the two sender names finds production constructions only in
   `dropAttachmentFile` and `pasteAttachmentImage` (`src/preload/index.ts`), plus the guard tests. No
   `e2e/` spec and no renderer module builds one, so the narrowed guards refuse nothing that is sent
   today — no sender emits `serverId` at all, and a non-string value is the only newly rejected shape.
2. **`buildDeps` goes after the `pickerOpen` gate.** A suppressed second picker now builds nothing, and
   the deps are needed only once the dialog resolves with a choice.

**Addition to AC4's amendment set: two more restatements in the module header, and one in a test
comment.** AC4 names three assertion sites for the paste ask's "nothing else" property. A sweep for the
property's other spellings found three more, all of which would have left the repo contradicting itself:
`attachmentUpload.ts`'s module header asserts it twice (the three-asks paragraph, and the
narrowest-of-the-three paragraph), and `attachmentUpload.test.ts`'s extra-keys acceptance asserts the
stronger form — "nothing downstream reads ANY field off this ask" — which `serverId` makes false as
written. All three are amended alongside AC4's three, so the set is six rather than three. The property
they now state is the one that survives: nothing renderer-supplied reaches a filename, a byte or the
wire, and the ask carries nothing *about the image*.

No change to the design, the resolution model, the failure literal or the file set.
