// The ONE allowlist of link targets the app hands to the operating system. Both sides import it: the
// renderer's markdown `a` override decides whether an anchor exists at all, and the main process's
// window-open handler decides whether `shell.openExternal` runs. One function means the two can never
// disagree, which is what made a link that renders live but does nothing on click (or the reverse)
// possible when each side kept its own copy. No `electron` and no DOM import, so both tsconfigs and the
// node test tier can load it.
//
// Two shapes are allowed and NOTHING ELSE: an absolute http/https URL carrying an authority, and an
// Obsidian `open` link with read-only parameters. Every other scheme stays denied (`javascript:`,
// `data:`, `file:`, `mailto:`, any custom protocol handler), because a hostile reply must not be able
// to fire an arbitrary handler on the operator's machine. Widening this file is a security change.

/**
 * An absolute http/https URL, authority and all. Anchored, with no quantified group to backtrack on, so
 * it carries no ReDoS exposure on an unbounded daemon-supplied href.
 */
const ABSOLUTE_WEB_URL = /^https?:\/\//i

/**
 * `obsidian://open`, optionally followed by a query, and nothing else: no userinfo, no port, no path and
 * NO FRAGMENT. Obsidian parses the part after `#` into handler parameters as well, so a fragment is a
 * second query this file cannot see. The `i` flag is for the scheme only; the action's case is checked
 * separately against the parsed host. One quantifier anchored at both ends, nothing to backtrack on.
 */
const OBSIDIAN_OPEN_URL = /^obsidian:\/\/open(?:\?[^#]*)?$/i

/**
 * The `open` action's read-only parameters, exactly as Obsidian documents them. The action ALSO accepts
 * `prepend` and `append`, which write text into the note and merge its properties, so those are absent
 * on purpose: a click must never write to the vault. Obsidian puts the action and the query keys into
 * one object, so `action` is absent too, or a query could rename the action.
 */
const OBSIDIAN_OPEN_PARAMS: ReadonlySet<string> = new Set(['vault', 'file', 'path', 'paneType'])

/**
 * An encoded `&` or `#`. A parser that decodes the query before splitting it would turn either into a
 * real separator and see a key this check never saw, so a value carrying one is refused rather than
 * trusted to be parsed the way `URLSearchParams` parses it.
 */
const ENCODED_SEPARATOR = /%(?:26|23)/i

/** True when every query key is one of the read-only `open` parameters, compared raw and exactly. */
function hasOnlyReadOnlyOpenParams(query: string): boolean {
  if (ENCODED_SEPARATOR.test(query)) return false
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const equals = pair.indexOf('=')
    const key = equals === -1 ? pair : pair.slice(0, equals)
    if (!OBSIDIAN_OPEN_PARAMS.has(key)) return false
  }
  return true
}

/**
 * The href VERBATIM when it is a link the app may open outside itself; null otherwise.
 *
 * It FAILS CLOSED: every shape that is not an allowed link returns null, and the caller renders the link
 * as its visible text or opens nothing. Nothing is logged: the value is untrusted daemon text and the
 * repo's diagnostics are content-free (#126).
 *
 * The RETURN IS THE ORIGINAL STRING, never `url.href`. The parser normalises (a trailing slash on
 * `https://example.com`, punycode for a non-ASCII host), and an allowed link carries its href unchanged.
 * The parse decides; the original renders.
 */
export function allowedLinkHref(href: string | undefined): string | null {
  if (href === undefined) return null
  let url: URL
  try {
    // NO BASE ARGUMENT, and that is the reject-without-resolving rule rather than an omission: every
    // relative, protocol-relative, empty and unparseable href throws right here. Resolving instead would
    // make the same reply behave differently under the dev server (an http: base) and a packaged build
    // (a file: base).
    url = new URL(href)
  } catch {
    return null
  }
  // `protocol` is lowercased by the parser, so `HTTPS:` and `OBSIDIAN:` match by construction.
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    // THE BASE-INDEPENDENCE GUARD, not a second scheme check: `http:example.com` parses absolutely with
    // an allowed protocol but no authority, and the browser would resolve it against the document base.
    return ABSOLUTE_WEB_URL.test(href) ? href : null
  }
  if (url.protocol === 'obsidian:') {
    // The host of a non-special URL keeps its case, so this compares the action EXACTLY. `OPEN` and
    // `Open` are refused rather than trusted to fold to `open` inside Obsidian; Obsidian itself always
    // writes the lowercase form.
    if (url.host !== 'open' || !OBSIDIAN_OPEN_URL.test(href)) return null
    // The RAW query, sliced from the original string, not the parser's re-encoded `search`.
    const query = href.indexOf('?')
    return hasOnlyReadOnlyOpenParams(query === -1 ? '' : href.slice(query + 1)) ? href : null
  }
  return null
}
