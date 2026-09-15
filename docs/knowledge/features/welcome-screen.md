# Welcome screen

The desktop app's own first-run explanation screen: what Pyrycode is, plus a clear next step, so a
first run does not land straight on [`PairingScreen`](pairing-input-screen.md)'s paste-your-code form
with no context. Mirrors mobile's `WelcomeScreen.kt`, but unlike every other screen shipped so far it is
built from desktop's **own** Figma frame (`103-744`, 1280×1024, a horizontal hero — mark left, copy
right) rather than the mobile frame stretched to the window.

Introduced in [#657](../codebase/657.md), split from #612 alongside #658 (dormant/route-root split — see
[#612 notes](../codebase/612.md) if present, or the split memory). **Shipped dormant in #657 — nothing
mounted it.** #658 was itself later split into #661 (e2e scaffolding) and
[#662](../codebase/662.md) (the actual route-root wiring). **As of #662, this is the [app shell](app-shell.md)'s
launch destination for every non-paired outcome** — the screen is live, not dormant, and its `onPair`
prop is wired.

## What it does

- Renders a horizontal hero: the pyrycode snowflake mark on the left, a copy column on the right
  (title `Pyrycode`, subtitle `Control multiple Claude server instances.`, and a body paragraph),
  centred in the space above three full-width rows pinned to the bottom of the window.
- A primary CTA, `I already have pyrycode` — a filled pill with a leading QR-frame icon — calls an
  `onPair` prop on click. The prop stays typed as **optional** (`WelcomeView`'s dormant-state test
  renders it with none, and `WelcomeScreen`'s own container leaves it a passthrough), but as of
  [#662](../codebase/662.md) the [app shell](app-shell.md) supplies it at the one mount site, navigating
  to the pairing screen.
- A secondary CTA, `Set up pyrycode first` — a plain anchor (`target="_blank"`) — opens
  `https://pyryco.de/setup` in the OS browser. It is never a same-window navigation and never opens an
  Electron child window; see "How it works" for the mechanism.
- A footer line, `Open source · github.com/pyrycode/pyrycode-desktop`, rendered as plain, non-interactive
  text at reduced opacity. It is not a link.
- A radial glow (`--color-primary-container` fading to transparent, centred at 48%/30% of the frame) lit
  behind the hero, reproducing the Figma frame's dominant visual at any window size.

## How it works

```
src/renderer/src/
├── theme/tokens.css                  # + --color-on-primary, display-large type style, --space-7/8/16
└── screens/welcome/
    ├── WelcomeScreen.tsx             # WELCOME_COPY + SETUP_URL + pure WelcomeView + thin WelcomeScreen
    ├── welcome.css                   # token-only; the pairing.css stylesheet-header convention
    └── WelcomeScreen.test.tsx
```

The `PairingScreen`/`ArchiveScreen` split, taken to its minimum: `WelcomeView` is pure (props in, markup
out — what the tests render), `WelcomeScreen` is a passthrough container with no hooks, no store read,
and no `window.pyry` dereference. It existed from #657 so #662 would have a container to mount; today it
still does nothing `WelcomeView` doesn't already do.

```ts
export interface WelcomeViewProps {
  onPair?: () => void // the navigation seam — PairingScreen.tsx:163's posture (#662 supplies it)
}
export function WelcomeView(props: WelcomeViewProps): JSX.Element   // pure
export function WelcomeScreen(props?: WelcomeViewProps): JSX.Element // passthrough, bridge-free
```

### Copy

One module-level `WELCOME_COPY` constant (the `ARCHIVE_COPY`/`SETTINGS_COPY` idiom), six strings. The
subtitle is deliberately **not** what Figma node `103-754` currently draws: the frame repeats a word
("Control Claude multiple Claude server instances."), re-verified still duplicated as of 2026-08-21. The
shipped copy is the de-duplicated line from the ticket, with a comment on the constant flagging the
divergence as intentional so a later "match the frame" pass doesn't silently reintroduce the typo.
`SETUP_URL` is its own module `const`, never interpolated, never a prop — see "Security notes".

### The setup CTA is an anchor, not a button with an opener

```tsx
<a className="welcome__setup" href={SETUP_URL} target="_blank" rel="noreferrer">
```

`target="_blank"` is the click mechanism, not decoration — it's the same path
[`AssistantMarkdown`](conversation-shell.md) already ships and #610 already reviewed: the click becomes
a window-open request, and `setWindowOpenHandler` (`src/main/index.ts:56-67`) hands `http:`/`https:` to
`shell.openExternal` and denies the in-app window on **every** path. Without `target="_blank"` the click
would instead be a same-document navigation that `will-navigate` (`index.ts:79`) cancels — the link
would look right and silently do nothing. Because the whole behaviour is a property of the emitted
markup, it needs no stub and no seam: the test pins the entire anchor as one exact string
(`AssistantMarkdown.test.tsx:111`'s move), so a shape change (a dropped `target`, an interpolated href)
fails loudly.

The footer is a plain `<p>`, never an `<a>` — a link there would be a second, unspecified external-open
surface the ACs don't call for.

### The two SVGs — inline JSX, no `.svg` file

Both icons are inline JSX (`SettingsScreen.tsx:150`'s idiom), for two reasons: house consistency, and
the renderer's CSP is `default-src 'self'` with no `img-src` (`index.html:6-9`) — an inline `<svg>` is
DOM, not a fetch, so a bundled asset would be the repo's first, for no gain. **Never
`dangerouslySetInnerHTML`** — both paths are built as real JSX elements; grepped clean at code review.

- **The mark**, ported from mobile's `ic_pyry_logo.xml` verbatim (Android `pathData` *is* SVG path
  syntax) — never Figma's generated asset, which uses a 2×-scaled viewport and silently crops if mixed
  with the mobile numbers. It renders with `fill="currentColor"` tinted `--color-primary`, and carries a
  CSS `transform: scaleY(-1)` (`welcome.css:80-86`) — **both** Figma frames (`103:749` desktop, `80:2`
  mobile's own welcome frame) draw this mark vertically flipped relative to what the mobile *app*
  actually renders; the mobile app is the side that diverges from its own design here. See "Lessons
  learned" in [#657 notes](../codebase/657.md) for the measurement that confirmed this rather than
  guessed it.
  **Moved out of this screen's module-private `PyrycodeMark` into the shared `PyryMark` in
  `theme/PyryMark.tsx` by #796**, once the [conversation shell](conversation-shell-composer-status-row.md#composer-status-row-796)'s
  status row needed the same 12 KB path — one drifted copy of a brand mark being a real risk, not a
  hypothetical one. `PyryMark({ className, width, height })` takes the path and viewBox as given and
  renders one `<svg>` with `className` **first** in attribute order, load-bearing because
  `WelcomeScreen.test.tsx:33` asserts the literal string `` `<svg class="welcome__mark"` ``; this
  screen's call site (`<PyryMark className="welcome__mark" width={184} height={208} />`) reproduces the
  prior markup byte-for-byte, and its `scaleY(-1)` stays exactly where it was — in `welcome.css`, on the
  consuming class, not inside the shared component. #796 independently verified the composer status
  row's own vector is this same glyph: its Figma node's coordinates and viewport both divide this one's
  by exactly 6.5.
- **The QR-frame icon** (`QrFrameIcon`) is five stroked paths inherited unchanged from mobile's camera-
  scanner CTA icon, even though desktop pairing is a paste-a-code form — the ticket pins it as drawn.

### CSS token additions (`tokens.css`)

Eight new custom properties, all additive, all on-convention, none off-grid:

| Token | Value | Why |
|---|---|---|
| `--color-on-primary` | `#003355` | M3 dark-scheme on-primary; confirmed via Figma's `Schemes/On Primary` variable, the frame's generated `#035`, and `settings.css:419-421`'s pre-existing comment. First **text** use of this role (two prior screens substituted `--color-surface` on a switch knob instead). |
| `--text-display-large-*` | 57px / 64px / -0.25px / 400 | The hero title's M3 tier; `tokens.css` topped out at `headline-small` before this. |
| `--space-7` | 28px | Copy-block gap; frame vertical padding. |
| `--space-8` | 32px | Frame horizontal padding. |
| `--space-16` | 64px | Mark-to-copy gap. |

All three spacing steps sit on the file's `--space-N = 4×N` grid, so none needed an off-grid name. The
one off-grid value this screen has — a 10px icon-to-label gap — was **not** given a new token; it snaps
to `--space-2` (8px) with a comment noting the 2px delta, following `pairing.css`'s own precedent for
exactly this move (a 4px radius → `--radius-xs`, a 10px padding → `--space-2`, both commented).

**Known stale comments as of this ticket:** `settings.css:421` and `conversation.css:1784-1786` still
assert *"no `--color-on-primary` token exists"* — true when they were written, false now. Both were
flagged as a NIT at code review and left as follow-up rather than fixed here (retro-fitting those two
switch-knob substitutions is out of scope for this ticket). A grep for "no on-primary token" will find
two comments that are now wrong.

## Edge cases and limitations

- **Narrow-window behaviour is unspecified.** The copy column uses `max-width: 560px` rather than
  Figma's fixed width, so it shrinks gracefully below the ~940px point where the hero would otherwise
  crowd — the one concession made here. A real responsive story is deferred to #658 or later, once the
  screen is actually reachable and can be resized in practice.
- **Footer contrast is a documented, un-fixed AA miss.** `.welcome__footer` renders at `opacity: 0.55`
  (Figma's and mobile's own value) over `--color-surface`, which composites to ~4.07:1 — short of WCAG
  AA's 4.5:1 for small text. Code review flagged this as a SHOULD FIX (`opacity: 0.6` clears AA at
  4.61:1 and is visually indistinguishable) but it was not required to merge, since AC5 only asked for
  "reduced opacity" and did not pin the exact value; fidelity to the frame was kept instead. A future
  pass tightening contrast on this line should change one number.
- **The mark is a placeholder in the design itself** — Figma names its node "Pyry Logo (placeholder)".
  Porting mobile's drawable is the faithful choice today; a final mark is an unticketed follow-up.
- **The pair CTA now has e2e coverage; the setup CTA still does not.** [#662](../codebase/662.md) made
  the screen reachable, so all ten `pairFromUnpairedLaunch` drives (`e2e/fixtures/pairingArrival.ts`)
  now click through it, and `smoke.spec.ts` adds a dedicated welcome→pairing→Cancel→welcome round trip.
  The secondary `Set up pyrycode first` anchor's actual OS-browser launch remains untested end-to-end —
  Playwright reaches the screen now, but nothing drives that link. Server-render
  (`renderToStaticMarkup`) tests continue to cover its exact markup instead.

## Related

- [Pairing input screen](pairing-input-screen.md) — the screen this one now precedes in the app shell's
  actual routing, as of [#662](../codebase/662.md); the `onPaired?`/`onCancel?` posture this screen's
  `onPair?` copied verbatim is, since #662, wired on both sides.
- [App shell (router)](app-shell.md) — gained the launch-time route to this screen in
  [#662](../codebase/662.md); untouched by #657.
- [Conversation shell](conversation-shell-composer-status-row.md#composer-status-row-796) — the composer status row's second
  consumer of the shared `PyryMark`, since
  [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796); this screen's own call site and markup
  are unchanged by that move.
- [#657 codebase notes](../codebase/657.md) · [#662 codebase notes](../codebase/662.md) · Spec:
  `docs/specs/architecture/657-welcome-screen.md`,
  `docs/specs/architecture/662-welcome-as-unpaired-root.md`
- Parent: #612, split into #657 (this screen, shipped dormant) + #658, itself split into #661 (e2e
  scaffolding) + #662 (route-root wiring — the screen is now live).
