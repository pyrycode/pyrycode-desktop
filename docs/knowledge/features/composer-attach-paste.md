# Composer attach — the paste entry (#1033)

Split from [Composer attach](composer-attach.md) on 2026-09-04 to stay under the size cap. Part of the
same feature: the button (#863), the outcome line, `useAttachmentUpload` and the pending-attachments set
(#1039) are documented on the parent page; this page covers only the clipboard-paste entry.

## The paste entry (#1033) — the third way in, and the opposite mount-point call from the drop

[#1032](attachment-upload.md#the-paste-ask-and-the-refused-split-1032) shipped the entire background
half headless: the content-free ask (`window.pyry.pasteAttachmentImage()`), the main-side clipboard
read, the `no-image` refusal and its sentence. #1033 is the keystroke half only — the decision about
whether a given paste is an attach or ordinary text, and the handler that acts on it. No new component,
no new store: one pure predicate beside `dragCarriesFiles` ([Composer attach —
drop](composer-attach-drop.md)), a third member on `useAttachmentUpload`, and one JSX prop.

**It mounts on `.composer__input`, not on `.composer` — the opposite call from the drop entry, and
deliberately so.** #890 spreads its handlers onto the outer `.composer` div so a drop on the footer
row counts as much as one on the message box. A `paste` fires on the *focused* element and bubbles, so
either mount point is reachable — this is a choice about scope, not reachability — but the handler's
whole job is to suppress a default paste, and the textarea is the only element in the composer that has
one. Mounting on `.composer` would also intercept a paste made while a footer button holds focus — a
keystroke with no default to prevent, turned into an upload — so narrower is correct for a handler that
starts a network transfer. A bare React `onPaste` prop renders no attribute under `renderToStaticMarkup`,
so `composerSlot.test.tsx`'s whole-run match on `class="composer__input"` stays untouched by construction.

**`pasteCarriesImageOnly(types: readonly string[] | undefined): boolean`** — `dragCarriesFiles`'s sibling
in `ComposerAttach.tsx`: advertised types in, boolean out, `undefined` tolerated and answering `false`
(`event.clipboardData` is nullable on the DOM type). Two conjuncts, both required:

- **Advertises an image** — `'Files'` present, or any entry `startsWith('image/')`. The prefix test
  (not `includes`) keeps a flavour that merely *mentions* an image type, such as `'text/image/png'`, from
  smuggling itself in.
- **Advertises no plain text** — `'text/plain'` anywhere in the list forces `false`, whatever else rides
  alongside. A copied web-page selection routinely carries both an image and text; this conjunct is what
  keeps that ordinary paste completely untouched, and it is why the static tests table the case rather
  than asserting it once — a single-conjunct predicate gets exactly this combination wrong.

**The disjunction was resolved by measurement, not left as an open question.** It was not obvious
up front whether Chromium normalises an OS-clipboard bitmap to the file-item spelling (`'Files'`) or an
explicit `image/png` entry before handing it to a page. `e2e/composer-paste-image.spec.ts` seeds a real
bitmap onto the real OS clipboard, drives a **trusted** paste with `webContents.paste()`, and captures
the advertised list with a page-side probe: **exactly `['Files']`, no `image/png` entry at all**. So the
`'Files'` arm is what makes the feature work, not defensive breadth — an `image/*`-only predicate would
have shipped a screenshot paste that silently did nothing. The `image/*` arm stays for the page-image
spelling a copied web-page image can produce. The one thing `'Files'` additionally admits is a *file*
copied in Finder or Explorer, out of scope per the ticket: main reads the clipboard, finds no bitmap, and
answers `no-image` — an honest refusal instead of silence, no path or byte involved either way.

**`text/plain` is a security-shaped bound, but this predicate is not where it is enforced.** A
password-manager secret is `text/plain`, so it can never take the attach branch through this handler —
but `contextBridge` exposes `pasteAttachmentImage()` to the whole renderer, so a compromised window calls
it directly and never runs this predicate at all. The bound that actually holds is main's:
`clipboard.readImage()` returns a bitmap or nothing, so a text-flavoured secret yields an empty image and
a `no-image` refusal whatever the ask claims. This predicate is the ergonomic half of the rule; #1032's
clipboard read is its enforcement.

**`pasteImage(): void`** — the third member of `useAttachmentUpload`, alongside `requestAttach` and
`dropFile`, performing the identical clear-then-fire act (`setOutcome(null)` then
`window.pyry.pasteAttachmentImage()`). Reused rather than rebuilt at the gesture site, `dropFile`'s own
reason for being where it is. **The clear here is for consistency of ownership, not for a stranding it
prevents** — worth stating because the two members above it clear for a reason that does not arise on
this path: a cancelled picker and an unresolvable dropped path each report nothing at all, which is what
strands a previous line, while #1032's clipboard path draws exactly one terminal for every ask,
`no-image` included. It clears anyway, so all three entries behave identically and the line that appears
next is unambiguously about the paste just made. Like `dropFile`, it does **not** touch the
pending-attachments set — see [Composer attach § Pending
attachments](composer-attach.md#pending-attachments-1039).

**One argument since #1205, the destination; still no server.** `AttachmentPasteRequest` gained an
optional `serverId` in #1129 that this call site has nothing to source until #1086, and a *required*
`conversationId` in #1205 that it sources from the screen's open conversation — the daemon refuses a
chunk naming none (pyrycode#2143). So `pasteAttachmentImage({ conversationId })` carries exactly one
value, and it is a lookup key the daemon validates, not clipboard content. See [Attachment upload § The
paste ask](attachment-upload.md#the-paste-ask-and-the-refused-split-1032) for the full reasoning.

**The handler, in `Composer` (`ConversationScreen.tsx`):**

```tsx
const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
  if (!pasteCarriesImageOnly(event.clipboardData?.types)) return
  event.preventDefault()
  attach.pasteImage()
}
```

The early return is the whole of "text pastes stay text": a clipboard the predicate declines is not
consumed, not prevented and not reported, so the default paste runs exactly as it does today.
`clipboardData` is read for `types` and nothing else — `getAsFile`, `getAsString` and `.files` are never
touched anywhere in this feature, which is AC3 stated as an absence at the only site that could violate
it. No new state, no async work, no `AbortSignal`: the ask is fire-and-forget and its terminal arrives on
the outcome subscription `useAttachmentUpload` already owns.

### Testing the paste entry

`ComposerAttach.test.tsx` gains `describe('pasteCarriesImageOnly')`: every measured image spelling with
no text (true, as a table), every list carrying `'text/plain'` alongside an image (false, as a table —
the security bound), every non-image list plus `[]` and `undefined` (false), and the prefix-not-substring
case (`'text/image/png'`, `'x-image/png'`).

`e2e/composer-paste-image.spec.ts` (fake tier, no `real-*` name, no `needs-real-claude`) is the spec that
pays off what #1032 deliberately left unproven — that the whole paste chain joins — and it is also the
in-tier proof for the measurement above. One continuous drive, two halves:

1. **The branch matrix, synthetically.** `composer-file-drop.spec.ts`'s shape applied to `paste`: a
   `DataTransfer` built in page context, a `ClipboardEvent` dispatched on `.composer__input`, and
   `dispatchEvent(...) === false` read as the only observable proof `preventDefault` ran — an untrusted
   event performs no default action, so watching the textarea proves nothing. Image-only prevents;
   image+text does not; text-only does not.
2. **The whole chain, for real.** A real bitmap seeded onto the real OS clipboard
   (`app.evaluate`'s `clipboard.writeImage` seam, `message-copy.spec.ts`'s already-accepted
   clobber-without-restore price for touching it), a trusted paste via `webContents.paste()` against the
   focused message box, and a terminal rendered in `.composer__attach-outcome` — keystroke → predicate →
   ask → main's clipboard read → PNG encode → guard → transfer → wire → terminal → composer, joined
   end to end for the first time. A real **text** clipboard pasted the same way lands its text in the
   message box and produces no outcome at all.

**The ask is not intercepted in this tier — a real trap the first draft fell into.** It crosses to the
real main handler, which reads the real OS clipboard, so seeding must happen *before* the first paste
fires or the synthetic image-only arm earns a terminal from whatever the machine's clipboard happened to
hold. The spec seeds first, so the synthetic arm now earns a **deterministic** terminal and doubles as
proof the ask reaches the flow, not merely that `preventDefault` ran.

**Because `attachmentTransfer.ts` has no per-transfer deadline, the fake daemon must answer every
chunk or the assertion hangs to the suite timeout rather than failing.** `buildReplyFrames` rejects each
`attachment_chunk` with a real `error` frame correlated via `sentEnvelope`, which `daemonConnection`'s
`daemon-error` case turns into `failed`/`<reason>`.

**Both arms land in the same single outcome slot, so a second "a sentence is present" assertion would
pass on the first arm's line** — the `?? ''` vacuous-pass shape this repo has hit before, in a different
costume. The fake daemon rejects the first upload and every later one with **different** daemon codes
(`attachment.storage_failed`, then `attachment.too_many_uploads`), so the trusted paste's terminal is a
fresh observation rather than a stale one, and the expected sentence is derived by calling
`attachmentUploadOutcomeCopy` rather than typed out. **The fall-through arms additionally assert the
outcome line is still standing** — a stronger detector than "prevented", since clearing the line on a
gesture is something only the attach path (`pasteImage`) does; a handler that prevented nothing but asked
anyway would pass the prevention check and fail this one.

### Security (paste entry)

PASS, self-reviewed. This slice widens no boundary: the one crossing is the already-shipped
`ATTACHMENT_UPLOAD_CHANNEL` send `pasteAttachmentImage()` performs with no renderer-supplied value, and
`pasteCarriesImageOnly` is not itself a security control — see above. The handler adds no new capability:
any renderer script that could synthesise the `ClipboardEvent` this handler consumes could call
`window.pyry.pasteAttachmentImage()` directly, which is strictly easier. **SHOULD FIX, addressed in the
diff rather than left open:** the handler and the predicate must log nothing — a `console.log` of `types`
would put clipboard *shape* in DevTools and any diagnostic bundle, undoing #1032's content-free logging
posture; the measurement that the type list is `['Files']` lives in the e2e spec's page probe only, never
in `ComposerAttach.tsx` or `ConversationScreen.tsx`. **Out of scope, per the ticket's explicit
instruction:** #1032's named residual — a compromised renderer can cause an unprompted upload of whatever
image the operator is holding — stays open. A confirmation added at this handler would be bypassed by the
direct `contextBridge` call above, costing an interruption on every legitimate paste for no gain against
the attacker it would name; this ticket adds no gesture correlation and no permission prompt. See
`docs/specs/architecture/1033-paste-image-to-attach.md` § Security review for the full findings and the
Open-Questions-resolved-by-measurement revision.

## Related

- [Composer attach](composer-attach.md) — the parent page: the button, the outcome view, the hook, the
  copy module and the pending-attachments set (#1039).
- [Composer attach — the drop entry](composer-attach-drop.md) (#890) — the other gesture entry, the
  opposite mount-point call from this one.
