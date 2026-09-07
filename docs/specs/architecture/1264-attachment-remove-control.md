# #1264 — a remove control on each attachment tile takes the file back before send

## Files read

- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachmentStrip` (where the tiles
  are drawn and where the control's owner lands), `reducePendingAttachments` / `drainPendingAttachments` /
  `mirrorTakeToDisplay` (the two pure rules the removal rule joins, and the take it must not disturb),
  `useAttachmentUpload` (the ref-plus-state pair a removal has to write from one fold),
  `ComposerAttachButton` (this repo's icon-only-button idiom: `type="button"`, `aria-label` constant,
  inlined glyph path).
- `src/renderer/src/screens/conversation/ComposerAttachmentImage.tsx` → `ComposerAttachmentTile` — its
  `ready` arm's own comment reserves this ticket's control as "the one control this tile will ever get",
  and its `object-fit: cover` picture is what makes the tile frame's clip load-bearing.
- `src/renderer/src/screens/conversation/AttachmentFileIcon.tsx` → `AttachmentFileIcon` — the frame's third
  consumer is the message bubble, which is why the control must not land inside this component.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer`, `.composer__attachments`,
  `.composer__attachment`, `.composer__attachment-image`, `.composer__attachment-ext` — the strip's flex
  row, the 45×60 frame carrying `overflow: hidden`, and the arithmetic note on the 8px above the strip.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `<ComposerAttachmentStrip>` mount and
  `useAttachmentUpload`'s single call site — the one consumer that gains a prop.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage` — reads the take below both of
  its `false` returns and maps `attachment_ids` off it; nothing here changes, and it is what the e2e
  outbound-frame assertion measures.
- `src/renderer/src/screens/conversation/ComposerAttach.test.tsx` → the `ComposerAttachmentStrip` describe —
  its `tileCount` regex, its `startsWith`/`endsWith` order guard and its `not.toContain('aria-label')`
  hostile-name assertion are the three shapes this ticket's markup has to answer to.
- `src/renderer/src/screens/conversation/ComposerAttachmentImage.test.tsx` → the two whole-markup equalities
  on `<span class="composer__attachment"></span>`, which the control must leave byte-identical.
- `e2e/composer-attach.spec.ts` → its `push` helper (`webContents.send` on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL`, the cheapest way to mint a tile) and its strip geometry block.
- `e2e/message-copy.spec.ts` → its `buildReplyFrames` switch — the shipped shape for decoding inbound
  envelopes in a spec, which the outbound-frame capture extends by one line.
- `src/main/transport/fakeDaemon.ts` → `FakeDaemonOptions.buildReplyFrames` — called with every inbound
  plaintext in the Playwright process, so a spec-local closure sees every envelope the client sends.
- `docs/knowledge/features/composer-attach-pending.md` → the ref-not-state paragraph ("do not collapse the
  two by making the take read the state") and the "one fold, two writes" listener idiom, which the removal
  callback follows rather than inventing a third way to hold the set.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=134-5013 — Input
attachment `390:7199`, whose remove control is Icon `390:7183`.

A 20×20 icon hung off the tile's top-right corner at `x = 30, y = -5`, so it overhangs the 45×60 tile by 5px
on both axes. The export is one `<svg>`: a `circle` of radius 7 at the centre filled `Schemes/On Primary`
beneath the Font Awesome `circle-xmark-solid` path filled `Schemes/Primary` — the solid disc's cross is a
cut-out, so the dark circle behind it is what the cross reads as. A drop shadow of
`0 2px 1.5px rgba(0, 0, 0, 0.25)` sits under the whole glyph. No hover and no focus state is drawn.

`get_variable_defs` on `390:7183` resolves `Schemes/Primary` → `#9dcbfc` and `Schemes/On Primary` →
`#003355`, and the export's own baked `fill="#9DCBFC"` / `fill="#003355"` agree with both names — so unlike
#1262's transposed read, name and hex corroborate each other here. Both are `tokens.css` values exactly
(`--color-primary`, `--color-on-primary`), so the tokens ship and the hexes appear nowhere.

## Context

#1262 drew the strip and #1263 put the picture in its image tiles. Neither gives the operator a way back:
once an upload completes, its id rides the next `send_message` regardless. This slice adds the control that
takes one tile back out of the pending set before the send.

Nothing crosses the wire. The attachment family is `attachment_chunk` / `attachment_stored` /
`request_attachment` — there is no delete verb — so the host keeps the file it stored and removal is purely
an edit to a message not yet sent. No ADR is warranted: this adds no decision the strip's own page does not
already carry.

## Design

### Where the control hangs — a slot wrapper, not the tile frame

`.composer__attachment` declares `overflow: hidden`, and that clip is #1263's: its picture is
`object-fit: cover` and overflows the 45px slot by 7.5px each side. A control rendered inside the frame is
simply clipped away, and dropping the clip to fix it breaks the picture.

So `ComposerAttachmentStrip` wraps each tile in a positioning context outside the clip and renders the
control as the tile's **sibling**:

```
<div class="composer__attachments">
  <span class="composer__attachment-slot">
    …the tile, unchanged — <ComposerAttachmentImage> or <AttachmentFileIcon>…
    <button type="button" class="composer__attachment-remove" aria-label="Remove attachment">…</button>
  </span>
  …
</div>
```

Four properties this shape is chosen for:

- **`AttachmentFileIcon` is untouched**, so the message bubble's attachment row — its third consumer —
  gains no control and its 315 whole-attribute-run assertions stay green.
- **`ComposerAttachmentTile`'s three arms are untouched**, so both whole-markup equalities on
  `<span class="composer__attachment"></span>` in `ComposerAttachmentImage.test.tsx` stay byte-identical.
- **The slot shares no whole class token with `.composer__attachment`.** A class selector does not
  prefix-match, and both unit tests count tiles with `/class="composer__attachment"/g` — the closing quote
  is part of that match — so tile counts, the shipped `.composer__attachment` e2e locators, and
  `toHaveText('PDF')` on a tile (the control is outside it, contributing no text) are all unchanged.
- **The slot's border box is the tile's 45×60**, so the flex row's item positions are arithmetically
  identical and `composer-attach.spec.ts`'s x = 0 / 57 geometry block still reads the same numbers.

The strip owns the wrapper rather than either tile component: it is the only place that knows a tile's
**position**, which is what removal is addressed by.

### The control

A real `<button type="button">` with an `aria-label`, `ComposerAttachButton`'s idiom for an icon-only
control. Its child is the Figma export inlined — `<circle>` plus the FA path in a `viewBox="0 0 20 20"`,
with the export's full-viewBox `clipPath`, `preserveAspectRatio="none"` and `overflow="visible"` dropped
exactly as `ATTACHMENT_PATH` and `FILE_GLYPH_PATH` drop theirs. Inlined and never referenced: the renderer's
CSP is `default-src 'self'`, so Figma's asset URL would fail closed and be a third-party request per render.

**Two inks, one `currentColor` and one class.** A presentation attribute cannot hold a `var()`, so the path
takes `fill="currentColor"` off the button's own `color: var(--color-primary)` and the disc carries its own
class resolving `fill: var(--color-on-primary)` — the same seam `AttachmentFileIcon` uses to give one
drawing two inks, with no colour prop and no `style` attribute.

**The accessible name is a client-owned constant**, `REMOVE_ATTACHMENT_LABEL`, exported beside
`COMPOSER_ATTACH_LABEL`. No file name, no path, no extension: the name is untrusted display text and an
`aria-label` is an attribute, the sink CLAUDE.md's 2026-08-20 ruling closes.

### CSS — one new block, one modifier-free rule each

- `.composer__attachment-slot` — `position: relative; flex: 0 0 auto; width: 45px; height: 60px;`. No
  `overflow`, which is the whole point of the element. It replaces the tile as the flex item, and
  `.composer__attachment`'s own `flex: 0 0 auto` becomes inert inside it rather than wrong; it is left
  alone so the frame is still a valid flex item wherever else it renders.
- `.composer__attachment-remove` — `position: absolute; left: 30px; top: -5px; width: 20px; height: 20px;`
  plus the icon-button reset (`padding: 0; border: none; background: none; display: block;`),
  `color: var(--color-primary)`, `border-radius: 50%` and
  `filter: drop-shadow(0 2px 1.5px rgba(0, 0, 0, 0.25))`.
  - **`filter`, never `box-shadow`.** The button's box is a 20×20 square; the drawn shadow follows the
    *disc*. A `box-shadow` would draw a rounded square around a circle.
  - **No `z-index` is needed and none is declared.** The control paints after its own tile (later sibling),
    and its 5px right overhang ends at x = 50 inside a 12px gap, so the next slot at x = 57 never covers it.
  - **The 5px top overhang needs no headroom**: `.composer`'s `padding-top` is `--space-2`, the 8px the
    strip already sits below.
- `.composer__attachment-remove:focus-visible` — the file's twenty-rule idiom,
  `outline: 1px solid var(--color-outline)`. The design draws no focus state and the 2026-09-02 ruling is
  existing tokens until one lands; a keyboard operator has to see which of several controls is focused, so
  this is the ruling applied rather than an invention. **No hover rule** — a pointer already says which
  control it is over, and inventing a fill would pre-empt a drawing.
- `.composer__attachment-remove-disc` — `fill: var(--color-on-primary)`, the second ink.

### The rule — `removePendingAttachment`

A third pure rule beside its two siblings, in the same region of `ComposerAttach.tsx`:

```ts
export function removePendingAttachment(
  pending: readonly MessageAttachment[],
  index: number
): readonly MessageAttachment[]
```

**By position, never by id.** Two completions can carry the same `attachmentId` (the same file uploaded
twice), and removing by id would take both tiles for one click. Position is also what the strip already
keys on, so the control's index and the set's index are the same number by construction.

An out-of-range index returns the **same reference**, `reducePendingAttachments`'s idiom for "this event
changes nothing" — structural rather than incidental, and it means an impossible index cannot clear a set.
The input is never mutated.

### The hook — one fold, two writes

`useAttachmentUpload` returns one more member, `removePending: (index: number) => void`, which folds through
the rule and writes the ref then the state — the upload listener's shape exactly, and for its reason: the
set is held twice on purpose (the ref is the record the send reads, the `useState` is the display's copy)
and the two must not be able to disagree. **The take is not made to read the state**, which the strip's own
page names as the one thing a later ticket must not do.

Ref before state, the mirror of `mirrorTakeToDisplay`'s ordering argument: there is no instant at which the
record names an attachment the strip is no longer drawing.

`ConversationScreen` passes it through: `<ComposerAttachmentStrip attachments={attach.pending}
onRemove={attach.removePending} />`. That is the ticket's only consumer edit.

## State + concurrency model

Screen-local ephemeral state only (ADR 0006), unchanged in kind: the same `useRef` + `useState` pair
`useAttachmentUpload` already owns, per mount, cleared by the conversation-id key on the chat pane. No
store slice, no async task, no subscription, no timer, and therefore no cancellation path to define —
`removePending` is synchronous end to end, exactly like the click that calls it.

Interleaving with the two writers that already exist:

- **An upload completing during a removal** — both write the ref synchronously from React event/listener
  callbacks; neither awaits, so neither can interleave inside the other.
- **A send during a removal** — `submitMessage` takes and clears synchronously in the click's own frame; a
  removal either happened before the take (its tile is not in the take) or after it (against an empty set,
  where every index is out of range and the rule returns the same reference).

## Error handling

No I/O, no IPC, no parse — no failure mode to type. The one defensive path is the out-of-range index above,
which is a no-op returning the same reference rather than a thrown invariant, because the only caller is a
rendered control whose index came from the same array.

## Testing strategy

**Renderer (vitest, `renderToStaticMarkup`) — `ComposerAttach.test.tsx`:**

- `removePendingAttachment`: removes the named position and only it; the surviving order is preserved;
  two entries with the *same* `attachmentId` remove independently; a negative index, `index === length` and
  an index past the end each return the **same reference**; the input array is not mutated.
- The strip's markup: one slot and one control per tile; `tileCount` is still one per attachment (the slot
  does not double it); the control is a `<button type="button">` whose accessible name is exactly
  `REMOVE_ATTACHMENT_LABEL`; the two inks' class runs are present.
- The shipped hostile-name test is **re-aimed rather than deleted**: `not.toContain('aria-label')` is now
  false by design, so it becomes "every `aria-label` in the strip's markup equals the constant", which is a
  stricter statement of the same criterion. `title=` and `alt=` stay absent, and the name, the id and the
  `onerror` payload still reach nothing.
- The #1263 order guard's `startsWith` / `endsWith` / `indexOf` are re-aimed to the slot-wrapped shape,
  keeping their claim (an empty frame at each end, the file tile in the middle) intact.

Handlers do not exist in a static render, so `onRemove` wiring, the click and the outbound frame are the
Playwright tier's.

**Playwright fake tier — new `e2e/composer-attachment-remove.spec.ts`**, one launch, one continuous drive:

- A spec-local `buildReplyFrames` records every decoded inbound envelope into an array before dispatching:
  `send_message` → `[]` (the optimistic echo renders on its own, the `thread-scroll-pin` plant idiom),
  everything else → `[seedConversationsFrame()]`. This is the outbound capture the fake tier has not had.
- Two tiles are minted by pushing two `completed` `AttachmentUploadEvent`s on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` (`composer-attach.spec.ts`'s `push`), with distinct ids and extensions
  that share no character, so the survivor is identifiable by its own label.
- Geometry (AC1): the control is 20×20, its x is its tile's + 30 and its y is its tile's − 5, and its box
  lies inside the composer's — the overhang is painted, not clipped. Deltas compared with `toBeCloseTo`,
  and #868's rule applies: normalise `-0` before comparing a rounded delta with `toBe(0)`.
- AC2: click the **first** control; wait for the tile count to reach 1 and for the survivor to read the
  *second* file's label — a positive auto-waiting read of the click's own effect, ordered before any
  absence assertion.
- AC3: the recorded envelope count is captured **before** the click and asserted unchanged after the
  positive wait above; the send that follows increments it, which is the mutation check that the count was
  ever capable of moving.
- AC2's second half: the captured `send_message` names `attachment_ids` containing only the surviving id.
- AC4: the control's accessible name is the constant, and neither file name appears in the strip's markup.

## Open questions

- **Does the 5px top overhang need a `padding` or a `margin` anywhere?** The arithmetic says no
  (`.composer`'s `padding-top` is 8px). Resolved by the e2e containment assertion rather than by reading
  the stylesheet; if it turns out clipped, the fix is a rule on `.composer__attachments`, not on the tile,
  and it lands in `## Revisions`.
- **Does the disc need its own class, or can both inks come off `currentColor`?** Only one ink can be
  `currentColor` per element subtree without a second `color` declaration; the class is the cheaper of the
  two. If the implementation finds a one-declaration form, the plan's version is what must change.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The untrusted value in this ticket is `MessageAttachment.filename` — operator- and
  host-supplied text arriving over `ipcRenderer.on`, where the declared type is the compile-time half only.
  This slice adds **no new sink for it**: the control's only text is `REMOVE_ATTACHMENT_LABEL`, a module
  constant, and the name reaches neither `aria-label`, `title`, `alt`, a URL, a `data-*` attribute, a React
  key nor a log line. `attachmentId` likewise stays out of the render path. The renderer→main boundary is
  not crossed at all: removal writes two renderer-local holdings and sends nothing, so no `contextBridge`
  surface grows. **Concrete check carried into Phase B**: the re-aimed hostile-name unit test asserts that
  *every* `aria-label` in the strip's markup is the constant — a whole-attribute enumeration, not a
  substring `not.toContain`, so an interpolation of any part of the name reddens it.
- **[Tokens, secrets, credentials]** Not applicable by construction — this ticket touches no credential, no
  device token and no key material, and adds no storage of any kind. The one identifier in scope,
  `attachmentId`, is a host-minted storage handle already held in renderer memory since #1039; removal only
  *drops* entries, so no value is newly retained, persisted or widened in scope.
- **[File / storage operations]** No filesystem path is built, read or written. Removal deliberately sends
  no delete verb, so the host keeps the stored file — stated as intended behaviour in the ticket, and it
  means this ticket cannot be turned into a remote-deletion primitive by any input. **Named and deferred**:
  a pending attachment removed here leaves bytes on the host that no message references. That is the
  daemon's own retention concern, unchanged by this slice and out of scope for it.
- **[Inter-process / Electron attack surface]** No IPC channel, no `contextBridge` member, no
  `ipcMain.handle`, no protocol handler, no `webPreferences`, no navigation. The button is same-document
  and its handler calls a pure function. `window.pyry` is not dereferenced by any new code path — the
  standing rule that no bridge is touched during render survives, because the new code touches no bridge at
  all.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no key or
  nonce is read or derived. `removePendingAttachment` compares nothing; it slices by index.
- **[Network & I/O]** **AC3 is a security criterion, not just a behavioural one**: a control that emitted a
  frame per click would give a hostile page-level bug a cheap send primitive, and would let removal
  double as a host-side delete the operator never asked for. The design forecloses it structurally —
  `removePending` closes over no bridge and the strip's props carry no sender — and the e2e spec proves it
  against a **baseline count with a mutation check**, so the assertion cannot pass by measuring a client
  that never sends. **SHOULD FIX, carried into Phase B**: keep the absence assertion ordered *after* a
  positive auto-waiting read of the click's own effect; a bare count asserted immediately would pass before
  the click's work resolved (the recorded `a-closing-tohavecount-zero` trap).
- **[Error messages, logs, telemetry]** Nothing is logged, by design and by symmetry: `ComposerAttach.tsx`
  emits no log line today, and a removal has no classified error to record. Adding one would be the first
  place a filename could reach a log, which is exactly the sink the drawing keeps closed.
- **[Concurrency]** No async work, no listener, no timer, no `AbortSignal` — nothing to cancel and nothing
  that can outlive the mount. The only check-then-act shape is `read the ref → write the ref` inside one
  synchronous callback, with no `await` in the gap; the two other writers (the upload listener and
  `submitMessage`'s take) are equally synchronous, so no interleaving is reachable. The pathological
  ordering — a removal landing after a take — is a no-op by the out-of-range rule rather than by timing.
  **The one thing this ticket must not do**, restated from the strip's own page: do not make the take read
  the `useState` copy. Doing so to "simplify" the removal write would reopen the drop window that the
  ref exists to close, silently and with no test reddening.
- **[Threat model alignment]** *Malicious/compromised relay*: unreachable — no frame is produced, and the
  relay is on-path for frames only. *Hostile daemon response*: the hostile input is the filename on a
  `completed` event, handled above; a name of any length or content changes only what the extension label
  derives, and the control's name is a constant regardless. *Renderer compromise reaching the transport*:
  unchanged — this slice adds no capability to the renderer; a compromised window could already call the
  bridge members #863 exposed, and removal exposes nothing new. *Token theft from disk*: not in scope, no
  at-rest state.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
