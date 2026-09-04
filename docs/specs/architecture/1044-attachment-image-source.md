# #1044 — turn a message attachment into a displayable image source

## Files read

Codegraph is not initialised in this repo (every `codegraph_*` call answers "CodeGraph not
initialized"), so this list came from Grep/Read rather than `codegraph_context`. Noted as the gap the
brief asks for.

- `src/renderer/src/screens/conversation/downloadAttachment.ts` → `downloadAttachment`,
  `AttachmentDownloadDeps`, `addressable`, `attachmentDownloadDeps` — the established fetch-then-act
  shape this slice is the second instance of, and whose header explicitly permits (does not require)
  lifting it.
- `src/renderer/src/screens/conversation/downloadAttachment.test.ts` → its `recorder` fake — the
  ordered-`calls`-log idiom for asserting order rather than occurrence, reused here.
- `src/shared/ipc/attachmentRetrieval.ts` → `AttachmentRetrievalRequest`,
  `AttachmentRetrievalFailure`, `AttachmentRetrievalEvent`, `MAX_RETRIEVAL_IDENTIFIER_LENGTH` — leg
  one's contract and its twelve closed literals.
- `src/shared/ipc/attachmentBytes.ts` → `AttachmentBytesRequest`, `AttachmentBytesFailure`,
  `AttachmentBytesEvent`, `MAX_BYTES_IDENTIFIER_LENGTH` — leg two's contract, its three literals split
  on what a consumer can do next, and the parked question this slice answers ("whether a consumer
  needs a type at all").
- `src/main/attachmentRetrieval.ts` → `createAttachmentRetrieval`'s `inFlight` map — coalescing is a
  *total* no-op (`if (inFlight.has(attachmentId)) return`), and there is **no local-presence
  short-circuit**: a retrieval always goes to the host.
- `src/main/attachmentBytes.ts` → `createAttachmentBytes` — "THERE IS NO COALESCING", the terminal is a
  per-ask promise, and `exactBytes` is why the delivered view owns its buffer.
- `src/preload/index.ts` → `requestAttachment` / `onAttachmentRetrievalEvent`,
  `requestAttachmentBytes` / `onAttachmentBytesEvent` — the four seams, and the header naming the
  blob-URL form as blocked by the CSP until #1045.
- `src/renderer/src/store/threadTimeline.ts` → `MessageAttachment` — `attachmentId` is the host's
  storage handle, `filename` untrusted display text.
- `docs/knowledge/features/attachment-bytes.md` § "The one property no tier in this repo can pin" —
  neither structured-clone hop is observable from vitest; this consumer is the first thing that could
  exercise them, and a re-wrapped typed array is repaired in the preload listener, not here.
- `src/renderer/index.html` → the CSP meta tag with no `img-src`. Read to confirm, not to edit.

## Context

The window can name an attachment but cannot show one. This slice builds the renderer-side path from a
`MessageAttachment` record to a URL an `<img>` can point at, and stops there: **nothing is drawn, no
`<img>` is written, and `src/renderer/index.html` is not touched.** The thumbnail and the `img-src`
widening are #1045's, in as many words on that ticket.

Not UI-visible, so there is no `## Design source` section and no Figma node: this slice's entire output
is a module with no JSX and no DOM sink. #1045 owns the drawing and carries the Figma anchor.

The bytes are not on this machine. `src/main/attachmentBytes.ts` reads one directory whose sole writer
is the retrieval leg, and the upload leg keeps no local copy — so a single `requestAttachmentBytes`
answers `unavailable` on every machine, forever. The fetch has to come first, exactly as it does for
#816's download control.

No ADR is owed. This slice adds no cross-cutting decision: it consumes two shipped contracts and mints
one browser primitive. The media-type ruling below belongs in the module header and in
`attachment-bytes.md`, which the documentation phase owns.

### The shared fetch-then-act lift: not taken

`downloadAttachment.ts`'s header permits the second consumer of the fetch-then-act shape to lift it.
Declined, and the reason is that the two are not the same shape:

- `downloadAttachment` sequences one leg and hands its caller **nothing** — no terminal, no handle, no
  resource. This module sequences **two** legs, answers a terminal to its caller, and owns a
  refcounted resource whose lifetime outlives the sequence.
- What is genuinely common is ~12 lines of subscribe-before-ask / settle-once / correlate-on-id. Lifting
  that would make `downloadAttachment.ts` a second production file this slice edits (its 313-line spec
  with it), against CLAUDE.md's "don't refactor adjacent code while you are there", to remove a dozen
  lines that are then re-parameterised at both call sites.

The duplication is instead confined **inside this module**, where the same dance is needed twice in a
row: one private `awaitTerminal` helper serves both legs. The third consumer (#869) can lift with two
instances to generalise from rather than one and a half.

## Design

One new file, `src/renderer/src/screens/conversation/attachmentImageSource.ts`, beside
`downloadAttachment.ts` and for its recorded reason: the renderer tier is `renderToStaticMarkup` under
`environment: 'node'`, so an effect reachable only from a `useEffect` would be unprovable.

### The contract

```ts
export type AttachmentImageSourceFailure = AttachmentRetrievalFailure | AttachmentBytesFailure

export type AttachmentImageSourceOutcome =
  | { type: 'ready'; url: string }
  | { type: 'failed'; reason: AttachmentImageSourceFailure }

export interface AttachmentImageSourceDeps { /* seven seams — below */ }

export interface AttachmentImageSources {
  /** Ask for one attachment's displayable URL. Returns the caller's release handle, always. */
  request(attachmentId: string, onOutcome: (outcome: AttachmentImageSourceOutcome) => void): () => void
}

export function createAttachmentImageSources(deps: AttachmentImageSourceDeps): AttachmentImageSources
export const attachmentImageSources: AttachmentImageSources  // the production singleton
```

**The failure type is a union alias, not a new vocabulary.** Both source unions are already closed sets
of literals written in this repo, so AC2's "no path, no errno, no host message, no filename and no part
of the identifier is representable" is true *by the type* rather than by care — the argument
`downloadAttachment` makes for logging `event.reason`. The rejected alternative was a collapsed
client-owned union plus an exhaustive mapping switch: ~40 lines of arms and a test each, buying a
consumer nothing it can act on that the literals do not already say (`refused` never retry,
`unavailable` fetch and ask again, `busy` wait), and adding a mirror to keep in step every time an
upstream member lands. `busy` is a shared member of both unions and collapses in the alias, which is
correct: a consumer's answer is to wait either way.

**Constructed once, not per ask** — `createAttachmentBytes`'s recorded trap. The URL cache is the only
state and it is only meaningful *across* asks; a per-ask closure would reset it every time and disable
AC3 silently.

### The seams

Seven, all injected so the whole decision surface runs under `environment: 'node'` with plain fakes —
the `AttachmentDownloadDeps` idiom:

| Seam | Purpose |
|---|---|
| `getOpenConversationId(): string \| null` | The retrieval ask needs a conversation. `downloadAttachment`'s two-line getter, written the same way. |
| `requestAttachment` / `onAttachmentRetrievalEvent` | Leg one. |
| `requestAttachmentBytes` / `onAttachmentBytesEvent` | Leg two. |
| `createObjectUrl(blob: Blob): string` | `URL.createObjectURL`. Injected although it *works* under node (verified: `blob:nodedata:<uuid>`), because AC5 asks the specs to pin what reaches each seam and revocation is only assertable against a recorded URL. |
| `revokeObjectUrl(url: string): void` | `URL.revokeObjectURL`. |

### The sequence one `request` runs

1. **Cache hit** — an entry for this id already has a live URL: join it (`holders += 1`), deliver
   `ready` with that URL, return a release. No IPC at all. This is what makes a scroll-away-and-back
   remount free, and it is why fetch-first costs a round trip only on the cold path.
2. **Local refusals**, both answered as `refused` and both logged as a bare static event name: no open
   conversation, or an identifier outside `addressable` (non-empty, within
   `MAX_RETRIEVAL_IDENTIFIER_LENGTH`). `refused` is not a new literal — it is the bytes leg's own, and
   it already means exactly this: never retry, no fetch makes this ask resolvable.
   **Answering rather than returning silently is the departure from `downloadAttachment`,** which had
   no caller to answer. AC2 says every failure reaches the caller as a terminal, and a consumer left
   with no terminal is a thumbnail spinning forever.
3. **Leg one** — subscribe to retrieval events, then ask. `failed` → deliver `{ failed, reason }`.
   `completed` → step 4.
4. **Leg two** — subscribe to bytes events, then ask. `failed` → deliver `{ failed, reason }`.
   `delivered` → step 5.
5. **Mint or join** — if the cache gained an entry while this ask was in flight, join it and drop these
   bytes; otherwise `createObjectUrl(new Blob([bytes]))`, cache it at `holders: 1`, deliver `ready`.

Two orderings inside step 5 are load-bearing, both from the security pass, and neither is visible from
the code's shape once it is written:

- **The ask records the entry it holds BEFORE it invokes `onOutcome`.** A consumer is free to release
  synchronously from inside its own callback — a React effect that unmounts in the same commit does
  exactly that — and a release that runs while the ask has not yet recorded what it holds decrements
  nothing. The URL then has a holder count of one and no holder, so it is never revoked.
- **The whole read-then-mint-then-set block contains no `await`.** It is check-then-act on shared state,
  and it is sound only because run-to-completion means two handlers cannot interleave inside it —
  `createAttachmentBytes`'s argument for its own counter. A suspension point introduced there lets two
  concurrent asks both observe an empty cache and both mint, and the loser's URL is never revoked.

Subscribe-before-ask on both legs, for `downloadAttachment`'s recorded reason: `busy` and
`not-connected` are decided synchronously inside main's receiver, so the reverse order is a race by
construction. Each listener holds `settled` beside a `let` handle so a seam that fired during
subscription still tears down exactly once. Correlation is on `attachmentId` — this window's own value
echoed back, never a wire-supplied one.

**Fetch-first, not bytes-first-with-fallback.** The rejected alternative asks bytes, and on
`unavailable` fetches and asks bytes again: a third leg and a retry loop, to save a round trip in the
warm case the cache already covers for free. `createAttachmentRetrieval` has no local-presence
short-circuit, so a warm fetch does cost a round trip — but only for an attachment whose last holder
released, which is the rare path.

### The release handle — AC3

`request` returns a release function **before** any terminal, so the caller always holds one, and it is
idempotent:

- **Before a terminal** — the caller abandoned the ask (a bubble unmounted mid-fetch). Tear down
  whichever listener is live; no outcome is delivered and, critically, **no URL is ever minted for it**,
  so nothing leaks. The in-flight main-side ask is left to complete and its event dropped: neither leg
  offers a cancel and inventing one is out of scope.
- **After `ready`** — `holders -= 1`; at zero, `revokeObjectUrl(url)` and delete the entry. This is
  AC3's "released when its last holder is done with it, and not released while a holder still has it".
- **After `failed`** — nothing to release.
- **Called twice** — the second call does nothing. The idempotence flag is not tidiness: without it a
  double release decrements past zero, and a later join then revokes a URL another holder is still
  pointing at.

No lifecycle hook is owed anywhere: an entry exists only while a holder does, so there is nothing to
clear on conversation exit or pairing end.

### AC4, and why the two legs disagree

Two concurrent callers for one attachment:

- Leg one is **coalesced** main-side into one retrieval that pushes **one** event on the asking window's
  `webContents` — and every renderer listener on that channel runs, so both callers settle from it.
  *Do not write a spec asserting two retrieval events for two asks.*
- Leg two is **not** coalesced: two asks, two events. Both listeners are still subscribed when the
  first arrives, so both settle on it; the first handler mints and the second takes the join branch at
  step 5. One URL, `holders: 2`. The second event finds no listeners and is dropped.

That join branch is the whole of AC3's "asking twice does not leave a second URL alive", and it is the
one line that would silently leak a URL if removed.

### The media type: none, with a named seam

The `Blob` is built with **no `type`**, so the minted URL carries no `Content-Type`. Nothing here knows
the type: the channel carries none by construction, the retrieval leg discarded name and type on
purpose, and `matchImageSignature` lives in `src/main/` where the renderer must not reach. Guessing one
from `filename` would be a second imageness decision over an untrusted name — the divergent-checks shape
this family argues against, and #1045 owns imageness. An `<img>` decodes a blob by its bytes regardless.

The seam is one private `toBlob(bytes)`, documented as the single place a type would be threaded if
#1045 finds it needs one. Deliberately *not* an optional `mediaType` parameter: an unexercised
parameter is speculative machinery, where a one-line private function is a real seam with no dead
surface.

### The URL is inert until #1045

Written into the module header rather than left implicit: `src/renderer/index.html`'s CSP has no
`img-src`, so a `blob:` URL does not load today. That widening is #1045's and is only provable where
something actually loads. This slice minting a URL nothing can point at yet is the same staged
prerequisite as `requestAttachmentBytes` having no caller until now — not a defect, and not to be
papered over with a CSP edit that would put two slices in one file for a merge conflict bought for
nothing.

## State and concurrency model

State is one `Map<string, { url: string; holders: number }>` keyed by `attachmentId`, closed inside
`createAttachmentImageSources`. No Zustand store: nothing renders from this and a store would put a
revocable browser resource under a reducer.

No renderer-side queue. Both legs cap at 4 concurrent, so a thread with five images meets `busy` on
both, and `busy` reaches the caller as a terminal it can act on. A queue here is machinery for a
failure mode nobody has observed; if #1045 finds thumbnails routinely `busy`, raising a cap is its own
ticket. **No main-side cap is touched.**

Every subscription is torn down exactly once, on the terminal or on release, whichever comes first.
There is no timer, no `AbortController` and no long-lived task: both legs are fire-and-forget with a
pushed terminal, and the release handle is the cancellation path.

## Error handling

Every path answers exactly one `AttachmentImageSourceOutcome`, or none at all when the caller released
first. Nothing throws: the only call that could is `createObjectUrl`, and it runs on an already-settled
delivered event.

Logging follows `downloadAttachment`'s renderer precedent (`DiagnosticLog` is main-side): `console.error`
with a **static** event name plus, where there is one, the closed-set literal. No identifier, no
filename, no URL and no byte count reaches a log line — `attachmentId` is a host-side storage handle and
`filename` is untrusted display text, and neither belongs in a log, an attribute or a cache key.

## Testing strategy

`attachmentImageSource.test.ts`, vitest, `environment: 'node'`, no DOM. A `recorder` fake in
`downloadAttachment.test.ts`'s shape: one ordered `calls` log so **order** is assertable, a listener set
per channel whose `push` reaches every live listener (the way `webContents.send` does), a
`liveListeners()` count per channel, and counting fakes for mint/revoke that record the exact URLs.

Scenarios:

- **AC1** — cold path: subscribe/ask/subscribe/ask in that exact order, one `ready` terminal, the URL is
  the minted one, `requestAttachment` gets `{conversationId, attachmentId}` and `requestAttachmentBytes`
  gets `{attachmentId}` — exact-object assertions, so a stray `filename` reddens.
- **AC2** — one arm per source: a retrieval `failed` reaches the caller with its literal and asks no
  bytes; a bytes `failed` reaches it with its literal; both local refusals answer `refused` without
  subscribing. A serialised-outcome assertion that no path, name or identifier appears in a terminal.
- **AC3** — two asks, one mint, one revoke and only at the second release; a release after the first of
  two holders revokes nothing; a cache-hit ask touches no seam at all; release before the terminal mints
  nothing and revokes nothing; a double release is a no-op.
- **AC4** — two callers, one pushed retrieval event, both reach `ready`; and the bytes leg's two-events
  case joining to a single URL.
- **Correlation** — a terminal naming another attachment is ignored on both channels and the ask keeps
  waiting; two different attachments run independently and settle out of order.
- **Boundary** — an empty and an over-long identifier on each of the two ids; the value *at* the bound
  passes.

The `contextBridge` hop stays unpinned here, as `attachment-bytes.md` records — #1045's `npm run e2e`
is the first tier that can exercise it. This module deliberately does **not** re-wrap or re-validate the
delivered typed array: if that hop ever proves lossy the repair is local to the preload listener.

## Open questions

1. **Does #1045 need a media type after all?** Answered here as "no, with a named seam". If an `<img>`
   turns out to need one, `toBlob` is the one line that changes.
2. **Should the cache have a ceiling?** No entry outlives its last holder, and holders are components
   the reader can see, so the bound is the viewport. Revisit only if #1045 measures otherwise.

## Sizing

Over the 800-line ceiling by roughly 130 lines (~930 total: ~230 production, ~420 spec, ~280 plan), and
built anyway. #1044 is a grandchild of #691 via #868, so the split-depth gate forbids a further split;
`needs-human:sizing` is applied and the measurement recorded on the ticket. Independently, the floor
rule reaches the same answer: every candidate slice here — "the two-leg sequencing" and "the mint and
refcount" — has exactly one consumer inside this family, so cutting them apart would produce a child
that cannot be verified on its own. When the floor and the ceiling disagree, the floor wins.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** Two untrusted values enter, and they are untrusted for different reasons.
  `attachmentId` originates on this machine (main mints the upload id, `driveUpload` sends it, the
  timeline records it), so bounding it is hygiene. `conversationId` comes from `activeConversationStore`,
  which holds the daemon's `ConversationCreatedPayload` **verbatim off the wire** — a hostile or buggy
  daemon chooses that string. Both are checked by `addressable` before either leg is asked. This is
  #816's own security-review MUST FIX carried forward with the same argument: checking only the
  attachment id would let a remote party make every ask fail main's guard while this module had already
  subscribed for it, accumulating one `ipcRenderer` listener per mounted thumbnail, driven by remote
  input. It is a listener-lifetime precondition, **not** a second security gate — canonicity stays the
  single gate at `resolveAttachmentPath`.
- **[Trust boundaries — the bytes]** The delivered bytes are the third untrusted input and the one this
  slice is new for: a hostile host can return arbitrary bytes under an attachment id (the reassembler
  verifies against the host's *own* declared digest). They are never parsed, sniffed, decoded or
  inspected here — they go into a `Blob` and nothing else. Deciding what they are is #1045's.
- **[Electron attack surface]** No finding, and the reason is worth naming because it constrains #1045.
  A `blob:` URL inherits the creating document's origin, so a blob of HTML **navigated to** would run
  script holding the preload bridge. Three existing guards close that, and none is touched here:
  `will-navigate` confines in-place navigation to the app's own document; `setWindowOpenHandler` returns
  `deny` for every scheme and externalises only `http:`/`https:`, so a `blob:` URL is dropped rather
  than opened; and the CSP's `default-src 'self'` plus `object-src 'none'` blocks a blob frame or
  object. **#1045 must widen `img-src` only** — a `frame-src`, `child-src` or relaxed `default-src`
  would reopen this. No new IPC channel, no new preload API and no new window is added by this slice.
- **[Media type]** The `Blob` is minted with no `type`, so a navigation to it would be content-sniffed.
  Accepted rather than papered over with a constant `image/png`: the vector requires navigating to this
  specific URL, which the three guards above deny, and against an attacker who already runs script in
  the renderer a declared type buys nothing — they can mint their own blob of any type. Asserting a type
  this module cannot know would also be the second imageness decision the ticket forbids.
- **[File / storage]** No finding. No path is built, joined or forwarded, and none is reachable: the
  window holds no path, both channels address by identifier alone, and no `node:fs` call exists on this
  side. The minted URL is `blob:<origin>/<random uuid>` — it carries **no part of the identifier, the
  filename or the bytes**, which is what makes AC2's claim true of the success terminal as well as the
  failure ones.
- **[Concurrency]** Two findings, both fixed in the plan before this verdict. (a) The ask must record
  the cache entry it holds **before** invoking `onOutcome`, or a consumer releasing synchronously from
  its own callback leaves a URL with a holder count of one and no holder — never revoked. (b) The
  read-then-mint-then-set block must contain **no `await`**: it is check-then-act on shared state, sound
  only under run-to-completion, and a suspension point there lets two concurrent asks both mint with the
  loser's URL leaked. Both are stated in the Design section and each gets a spec. Listener lifetime is
  bounded on every path: torn down on the terminal or on release, whichever comes first, with a
  `settled` flag so a seam firing during subscription still tears down exactly once.
- **[Errors, logs, telemetry]** No finding. Logs carry a static event name plus, where there is one, a
  closed-set literal from `AttachmentRetrievalFailure` / `AttachmentBytesFailure` — provably no daemon
  text, no path, no errno, no filename. **The minted URL is never logged**, and that is a rule rather
  than hygiene: a `blob:` URL is a capability handle to the user's file content within this origin, so
  it belongs in exactly one place, an `<img>` `src`, and never in a log line, another attribute, a cache
  key or a lookup path.
- **[Tokens / secrets]** Not applicable by design: this module touches no token, no key and no
  credential, and reaches nothing that does. It adds no renderer-side web storage — the cache is an
  in-memory `Map` that dies with the window.
- **[Cryptographic primitives]** Not applicable: no randomness, no comparison against a secret, no
  hashing. The digest check on retrieved bytes already happened in main, in `attachmentReassembler`.
- **[Network & I/O]** Not applicable: no socket, no URL fetch, no timer. Both legs' caps, deadlines and
  transport failures are inherited unchanged, and **no main-side cap is raised** — a thread with five
  images meets `busy` on both legs and `busy` reaches the caller as a terminal it can act on.
- **[Threat model]** Hostile daemon and hostile relay are addressed above (the two wire-chosen values
  and the bytes). Renderer compromise reaching the transport is unchanged: nothing here widens the
  bridge. **OUT OF SCOPE** — an upper bound on how many URLs may be alive at once. Every entry has a
  live holder and a holder is a mounted component, so the bound is the viewport; the ceiling belongs
  with the consumer that decides how many thumbnails exist, which is #1045.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — `toBlob` copies the delivered array

**What changed.** The Design section specifies `createObjectUrl(new Blob([bytes]))` and the module was
written that way. `npm run typecheck` rejected it: `AttachmentBytesEvent.bytes` is declared `Uint8Array`,
which TypeScript 5.7 reads as `Uint8Array<ArrayBufferLike>`, and `BlobPart` demands
`ArrayBufferView<ArrayBuffer>` — it is refusing a `SharedArrayBuffer`-backed view. Shipped as
`new Blob([new Uint8Array(bytes)])`.

**Why this one.** A SAB-backed view cannot arrive (a SAB is not structured-cloneable across these two
hops), but nothing in the type says so, and each alternative costs more than one memcpy that runs once
per attachment per window lifetime: an unchecked `as` is forbidden by the brief; a runtime `instanceof`
branch would be a failure path for a structurally impossible input and does not narrow the view itself;
widening `AttachmentBytesEvent.bytes` would edit a shared IPC contract that main and preload also read —
a third production file, in a file #1045 may also touch — for a renderer-local convenience. The copy is
`exactBytes`'s own line one process over, and the `Blob` copies these bytes regardless.

**What it does not change.** It is a type narrowing, not a defence and not a re-validation: the bytes are
still never parsed, sniffed or inspected here, and the "repair belongs in the preload listener" ruling on
the `contextBridge` hop is untouched. The security review's findings are unaffected.

### 2026-09-04 — Open questions, resolved

1. **Media type** — resolved as designed: no type, with `toBlob` as the named seam. Pinned by a spec
   asserting `blob.type === ''`, so a later guess has to redden something.
2. **Cache ceiling** — resolved as designed: none. Every entry has a live holder and a holder is a
   mounted component, so the bound is the viewport; the ceiling belongs with #1045.

### 2026-09-04 — Actual size

1401 lines total written work against the plan's ~930 estimate (410 production, 611 spec, 380 plan). The
production and spec files both ran about 45% over, all of it in the documented-decision prose this
repo's modules carry. Still one production source file, 4 new exported types, 0 consumer call sites, and
in-family: the five measured attachment slices on this repo landed between 1062 and 1859 lines. The
ceiling call in `## Sizing` is unchanged — the depth gate and the floor rule both still forbid a split —
but the overage against the 800-line ceiling is 600 lines, not 130.
