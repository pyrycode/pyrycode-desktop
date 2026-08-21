# #657 — Welcome screen: hero, CTAs, and footer per Figma 103-744

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-744

A 1280×1024 desktop frame on a near-black `--color-surface` canvas lit by a large, soft radial glow in `--color-primary-container` behind the hero. The hero is a horizontal row — the light-blue snowflake mark on the left (184×208), a copy column on its right (display-large title, title-large subtitle, title-large body capped at 560px) — vertically centred in the space above three full-width rows pinned to the bottom: a filled `--color-primary` pill with a leading 20px QR-frame icon, a bare centred text row, and a small dimmed footer line. Everything is centred/full-width against a 32px horizontal, 28px vertical frame padding.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/pairing/PairingScreen.tsx:36-70`, `:161-210` | **The exact shape to copy.** `PairingViewProps` + pure `PairingView` (props in, markup out), then the thin container with **optional** navigation props (`onPaired?`/`onCancel?`, `:163-164`) that ship dormant. This ticket is the same split with one optional prop. |
| `src/renderer/src/screens/pairing/pairing.css:1-9` | **The stylesheet-header convention that resolves AC6.** It states the rule verbatim: every *theme* value (colour/type/spacing) is a token; "bare structural geometry" (100%, a max-width, a fixed min-height, an opacity) stays a literal and is *named in the header*. Follow this, header and all. |
| `src/renderer/src/screens/pairing/pairing.css:54-56`, `:130-131` | **The off-grid precedent that this spec applies to the 10px icon gap.** Two cases where a design value (4px radius, 10px padding) is snapped to the nearest existing token and the ~2px delta is noted in a comment — the house move, used twice in one file. |
| `src/renderer/src/theme/tokens.css:1-11`, `:46-101` | The file header (which explicitly endorses growth), the four-token type-scale convention, and the `--space-N = 4×N` scale you extend. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:144-171` | **The external-link mechanism and its rationale.** `target="_blank"` *is* the click mechanism (window-open → main's handler); a plain anchor is a same-document navigation that `will-navigate` cancels, so it renders correctly and does nothing. `rel="noreferrer"` reasoning is there too. |
| `src/main/index.ts:53-67`, `:79-81` | The sink: `setWindowOpenHandler` re-derives the scheme, hands http/https to `shell.openExternal`, and returns `deny` on **every** path — so AC4's "never in the app window" holds by construction. `will-navigate` (`:79`) is why the anchor needs `target="_blank"`. |
| `src/renderer/src/screens/settings/SettingsScreen.tsx:150-166` | The inline-JSX-SVG icon idiom: `<svg viewBox width height fill="currentColor" aria-hidden="true"><path d="…"/></svg>`. |
| `src/renderer/src/screens/pairing/PairingScreen.test.tsx:1-24` | The renderer test idiom — `renderToStaticMarkup` over the pure view via a local `renderView()` helper; the container gets a "renders without throwing" smoke only. |
| `src/renderer/src/App.test.tsx:26-44` | The `globalThis.window` stub idiom in `beforeEach`/`afterEach`. **Read it to confirm you do not need it** — see "Testing strategy". |
| `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:100-136` | How an anchor is asserted: the whole `<a …>` pinned as **one** exact string, `target="_blank"` deliberately inside it. |
| `src/renderer/src/index.css:5-9` | The `html, body, #root { height: 100% }` chain — why `.welcome` can use `height: 100%`. |
| `src/renderer/index.html:6-9` | The CSP (`default-src 'self'`, no `img-src`). Relevant to the "inline SVG, no `.svg` file" ruling below. |
| `/Users/juhanailmoniemi/Workspace/Projects/pyrycode-mobile/app/src/main/res/drawable/ic_pyry_logo.xml` | **The mark's path data.** Absolute path given deliberately — `../pyrycode-mobile` from this worktree does *not* resolve (worktrees live under `.pyrycode-worktrees/`). |
| `/Users/juhanailmoniemi/Workspace/Projects/pyrycode-mobile/app/src/main/java/de/pyryco/mobile/ui/onboarding/WelcomeScreen.kt:36-80` | The mobile original: the glow's centre/radius, the primary-tinted mark, the 28px copy gap, the 32px horizontal padding. Corroborates the Figma geometry below. |

## Context

Desktop currently opens straight onto `PairingScreen` — a paste-your-code form with no explanation of what the app is. Mobile has had a welcome screen since its #7, and this is the desktop counterpart, built from desktop's **own** Figma frame rather than the mobile frame stretched to the window (a first for this codebase).

The screen **ships dormant**: built, styled, tested, mounted by nothing. Making it the launch destination is #658. This is the same staging `PairingScreen` used — it shipped `onPaired?`/`onCancel?` as navigation seams before the shell supplied them (`PairingScreen.tsx:163-164`).

Because nothing mounts it, **there is no e2e tier in this ticket**. Playwright cannot reach an unrendered screen; the click-driven criteria (AC3's navigation, AC4's actual browser launch) become reachable only once #658 mounts it. Say so if code-review asks why `e2e/` is untouched.

## Design

### Module structure

Three new files under a new `src/renderer/src/screens/welcome/` directory, plus one edit to the theme file. This mirrors `screens/pairing/` and `screens/archive/` exactly.

```
src/renderer/src/screens/welcome/
├── WelcomeScreen.tsx       # WELCOME_COPY + SETUP_URL + pure WelcomeView + thin WelcomeScreen
├── welcome.css             # imported by WelcomeScreen.tsx (the ./archive.css / ./pairing.css idiom)
└── WelcomeScreen.test.tsx
src/renderer/src/theme/tokens.css   # MODIFIED — see "Token additions"
```

No new store, no new IPC, no new bridge method, no new shared type. The screen has no state, no effects, no async work, and reads nothing.

### Public surface

```ts
export interface WelcomeViewProps {
  onPair?: () => void // the dormant navigation seam — PairingScreen.tsx:163's posture
}
export function WelcomeView(props: WelcomeViewProps): JSX.Element   // pure: props in, markup out
export function WelcomeScreen(props?: WelcomeViewProps): JSX.Element // thin container
```

Three exported symbols. `WelcomeScreen` is a passthrough today — it exists so #658 has the container to mount and so the view/container split is already in place when a container concern arrives. Do **not** give it hooks, a store read, or a `window.pyry` dereference; unlike `PairingScreen` it needs no bridge, and keeping it bridge-free is what makes AC7's no-Electron-bridge render trivially true.

`onPair` is optional and called through `onPair?.()` from the primary CTA's `onClick`. With the prop omitted the button renders and clicking it is a no-op — the dormant state.

### Copy

One module-level `const WELCOME_COPY = { … } as const`, the `ARCHIVE_COPY` / `SETTINGS_COPY` idiom (`ArchiveScreen.tsx:17-23`). Five strings, verbatim:

| Key | String |
|---|---|
| `title` | `Pyrycode` |
| `subtitle` | `Control multiple Claude server instances.` |
| `body` | `Pyrycode runs Claude on your computer or home server. Channels and conversation history live on your machine, accessible from any device.` |
| `pairCta` | `I already have pyrycode` |
| `setupCta` | `Set up pyrycode first` |
| `footer` | `Open source · github.com/pyrycode/pyrycode-desktop` |

The footer separator is U+00B7 MIDDLE DOT (`·`), not a hyphen or a bullet.

**The subtitle diverges from Figma on purpose.** Node `103-754` still reads `Control Claude multiple Claude server instances.` (re-verified 2026-08-21 in the fetched design context) — a repeated word. Ship the de-duplicated line above and leave a one-line comment on the constant saying why, so a later "match the frame" pass reads it as intentional rather than drift.

Separately: `SETUP_URL = 'https://pyryco.de/setup'` as its own module-level `const`, never interpolated, never a prop, never a template literal. See "Security review".

### Markup contract

```
div.welcome                          column, justify-content: space-between, height 100%
├── div.welcome__hero-area           flex: 1, centred on both axes  (Figma 103:745)
│   └── div.welcome__hero            row, gap --space-16, align-items: center  (103:746)
│       ├── svg.welcome__mark        184×208, fill currentColor  (103:748)
│       └── div.welcome__copy        column, gap --space-7, max-width 560px  (103:751)
│           ├── div.welcome__title-group   column, gap --space-2  (103:752)
│           │   ├── h1.welcome__title      display-large, on-surface  (103:753)
│           │   └── p.welcome__subtitle    title-large, on-surface-variant  (103:754)
│           └── p.welcome__body            title-large, on-surface-variant  (103:755)
└── div.welcome__ctas                column, gap --space-3, padding-top --space-3  (103:756)
    ├── button.welcome__pair         filled pill, --color-primary  (103:757)
    │   ├── svg.welcome__pair-icon   20×20, stroke currentColor  (103:758)
    │   └── span.welcome__pair-label label-large, on-primary  (103:764)
    ├── a.welcome__setup             bare centred row, label-large, on-surface  (103:765/766)
    └── p.welcome__footer            label-small, on-surface-variant, opacity .55  (103:767/768)
```

`h1` for the title (it is the page heading); everything else is `p`/`span`. The mark carries `aria-hidden="true"` — the adjacent `h1` already names the app — as does the CTA icon, whose meaning is carried by the label beside it.

### The two CTAs — the load-bearing decision

**Primary** is a `<button type="button" onClick={() => onPair?.()}>`. Nothing more.

**Secondary is an anchor, not a button with an opener:**

```tsx
<a className="welcome__setup" href={SETUP_URL} target="_blank" rel="noreferrer">
```

This is the ruling the ticket left open ("a pure, React-free seam **or** a stubbed opener"). The anchor is strictly better on all three axes:

- **Mechanism.** It reuses `AssistantMarkdown.tsx:167` verbatim — the path this app already ships and has already security-reviewed (#610). The click becomes a window-open request; `setWindowOpenHandler` (`index.ts:56`) hands the URL to `shell.openExternal` and returns `deny` on every path, so AC4's "never in the app window" is guaranteed by the sink, not by this screen's care.
- **Testability.** It needs no seam, no stub, no `globalThis.window`. The whole behaviour is a property of the emitted markup, so a `renderToStaticMarkup` assertion proves it — which is exactly the tier this repo has. A `window.open` button would need a stubbed opener to say anything at all, and would still not prove what the OS received.
- **Semantics.** It is a link to an external page. `rel="noreferrer"` is carried over for correctness-in-isolation (the handler never constructs a child window, so there is no opener to sever — it is belt to that suspender, per `AssistantMarkdown.tsx:157-159`).

`target="_blank"` is **not decoration**. Without it the click is a same-document navigation that `will-navigate` (`index.ts:79`) cancels: the link looks right and does nothing, and every tier below e2e still passes. Pin the full anchor as one exact string in the test (the `AssistantMarkdown.test.tsx:111` move) so a later edit cannot drop the attribute quietly.

The footer is a `<p>`, never an `<a>` (AC5). Mobile renders it as a plain `Text` with no `uriHandler`; the Figma node is a plain `<p>` at .55 opacity. A link there would be a second, unspecified external-open surface.

### The two SVGs — inline JSX, no `.svg` file

Keep the house idiom (`SettingsScreen.tsx:150`), and note there is now a second reason beyond consistency: the renderer's CSP is `default-src 'self'` with **no `img-src`** (`index.html:6-9`). An inline `<svg>` element is DOM, not a fetch, so it has no CSP interaction at all. Adding the repo's first bundled `.svg` would put an asset-loading question on a `security-sensitive` ticket for no gain.

**Never use `dangerouslySetInnerHTML`** to shortcut the large path — build real JSX elements. This is a hard rule, not a preference; see "Security review §4".

**The mark (`103:748`).** Port the single `android:pathData` from
`/Users/juhanailmoniemi/Workspace/Projects/pyrycode-mobile/app/src/main/res/drawable/ic_pyry_logo.xml`
into one `<path d="…">`. Android `pathData` *is* SVG path syntax — copy it verbatim, no conversion. Use that file's viewport as the `viewBox`:

```
viewBox="0 0 91.002 103.812"   width="184"   height="208"   fill="currentColor"
```

⚠ **Do not mix sources.** Figma's generated asset for the same mark uses a 2× viewport (`182.004 × 207.623`) and therefore 2×-scaled coordinates. Using Figma's `d` with mobile's `viewBox` (or the reverse) silently renders the mark at half or double size, cropped. Take both numbers from the same file. The mobile drawable is preferred because it is on disk, does not expire, and guarantees mark parity with mobile.

**Colour:** `fill="currentColor"` with `.welcome__mark { color: var(--color-primary) }`. Figma's node is named "Pyry Logo (placeholder)" and carries a raw `#7AB8E8` that is **not** bound to any variable — so it is not a token to port. Mobile tints this drawable with `colorScheme.primary` (`WelcomeScreen.kt:~72`), which is `--color-primary` here; that is both the faithful reading and the only one AC6 permits.

**The QR-frame icon (`103:758`).** Five stroked paths, `viewBox="0 0 20 20"`, `width="20" height="20"`, `fill="none"`, and on each path `stroke="currentColor" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"`. Set the stroke via `.welcome__pair-icon { color: var(--color-on-primary) }` so it tracks the label beside it. The `d` values, verbatim:

```
M2.5 5.83333V4.16667C2.5 3.72464 2.67559 3.30072 2.98816 2.98816C3.30072 2.67559 3.72464 2.5 4.16667 2.5H5.83333
M17.5 5.83333V4.16667C17.5 3.72464 17.3244 3.30072 17.0118 2.98816C16.6993 2.67559 16.2754 2.5 15.8333 2.5H14.1667
M2.5 14.1667V15.8333C2.5 16.2754 2.67559 16.6993 2.98816 17.0118C3.30072 17.3244 3.72464 17.5 4.16667 17.5H5.83333
M17.5 14.1667V15.8333C17.5 16.2754 17.3244 16.6993 17.0118 17.0118C16.6993 17.3244 16.2754 17.5 15.8333 17.5H14.1667
M6.66667 10H13.3333
```

(Four corner brackets and a centre scan line. Keep the icon as drawn — desktop pairing is a paste form, not a scanner, but that is mobile-inherited design intent and the ticket pins it.)

### The background glow — in scope

The frame's dominant visual is a radial glow that neither the ACs nor the Technical Notes mention. It is not optional decoration: shipping a flat surface would be a visible miss against "per Figma `103-744`". Both sources agree on it, and both resolve to tokens already in the file.

Figma's `103:744` fill is a radial gradient over base `#101418` (= `--color-surface`), centre `(608.93, 304.22)` in a 1280×1024 box → **(47.6%, 29.7%)**, first stop `#134a74` (= `--color-primary-container`), fully transparent by offset 0.7 → an ending ellipse of ≈ 618 × 574 px, i.e. **48% × 56%** of the box. Mobile independently uses centre `(0.48w, 0.30h)` (`WelcomeScreen.kt:54-56`) — the same point.

Express the radii and centre as **percentages, not px**: the window is 1100×800 and resizable, so a px-sized glow drifts off-centre as soon as the user resizes, while percentages reproduce the frame at every size.

```css
background:
  radial-gradient(ellipse 48% 56% at 48% 30%, var(--color-primary-container), transparent),
  var(--color-surface);
```

Two colour stops, both tokens; the geometry is bare structural geometry per the `pairing.css` header rule. (Chromium interpolates gradients in premultiplied alpha, so fading to `transparent` produces no grey halo — no `color-mix` needed.)

**Explicitly not shipped:** the hero's `M3/Elevation Light/3` drop shadow (`103:746`) and the root frame's `rounded-[4px]`. The shadow is two black shadows at 0.15/0.30 alpha behind light text on a near-black canvas — imperceptible, and reproducing it would mean inventing an elevation token family for zero visual gain. The 4px radius is a Figma frame artifact; the real window has no rounded content box. Both are deliberate omissions, recorded here so code-review reads them as decisions rather than misses.

### Token additions (`src/renderer/src/theme/tokens.css`)

Eight new custom properties. Every one follows a convention already in the file; none is off-grid.

**Colour — one token.**

```css
--color-on-primary: #003355;
```

This is the M3 dark-scheme on-primary for this palette and is confirmed three ways: Figma's `get_variable_defs` on `103:757` returns `Schemes/On Primary = #003355`; the frame's generated code emits `#035`; and `settings.css:419-421` already records "≈ the Figma knob **#003355**" in the comment explaining its substitution. Add it beside `--color-on-primary-container`.

> Correcting one line of the ticket's Technical Notes: the Figma-literal trap is real in general, but **not for this node** — `103-744` resolves against the *dark* mode, and every literal it emits (`#e0e2e8`, `#c2c7cf`, `#9dcbfc`, `#101418`, `#134a74`, `#003355`) already matches `tokens.css`. The note's claim that on-primary comes out as `white` does not reproduce. The rule that survives regardless is the safe one: **map by M3 role name, never by literal**, because which mode a fetch resolves against is not under your control.

**Type — one four-token style,** in the file's existing order (display sits above headline):

```css
--text-display-large-size: 57px;
--text-display-large-line: 64px;
--text-display-large-tracking: -0.25px;
--text-display-large-weight: 400;
```

**Spacing — three steps.** The scale's rule is `--space-N = N × 4px`, and all three values this screen needs are on that grid, so they need no new naming scheme and no off-grid token:

```css
--space-7: 28px;    /* copy-block gap; frame vertical padding */
--space-8: 32px;    /* frame horizontal padding */
--space-16: 64px;   /* mark-to-copy gap */
```

Leaving 9–15 undefined is correct — the file's header says tokens are ported as tickets need them.

**The 10px icon-to-label gap gets no token.** Snap it to `--space-2` (8px) and note the 2px delta in a comment. This overrides the ticket's suggestion to follow `--space-bubble-x`, on the strength of a closer precedent: `pairing.css` does exactly this snap-and-comment twice in one file, once for a 4px radius → `--radius-xs` (`:54-56`) and once for **a 10px padding → `--space-2`** (`:130-131`). `--space-bubble-x` exists because 14px is structural to the message-bubble shape; a 2px difference on an icon gap is imperceptible, and adding a screen-specific value to a *theme* file is the worse trade.

**Out of scope:** retro-fitting `settings.css:419-421` and `conversation.css:1784-1786` to the new `--color-on-primary`. Both are switch knobs whose current `--color-surface` substitution is visually settled, and touching them is exactly the "don't refactor adjacent code while you are there" rule. Worth a follow-up ticket; not this one.

### Stylesheet contract (`welcome.css`)

Open with a `pairing.css:1-9`-style header stating the rule and enumerating this file's structural literals so AC6 is auditable at a glance. The permitted literals, and nothing else:

`100%` / `flex: 1` · the mark's `184px × 208px` · the copy column's `max-width: 560px` · the CTA rows' `height: 56px` · the icon's `20px` · the footer's `opacity: .55` · the glow's percentage geometry.

Every colour, every type value, every gap and padding resolves to a token. `--radius-lg` is already 28px — the pill radius needs no new token.

## State + concurrency model

None, and that is the design. No store slice, no `useState`, no `useEffect`, no subscription, no async call, no timer, no `AbortController`. The only runtime behaviour is one synchronous `onClick` that calls an optional prop, and one anchor whose click leaves the renderer entirely. There is nothing to tear down on unmount, so no cancellation story is needed.

## Error handling

No failure mode exists in this screen. It performs no I/O, parses nothing, and renders no value that can be absent or malformed — every string is a module constant. Specifically:

- **`onPair` absent** — the dormant state, not an error. `onPair?.()` is a no-op and the button still renders.
- **External open fails** (no browser, `shell.openExternal` rejects) — handled in the main process, which already swallows it (`void shell.openExternal(url)`, `index.ts:64`). No renderer-side surface, and none is added here: the ticket documents that `https://pyryco.de/setup` currently redirects to the repo README, which is expected, not a defect.
- **No Electron bridge present** (AC7's server-render case) — impossible to fail, because the container never touches `window`. This is why `WelcomeScreen` must not acquire a `bridge ?? window.pyry` line like `PairingScreen.tsx:175`.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`) plus `npm run typecheck`. No jsdom, no Testing Library, no e2e — see "Context" for why the e2e tier is absent.

Follow `PairingScreen.test.tsx:14-24`: a local `renderView(props)` helper, then bullet-scoped cases.

**`WelcomeView` — copy and structure (AC1, AC2, AC3, AC5):**

- Renders all six `WELCOME_COPY` strings, each asserted verbatim. The subtitle assertion is the de-duplicated line and doubles as the pin against someone "fixing" it back to the frame.
- The mark renders: one `<svg` inside `.welcome__mark`, and `.welcome__hero` contains both the mark and `.welcome__copy` (the horizontal-pair structure; the row direction itself is a CSS property and belongs to visual review, not a markup test).
- The title is an `<h1>`.
- The primary CTA is a `<button` carrying the pair label **and** an `<svg` (the leading icon), so a dropped icon fails.

**`WelcomeView` — the setup link (AC4):**

- Pin the whole anchor as **one** exact string, `AssistantMarkdown.test.tsx:111`-style: `<a class="welcome__setup" href="https://pyryco.de/setup" target="_blank" rel="noreferrer">`. One assertion covers the URL, the exact constant, and the load-bearing `target`. A separate `toContain('https://pyryco.de/setup')` adds nothing — do not write it.

**`WelcomeView` — the footer is not a link (AC5):**

The vacuity trap here is real: the screen legitimately contains one anchor, so a bare `not.toContain('<a ')` would be false, and a footer-scoped negative alone can pass for the wrong reason (a renamed class, a missing footer). Pair them in the **same** case:

- Positive: the markup contains `<p class="welcome__footer">Open source · github.com/pyrycode/pyrycode-desktop</p>` as one exact string — proving the line exists, is a `<p>`, and holds the full text.
- Negative: the markup contains exactly **one** `<a` occurrence (count the matches, don't just `toContain`), and contains no `href="https://github.com`. The count is what makes it non-vacuous — it fails the moment the footer becomes a link, and it fails just as loudly if the setup link is deleted.

**`WelcomeView` — the dormant prop (AC3):**

- Rendering with `onPair` omitted does not throw and still emits the `<button` with the pair label. This is the dormant contract; the passthrough itself is reviewed glue, as `PairingScreen.test.tsx:1-11` states for its equivalent.

**`WelcomeScreen` — the container smoke (AC7):**

- `renderToStaticMarkup(<WelcomeScreen />)` does not throw and contains the title, **with no `globalThis.window` stub installed**. Read `App.test.tsx:29-44` to see the stub idiom and then deliberately not use it: `PairingScreen` needs it because it dereferences `window.pyry` at render, and this container's whole point is that it does not. Add a comment saying so — the absent stub is the assertion.

## Open questions

1. **The mark is a placeholder in the design.** Figma names `103:747` "Pyry Logo (placeholder)". Porting mobile's `ic_pyry_logo` is the right call today (it is what mobile actually ships), but a final mark would land as a follow-up. No action for this ticket.
2. **Narrow-window behaviour is unspecified.** At the 1100px default the hero (184 + 64 + 560 = 808px) fits inside the 1036px content box comfortably; below ~940px it would begin to crowd. The `max-width: 560px` on the copy column (rather than Figma's fixed `width: 560px`) lets it shrink gracefully instead of overflowing, which is the only concession this ticket makes. A real responsive story belongs with #658 or later, once the screen is actually reachable.
3. **The Figma subtitle still repeats a word** (`103-754`, re-verified 2026-08-21). Tracked in the ticket for the design surface; the code ships correct and comments why.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The screen introduces no boundary crossing: it renders zero daemon-derived, store-derived, user-entered, or disk-derived strings — every value is a module-level `const` in `WelcomeScreen.tsx`. That is the structural reason there is no escaping or injection surface here, and it is worth stating rather than assuming, because the sibling `ArchiveScreen.tsx:12-16` had to argue the opposite case (it *does* render daemon strings, and relies on React auto-escaping). The one value that leaves the renderer is `SETUP_URL`, and it crosses to the main process through `setWindowOpenHandler`, which independently re-derives and allowlists the scheme (`index.ts:56-67`) — a constant at the source and a deterministic check at the sink, two different fabrics.

- **[Tokens, secrets, credentials]** No findings, by construction. The screen holds no state, reads no store, opens no bridge, and — per the "Public surface" ruling — must not acquire a `window.pyry` dereference. Nothing here can observe or emit a token, key, or pairing payload.

- **[File / storage operations]** Not applicable — no filesystem, no `localStorage`/`sessionStorage`/IndexedDB, no persistence of any kind. The screen is stateless across mounts.

- **[Inter-process / Electron attack surface]** Two findings, neither exploitable as designed:
  - *SHOULD FIX (pre-empted in the spec):* the large mark path invites `dangerouslySetInnerHTML` as a shortcut. Nothing untrusted flows into it today, so it is not exploitable — but it would install an HTML sink on a screen that currently has none, and it is the exact hazard `AssistantMarkdown.tsx:140-142` legislates against for its own overrides. The spec makes real JSX elements a hard requirement; code-review should check for the absence of `dangerouslySetInnerHTML` in `WelcomeScreen.tsx`.
  - *SHOULD FIX (pre-empted in the spec):* `SETUP_URL` must stay a non-interpolated module `const`. If a later edit made the href a prop or a template literal, the sink's scheme allowlist would still hold (no `file:`, no custom protocol, no in-app window — `index.ts:66` denies on every path), so the blast radius is "opens an attacker-chosen **web** page in the user's browser", not code execution. The spec pins the full anchor as one exact string in a test, which fails the moment the URL changes shape.
  - No new IPC: no `contextBridge` method, no `ipcMain.handle`/`.on` channel, no preload change. The external open rides the mechanism #610 already shipped and reviewed. `webPreferences` is untouched (`sandbox: true`, `contextIsolation: true`, `index.ts:46-47`). No remote content enters the privileged renderer — `shell.openExternal` hands the page to the OS browser and the in-app window is denied unconditionally. The CSP (`default-src 'self'`, no `img-src`) is also why the inline-SVG idiom is kept rather than introducing the repo's first bundled asset.

- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no comparison against a secret, no Noise surface. The screen is a render function.

- **[Network & I/O]** No findings. The screen opens no socket and issues no request. The only outbound action is handing one `https://` constant to the OS browser. `https` is pinned in the constant even though the sink would also accept `http`; the ticket documents that the URL currently redirects to the repo README, which is expected behaviour, not a defect.

- **[Error messages, logs, telemetry]** No findings — the screen adds no logging, no diagnostics call, and no error surface (see "Error handling"). It should stay that way: there is no content-free event worth emitting from a static render, and a diagnostic here could only ever repeat constants.

- **[Concurrency]** Not applicable — no async work, no effect, no timer, no listener, no subscription, so there is nothing to cancel, nothing to leak on unmount, and no check-then-act window. The one `onClick` is synchronous.

- **[Threat model alignment]** *Renderer compromise reaching the transport* — unchanged. The screen adds no capability a compromised renderer could abuse: no bridge method, no privileged call, no widening of the window-open allowlist. *Malicious relay / hostile daemon* — not on this path; the screen renders no daemon-derived data at all, so a hostile daemon has no reachable input here. *Token theft from disk* — not applicable, nothing is persisted. Out of scope and named: everything about the screen's **reachability** — which route mounts it, whether it precedes pairing, and what the pair CTA actually navigates to — is #658's. This ticket ships the screen dormant, so no navigation decision is being made here.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
