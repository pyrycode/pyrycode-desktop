# #1014 — show each message's time in the bubble's meta row

## Files read

| Path | Symbol / section | Why it matters |
|---|---|---|
| `src/renderer/src/store/threadTimeline.ts` | the `ThreadItem` union's `assistantText` and `userText` arms | the `createdAt?: number` this renders, and its contract docblock — **absent is a legal item**, and the read is `=== undefined`, never `in` |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `BubbleMeta`, and the `assistantText` / `userText` arms of `TimelineRow` | the empty `bubble__meta-time` slot and the two call sites that must now pass the stamp |
| `src/renderer/src/screens/conversation/copyMessageText.ts` + its spec | `copyMessageText` | the module-plus-spec shape this ticket repeats: own module beside the bubble, own spec, one consumer in `ConversationScreen.tsx` |
| `src/renderer/src/screens/channels/channelListViewModel.ts` | `MONTHS` and its comment above `formatLastActivity` | the only existing date formatter — it uses **UTC** getters *because* nothing pins a zone. This ticket cannot copy that; § Design records why and what replaces it |
| `src/renderer/src/screens/conversation/conversation.css` | `.bubble__meta`, `.bubble__meta--user` | confirms the slot inherits the body-small quartet and `--color-inverse-primary`, and that `min-height` already reserves the row's 16px — **no CSS change** |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` | `describe('Timeline — the message bubble meta row and its copy control (#969)')` | the fixture and assertion idiom this ticket's new cases join; also the 39 stamp-free item literals that stay untouched as AC3's coverage |
| `src/renderer/src/store/timelineBridge.ts` | `useTimelineBridge`'s `Date.now` argument | proves the **running** app stamps the assistant side, so the fake e2e tier's bubbles really do gain the string |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | the composer's `now: Date.now` dep | the same proof for the user echo |
| `e2e/assistant-whitespace.spec.ts`, `composer-actions.spec.ts`, `send-and-stream.spec.ts`, `slash-command-type-ahead.spec.ts`, `thread-scroll-pin.spec.ts` | the nine `toHaveText` sites | each one's own comment says what it proves; § The e2e cascade records what must survive |
| `docs/knowledge/features/conversation-shell-message-bubble.md` § "The meta row" | — | records `min-height` as load-bearing precisely so filling the slot is additive, and names this ticket as the filler |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4477

The assistant `Message` variant. Below the message paragraphs sits a single 16px-tall row whose first
child is the timestamp `13.01.2026 - 13:55`, rendered in the muted `--color-inverse-primary` at
body-small 12/16, with the copy glyph immediately to its right. The screenshot shows the full
`DD.MM.YYYY - HH:MM` string on every bubble — there is no relative ("5m ago") or same-day short form to
implement, and the drawing shows it even on two messages a minute apart. The user variant (`132:4508`,
row `132:4435`) is the same row right-aligned. Nothing in the drawing calls for a CSS change: the row,
its type, its colour and its gap all landed with #969.

## Context

#969 built the meta row and deliberately left `<span className="bubble__meta-time" />` empty, sizing
`.bubble__meta`'s `min-height` to the body-small line height so the row's height would not change when
the slot was later filled. #1013 then gave the `assistantText` and `userText` items an optional
`createdAt` in epoch milliseconds. This ticket is the last of the three: format that number and put it
in the slot.

The work is a formatter module, a stamp threaded to one component, and a mechanical pass over nine e2e
text expectations that the fill breaks. No ADR is warranted — every design decision here is a
restatement of contracts #969 and #1013 already recorded.

## Design

### `messageTime.ts` (new, beside the bubble)

One exported function, the `copyMessageText` shape:

```ts
export function formatMessageTime(epochMs: number): string
```

Pure. Reads `getDate` / `getMonth` / `getFullYear` / `getHours` / `getMinutes` off a `new Date(epochMs)`
— **local** getters — and assembles `DD.MM.YYYY - HH:MM` with `padStart`. No `toLocaleString`, no
`toLocaleDateString`, no `Intl`: those introduce locale variation the drawing does not ask for (a
US-locale runner would render `1/13/2026, 1:55 PM`), and they are what would make an exact-string
assertion machine-dependent.

**Why local getters here when `channelListViewModel.formatLastActivity` chose UTC.** That comment reads
"a locale/TZ-dependent `Date#toLocaleDateString` would make the test flaky across runners", and it
solved the flakiness by moving the *rendering* to UTC. That is not available here: the drawing's
timestamp is the viewer's own wall clock, so UTC would show the wrong time to every user outside it.
The exact-string assertions are made zone-proof on the **test** side instead — see § Testing strategy.

**No `NaN` / non-finite branch.** The only producer of `createdAt` is `Date.now` (`timelineBridge`'s
`useTimelineBridge` argument and the composer's `now` dep); a non-finite epoch is not reachable, and
under this repo's evidence-based rule an unobserved failure mode does not buy a branch. What *is*
reachable — the absent stamp — is handled one layer up, where it belongs, because the choice there is
between rendering a string and rendering nothing at all rather than between two strings.

### The render slot

`BubbleMeta` gains one optional prop:

```ts
function BubbleMeta({ text, side, createdAt }: { text: string; side: 'user' | 'daemon'; createdAt?: number })
```

and its time span becomes `<span className="bubble__meta-time">{createdAt === undefined ? null : formatMessageTime(createdAt)}</span>`.

Three things follow, and each is an acceptance criterion:

- **`=== undefined`, never `'createdAt' in item`** — #1013's docblock fixes this read, because the
  reducer assigns the field unconditionally and the property is therefore always present.
- **The absent case is byte-identical to today.** React renders `{null}` children as no children, so
  `<span class="bubble__meta-time"></span>` is exactly what #969 emits now. AC3 is satisfied by the
  markup being unchanged rather than by a separate empty-string path.
- **The element structure is otherwise untouched** — same span, same class, same position ahead of the
  copy button; the button, the svg and `.bubble__meta`'s `min-height` are not edited at all.

The two call sites pass `createdAt={item.createdAt}` — the `assistantText` arm and the `userText` arm of
`TimelineRow`. No other row kind gains a call: the tool rows are not bubbles, `sessionBoundary` renders
its own separator, and `QueuedBacklog` has never rendered a `BubbleMeta` (AC4's fence on the queued rows
is structural — there is nothing there to leave alone but the absence itself).

`Timeline`'s prop surface is unchanged, so the ~30 existing `<Timeline` render sites stay untouched, the
same property that kept #969 cheap.

### The e2e cascade

`BubbleMeta` is the bubble's last child on both branches and Playwright's `toHaveText(string)` asserts
the element's **whole** normalized text, so all nine sites listed in the ticket read
`"…13.01.2026 - 13:55"` the moment the slot fills. This was verified rather than assumed: the running
app injects `Date.now` on the assistant side (`useTimelineBridge`) and on the user echo (the composer's
`now` dep), and the fake tier launches that same built app — so its bubbles genuinely carry a stamp.

A blanket swap to `toContainText` is rejected. It would delete what several of these prove:
`send-and-stream.spec.ts`'s own comment states the assistant assertion is the guard against the
default-echo trap and depends on matching `REPLY_TEXT` exactly; `assistant-whitespace.spec.ts`'s gate is
deliberately the one whitespace-free text in the file so that `toHaveText`'s normalisation cannot make
the wait vacuous; `thread-scroll-pin.spec.ts`'s three `.last()` assertions pin *which* turn arrived and
would accept turn 20 where turn 21 was required.

Instead the message text stays **bounded**, with the timestamp admitted as a shape rather than a value.
A new helper module beside the existing e2e fixtures:

```ts
// e2e/fixtures/bubbleText.ts
export const BUBBLE_META_TIME: string          // the DD.MM.YYYY - HH:MM digit shape, as regex source
export function bubbleTextExactly(text: string): RegExp
```

`bubbleTextExactly` regex-escapes the expected message text and returns an **anchored** pattern —
`^<escaped text>\s*<timestamp shape>$`. `toHaveText` tests a `RegExp` against the same normalized text
it compares a string to, so anchoring keeps every site an exact bound: the text may not be a prefix of
something longer, may not be missing a character, and the only thing permitted after it is one
well-formed timestamp. The optional `\s*` is deliberate — it costs nothing and makes the pattern
independent of whether Playwright's text walk introduces a separator at the meta row's block boundary.

The nine sites each swap their string for `bubbleTextExactly(<the same expression>)`, unchanged
otherwise. No site's locator, timeout, `.nth()` or `.last()` moves.

## State + concurrency model

None. The formatter is pure, the render slot is a pure function of props, and no store, subscription,
timer or async task is introduced. The rendered string does not re-derive on a clock tick — it is the
message's own creation moment, fixed at the value #1013 stamped, so there is nothing to keep fresh and
no teardown path to define. (This is the point on which the drawing's absolute format is load-bearing:
a relative "5m ago" form would have needed a ticking re-render, and the drawing shows none.)

## Error handling

One failure mode, and it is not an error: an item whose `createdAt` is `undefined`. It renders as the
empty slot, which is a legal item per #1013's contract, not a defect — every renderer fixture that
injects no clock produces one. Nothing is logged, thrown or surfaced; the row keeps its height from the
CSS `min-height` #969 sized for exactly this.

No new value reaches a log, an attribute, a URL or a cache key. The formatted string is derived from a
renderer-minted number and is not daemon-authored text, so the 2026-08-20 ruling's sinks are not in play;
it reaches the DOM only as auto-escaped React children.

## Testing strategy

**`messageTime.test.ts` (vitest, node)** — the formatter alone, with exact output strings:

- the drawing's own moment, asserting `13.01.2026 - 13:55` verbatim;
- a single-digit day, month, hour and minute together, proving all four pads at once;
- midnight and 23:59, proving the clock is 24-hour rather than 12-hour with a meridiem;
- a sub-minute component (seconds and milliseconds set) producing the same string as the bare minute,
  proving nothing below the minute leaks;
- a year under four digits, which is the only input that exercises the year pad;
- **a case that removes `Date.prototype.toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`
  and `Intl` from under the formatter and asserts it still returns the same string.** This is AC2's
  "reads local date getters rather than `toLocaleString` / `Intl`" turned into something falsifiable —
  without it, an implementation that used `Intl` with a hardcoded locale would pass every other case on
  the author's machine.

**Every expected epoch is built with `new Date(y, m, d, h, min)`**, never a hardcoded epoch constant.
Local construction is the exact inverse of local getters, so each case yields the same string in every
zone. Nothing in this repo pins `TZ`, so a literal epoch would pass here and fail on a runner an hour
away; AC2's "no locale variation" means locale-independent, and a given epoch is *meant* to read
differently in a different zone.

**`ConversationScreen.test.tsx`** — new cases in the #969 meta-row `describe`, asserting through
`renderToStaticMarkup` that a stamped `assistantText` and a stamped `userText` each put the formatted
string inside `bubble__meta-time`, and that an item without a stamp still emits the empty span. The 39
existing stamp-free item literals stay unedited — they are AC3's coverage exactly as they stand, and
#1013's optional field is what lets them keep compiling.

**`npm run e2e`** — the nine updated assertions are themselves the proof that the string reaches the
running app's DOM. Nothing new is added to the tier: the fill is observable from sites that already
exist, and `message-copy.spec.ts` already owns the row's interactive half.

## Open questions

1. **Does Playwright's text normalisation introduce whitespace between the message text and the meta
   row?** Resolved in the design rather than left open: the pattern admits `\s*`, so it holds either
   way. Confirmed empirically when the touched specs run.
2. **Does the settled code-block bubble in `assistant-whitespace.spec.ts` carry any text beyond
   `LONG_TOKEN_TEXT` and the new stamp?** Its current exact assertion says no; if the run shows
   otherwise, the finding goes in a `## Revisions` entry rather than into a loosened matcher.

## Revisions

### 2026-09-03 — both open questions resolved empirically; no design change

Neither answer moved the design, so this entry records the measurements rather than a departure.

1. **Playwright inserts no whitespace at the meta row's block boundary.** Measured by a negative
   control: one site was reverted to its old `toHaveText(string)` form and run, and the failure printed
   `Received: "hello from the composer03.09.2026 - 15:59"` — text and timestamp concatenated with no
   separator. That same run is the proof the fill actually reaches the running app's DOM (the assertion
   was green before this ticket and red after), which is what makes the nine updated sites non-vacuous.
   The pattern's `\s*` is therefore never exercised today; it stays, because it costs nothing and the
   pattern should not depend on that walk's treatment of a block boundary.
2. **The settled code-block bubble carries nothing beyond `LONG_TOKEN_TEXT` and the new stamp** — the
   anchored matcher is green at `assistant-whitespace.spec.ts`'s gate, so no matcher was loosened.

Also checked while resolving these, and clear: no other assertion in the fake tier reads a bubble's
text — the only `textContent` reads in the tier are on a code fence's header and the host label, and the
tier holds no bubble-geometry assertion that the timestamp's width could move. `message-copy.spec.ts` is
unaffected by construction: the copy control closes over the item's own `text`, never the rendered DOM.

### 2026-09-03 — the e2e cascade is THIRTEEN sites, not nine; the sentence above is wrong

**The correction, first.** The paragraph immediately above claims "no other assertion in the fake tier
reads a bubble's text". That is false as written, and the QA gate proved it: `npx playwright test` went
red on `conversation-switch-keeps-both-threads.spec.ts`, whose received text read
`"a message typed in the seeded channel03.09.2026 - 16:03"` — this ticket's own fill. The sentence
stands above unedited, because a plan that quietly rewrites a claim the gate falsified destroys the
audit trail the Phase-A commit exists to create. Read it as superseded by this entry.

**Why the sweep missed four sites.** Both the ticket body's table and § The e2e cascade enumerate the
sites whose `.bubble[data-thread-role=…]` locator sits on the same line as its assertion — the shape a
grep for the selector finds. `conversation-switch-keeps-both-threads.spec.ts` binds its locator to a
const, `const userRows = page.locator('.bubble[data-thread-role="user"]')`, eleven lines above the first
of its **four** assertions, so neither the selector nor the word `bubble` appears on any of them. The
grep walked straight past the file. The count is thirteen: the nine already fixed, plus lines 72, 87, 98
and 107 of that spec.

Only line 72 appeared in the failure log — Playwright aborts a test at its first failed expect, so the
other three were invisible behind it and would have bounced the next gate run one at a time. All four
are fixed in one pass.

**The fix needed no design change.** `toHaveText`'s array form takes `Array<string | RegExp>` and
compares each element's entire normalized text exactly as the string form does, so
`bubbleTextExactly(SENT_IN_SEED)` drops in per element. `bubbleText.ts` is untouched, as are each site's
locator, the step-2 `toHaveCount(0)` gate between them, and what each assertion proves: still exactly one
row, still that row's own message, with only the stamp relaxed to a digit shape.

**The corrected sweep, done by the method that would have caught it.** Grep the whole of `e2e/` for
`toHaveText|toContainText` — no `bubble` filter — and resolve every const-bound locator. The remaining
hits are all non-bubble elements: tool-row parts, menu items, the status label, the run-config values,
the question panel's copy, the workspace labels, `assistant-link-opens-externally`'s anchor (the `<a>`
inside a bubble, not the bubble), and `unrecognized-message`'s row internals. `message-copy.spec.ts` and
`queued-backlog-interrupt.spec.ts` bind bubble locators to consts too but assert only visibility, count
and geometry, never text. Thirteen is the complete count.

**The lesson, stated for the next text-bearing child of `.bubble`.** A selector grep is not a sweep of
this tier — a bound locator hides the assertion from it, and a first-expect abort hides its siblings from
the failure log. Sweep by assertion name across all of `e2e/`, then resolve the consts. The spec now
carries that warning as a comment above the `userRows` const, where the next person will meet it.

### 2026-09-03 — the fill also guts the REAL tier's liveness predicate; the lesson above is still too narrow

**The correction, first.** The lesson immediately above says to sweep "by assertion name across all of
`e2e/`". That method is what this ticket ran, and it is still incomplete: it finds an `expect`, and the
real-claude tier does not measure a bubble with one. It reads `textContent` itself, inside an
`evaluateAll`. Both sentences stand above unedited, superseded by this entry rather than rewritten.

**What breaks.** `real-claude.spec.ts`'s `nonEmptyAssistantCount` counts assistant rows whose text is
non-empty *once the streaming cursor is stripped* — its docblock says outright that "a naive 'row exists'
or unstripped-textContent check would pass on an empty streaming bubble". `BubbleMeta` is appended after
the in-progress/settled fork, so it is the bubble's last child on the **streaming** branch too, and the
running app injects a clock unconditionally. A streaming row's text is therefore `"<text>▎13.01.2026 -
13:55"`, and after the cursor strip the stamp survives: `.trim().length > 0` became true for every
assistant row that exists, whatever its text. The predicate was turned into the exact check it was
written to replace. That predicate is the whole liveness proof of the tier — the named guard against
\#854's fresh-daemon deadlock — and `playwright.config.ts`'s `testIgnore` keeps the tier out of every gate
that runs, so nothing would ever have gone red over it.

Four reads, all of them copies of the same shape: `real-claude.spec.ts`, `real-claude-interrupt.spec.ts`
and `real-claude-queue-drop.spec.ts` each hold `nonEmptyAssistantCount`, and
`real-claude-question-answer.spec.ts` holds `assistantText`, which generalises it from the count to the
text. The last one carried a second, separate breakage from the same root cause: the stamp trails *each*
row, so `continuationOf`'s `after.startsWith(before)` went false and the assertion silently dropped to its
whole-text fallback. Stripping the meta row restores the prefix invariant, so it needs no fix of its own.

**The fix, and why structural.** Each read now removes the `.bubble__meta` subtree before the non-empty
check, on a **detached copy** so the live DOM the rest of each spec asserts on is untouched. That parallels
the cursor strip beside it, and it survives whatever the row grows next — matching `BUBBLE_META_TIME`'s
digit shape would have to be revisited by the next child that lands in that row. The four copies are kept
textually identical, with the constant named `META_SELECTOR` in all four, so `rg META_SELECTOR e2e/` finds
the whole set; that mirrors how `CURSOR_CHAR` is already duplicated across the same four specs rather than
lifted, and lifting it would be a refactor of adjacent code this ticket has no reason to make.

**What this could and could not be verified by.** The tier needs `pyry`, `claude` and a credential, and it
is the operator's to run (`npm run e2e:real:gate`), not the builder's — so these four specs were not
executed here. What was: the four files transform and load (`playwright test --list --config
playwright.real-claude.config.ts`, 10 tests in 10 files), and the two DOM facts the strip rests on are
already proven green in the *fake* tier by assertions that predate this leg — `message-copy.spec.ts`
evaluates `bubble.locator('.bubble__meta')`, so that element exists inside a `.bubble` in the running app,
and this ticket's own `bubbleTextExactly` sites prove the stamp is part of a bubble's text. The change is
also conservative by construction: stripping more can only lower a count that is asserted with
`toBeGreaterThan`/`toBeGreaterThanOrEqual`, so a mistake here reddens the gate and cannot green it. Given
the diff edits four of its specs, an operator run of that gate before this merges is worth having.

**The corrected sweep, for the next text-bearing child of `.bubble`.** Two greps, not one, and neither may
filter by tier — the ungated specs are exactly the ones that will not tell you:
`rg 'toHaveText|toContainText' e2e/` for the assertions, then resolve every const-bound locator; and
`rg 'textContent|allTextContents|allInnerTexts|innerText' e2e/` for the raw reads, then read what each one
is scoped to. The second grep is what this entry adds; it returns 16 lines across 8 files today, of which
the four above are the ones that read a whole bubble.

## Size

Re-counted against this written plan, not the opening sketch:

| Boundary | Limit | This ticket |
|---|---|---|
| Production source files created or modified | ≤ 5 | **2** — `messageTime.ts` (new), `ConversationScreen.tsx` (edited) |
| Total written work | ≤ 800 | ~500 |
| New exported types / interfaces / components / stores | ≤ 5 | **0** (two functions, no new type) |
| Consumer call sites needing simultaneous update | ≤ 10 | **19** — see below |
| Acceptance criteria | ≤ 5 | **5** |
| Distinct error / reject branches | ≤ 10 | **1** |

**The call-site line is over, stated rather than split.** Two real consumers (`BubbleMeta`'s call sites,
both in one file) plus thirteen one-line e2e text-expectation edits and the four real-tier bubble reads
reaches 19 — the count read 11 when this table was first written, then 15 when the QA gate found the four
const-bound sites, and 19 now that the verifier found the four `evaluateAll` reads; both corrections are
in the 2026-09-03 Revisions entries above. Each re-count found more of the same thing rather than
something new, and the reading does not change: it is still entirely test-side edits against one
unchanged production contract, and it is still the sizing floor that settles the ticket's shape rather
than this line. The refiner's own
boundary reading concluded the same and kept it whole, and the sizing floor is what settles it: the
formatter has exactly one consumer, so splitting it out would mint a ticket whose only deliverable is
consumed by its sibling — and the render half would inherit the entire e2e cascade regardless, so the
split would not even reduce the larger child. The floor outranks the ceiling; the overage is one line
of mechanical test edits, and it is recorded here rather than reasoned away.
