/**
 * #1014 — bound a message bubble's text exactly, with its meta-row timestamp admitted as a shape.
 *
 * WHY THIS EXISTS. `BubbleMeta` is the last child of `.bubble` on both the assistant and the user branch,
 * and Playwright's `toHaveText(string)` asserts the element's ENTIRE normalized text. The running app
 * injects a clock on both sides (`useTimelineBridge`'s `Date.now` argument, and the composer's `now`
 * dep), and the fake tier launches that same built app — so every bubble in this suite really does carry
 * a stamp, and every `toHaveText` over a whole bubble now reads `"…13.01.2026 - 13:55"`.
 *
 * WHY NOT `toContainText`. A blanket swap would turn those sites green while deleting what several of
 * them prove: `send-and-stream.spec.ts` says in its own comment that its assistant assertion is the guard
 * against the default-echo trap and depends on matching `REPLY_TEXT` exactly; `assistant-whitespace`'s
 * gate is deliberately the one whitespace-free text in that file so `toHaveText`'s normalisation cannot
 * make the wait vacuous; `thread-scroll-pin`'s three `.last()` assertions pin WHICH turn arrived and
 * would accept turn 20 where turn 21 was required. Every one of those is a containment away from vacuity.
 *
 * WHAT THIS DOES INSTEAD. The message text stays exactly bounded and only the timestamp is relaxed, from
 * a value to a digit shape. `toHaveText` tests a `RegExp` against the same normalized text it compares a
 * string to, so an ANCHORED pattern is still an exact assertion: the text may not be a prefix of
 * something longer, may not be missing a character, and the only thing admitted after it is one
 * well-formed timestamp.
 */

/**
 * The `DD.MM.YYYY - HH:MM` the meta row draws (Figma 132:4477), as regex source. A SHAPE, not a value —
 * the time a bubble is stamped with is whenever the test ran. Deliberately not `.*`: a pattern that
 * accepted anything after the message text would re-admit the vacuity this module exists to prevent.
 */
export const BUBBLE_META_TIME = String.raw`\d{2}\.\d{2}\.\d{4} - \d{2}:\d{2}`

/** Escape a literal for use inside a `RegExp` — the message texts here include `/clear` and `/compact`. */
const escapeRegExp = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * An anchored matcher for a whole message bubble: exactly `text`, then its meta-row timestamp, then
 * nothing. Drop-in for a `toHaveText(string)` over a `.bubble` locator.
 *
 * The `\s*` is deliberate and costs nothing. Playwright's text walk concatenates descendant text without
 * inserting a separator, so nothing is expected between the message text and the timestamp — but the meta
 * row is a block-level boundary, and the pattern should not depend on that walk's treatment of one.
 * Whitespace is already normalized to single spaces by the time the pattern is tested.
 */
export function bubbleTextExactly(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}\\s*${BUBBLE_META_TIME}$`)
}
