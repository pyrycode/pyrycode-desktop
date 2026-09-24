import { describe, it, expect } from 'vitest'
import type { UsageLimitReading } from '../../store/usageLimitStore'
import {
  isUsageReadingDismissed,
  usageLimitNotice,
  USAGE_LIMIT_EXHAUSTED_COPY,
  USAGE_LIMIT_WARNING_COPY
} from './usageLimitNotice'

// #1321 — the copy and treatment mapping, proven without rendering anything (the `messageTime.test.ts`
// posture, and the reason that module exists as a module).
//
// EVERY MOMENT IS BUILT LOCALLY, as the inverse of the production getters, because the formatter uses
// local getters and nothing in this repo pins a time zone — `messageTime.test.ts`'s recorded answer to
// exactly this flakiness. A UTC literal would assert one string on a UTC runner and another in Helsinki.
const secondsAt = (y: number, m: number, d: number, h: number, min: number): number =>
  Math.floor(new Date(y, m - 1, d, h, min, 0, 0).getTime() / 1000)

// The reading under test — a builder, so each case names only the field it varies and the untouched
// fields cannot drift between cases.
const reading = (over: Partial<UsageLimitReading> = {}): UsageLimitReading => ({
  status: 'rejected',
  limitType: 'five_hour',
  resetsAt: 0,
  ...over
})

const NOW = secondsAt(2026, 9, 9, 13, 55)

describe('usageLimitNotice — the treatment (#1321, AC1/AC2)', () => {
  // AC1. `rejected` is THE ONE string that earns the exhausted wording, and the whole design rests on
  // that being an exact equality rather than a family test.
  it('gives `rejected` the exhausted treatment and lead', () => {
    const notice = usageLimitNotice(reading({ status: 'rejected' }), NOW)
    expect(notice.treatment).toBe('exhausted')
    expect(notice.text.startsWith(USAGE_LIMIT_EXHAUSTED_COPY)).toBe(true)
  })

  // AC2, and the failure mode the ticket exists to avoid. `allowed_warning` is the ONLY non-benign
  // status ever captured live (2026-08-22, claude 2.1.239) and every turn still ran normally in it; the
  // empty status is the daemon's cut-to-nothing case; the invented one stands for the four documented
  // values and for whatever claude ships next. NONE of them may claim the operator is blocked.
  it.each(['allowed_warning', '', 'some_status_nobody_has_measured', 'REJECTED', 'rejected_'])(
    'gives %o the warning treatment and lead — never the exhausted one',
    (status) => {
      const notice = usageLimitNotice(reading({ status }), NOW)
      expect(notice.treatment).toBe('warning')
      expect(notice.text.startsWith(USAGE_LIMIT_WARNING_COPY)).toBe(true)
      expect(notice.text).not.toContain(USAGE_LIMIT_EXHAUSTED_COPY)
    }
  )

  // AC2's "same wording" half, asserted by CONSTRUCTION rather than by two hand-written expectations:
  // swap only the status and the two texts must differ by exactly their leads. A drifting implementation
  // that reworded the window or reset clause per treatment fails here and nowhere else.
  it('differs between the two treatments by the lead alone', () => {
    const base = { limitType: 'seven_day', resetsAt: secondsAt(2026, 9, 12, 8, 30) }
    const exhausted = usageLimitNotice(reading({ ...base, status: 'rejected' }), NOW)
    const warning = usageLimitNotice(reading({ ...base, status: 'allowed_warning' }), NOW)
    expect(exhausted.text.slice(USAGE_LIMIT_EXHAUSTED_COPY.length)).toBe(
      warning.text.slice(USAGE_LIMIT_WARNING_COPY.length)
    )
    expect(exhausted.text).not.toBe(warning.text)
  })
})

describe('usageLimitNotice — the window clause (#1321, AC1/AC3)', () => {
  it('names the five-hour window in plain words', () => {
    expect(usageLimitNotice(reading({ limitType: 'five_hour' }), NOW).text).toContain('5-hour window')
  })

  it('names the seven-day window in plain words', () => {
    expect(usageLimitNotice(reading({ limitType: 'seven_day' }), NOW).text).toContain('7-day window')
  })

  // AC3. The four other documented values fall to the unnamed arm deliberately — unnamed is ORDINARY
  // here, not an error — and so does the daemon's cut-to-nothing empty string.
  it.each(['seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage', ''])(
    'leaves the window unnamed for %o, and still leads',
    (limitType) => {
      const notice = usageLimitNotice(reading({ limitType }), NOW)
      expect(notice.text).toBe(USAGE_LIMIT_EXHAUSTED_COPY)
      expect(notice.text).not.toContain('window')
    }
  )

  // THE `Map`-NOT-`Record` GUARANTEE, and the sharpest edge in this module. `limitType` is untrusted
  // claude-authored text used as a lookup key: against a `Record<string, string>` or an object literal,
  // `'constructor'` resolves to the Object constructor and `'__proto__'` to Object.prototype — both
  // non-`undefined`, so a `=== undefined` miss test passes them straight through into the rendered text.
  // `Map.prototype.get` performs no prototype-chain lookup, so all three are ordinary misses BY
  // CONSTRUCTION. A swap to `Record` breaks exactly this test and no other.
  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
    'treats the hostile key %o as an ordinary miss — no object or function text escapes',
    (limitType) => {
      const notice = usageLimitNotice(reading({ limitType }), NOW)
      expect(notice.text).toBe(USAGE_LIMIT_EXHAUSTED_COPY)
      for (const leak of ['[object', 'function', 'undefined', 'native code', 'Object']) {
        expect(notice.text).not.toContain(leak)
      }
    }
  )
})

describe('usageLimitNotice — the reset clause (#1321, AC1/AC3)', () => {
  // AC3's headline. `0` means claude reported NO reset — emphatically not the epoch — so the clause is
  // dropped rather than formatted. The `1970` assertion is what an implementation folding the zero into
  // the comparison fails on.
  it('drops the reset clause entirely when `resetsAt` is 0', () => {
    const notice = usageLimitNotice(reading({ resetsAt: 0 }), NOW)
    expect(notice.text).toBe(`${USAGE_LIMIT_EXHAUSTED_COPY} - 5-hour window`)
    expect(notice.text).not.toContain('1970')
    expect(notice.text).not.toContain('resets')
  })

  // AC1's same-day half. A five-hour window resets within the day, and repeating today's date there
  // would be noise.
  it('renders a same-day reset as a bare time of day', () => {
    const notice = usageLimitNotice(
      reading({ limitType: 'five_hour', resetsAt: secondsAt(2026, 9, 9, 18, 5) }),
      NOW
    )
    expect(notice.text).toBe(`${USAGE_LIMIT_EXHAUSTED_COPY} - 5-hour window, resets 18:05`)
  })

  // AC1's carried-day half, and the reason the day is conditional at all: a seven-day window resets days
  // out, so a bare `08:30` would read as "later today" and mislead.
  it('carries the day when the reset is not on the day the notice is read', () => {
    const notice = usageLimitNotice(
      reading({ limitType: 'seven_day', resetsAt: secondsAt(2026, 9, 12, 8, 30) }),
      NOW
    )
    expect(notice.text).toBe(
      `${USAGE_LIMIT_EXHAUSTED_COPY} - 7-day window, resets 12.09.2026 at 08:30`
    )
  })

  // The day boundary is a LOCAL calendar-day comparison, not a 24-hour window: one minute past midnight
  // is another day and carries its date, even though it is minutes away. An implementation subtracting
  // and comparing against 86400 passes every other case here and fails this one.
  it('carries the day for a reset minutes away across local midnight', () => {
    const lateNight = secondsAt(2026, 9, 9, 23, 58)
    const notice = usageLimitNotice(
      reading({ limitType: 'seven_day', resetsAt: secondsAt(2026, 9, 10, 0, 3) }),
      lateNight
    )
    expect(notice.text).toContain('resets 10.09.2026 at 00:03')
  })

  // DEFENSIVE FORMATTING, and this arm is reachable through the wire rather than hypothetical.
  // `resets_at` is claude's own number, unvalidated in both directions upstream, so an absurd magnitude
  // decodes, passes `selectUsageLimitFor`'s `nowSeconds < resetsAt` test as READABLE, and reaches here.
  // `new Date` of it is an Invalid Date whose getters all yield NaN, which would render `NaN.NaN.NaN`.
  it.each([1e18, Number.MAX_SAFE_INTEGER, -1e18])(
    'drops the clause for an unrepresentable reset instant %o rather than rendering NaN',
    (resetsAt) => {
      const notice = usageLimitNotice(reading({ limitType: 'five_hour', resetsAt }), NOW)
      expect(notice.text).toBe(`${USAGE_LIMIT_EXHAUSTED_COPY} - 5-hour window`)
      expect(notice.text).not.toContain('NaN')
    }
  )

  // The instant enters in UNIX SECONDS on BOTH parameters, matching `selectUsageLimitFor`'s. One unit
  // across the slice is what closes the millisecond trap that selector's docblock names. Pinned by
  // giving the same wall-clock moment in seconds and watching the same-day arm fire; a formatter reading
  // milliseconds would place this reset in 1970 and carry a date.
  it('reads both instants as unix seconds, not milliseconds', () => {
    const notice = usageLimitNotice(
      reading({ limitType: 'five_hour', resetsAt: secondsAt(2026, 9, 9, 14, 0) }),
      NOW
    )
    expect(notice.text).toContain('resets 14:00')
    expect(notice.text).not.toContain('1970')
  })
})

describe('usageLimitNotice — no daemon-authored string reaches the text (#1321, AC3)', () => {
  // THE DISCHARGE of the constraint `usageLimitStore` inherited, pinned with sentinels on the one arm
  // that reads BOTH untrusted strings rather than trusted by argument. Neither value may appear, in any
  // casing, whole or in part.
  it('never emits `status` or `limitType`, on either treatment', () => {
    for (const status of ['rejected', 'DAEMON_STATUS_SENTINEL']) {
      const notice = usageLimitNotice(
        reading({ status, limitType: 'DAEMON_LIMIT_SENTINEL', resetsAt: 0 }),
        NOW
      )
      expect(notice.text).not.toContain('DAEMON_STATUS_SENTINEL')
      expect(notice.text).not.toContain('DAEMON_LIMIT_SENTINEL')
      expect(notice.text).not.toContain('SENTINEL')
    }
  })

  // The whole output is drawn from client-owned constants plus a formatted instant, so a markup-shaped
  // value in either field cannot become markup, an entity or an attribute-breaking run downstream.
  it('emits no angle bracket, quote or ampersand for a markup-shaped reading', () => {
    const notice = usageLimitNotice(
      reading({ status: '<img src=x onerror=alert(1)>', limitType: '"><script>', resetsAt: 0 }),
      NOW
    )
    expect(notice.text).toBe(USAGE_LIMIT_WARNING_COPY)
  })
})

// #1604 — the pill variant follows DISMISSIBILITY, not wording: exactly `allowed_warning` is the Default
// pill with an X, and every other status (the exhausted one and the unrecognised ones that still read as
// a warning) is the Error pill. Exact equality, so no near-miss of the one string earns the X.
describe('usageLimitNotice — the pill variant (#1604)', () => {
  it('gives exactly `allowed_warning` the default variant', () => {
    expect(usageLimitNotice(reading({ status: 'allowed_warning' }), NOW).variant).toBe('default')
  })

  it.each(['rejected', 'allowed_warning ', 'ALLOWED_WARNING', 'allowed', '', 'DAEMON_STATUS_SENTINEL'])(
    'gives %j the error variant',
    (status) => {
      expect(usageLimitNotice(reading({ status }), NOW).variant).toBe('error')
    }
  )

  // Colour follows dismissibility while the WORDING keeps its own rule: an unrecognised status is an
  // Error pill that still reads as a warning.
  it('keeps the warning wording on an error pill for an unrecognised status', () => {
    const notice = usageLimitNotice(reading({ status: 'something_new' }), NOW)
    expect(notice.variant).toBe('error')
    expect(notice.text.startsWith(USAGE_LIMIT_WARNING_COPY)).toBe(true)
  })
})

// #1604 — the dismissal comparison: field by field, exact, and never through a composite key.
describe('isUsageReadingDismissed (#1604)', () => {
  const warning = reading({ status: 'allowed_warning', limitType: 'seven_day', resetsAt: 4_102_444_800 })

  it('is false with nothing dismissed', () => {
    expect(isUsageReadingDismissed(warning, null)).toBe(false)
  })

  it('is true for an equal triple held as a different object', () => {
    expect(isUsageReadingDismissed(warning, { ...warning })).toBe(true)
  })

  it.each([
    ['status', { status: 'rejected' }],
    ['limitType', { limitType: 'five_hour' }],
    ['resetsAt', { resetsAt: 4_102_444_801 }]
  ] as const)('is false when only %s differs', (_field, change) => {
    expect(isUsageReadingDismissed({ ...warning, ...change }, warning)).toBe(false)
  })

  // Exact, not normalised: a trimmed or case-folded comparison would hide a reading the operator never
  // dismissed. Also the composite-key trap — joined, these two triples would collide.
  it('does not normalise and does not collide across field boundaries', () => {
    expect(isUsageReadingDismissed({ ...warning, status: 'allowed_warning ' }, warning)).toBe(false)
    expect(isUsageReadingDismissed(
      { status: 'a|b', limitType: 'c', resetsAt: 1 },
      { status: 'a', limitType: 'b|c', resetsAt: 1 }
    )).toBe(false)
  })
})
