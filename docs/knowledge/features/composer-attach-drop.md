# Composer attach — the drop entry (#890)

Split from [Composer attach](composer-attach.md) on 2026-09-04 to stay under the size cap. Part of the
same feature: the button (#863), the outcome line, `useAttachmentUpload` and the pending-attachments set
(#1039) are documented on the parent page; this page covers only the drag-and-drop entry.

## The drop entry (#890) — a second way in, not a second flow

Dragging a file from Finder or Explorer onto `.composer` attaches it through the same
[attachment-upload](attachment-upload.md) flow the button drives: the same guard, the same driver, the
same outcome channel, the same terminal, rendered by `ComposerAttachOutcome` ([Composer
attach](composer-attach.md)). The only new thing is *where the path comes from* — the operating system
hands a dropped file to the **window** as a DOM `File`, so the path has to be recovered on the window side
of the process boundary, in the preload, via `webUtils.getPathForFile` (see [Attachment upload § The
bridge](attachment-upload.md) for the resolver and its containment argument). Renderer code here holds the
`File` handle and nothing else — the path never reaches this component, a store, or a log.

**Four pure functions, framework-free, in the `composerSend.ts` / `dropQueuedMessage.ts` idiom** — so the
static tier can walk every branch of a drag gesture no test in this repo can perform:

- **`composerClassName(active: boolean): string`** — `'composer'` when inactive, byte-identical to the
  literal the three shipped `composerSlot.test.tsx` assertions match as a whole attribute run (two of
  them `class="composer" hidden=""`), and `` `composer ${COMPOSER_DROP_ACTIVE_CLASS}` `` when active. A
  branch, not an interpolation with an empty tail, for exactly that reason.
- **`dragCarriesFiles(types)`** — reads `DataTransfer.types` for `'Files'`, since the files themselves are
  deliberately unreadable during `dragover`. This is the whole of "interception is scoped to file drags":
  every downstream effect — the edge, the `preventDefault` that stops a navigation, the attach itself — is
  gated on it, so text, a URL, or an image dragged out of a web page is left alone and keeps doing exactly
  what it does today, including text dropped into the textarea. `text/uri-list` is deliberately **not**
  treated as a file drag — a `file:///…` URL dragged onto the page is `will-navigate`'s coverage
  (`src/main/index.ts`), not this one's, and widening here would swallow ordinary link drags into the
  message box.
- **`reduceFileDropDepth(depth, event)`** — the drag-over state as a depth counter, not a boolean, which
  is the whole of "it survives the pointer crossing a child element rather than flickering". `dragover`
  fires continuously and every child fires its own `dragenter`/`dragleave` pair, both bubbling to the
  composer's handler; a boolean flipped on `dragleave` would clear the instant the pointer crossed from
  the composer onto the textarea. `'leave'` floors at zero (a stray leave outnumbering enters, from a
  drag that began over a child); `'settled'` (a drop, or the drag ending) resets outright rather than
  decrementing, because a drop fires no matching `dragleave` at all.
- **`fileToAttach(files)`** — the one file, or `null` for zero and for more than one. Generic over the
  element so the unit tier needs no `File`. **A multi-file drop attaches nothing and says nothing** — a
  refusal would need a new reason in the shared union plus a branch in `attachmentUploadCopy`'s
  compiler-forced switch, copy for a feature (multi-file upload) that doesn't exist yet. The daemon's own
  concurrency bound (`attachment.too_many_uploads`, #861) is why a naive per-file loop would be the wrong
  first cut; a follow-up ticket owns multi-file support and its messaging together.

**`useAttachmentUpload()` grew a third member, `dropFile(file: File): void`**, mirroring `requestAttach`
exactly: it clears the held outcome and calls `window.pyry.dropAttachmentFile(file)`. It stays inside this
hook rather than being reimplemented at the drop site, because "dropping clears whatever outcome line is
showing" is the same act `requestAttach` already performs, and a second copy is where the two could drift.
It does **not** touch the pending-attachments set #1039 later added beside it — see [Composer attach §
Pending attachments](composer-attach-pending.md#pending-attachments-1039) for why the gesture clear and the
pending-set clear are kept apart.

**`useComposerFileDrop({ onFile })`** is the container: a `useState` depth counter (ADR 0006 — ephemeral,
screen-local, read by nothing else, the same shape `useAttachmentUpload` already uses for the held
outcome; it resets for free on a conversation switch because `PairedShellView` keys the chat pane on the
conversation id) plus the four drag handlers `.composer` wears, plus one `useEffect` that mounts a
**window-level navigation guard**: `preventDefault` on `window`'s `dragover` and `drop`, gated on
`dragCarriesFiles` so a text or link drag is untouched. This is the only part of the feature not scoped to
the composer, and it rides this hook (rather than `App.tsx`) so it is mounted wherever the composer is,
with no second mount point to keep in step. It is **defence in depth**: `will-navigate` in the background
process already refuses every navigation target but the app's own document, which is why a missed drop is
a silent no-op today rather than a hijacked window replaced by a rendering of the dropped file. The window
listener pair lives and dies with the effect, so a remount (including React StrictMode's double-invoke)
nets exactly one live pair — the `onDaemonEvent` / `useAttachmentUpload` idiom.

**The mount**, in `Composer` (`ConversationScreen.tsx`):

```tsx
<div className={composerClassName(fileDrop.active)} hidden={covered} {...fileDrop.handlers}>
```

`className` stays ahead of `hidden` in JSX order — same reason as `composerClassName`'s resting branch:
the three shipped whole-attribute-run assertions. The drop target is the **whole** `.composer` block, so a
drop landing on the footer row counts the same as one on the message box. `fileDrop` takes no
`conversationId` and reads no store, for the attach button's own reason: the intent it dispatches names no
conversation.

**The channel and the boundary guard** — `AttachmentUploadRequest`, `isAttachmentUploadRequest`, and the
widened `attachmentUploadListener` arm the path travels through — are documented at
[Attachment upload § The request body and its guard](attachment-upload.md); this document covers only the
renderer-visible half.

### CSS

`.composer--drop-target` — the drop-in-progress edge — is documented at [Composer attach §
CSS](composer-attach.md#css) alongside the button's own two rules, since all three sit in the same
stylesheet section.

### Testing the drop entry

`ComposerAttach.test.tsx` (static, extended) covers all four pure functions across their branches,
including the enter → enter → leave "still active" case and the leave-at-zero floor.

`e2e/composer-file-drop.spec.ts` (fake tier, new) drives a page-context `DataTransfer` carrying a
page-built `File` onto `.composer`: the drop-target class appears on `dragenter`, survives a child's
`dragleave`/`dragenter` pair, clears on `dragleave` and on `drop`, never appears for a `text/plain` drag,
the window stays on the conversation screen after a drop on the composer *and* after one anywhere else in
the window, and nothing is inserted into the textarea. The join to the existing flow is proven without a
real path: an outcome is pushed first through `composer-attach.spec.ts`'s shipped `app.evaluate` seam, and
the drop **clears** it — an effect only `dropFile` produces.

**Two lessons from writing that spec:**

- **An untrusted `DragEvent`'s `preventDefault` leaves no trace in the URL, so "the window did not
  navigate" is not what to assert.** That assertion holds identically whether the navigation guard is
  mounted or not, i.e. it's vacuous on its own. What *is* observable is `dispatchEvent`'s own return
  value: it comes back `false` exactly when `preventDefault` ran. The spec asserts that in both
  directions — prevented for a file drag, *not* prevented for a text drag — which reddens if the listener
  is unmounted or its file gate is inverted. The URL check stays alongside as corroboration, labelled as
  such rather than as the proof.
- **A drag crossing from the composer onto a child nets to zero, not to a needed second `dragleave`.**
  Moving the pointer from `.composer` onto its own textarea fires `dragenter` on the child *and*
  `dragleave` on the parent — both bubble to the same handler, and they are exactly the arithmetic the
  depth counter exists to get right (net change: 0, state: still active). A first draft of this spec
  assumed the two enters needed two closing leaves before the state would clear, and asserted a
  `dragleave` count that never matched what the browser actually dispatches.

**What no tier proves.** A page-built `File` has no path, so this tier cannot carry a real one across; the
path-carrying leg is proven by the shared guard's unit tests plus #862's existing real-temp-file coverage
of `uploadAttachmentFile`. The composition-root join and the preload's `dropAttachmentFile` are this
repo's untested glue, as they are for every other attachment channel. CDP's `Input.dispatchDragEvent` was
the ticket's named optional route and was **not** attempted: it still cannot back a `File` with a real OS
path, so it would not have closed the gap it was nominated for.

### Security (drop entry)

PASS, self-reviewed. One property to hold onto: the honest containment claim is *only an operator gesture
mints a path-backed `File`* (a drop, or a file-system picker — this app renders no `<input type=file>`),
not "only a drop" — `dropAttachmentFile` is callable by any renderer code holding any `File`, so a
compromised renderer's marginal capability is forwarding a path-backed `File` it already holds, not naming
an arbitrary path. Repetition on the drop arm is unbounded by design (`pickerOpen` is scoped to the
*dialog* and deliberately not consulted here), bounded instead by #862's per-upload byte guard and the
daemon's own concurrency answer — a self-DoS by a renderer that already holds the command channel, and a
sixth concern judged not worth a client-side cap in a slice already over its line ceiling. See
[Attachment upload § Security](attachment-upload.md#security) for the boundary guard's own review.

## Related

- [Composer attach](composer-attach.md) — the parent page: the button, the outcome view, the hook, the
  copy module and the pending-attachments set (#1039).
