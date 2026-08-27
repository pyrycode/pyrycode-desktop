# #834 — The sidebar host row shows the operator's label

Size **S**. Terminal leg of the host-label stack (#822 store → #823 write → #824 IPC → #825 pairing
field → #833 renderer store → **#834 the row**), and the first one the user can see.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3094

Node `106:3094` is the shipped host row, unchanged in structure: a 16/4-padded flex row with the 12px
server-rack glyph leading, the label in M3 title-small (`--text-label-large-*` in this repo, an exact
match) at full-strength `--color-on-surface`, and the two 6px connection dots pinned to the trailing
edge. **The only delta this ticket introduces is the label's SOURCE** — the frame draws "Pyrybox", the
operator's name for the machine, where the code renders the constant `'Server'`. The design's label
node (`106:3096`) carries `whitespace-nowrap` and no ellipsis treatment, because the drawn name is
short; the ellipsis this ticket adds is the app's own answer to a 128-character label, taken from the
workspace row one level down, not from the frame.

Everything else on the row — glyph, geometry, type, colour, dot placement — is already shipped to this
frame by #710 and #718. **Do not re-derive it from the Figma; do not restyle the row.**

## Files to read first

Codegraph is wired but not indexed for this repo (`.codegraph/` holds config only — every
`codegraph_*` call errors `CodeGraph not initialized`; re-probed 2026-08-27). This list was built by
hand; treat it as the turn-1 data load and read it before editing.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/channels/ChannelList.tsx:268-320` | `HOST_ROW_LABEL` + `HostRow` — the constant this ticket repurposes and the row it heads. The comment block carries the class-name / strict-mode-locator constraints verbatim; they survive this ticket. |
| `src/renderer/src/screens/channels/ChannelList.tsx:322-394` | `HostConnectionDots` / `HostConnectionDotsControl` — **the pure-view + thin-container split this ticket copies**, including the doc comment explaining why the exported view is the only seam the unit tier can reach a full matrix through. |
| `src/renderer/src/screens/channels/ChannelList.tsx:69-135` | The `ChannelList` container — where `<HostLabelData />` mounts, beside `<ChannelListView />`. |
| `src/renderer/src/screens/channels/ChannelList.tsx:551-621` | `renderBody`'s two `<HostRow />` sites (`:556`, `:596`), both inside their section's `length > 0` gate. Do not hoist. |
| `src/renderer/src/store/hostLabelStore.ts` (whole, 84 lines) | `HostLabelValue`'s four arms and why `loading` is distinct; `useHostLabelStore` + `selectHostLabel`. |
| `src/renderer/src/store/hostLabelLoader.ts:93-115` | `HostLabelData` — the headless one-shot binding, currently mounted nowhere. Read the closing paragraph: it states the mount-site argument this ticket resolves. |
| `src/renderer/src/screens/settings/ServerRow.tsx` (whole, 57 lines) | The exported-pure-view + `…Control` precedent in its simplest form, and the `SERVER_ROW_LABEL` copy idiom. **Note the deliberate divergence:** ServerRow shows a `'Loading…'` placeholder pre-settle; this row must not (see § The collapse). |
| `src/renderer/src/screens/settings/SettingsScreen.tsx:59-66` | The loader-beside-control mount idiom (`<ServerInfoData />` + `<ServerRowControl />`) this ticket reproduces in `ChannelList`. |
| `src/main/hostLabelHandler.ts:50-81` | The main-side read path. Two facts the renderer depends on: the label reaching the window is already bounded at `MAX_HOST_LABEL_LENGTH`, and line 69-71 explicitly hands the "render as escaped text only" obligation to this row. |
| `src/shared/ipc/hostLabel.ts:22-65` | `HostLabelResult`'s three arms; the closing line defers the on-screen fallback to this ticket. |
| `src/shared/ipc/pairing.ts:41` | `MAX_HOST_LABEL_LENGTH = 128` — the number AC4's e2e label is built to. |
| `src/renderer/src/screens/channels/channels.css:41-90` | `.channel-list__host`, `__host-label` (whose comment states the ellipsize exemption this ticket expires) and `__host-status` (`margin-left: auto`). |
| `src/renderer/src/screens/channels/channels.css:173-190` | `.channel-list__workspace-label` — the ellipsize precedent to copy from, minus one declaration (see § CSS). |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:114-180` | The marker-constant + `hostLabelsIn` idiom every new assertion must use. |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:374-433` | The existing `#710` host-row describe block — the home for the new cases. |
| `e2e/fixtures/pairingArrival.ts` (whole, 66 lines) | `pairFromUnpairedLaunch` and its four numbered invariants — invariant 2 (secret hygiene) constrains how the new label parameter may be handled. |
| `e2e/fixtures/launchPairedApp.ts:88-118` | `LaunchPairedAppOptions` vs `LaunchControl` — the new label knob belongs on the latter. |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:95-125, 296-330` | The host-name field lives in `EntryPage`, which is an **alternative phase** to the fingerprint `ReviewCard`. That fixes where the e2e fill goes. |

## Context

`ChannelList.tsx:276` renders `HOST_ROW_LABEL = 'Server'` — a client-owned constant that went in
deliberately, because the row is a **name slot** and `serverId` in it would read as the machine's
name. The whole read path behind the real name has landed and ships dormant: #833's store holds the
value, its loader fetches it, and `HostLabelData` is mounted nowhere. This ticket mounts it and puts
the value on the row.

Nothing about the row's structure, geometry or Playwright-locator posture changes. The work is: one
four-arm collapse, one view/container split, one mount site, four CSS declarations, and the e2e seam
that lets a spec pair with a 128-character name.

## Design

All renderer changes land in **one production file**, `ChannelList.tsx`, plus its stylesheet.

### The collapse

A new exported pure function beside the row:

```ts
export function hostRowLabel(value: HostLabelValue): string
```

Behaviour, one line: returns `value.label` when the value is `stored` **and** that label has
non-whitespace content; otherwise the fallback word. Four arms and one value collapse to the fallback
— `loading`, `not-stored`, `error`, and `stored` carrying a blank label — which is the whole of AC2.

Three things this function must get right, each a decision this ticket owns:

- **The fallback word is `'Server'`** — the word already on the row, not the design's "Host".
  `ChannelList.tsx:268-275` records why: it is the app's own user-facing word for this machine
  (`SERVER_ROW_LABEL`, "Pair another server"), so the sidebar and Settings → Connection read as one
  concept. Rename the existing constant to `HOST_ROW_FALLBACK_LABEL` (one declaration, one use) so the
  name stops claiming to be *the* label, and rewrite its comment: the paragraph currently promising
  that "#688 replaces this constant" is what this ticket discharges. **Do not** merge it with
  `ServerRow.tsx`'s `SERVER_ROW_LABEL` — two screens, two copy constants, deliberately.
- **`loading` falls back to that same word, never to a `'Loading…'` placeholder.** This is the one
  place the ServerRow precedent must *not* be copied. Settings' server row shows a value in a details
  list, where a placeholder reads as "not fetched yet"; this is a name slot, and a placeholder in it
  reads as *the machine's name*. The pre-settle window is a tick, and showing the generic word for
  that tick is indistinguishable from the not-stored steady state — which is correct, because both
  mean "no name to show yet."
- **The fallback predicate is `label.trim() === ''`, but the displayed label is the string
  VERBATIM.** `''` is the case AC2 names; a whitespace-only label is the same case by the same
  argument — AC2 says the row must not render blank, and `'   '` renders blank. One predicate covers
  both. The trim decides *whether* to fall back and never touches *what* is shown, so the row never
  displays a value that differs from what is stored. (If review prefers the narrower `=== ''`, it is a
  one-token change; see § Open questions.)

### View / container split

`HostRow` becomes the exported pure view and gains a thin store-bound container, mirroring
`HostConnectionDots` / `HostConnectionDotsControl` twenty lines below it in the same file:

```ts
export function HostRow({ label }: { label: string }): JSX.Element   // was nullary, was module-private
function HostRowControl(): JSX.Element                                // module-private, like its neighbour
```

`HostRowControl` reads `useHostLabelStore(selectHostLabel)`, passes it through `hostRowLabel`, and
renders `<HostRow label={…} />`. Nothing else. `renderBody`'s two sites (`:556`, `:596`) render
`<HostRowControl />`; both stay inside their `length > 0` gate.

Why the split, restated from the neighbour's own comment: a zustand singleton seeded before a
`renderToStaticMarkup` call is invisible to it — the server renderer reads `getServerSnapshot()`,
wired to the state captured at store creation — so a seed-then-render test on `HostRowControl` can
only ever prove the initial `loading` cell. The four-arm matrix is provable on `hostRowLabel` and the
markup contract on `HostRow`; the container is three lines and is proven by composition, exactly as
`HostConnectionDotsControl` and `ServerRowControl` are.

`HostRow` keeps rendering `<HostConnectionDotsControl />` as its last child, unchanged. The view is
therefore "pure" in the same qualified sense its neighbour already is — it takes its own data as
props; its dot subtree reads two singletons and server-renders their initial cell.

### Where the loader mounts

`<HostLabelData />` mounts in the **`ChannelList` container** (`ChannelList.tsx:69`), as a sibling of
`<ChannelListView />` — the `SettingsScreen` idiom (`<ServerInfoData />` beside `<ServerRowControl />`)
applied to the screen that actually renders the row. It renders `null`, so DOM order is immaterial.

This is the mount site #833 left open, and it is the one AC5 demands. The alternatives both fail:

- **App-level** (beside the nine headless leaves in `App.tsx`) fires once at launch, before pairing,
  and never re-runs — the row would stay stale after a same-session pair. It is also unpaired-reachable,
  which this value is not.
- **`SettingsScreen`** (reusing `ServerInfoData`'s home) is precisely what AC5 forbids: "with no visit
  to the Settings screen first."

Mounting in `ChannelList` gives one read per sidebar mount. `ChannelList` is rendered at the same
element position in both the `list` and `thread` routes (`PairedShell.tsx:161-171`), so React
preserves it across the list↔thread flip and no read fires there; it *does* remount on return from
`settings` / `archive` / `pairServer`, which re-reads — correct, because the Settings → "Pair another
server" path is exactly how the label changes mid-session. Repeated invokes are cheap by construction
(`hostLabelLoader.ts:70-72`): each is an independent local `store.load()`, no amplification, no
mutation, no secret returned.

`HostLabelData` dereferences `window.pyry` only inside its effect, so mounting it in the container
leaves the container's server-renderability intact — the same discipline `onNewConversation` already
relies on. No unit test renders the `ChannelList` container today (the suite imports `ChannelListView`,
`CollapsibleWorkspaceGroup` and `HostConnectionDots` only), so this mount is inert for the unit tier.

### CSS

`.channel-list__host-label` (`channels.css:68-74`) gains **four** declarations:

```
min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
```

and its comment loses the exemption paragraph — "a six-character compile-time constant cannot
overflow the 400px sidebar" is what this ticket expires. Cite `MAX_HOST_LABEL_LENGTH` (128) as the new
bound in its place.

**Deliberately NOT the fifth declaration.** `.channel-list__workspace-label` also carries
`flex: 1 1 auto`; the host label must not. `min-width: 0` alone lifts the flexbox min-content floor,
and the default `flex-shrink: 1` then lets the label shrink and ellipsize. Adding `flex-grow: 1` would
make the label absorb the row's free space and render `.channel-list__host-status`'s `margin-left: auto`
inert — replacing a shipped, documented mechanism for pinning the dots with an implicit one. The
workspace row has no trailing element and no such mechanism to preserve, which is why it differs. State
this divergence in the comment; it is the kind of "copy the neighbour" edit a later reader will
otherwise 'fix'.

No other rule changes. `.channel-list__host` stays `display: flex` with its `--space-3` gap;
`.channel-list__host-status` keeps `margin-left: auto` and `flex: 0 0 auto` and keeps doing its job.

### The one sink that must not appear

The label is untrusted, unbounded-in-content text off disk that main hands over with an explicit
"render as escaped text only" instruction (`hostLabelHandler.ts:69-71`). It reaches the DOM as a React
**text child** and nowhere else. React escapes text children by default, so the text path is free.

**AC3 is a guard against one specific reflex, not a restatement of the house rule.** The standard
companion to ellipsized text is `title={label}` — "hover for the rest" — and that is exactly the
"never into an attribute" case CLAUDE.md forbids and #696's security review made a MUST FIX. The row
carries no `title`, no `aria-label` built from the label, no `id`/`key`/lookup path derived from it,
and no URL. Add none. `WorkspaceRow`'s comment block (`ChannelList.tsx:415-430`) enumerates the same
four declined sinks for the same reason; follow it.

## State + concurrency model

- **Store:** `hostLabelStore` — an existing single-slice zustand singleton holding one
  `HostLabelValue`. This ticket adds **no** state, no setter, no action. It reads through the shipped
  `selectHostLabel`, so the row re-renders on the loader's one settle and on nothing else.
- **Async:** one `invoke` per sidebar mount, owned entirely by `startHostLabelLoad`'s `active` flag
  (shipped and tested in #833). Under StrictMode the invoke runs twice and exactly one write lands.
  This ticket adds no promise, no subscription, no `AbortController`, no teardown.
- **Unidirectional:** the row reads; it never writes. `setHostLabel` keeps exactly one caller, the
  loader.
- **`hostLabelStore` stays out of `clearPairingScopedState`.** That file's doctrine excludes any store
  that re-asserts itself on remount and names `serverInfoStore` — "a one-shot mount invoke" — as the
  worked example. Mounting the loader per sidebar is what makes this store that shape: a stale label
  after unpair resolves on the next paired mount, and #827 already erases the value at rest. Adding a
  clear here would be a second mechanism for an outcome that already holds.

## Error handling

Every failure mode is already classified upstream and arrives as one of the union's arms; this ticket
adds no new failure path and no new branch beyond the collapse.

| Failure | Arrives as | Row shows |
|---|---|---|
| Never paired with a label / label erased by #827 | `not-stored` | `Server` |
| Ciphertext undecryptable, malformed record, over-length on disk (>128) | `error` | `Server` |
| `hostLabel()` invoke rejects (handler absent, main died mid-query) | `error` (loader's `.catch`) | `Server` |
| Structurally-invalid IPC payload / unknown future arm | `error` (`mapHostLabel`'s unconditional tail) | `Server` |
| Query in flight | `loading` | `Server` |
| Operator stored `''` or whitespace only | `stored` | `Server` |
| Operator stored a name | `stored` | that name, verbatim, escaped, CSS-ellipsized |

Consequences worth stating: **no error affordance, no retry, no banner, no toast.** The failure is
cosmetic — a generic word instead of a name — and every recovery path the operator has (re-pair via
Settings → "Pair another server") already exists. Surfacing an unreadable-label error in the sidebar
would put a recovery prompt on a name slot for a value nothing downstream depends on.

**Nothing on any path logs.** No `console.*`, no error interpolation, no length reported — the
handler's classify-don't-forward discipline continues here by carrying nothing forward to carry.

## Testing strategy

### Unit — `src/renderer/src/screens/channels/ChannelList.test.tsx`

Extend the existing `describe('the host row heading each tree (#710)')` block. Use the file's marker
constants and the `hostLabelsIn` reader — assert the shipped copy read back out of the render, never a
restated literal, so a copy change that collides with a section label fails the guard instead of
passing it.

`hostRowLabel` (a plain table over the four arms — no rendering needed):
- `{ status: 'stored', label: 'Pyrybox' }` → `'Pyrybox'`.
- `{ status: 'stored', label: '' }` → the fallback word.
- `{ status: 'stored', label: '   ' }` → the fallback word (blank content, not blank string).
- `{ status: 'not-stored' }` → the fallback word.
- `{ status: 'error' }` → the fallback word.
- `{ status: 'loading' }` → the fallback word — **and the same word the other three produce**, asserted
  as an equality across all four, so a future "Loading…" placeholder fails here rather than shipping.
- `{ status: 'stored', label: 'x'.repeat(128) }` → returns all 128 characters. Nothing slices; the
  truncation is CSS.

`HostRow` (pure view, server-rendered with an injected string):
- A hostile label — e.g. `<img src=x onerror=alert(1)>` — appears in the markup only in its escaped
  form; the raw `<img` substring is absent.
- The rendered markup for a hostile label contains **no `title=`** and, more generally, the label
  string occurs exactly once and only immediately after `HOST_LABEL_OPEN` — i.e. in no attribute
  value. Assert both; the second is what actually pins AC3.
- The row still emits `class="channel-list__host"`, `__host-icon`, `__host-label` and its two dots, and
  the label text contains neither "Channels" nor "Chats" — the strict-mode-locator guards from #710/#718
  survive verbatim.

`ChannelListView` (existing harness, no new fixture):
- With the singleton at its created-in `loading` cell — which is what every server render sees — both
  trees' host rows read the fallback word. This is the regression guard on the ~28 e2e specs and on
  every existing assertion in this file: **the default renders exactly what it renders today.**

Do **not** add a test that reads `channels.css` as text. There is no such precedent in this repo, and
inventing one would be a new pattern in a ticket that needs none — the layout claim is the Playwright
tier's (below), and the markup claim is covered above.

### e2e — `e2e/host-label-sidebar.spec.ts` (new, fake tier)

Only Playwright can prove AC4: `vitest.config.ts` sets `environment: 'node'`, every renderer spec is a
`renderToStaticMarkup` string assertion, and there is no DOM and no layout engine to measure an
ellipsis or a dot's x-coordinate with.

Two small fixture edits make a label reachable through the product UI:

- `e2e/fixtures/pairingArrival.ts` — `pairFromUnpairedLaunch(page, payload, label?)`. When `label` is
  supplied, fill `[aria-label="Host name (optional)"]` **before** clicking Pair: `EntryPage` and
  `ReviewCard` are alternative phases, so the field is gone by the fingerprint card, and the reducer
  carries `state.label` through to confirm. The parameter is optional, so all ten existing call sites
  are untouched. Invariant 2 (secret hygiene) applies to it as written — the label is filled and never
  asserted on by value, never interpolated into a step title, never logged.
- `e2e/fixtures/launchPairedApp.ts` — `LaunchControl` gains `hostLabel?: string`, threaded into the
  drive. It belongs on `LaunchControl` (launch lifecycle), not `LaunchPairedAppOptions` (daemon-reply
  knobs). Document that it is inert alongside `reuseUserDataDir`, which skips the pairing drive
  entirely; no runtime guard.

The spec pairs with a 128-character name — `'Pyrybox '.repeat(16)` is exactly 128 and deterministic —
then, on the sidebar:
- the host label element's `scrollWidth > clientWidth` (the ellipsis is actually engaged);
- `.paired-shell__sidebar`'s box width is still 400;
- `.channel-list__host-status`'s box sits at the row's trailing edge (right edge within the row's 16px
  inset) and does not overlap the label's box;
- the row is populated with no navigation to Settings — the assertion runs on the sidebar the drive
  lands on, which is AC5's executable proof;
- the row carries no `title` attribute.

Note the fake tier seeds one **unpromoted** row (`SEEDED_ROW.is_promoted === false`), so only the Chats
tree renders and this spec sees exactly **one** host row. "Both trees" is the unit tier's claim
(already asserted at `ChannelList.test.tsx:382`); do not try to prove it here.

Pick the label to collide with nothing: no existing locator matches "Pyrybox", and the string carries
none of the suite's `exact: true` names and none of its class tokens. Every other spec pairs without a
label, so the default fake tier keeps rendering `Server` — the 28 specs riding `launchPairedApp` are
structurally unaffected.

### Gates

`npm test`, `npm run typecheck`, `npm run build`, `npm run e2e`. `e2e/` sits outside both tsconfigs and
is never type-checked, so the two fixture edits are only validated by running the suite — run it.

## Security review

Ticket carries `security-sensitive`; this pass was run against the spec above before commit. (The
pipeline's `security-review.md` is not present on disk in this worktree — the pass was run to the
categories and criteria the architect brief names.)

**Trust boundaries.** One value crosses one boundary. The label originates operator-typed at pairing
(#825), is written through `isPairingRequest`'s bound (#823), rests encrypted in `secureStore` (#822),
and is read back by `hostLabelHandler`. It must be treated as **untrusted at the renderer regardless of
that provenance**: an attacker with write access to `userData` (or a value stored before a bound
existed) reaches the same code path, which is precisely why `hostLabelHandler.ts:60-68` re-applies
`MAX_HOST_LABEL_LENGTH` on the *read* side. The renderer's boundary is `window.pyry.hostLabel()` →
`mapHostLabel` (reconstructs a fresh literal, so no extra IPC-payload field rides into renderer state)
→ store → `hostRowLabel` → a React text child. **Enforcement points:** length at
`src/main/hostLabelHandler.ts:68`; shape at `src/renderer/src/store/hostLabelLoader.ts:33-37`; escaping
by React at the single text-child sink in `HostRow`.

**Injection.** The only new sink is `{label}` as a text child, which React auto-escapes. The spec
forbids `title=`, `aria-label`, `id`, `key`, URL and lookup-path uses by name, and requires a test that
the label string occurs in no attribute value — a stronger assertion than "no `title=`", because it
also catches an attribute nobody thought to ban. No `innerHTML`, no `dangerouslySetInnerHTML`, no
`style` interpolation, no CSS custom property fed from the label. The label never becomes a class token,
so it cannot join a Playwright locator's match set or a CSS selector.

**Secret exposure.** The label is display text, not a credential — but the pairing screen's field is
adjacent to the pairing-code field and a mis-paste of the payload into it is an anticipated mistake
(`PairingScreen.tsx:307-315` bounds it for exactly that reason). Consequences honoured here: the label
is never logged (no `console.*` on any path in this ticket), never interpolated into an error, never
put in a test failure diff — the e2e spec asserts geometry and attribute-absence, never
`toHaveText(label)` — and never sent anywhere. A mis-pasted payload prefix would render on the row,
truncated by CSS; that is a pre-existing property of the field, unchanged by this ticket, and the row
is local-only chrome.

**Denial of service / resource.** Length is bounded at 128 UTF-16 code units on both the write and read
sides, so the row cannot be handed an unbounded string. The overflow behaviour is CSS clipping, not
layout growth, which is what AC4 pins. No new timer, no new listener, no retry loop; one invoke per
sidebar mount, each an independent local read with no amplification.

**Fail-safe direction.** Every unclassifiable outcome lands on `error`, and every non-`stored` arm
renders the generic word — the failure direction is "shows less", never "shows a wrong or stale name".
`mapHostLabel`'s unconditional `error` tail means a future union arm or a hostile invoke result cannot
reach `not-stored`, preserving ADR 0005's "never mask an unreadable record as never-stored". The
`loading`→fallback choice is fail-safe in the same direction: the row never claims a name it has not
read. The one residual staleness — the label changing while the sidebar stays mounted — is bounded by
the remount-on-return-from-Settings path, which is the only route by which it can change.

**Rejected as out of scope, deliberately:** renderer-side re-validation of the length (a second bound
that can drift from the first, and `hostLabelLoader.ts:27-30` bans it by name); an error affordance on
the row (a recovery prompt on a name slot, for a cosmetic failure); clearing the store on unpair
(#827 erases at rest, and the loader re-reads on the next paired mount — a second mechanism for an
outcome that already holds).

**Verdict: PASS.** No MUST FIX. The one finding worth carrying into review as a standing check is the
`title=` reflex, which AC3 and the attribute-absence test already cover.

## Open questions

1. **Whitespace-only labels.** The spec collapses `'   '` to the fallback via `label.trim() === ''`,
   on the reading that AC2's "rather than rendering blank" is about what the operator *sees*, not about
   string identity. The narrower `label === ''` is a one-token change if review disagrees; it would
   leave a whitespace-only label rendering a visually empty name slot. Decided rather than deferred so
   the developer does not have to.
2. **Stale forward references in shipped comments.** `hostLabelHandler.ts:70` and
   `shared/ipc/hostLabel.ts:59` defer the fallback decision to "#826" (this ticket's parent, before the
   split) and `channels.css:66` to "#688". Only the two comments this ticket rewrites in
   `ChannelList.tsx` and `channels.css` are in scope; the `src/main` and `src/shared` ones are left
   alone as adjacent edits. Flagging so review reads them as known, not missed.
