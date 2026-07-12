# Spec — Two-dot Relay/Pyrycode connection-status indicator (render) (#330)

The final slice of the two-dot connection indicator (parent #149). The transport (#328) and the
renderer relay-link store (#329) have landed on `main`; both `RelayLinkStatus` and the daemon
`ConnectionStatus` are readable from renderer stores. This slice renders both legs as two labelled,
colour-coded dots on the persistent conversation Status row, mirroring mobile's `ConnectionStatusLine`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-57

The indicator mounts on the conversation **Status row** (node `16-57`), inside its summary slot (node
`16-58`). The two-dot line itself is **not drawn** in Figma — it is a code-era addition (mobile
#397/#398) authored after the file was locked (2026-05-08). Node `16-58` is currently the collapsed
run-config summary ("Opus 4.7 · high · 73% used" — Roboto Mono 12px, muted `on-surface-variant`, with
"73% used" in `--color-success` green), reserved for #181/#182. The dots must **coexist** in that slot
as a distinct sub-element beside — not replacing — that future summary text. For the dot labels and
spacing, match the muted `body-small` convention the row's summary text already uses (node `17-11`, the
Settings "Connection" section header, confirms the mobile label family: `label-large`, primary), so the
dots + labels read as one cohesive status line with the future run-config summary.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:930-959` — `ConnectionBanner` +
  `ConnectionBannerControl`: the **exact pure-view / container split to mirror**. A pure view takes the
  status as a prop (matrix proven by direct server-render); a thin in-file container reads the store and
  passes it down.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:718-746` — `StatusRow`: the mount point.
  Line 733 `<span className="status-row__summary" />` is the empty slot; the indicator mounts **inside**
  it as a distinct child, leaving the slot available for #181/#182's run-config summary text.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:468-470` — `isTurnRunning`: the precedent
  for an **exported pure predicate** tested directly (no store, no render). The two leg-mapping functions
  follow this shape.
- `src/renderer/src/store/relayLinkStore.ts:23-61` — `RelayLinkState`, `useRelayLinkStore`,
  `selectRelayLinkStatus`. The relay leg reads `RelayLinkStatus | null` (`null` = relay not yet up).
- `src/renderer/src/store/sessionStore.ts:16-20` and `:164-170` — the `ConnectionStatus` union
  (`disconnected | connecting | connected | error`) and `useSessionStore` / `selectStatus`. The daemon leg.
- `src/shared/ipc/events.ts` — the `export type RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'`
  declaration + its docstring (the categories are **content-free** — no token/key/frame/close-code, the
  #328 guarantee).
- `src/renderer/src/theme/tokens.css` — the Colors block; `--color-success` (#2fc038) and `--color-error`
  (#ffb4ab) are the last two colour tokens. **Add `--color-warning` beside them** (see § Theme token).
- `src/renderer/src/screens/conversation/conversation.css:748-779` — `.status-row` / `.status-row__summary`
  / `.status-row__chevron`: where the dot, label, and layout styles go. Also `:134-145` (`.conversation__banner`)
  for the semantic-accent idiom, and `:1393-1398` (`.run-config__context-fill`) for the existing
  `--color-success` swatch precedent.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-30` and `:405-430` — the
  `renderToStaticMarkup` test idiom (no jsdom) and the `ThinkingIndicator` / `isTurnRunning` shapes to
  mirror for the pure-view render tests and the mapping-function unit tests.

## Context

Desktop gives no at-a-glance connection state today. Mobile's live-testing lesson (2026-06-08): show each
leg independently so "relay up, daemon still handshaking" is an honest, expressible state rather than a
single false "connected." This complements the failure-only `ConnectionBanner` (#279): the banner appears
on error; this indicator is the persistent at-a-glance state. Everything here is **pure presentation** —
no transport, no IPC, no keys/sockets. The relay categories are content-free (#328), so nothing
daemon-supplied reaches the DOM.

## Design

All new code lives in `ConversationScreen.tsx` (the `ConnectionBanner` file, per the ticket) plus its
stylesheet — no new module. The shape mirrors the established pure-view/container/predicate trio.

### Types + leg-mapping predicates (exported, pure)

```ts
export type LegCategory = 'up' | 'in-progress' | 'down'
export interface ConnectionLeg { category: LegCategory; label: string }

export function relayLeg(status: RelayLinkStatus | null): ConnectionLeg
export function daemonLeg(status: ConnectionStatus): ConnectionLeg
```

`label` is the **full visible string** (leg name + status word) so the pure view stays dumb — it renders a
dot coloured by `category` and the `label` text, nothing else. Baking the status word into the label makes
AC2 (legible without colour) a property proven by rendering the view, and keeps the leg name ("Relay" /
"Pyrycode") out of the daemon-status data path.

**Leg → category → label matrix** (mirror mobile's `ConnectionStatusLine`):

| `relayLeg(status)` | category | label |
| --- | --- | --- |
| `'connected'` | `up` | `Relay Connected` |
| `'daemon-absent'` | `up` | `Relay Reachable` — distinct label; the missing daemon is the **daemon leg's** story, not a relay failure |
| `'offline'` | `down` | `Relay Offline` |
| `null` | `down` | `Relay Offline` — relay not yet up (AC1's initial not-connected state; **down**, not in-progress) |

| `daemonLeg(status.type)` | category | label |
| --- | --- | --- |
| `'connected'` | `up` | `Pyrycode Connected` |
| `'connecting'` | `in-progress` | `Pyrycode Connecting` |
| `'disconnected'` | `down` | `Pyrycode Offline` |
| `'error'` | `down` | `Pyrycode Offline` |

The relay leg has **no in-progress arm**; the in-progress category is exercised only by the daemon leg's
`connecting` (AC3 — the daemon dot reaches `up` only on `connected`, never `connecting`). The two functions
are independent; **neither leg's category forces the other's** (AC4) — they are pure functions of their own
input with no cross-reference. See § State + concurrency model for why relay-`up` + daemon-`down` is a
legitimate, intended render, not a bug to reconcile.

**Exhaustiveness.** `relayLeg` handles `null` first, then `switch`es the 3-arm `RelayLinkStatus`; `daemonLeg`
`switch`es the 4-arm `ConnectionStatus` on `.type`. Give each an explicit `ConnectionLeg` return type and
**no `default`** so a future union member trips TS2366 ("not all code paths return") — the standing desktop
exhaustive-switch guard, not `noImplicitReturns`.

### Pure view (exported)

```ts
export function ConnectionStatusIndicator(props: {
  relay: ConnectionLeg
  daemon: ConnectionLeg
}): JSX.Element
```

Renders a wrapper span holding the two legs in order (relay, then daemon). Each leg is a dot span + a label
span. Behaviour summary:

- Wrapper: `<span className="status-row__connection" role="group" aria-label="Connection status">`. A group
  with a static aria-label (not a live region) — this is the persistent at-a-glance state; the banner (#279)
  already politely announces disconnects, so a second live region here would double-announce.
- Each leg: `<span className="conn-leg"><span className="conn-dot conn-dot--{category}" aria-hidden="true" />
  <span className="conn-leg__label">{label}</span></span>`. The dot is decorative (`aria-hidden`) — the
  colour is redundant with the label text (AC2). The category drives **only** the dot's modifier class
  (`--up` / `--in-progress` / `--down`); the label carries the legible status word.

Pure props-in/markup-out and exported, so tests server-render the full category×label matrix directly with
injected `ConnectionLeg` props and no store (the `ConnectionBanner` / `ThinkingIndicator` discipline).

### Container (in-file, not exported)

```ts
function ConnectionStatusIndicatorControl(): JSX.Element
```

Reads both stores with narrow selectors and passes the mapped legs to the pure view:

- `const relayStatus = useRelayLinkStore(selectRelayLinkStatus)` → `relayLeg(relayStatus)`
- `const daemonStatus = useSessionStore(selectStatus)` → `daemonLeg(daemonStatus)`

Two independent single-slice reads (the `ScreenSnapshotControl` precedent, which already reads two
orthogonal stores). No `window.pyry`, no IPC, no effects — a pure read, so the server-rendered smoke test
touches no bridge. Mounted **inside** `StatusRow`'s summary slot:

```tsx
// StatusRow, replacing the empty self-closing span at line 733:
<span className="status-row__summary">
  <ConnectionStatusIndicatorControl />
  {/* #181/#182: the run-config summary text ("Opus 4.7 · high · 73% used") renders here
      as a sibling, beside the dots — this slot is not claimed exclusively. */}
</span>
```

`status-row__summary` becomes a flex row (see § CSS) so the dots and the future run-config text sit side by
side. This satisfies AC5 (mounted on `status-row__summary`, persistently visible) and the coexistence note
(a distinct sub-element that does not foreclose #181/#182).

### Theme token

Add one token to `tokens.css`, in the Colors block after `--color-error`:

```css
--color-warning: #ffca45; /* Amber for the in-progress connection category (#330). M3 has no
                             warning role and the design system has no such variable (the two-dot
                             line post-dates the 2026-05-08 file lock — a code-era addition, like
                             the dots themselves). A dark-scheme warm amber (~tone 80, the band
                             --color-error sits in), clearly distinct from --color-success green and
                             --color-error peach so the three dot categories are colour-separable. */
```

Named `--color-warning` (not `--color-in-progress`) to join `--color-success` / `--color-error` as the
third reusable semantic-status role — the ticket's "add one for the in-progress category" instruction, with
a role name a later amber need can reuse rather than a one-off. Ported ahead-of-consumer is the established
tokens.css convention.

### CSS (`conversation.css`)

Contract-level — the developer writes the exact rules; these are the classes and their load-bearing
properties. Dot category → colour is the only matrix that must match the spec:

- `.status-row__summary` — becomes `display: flex; align-items: center; gap: var(--space-3); min-width: 0`
  (`min-width: 0` lets it shrink/truncate when #181/#182 adds text). Currently it has no rules.
- `.status-row__connection` — `display: flex; align-items: center; gap: var(--space-3)` (the two legs).
- `.conn-leg` — `display: flex; align-items: center; gap: var(--space-1)` (dot + its label).
- `.conn-dot` — an 8px circle: `width/height: 8px; border-radius: var(--radius-full); flex: 0 0 auto`.
  (8px is structural component geometry — the `.run-config__context-bar` precedent.)
- `.conn-dot--up { background: var(--color-success) }`,
  `.conn-dot--in-progress { background: var(--color-warning) }`,
  `.conn-dot--down { background: var(--color-error) }` — **the category→colour contract**.
- `.conn-leg__label` — `body-small` on `--color-on-surface-variant`, `white-space: nowrap`, matching the
  row's existing muted summary treatment (the four `--text-body-small-*` tokens).

## State + concurrency model

- **Two orthogonal store slices, read independently.** Relay leg ← `relayLinkStore` (single-value
  `RelayLinkStatus | null`, one setter, #329). Daemon leg ← `sessionStore.status` (`ConnectionStatus`,
  #199-era). No new store, no new bridge, no daemon-event subscription — both stores are populated app-wide
  already; this slice only reads them. The narrow selectors re-render the control only on its own leg's
  change.
- **Independent legs — do NOT reconcile (AC4).** #328/#329 deliberately route *fatal* session closes
  (`4401`/`4421`/`4426`) to the daemon leg's failure, never the relay leg. After a fatal close the relay
  store's `status` stays at its last value (typically `connected`), so the render may legitimately show
  relay = up while daemon = down. A retryable `daemon-absent` (4404) close leaves the daemon leg at
  `connecting` while the relay reads `daemon-absent` → up/"Reachable". Both are the intended
  independent-legs behaviour (confirmed in `src/main/daemonConnection.ts`: `relayLinkChanged` is emitted
  only from the relay socket's up/retryable-close events, and the daemon session status is driven
  separately). The mapping functions never reference each other — the independence is structural.
- **No local state, no effects, no cancellation.** Pure render off two subscriptions; nothing to tear down.
- **Server-render safety.** Under `renderToStaticMarkup` zustand reads `getInitialState()`: relay `null` →
  down, daemon `disconnected` → down, so the container renders two "Offline" dots — no throw, no bridge
  access.

## Error handling

No failure modes in this slice — it is pure presentation over already-validated, content-free store state.
The categories are the *rendering* of connection failure (the `down` dot + "Offline" label); there is no
network, socket, parse, or permission surface here. A daemon `error` status maps to `down`/"Offline" (the
banner #279 owns the prominent error surface and any message text; this indicator deliberately renders
**no** `ConnectionError.message`, so no daemon-supplied string reaches the DOM).

## Testing strategy

`ConversationScreen.test.tsx`, `renderToStaticMarkup` idiom, no jsdom. Two groups:

**Mapping-function unit tests (no render, the `isTurnRunning` shape).** Import `relayLeg` / `daemonLeg` and
assert the full matrix:
- `relayLeg`: `'connected'`→`{up, "Relay Connected"}`; `'daemon-absent'`→`{up, "Relay Reachable"}`;
  `'offline'`→`{down, "Relay Offline"}`; `null`→`{down, "Relay Offline"}`.
- `daemonLeg`: `connected`→`{up, "Pyrycode Connected"}`; `connecting`→`{in-progress, "Pyrycode Connecting"}`;
  `disconnected`→`{down, "Pyrycode Offline"}`; `error`→`{down, "Pyrycode Offline"}`.

**Pure-view render tests (`ConnectionStatusIndicator` with injected legs).**
- Category → dot class: rendering `{category:'up'}` yields `conn-dot--up`; `'in-progress'`→`conn-dot--in-progress`;
  `'down'`→`conn-dot--down`. Cover all three (assert the `--in-progress` dot uses the warning class, the AC3 no-false-green story on the daemon leg via `daemonLeg('connecting')` → in-progress, never up).
- Labels present: the injected `label` strings appear in the markup (legibility-without-colour, AC2).
- **Independent legs (AC4):** render `relay={category:'up'}` + `daemon={category:'down'}` and assert one
  `conn-dot--up` and one `conn-dot--down` coexist — proving neither leg forces the other.
- Dots are `aria-hidden` and the wrapper carries `role="group"` + the aria-label.
- Apostrophe-free copy (all labels above are); `renderToStaticMarkup` escapes `'` → `&#x27;` — the standing
  desktop lesson (not triggered here, but keep fixtures apostrophe-free).

**Container smoke.** The existing `ConversationScreen` server-render smoke test now renders two "Offline"
dots inside the status row (initial store state). Confirm it still passes; if any existing assertion checks
the status-row slot is literally empty, update it to expect the indicator — no new store wiring needed.

Type coverage: `npm run typecheck`. The two exhaustive switches (no `default`, explicit return type) are the
compile-time guard against a future `RelayLinkStatus` / `ConnectionStatus` member landing unhandled.

## Open questions

- **Screen-reader announcement inside the button.** The indicator sits inside `StatusRow`, a `<button
  aria-label="Run configuration">`; the button's aria-label overrides its inner text as its accessible
  *name*, so the connection labels are visible content but not announced as the button name. This satisfies
  AC2 (colour-independence via **visible** text) and matches where Figma places the summary text (inside
  the row button). A dedicated live-region announcement is out of scope — the banner (#279) already
  announces the disconnect transition. Flagged so code-review reads this as deliberate, not an oversight.
- **Coexistence with #181/#182.** This slice makes `status-row__summary` a flex row and mounts the dots as
  the first child; #181/#182's run-config summary lands as a sibling text node beside them. If that ticket
  prefers the summary text *left* of the dots, it reorders within the same flex slot — a one-line change,
  no structural conflict.
