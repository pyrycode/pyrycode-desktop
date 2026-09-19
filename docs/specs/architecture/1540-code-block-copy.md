# Copy message code blocks

## Files read

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` — `components.pre`, `fenceLanguage`, and `AssistantMarkdown` own code chrome and escaped Markdown rendering.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx` — static markup and hostile-source coverage.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `BubbleMeta` supplies the exact copy glyph and native-button pattern.
- `src/renderer/src/screens/conversation/copyMessageText.ts` and its test — `copyMessageText` writes plain text and handles missing/refused clipboard access.
- `src/renderer/src/screens/conversation/conversation.css` — code body gutters and copy button hover/focus conventions.
- `src/renderer/src/theme/tokens.css` — existing spacing, ink and radius tokens.
- `src/shared/ipc/diagnostics.ts` — `RendererDiagnosticEvent` permits content-free outcome logging.
- `e2e/message-copy.spec.ts` — fake reply and main-process OS clipboard read-back pattern.
- `docs/knowledge/features/assistant-markdown-renderer.md` — shared code-block CSS also serves Bash tool rows; scope new styles to message copy chrome.
- `docs/knowledge/features/development-verification.md` — static renders cannot prove interaction or geometry.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-4889

The header and simple variants are rounded dark code surfaces with blue borders, mono body text and a small blue copy glyph at the body's bottom right. Keep the existing header typography and optional divider. Reuse `BubbleMeta`'s exact 11×12 copy SVG, with token-based padding and visible focus; reserve a right-hand body gutter so code never runs beneath the target.

## Change

Replace the inline `components.pre` renderer with a module-private `CodeBlock` component in the same file. It keeps the original code children and optional language header, references its own `pre`, and adds a native `type="button"` named `Copy code`. On activation, read that pre's code `textContent` without trimming or reparsing, then call `copyMessageText`. The button is outside the pre, so neither its chrome nor the header reaches the clipboard. Inline code and Bash tool rows are unchanged. Copy the existing glyph verbatim rather than introduce an icon API or change its consumers.

Add a copyable modifier and scoped styles in `conversation.css`: relative block, bottom-right button, reserved right gutter, existing theme ink/hover/focus tokens. Preserve the existing body padding vertically and language header behavior. Update the renderer's security comment to distinguish client-owned copy controls from source-authored form controls.

## State, concurrency and errors

Only a local DOM ref is added; no store state, subscriptions or long-lived work. Capture text synchronously before awaiting the one-shot clipboard write. Preserve the helper's false result and content-free failure handling; emit `code-block-copy` outcomes through `window.pyry.sendDiagnostic`, with static `copied`, `failed` or `missing-code` codes. No clipboard reads in production and no confirmation state.

## Testing strategy

- RED static assertion: one native, labelled button per headed/headerless block, none for inline code; hostile literal code remains escaped.
- Fake-transport Playwright: multiple distinct blocks in one reply; actual pointer clicks and keyboard Enter/Space; OS clipboard equals independently specified strings including indentation, blank lines, literal markup/entities and trailing newline. Seed a known non-secret sentinel before each copy.
- Check focus-visible styling and non-overlap at wide and 800px window widths, including long wrapped code. Capture synthetic headed/headerless blocks for visual comparison with Figma.
- Run touched renderer/helper unit tests, build, and the focused new e2e spec only.

## Scope check

One deliverable, three acceptance criteria. Two production files (one TSX, one CSS), one unit test and one e2e spec plus this plan; estimated 300 written lines, no new exports, no consumer call-site updates, and no state machine. The #969 clipboard helper/test/e2e analogue totals 319 added lines. Codegraph is uninitialized; repository reads supplied the map. Refreshed all remote feature branches: no overlaps on planned files.

## Documentation handoff

Pending documentation stage: no explicit documentation requirement in the ticket. Update `docs/knowledge/features/assistant-markdown-renderer.md`, sections “How it works” and “Edge cases”, for `CodeBlock`, block-local clipboard copying and the client-owned control exception.

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries / hostile daemon: code remains untrusted text. `CodeBlock` reads only its own code text; React escaping and the existing no-raw-HTML parser remain intact. Labels, classes, SVG and diagnostics are client-owned constants.
- Clipboard egress: an explicit user activation writes only `text/plain` via `copyMessageText`; no HTML flavor, auto-copy, clipboard read, execution or URL navigation. Literal malicious shell/HTML text is copied verbatim by design, never executed by the app.
- Electron attack surface: no new IPC or permission changes. Existing sanitized clipboard-write permission and renderer isolation remain the boundary; task-list inputs remain inert.
- Logs/errors: only static outcome codes enter the shared diagnostic pipe. No text, header language or caught error object is logged. The existing helper handles refusal without UI exceptions.
- Tokens/storage/crypto/network: no credentials, persistent storage, crypto or network operations are introduced; transport and keys remain in main.
- Concurrency: capture text before awaiting; no later DOM read, state update, timer or subscription can outlive unmount.
- No MUST FIX, SHOULD FIX or deferred security findings.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-19
