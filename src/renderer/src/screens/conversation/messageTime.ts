/**
 * #1014 — format a message's creation moment for the timestamp slot in the bubble's meta row.
 *
 * A pure function in its own module beside `copyMessageText`, for the same reason that one exists: the
 * meta row's two halves are each provable at a different tier, and keeping the formatting out of the
 * component is what lets `messageTime.test.ts` pin the exact characters without rendering anything.
 * `ConversationScreen.tsx` is its only consumer.
 *
 * The shape is Figma 132:4477's `Meta data` node verbatim — `13.01.2026 - 13:55`: zero-padded day and
 * month, four-digit year, dot-separated; one space-hyphen-space; zero-padded 24-hour `HH:MM`. The
 * drawing carries the full date on every bubble, including on two a minute apart, so there is
 * deliberately NO relative or same-day short form here. That absence is also what makes this a plain
 * function rather than something a component has to keep fresh: the value names the message's own
 * creation moment, so it never goes stale and nothing has to re-render on a clock tick.
 *
 * LOCAL GETTERS, NOT UTC — and deliberately unlike `channelListViewModel.formatLastActivity`, whose
 * comment says it renders in UTC so its exact-string test cannot go flaky across runners. That trade is
 * not available here: the drawing's timestamp is the viewer's own wall clock, and UTC would show the
 * wrong time to every user outside it. Nothing in this repo pins a time zone, so the flakiness that
 * comment is about is real — it is answered on the TEST side instead, by constructing every expected
 * moment locally (the exact inverse of these getters). See the header of `messageTime.test.ts`.
 *
 * NO `toLocaleString` / `toLocaleDateString` / `Intl`. Those would put the runner's locale into the
 * output — a US-locale machine renders this instant as `1/13/2026, 1:55 PM` — which is neither the
 * drawing's format nor a stable string to assert. The spec removes all four from under this function and
 * asserts it still works, so the constraint is enforced rather than merely intended.
 *
 * TOTAL ON ITS DOCUMENTED INPUT, with no non-finite branch. The only producer of `createdAt` is
 * `Date.now` — the clock `useTimelineBridge` passes on the assistant side and the composer's `now` dep
 * passes on the user echo — so `NaN` and `Infinity` are not reachable, and a guard against them would be
 * an unobserved failure mode's defence. The case that IS reachable, an item carrying no stamp at all, is
 * handled one layer up in `BubbleMeta`: there the choice is between rendering a string and rendering
 * nothing, which is not a formatting decision.
 */
export function formatMessageTime(epochMs: number): string {
  const at = new Date(epochMs)
  const day = String(at.getDate()).padStart(2, '0')
  // `getMonth` is zero-based; every other getter here is not.
  const month = String(at.getMonth() + 1).padStart(2, '0')
  // Padded for completeness rather than for any moment a message can carry — `Date.now()` yields a
  // four-digit year for the whole life of this app. The spec exercises it so it cannot be silently wrong.
  const year = String(at.getFullYear()).padStart(4, '0')
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} - ${hour}:${minute}`
}
