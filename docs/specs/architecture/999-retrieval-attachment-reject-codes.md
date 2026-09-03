# 999 — Narrow the retrieval leg's two attachment reject codes

## Files read

- `src/main/transport/inboundMessage.ts` → `DaemonErrorOutcome` (the type this slice extends, and its
  header docblock carrying the now-expired "deliberately absent" claim, the stale member count and the
  literal flag tuple), `narrowDaemonErrorOutcome` (the `switch` that gains two cases, and the docblock
  arguing why it is total by construction), `parseInboundMessage`'s `error` arm (unchanged — it already
  routes here and already propagates `inReplyTo`).
- `src/main/transport/inboundMessage.test.ts` → `describe('parseInboundMessage — daemon-error outcome
  narrowing (#965)')`: its `encodeReject` helper, the `LEG` table and its comment, and the
  `it('lands an unrecognised code on the one catch-all outcome')` case that currently asserts both new
  codes land on `unclassified`. That case is the RED this slice inverts.
- `src/main/transport/attachmentTransfer.ts` → `AttachmentTransferFailure`. **The cascade the ticket did
  not predict starts here**: it is declared as `DaemonErrorOutcome | 'not-connected' | 'connection-lost'
  | 'send-failed'`, so widening `DaemonErrorOutcome` widens it. Its docblock's "The seven
  DaemonErrorOutcome members" goes stale on this edit.
- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadFailure`. A hand-written re-declaration of
  `AttachmentTransferFailure` widened by one (shared must not import from `src/main`), whose docblock
  states the correspondence is "kept by the COMPILER, not by discipline". The compiler duly speaks: see
  § Design.
- `src/main/attachmentUpload.ts` → `driveUpload`. Holds the `reason: result.outcome` assignment that is
  that compiler check, and the only site outside `inboundMessage.ts` that this slice's widening reddens.
- `src/main/daemonConnection.ts` → the `daemon-error` case's `transferForEnvelope` branch, which passes
  `inbound.outcome` unmodified into a transfer's `fail()`. Not edited, but it is the call site that
  decided § Design's option question.
- `src/main/transport/fakeDaemon.ts` → `AttachmentRejectCode`. Read to confirm its conclusion survives
  this slice unchanged. **Deliberately not edited** — see § Design.
- `docs/knowledge/features/daemon-error-outcome.md` → the code table and § Edge cases. Read-only: it
  records that `outcome` already has a reader (`transferForEnvelope` → `fail()`), which is the fact that
  made the cascade below findable. The documentation phase folds this slice in; this slice does not edit it.
- `pyrycode` checkout: `internal/protocol/codes.go` (`CodeAttachmentNotFound` /
  `CodeAttachmentStreamAborted` and the deliberate-merge prose), `internal/relay/
  v2session_attachment_request.go` (`rejectAttachmentNotFound` = `false`, `rejectStreamAborted` = `true`
  — the retryability read off the daemon rather than inferred), `docs/protocol-mobile.md` § Error codes
  and § Attachments (the published rows, the discard-the-partial obligation, the both-verbs widening).

## Design source

**Figma:** N/A — main-process wire decoding, no rendered surface. Nothing in this slice is visible.

## Context

`DaemonErrorOutcome` classifies a daemon `error` frame's untrusted `code` string onto a client-owned
literal. Six codes are classified, all of them the attachment upload leg's; `attachment.not_found` and
`attachment.stream_aborted` were left out because the retrieval leg did not exist. It exists now
(`pyrycode#2053` streams it, `#2054` emits both codes; #993 built the request envelope, #998 the chunk
decode), so the omission's stated reason has expired and this slice closes it.

Nothing consumes the two new outcomes — #995 owns the consumer. This slice ships them dormant.

No ADR is warranted: this extends a vocabulary an existing decision record already covers.

## Design

### The two members

Append to `DaemonErrorOutcome`, after the complete `'message-too-long'` member and before
`'unclassified'`, each with its own doc comment:

- `'attachment-not-found'` — the requested id resolved to no file inside the named conversation's
  directory. NOT retryable (`rejectAttachmentNotFound`'s flag is `false`); the repair is to re-list the
  conversation's attachments, never to re-ask for the same id.
- `'attachment-stream-aborted'` — the daemon abandoned a retrieval mid-stream. Retryable **after a
  backoff** (`rejectStreamAborted`'s flag is `true`); a re-request re-runs the same resolution work, so
  never immediately. Carries the obligation no other member has: the client MUST discard everything
  accumulated for that transfer and MUST NOT present the partial bytes as the file. With no completion
  frame on this leg it is the stream's only negative signal.

Retryability is **documented on the member, read off the daemon's reject table** — the convention the
header already states for the existing six. No `retryable` field, no helper, nothing computing it.

Appending after `'message-too-long'` rather than grouping with the `attachment.*` neighbours keeps the
type's member order and the `switch`'s case order parallel, so the two lists still diff against each
other by eye.

### The `switch`

Two cases in `narrowDaemonErrorOutcome`, in the same position: `case 'attachment.not_found':` and
`case 'attachment.stream_aborted':`. The function stays total, keeps its `default: return
'unclassified'`, keeps inline literal comparison (no `Record` table — that would make untrusted daemon
text a lookup path), and reads nothing new off the payload. Its own docblock's argument for totality is
unchanged and stays as-is.

### No sub-case branches

Upstream makes `attachment.not_found` deliberately indistinguishable across an unknown id, a
non-canonically-shaped id, an id resolving outside the directory, and a stored file that could not be
read. That is a disclosure decision — two codes would turn the asking verb into a path-existence oracle.
There is nothing on the wire to branch on, so the classifier models one code and no sub-cases.

### The docblock repair

The header's `attachment.not_found` / `attachment.stream_aborted`-are-absent paragraph is replaced. The
replacement records that the classified set now spans both legs, that `attachment.not_found` answers
**both** a `request_attachment` and a `send_message` naming an id that does not resolve under that
message's own conversation (`pyrycode#2036`), and that the daemon deliberately never says which id or
which failure mode.

Two stale artefacts go with it, and both are removed rather than re-minted at a new value:

- The literal count ("The six classified members", and `'unclassified'`'s "a code outside the six
  above") becomes prose naming the two legs. A numeral here has now gone stale once; a new numeral would
  just queue up the next staleness.
- The literal flag tuple `` (`false, false, false, true, true`) `` is dropped. It was already a
  duplicate of what each member documents inline, and after this slice the flags live in **two**
  upstream files (`v2session_attachment.go` and `v2session_attachment_request.go`), so a single tuple
  could not be right. The header cites both files by name instead.

Insertion discipline: a docblock binds to the declaration that **follows** it, so both new members go in
after a complete member, and `'unclassified'`'s own docblock stays adjacent to `'unclassified'`. The
repair of the header is verified as a pure move — same lines out and in — and the per-statement JSDoc
count is checked with the TypeScript compiler API before commit.

### The cascade the ticket did not predict — and which fix

The ticket's Technical Notes say *"Nothing outside `inboundMessage.ts` and its test is compile-forced."*
**That is wrong**, and it was measured rather than argued: widening `DaemonErrorOutcome` alone reddens

```
src/main/attachmentUpload.ts(234,41): error TS2322: Type 'AttachmentTransferFailure' is not
assignable to type 'AttachmentUploadFailure'.
```

`AttachmentTransferFailure` includes `DaemonErrorOutcome` whole, and `AttachmentUploadFailure` is its
hand-written re-declaration on the shared IPC side. This is not a surprise defect — it is the check
`AttachmentUploadFailure`'s docblock says it exists to force: *"a twelfth outcome added upstream fails to
typecheck there rather than silently becoming unrepresentable here."* The check fired as designed.

Two candidate answers were implemented as throwaway probes and typechecked on **both** projects:

| Option | Change | `tsc node` | `tsc web` |
|---|---|---|---|
| **A** | Widen `AttachmentUploadFailure` by the same two literals | clean | clean |
| **B** | `Exclude` the two from `AttachmentTransferFailure` | **reddens `daemonConnection.ts`** at the `fail()` call | clean |

**Option A is the design.** Option B is the semantically tempting one — an upload transfer genuinely
cannot end in a retrieval reject — but it pushes the break down to `daemonConnection.ts`, where
`inbound.outcome` is handed straight to a transfer's `fail()`. Satisfying it would mean inventing a
runtime branch for a frame the wire cannot produce (a retrieval reject correlates by `in_reply_to` to a
`request_attachment` envelope id, never to a chunk's), which is exactly the speculative branch this
ticket's notes forbid. Option A absorbs the widening in the type system and adds no code path.

So `AttachmentUploadFailure` gains the two literals, documented as **representable but not reachable on
this leg**: the union mirrors `AttachmentTransferFailure` mechanically, and `DaemonErrorOutcome` is now
the vocabulary of both legs. That note is what stops a later renderer author writing UI copy for an
upload outcome that cannot occur. Its docblock's own counts ("The eleven inherited members", "a twelfth
outcome", "the seven from DaemonErrorOutcome") are repaired in the same edit.

`attachmentTransfer.ts` is touched **comment-only**: its docblock's "The seven DaemonErrorOutcome
members are the daemon's verdicts" is falsified by this edit, and leaving a false count behind is the
defect this ticket is closing at a different site.

**Three production files, then, not one** — `inboundMessage.ts`, `shared/ipc/attachmentUpload.ts`, and a
comment in `attachmentTransfer.ts`. Within the size-S boundary (≤ 5), and re-checked in full below.

### What is deliberately not touched

- **`fakeDaemon.ts`.** Its `AttachmentRejectCode` conclusion — that these two codes do not belong in the
  **upload** leg's reject builder — is still true: that builder answers an inbound `attachment_chunk`,
  and a retrieval reject answers a `request_attachment`. Widening it would let a fake emit codes the
  real daemon never sends on that leg. Only the docblock's stated *reason* has aged, and this block
  builds its rejects with its own local `encodeReject`, not through the fake. No retrieval-shaped
  builder is added either: nothing consumes these outcomes until #995, and a builder with no consumer is
  speculative infrastructure.
- **`docs/knowledge/features/daemon-error-outcome.md`.** The documentation phase owns it.
- **`daemonConnection.ts`.** No consumer arm — that is #995.

## State + concurrency model

None. `narrowDaemonErrorOutcome` is a pure total function over one payload; this slice adds no state, no
async work, no subscription and no teardown path.

## Error handling

The function's inversion of the module's fail-closed idiom is load-bearing and unchanged: it never
throws and has no failure return, because `daemonConnection` wraps `parseInboundMessage` in a bare
`catch { return }` and a throw here would silently kill the four behaviours the `daemon-error` case
drives. An error frame is terminal because it arrived, not because its payload parsed. The two new
codes join the classified set; everything else — an unmodelled code, a non-string `code`, a non-object
or absent payload — still lands on `'unclassified'`.

## Testing strategy

vitest only, in the existing `describe('parseInboundMessage — daemon-error outcome narrowing (#965)')`
block. No e2e: main-process only, no rendered surface, nothing to click.

- **The RED already in the tree.** `it('lands an unrecognised code on the one catch-all outcome')`
  currently asserts both new codes land on `'unclassified'`. Both come out of that list, which is the
  failing assertion this slice turns green from the other side. The list is refilled with real upstream
  codes outside the eight (`server.binary_offline`, `session.not_found`, `protocol.malformed`, all
  verified present in `codes.go`) so it keeps proving a neighbouring real code does not accidentally
  classify.
- **`LEG` grows to eight rows**, its comment repaired to drop the deliberately-absent claim. The
  existing `it.each(LEG)` gains the two new cases for free — and its **exact `toEqual`** is what proves
  AC4 for them: `encodeReject` puts `message`, `retryable` and a `retry_after_s` no real reject sends on
  the wire, so a decoder retaining any of them reddens rather than being tolerated by a subset match.
- **`it('gives the six reject codes six DISTINCT outcomes')` is renamed to eight.** Its assertion is
  `new Set(outcomes).size === LEG.length` and self-adjusts; only the name is stale.
- **New: the classifier compares exact literals.** A near-miss set — case variants, a trailing space, a
  dot removed — must all land on `'unclassified'`. Directly serves AC1's "no code outside the eight
  reaches a classified outcome" and pins that the comparison is literal equality, not a prefix or a
  normalise.
- **New: the wire's own `retryable` flag is not read.** `encodeReject` hardcodes `retryable: true`,
  which for `attachment.not_found` **contradicts** the daemon's published `false`. Asserting that it
  still narrows to `'attachment-not-found'` and that the result carries no flag proves retryability is
  documentation here and never computed — AC2's property, as a test rather than as prose. This is the
  first code in the set where the fixture and the real table disagree, which is what makes it assertable.
- No new fake, no new fixture file, no change to `encodeReject`.

## Open questions

- Whether `attachmentTransfer.ts`'s comment-only repair belongs in this diff. **Resolved during
  planning: yes** — the edit falsifies its stated count, and shipping a knowingly false docblock is the
  defect this ticket exists to close elsewhere. Recorded here rather than left implicit because it takes
  the production file count from the ticket's stated 1 to 3.
- Whether the near-miss test is over-reach for a slice this size. **Resolved: no** — AC1 asserts a
  negative over the whole code space, and the existing tests only sample real codes. One `it` covers it.

## Size check (re-counted against this written plan)

| Limit | Boundary | This plan |
|---|---|---|
| Production source files created or modified | ≤ 5 | **3** |
| Total written work | ≤ 800 | **~430** (plan ~290, production ~70, tests ~70) |
| New exported types / interfaces / components / stores | ≤ 5 | **0** |
| Consumer call sites needing simultaneous update | ≤ 10 | **0** (the widening is absorbed by the type; no call site is edited) |
| Acceptance criteria | ≤ 5 | **4** |
| Distinct error/reject branches in the classifier | ≤ 10 | **8** classified + `default` |

Within every line. No split — and the ticket is a grandchild of #687, so the depth cap forbids one
regardless.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No finding, and the boundary is the thing this slice edits.**
  `narrowDaemonErrorOutcome` is a single explicit boundary: it takes `payload.code` — untrusted text
  from an internet-exposed relay — as a **comparand only**, matches it against literals written in
  `inboundMessage.ts`, and returns a literal written in the same file. The two new returns are
  client-owned constants like the six before them, so the widened type still carries the property that
  makes it the trust signal: no value of `DaemonErrorOutcome` can hold daemon text. Nothing new is read
  off the payload — `code` remains the one field of `ErrorPayload`'s four that is touched at all.

- **[Trust boundaries / Electron IPC] SHOULD FIX, and it is what decided Option A.** The widening
  propagates through `AttachmentTransferFailure` to `AttachmentUploadFailure`, which crosses the
  `contextBridge` to the renderer as `AttachmentUploadEvent.reason`. § Design calls the two new
  inhabitants "not reachable on this leg", and that is a claim about a **conforming** daemon: a hostile
  one can put `attachment.not_found` in an `error` frame whose `in_reply_to` correlates to a pending
  upload chunk, and `transferForEnvelope` will hand it to that transfer's `fail()`. What crosses is
  still a client-owned literal — no leak, no path, no daemon text — so the impact is bounded to a
  renderer showing an odd failure reason for an upload. Two consequences, both taken: the member
  comment must say *not reachable from a conforming daemon* rather than *not reachable*, so a later
  reader does not treat unreachability as an invariant to rely on; and this is the argument that makes
  Option A safer than Option B, which would have made the value **unrepresentable** while a hostile
  daemon can still cause it, forcing `daemonConnection` to coerce it into some other outcome and report
  a failure that did not happen. Verified in Phase A that no renderer code performs a lookup over these
  literals today, so the widening cannot make an existing total lookup throw.

- **[File / storage operations] No finding, and the relevant hazard is upstream's, not reintroduced
  here.** `attachment.not_found`'s deliberate merge exists so the asking verb is not a path-existence
  oracle for a traversal probe. A client re-opens that oracle if it either branches on sub-cases the
  daemon fused or records the code somewhere an attacker can read back. This design does neither: one
  member for one code with no sub-branches (§ Design), and nothing retained. No path, filename, cache
  key or lookup index is derived from `code` — it is compared and dropped.

- **[Error messages, logs, telemetry] No finding, with a deterministic guard rather than a promise.**
  The `error` arm's diagnostic record emits `code: 'error'` — the envelope **type**, a client constant —
  and never `payload.code` or `payload.message`. ADR 0007's allowlist is enforced over field *names*,
  not values, so a `code: payload.code` regression would typecheck cleanly; that is why the existing
  `it('keeps the diagnostic record content-free: no wire code, no message')` asserts the rendered line
  contains neither the wire code nor the message. This slice adds no log call and no log field, so that
  guard covers the new codes on the same path. Belt-and-suspenders in different fabric: a deterministic
  test behind a prose rule.

- **[Network & I/O] No finding — no new wire surface.** No envelope arm, no frame type, no socket read,
  no allocation from a claimed length. Both codes arrive on the ordinary `error` path
  `parseInboundMessage` already routes, and `MAX_PLAINTEXT_BYTES` still bounds the frame before this
  function runs. `code` needs no length bound of its own precisely because nothing is retained; adding
  one would falsely imply it is kept.

- **[Availability / denial of service] No finding, and the existing inversion is why.**
  `narrowDaemonErrorOutcome` stays total — no throw, no failure return — because `daemonConnection`
  wraps `parseInboundMessage` in a bare `catch { return }`. Making the two new cases throw on anything
  would hand a hostile daemon a one-frame kill switch for the four behaviours the `daemon-error` case
  drives. The two new cases are literal comparisons with no parsing, so they add no new throw site.

- **[Tokens, secrets, credentials] Not applicable by construction.** The slice touches no credential, no
  key, no token and no storage path; it adds two string literals to a union and two cases to a `switch`.

- **[Cryptographic primitives] Not applicable.** No randomness, no comparison against a secret, no
  handshake, no key material. The literal comparison here is against public code strings, so
  `timingSafeEqual` is not the right tool and `switch` is.

- **[Concurrency] Not applicable.** A pure, synchronous, total function over one payload. No task, no
  timer, no listener, no shared state, so there is nothing to cancel and no check-then-act gap.

- **[Threat model — hostile daemon] OUT OF SCOPE, deferred to #995, and named because it is the
  security-relevant half of this slice.** `attachment.stream_aborted` carries an obligation the other
  seven have no analogue for: the client MUST discard everything accumulated for that transfer and MUST
  NOT present the partial bytes as the file. With no completion frame on the retrieval leg, that reject
  is the stream's **only** negative signal, so a consumer that ignores it renders a truncated file as a
  whole one — a hostile or merely failing daemon can then cause a user to act on a partial document.
  This slice **documents** the obligation on the member; it cannot enforce it, because there is no
  reassembler here to discard from. #995 is the consumer that must honour it, and its own review is
  where that enforcement is checked.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
