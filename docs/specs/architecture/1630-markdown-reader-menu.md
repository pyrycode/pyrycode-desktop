# #1630 — a menu in the markdown reader to copy the note and refresh it

## Files read

- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderState`, `markdownReaderReducer`, `useMarkdownReader`, `MarkdownReaderView`, `MARKDOWN_OPEN_FAILED_NOTICE` — the reader this ticket extends; the request key is its only stale-answer mechanism.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu` — the one dropdown (operator ruling 2026-09-24); `triggerAriaLabel`, `placement: 'bottom-end'`, `unavailable` rows gated in its `select`, Escape via `resolveComposerOptionsKey`, outside click via its document `mousedown` listener.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadOverflowMenu` — the icon-only consumer to mirror (the 6 × 24 ellipsis glyph, `conversation__overflow-trigger`); the `MarkdownReaderView` call site in `ConversationScreen`.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `AssistantMarkdown`, `remarkGfmSubset` — the render pipeline and its security contract (no rehype plugins, raw HTML escaped, link/img/input overrides); the plain-text walk must parse with the same one plugin.
- `src/renderer/src/screens/conversation/copyMessageText.ts` → `copyMessageText` — the sanitized text write and its never-throw, content-free-log posture.
- `src/main/index.ts` → the `setPermissionRequestHandler` comment claiming `clipboard-sanitized-write` is text/plain only.
- `src/renderer/src/screens/conversation/conversation.css` → `.markdown-reader__*`, `.conversation__overflow-trigger`, `.composer-options-anchor--bottom-end`, `.conversation__banner`.
- `e2e/markdown-reader.spec.ts`, `e2e/message-copy.spec.ts` — the fake-daemon `read_workspace_file` answer and the main-process clipboard read-back.
- `docs/knowledge/features/conversation-shell-markdown-reader.md` — the #1627 overview: the bar is drawn in both states precisely so this menu has a home while the first fetch is in flight.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=557-2239 (menu button) · https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879 (menu panel)

A 24 × 24 `Menu button` at the right end of the reader's top bar (`Buttons` 557:2238, after the flexing title), holding the 6 × 24 vertical-ellipsis glyph in primary — the same drawing and the same glyph `ThreadOverflowMenu` already ships, so the trigger reuses `.conversation__overflow-trigger` / `.conversation__overflow-icon`. The panel is the shipped `Options overlay` (`ComposerOptionsPanel`), opened bottom-end under the button.

## Context

#1627 shipped the reader; this adds items 1–4 of the six-item menu the operator fixed on 2026-09-24 (phone twin: pyrycode-mobile#1031). Items 5 and 6 are sibling tickets and append below Refresh.

**The HTML clipboard measurement (done first, in the built app, 2026-09-24).** A throwaway Playwright spec called `navigator.clipboard.write([new ClipboardItem({ 'text/html', 'text/plain' })])` from the window under the unchanged permission handler, then read the OS clipboard back in main: the call resolved `ok`, `clipboard.readHTML()` returned the HTML (Chromium-wrapped in `<meta charset><html><body>…`) and `readText()` the plain fallback. So `clipboard-sanitized-write` covers the sanitized async `write` with `text/html`, not only `writeText`. **The window route ships; no IPC channel, no preload change, the handler is untouched.** The two comments that say text/plain only are corrected.

## Design

### Conversions (pure, in `MarkdownReader.tsx`)

- `markdownPlainText(text: string): string` — parses with `unified().use(remarkParse).use(remarkGfmSubset)` (the exact parse config `AssistantMarkdown` uses; `remarkGfmSubset` becomes an export) and walks the mdast structurally from `unknown` (no `mdast` type import, no casts). Blocks join with a blank line; list items and table rows with a newline, table cells with a tab; `text` / `inlineCode` / `code` / `html` contribute their value (raw HTML is shown as literal text in the view, so it is literal text here); emphasis, strong, delete and links contribute their children; images their alt; `break` a newline; definitions and thematic breaks nothing.
- `markdownHtml(text: string): string` — `renderToStaticMarkup(<AssistantMarkdown text={text} />)` from `react-dom/server`. This is literally the rendered view's pipeline, so every rule holds by construction: raw `<script>` / `<img onerror>` arrive as escaped text, links are the http/https allowlist, images are alt text. No `onOpenMarkdownPath`, as in the reader.
- `MarkdownCopyKind = 'markdown' | 'plain' | 'html'`.

### Clipboard (in `copyMessageText.ts`, beside `copyMessageText`)

- `copyRichText({ html, text }): Promise<boolean>` — `navigator.clipboard.write([new ClipboardItem({ 'text/html': Blob, 'text/plain': Blob })])`. Same posture as its sibling: guarded feature checks, never throws, a failure logs an event name alone. Markdown and plain text go through the existing `copyMessageText`.

### State

```ts
type MarkdownReaderState =
  | { type: 'closed'; notice: boolean }
  | { type: 'loading'; requestKey: string; path: string }
  | { type: 'loaded'; requestKey: string; path: string; text: string;
      refreshKey: string | null; notice: boolean }
type MarkdownReaderEvent = … | { type: 'refresh'; requestKey: string }
```

Reducer additions:
- `refresh` in `loading` → `loading` with the new key (supersedes the first fetch); in `loaded` → same text, `refreshKey` = new key; in `closed` → unchanged.
- `outcome` in `loaded` applies only when `outcome.requestKey === state.refreshKey`: `loaded` replaces the text, adopts the key, clears `refreshKey` and `notice`; `failed` keeps the text, clears `refreshKey`, sets `notice`. Every other loaded-state outcome (the shown key answering twice, an older refresh after a newer one) is unchanged. The `loading` arm is untouched, so a first-open failure still closes to the thread notice.

### Hook

`useMarkdownReader` additionally returns `refresh()`, `copy(kind)` and `copied: boolean`.
- `refresh()` — no-op when closed or no conversation; else a fresh `crypto.randomUUID()` key, `pendingKey` updated, dispatch `refresh`, diagnostic code `refresh`, `readWorkspaceFile` for `state.path`.
- `copy(kind)` — acts only on `loaded` (reads the text shown now); builds the payload from the conversions, awaits the write, on success sets `copied` for `COPY_CONFIRMATION_MS` (2000) via a timer cleared on re-copy, on back and on unmount; diagnostic codes `copied` / `copy-failed`. Invoked `void`-ed with the promise handled inside.

### View

`MarkdownReaderView({ state, copied, onBack, onRefresh, onCopy })` stays pure. The bar gains a `ComposerOptionsMenu` after the title: `ariaLabel` / `triggerAriaLabel` `'Note actions'`, `placement="bottom-end"`, `currentId={null}`, the four rows in order (`Copy as markdown`, `Copy as plain text`, `Copy as HTML`, `Refresh`), the three copy rows `unavailable` unless `state.type === 'loaded'`. Under the bar: `MARKDOWN_OPEN_FAILED_NOTICE` as `.conversation__banner` when `state.notice`, and `MARKDOWN_COPIED_NOTICE` (`'Copied to the clipboard.'`) as a neutral `role="status"` line when `copied`. `ConversationScreen` passes the three new props.

`ComposerOptionsPanel`'s unavailable note reads "(unavailable in this workspace)"; for these rows that wording is slightly off, but the panel's contract is shared and the note is visually hidden. Accepted rather than widening the shared panel here.

## State + concurrency model

Screen-local reducer as before; no store. One long-lived listener (unchanged). New: one copy-confirmation `setTimeout`, cleared in an unmount effect and on `back`. Clipboard writes are one-shot promises whose rejections are caught inside the helpers. A fetch is never cancelled; its answer is recognised as stale by key.

## Error handling

- Refresh failure → notice inside the reader, old text kept; next successful refresh clears it.
- Copy failure (no clipboard API, permission refusal, rejection) → `false`, no confirmation, a content-free diagnostic, no throw.
- Nothing logs the text, the path, the HTML or a caught error.

## Testing strategy

Unit (vitest, `MarkdownReader.test.tsx`, `copyMessageText.test.ts`):
- reducer: refresh keeps text and sets the key; refresh answer replaces text; refresh failure keeps text and sets notice; later success clears notice; stale answers after back / newer refresh / newer open change nothing; refresh while loading supersedes the first key.
- `markdownPlainText`: heading without `#`, link as label, emphasis without markers, fenced code content, list and table shape.
- `markdownHtml`: a note with `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` yields `&lt;script&gt;` / `&lt;img` and no live `<script` / `<img` / `onerror=` attribute.
- `copyRichText`: writes one ClipboardItem carrying both flavours; resolves false on rejection and missing API without logging content.
- view markup: trigger present with its label; confirmation and in-reader notice render from state.

e2e (`e2e/markdown-reader-menu.spec.ts`): the first read is held so the copy rows show `aria-disabled` while loading and Refresh fetches; menu order; Escape and outside click close; each copy kind read back through main (`readText`, `readHTML`); confirmation shown; refresh replaces content; a failing refresh keeps content and shows the notice inside the reader; a later refresh clears it.

## Open questions

- The HTML includes `AssistantMarkdown`'s client-owned code-block chrome (the Copy code button and its svg). It follows the view's rules; stripping chrome would need a second render table in the security-boundary file. Resolve during implementation: keep unless it breaks the paste read-back.

## Documentation handoff

Pending for the documentation stage: the ticket has no Documentation handoff section. The natural home is `docs/knowledge/features/conversation-shell-markdown-reader.md` (the menu, the refresh states, the measured HTML clipboard route) and `assistant-markdown-renderer.md` (the `remarkGfmSubset` export and `markdownHtml` as a second consumer of the pipeline).

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the note text is daemon-supplied and reaches exactly three sinks: `AssistantMarkdown` (unchanged rendering), `renderToStaticMarkup` of that same component (React escapes every text child; no `dangerouslySetInnerHTML`, no rehype plugin, so raw HTML is text), and the clipboard. The HTML flavour is produced by the render pipeline, never by string concatenation of note text; the `<script>` / `<img onerror>` unit test pins it. Chromium additionally sanitizes `text/html` on the async write (a different fabric, not relied on).
- [Tokens] No findings — no token, key or credential is touched.
- [File / storage] No findings — no filesystem access in the window; refresh reuses #1626's `readWorkspaceFile` with the path already held in state, confined by the daemon as before.
- [Electron attack surface] No findings — no new IPC channel, no preload change, and the permission handler stays an allowlist of exactly `clipboard-sanitized-write`; no read permission is granted and the read-back in tests goes through main. The measured grant of `write` with `text/html` is a property of the existing permission, now documented in its comment.
- [Crypto] No findings — `crypto.randomUUID()` request keys are correlation ids, not secrets.
- [Network & I/O] No findings — a refresh is one more `read_workspace_file` ask on the existing bounded path; operator-initiated, no loop.
- [Logs] SHOULD FIX (implement in Phase B) — diagnostics are the static codes `refresh`, `copied`, `copy-failed` under `markdown-reader`; the rich-copy failure logs an event name only, never the caught error (its message could carry content in a future Chromium). The verifier checks no text, path or HTML reaches a log.
- [Concurrency] No findings — stale refresh answers are rejected by key in the pure reducer; the confirmation timer is cleared on unmount and back; a copy reads the text at call time, so a refresh landing mid-write cannot mix contents.
- [Threat model] OUT OF SCOPE — "Open in another app" and "Save to device" (the sibling tickets) are the items that would add a real egress to the filesystem; nothing here writes a file.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
