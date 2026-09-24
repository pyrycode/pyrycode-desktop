/**
 * #969 — put a message's own text on the OS clipboard, for the copy control in the bubble's meta row.
 *
 * A pure-ish helper beside `composerSend` / `dropQueuedMessage`, for the same reason those exist: the
 * renderer test tier is static server renders with no DOM and no click, so an effect reachable only
 * from an `onClick` would otherwise be unprovable. Here it is one function with one sink, and
 * copyMessageText.test.ts pins exactly what reaches that sink.
 *
 * The caller passes the thread item's own `text` — the string the store coalesced from the daemon's
 * assistant_delta frames, upstream of AssistantMarkdown. That is what makes AC3's "the markdown source,
 * not the rendered DOM" a property of WHERE the value is read rather than of any un-rendering step
 * here; this helper only passes it through.
 *
 * SECURITY POSTURE. The value is relay-peer-authored and this is a new egress path out of the app, so
 * three things are deliberate:
 *   - `writeText` writes text/plain only, so no HTML flavour reaches the clipboard from this helper
 *     even when the source carries markup. (The window's `clipboard-sanitized-write` grant itself is
 *     wider — #1630 measured it covering the async `write` with `text/html` — and `copyRichText` below
 *     is the one caller of that.)
 *   - The text reaches no log, no attribute, no URL and no cache key (CLAUDE.md's 2026-08-20 ruling).
 *     The failure log is an EVENT NAME alone: not the text, and not the caught error either. That is
 *     questionResolution's posture rather than composerSend's `console.error(msg, error)` — a
 *     DOMException's message does not carry the value today, and this must not depend on that holding
 *     across Chromium versions.
 *   - Length is already bounded upstream: parseInboundMessage enforces MAX_PLAINTEXT_BYTES on the
 *     decrypted envelope before any of this text reaches the store, so there is no cap to restate here
 *     and a second one would be a drifting source of truth.
 *
 * Returns whether the text landed, and NEVER throws or propagates: a failed copy must not crash the
 * thread. Nothing surfaces in the UI on either outcome — the drawing shows no confirmation after a
 * copy, and so no failure state either.
 */
export async function copyMessageText(text: string): Promise<boolean> {
  // `navigator.clipboard` is undefined on an insecure origin and `navigator` itself is absent outside a
  // browser context, so both are guarded rather than assumed. A `typeof` check on the method (not an
  // `=== undefined` on the object) narrows through the optional chain without asserting a type the
  // runtime has not shown us.
  const clipboard = globalThis.navigator?.clipboard
  if (typeof clipboard?.writeText !== 'function') return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    console.error('message copy failed')
    return false
  }
}

/**
 * #1630 — the markdown reader's Copy as HTML: one clipboard item carrying `html` as text/html and `text`
 * as its text/plain fallback, through the async `navigator.clipboard.write`.
 *
 * MEASURED, not assumed: in the built app the existing `clipboard-sanitized-write` grant (src/main/index.ts)
 * lets this write through, and the main process reads both flavours back. So there is no IPC route and
 * no widened permission. Chromium sanitizes the HTML flavour on this write as well, but the caller's
 * HTML is already inert by construction (`markdownHtml` renders through AssistantMarkdown); the
 * sanitizer is a second fabric, not the one relied on.
 *
 * The posture is `copyMessageText`'s: feature-checked rather than assumed, never throws, and a failure
 * logs an event name alone — never the strings and never the caught error.
 */
export async function copyRichText({ html, text }: { html: string; text: string }): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard
  if (typeof clipboard?.write !== 'function' || typeof globalThis.ClipboardItem !== 'function') return false
  try {
    await clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ])
    return true
  } catch {
    console.error('rich copy failed')
    return false
  }
}
