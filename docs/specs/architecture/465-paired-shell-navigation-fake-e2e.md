# #465 — fake e2e: PairedShell navigation (pair-another-server + list/settings/archive back-chain)

**Size:** S · **Security-sensitive:** no · **Figma:** N/A (coverage-only test of already-shipped screens) · **Split from:** #429

## Context

Every navigation target inside the paired region is a `PairedRoute` driven by the pure `nextPairedRoute`
reducer in `PairedShell` (`list`, `thread`, `settings`, `archive`, `pairServer`). The only inner-nav step
with e2e coverage today is the single `list → thread` click the launcher itself performs. This ticket adds
one fake-stack e2e spec that drives the **real product-UI controls** through the remaining transitions so a
routing regression can't leave a screen unreachable or unrendered:

- **Pair another server** (#152): Settings → "Pair another server" → in-shell `PairingScreen` (`pairServer`
  route). Cancel returns to Settings; a completed pair goes home to the list. Crucially this does **not** tear
  down the session — the top-level App route stays `'conversation'`, the session store is untouched.
- **Back-navigation chain**: `back` from `thread`, `settings`, and `archive` all land on `list` (the reducer's
  absolute `back` arm). Reachable chain: `thread → list → settings → list → archive → list`.

**Zero production code.** Every screen and control this spec drives already ships (#141 list, #333 settings,
#347 archive, #152 pair-another, #140 paired entry). This is a pure coverage add — one new spec file.

## Files to read first

- `e2e/pair-to-conversation.spec.ts` — **the skeleton to clone.** Nav-only e2e on the launcher: imports
  `{ test, expect }` from the fixture, `const { page } = await launchPairedApp()`, then drives clicks and
  asserts visibility. No `buildReplyFrames`, no codec import — #465 has the identical shape.
- `e2e/fixtures/launchPairedApp.ts:118-210` — the fixture. It leaves you **on the thread, connected, Send
  enabled** after a real `paste → Pair → Confirm → seeded-row click` drive. `launchPairedApp()` with **no
  options** is all this spec needs (the default `buildReply` seeds the one-row list). The back-nav chain
  begins from the thread the fixture left you on.
- `src/renderer/src/pairedRoute.ts:46-69` — `nextPairedRoute`. Confirm the arms this spec exercises:
  `back → 'list'` (absolute), `openSettings → 'settings'`, `openArchive → 'archive'`, `openPairServer →
  'pairServer'`, `pairServerCancelled → 'settings'` (the teardown-distinguishing arm).
- `src/renderer/src/PairedShell.tsx:44-70` — `PairedShellView` route→view map + the dispatch wiring at
  `:112-123`. Confirms `pairServer` renders the same `PairingScreen` component as the app-root pairing route,
  with `onCancel → pairServerCancelled` and `onPaired → pairServerPaired`.
- `src/renderer/src/screens/channels/ChannelList.tsx:131,153-190` — list root `section[aria-label="Conversations"]`;
  Settings entry `button[aria-label="Settings"]`; Archive entry `button[aria-label="Archive"]`.
- `src/renderer/src/screens/settings/SettingsScreen.tsx:51,130,150-164` — settings root
  `section[aria-label="Settings screen"]`; back `button.settings__back` (aria-label `'Back'`); "Pair another
  server" row `button.settings__pair-another-row` (visible text `'Pair another server'`).
- `src/renderer/src/screens/archive/ArchiveScreen.tsx:95,237` — archive root `section[aria-label="Archive screen"]`;
  back `button.archive__back` (aria-label `'Back'`).
- `src/renderer/src/screens/pairing/PairingScreen.tsx:89,96,108` — pairing entry surface `<h1>Paste pairing
  code</h1>` + `textarea[aria-label="Pairing code"]`; Cancel `button.pairing__button` (visible text `'Cancel'`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:121,1416-1419` — thread root `.conversation`;
  back `button.conversation__back` (aria-label `'Back'`, renders only when `onBack` is present — it is, inside
  the shell).
- Memory / prior art: siblings `e2e/run-config-settings.spec.ts` (header-comment idiom, secret-hygiene note)
  and the #426/#427/#428 fake-e2e family — same launcher, same NOT-sec / NOT-Figma posture.

## Selector map (the load-bearing contract)

| Screen | Arrival hook (assert visible) | Control to leave / advance |
| --- | --- | --- |
| thread | `page.locator('.conversation')` | back: `page.locator('.conversation__back')` |
| list | `page.locator('section[aria-label="Conversations"]')` | Settings: `getByRole('button', { name: 'Settings' })` · Archive: `getByRole('button', { name: 'Archive' })` |
| settings | `page.locator('section[aria-label="Settings screen"]')` | pair-another: `getByRole('button', { name: 'Pair another server' })` · back: `page.locator('.settings__back')` |
| pairServer (pairing entry) | `getByRole('heading', { name: 'Paste pairing code' })` (or `textarea[aria-label="Pairing code"]`) | Cancel: `getByRole('button', { name: 'Cancel' })` |
| archive | `page.locator('section[aria-label="Archive screen"]')` | back: `page.locator('.archive__back')` |

**Select the three back buttons by class, not by role-name.** `thread`, `settings`, and `archive` back
buttons all expose the identical accessible name `'Back'`. Only one screen renders at a time so
`getByRole('button', { name: 'Back' })` would resolve unambiguously *in practice*, but the class selectors
(`.conversation__back` / `.settings__back` / `.archive__back`) are screen-scoped and self-documenting — use
them, matching the launcher's `.channel-list__row-open` idiom.

## Design

**One `test()` block, one launch, one continuous drive.** None of these transitions mutate persistent or
session state (no unpair, no promote, no one-way flip), so a single drive covers all four ACs without a second
`launchPairedApp()` (each launch pays the full ~60s handshake — siblings #425/#428 established "one launch when
state permits"). Call `launchPairedApp()` with no options; the default seed is all that's needed.

The drive (each `→` is a real product-UI click; each arrival is asserted via the table above **before** the
next click, so a mis-route fails at the exact step):

1. **thread** (fixture end-state) — assert `.conversation` visible.
2. click `.conversation__back` → **list** — assert `section[aria-label="Conversations"]`.  *(AC: thread→list)*
3. click Settings entry → **settings** — assert `section[aria-label="Settings screen"]`.
4. click "Pair another server" → **pairServer** — assert `heading "Paste pairing code"`.  *(AC: pair-another renders)*
5. click Cancel → **settings** — assert `section[aria-label="Settings screen"]` **again**.  *(AC: Cancel→Settings round-trip — see below)*
6. click `.settings__back` → **list** — assert `section[aria-label="Conversations"]`.  *(AC: settings→list)*
7. click Archive entry → **archive** — assert `section[aria-label="Archive screen"]`.
8. click `.archive__back` → **list** — assert `section[aria-label="Conversations"]`.  *(AC: archive→list)*

### ⭐ Teardown is provable only via the Cancel→Settings round-trip, not the pairing surface

The `pairServer` route and the app-root pairing route render the **same** `PairingScreen` component. An
assertion made *while on* the pairing surface (step 4) therefore **cannot** distinguish an in-shell
pair-another (session intact) from a torn-down session (session gone) — the DOM is byte-identical. A naive
"assert no app-root pairing screen" check at step 4 is **unrealizable** (this is the #440-realizability
discipline).

The observable that separates the two is the **Cancel destination** (step 5): in-shell Cancel dispatches
`pairServerCancelled`, which the reducer lands on `settings` — so the **Settings screen renders again**, with
the shell (and session) intact. A teardown would instead leave you on the app-root pairing screen with no
Settings to return to. Step 5's `section[aria-label="Settings screen"]` assertion *is* the teardown proof;
this is the load-bearing AC, not step 4's render check.

### No wire scripting

This spec asserts **DOM visibility only** and drives **real controls only** — no `daemon.pushFrame`, no
custom `buildReplyFrames`, no forced route dispatch or store mutation. The default launcher seed keeps the
one-row list present so the fixture's `list → thread` step (and hence the thread the chain starts from) is
reachable; nothing downstream depends on daemon replies. Settings (Server row) and Archive (tab panel) mount
store-bound children, but their **root `section` hooks render unconditionally**, so no `server_info` / archive
data needs seeding for the arrival assertions.

## State + concurrency model

None introduced. `PairedShell` owns ephemeral nav state via `useReducer(nextPairedRoute, 'list')`; the spec
only drives the reducer through real clicks and reads the rendered view. The renderer stores (conversation
list, active conversation, session) persist across nav — going `back` to `list` re-renders the ChannelList
from the already-populated store; no re-fetch is required for the arrival assertions.

## Error handling

Playwright auto-wait + `expect(...).toBeVisible()` per arrival; a mis-route surfaces as a timeout at the exact
failing step. No product error paths are exercised (no reject, no failure frame). The launcher owns per-test
timeout (60s) and secret hygiene; this spec adds no new timeouts or credentials.

## Testing strategy

- `npm run e2e` (= `build && playwright test`, fake suite only — `testIgnore: /real-.*\.spec\.ts$/`). Target
  green: the one new block passes end-to-end.
- **e2e is not typechecked by either project tsconfig** ([[e2e-not-typechecked-by-project-config]]) — run a
  standalone `tsc` pass over the new spec. Per the #428 gotcha, a temp tsconfig extending `tsconfig.node.json`
  must **include the `src/**` globs** alongside the spec (else the `noise-c.wasm` ambient `.d.ts` doesn't load →
  spurious TS7016); the only residual error is the pre-existing `launchPairedApp.ts:152` `env` baseline, which
  this spec does not add to.
- **Secret-hygiene note** (carry the sibling one-liner into the spec header): every assertion reads DOM
  attributes / text / visibility only; the pairing plumbing (synthetic token, fake static key) lives in
  `launchPairedApp` and is never echoed; no failure diagnostic serialises a token, key, or plaintext.

### Scenario coverage (map to AC)

- New spec on `launchPairedApp` — the single block above.  *(AC1)*
- Settings → "Pair another server" → pairing entry surface renders.  *(AC2)*
- From the in-shell pairing flow, Cancel → **Settings screen** renders again (teardown proof).  *(AC3)*
- Back-nav chain thread→list, list→settings→list, list→archive→list, each arrival asserted via its
  distinctive root hook.  *(AC4)*
- `npm run e2e` green.  *(AC5)*

## Open questions

- **None blocking.** Low-risk note: SettingsScreen's store-bound Server row and ArchiveScreen's tab panel
  render with empty stores (no `server_info` / archive seed). Their root `section` hooks are unconditional, so
  the arrival assertions hold regardless; if a store-bound child were ever to throw on empty state (not
  observed today), the fix is to seed that reply, not to change the assertion. Do not add speculative seeding —
  the default launcher reply is sufficient for the observed behaviour.
