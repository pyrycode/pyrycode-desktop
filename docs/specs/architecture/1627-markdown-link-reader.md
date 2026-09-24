# #1627 — open a markdown link in the assistant's reply in an in-app reader

## Files read

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `allowedLinkHref`, the `components.a` override, `AssistantMarkdown`. The link rule is added here; the module-constant `components` object and the never-spread rule constrain how.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen` (pane state, return JSX, `SavedTimelineNotice` placement), `Timeline`, `TimelineRow` (`assistantText` arm renders `AssistantMarkdown`), `ThreadOverflowMenu` (the top-bar markup the reader's bar mirrors).
- `src/renderer/src/PairedShell.tsx` → `PairedShell` mounts `ConversationScreen` with `key={props.paneKey}`, so pane-local state dies on a conversation switch.
- `src/shared/ipc/workspaceFileRead.ts` → `WorkspaceFileReadRequest`, `WorkspaceFileReadEvent`, `MAX_WORKSPACE_FILE_PATH_LENGTH`. The main-side guard `isWorkspaceFileReadRequest` silently DROPS an over-length path, so the window must never ask for one or the reader would sit loading forever.
- `src/preload/index.ts` → `readWorkspaceFile`, `onWorkspaceFileReadEvent`, `sendDiagnostic`.
- `src/main/workspaceFileRead.ts` → `createWorkspaceFileRead` already logs `started` / `loaded` / each failure reason content-free, so the window adds only its own two facts (opened, stale answer ignored).
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__overflow*` (top bar geometry to mirror), `.conversation__banner` (the notice reuses it), `.bubble__markdown` and `.bubble__markdown a` (reader body reuses the markdown rules; the link control copies the anchor's colour).
- `e2e/attachment-image-thumbnail.spec.ts` → `serveAttachmentFrame` (computed sha256, `in_reply_to` correlation); `e2e/send-and-stream.spec.ts` → the assistant delta + turn_end pair that settles a reply so it renders as markdown.
- `docs/knowledge/features/assistant-markdown-renderer.md` — the security contract of the markdown module.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=552-2404

The chat card holds a column: a top bar (a 24px back arrow in `--color-on-surface` stroke, 8px gap, the file name in title-large `--color-on-primary-container`, then a 1px `--color-inverse-primary` rule at 0.6 opacity 16px below), then the rendered markdown body in body-large on-surface, headings at 24/22, code block on surface-container, quote with an outline-variant bar. The trailing three-dot menu belongs to #1623 and is not drawn here.

## Context

The assistant links workspace notes as relative markdown links, which `allowedLinkHref` renders as plain text. #1626 shipped the window bridge that fetches a workspace file's current text. This ticket makes such links clickable and adds the reader. No ADR is needed.

## Design

### 1. The link rule — `AssistantMarkdown.tsx`

- `export function markdownLinkPath(href: string | undefined): string | null` — pure. Steps: strip a `#fragment` (from the first `#`), then a trailing `:line` or `:line:column` (`/:\d+(?::\d+)?$/`); reject when what remains carries a URL scheme (`/^[a-z][a-z0-9+.-]*:/i`, checked AFTER the strip so `Plan.md:12` is not read as scheme `plan.md:`); reject unless it ends in `.md` / `.markdown` case-insensitively; `decodeURIComponent` once, reject on throw; reject when the decoded path exceeds `MAX_WORKSPACE_FILE_PATH_LENGTH` (the main guard would drop it silently). Returns the decoded path. Decoding once is right because micromark percent-encodes a destination (`<notes/My Plan.md>` arrives as `notes/My%20Plan.md`).
- `AssistantMarkdown` gains an optional `onOpenMarkdownPath?: (path: string) => void`. Absent → the existing module-constant `components` (reader text and every current call site unchanged, byte for byte). Present → a `useMemo`-built components object identical except `a`: a markdown path renders `<button type="button" className="markdown-link" onClick={() => onOpenMarkdownPath(path)}>{children}</button>`; anything else falls through to today's `allowedLinkHref` logic (extracted to a shared `renderLink` helper so the two objects cannot drift). The path lives only in the click closure — no `href`, `title`, `data-*` or `aria-*` carries it.
- `TimelineRow` and `Timeline` in `ConversationScreen.tsx` take the same optional prop and pass it down; only the `assistantText` settled arm forwards it. User messages never render markdown, so they are unchanged by construction.

### 2. The reader — `MarkdownReader.tsx` (new)

- `export type MarkdownReaderState = { type: 'closed'; notice: boolean } | { type: 'loading'; requestKey: string; path: string } | { type: 'loaded'; requestKey: string; path: string; text: string }`
- `export type MarkdownReaderEvent = { type: 'open'; requestKey: string; path: string } | { type: 'back' } | { type: 'outcome'; event: WorkspaceFileReadEvent }`
- `export function markdownReaderReducer(state, event): MarkdownReaderState` — pure. `open` → `loading` (clears the notice, supersedes any open reader). `back` → `closed` without notice. `outcome` applies only when the state is `loading` and the keys match: `loaded` → `loaded`, `failed` → `closed { notice: true }`; otherwise the state is returned unchanged (stale or late answer ignored).
- `export function useMarkdownReader(conversationId: string | null): { state; open(path): void; back(): void }` — `useReducer` over the reducer; one `useEffect` subscribes `window.pyry.onWorkspaceFileReadEvent` and returns its unsubscribe. `open` mints `crypto.randomUUID()`, dispatches, then calls `window.pyry.readWorkspaceFile({ requestKey, conversationId, path })`; with no conversation it does nothing. Every open is a fresh ask — nothing cached.
- `export function markdownFileName(path: string): string` — the last `/`-separated component, cut to `MAX_TITLE_CHARS` (255, a filesystem's component cap) so daemon-derived title text is length-bounded as well as escaped; the CSS ellipsis is the geometric second layer.
- `export function MarkdownReaderView({ state, onBack }: { state: loading | loaded; onBack(): void })` — pure: top bar (`button.markdown-reader__back` with `aria-label="Back"`, inline arrow svg, `p.markdown-reader__title` holding the file name as text), rule, then `div.markdown-reader__body` containing `div.bubble__markdown > <AssistantMarkdown text={text} />` when loaded, empty and `aria-busy="true"` while loading. The bar is drawn in both states, so #1623's menu has a home before content arrives.

### 3. Pane wiring — `ConversationScreen.tsx`

`const reader = useMarkdownReader(openConversationId)` beside the other screen-local state. Before the return: when `reader.state.type !== 'closed'`, return `<div className="conversation"><MarkdownReaderView state={…} onBack={reader.back} /></div>` — the whole pane including the composer is replaced; the sidebar is PairedShell's and untouched. All hooks run above this branch. Otherwise the thread renders as today, with `onOpenMarkdownPath={reader.open}` on `Timeline` and, when `reader.state.notice`, `<p className="conversation__banner" role="status">{MARKDOWN_OPEN_FAILED_NOTICE}</p>` beside `SavedTimelineNotice`. The notice is a client-owned constant ("Could not open the file."), never the path or reason.

Conversation switch: `PairedShell` remounts the screen, which drops the reducer state (reader closed, notice gone) and unsubscribes; a late answer then reaches no listener. The back arrow returns to the same, still-mounted `ConversationScreen`, so the thread's store-held rows redraw; the scroll pin restarts pinned to the bottom (screen-local, per `useThreadScrollPin`).

### 4. CSS — `conversation.css`

`.markdown-link` (button reset, inherits font, `--color-primary`, underline, pointer, focus-visible outline), `.markdown-reader` column (flex 1, min-height 0), `__bar`/`__bar-content`/`__back`/`__title`/`__rule` mirroring `.conversation__overflow*` with the drawn 8px (`--space-2`) arrow gap, `__body` (flex 1, min-height 0, `overflow-y: auto`, body-large type) so the text scrolls beneath the fixed bar.

## State + concurrency model

One `useReducer` in the screen; no store. One IPC listener per mounted screen, removed in the effect cleanup. Correlation is the window-minted request key; the reducer ignores any outcome whose key is not the current `loading` key, which covers back-then-answer, open-then-open, and duplicate delivery.

## Error handling

A `failed` outcome for the current key closes the reader and raises the notice. No reason and no path is surfaced or logged. A malformed target never becomes a control (fail closed to today's plain text). Diagnostics: `sendDiagnostic({ event: 'markdown-reader', code: 'open' })` on each open and `code: 'stale'` when an outcome for an unknown key arrives while listening — static codes only; the main side already logs the fetch outcome.

## Testing strategy

Vitest (static):
- `AssistantMarkdown.test.tsx` — `markdownLinkPath` table: plain, `.markdown`, upper-case extension, `:12`, `:12:3`, `#frag`, `Plan.md:12` (not a scheme), percent-decoded once, `%E0%A4%A` undecodable → null, `https://x/y.md` / `file:` / `javascript:` → null, `notes/plan.txt` → null, over-length → null. Render with a callback: the link is a `button.markdown-link` whose markup contains the path only as visible text (no attribute holds it); a web link still renders `<a href target=_blank>`; render WITHOUT the callback keeps a markdown link as plain text.
- `MarkdownReader.test.tsx` — reducer transitions (open, loaded, failed → notice, stale key ignored, back, open clears notice, second open supersedes first); `markdownFileName`; view renders the file name, back button with accessible name, loading body empty with the bar present, loaded body through markdown (headings) with no link control.
- `ConversationScreen.test.tsx` — a settled assistant markdown link in `Timeline` with `onOpenMarkdownPath` renders the control; a user message with the same text does not.

Playwright `e2e/markdown-reader.spec.ts` (fake transport): the fake daemon answers `send_message` with a settled reply linking `notes/Plan.md`, and `read_workspace_file` with a single computed-digest chunk whose text changes per ask. Click → reader with the title `Plan.md`, composer gone, heading rendered; back → thread and composer; click again → the new content (fresh fetch). Then a second reply link to `notes/Broken.md` answered with a wrong digest → reader closes, the notice shows, and it never contains the path; opening the good link again clears it.

## Open questions

- Scroll position on back: accepted that the thread restarts pinned to the bottom (screen-local pin, a remount of `Timeline`). Recorded, not built around.

## Documentation handoff

Pending for the documentation stage: the ticket has no Documentation handoff section; the natural home is `docs/knowledge/features/assistant-markdown-renderer.md` (the new link rule and its no-attribute posture) and a conversation-shell overview entry for the reader.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the one boundary in the window is `markdownLinkPath`: an untrusted daemon href becomes either a decoded, bounded path string or null (plain text). The path's only destination is `window.pyry.readWorkspaceFile`, whose main-side `isWorkspaceFileReadRequest` re-checks shape and size, and whose only consumer is the daemon, which does all confinement. Nothing in the window resolves, joins, opens or normalises the path. A hostile `../` or absolute path is the daemon's to refuse; the answer can only ever reach this operator's own window.
- [Trust boundaries — rendering] No findings — the path appears in the rendered markup only as the link's existing visible text; `markdownLinkPath`'s result lives in an `onClick` closure, never an `href`, `title`, `data-*` or `aria-*` attribute. The fetched file text renders through `AssistantMarkdown` with its unchanged contract (no rehype, no raw HTML, no image fetch, http/https-only anchors via `allowedLinkHref`), and the reader passes no `onOpenMarkdownPath`, so a note cannot chain a second fetch.
- [Trust boundaries — title] SHOULD FIX (folded into Design § 2) — the title is daemon-influenced text; `markdownFileName` bounds it to 255 characters in addition to React escaping, per the CLAUDE.md "rendered, escaped and length-bounded" rule.
- [Tokens / secrets] No findings — none handled. The request key is a non-secret correlation token from `crypto.randomUUID()` and never leaves the machine (main strips it from the wire payload).
- [File / storage] No findings — nothing is written or cached; each open is a fresh ask (operator ruling 2026-09-24). No local path is ever computed in the window.
- [Electron surface] No findings — no new IPC channel, preload member or window. The existing `readWorkspaceFile` bridge from #1626 is the only capability used; navigation and window-open guards are untouched, and the link control is a `<button>` that cannot navigate.
- [Crypto] Not applicable — no primitive is used or changed.
- [Network & I/O] No findings — a single file is bounded by the retrieval leg's `ATTACHMENT_MAX_RETRIEVAL_BYTES` and concurrency by `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` (excess asks fail `busy`, which surfaces as the notice). Repeated clicks cannot fan out unbounded work.
- [Logs] No findings — renderer diagnostics are static codes (`open`, `stale`); the path, file text and failure reason are never logged or displayed. The notice is one client-owned constant.
- [Concurrency] No findings — one listener per mounted screen, removed in the effect cleanup; the reducer applies an outcome only for the current `loading` key, so late, duplicate, superseded and post-back answers are ignored, and a conversation switch remounts the screen and drops everything.
- [Threat model] OUT OF SCOPE — a very large but in-cap markdown file parsed on the renderer thread could stall the window briefly; bounded by the 23 MB retrieval cap, not observed, no defence shipped (evidence-based). Deceptive link text in a hostile reply can only open the reader on a daemon-confined file, never navigate.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
