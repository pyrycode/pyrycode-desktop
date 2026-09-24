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

## How it works

One new file, `src/renderer/src/screens/conversation/MarkdownReader.tsx`.

- **`MarkdownReaderState`** — `{ type: 'closed', notice }` (with the one static failure
  line's on/off state), `{ type: 'loading', requestKey, path }`, `{ type: 'loaded',
  requestKey, path, text }`.
- **`markdownReaderReducer(state, event)`** — pure. `open` always moves to `loading` with a
  fresh `requestKey`, clearing any notice and superseding any open reader. `back` always
  returns the closed state with **no** notice. `outcome` (a `WorkspaceFileReadEvent`) applies
  only when the state is `loading` and `outcome.requestKey === state.requestKey`; every other
  case — the reader already closed, a second open superseded the one that's answering, a
  second answer to an already-loaded key — returns the state unchanged. **The request key,
  minted fresh by `crypto.randomUUID()` on each `open`, is the entire mechanism that
  recognizes a stale answer**; there is no timestamp, no generation counter, no cancellation
  of the outstanding IPC ask itself.
- **`useMarkdownReader(conversationId)`** — one `useReducer` plus one
  `window.pyry.onWorkspaceFileReadEvent` subscription, unsubscribed in the effect's cleanup.
  `open(path)` does nothing when `conversationId` is `null`; otherwise it mints the key,
  dispatches `open` synchronously (so the bar is on screen before the fetch resolves), then
  calls `window.pyry.readWorkspaceFile({ requestKey, conversationId, path })`. A `pendingKey`
  ref (diagnostics only — the reducer is still the authority on which answer applies) drives
  the `markdown-reader` diagnostic's two static codes, `open` and `stale`; neither the path,
  the file text nor a failure reason is ever part of either code.
- **`markdownFileName(path)`** — the path's last `/`-separated component via `lastIndexOf`,
  cut to 255 characters (`MAX_TITLE_CHARS`, a filesystem component's own cap) — the title is
  daemon-influenced text, so it is length-bounded in addition to React's escaping, per
  CLAUDE.md's "rendered, escaped and length-bounded" rule for daemon text. The CSS
  `nowrap`/`ellipsis` on `.markdown-reader__title` is a second, geometric bound for the
  narrow-window residual truncation can't cover — neither is redundant with the other.
- **`MarkdownReaderView({ state, onBack })`** — pure, a function of `loading | loaded` state
  only (the `closed` variant is never passed in — see § Pane wiring). The bar is drawn in
  **both** states, so it has somewhere to live while the first fetch is in flight — this is
  what gives [#1623](https://github.com/pyrycode/pyrycode-desktop/issues/1623)'s later
  three-dot menu a mount point that isn't gated on content having arrived. The body renders
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
  `{ type: 'closed', notice: true }`.

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
  `onOpenMarkdownPath` opt-in on `AssistantMarkdown`, and the shared `webLink` helper the link
  rule was split out of.
- [Attachment retrieval](attachment-retrieval.md) — the `readWorkspaceFile`/
  `onWorkspaceFileReadEvent` bridge (#1626) this reader's `open` and outcome listener call.
- [Composer attach — pending attachments and the strip](composer-attach-pending.md) — the
  mount-local composer state an unmount silently drops; the reason the pane hides rather than
  unmounts.
- [PR #1629](https://github.com/pyrycode/pyrycode-desktop/pull/1629) — the verifier's MUST FIX
  and the rework that replaced the early return with the covered-wrapper layer.
- `docs/specs/architecture/1627-markdown-link-reader.md` — the design, its `## Revisions`
  recording the layering fix, and the security review.
