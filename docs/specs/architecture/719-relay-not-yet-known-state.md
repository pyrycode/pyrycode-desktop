# #719 — A distinct not-yet-known state for the relay dot

**Size:** S · **Label:** `enhancement` (not `security-sensitive` — pure render, no transport, no store, no
new daemon-derived string; the unlabelled #329/#330/#710/#718 precedent).

Split from #672. #718 (the sidebar dot pair) shipped as PR #723 and is the direct predecessor: this slice
reverses one shipped mapping decision and adds one colour binding. Nothing else.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 — relay dot `106:3114` on the
host row.

**N/A for this state specifically.** The node was re-read at spec time: `get_variable_defs` on `106:3114`
returns exactly two values — `Schemes/Success` `#2fc038` and `Schemes/Inverse Primary` `#32628d`. The file
locked 2026-05-08, before the two-dot indicator existed, so it draws **no** not-yet-known appearance for
either dot and has no red at all. The shipped `up` / `in-progress` / `down` token contract is already a
code-era addition (#330); this state extends it the same way. Everything else about the dot — 6px circle on
the sidebar, 8px on the status row, `--radius-full`, no border, no text — is unchanged from #718 and is not
re-derived here.

The design's second value, `Schemes/Inverse Primary`, is a considered-and-rejected candidate for this
state — see § Design D3.

---

## Files to read first

Codegraph is wired for this repo but **not indexed** (`.codegraph/` holds config only, no DB); every
`codegraph_*` call returns "CodeGraph not initialized". This list was built by grep + Read instead.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2109-2161` | The whole of #330's mapping: `LegCategory` (`:2117`), `ConnectionLeg` (`:2122`), `relayLeg` (`:2133-2143`), `daemonLeg` (`:2150-2161`). **Every production change to TypeScript in this ticket is inside this range.** Note `relayLeg`'s `null` handling is a pre-switch `if` at `:2134`, not a switch arm. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2163-2200` | `ConnectionStatusIndicator` (the pure view — `conn-dot conn-dot--${category}`, dots `aria-hidden`, name in the visible `.conn-leg__label`) and `ConnectionStatusIndicatorControl` (the store-bound leaf). Neither changes; read them to see why one label string is enough. |
| `src/renderer/src/screens/channels/ChannelList.tsx:305-374` | `HostConnectionDots` + `HostConnectionDotsControl` — the second consumer. Dots wear `channel-list__host-dot conn-dot--${category}` with `role="img"` + `aria-label={leg.label}`. No code change here, **two stale comments** (`:314-318`, `:362`). |
| `src/renderer/src/screens/conversation/conversation.css:1373-1401` | `.conn-dot` (8px box — the fourth binding must **not** nest under it) and the `.conn-dot--up/--in-progress/--down` block. The new rule goes at `:1401`, and the block comment at `:1382-1390` ("These three rules") goes stale. |
| `src/renderer/src/screens/channels/channels.css:92-108` | `.channel-list__host-dot` — 6px geometry, **no `background`**. The comment at `:92-96` ("the three category → token bindings") goes stale. No rule change here. |
| `src/renderer/src/theme/tokens.css:12-46` | `--color-success` / `--color-warning` / `--color-error` and their comments (why amber was invented), plus `--color-outline` `#8c9199` at `:36`. No token is added. |
| `src/renderer/src/screens/conversation/conversation.css:1935-1944` and `src/renderer/src/screens/settings/settings.css:408-417` | The in-repo precedent for D3: `--color-outline` is already the fill of a small **round off-state chip** (`.run-config__switch-knob` / `.settings__switch-knob`, 16px, `--radius-full`). Same shape, same "not on, not wrong" semantic. |
| `src/renderer/src/screens/conversation/conversation.css:2109-2119` | #560's not-yet-known line — the in-repo precedent that a not-yet-known state explicitly declines `--color-error` because it "is expected before the first turn". The semantic ancestor of this ticket. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1814-1841` | The `relayLeg` describe block. One `it` changes (`:1838-1839`); the other three are the AC's regression guard and stay byte-identical. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1843-1875` | The `daemonLeg` describe block. **Do not touch it** — AC3 is discharged by these four tests still passing unchanged. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1877-1937` | The `ConnectionStatusIndicator` injected-legs matrix — where the new category's status-row case is added. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2496-2507` | The status-row container smoke test: server-renders `<ConversationScreen />` at initial store state. Its comment names the current mapping and goes stale with it. |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:86-96` | `DOT_UP_MARKER` / `DOT_IN_PROGRESS_MARKER` / `DOT_DOWN_MARKER` and the comment explaining why they are the **FULL** attribute value, not the file's usual one-class prefix. § Testing's landmine is exactly this. |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:488-520` | The sidebar container smoke block, including the expected-label array at `:503-508` holding `'Relay Offline'` **twice**. This site post-dates #672's split and is the easy one to miss. |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:579-634` | The `HostConnectionDots` injected-legs block — where the new category's sidebar case is added. |
| `src/shared/ipc/events.ts:45-53` | `RelayLinkStatus` — three members, closed, unchanged by this ticket. Confirms what the exhaustive switch must keep covering. |
| `CLAUDE.md` § Conventions, § Don't | "Test-first"; "don't refactor adjacent code while you are there". Both rejected alternatives in § Design lose to that last one. |

---

## Context

`relayLinkStore` holds `RelayLinkStatus | null`. `null` is the initial "no status has arrived yet"
sentinel — definitionally none of the three categories the wire delivers. The renderer currently collapses
it into the same `down` / "Relay Offline" state as a genuinely dropped socket (`ConversationScreen.tsx:2134`).

That collapse was #330's deliberate choice, written into its ACs and pinned by its tests. It was defensible
when the indicator lived only in the conversation status row, behind a screen the user navigated to. Since
#718 the dots ride the sidebar host row, which is on screen from the first frame of every launch — so the
first thing the app now says is that the relay is offline, before anyone has asked it. "Not known yet" and
"known to be down" are different facts, and a two-dot indicator exists to tell legs apart rather than blur
them.

The daemon/host leg has no equivalent problem: `ConnectionStatus` starts at `{ type: 'disconnected' }` and
has no null, so it needs no new state and gets none.

---

## Design

The whole change is: **one new `LegCategory` member, one new label string, one new CSS rule, and the stale
prose around them.** No new file, no new component, no new prop, no store change, no transport change.

### D1 — A fourth `LegCategory` member: `'unknown'`

`LegCategory` widens from three members to four:

```ts
export type LegCategory = 'up' | 'in-progress' | 'down' | 'unknown'
```

`relayLeg`'s existing pre-switch guard keeps its shape and changes only what it returns:

```ts
if (status === null) return { category: 'unknown', label: 'Relay Unknown' }
```

**Keep the `if`; do not fold `null` into the switch.** The `if` is what leaves the `switch` operating on a
plain `RelayLinkStatus`, and with an explicit return type and no `default` a future fourth member of
`RelayLinkStatus` still trips TS2366. That is the guard AC4 asks not to be weakened, and the smallest
edit preserves it exactly. Moving `null` into the switch as a `case null:` would type-check and would not
weaken anything either — but it is a rewrite of a working line for no behavioural gain, which
§ Don't forbids.

Naming: `'unknown'` over `'not-yet-known'`. It matches the existing members' terseness, matches the label's
own word, and keeps the CSS modifier short (`.conn-dot--unknown`). The ticket's phrase "not-yet-known" is
the *semantic*, and belongs in the comments rather than in the identifier.

### D2 — One new label: `"Relay Unknown"`

`ConnectionLeg.label` is the single naming channel and both surfaces already read it — the status row shows
it as visible text in `.conn-leg__label` (dots `aria-hidden="true"`), the sidebar puts it in `aria-label`
with `role="img"`. So one string satisfies AC1's "carries its own accessible name" on both surfaces at once.
**Do not add a second naming channel** (no per-category title, no visually-hidden text, no aria-describedby).

`"Relay Unknown"` keeps the shipped `<Leg> <StatusWord>` rhythm of "Relay Connected" / "Relay Reachable" /
"Relay Offline" / "Pyrycode Connecting", and stays short — `.conn-leg__label` is `white-space: nowrap` in a
status row that also carries the daemon leg and a chevron inside a chat pane that is only 400px wide at the
800px minimum window width. "Relay Status Unknown" was rejected on that width alone; "Relay Checking" and
"Relay Connecting" were rejected because they claim an in-progress probe that is not happening — #330 gave
the relay leg no in-progress arm on purpose, and this state is the absence of information, not an attempt
to get it.

### D3 — One new colour binding: `.conn-dot--unknown` → `--color-outline`

The new rule is declared **once**, as a fourth sibling in the same block in `conversation.css` immediately
after `.conn-dot--down` (`:1399-1401`):

```css
.conn-dot--unknown {
  background: var(--color-outline);
}
```

**This is the one thing to get right, and the failure mode is silent.** The sidebar's 6px dot wears
`conn-dot--unknown` *without* the `.conn-dot` base (which bakes the status row's 8px box), and
`.channel-list__host-dot` supplies geometry and no `background` of its own. So a fourth binding declared
anywhere else — in `channels.css`, or nested under `.conn-dot`, or as a `.channel-list__host-dot--unknown`
sibling — leaves the sidebar dot with **no background at all**. It disappears, and nothing catches it: the
unit tier renders markup in a node environment and never asserts a computed colour, the Playwright suites
carry no connection locators, and the class name is built by template string so no exhaustive switch
notices the missing arm either. Declared as above, one rule reaches both dot sizes. That is AC2.

**Why `--color-outline` (`#8c9199`).**

1. **It already fills a small round off-state chip in this codebase.** `.run-config__switch-knob` and
   `.settings__switch-knob` are `--radius-full` circles filled with `--color-outline` to mean "not on" —
   same shape, same "neither good nor bad" semantic. This is reuse of a settled decision, not a new one.
2. **It is the only achromatic option.** `up` green, `in-progress` amber and `down` peach are all
   saturated; a grey dot separates from all three by chroma as well as hue, which is what keeps four 6px
   circles distinguishable — including for viewers who cannot separate the existing green/amber/peach trio.
3. **It is the quietest of the four**, which is the point. Contrast against the surface both dots sit on
   (`--color-surface` `#101418`, `channels.css:25`): outline **5.87:1**, success 7.68:1,
   on-surface-variant 10.89:1. Clearly visible at 6px, deliberately recessive — "no news" should not shout.
4. **It carries no valence.** M3's `outline` is the neutral non-semantic role, so nothing about it reads as
   success or failure, which is exactly AC1's "visually distinct from both connected and disconnected".
5. **No new token.** `--color-outline` is already in `tokens.css:36` with ~50 consumers.

**Rejected: `Schemes/Inverse Primary` `#32628d`**, the design's own second dot value. It contrasts at
**2.90:1** against `--color-surface` — dim for a 6px circle, and this is the state seen at *every* cold
start, so a barely-visible dot reads as no dot, which is a worse lie than "offline". It would also need a
new `--color-inverse-primary` token, and it is the design's *off* value, which #330 already spent on
`down`; re-spending it here on a third meaning re-opens a settled decision.

**Rejected: `--color-on-surface-variant` `#c2c7cf`**, #560's not-yet-known token. That is the token of
`.conn-leg__label` — the text sitting immediately to the right of this very dot in the status row. A dot in
its own label's colour reads as a bullet, not a status chip. #560's precedent is about the *semantic*
(not-yet-known declines `--color-error`), and that semantic is honoured here; its specific token is a text
role and does not transfer to a fill.

### D4 — `daemonLeg` is untouched

`LegCategory` is shared by both legs, so widening it widens `daemonLeg`'s return type too. That is fine and
intended: `daemonLeg`'s four arms simply never produce `'unknown'`. Do not add a narrowed return type, a
`RelayLegCategory` alias, or a runtime assertion — AC3 is discharged by `daemonLeg`'s existing four tests
continuing to pass byte-identical, which is a stronger guard than a type gymnastic and costs nothing.

### D5 — The mapping stays where it is

`relayLeg` / `daemonLeg` / `LegCategory` / `ConnectionLeg` stay in `ConversationScreen.tsx`, imported
across screens by `ChannelList.tsx`. **Lifting them into a shared module is out of scope** — #718 weighed
it and chose the cross-screen import (the established idiom here), and moving them now would turn a
6-line behavioural change into a multi-file move with no behavioural gain. Same answer for the CSS: the
three-now-four bindings stay in `conversation.css`, which `ChannelList.tsx` reaches through the module
graph by construction (`ConversationScreen.tsx:13` imports `conversation.css`, and `ChannelList.tsx`
imports from `ConversationScreen.tsx`).

### Comments that go stale with the behaviour

Every one of these asserts the mapping or the count of bindings and is falsified by this change. Update
them in the same pass — a shipped comment describing the old behaviour is the failure mode #718 hit:

| Site | What is now wrong |
|---|---|
| `ConversationScreen.tsx:2115-2116` | "The dot colour is driven ONLY by this (success / warning / error)" — a fourth, neutral colour joins. |
| `ConversationScreen.tsx:2127-2132` | "`null` … maps down (AC1)". Replace with the new mapping *and its reason* (cold start ≠ outage; the relay leg still has no in-progress arm). |
| `ConversationScreen.tsx:2145-2149` | `daemonLeg`'s block — add one clause: it never produces `'unknown'`, the widened member is the relay leg's alone (#719 AC3). |
| `ChannelList.tsx:314-318` | "COLOUR comes from `.conn-dot--up` / `--in-progress` / `--down`" — now four. |
| `ChannelList.tsx:362` | "relay `null` → \"Relay Offline\"" — the initial render's label changes. |
| `conversation.css:1382-1390` | "These three rules have a SECOND consumer since #718" — now four rules; keep the whole warning about moving-not-dropping them, it is load-bearing. |
| `channels.css:92-96` | "the three category → token bindings must NOT be re-declared here" — now four. |
| `ConversationScreen.test.tsx:2496-2499` | "relay = null (→ \"Relay Offline\") … so both legs render down". |
| `ChannelList.test.tsx:86-90` | The marker comment enumerating #718's three markers. |
| `ChannelList.test.tsx:498-501` | "the two singletons' INITIAL values … relay `null`". |

**Deterministic check when you are done:** `grep -rn "Relay Offline" src/` must return exactly seven hits,
all of them genuine `offline`-status sites — `ConversationScreen.tsx:2141`, `ConversationScreen.test.tsx`
`:1832`, `:1833`, `:1891`, and `ChannelList.test.tsx` `:596`, `:603`, `:604` (line numbers shift; the set
does not). Any other hit is stale prose or a missed assertion.

---

## State + concurrency model

Unchanged in every respect. No store slice is added, renamed or re-typed; `relayLinkStore` keeps
`RelayLinkStatus | null` with `initialRelayLinkState = { status: null }`, and `selectRelayLinkStatus` keeps
its signature. Both consumers keep reading through that one narrow selector in their own leaf control
(`ConnectionStatusIndicatorControl`, `HostConnectionDotsControl`), so a relay flap still re-renders only
the dots. No effects, no subscriptions, no async, no teardown surface. This slice changes what a pure
function returns for one input and what one CSS class paints.

---

## Error handling

No new failure mode. `relayLeg` is total over `RelayLinkStatus | null` before and after, returns a
client-owned constant in every arm, and can neither throw nor surface a daemon-supplied string. The only
behavioural delta is which constant one input maps to.

Two guards worth naming because they are the ones that could rot:

- **TS2366 exhaustiveness** (AC4): explicit return type + no `default` on the `switch`. Adding a member to
  `RelayLinkStatus` must still fail the build rather than fall through. Keeping the `null` `if` ahead of
  the switch is what preserves this (D1).
- **A category with no colour rule** paints nothing and fails silently (D3). There is no automated guard
  for this in any tier and this spec does not add one: the failure has not occurred, a CSS-source
  assertion would be a novel test shape in a renderer suite that has no precedent for reading source
  files, and § Manual verification below closes it for the cost of one screenshot. The mitigation that
  ships is the comment in `conversation.css` — keep it accurate.

---

## Testing strategy

Test-first, per CLAUDE.md: write the failing assertions before the mapping change. Unit tier only
(`npm test`, vitest, `environment: 'node'`, `renderToStaticMarkup`). No new test file, no new harness.

**`ConversationScreen.test.tsx` — `relayLeg` block (`:1821-1841`)**

- Rewrite the `null` case: `relayLeg(null)` now equals `{ category: 'unknown', label: 'Relay Unknown' }`.
  Rename the `it` and its comment to state the reason — the initial state is not-yet-known and is
  deliberately neither `down` nor `in-progress`; note that this reverses #330's AC1.
- The `connected` / `daemon-absent` / `offline` cases stay **byte-identical**. `daemon-absent` staying at
  `up` / "Relay Reachable" is a scope boundary the ticket names explicitly; leaving the test untouched is
  the guard.

**`ConversationScreen.test.tsx` — `ConnectionStatusIndicator` block (`:1877-1937`)**

- Add the fourth category to the modifier-class matrix: a render with an `unknown` relay leg contains
  `conn-dot--unknown`, and its label text renders in `.conn-leg__label` so the state reads without colour.
  Fold it into the existing `it` at `:1878` rather than adding a near-duplicate block.

**`ConversationScreen.test.tsx` — status-row container smoke (`:2500-2507`)**

- `toContain('Relay Offline')` → `toContain('Relay Unknown')`. `'Pyrycode Offline'` stays (the daemon leg
  is untouched — this is AC3's cross-check at the container level).
- Add `expect(markup).toContain('conn-dot--unknown')`. This is the assertion that actually proves the
  container renders the new category at rest; the existing `not.toContain('conn-dot--up')` at `:2506`
  passes either way and is not a signal here (keep it — it still guards no-false-green).

**`ChannelList.test.tsx` — markers (`:86-96`)**

- Add `DOT_UNKNOWN_MARKER = 'class="channel-list__host-dot conn-dot--unknown"'`.
- **Landmine:** these markers are the FULL attribute value, not the file's usual one-class prefix. The
  closing quote follows the LAST class, so `'class="channel-list__host-dot"'` silently matches **nothing**
  rather than failing. Copy the shipped four-marker shape exactly.

**`ChannelList.test.tsx` — sidebar container smoke (`:497-509`)**

- The expected-label array holds `'Relay Offline'` **twice** (`:505`, `:507`) — one per host row, since
  `bothTrees()` renders two. Both become `'Relay Unknown'`. `'Pyrycode Offline'` stays at `:504` and `:506`.

**`ChannelList.test.tsx` — `HostConnectionDots` block (`:579-634`)**

- Add the fourth case to the category → modifier binding test at `:588-597`: an `unknown` relay leg renders
  `DOT_UNKNOWN_MARKER`. Same reason as the shipped three — it pins the geometry class and the colour
  binding together, and fails loudly if someone declares a `.channel-list__host-dot--unknown` sibling
  instead of reusing `.conn-dot--unknown`.
- The ordering, independence, `role="img"` and no-visible-text tests need no new case; they are
  category-agnostic and already pass.

**Untouched on purpose**

- The entire `daemonLeg` describe block (`:1843-1875`). AC3 is these four tests still passing unchanged.
- Every Playwright spec. The suites carry **zero** connection-dot, leg-label and `role="img"` locators
  (re-verified at spec time by grep across `e2e/`), so no spec needs updating and the suite count must not
  move. It is **41** at the time of writing (`npm run e2e`), not the 40 an older spec quotes.

**Gates:** `npm test` (renderer suites green, including the neighbouring conversation suites),
`npm run build` (this is where TS2366 would fire if the exhaustiveness guard were weakened),
`npm run e2e` (expected unchanged, 41/41).

---

## Manual verification (recommended, not an AC)

The one risk this ticket cannot test is D3's silent-invisibility. Closing it costs one screenshot and the
technique is already proven in this repo: `<link>` the real `tokens.css`, `conversation.css` and
`channels.css` into a scratchpad HTML holding a 400px-wide mock host row with the four dot classes side by
side, and screenshot it with the repo's own Playwright. Confirm the fourth dot paints, is a plain circle
at 6px, and is separable from green/amber/peach. `npm run dev` is **not** a substitute — the sidebar
populates only when paired to a live daemon.

---

## Scope boundaries

- **`relayLinkStore` is unchanged.** `null` stays the stored sentinel; the wire union
  (`events.ts:53`) stays three-membered; no category is invented on the transport side. Render layer only.
- **`daemon-absent` keeps reading `up` / "Relay Reachable".** The relay genuinely is reachable and the
  missing daemon is the host leg's story. This ticket adds a state *below* that one, not beside it.
- **The host/daemon leg is untouched** — `connecting` stays `in-progress`, `disconnected` and `error` stay
  `down` (AC3).
- **The independent-legs rule from #330 holds.** `relayLeg` and `daemonLeg` each take only their own leg's
  status and never cross-reference.
- **No lifting, no refactoring** of the mapping or the CSS bindings (D5).
- **`docs/knowledge/features/channel-list.md` and `conversation-shell.md` both quote "Relay Offline" and
  are NOT this ticket's to edit** — the documentation phase owns `docs/knowledge/`, and it writes from the
  merged diff. The developer's worktree should mutate `src/` and this spec file only.

---

## Open questions

None blocking. Two things the operator may want to revisit later, neither in scope:

1. **The design file still has no palette for `in-progress`, `down` or `unknown`.** Three of the four dot
   colours are now code-era inventions against a file locked 2026-05-08. That gap is worth closing in
   Figma at some point; it is not resolvable from code.
2. **The status row's own future.** `conversation.css:1382-1390` records that removing the conversation
   status row is a live operator decision (#679) and that whoever does it must *move* the `.conn-dot--*`
   bindings rather than drop them. That warning now covers four rules instead of three — keep it current.
