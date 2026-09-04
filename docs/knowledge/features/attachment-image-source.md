# Attachment image source (bytes → displayable URL)

The renderer-side path from a `MessageAttachment` record ([Thread timeline](thread-timeline.md#types))
to a `blob:` URL an `<img>` can point at. Nothing is drawn here and no `<img>` is written — the
thumbnail is [#1045](https://github.com/pyrycode/pyrycode-desktop/issues/1045), and so is deciding
*what* is worth drawing; this module has no opinion about imageness.

Introduced in [#1044](https://github.com/pyrycode/pyrycode-desktop/issues/1044), split from
[#868](https://github.com/pyrycode/pyrycode-desktop/issues/868). The first renderer caller of both
[attachment retrieval](attachment-retrieval.md) (#996) and [attachment bytes](attachment-bytes.md)
(#866) — until this landed, `requestAttachmentBytes` had no caller at all, the same staged-prerequisite
shape `attachment-bytes.md` already documented.

## Why the fetch has to come first

`src/main/attachmentBytes.ts` reads one directory — the app-private attachment store — whose sole
writer is the retrieval leg. The upload leg keeps no local copy of what it sends, so every attachment a
bubble can draw is one this window uploaded: its bytes are on the host, not here. A lone
`requestAttachmentBytes` answers `unavailable` on every machine, forever, until something fetches the
file back first. This mirrors [attachment retrieval § the renderer
click](attachment-retrieval.md#the-renderer-click-816) (#816), the download control's identical trap,
answered the same way: fetch, then act on that fetch's own terminal.

**Fetch-first, not bytes-first-with-fallback.** The rejected alternative asks bytes first and, on
`unavailable`, fetches and asks again — a third leg and a retry loop, to save one round trip on the warm
path the cache below already covers for free. `createAttachmentRetrieval` has no local-presence
short-circuit, so a cold fetch costs a round trip regardless of which leg asks first; only a *warm*
attachment (one whose last holder already released) pays it a second time.

## No shared fetch-then-act machinery was lifted

[`downloadAttachment.ts`](attachment-retrieval.md#the-renderer-click-816)'s header permits its second
consumer to lift the fetch-then-act shape into something shared. Declined here: `downloadAttachment`
sequences one leg and hands its caller nothing — no terminal, no handle, no resource — where this module
sequences two legs, answers a terminal, and owns a refcounted resource that outlives the sequence. What
is genuinely common is ~12 lines of subscribe-before-ask / settle-once / correlate-on-id, and lifting
that would make `downloadAttachment.ts` a second production file this slice edits, against this
project's "don't refactor adjacent code while you are there." The duplication is instead confined
*inside* this module, where one private `awaitTerminal` helper serves both legs. [#869](attachment-open.md)
(the thumbnail's own open-in-viewer click) turned out **not** to be a third candidate at all, once it
shipped: the drawn picture is itself the proof that this module's own fetch already ran, so that click
is one fire-and-forget ask with no sequencing of its own — the fetch-then-act shape stays a
two-instance count.

## The module — `src/renderer/src/screens/conversation/attachmentImageSource.ts`

```ts
export type AttachmentImageSourceFailure = AttachmentRetrievalFailure | AttachmentBytesFailure

export type AttachmentImageSourceOutcome =
  | { type: 'ready'; url: string }
  | { type: 'failed'; reason: AttachmentImageSourceFailure }

export interface AttachmentImageSources {
  request(attachmentId: string, onOutcome: (outcome: AttachmentImageSourceOutcome) => void): () => void
}

export function createAttachmentImageSources(deps: AttachmentImageSourceDeps): AttachmentImageSources
export const attachmentImageSources: AttachmentImageSources  // the production singleton, built once
```

**The failure type is a union alias, not a new vocabulary.** Both source unions are already closed sets
of literals written in this repo, so "no path, no errno, no host message, no filename and no part of the
identifier is representable" is true *by the type* rather than by care — `downloadAttachment`'s own
argument for the one value it lets through to a log. The rejected alternative, a collapsed client-owned
union behind an exhaustive mapping switch, bought a consumer nothing the literals do not already say
(`refused` never retry, `unavailable` fetch and ask again, `busy` wait) at the cost of a mirror to keep
in step every time an upstream member lands. `busy` is a member of both source unions and collapses
correctly in the alias: the answer is to wait either way.

Seven seams, all injected so the whole decision surface runs under `environment: 'node'` with plain
fakes — the `AttachmentDownloadDeps` idiom:

| Seam | Purpose |
|---|---|
| `getOpenConversationId` | The retrieval ask needs a conversation; `downloadAttachment`'s two-line getter, duplicated a fourth time rather than relocated. |
| `requestAttachment` / `onAttachmentRetrievalEvent` | Leg one — [attachment retrieval](attachment-retrieval.md). |
| `requestAttachmentBytes` / `onAttachmentBytesEvent` | Leg two — [attachment bytes](attachment-bytes.md). |
| `createObjectUrl` | `URL.createObjectURL`. Injected although it works unfaked under node (a `Blob` over a `Uint8Array` mints `blob:nodedata:<uuid>`), because the lifetime claim is only assertable against recorded URLs. |
| `revokeObjectUrl` | `URL.revokeObjectURL`. |

**Constructed once, for the app lifetime, not per ask** — `createAttachmentBytes`'s recorded trap, one
process over. The live-URL map is the only state and it is only meaningful *across* asks; a per-ask
closure would reset it every time and silently disable the sharing that makes a second ask join rather
than mint again.

## The sequence one `request` runs

1. **Cache hit** — an entry for this id already has a live URL: join it (`holders += 1`), deliver
   `ready` with that URL, touch no seam at all. This is what makes a scroll-away-and-back remount free.
2. **Local refusals**, both answered `refused` (the bytes leg's own literal, reused rather than widened —
   it already means "never retry, no fetch makes this resolvable"): no open conversation, or an
   identifier — either `conversationId` or `attachmentId` — outside `addressable` (non-empty, within
   `MAX_RETRIEVAL_IDENTIFIER_LENGTH`, imported rather than restated). **Answering rather than returning
   silently is the departure from `downloadAttachment`**, which had no caller to answer; a consumer left
   with no terminal here is a thumbnail spinning forever.
3. **Leg one** — subscribe to retrieval events, then ask. `failed` → deliver `{ failed, reason }`.
   `completed` → step 4.
4. **Leg two** — subscribe to bytes events, then ask. `failed` → deliver `{ failed, reason }`.
   `delivered` → step 5.
5. **Mint or join** — if the cache gained an entry while this ask was in flight, join it and drop these
   bytes; otherwise `createObjectUrl(toBlob(bytes))`, cache it at `holders: 1`, deliver `ready`.

Subscribe-before-ask on both legs, for `downloadAttachment`'s recorded reason: `busy` and
`not-connected` are decided synchronously inside main's receiver, so the reverse order is a race by
construction. Each `awaitTerminal` call holds `settled` beside a `let` handle so a seam that fires during
subscription still tears down exactly once. Correlation is on `attachmentId` — this window's own value
echoed back, never a wire-supplied one — so a terminal naming another attachment is ignored and the ask
keeps waiting.

### Two orderings inside step 5 are load-bearing, and neither is visible from the code's shape once written

- **The ask records the entry it holds *before* it invokes `onOutcome`.** A consumer is free to release
  synchronously from inside its own callback — a React effect that unmounts in the same commit does
  exactly that — and a release running before this ask has recorded what it holds decrements nothing.
  The URL is then left with a holder count of one and no holder: alive for the life of the window.
- **The whole read-then-mint-then-set block contains no `await`.** It is check-then-act on shared state
  and is sound only because run-to-completion keeps two handlers from interleaving inside it —
  `createAttachmentBytes`'s own argument for its counter. A suspension point there would let two
  concurrent asks both observe an empty cache and both mint, leaking the loser's URL.

## The release handle and refcounting

`request` returns a release function *before* any terminal, on every branch, so the caller always holds
one and it is idempotent:

- **Before a terminal** (the caller abandoned the ask — a bubble unmounted mid-fetch) — tear down
  whichever listener is live; no outcome is delivered and no URL is ever minted for it. The in-flight
  main-side ask is left to complete and its event dropped: neither leg offers a cancel.
- **After `ready`** — `holders -= 1`; at zero, `revokeObjectUrl(url)` and delete the entry. Released
  when its last holder is done, never while a holder still has it.
- **After `failed`** — nothing to release.
- **Called twice** — a no-op. Not tidiness: without the idempotence flag a double release decrements
  past zero, and a later join then revokes a URL another holder is still pointing at.

No lifecycle hook is owed anywhere: an entry exists only while a holder does, so there is nothing to
clear on conversation exit or pairing end. No renderer-side ceiling either — every entry has a live
holder and a holder is a mounted component, so the bound is the viewport; a ceiling belongs with
whichever ticket decides how many thumbnails can exist at once (#1045).

## Two callers, and the two legs disagree on what that means

- **Leg one is coalesced main-side** into one retrieval that pushes *one* event on the asking window's
  `webContents`, and every renderer listener on that channel runs — so two callers asking for the same
  attachment both settle from that single pushed event. A spec asserting two retrieval events for two
  asks is asserting the wrong thing.
- **Leg two is not coalesced**: two asks produce two `delivered` events. Both listeners are still
  subscribed when the first arrives, so both settle on it; the first handler mints and the second takes
  the join branch at step 5. One URL, `holders: 2`. The second event finds no listeners and is dropped.

The join branch is the whole of "asking twice does not leave a second URL alive" — the one line that
would silently leak a URL if removed.

## The media type: none, with a named seam

The `Blob` is built with no `type`, so the minted URL carries no `Content-Type`. Nothing on this side
knows the type: the bytes channel carries none by construction, the retrieval leg discarded name and
type on purpose (`attachmentReassembler` reads neither `filename` nor `mime_type`; the stored file is
extension-less), and `matchImageSignature` lives in `src/main/`, where the renderer must not reach —
sniffing here would mean a second copy of a signature table, the divergent-checks shape this family
argues against. Guessing one from `filename` would be a second imageness decision over an untrusted
name, and imageness is #1045's call. An `<img>` decodes a blob by its bytes regardless of a declared
type.

The seam is one private `toBlob(bytes)`, the single place a type would be threaded if #1045 finds it
needs one. Deliberately not an optional `mediaType` parameter: an unexercised parameter is speculative
machinery, where a one-line function is a real seam with no dead surface.

**`toBlob` copies the delivered array** — `new Blob([new Uint8Array(bytes)])`, not
`new Blob([bytes])`. `AttachmentBytesEvent.bytes` is declared `Uint8Array`, which TypeScript 5.7 reads
as `Uint8Array<ArrayBufferLike>`, while `BlobPart` demands `ArrayBufferView<ArrayBuffer>` — refusing a
`SharedArrayBuffer`-backed view. Such a view cannot actually arrive (a SAB is not structured-cloneable
across the two IPC hops this value crosses) but nothing in the type says so, and every alternative costs
more than one memcpy that runs once per attachment per window lifetime: an unchecked `as` is forbidden,
a runtime `instanceof` branch would guard a structurally impossible input without narrowing the view
itself, and widening `AttachmentBytesEvent.bytes` would edit a shared IPC contract main and preload also
read, in a file #1045 may also touch, for a renderer-local convenience. The copy is `exactBytes`'s own
line (see [attachment bytes § the exact-buffer copy](attachment-bytes.md#the-exact-buffer-copy-is-load-bearing-not-tidiness)),
one process over — the `Blob` would copy these bytes regardless.

## #1045 widened the CSP to make the URL load

`src/renderer/index.html`'s CSP was `default-src 'self'` with no `img-src`, so a `blob:` source did not
load at all while this module shipped alone. That absence was deliberate and repeatedly reaffirmed (ADR
`0010` and the specs for \#608, #609, #657, #796, #797, #906, #907, #912) — a security policy is only
provable where something actually loads, and no tier in this repo could load anything until a consumer
existed. This module minting a URL nothing could point at yet was the same staged prerequisite
`requestAttachmentBytes` was until this landed — not a defect, and not papered over here with a CSP edit
that would have put two slices in one file for a merge conflict bought for nothing.

[#1045](conversation-shell-message-bubble-attachments.md#the-attachment-image-thumbnail-1045) is that consumer, shipped:
it draws the `<img>`, decides imageness from the untrusted filename, and widened `img-src` — **and only
`img-src`**, exactly as this module's header called for. A `blob:` URL inherits the creating document's
origin, so a blob of HTML *navigated to* would run script holding the preload bridge. Three existing guards
close that independent of the CSP and stayed untouched by both tickets: `will-navigate` confines in-place
navigation to the app's own document; `setWindowOpenHandler` denies every scheme and externalises only
`http:`/`https:`; and `object-src 'none'` blocks a blob frame or object. A `frame-src`, `child-src` or
relaxed `default-src` would reopen the vector `img-src` alone does not, and #1045 touched none of them.

## State and concurrency model

One `Map<string, { url: string; holders: number }>` keyed by `attachmentId`, closed inside
`createAttachmentImageSources`. No Zustand store: nothing renders from this module and a store would put
a revocable browser resource under a reducer.

No renderer-side queue. Both legs cap at 4 concurrent
(`ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`/`ATTACHMENT_MAX_CONCURRENT_READS`), so a thread with five images
in view meets `busy` on both, and `busy` reaches the caller as a terminal it can act on. A queue here
would be machinery for a failure mode nobody has observed — if #1045 finds thumbnails routinely `busy`,
raising a cap is its own ticket. **No main-side cap is touched by this module.**

Every subscription is torn down exactly once, on the terminal or on release, whichever comes first.
There is no timer, no `AbortController` and no long-lived task: both legs are fire-and-forget with a
pushed terminal, and the release handle is the cancellation path.

## Security

Architect self-review verdict **PASS**, no MUST FIX. Full review in
`docs/specs/architecture/1044-attachment-image-source.md`. Points not covered above:

- **Three untrusted inputs, for different reasons.** `attachmentId` originates on this machine (hygiene);
  `conversationId` comes from `activeConversationStore`, which holds the daemon's
  `ConversationCreatedPayload` verbatim off the wire (a hostile or buggy daemon chooses that string) —
  both are checked by `addressable` before either leg is asked, a listener-lifetime precondition rather
  than a second security gate (canonicity stays the single gate at `resolveAttachmentPath`). The
  delivered **bytes** are the third: a hostile host can return arbitrary bytes under an attachment id
  (the reassembler verifies against the host's *own* declared digest, main-side, before this module ever
  sees them). They are never parsed, sniffed, decoded or inspected here — they go into a `Blob` and
  nothing else.
- **The minted URL is never logged**, as a rule rather than hygiene: a `blob:` URL is a capability handle
  to the user's file content within this origin, so it belongs in exactly one place — an `<img>` `src` —
  and never in a log line, another attribute, a cache key or a lookup path. Logs carry a static event
  name plus, where there is one, a closed-set literal from `AttachmentRetrievalFailure`/
  `AttachmentBytesFailure` — provably no daemon text, no path, no errno, no filename.
- **No token, key or credential** is touched, and no renderer-side web storage is added — the cache is an
  in-memory `Map` that dies with the window.

## Testing

`attachmentImageSource.test.ts`, vitest, `environment: 'node'`, no DOM — `downloadAttachment.test.ts`'s
`recorder` idiom: one ordered `calls` log so order is assertable and not just occurrence, a listener
`Set` per channel whose `push` reaches every live listener (the way `webContents.send` does), a live-
listener count per channel, and counting fakes for mint/revoke recording the exact URLs.

- **Cold path** — subscribe/ask/subscribe/ask in that exact order, one `ready` terminal carrying the
  minted URL, `requestAttachment` receiving exactly `{ conversationId, attachmentId }` and
  `requestAttachmentBytes` exactly `{ attachmentId }` (exact-object assertions, so a stray extra field
  reddens).
- **Failures** — a retrieval `failed` reaches the caller with its literal and asks no bytes; a bytes
  `failed` reaches it with its own literal; both local refusals answer `refused` without subscribing to
  anything; a serialised-outcome assertion that no path, name or identifier appears in any terminal.
- **Refcounting** — two asks, one mint, one revoke and only at the second release; a release after the
  first of two holders revokes nothing; a cache-hit ask touches no seam at all; a release before the
  terminal mints nothing and revokes nothing; a double release is a no-op.
- **Two callers (leg disagreement)** — one pushed retrieval event settles both callers to `ready`; the
  bytes leg's two-events case joins to a single URL.
- **Correlation** — a terminal naming another attachment is ignored and the ask keeps waiting; two
  different attachments run independently and settle out of order.
- **Boundary** — an empty and an over-length identifier on each of the two ids; the value at the bound
  passes.
- **Media type** — `blob.type === ''`, so a later guess has to redden this before shipping.

The `contextBridge` hop stays unpinned by this module's tests, as [attachment bytes § the one property no
tier in this repo can pin](attachment-bytes.md#the-one-property-no-tier-in-this-repo-can-pin) records:
this is the first renderer *caller* of that channel, but its vitest tier is a node-environment static
render with no DOM and no bridge, so it cannot exercise the hop either. #1045's `npm run e2e` (a real
browser context) is the first tier that can. This module deliberately does not re-wrap or re-validate the
delivered typed array beyond the `toBlob` copy above; if that hop ever proves lossy, the repair is local
to the preload listener.

## Edge cases and limitations

- **No media type on the minted URL, by design.** See § above; the seam for one is `toBlob`.
- **No renderer-side queue and no cap raised here.** A busy thread of images meets `busy` on both legs;
  see § State and concurrency model.
- **The URL loads, since #1045 widened `img-src` to `'self' blob:`.** See § above.
- **The `contextBridge` hop is unobservable from this module's own tests.** #1045's browser-context e2e
  tier is the first end-to-end proof.
- **No renderer-side cache ceiling.** Every entry has a live holder and a holder is a mounted component,
  so the bound is the viewport; revisit only if #1045 measures otherwise.

## Sizing

Landed at 1401 lines total (410 production, 611 spec, 380 plan) against the plan's ~930-line estimate —
about 45% over on both the production and spec files, all of it in the documented-decision prose this
repo's modules carry. Over the 800-line ceiling by roughly 600 lines rather than the plan's stated ~130;
the ceiling call stands unchanged — #1044 is a grandchild of #691 via #868, so the split-depth gate
forbids a further split, and the floor rule reaches the same answer independently: each candidate slice
here (the two-leg sequencing, the mint-and-refcount) has exactly one consumer in this family, so cutting
them apart would produce a child unverifiable on its own.

## Related

- [Attachment retrieval](attachment-retrieval.md) — leg one, and the coalescing behaviour this module's
  AC4 handling depends on.
- [Attachment bytes](attachment-bytes.md) — leg two, its three failure literals, the exact-buffer copy
  this module's own `toBlob` copy parallels, and the `contextBridge` hop neither module's tests can pin.
- [Conversation shell — message bubble § The attachment file
  row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816) — `downloadAttachment.ts`,
  the fetch-then-act shape this module is the second instance of and deliberately did not lift machinery
  out of.
- `docs/specs/architecture/1044-attachment-image-source.md` — the full architecture spec, including the
  security review and the two open questions (media type, cache ceiling) this doc resolves as shipped.
- [#1045](https://github.com/pyrycode/pyrycode-desktop/issues/1045) — the thumbnail. Shipped: draws the
  `<img>` ([Conversation shell — message bubble § The attachment image
  thumbnail](conversation-shell-message-bubble-attachments.md#the-attachment-image-thumbnail-1045)), decides imageness
  from `MessageAttachment.filename` with a new client-owned exact-extension helper, and widened the CSP's
  `img-src` to `'self' blob:` and nothing else.
- [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) — the parent ticket this slice split
  from.
- [#869](attachment-open.md) — the thumbnail's own open-in-viewer click. Shipped as a single
  fire-and-forget ask rather than a third fetch-then-act instance — see § No shared fetch-then-act
  machinery was lifted, above.
