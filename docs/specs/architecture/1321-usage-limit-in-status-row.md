# #1321 — the usage-limit notice in the composer status row's trailing slot

#1320 holds claude's usage-window reading per conversation and `selectUsageLimitFor` is its only read
surface. This slice draws it: a third occupant for the status row's trailing slot, below #963's
actionable-error button and #797's connection-error chip in precedence, wearing the chip's geometry and
one of two colour treatments. `status` and `limitType` stay lookup keys for client-owned copy and reach
no DOM sink, which is where the constraint `usageLimitStore` inherited is finally **discharged**.

## Files read

- `src/renderer/src/store/usageLimitStore.ts` → `UsageLimitReading`, `selectUsageLimitFor`,
  `useUsageLimitStore` — the record this slice renders, the expiry rule, and the React binding. Its
  header carries the three constraints this ticket inherits: both strings are untrusted claude-authored
  text usable only as lookup keys, `resetsAt` is unvalidated in both directions and is never a scheduling
  input, and nothing on this path is ever logged.
- `src/renderer/src/store/usageLimitBridge.ts` → `subscribeUsageLimit`, `UsageLimitData`,
  `BENIGN_STATUS` — the producer. `allowed` never reaches the store at all: the bridge routes it to
  `clearUsageLimitFor`, which is what the e2e's clear step drives. `UsageLimitData` is already mounted in
  `App.tsx`, verified rather than assumed, so this slice adds no wiring there.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlot` (the pure
  three-way view this ticket makes four-way), `ComposerErrorSlotControl` (the store-bound container that
  gains the reading), `ComposerErrorChip` (#797's occupant, delegated to unchanged), `ComposerStatusArea`
  (the row and its `trailing` slot)
- `src/renderer/src/screens/conversation/composerSend.ts` → `shouldOfferRepair`,
  `COMPOSER_ERROR_CHIP_COPY`, `COMPOSER_REPAIR_BUTTON_COPY` — the gate whose priority is preserved, and
  the client-owned strings the new copy owes lexical distinctness to
- `src/renderer/src/screens/conversation/messageTime.ts` → `formatMessageTime` — the repo's timestamp
  discipline this ticket's formatter copies: local getters, zero-padded, and **no `Intl`, no
  `toLocaleString`, no `toLocaleDateString`**, because those put the runner's locale into an exact-string
  assertion
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-status` (the `min-height` row),
  `.composer-status__activity` (`flex: 1 1 auto; min-width: 0` — the head of the truncation chain),
  `.composer-status__error` (the chip's geometry, the source of the new block's declarations),
  `.button-small` (#963's extraction, and this file's own "One consumer is not a pattern" trigger)
- `src/renderer/src/theme/tokens.css` → `--color-error`, `--color-error-container`, `--color-warning`,
  `--radius-xs`, `--space-1`, `--space-2`, `--text-body-small-*`, plus the standing
  never-the-generated-fallback warning each colour comment carries
- `src/main/transport/inboundMessage.ts` → `parseRateLimitedPayload` — the fail-closed narrower, and its
  recorded decision to apply **no** membership check to `status` or `limit_type`, which is why an
  unrecognised value is ordinary here rather than an error
- `src/shared/wire/types.ts` → `RateLimitedPayload` — the five wire fields the e2e frame must carry
- `docs/specs/architecture/963-actionable-error-button-in-status-row.md` — the slot's own design record
  and the one-occupant rule AC4 extends
- `docs/knowledge/features/conversation-shell-composer-status.md` § "Composer error chip (#797)" and
  § "Actionable-error button (#963)" — **the load-bearing lesson for this ticket's tests**: a store-bound
  container's non-initial branch is NOT reachable by a `setState` in `beforeEach`, because zustand v5's
  `useStore` reads `getInitialState()` under `renderToStaticMarkup`. It is also why the two arms this
  ticket adds are proven on the pure view and in the Playwright tier, never through the container.
- `e2e/composer-model-announced.spec.ts` — the frame-pushing drive idiom this ticket's spec follows:
  fixed reply framing, `daemon.pushFrame` for an unsolicited daemon frame, positive assertions ordered so
  each step is falsifiable by the one before it
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `seedConversationsFrame` — the fixture clicks the
  single seeded row on launch, so `SEEDED_ROW.id` is the open conversation and is the id the pushed
  frames must name

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The composer status row (`Status area`, 741×32) is a `flex items-end justify-between` band: the 24-tall
status group (the 14×16 brand mark plus a body/small label in `Schemes/Primary`) flush with the row's
bottom edge on the left, and the row's trailing slot on the right. The file draws exactly two occupants
for that slot and **no quota-specific state at all** — #963's filled `Button small` error variant
(`354:7093`, 16/8 padding, 6px corner, body/small-emphasized) and #797's chip (`112:3529`, 8/4 padding,
the same 6px corner, body/small). The copy this ticket adds is new; the geometry is not. The notice wears
the chip's box, since it carries no action, and takes one of two colour treatments (below).

## Context

Two of the three surfaces this reading could take already exist and neither fits. #797's chip is the
right box but its fill is `--color-error-container`, and drawing a warning band in it repeats in colour
exactly the overclaim the copy is careful to avoid. #963's button is an affordance, and there is nothing
here for the operator to press. So: the chip's geometry, two treatments, and no new Figma node.

**Only `rejected` earns the exhausted wording.** The status set is open and unmeasured beyond
`allowed_warning` — the single live capture, 2026-08-22 against claude 2.1.239, in a weekly band where
every turn still ran normally. `RateLimitedPayload`'s docblock names "you are rate limited" as *the*
realistic client bug. So an unrecognised status takes the warning arm: the cost of under-claiming is one
softly-worded row, the cost of over-claiming is telling an operator they are blocked while their turns
keep working.

No ADR is warranted. The general decision here — untrusted daemon text selecting among client-owned
strings through a `Map` rather than a `Record` — is `usageLimitStore`'s own recorded rule applied one
layer down, not a new architectural choice. The documentation phase should fold this into
`docs/knowledge/features/conversation-shell-composer-status.md` beside the #963 section.

**Sizing, stated rather than hidden.** The refiner's estimate is ~1000 lines of total written work,
above the 800-line ceiling, and this plan agrees with that figure. It stays one ticket on the **floor**
rule: the copy-and-treatment mapping has exactly one consumer, so a slice carrying only it would have
nothing observable of its own and could not be verified alone. Every other boundary holds — 2 production
source files, 3 new exports, 10 call sites of the one changed signature, 5 acceptance criteria, no
state machine and so no reject branches.

## Design

Three pieces, each pure and each provable at its own tier.

### 1. `usageLimitNotice.ts` — the copy and treatment mapping (new module)

A React-free module beside `messageTime.ts`, for the same reason that one exists: the exact characters
are pinnable without rendering anything.

```ts
export interface UsageLimitNotice { treatment: 'exhausted' | 'warning'; text: string }
export function usageLimitNotice(reading: UsageLimitReading, nowSeconds: number): UsageLimitNotice
```

Total on every input, with no throw and no reject branch. It composes three runs:

| run | source | absent when |
|---|---|---|
| lead | `USAGE_LIMIT_EXHAUSTED_COPY` on `status === 'rejected'`, else `USAGE_LIMIT_WARNING_COPY` | never |
| window | a `Map` lookup on `limitType` | the value is not `five_hour` or `seven_day` |
| reset | a local-getter formatter over `resetsAt` | `resetsAt` is `0`, or the instant is not representable |

The lead is the only place the treatment is decided, and `treatment` is returned beside the text so the
view picks a class without re-testing the status. **`status` and `limitType` are read only as lookup
keys and neither is ever interpolated into the returned text** — the discharge of the inherited
constraint, and structural rather than conventional: no branch of this function can reach either string.

**The window lookup is a `ReadonlyMap`, and `Record<string, string>` is forbidden here.** `limitType` is
untrusted daemon text; a `Record` lookup on `'constructor'` returns `Object`'s constructor and on
`'__proto__'` returns `Object.prototype`, both of which are non-`undefined` and would flow straight into
the returned text. `Map.prototype.get` performs no prototype-chain lookup, so the hostile keys are three
unremarkable misses **by construction** rather than by validation. Same rule, same reason, as
`usageLimitStore`'s own `readings` map.

**The instant is unix SECONDS on both parameters**, matching `selectUsageLimitFor`'s. One unit across
the whole slice is what closes the millisecond trap that selector's docblock names — a caller passing
`Date.now()` there expires every reading on arrival with no type error and no symptom.

The reset formatter follows `formatMessageTime`'s discipline exactly — local getters, zero-padded, no
`Intl` and no `toLocale*` — but is a separate function, because it has a shape that one does not: the
day is carried **only when the reset does not fall on the local day the notice is read**. A seven-day
window resets days out, so a bare time of day would read as "later today" and mislead; a same-day
five-hour reset does not need the date repeated. It returns `null` rather than a string in two cases,
and both are reachable through the wire rather than hypothetical:

- `resetsAt === 0` — claude reported no reset. The clause is dropped; the epoch is never formatted.
- `new Date(resetsAt * 1000)` is an Invalid Date. `resetsAt` is unvalidated upstream in both directions,
  so a magnitude past the ±8.64e15 ms range decodes, passes the selector's `nowSeconds < resetsAt` test
  as readable, and would otherwise render `NaN.NaN.NaN`. Guarded by a `Number.isNaN(at.getTime())` test,
  not by a range check on the input — the check is on the thing that can actually be malformed.

**Nothing is scheduled from `resetsAt` anywhere in this slice.** No `setTimeout`, no `setInterval`, no
allocation and no iteration keyed on it. The expiry is `selectUsageLimitFor`'s one comparison, performed
when the container renders, so an expired reading leaves the row on the next render rather than on a
tick — which is exactly what keeps this surface free of the timer the arm's docblock warns about, where
a delay computed from the number is either negative or past `setTimeout`'s clamp and fires immediately
either way.

### 2. `ComposerUsageLimitNotice` — the pure view (in `ConversationScreen.tsx`, beside `ComposerErrorChip`)

`({ reading, nowSeconds })` → `null` when `reading` is `null`; otherwise one `<div>` wearing
`.composer-status__usage` plus the treatment's modifier, holding the text and nothing else. A `<div>`,
not a `<p>`, for `ComposerErrorChip`'s recorded reason: this repo ships no global margin reset, so a
`<p>`'s UA margin would be a live layout hazard in a row whose height is its occupant's.

Props, not a store read, so the whole matrix is server-renderable — the `ComposerErrorChip` /
`ConnectionBanner` discipline, and the only way a non-initial arm is assertable in this repo at all.

**No live region and no hidden prefix.** The `ComposerErrorChip` ruling applies verbatim on the first
count. On the second it does not: the chip needs a visually-hidden `Error: ` because "Host connection
down!" does not say what it is, whereas both leads here say it in plain words, so the visible text is
already the accessible name. The class is chosen by an explicit two-way conditional over the
`treatment` union rather than by interpolating it into a template, so the two class names are literals a
grep finds.

### 3. Precedence, in `ComposerErrorSlot` and its container

`ComposerErrorSlot` gains one required prop, `notice: JSX.Element | null`, and becomes four arms asked
in this order — the order is the contract, as it already was:

1. `shouldOfferRepair(status)` → the actionable button (unchanged)
2. `status.type === 'error'` → `ComposerErrorChip` (unchanged behaviour; the discriminant test that was
   previously left to the chip's own guard is now asked here, so the notice's arm is unreachable while
   either existing occupant could claim the slot)
3. `status.type === 'connected'` → the notice
4. otherwise → `null`

**`notice` is a `ReactNode`-shaped prop, not the reading itself**, which is `ComposerStatusArea`'s own
`trailing` seam one level down: the slot stays a view that knows a POSITION and its occupants' priority,
and knows nothing about a usage window. That is also what keeps the required prop cheap — every existing
call site passes `notice={null}` and no existing assertion moves. Required rather than optional, on this
repo's standing rule that an optional prop is the silent-omission hole a type cannot catch.

Arm 3 is `connected` and not merely "not an error", and the ticket body states why: a connection error
makes a quota reading stale anyway, so the notice fills the slot only while the connection is healthy.
That is strictly stronger than AC4, which names only the two error occupants, and it also keeps the
notice from sitting beside #279's disconnected banner contradicting it.

`ComposerErrorSlotControl` gains three reads and no new IPC:

```
useActiveConversationStore(selectActiveConversation)   // which conversation is open
Math.floor(Date.now() / 1000)                          // the instant, at render
useUsageLimitStore(selectUsageLimitFor(openId, now))   // the reading, or null
```

with a module-level `NO_USAGE_LIMIT_READING` constant selector used when no conversation is open, so the
hook is called unconditionally and its identity is stable on that arm. `selectUsageLimitFor` returns the
held record itself or `null`, both stable references, so a fresh selector identity each render costs a
re-subscribe and never a re-render loop; a write for another conversation returns the same record and
`Object.is` short-circuits.

## State + concurrency model

No new store, no new bridge, no new IPC channel, no subscription and no effect. The reading is already in
`usageLimitStore`, written by `UsageLimitData`, which is already mounted app-level and app-lifetime; this
slice adds a read of it and nothing else. There is no long-lived async work here and therefore no
cancellation path to define — the one lifecycle question a usage window raises, expiry, is answered by a
comparison at render rather than by a timer, which is the whole reason there is nothing to tear down.

`clearPairingScopedState` already drops every reading at a pairing boundary (`usageLimitStore` is its
fifteenth member), so this surface needs no unmount clear of its own.

## Error handling

There is no failure to surface: this path parses nothing, calls nothing that can reject, and has no
reject branch. What it has instead is three total functions over an unvalidated input, and the absent
cases are values rather than errors:

| input | outcome |
|---|---|
| no reading for the open conversation, or an expired one | the slot renders nothing at all — not an empty element |
| a `status` outside `rejected` | the warning treatment, never the exhausted one |
| a `limitType` outside the two recognised values | the notice with the window clause omitted |
| `resetsAt === 0`, or an unrepresentable instant | the notice with the reset clause omitted |

Nothing here throws, nothing is logged (`usageLimitStore`'s total no-log property extends to this
surface unchanged — not even a content-free count of an unrecognised value, because the pair discloses
the account's quota posture), and no branch is a swallowed error.

## Testing strategy

RED first on each of the three pieces.

**`usageLimitNotice.test.ts` (vitest, new)** — the copy and treatment matrix, with no rendering:

- `rejected` takes the exhausted treatment and leads with the exhausted copy; `allowed_warning`, an
  empty status, and an invented status all take the warning treatment and the warning lead (AC1, AC2)
- the two treatments' texts agree on every run but the lead, asserted by construction rather than by two
  hand-written expectations
- `five_hour` and `seven_day` produce their window words; `seven_day_opus`, `overage`, `''` and a
  hostile `__proto__` / `constructor` produce the notice with the window unnamed **and no `[object`,
  `function` or `undefined`** anywhere in the text (AC3, and the `Map`-not-`Record` guarantee)
- `resetsAt: 0` drops the reset clause and the text contains no `1970` (AC3)
- a reset later the same local day renders time-only; one on another local day carries the date — both
  built from local getters in the test, the inverse of the production ones, so no runner time zone can
  flake them (`messageTime.test.ts`'s recorded answer to exactly this)
- a `resetsAt` past the representable range drops the clause and yields no `NaN`
- neither `status` nor `limitType` reaches the text, pinned with sentinel values on the arm that reads
  both

**`ConversationScreen.test.tsx` (vitest, extended)** — two describes:

- `ComposerUsageLimitNotice`: `null` reading renders the exact empty string, not an empty element; the
  exhausted arm wears `composer-status__usage--exhausted` and the warning arm
  `composer-status__usage--warning`, each asserted in both directions so a view emitting both classes
  fails; no `aria-label`, no `role`, no hidden prefix
- `ComposerErrorSlot` precedence (AC4): with a sentinel notice element passed on every arm, the
  actionable-error arm and both chip arms render their own occupant and **not** the sentinel; the
  connected arm renders the sentinel; disconnected and connecting render nothing at all

The nine existing `ComposerErrorSlot` renders gain `notice={null}` and no assertion in them changes.

**`e2e/composer-usage-limit.spec.ts` (Playwright fake tier, new)** — the transitions, which no static
render can reach (AC5). One drive over the launched, paired app with the seeded row open, pushing
unsolicited `rate_limited` frames the daemon genuinely sends unprovoked, naming `SEEDED_ROW.id`:

1. the slot is empty at launch
2. push `allowed_warning` / `seven_day` → the warning treatment appears carrying the warning lead and
   `7-day window`, and the exhausted class is absent
3. push `rejected` / `five_hour` → the treatment flips to exhausted, carrying the exhausted lead and
   `5-hour window` — a different window on purpose, so the step is falsifiable by the one before it
4. push `allowed` → the slot empties again, which is the bridge's `clearUsageLimitFor` route driven
   end-to-end

Step 4's absence is not vacuous: steps 2 and 3 each prove the element present first, so the closing
`toHaveCount(0)` is a mutation check rather than a locator that was empty all launch. `resets_at` is a
fixed far-future literal (the fake-daemon no-`Date.now()` convention), and the spec asserts the lead and
window words only, never the formatted instant, whose exact characters depend on the runner's time zone
and are pinned in vitest instead.

## Open questions

1. **Does the notice show while `disconnected` or `connecting`?** Resolved in the design above: no. AC4
   names only the two error occupants, but the body's precedence paragraph says the notice fills the slot
   "only while the connection is healthy", and suppressing it on every non-`connected` arm is the reading
   that never puts a quota claim beside a live connection problem. Recorded here because it is stricter
   than the criterion, so a later reader can see it was a choice.
2. **Does the warning treatment take a fill or only a colour?** Only a colour. There is no
   `--color-warning-container` token and the ticket forbids inventing one, so the warning arm is amber
   text in the chip's box with no background, which is visually distinct from the filled dark-red
   exhausted arm as AC2 requires. To be confirmed against the running window before the PR.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The boundary is upstream and explicit: `parseRateLimitedPayload`
  in `src/main/transport/inboundMessage.ts` is the single fail-closed narrower, and this slice is three
  layers below it holding an already-typed `UsageLimitReading`. Everything it holds from the daemon —
  `status`, `limitType`, `resetsAt` — stays untrusted, and the design says so at each of the two
  functions that touch them. `conversationId` never reaches this surface at all: the container passes the
  id it already knows from `activeConversationStore` into the selector, and the selector returns the
  reading, which by `UsageLimitSnapshot`'s deliberate split does not carry the routing key. So no
  daemon-asserted identifier is even in scope for a DOM sink here.
- **[Untrusted text reaching a DOM sink] MUST FIX, addressed in the design before this pass.** This is
  the ticket's whole reason for existing and the one place a plausible implementation goes wrong. Two
  concrete sinks were checked against the design rather than argued: (a) neither string may be
  interpolated into the notice text — the design's copy function reads both only as lookup keys and its
  test pins that with sentinel values; (b) neither may be interpolated into a `className`, which would
  put daemon text in an attribute — the design chooses the class by an explicit two-way conditional over
  the client-owned `treatment` union. Both hold as designed, and the `usageLimitStore` docblock's
  denied-sink list is discharged item by item: not rendered verbatim, not an authorization signal, not a
  filename, not a cache key, not a lookup path, not an attribute, not a URL, not a log.
- **[Prototype-chain lookup on untrusted keys] MUST FIX, addressed in the design before this pass.**
  The window lookup keys a container on `limitType`, which is untrusted. A `Record<string, string>` or an
  object literal would return `Object.prototype` for `'__proto__'` and the `Object` constructor for
  `'constructor'` — both non-`undefined`, so the `=== undefined` miss test passes them through and the
  value reaches the returned text, rendering `[object Object]` or a function's source in the status row.
  The design mandates a `ReadonlyMap` and forbids `Record` outright, which makes the hostile keys
  ordinary misses by construction; the test names all three keys. This is `usageLimitStore`'s own
  `Map`-not-`Record` rule, and the finding is that it had to be carried down to the second container in
  the slice rather than assumed to travel with the data.
- **[Denial of service / resource exhaustion] No findings.** Nothing here allocates, iterates or
  schedules from `resetsAt`, which is the hazard the arm's docblock names — a delay computed from an
  unvalidated epoch is either negative or past `setTimeout`'s ~24.8-day clamp, and both fire immediately.
  The design states the no-timer property and the expiry is one comparison at render. The copy function
  is O(1) with two `Map` lookups and no loop. A flooding hostile relay costs one bounded store entry per
  distinct conversation id, unchanged by this slice, and re-renders one leaf component.
- **[Layout as a remote-triggered hazard] No findings.** The row's truncation chain is the standing
  hostile-daemon concern here (`.composer-status__label--tool` records it), and this occupant cannot
  invert it: the new block is `flex: 0 0 auto` like both existing occupants, so the activity group
  absorbs the squeeze, and every run in the notice is a client-owned constant or a bounded formatted
  instant — no daemon-length string enters the row through this path, so `white-space: nowrap` cannot be
  blown out.
- **[Error messages, logs, telemetry] No findings.** Nothing on this path logs, and the design forbids
  adding a diagnostic seam — `usageLimitStore`'s recorded reason applies unchanged and is if anything
  stronger at a rendering surface: the pair discloses the account's quota posture, a fact about the
  operator rather than about the frame, and a content-free count is the first crack in a property that
  has to be total. There are no error messages, because there is no error path.
- **[Electron attack surface, process placement] No findings.** Renderer-only, and read-only at that: no
  `contextBridge` API, no `ipcMain` channel, no `window.pyry` dereference, no new preload surface. No
  key, socket or byte is in reach. `ComposerErrorSlotControl`'s existing `window.pyry` uses stay confined
  to the repair handler at interaction time and are untouched.
- **[Tokens, secrets, credentials] Not applicable.** No credential, token or key is read, held, derived,
  compared or displayed. Nothing is persisted: no web storage, no disk, no `safeStorage` — the reading
  lives in the in-memory store this slice reads and the design adds no persistence, which matters because
  a persisted copy would outlive the pairing that scoped it with every in-memory assertion still green.
- **[Cryptographic primitives] Not applicable.** No comparison in this slice is against a secret. The
  one string equality — `status === 'rejected'` — is a lookup key selecting among strings this client
  wrote, with a defined behaviour on a miss; `crypto.timingSafeEqual` would claim a property nothing here
  has, since neither value is unguessable and neither is secret. It steers no security-relevant
  behaviour: the worst a hostile status can do is pick the softer of two client-owned strings.
- **[Concurrency] No findings.** No async work, no effect, no listener, no timer, so there is nothing to
  cancel and no check-then-act gap. The one shared-state read is `selectUsageLimitFor` against zustand's
  synchronous snapshot.
- **[File / storage operations, Network & I/O] Not applicable.** No filesystem path is constructed, no
  socket is opened, no URL is built or navigated to. The slice adds no network surface at all.
- **[Threat model alignment] Hostile daemon addressed; the rest inherited.** A daemon that lies about the
  window can, at worst, show a warning row that should not be there or withhold one that should — a
  cosmetic outcome by construction, since the exhausted wording is reserved for one exact string and no
  behaviour is gated on any of it. A daemon that sends absurd or malformed values is covered by the
  upstream narrower plus the two total functions above. Malicious relay and token theft are unchanged by
  this slice and out of its scope.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-09

## Revisions

**2026-09-09, during implementation.** Both open questions resolved, and one design detail sharpened.
Neither changes a contract stated above.

1. **The notice shows only on the `connected` arm** — question 1, resolved as the design proposed and now
   pinned by two `ComposerErrorSlot` cases asserting the exact empty string while disconnected and while
   connecting, alongside the two that assert it yields to each existing occupant.
2. **The warning arm is colour only, with no fill** — question 2, resolved as proposed. Confirmed in the
   running window through the Playwright tier rather than by eye: the row measures 24 tall with the notice
   in the slot, identical to the chip's, and does not move between the two arms, and `.conversation`
   reports no horizontal overflow. Those numbers are now in `.composer-status__usage`'s own comment and
   are asserted in `e2e/composer-usage-limit.spec.ts`. The colour distinction itself rests on the token
   values — amber `--color-warning` text against the row's ground versus the filled `--color-error-container`
   pair — and not on a visual inspection, which this tier cannot perform.
3. **`.composer-status__usage` is its own block rather than a geometry shared with `.composer-status__error`.**
   The plan said the notice "wears the chip's geometry" without saying whether that meant a lifted rule.
   It does not: the two occupants differ in what they draw on every arm (the warning takes neither of the
   chip's colours, and the notice needs no `position: relative` because it has no hidden prefix to
   contain), so lifting would couple them for six declarations and let a later change to the chip move
   the notice. The stylesheet comment records the departure from `.button-small`'s extraction precedent.
