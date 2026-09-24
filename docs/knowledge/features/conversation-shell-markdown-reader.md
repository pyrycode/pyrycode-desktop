# Conversation shell — markdown reader

The in-app reader for a markdown-path link in a settled assistant reply, split out of
[Conversation shell](conversation-shell.md) as its own document since it introduces a
distinct pane state and a layering technique the rest of the screen doesn't otherwise need.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen
does as a whole, its edge cases and its other links.

## What it does

[#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627) made a link in an
assistant reply that names a workspace markdown file (see
[`markdownLinkPath`](assistant-markdown-renderer.md#how-it-works)) clickable: it opens a
reader that fetches the file's current text through the [#1626
bridge](attachment-retrieval.md) and shows it rendered through `AssistantMarkdown`, under
a fixed top bar (Figma `552:2404`) holding a back arrow and the path's last component. The
operator decided on 2026-09-24 that the reader always shows the current file — **every open
fetches again, nothing is cached between opens**, not even a reopen of the same path in the
same conversation.

[#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) added a three-dot menu at
the bar's right edge — Copy as markdown, Copy as plain text, Copy as HTML and Refresh, in
that order (operator ruling 2026-09-24; the phone twin is pyrycode-mobile#1031). See
§ Note actions menu.

## How it works

One new file, `src/renderer/src/screens/conversation/MarkdownReader.tsx`.

- **`MarkdownReaderState`** — `{ type: 'closed', notice }` (with the one static failure
  line's on/off state), `{ type: 'loading', requestKey, path }`, `{ type: 'loaded',
  requestKey, path, text, refreshKey, notice }`. The last two fields are
  [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630)'s: `refreshKey` is the
  one pending refresh's request key (`null` when none is in flight) and `notice` there is the
  same static failure line, but drawn **inside** the reader over the still-shown old text
  rather than in the thread — a loaded reader never closes itself over a refresh failure.
- **`markdownReaderReducer(state, event)`** — pure. `open` always moves to `loading` with a
  fresh `requestKey`, clearing any notice and superseding any open reader. `back` always
  returns the closed state with **no** notice. `outcome` (a `WorkspaceFileReadEvent`) applies
  only when the state is `loading` and `outcome.requestKey === state.requestKey`; every other
  case — the reader already closed, a second open superseded the one that's answering, a
  second answer to an already-loaded key — returns the state unchanged. **The request key,
  minted fresh by `crypto.randomUUID()` on each `open`, is the entire mechanism that
  recognizes a stale answer**; there is no timestamp, no generation counter, no cancellation
  of the outstanding IPC ask itself. `refresh` ([#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630))
  extends the same key discipline to a loaded reader: in `loading` it replaces the pending
  `requestKey` (a refresh clicked before the first answer supersedes that fetch, exactly like
  a second `open` would); in `loaded` it sets `refreshKey` to a fresh key without touching
  `text`, so the old content stays on screen through the round trip; in `closed` it is a
  no-op. A `loaded` state's `outcome` handling is now gated on `refreshKey`, not
  `requestKey`: an outcome applies only when it answers the one pending `refreshKey`, and a
  `loaded` outcome replaces `text` and adopts the key while a `failed` one keeps the old text
  and sets `notice` — an older refresh's answer, or the shown key answering a second time,
  changes nothing. The `loading` arm is untouched by this, so a first-open failure still
  closes to the thread notice as before.
- **`useMarkdownReader(conversationId)`** — one `useReducer` plus one
  `window.pyry.onWorkspaceFileReadEvent` subscription, unsubscribed in the effect's cleanup.
  `open(path)` does nothing when `conversationId` is `null`; otherwise it mints the key,
  dispatches `open` synchronously (so the bar is on screen before the fetch resolves), then
  calls `window.pyry.readWorkspaceFile({ requestKey, conversationId, path })`. A `pendingKey`
  ref (diagnostics only — the reducer is still the authority on which answer applies) drives
  the `markdown-reader` diagnostic's static codes, now `open`, `refresh`, `copied`,
  `copy-failed` and `stale`; neither the path, the file text, the clipboard content nor a
  failure reason is ever part of any of them.
  [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) added `refresh()` (a
  no-op when closed; else a fresh key, same `pendingKey`/dispatch/fetch shape as `open`,
  reusing the state's own `path`) and `copy(kind)` (a no-op unless `state.type === 'loaded'`,
  so it always acts on the text shown at the moment of the click — a refresh landing mid-write
  cannot mix contents; on a successful write it sets a `copied` flag for 2000ms via a timer
  cleared on re-copy, on `back` and on unmount, guarded by an `alive` ref so a write that
  resolves after unmount can't re-arm it).
- **`markdownFileName(path)`** — the path's last `/`-separated component via `lastIndexOf`,
  cut to 255 characters (`MAX_TITLE_CHARS`, a filesystem component's own cap) — the title is
  daemon-influenced text, so it is length-bounded in addition to React's escaping, per
  CLAUDE.md's "rendered, escaped and length-bounded" rule for daemon text. The CSS
  `nowrap`/`ellipsis` on `.markdown-reader__title` is a second, geometric bound for the
  narrow-window residual truncation can't cover — neither is redundant with the other.
- **`MarkdownReaderView({ state, copied, onBack, onRefresh, onCopy })`** — pure, a function
  of `loading | loaded` state only (the `closed` variant is never passed in — see § Pane
  wiring). The bar is drawn in **both** states, so it has somewhere to live while the first
  fetch is in flight — this is what gave
  [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630)'s three-dot menu a mount
  point that isn't gated on content having arrived (see § Note actions menu). The body renders
  `<AssistantMarkdown text={state.text} />` inside `.bubble__markdown` when loaded (reusing
  the reply's own markdown CSS — headings, code chrome, tables, task marks — rather than
  restating it), and an empty `aria-busy="true"` box while loading. **No `onOpenMarkdownPath`
  is passed** — a link inside a note renders as plain text or a plain external link exactly
  as it would in a reply with the prop absent; following a link within a note is a later
  ticket, not a gap in this one.
- **`MARKDOWN_OPEN_FAILED_NOTICE`** — the one client-owned string, `'Could not open the
  file.'`, shown in the thread (not the reader, which has already closed by the time it
  renders) as `<p className="conversation__banner" role="status">`. Never the path, never the
  failure reason — a `failed` outcome for the current key is the reducer's only route to
  `{ type: 'closed', notice: true }`. [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630)
  reuses the same string for a failed **refresh**, but rendered inside the still-open reader
  (`.markdown-reader__notice`) over the old text rather than in the thread — the two call
  sites share the string because the failure reads the same to the operator either way, not
  because they share a rendering path.

## Note actions menu

[#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) added a three-dot button at
the bar's right end — the phone twin is pyrycode-mobile#1031, and the operator ruled on
2026-09-24 that both clients ship the same six items in the same order; #1630 shipped the
first four, [#1631](#open-in-another-app-1631) the fifth (Open in another app, below), and a
sixth sibling ticket (Save to device) is still to append below it.

**The menu reuses `ComposerOptionsMenu`** ([Composer options
panel](conversation-shell-composer-options-panel.md)) rather than a second dropdown — an
explicit operator ruling, since that component already carries an icon-only trigger
(`triggerAriaLabel`), a `bottom-end` placement and `unavailable` (disabled) rows. The trigger
reuses `ThreadOverflowMenu`'s own drawing and glyph (`.conversation__overflow-trigger` /
`.conversation__overflow-icon`), so the desktop chat screen's overflow button and the
reader's note-actions button are visually the same control in two places. `markdownReaderMenuOptions(state)`
builds the four rows from state alone (pure, exported for the unit tier): the three copy rows
carry `unavailable: state.type !== 'loaded'`, Refresh is always available. Escape and an
outside click close the menu through `ComposerOptionsMenu`'s own handling, not anything local
to the reader.

**The three copy kinds** (`MarkdownCopyKind = 'markdown' | 'plain' | 'html'`) all act on
`state.text` — the note as currently shown, never re-fetched for the copy:

- **Copy as markdown** — `copyMessageText(state.text)`, the raw file text, through the
  existing [`copyMessageText`](conversation-shell-message-bubble.md#copymessagetextts-new)
  sink.
- **Copy as plain text** — `markdownPlainText(state.text)` through the same sink.
  `markdownPlainText` parses with `unified().use(remarkParse).use(remarkGfmSubset)` — the
  exact plugin [`AssistantMarkdown`](assistant-markdown-renderer.md) registers, now exported
  from that module for this reason — and walks the resulting tree from `unknown` (no `mdast`
  type import, no casts): blocks join on a blank line, list items and table rows on a newline,
  table cells on a tab; text/inline-code/code/raw-HTML nodes contribute their literal value
  (raw HTML is literal text in the rendered view too, so it stays literal text here);
  emphasis, strong, delete and links contribute their children; images contribute their alt
  text; a hard break is a newline; definitions and thematic breaks contribute nothing.
- **Copy as HTML** — `copyRichText({ html: markdownHtml(state.text), text:
  markdownPlainText(state.text) })`. `markdownHtml` is `renderToStaticMarkup(<AssistantMarkdown
  text={text} />)` (`react-dom/server`) — **the rendered view's own pipeline, server-rendered,
  not a second sanitizer** — so every `AssistantMarkdown` security rule holds by construction:
  raw HTML in the note arrives on the clipboard as escaped text, links follow the http/https
  allowlist, images become alt text. A unit test pins this directly: a note containing
  `<script>` and `<img onerror>` copies with no live `<script`/`<img`/`onerror=` in the
  markup. The HTML carries `AssistantMarkdown`'s client-owned code-block chrome (the Copy code
  button) along with it — stripping it would need a second component table in that
  security-boundary file for no observed need, so it ships as-is. Like the reader's own
  render, `markdownHtml` passes no `onOpenMarkdownPath`.
- **`copyRichText`** ([`copyMessageText.ts`](conversation-shell-message-bubble.md#copymessagetextts-new))
  is the one clipboard call all three kinds funnel non-markdown/plain copies through: one
  `ClipboardItem` carrying both `text/html` and `text/plain`, via the async
  `navigator.clipboard.write`. **Measured, not assumed, in the built app**: the existing
  `clipboard-sanitized-write` permission — believed at the time to be text/plain-only, per the
  comment in `src/main/index.ts` and the header of `copyMessageText.ts` — also allows this
  async `write` call with a `text/html` flavour. Both comments were wrong and are corrected in
  this ticket; no IPC channel or preload change was needed, and the permission handler's
  allowlist stays exactly the one string. Chromium's own sanitization of the HTML on write is
  a second fabric, not the one this design relies on — the HTML is already inert by
  construction, per the point above.
- Every copy write shares `copyMessageText`'s posture: feature-checked (`typeof
  clipboard?.write === 'function'` and `typeof ClipboardItem === 'function'`), never throws, a
  failed write shows no confirmation, and a caught rejection logs an event name alone — never
  the text, the HTML or the caught error.
- A successful copy of any kind sets `copied` for 2000ms (`COPY_CONFIRMATION_MS`), shown as
  `MARKDOWN_COPIED_NOTICE` (`'Copied to the clipboard.'`) — a neutral `role="status"` line, not
  the failure banner's styling.

**Refresh** (`onRefresh` → `refresh()`) re-asks `readWorkspaceFile` for the state's own `path`
under a fresh request key, exactly like `open`, but the *reducer* keeps `text` on screen for
the duration (§ How it works) rather than showing the loading box — the visible difference
between opening a file and refreshing the one already shown. A failing refresh leaves the old
text in place and shows the notice inside the reader; the next successful refresh (of that
note or, after Back and a new open, of any note) clears it. A stale refresh answer — an older
refresh superseded by a newer one, or an answer arriving after Back or after a new `open` —
changes nothing, by the same request-key discipline the first fetch already used.

**Test note**: renderer unit tests are static `renderToStaticMarkup` renders with no click
([Development verification](development-verification.md)), so opening the menu, choosing a
row and reading the clipboard back are Playwright's job —
`e2e/markdown-reader-menu.spec.ts`, beside `e2e/markdown-reader.spec.ts`. It reads the OS
clipboard back through main the way `e2e/message-copy.spec.ts` already does, including
`clipboard.readHTML()` for the HTML flavour.

## Open in another app (#1631)

[#1631](https://github.com/pyrycode/pyrycode-desktop/issues/1631) added the menu's fifth row,
directly below Refresh: `unavailable: state.type !== 'loaded'`, same as the three copy rows. Choosing
it hands the note to the operating system's default app for `.md` — the reader never renders the
content itself for this action, and no path crosses the bridge in either direction.

**One new invoke channel, not attachment-open's send/push pair.** `src/shared/ipc/markdownOpen.ts`
(`MARKDOWN_OPEN_CHANNEL = 'pyry:markdown-open'`) departs deliberately from
[attachment open](attachment-open.md)'s channel-pair shape: the AC limits the request to the text and
the display name, so there is no correlation key, and a pushed outcome with no key would land on
whichever reader is listening — including one mounted after the asker unmounted, if a conversation
switch remounted the screen mid-flight. An invoke resolves back to the exact caller, and the answer is
short-lived (a local write plus the OS hand-off), so there was nothing to gain from a second channel.
`isMarkdownOpenRequest` guards shape and size only (text ≤ `MAX_MARKDOWN_OPEN_TEXT_LENGTH`, 32 Mi UTF-16
code units — pinned by a `src/main` test to be `>= ATTACHMENT_MAX_RETRIEVAL_BYTES`, since the shared
module cannot import from `src/main`; name ≤ `MAX_MARKDOWN_OPEN_NAME_LENGTH`, 255, the reader's own
title cap); empty strings pass on both fields. A request that fails the guard is dropped before any
filesystem or OS call, and the invoke still answers `'refused'` so the caller's promise settles — a
conforming window never sees that answer.

**`src/main/markdownOpen.ts` writes into its own sibling directory, `userData/markdown-views/`** (next
to [attachment open](attachment-open.md)'s `attachment-views`), reusing `sanitizeAttachmentFilename`
for the name — the same gate, not a second sanitiser. `markdownOpenFileName` strips a trailing `.md`
before clamping the stem to 252 characters and re-appending it, so the clamp runs after the sanitiser's
own steps and the result is always `<stem>.md`; a name already ending in `.md` within the bound comes
back unchanged. The write goes through an exclusive-create temp file (`wx`, so nothing already at that
name — a symlink included — is ever opened) and then a `rename` onto the final name, which **replaces**
whatever sits there rather than following it. That is also the retention rule: the same display name
overwrites its earlier file, so the directory holds at most one file per distinct sanitised name — a
name choice the window can vary, unlike the fixed identifier `attachment-views` keys on, but the review
accepted an unbounded rename-driven directory rather than filing a cap, since a conforming renderer only
ever names notes the operator actually opens (see the architecture doc's security review, Electron
attack surface, out of scope). `open` (`shell.openPath`, narrowed to a boolean at `src/main/index.ts`,
same as attachment open) then either returns the outcome `'opened'` or, on a false or rejected answer,
`'open-failed'`; a failed `mkdir`, temp write or rename is `'write-failed'`. The driver never rejects and
never throws, and is Electron-free like its sibling, so it unit-tests against a real temp directory with
an injected `open`.

**The reader shows one static notice, `MARKDOWN_OPEN_IN_APP_FAILED_NOTICE`** (`'Could not open the note
in another app.'`), drawn inside the still-open reader over the current text — never the thread-level
`MARKDOWN_OPEN_FAILED_NOTICE`, since a failed open-in-app leaves the reader open rather than closing it.
`openInAppFailed` is UI-local `useState`, cleared by the next attempt and by Back, same lifetime as
`copied`; the `alive` ref already guarding the copy-confirmation timer also stops a late answer from
setting it after unmount. Diagnostics are the static codes `open-in-app` and `open-in-app-failed` — never
the text, the name or the failure reason, matching every other diagnostic this reader emits.

**No Playwright coverage was added on purpose.** An e2e run must never launch a real external app; the
unit tests against the injected `open` seam (main) and the guard (shared) carry the proof instead.
`e2e/markdown-reader-menu.spec.ts` (#1630) now expects five rows and asserts the new one is disabled
while loading and enabled once loaded, but it never chooses it.

## Pane wiring

`ConversationScreen` holds `const reader = useMarkdownReader(openConversationId)` beside its
other screen-local overlay state (the run-config sheet, Channel Info, the background-task
panel). It is deliberately **not** store state: [`ConversationScreen` is mounted with a
per-conversation `key` in `PairedShell`](paired-shell.md), so switching conversations
remounts the screen, which drops the reducer state, clears the notice, and removes the
listener — a late answer after that point reaches no subscriber to apply itself to.

**The reader is a layer over the pane, not a replacement rendered by an early return** — that
was the shipped shape's first cut, reworked during review (PR #1629). The thread and
`Composer` now always render, nested inside a wrapper:

```css
.conversation__covered { display: contents; }
.conversation__covered[data-covered] { visibility: hidden; }
```

`display: contents` makes the wrapper generate no box of its own, so its children stay direct
flex items of `.conversation`'s column and the containing block for the screen's other
absolutely positioned sheets is unchanged. While the reader is open the wrapper carries
`data-covered`, which sets `visibility: hidden` on the whole subtree — out of the tab order
and the accessibility tree, and unable to take a pointer hit or a drop, but present in the
layout, so **the thread's scroll position survives the round trip** rather than resetting.
`MarkdownReaderView` itself renders as `position: absolute; inset: var(--space-6)
var(--space-5) var(--space-4)` over `.conversation`'s own content box (those insets equal
`.conversation`'s own padding), mirroring `.conversation__overflow`'s bar geometry (title-large
name, a 0.6-opacity `--color-inverse-primary` rule 16px below).

**Why this matters beyond visual continuity**: `Composer`'s pending-attachment set and its
upload listener (`useAttachmentUpload`) are mount-local state. The first shipped cut's early
return unmounted `Composer` whenever the reader opened, which silently dropped an attached
file's tile from the strip — and lost an upload that completed while the reader was open,
because its listener wasn't subscribed to hear it — on every same-conversation round trip
through the reader. `composerDraftStore`-held typed text survived (it's a store, not mount
state), which is why the gap wasn't visible from the draft text alone. `e2e/markdown-reader.spec.ts`
now attaches a file before opening the reader and completes a second upload while it's open,
then asserts both tiles are still present after Back — the regression this fix closes. See
[Composer attach — pending attachments and the strip](composer-attach-pending.md) for the
mount-local state itself.

**Lesson for any future view that temporarily takes over this pane**: hide the covered
subtree, don't unmount it, unless every child's state is already lifted to a store. An early
return is the natural first instinct and reads as correct in review until the specific
mount-local state it drops is traced.

## Related

- [Conversation shell](conversation-shell.md) — the parent document; `.conversation`'s layout,
  the screen's other overlays, and `PairedShell`'s per-conversation `key`.
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `markdownLinkPath`, the
  `onOpenMarkdownPath` opt-in on `AssistantMarkdown`, the shared `webLink` helper the link
  rule was split out of, and `remarkGfmSubset` — exported for `markdownPlainText`'s parse —
  and `markdownHtml`'s reuse of the render pipeline itself.
- [Composer options panel](conversation-shell-composer-options-panel.md) — `ComposerOptionsMenu`,
  the one dropdown this reader's note-actions menu reuses rather than building a second one
  (operator ruling 2026-09-24).
- [Conversation shell — message bubble](conversation-shell-message-bubble.md#copymessagetextts-new) —
  `copyMessageText.ts`: the sanitized text write this menu's markdown/plain-text copies reuse,
  the clipboard permission section `copyRichText` extends, and its content-free logging
  posture.
- [Attachment retrieval](attachment-retrieval.md) — the `readWorkspaceFile`/
  `onWorkspaceFileReadEvent` bridge (#1626) this reader's `open`, `refresh` and outcome
  listener call.
- [Attachment open](attachment-open.md) — #867, the shape § Open in another app follows: injected
  directory and `open` seam, never-rejects driver, gate-before-any-filesystem-call ordering — but a
  single invoke channel here, not that ticket's send/push pair.
- [Composer attach — pending attachments and the strip](composer-attach-pending.md) — the
  mount-local composer state an unmount silently drops; the reason the pane hides rather than
  unmounts.
- [PR #1629](https://github.com/pyrycode/pyrycode-desktop/pull/1629) — the verifier's MUST FIX
  and the rework that replaced the early return with the covered-wrapper layer.
- [PR #1633](https://github.com/pyrycode/pyrycode-desktop/pull/1633) — #1630's note-actions
  menu: the HTML clipboard measurement, the refresh state machine and their tests.
- [PR #1637](https://github.com/pyrycode/pyrycode-desktop/pull/1637) — #1631's Open in another
  app: the invoke-channel deviation from the attachment-open shape, and the write-through-temp-
  plus-rename driver and its tests.
- `docs/specs/architecture/1627-markdown-link-reader.md` — the design, its `## Revisions`
  recording the layering fix, and the security review.
- `docs/specs/architecture/1630-markdown-reader-menu.md` — the note-actions menu design: the
  HTML clipboard measurement, the refresh state additions and the security review.
- `docs/specs/architecture/1631-markdown-open-in-app.md` — the Open in another app design: the
  invoke-vs-channel-pair rationale and the security review's accepted out-of-scope items (an
  orphaned temp file after a mid-write kill, an unbounded directory driven by display-name
  choice).
