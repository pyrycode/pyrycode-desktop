import { describe, it, expect, afterEach, vi } from 'vitest'
import { formatMessageTime } from './messageTime'

// #1014 — the meta row's timestamp, isolated from the row that renders it. The bubble half (which items
// carry the string, and that an unstamped one still emits the empty span) is ConversationScreen.test.tsx;
// what is proven here is the pure question the slot asks: given an epoch, exactly which characters.
//
// EVERY expected moment is built with `new Date(y, m, d, h, min)` — a LOCAL construction — and never a
// hardcoded epoch constant. Nothing in this repo pins a time zone (no `TZ=` in package.json or
// vitest.config.ts), and the formatter reads LOCAL getters on purpose, because the drawing's timestamp is
// the viewer's own wall clock. Local construction is the exact inverse of local getters, so each case
// below yields the same string on a runner in any zone. A literal epoch would pass here and fail an hour
// east: a given instant is MEANT to read differently in a different zone, and AC2's "no locale variation"
// asks for locale-independence, not zone-independence.
//
// The `channelListViewModel.formatLastActivity` precedent dodged the same flakiness by rendering in UTC.
// That option is not available here — UTC would show the wrong time to every user outside it.

/** Epoch milliseconds for a local wall-clock moment, the inverse of the getters under test. */
const localMs = (
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  ms = 0
): number => new Date(year, month1 - 1, day, hour, minute, second, ms).getTime()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('formatMessageTime — the message bubble timestamp (#1014)', () => {
  it('renders the drawing’s own moment as `13.01.2026 - 13:55`', () => {
    // Figma 132:4477's `Meta data` node, character for character: dot-separated date, one
    // space-hyphen-space, 24-hour time.
    expect(formatMessageTime(localMs(2026, 1, 13, 13, 55))).toBe('13.01.2026 - 13:55')
  })

  it('zero-pads a single-digit day, month, hour and minute — all four at once', () => {
    // The one case where every pad is exercised simultaneously; an unpadded implementation would emit
    // `5.3.2026 - 9:7` and fails on the first character.
    expect(formatMessageTime(localMs(2026, 3, 5, 9, 7))).toBe('05.03.2026 - 09:07')
  })

  it('reads the clock as 24-hour, from midnight to the last minute of the day', () => {
    // Midnight is the case a 12-hour formatter gets wrong twice over: it renders the hour as 12 and
    // needs a meridiem the drawing has no room for. 23:59 is the other end.
    expect(formatMessageTime(localMs(2026, 1, 1, 0, 0))).toBe('01.01.2026 - 00:00')
    expect(formatMessageTime(localMs(2026, 12, 31, 23, 59))).toBe('31.12.2026 - 23:59')
  })

  it('carries nothing below the minute — seconds and milliseconds do not reach the string', () => {
    // The stamp is `Date.now()`, so it always has a sub-minute component; the drawing shows none.
    const withTail = formatMessageTime(localMs(2026, 1, 13, 13, 55, 59, 999))
    expect(withTail).toBe('13.01.2026 - 13:55')
    expect(withTail).toBe(formatMessageTime(localMs(2026, 1, 13, 13, 55)))
  })

  it('pads the year to four digits', () => {
    // Not a moment any message can carry — `Date.now()` yields a four-digit year for the whole life of
    // this app. It is here because it is the only input that exercises the year pad, and untested
    // padding is padding that can be silently wrong.
    expect(formatMessageTime(localMs(999, 1, 13, 13, 55))).toBe('13.01.0999 - 13:55')
  })

  it('is pure — the same epoch yields the same string however often it is asked', () => {
    const epoch = localMs(2026, 7, 4, 16, 30)
    expect(formatMessageTime(epoch)).toBe(formatMessageTime(epoch))
    expect(formatMessageTime(epoch)).toBe('04.07.2026 - 16:30')
  })

  it('does not reach `toLocaleString` or `Intl` — the output carries no locale variation', () => {
    // AC2's second half, made falsifiable. Every other case in this file passes on the author's machine
    // for an `Intl`-based implementation with a hardcoded locale; only removing the locale machinery
    // from under the formatter tells the two apart. Each stub THROWS rather than returning a sentinel,
    // so a formatter that touched one fails loudly instead of drifting into a fallback.
    const refuse = (name: string) => (): never => {
      throw new Error(`${name} is not available to formatMessageTime`)
    }
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(refuse('toLocaleString'))
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(refuse('toLocaleDateString'))
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(refuse('toLocaleTimeString'))
    vi.stubGlobal(
      'Intl',
      new Proxy(
        {},
        {
          get: (_target, property) => refuse(`Intl.${String(property)}`)()
        }
      )
    )

    expect(formatMessageTime(localMs(2026, 1, 13, 13, 55))).toBe('13.01.2026 - 13:55')
  })
})
