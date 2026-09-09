// #1321 — claude's usage-window reading turned into the one line the composer status row draws, plus
// which of the row's two colour treatments it wears. `ComposerUsageLimitNotice` in ConversationScreen.tsx
// is its only consumer.
//
// A REACT-FREE MODULE beside `messageTime`, for the same reason that one exists: the exact characters are
// pinnable without rendering anything, and the whole of the ticket's untrusted-text discipline is then a
// property of one small pure function rather than of a component's JSX.
//
// THIS SLICE DISCHARGES THE "NO DOM SINK" CONSTRAINT `usageLimitStore` INHERITED. `status` and `limitType`
// are claude-authored open strings that crossed the subprocess trust boundary; the daemon bounds them at
// construction and does not sanitize them, so they are untrusted, model-influenced text here. They are
// read ONLY AS LOOKUP KEYS FOR THE CLIENT-OWNED COPY BELOW — never interpolated into the returned text,
// never into the class the view picks, never an authorization signal, never a filename, a cache key, a
// lookup path, an attribute or a URL, and never logged. That is structural rather than conventional: no
// branch of `usageLimitNotice` can reach either string, which is what the sentinel-valued tests pin.
//
// NOTHING HERE IS EVER LOGGED, and there is deliberately no diagnostic seam — not even a content-free
// count of an unrecognised value. `usageLimitStore`'s reason applies unchanged and is stronger at a
// rendering surface: the pair discloses the ACCOUNT'S QUOTA POSTURE, a fact about the operator rather
// than about the frame, and a count is the first crack in a property that has to be total.
//
// NOTHING IS SCHEDULED, ALLOCATED OR ITERATED FROM `resetsAt`. The arm's docblock names that hazard
// precisely: a delay computed from it is either negative (fires immediately, and spins if the handler
// re-arms) or past `setTimeout`'s ~24.8-day clamp, which ALSO fires immediately rather than never. The
// expiry is `selectUsageLimitFor`'s one comparison, performed when the container renders, so an expired
// reading leaves the row on the next render rather than on a tick.
import type { UsageLimitReading } from '../../store/usageLimitStore'

/**
 * The exhausted lead — the ONE wording that tells the operator they are blocked, and it is reserved for
 * the one status that means it.
 *
 * Client-owned and exported so the tests and the sibling constant below can be compared without
 * re-typing the characters, in `COMPOSER_ERROR_CHIP_COPY`'s posture one module over. The two leads SHARE
 * THE WORDS "usage limit" and neither is a SUBSTRING of the other, which is the property an e2e
 * `toContainText` on either lead relies on: a containment locator tells the arms apart only if the shorter
 * string cannot be found inside the longer one, and shared words in the middle are harmless to that.
 */
export const USAGE_LIMIT_EXHAUSTED_COPY = 'Usage limit reached'

/**
 * The warning lead, and THE REASON THIS MODULE HAS TWO. The status set is open and unmeasured beyond
 * `allowed_warning` — the single live capture (2026-08-22, claude 2.1.239, `limit_type: seven_day`), a
 * weekly band in which EVERY TURN STILL RAN NORMALLY — and `RateLimitedPayload`'s docblock names "you are
 * rate limited" as THE realistic client bug. So an unrecognised status takes this arm: the cost of
 * under-claiming is one softly-worded row, the cost of over-claiming is telling an operator they are
 * blocked while their turns keep working. The daemon emits on any non-benign status precisely so a new
 * value SURFACES rather than vanishing, and this is where that value surfaces without being overread.
 */
export const USAGE_LIMIT_WARNING_COPY = 'Nearly at usage limit'

/**
 * The one status that earns `USAGE_LIMIT_EXHAUSTED_COPY`, matched on EXACT EQUALITY — never a prefix,
 * substring, case-folded or trimmed test. `usageLimitBridge`'s comparison against the benign status
 * carries the mirror-image warning and the same sharp edge applies here: a family test would pull
 * `rejected_something_new` into the exhausted arm, which is the exact overclaim the two-lead design
 * exists to prevent.
 *
 * Module-private: nothing outside decides this, and exporting it would invite a second decision point.
 */
const EXHAUSTED_STATUS = 'rejected'

/**
 * The two windows ever observed, in plain words.
 *
 * A `ReadonlyMap`, AND `Record<string, string>` IS FORBIDDEN HERE — `usageLimitStore`'s own
 * `Map`-not-`Record` rule, carried down to the second container in the slice rather than assumed to
 * travel with the data. `limitType` is untrusted: against a `Record` or an object literal,
 * `'constructor'` resolves to the `Object` constructor and `'__proto__'` to `Object.prototype`, both
 * NON-`undefined`, so the `=== undefined` miss test below passes them straight through and a function's
 * source or `[object Object]` lands in the status row. `Map.prototype.get` performs no prototype-chain
 * lookup, so those keys are ordinary misses BY CONSTRUCTION rather than by validation. Pinned by a test
 * naming all three; a swap to `Record` breaks exactly that test and no other.
 *
 * The four other documented values — `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`,
 * `overage` — deliberately fall to the unnamed arm rather than getting invented copy, and so does the
 * daemon's cut-to-nothing empty string. UNNAMED IS ORDINARY HERE, NOT AN ERROR: two observations do not
 * earn an enum, and the decoder applies no membership check upstream for the same reason.
 */
const WINDOW_COPY: ReadonlyMap<string, string> = new Map([
  ['five_hour', '5-hour window'],
  ['seven_day', '7-day window']
])

/** What the view needs: which treatment to wear, and the one line to draw.
 *
 *  `treatment` is a CLIENT-OWNED UNION, decided here and nowhere else, so the view picks a class without
 *  re-testing the status — which is what keeps the untrusted string out of a `className` as well as out
 *  of the text. */
export interface UsageLimitNotice {
  treatment: 'exhausted' | 'warning'
  text: string
}

/** Two digits, the `formatMessageTime` idiom. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The reset clause's instant, or `null` when there is none to render.
 *
 * LOCAL GETTERS, NOT UTC, and NO `Intl` / `toLocaleString` / `toLocaleDateString` — `formatMessageTime`'s
 * discipline verbatim. Those would put the runner's locale into the output, which is neither a stable
 * string to assert nor the shape the rest of the app draws. The flakiness that trade-off invites is
 * answered on the TEST side, by constructing every expected moment locally.
 *
 * THE DAY IS CARRIED ONLY WHEN THE RESET IS NOT ON THE DAY THE NOTICE IS READ, which is the one shape
 * `formatMessageTime` does not have and the reason this is a separate function rather than a call to it.
 * A seven-day window resets days out, so a bare `08:30` would read as "later today" and mislead; a
 * five-hour window resets within the day, where repeating today's date is noise. The comparison is on the
 * three LOCAL calendar fields and NOT on a 24-hour difference: one minute past midnight is another day
 * and carries its date, which a subtract-and-compare-against-86400 implementation gets wrong.
 *
 * TWO `null` ARMS, BOTH REACHABLE THROUGH THE WIRE:
 *
 *   - `resetsAt === 0` means claude reported NO reset instant — emphatically not the epoch. Tested FIRST
 *     and separately, so it can never be formatted as 1970.
 *   - An UNREPRESENTABLE instant. `resets_at` is claude's own number, unvalidated in both directions
 *     upstream: a magnitude past `Date`'s ±8.64e15 ms range decodes, passes `selectUsageLimitFor`'s
 *     `nowSeconds < resetsAt` test as READABLE, and reaches here, where `new Date` yields an Invalid Date
 *     whose every getter is `NaN` and would render `NaN.NaN.NaN`. The guard is on the CONSTRUCTED DATE
 *     rather than a range check on the input, because the date is the thing that can actually be
 *     malformed — and it covers `NaN` and the negative magnitude in the same test.
 *
 * BOTH PARAMETERS ARE UNIX SECONDS, matching `selectUsageLimitFor`'s `nowSeconds`. One unit across the
 * whole slice is what closes the trap that selector's docblock names: a caller handing it a millisecond
 * `Date.now()` expires every reading on arrival with no type error and no symptom beyond "nothing ever
 * shows". Pinned by a test.
 */
function formatResetInstant(resetsAtSeconds: number, nowSeconds: number): string | null {
  if (resetsAtSeconds === 0) return null
  const at = new Date(resetsAtSeconds * 1000)
  const now = new Date(nowSeconds * 1000)
  if (Number.isNaN(at.getTime()) || Number.isNaN(now.getTime())) return null

  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  const sameLocalDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  if (sameLocalDay) return time

  // `getMonth` is zero-based; every other getter here is not. The year is padded for completeness rather
  // than for any instant claude can report — the shape is `formatMessageTime`'s, with ` at ` rather than
  // its ` - ` separator, so the row does not print two hyphens once the window clause is in front.
  return `${pad2(at.getDate())}.${pad2(at.getMonth() + 1)}.${String(at.getFullYear()).padStart(4, '0')} at ${time}`
}

/**
 * The reading, as the one line the status row draws and the treatment it wears.
 *
 * TOTAL ON EVERY INPUT: no throw, no reject branch, and every absence is a VALUE rather than an error.
 * Three runs are composed in a fixed order and only the first is unconditional —
 *
 *   lead      always            the treatment's client-owned copy
 *   window    on a `Map` hit    omitted for any `limitType` outside the two observed values
 *   reset     on a formatted    omitted when claude reported none, or when the instant is unrepresentable
 *             instant
 *
 * — so the four combinations are `Usage limit reached`, `… - 5-hour window`, `…, resets 18:05` and the
 * full `Usage limit reached - 7-day window, resets 12.09.2026 at 08:30`, with the warning lead
 * substituted verbatim on the other treatment. The two treatments' texts differ BY THE LEAD ALONE, which
 * a test asserts by construction rather than by two hand-written expectations.
 *
 * The result is drawn ENTIRELY from the client-owned constants above plus a formatted instant, so there
 * is nothing here to escape, length-bound or newline-strip and nothing that can be forgotten: a
 * markup-shaped `status` or `limitType` cannot become markup downstream because it never becomes text at
 * all. See the module header for the full denied-sink list this discharges.
 */
export function usageLimitNotice(reading: UsageLimitReading, nowSeconds: number): UsageLimitNotice {
  const exhausted = reading.status === EXHAUSTED_STATUS
  const window = WINDOW_COPY.get(reading.limitType)
  const reset = formatResetInstant(reading.resetsAt, nowSeconds)
  return {
    treatment: exhausted ? 'exhausted' : 'warning',
    text: [
      exhausted ? USAGE_LIMIT_EXHAUSTED_COPY : USAGE_LIMIT_WARNING_COPY,
      window === undefined ? '' : ` - ${window}`,
      reset === null ? '' : `, resets ${reset}`
    ].join('')
  }
}
