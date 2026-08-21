# #662 — Make the welcome screen the unpaired app root

Split from #658. `blockedBy` #661, which merged as PR #663 — the ten-site pairing drive is already
collapsed into `e2e/fixtures/pairingArrival.ts`, so this ticket's e2e half is one module.

## Size check

**S, no split.** The quantitative gates, counted against the file set below:

| Gate | Limit | This ticket |
|---|---|---|
| New files | > 3 → split | **0** |
| Production `.ts`/`.tsx` files (tests excluded) | ≥ 5 → split | **3** — `appRoute.ts`, `App.tsx`, `WelcomeScreen.tsx` (comment-only) |
| Total written LOC | > ~600 → split | **~90** (~20 production, rest test) |
| New exported types / components | > 5 → split | **0** — `AppRoute` gains a union member; nothing new is exported |
| Consumer call sites | > 10 → split | **4** — `codegraph_impact routeForStatus` returns `appRoute.ts` + `App.tsx`; grep adds `appRoute.test.ts` + `App.test.tsx` |
| Reject / error branches | ≥ 10 → split | **1** (the existing launch-query catch arm) |

Six ACs nominally trips the ">5 acceptance criteria" line. It does not survive contact with "worth of
work": **three of the six ACs carry zero production lines** (AC5, AC6, and the test half of AC1), and
AC2 is a behavioural restatement of the same ~20 lines AC1 changes.

More decisively, the set is **compile-atomic — splitting it ships a broken build**. Verified, not
assumed:

- `AppView`'s switch is guarded by `assertNever` (`App.tsx:17-19`, `:42-43`), so adding `welcome` to
  `AppRoute` does not compile until `App.tsx` has the case.
- `appRoute.test.ts:24` annotates the table as `expected: 'pairing' | 'conversation'`; that annotation
  fails the moment `routeForStatus` stops returning `'pairing'`.
- AC4 (cancel → welcome) has no destination until welcome is the root — which is precisely what the
  `AppView` comment at `App.tsx:21-27` records today.

This is the documented compile-forced exception, not a rationalisation: no re-counting of "mechanical"
edits is being done, and every other gate is under its limit by a wide margin.

### File-overlap check

`git fetch origin --prune` then a branch-diff sweep over every `origin/feature/<N>` against the seven
files below: **no overlap**. No `addBlockedBy` needed.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-744

Read at 900px. A 1280×1024 dark frame with a radial blue glow: a horizontal hero (snowflake mark left,
`Pyrycode` title + subtitle + body copy right) floating above a bottom-anchored CTA stack — a full-width
light-blue pill (`I already have pyrycode`, QR-frame icon + label), a plain `Set up pyrycode first` link,
and a dimmed footer line.

**This ticket ships no new visual.** The screen was built in #657 and the render matches
`WelcomeScreen.tsx` as shipped. The node is referenced only to fix which frame an unpaired launch lands
on. Do not restyle anything; do not touch `welcome.css`.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/appRoute.ts:11-23` | The whole module. `AppRoute`, and the ternary whose *structure* AC1 requires preserving. |
| `src/renderer/src/App.tsx:16-45` | `assertNever` + `AppView`. The switch you extend and the doc comment (`:21-27`) you rewrite. |
| `src/renderer/src/App.tsx:65-84` | Route state + launch effect. Two edits: `routeForStatus`'s consumer comment and the catch arm at `:79`. |
| `src/renderer/src/App.tsx:130-134` | `AppView`'s mount site — where the two new callbacks get wired. `onUnpaired` at `:133` is **pinned out of scope**. |
| `src/renderer/src/screens/welcome/WelcomeScreen.tsx:48-53`, `:165-173` | The `onPair?` seam and the container that consumes it. Both already ship; you supply the caller. Comment fix at `:49`. |
| `src/renderer/src/screens/welcome/WelcomeScreen.tsx:30-37` | `WELCOME_COPY`. `pairCta` is the string your `App.test.tsx` marker and your e2e locator both key on. |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:161-166`, `:196-199` | `onCancel?` seam and `handleCancel`. Already shipped — you only supply the handler. |
| `src/renderer/src/screens/pairing/pairingState.ts:91-92` | `cancel` → `initialPairingState`. Confirms the paste is discarded by the reducer independently of unmount. |
| `src/renderer/src/appRoute.test.ts` | All four cases, incl. the compile-forced `expected` annotation at `:24`. |
| `src/renderer/src/App.test.tsx:13-15`, `:26-52` | The per-screen marker idiom and the `pairing` describe's `window` stub — the ordering hazard your new describe must sit ahead of. |
| `src/renderer/src/screens/welcome/WelcomeScreen.test.tsx:90-105` | `expect('window' in globalThis).toBe(false)` — the non-vacuous absent-stub assertion you mirror. |
| `e2e/fixtures/pairingArrival.ts` | The whole file (55 lines). Four invariants + the two stale comments (`:8`, `:45-46`) AC6 names. |
| `e2e/smoke.spec.ts:12-15`, `:63-70` | The rationale comment and the `.pairing` assertion that flips to `.welcome`. |
| `e2e/unpair-repair.spec.ts:29-59` | Read, do **not** edit. The negative control; must stay byte-unchanged. |
| `docs/knowledge/codebase/661.md` | The shared step's rationale and its four invariants, before you edit that module. |
| `docs/knowledge/features/app-shell.md` + ADR `0005` | The "conversation only on genuine `paired`" fail-safe this change must preserve structurally. |

Codegraph note: the dispatched worktree has no `codegraph.db`, so queries need
`projectPath=/Users/juhanailmoniemi/Workspace/Projects/pyrycode-desktop`. Its index also excludes
`e2e/` entirely — the e2e fan-out above was established by grep, and grep is the right tool there.

## Context

`routeForStatus` maps every non-paired launch straight to `PairingScreen`, which makes pairing the app
root. A first run therefore opens on a paste-your-pairing-code form with no explanation of what the app
is. The welcome screen that answers that (#657) ships **dormant** — nothing mounts it — and already
exposes the seam this ticket fills (`onPair?`, `WelcomeScreen.tsx:49`).

Relocating the root is also what gives Cancel a meaning. `PairingScreen` has carried an optional
`onCancel` since it was built; `AppView` deliberately withholds it because, while pairing is the root,
cancel's only correct behaviour is "stay put".

## Design

### 1. `appRoute.ts` — the route model and the launch mapping

```ts
export type AppRoute = 'pending' | 'welcome' | 'pairing' | 'conversation'

export function routeForStatus(status: PairingStatus): Exclude<AppRoute, 'pending' | 'pairing'>
```

Two changes, both load-bearing:

**The ternary keeps its shape.** The body becomes
`status.status === 'paired' ? 'conversation' : 'welcome'`. AC1 asks for the fail-safe "preserved
structurally, not merely reproduced" — that means the single `=== 'paired'` test with everything else
falling into one else-branch, *not* a per-status switch that happens to produce the same table today.
A switch would let a future member be added to the wrong arm without a type error; the ternary cannot.

**The return type narrows to exclude `'pairing'` as well as `'pending'`.** After this ticket, pairing is
never a launch destination — it is reachable only by user action (the welcome CTA, and the pinned
mid-session `onUnpaired` flip). Keeping `'pairing'` in the return type would advertise an outcome the
function can no longer produce, and would let someone reintroduce a launch→pairing mapping with no
compile error. Keep the `Exclude<AppRoute, …>` form rather than hand-writing
`'welcome' | 'conversation'`, so the domain still tracks `AppRoute` as it did before.

Update the doc comment to say `welcome` where it says `pairing`, and to state the new type-level fact.

### 2. `App.tsx` — `AppView`

Add one case; add two required props:

```ts
export function AppView(props: {
  route: AppRoute
  onPaired: () => void
  onUnpaired: () => void
  onPairRequested: () => void      // welcome CTA pressed
  onPairingCancelled: () => void   // pairing screen's Cancel fired
}): JSX.Element | null
```

- `case 'welcome': return <WelcomeScreen onPair={props.onPairRequested} />`
- The `pairing` case gains `onCancel={props.onPairingCancelled}` alongside its existing `onPaired`.

**Naming.** Not `onPair` — one letter from the adjacent `onPaired` is a real misreading hazard in a
five-prop object. The existing props are named after *the event that occurred*, and these two follow
that convention. `WelcomeScreen`'s own prop stays `onPair`: it is shipped surface, and renaming it is
adjacent-code churn this ticket must not do.

**Both new props are required, not optional.** The whole value of the `assertNever` guard is that it
compile-forces the wiring; an optional prop would let `App` forget the CTA handler and still build,
shipping a dead-end root that only e2e would catch.

Rejected alternative: collapsing all four callbacks into one `onRoute: (route: AppRoute) => void`. It is
less code but abandons the event-named convention and rewrites two working call sites — a refactor of
adjacent code, which `CLAUDE.md` forbids.

**Rewrite the doc comment at `App.tsx:21-27`.** It currently records *why* `onCancel` is deliberately
absent. Replace that paragraph with why supplying it is now both safe and necessary: welcome is the
root, so cancel has a destination, and that destination is still not the conversation screen — the
fail-safe is untouched because cancel can only ever reach `welcome`.

### 3. `App.tsx` — the container

- `onPairRequested={() => setRoute('pairing')}`
- `onPairingCancelled={() => setRoute('welcome')}`
- The catch arm at `:79` becomes `setRoute('welcome')`.
- Update the effect's comment at `:68-71` — it names the pairing screen as the non-paired destination
  in both directions.

`App.tsx:133`'s `onUnpaired={() => setRoute('pairing')}` is **unchanged**. An operator who just unpaired
is re-pairing; pairing stays the right destination. Do not "fix" it for symmetry.

`PairedShell.tsx:123-129`'s separate `PairingScreen` mount ("Pair another server") is a different route
space that already supplies its own cancel handler. Untouched.

### 4. `WelcomeScreen.tsx:49` — comment only

`// the dormant navigation seam — PairingScreen.tsx:163's posture (#658 supplies it)` → #658 was split;
**#662** is the supplier, and the seam is no longer dormant. Zero behaviour change.

### 5. `e2e/fixtures/pairingArrival.ts` — one new step, two rewritten comments

`pairFromUnpairedLaunch` now begins by crossing the welcome screen:

```ts
await page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click()
```

Then the existing six lines, unchanged. Notes for the developer:

- The click's own actionability wait is what settles `pending → welcome`, replacing the role the
  `pasteBox` visibility wait used to play.
- **Keep the `await expect(pasteBox).toBeVisible()`.** It is not redundant — its meaning changes from
  "settle pending→pairing" to "the CTA hop actually landed on pairing", which is the only executable
  proof of AC3 across all ten drives.
- `exact: true` matches the file's idiom and stays correct if a second button ever appears on the
  screen. If the CTA copy churns, `.welcome__pair` is the fallback locator.
- Invariant 2 (payload hygiene) is preserved by construction: the new line references `payload`
  nowhere, and its failure message names public copy only.
- Invariant 3 (the step ends at Confirm) is unchanged — add no wait and no timeout below.
- Invariant 4 (`unpair-repair.spec.ts` is not a caller) is unchanged in substance; its tense may be
  updated from "#662 uses" to "#662 used".

Rewrite the two comments AC6 names — the header at `:8` ("...is now a one-line edit here", now done)
and `:45-46` ("Settle the pending→pairing route before pasting", now wrong). Optional, same class:
`launchPairedApp.ts:200-203` calls this module "the one place #662 edits when the unpaired entry point
moves" and goes stale for the same reason.

## State + concurrency model

No store, no effect, no subscription, and no async work is added. The route stays screen-local
`useState<AppRoute>` in `App` (ADR 0006). Specifically:

- The launch effect's `active` flag and its StrictMode double-mount reasoning are unchanged, and still
  net exactly one applied `setRoute` on both the resolve and the reject path.
- **A late launch-query resolution cannot yank a user off pairing.** The CTA is only clickable once the
  welcome screen renders, which only happens after the query settles (`pending` renders `null`, so
  there is no CTA before then), and a settled promise cannot settle again. The race is structurally
  impossible, not merely unlikely.
- Cancel now unmounts `PairingScreen`, destroying its `useReducer` state. That is belt to the existing
  suspender: the reducer's `cancel` arm already returns `initialPairingState`, so the pasted payload is
  discarded twice over.

## Error handling

The only failure mode in the touched path is the launch query rejecting. It routes to `welcome` — never
`conversation` — preserving the fail-safe in the one branch that bypasses `routeForStatus` entirely.

The catch arm swallows the rejection and surfaces nothing to the user, which is correct and unchanged.
**Do not add logging to it while editing that line** (see the security review below).

The welcome screen has no error state, no async work, and no failure surface of its own.

## Testing strategy

Renderer tests are server-render only (`renderToStaticMarkup`) — no jsdom, no Testing Library.

**`appRoute.test.ts`** — move every non-paired expectation from `'pairing'` to `'welcome'`:

- `paired` → `conversation` (unchanged).
- `not-paired` → `welcome`.
- `error` → `welcome`, still carrying the ADR-0005 rationale.
- The table's `expected` annotation becomes `'welcome' | 'conversation'` (compile-forced).
- Keep the "exactly one conversation outcome" counter-assertion. It is the assertion that catches the
  dangerous wrong answer; the pairing→welcome flip must not quietly drop it.
- Add one assertion that **no** launch outcome maps to `'pairing'` — the new invariant, non-vacuous
  against the three-case table.

**`App.test.tsx`** — add a `route='welcome'` describe:

- Marker `WELCOME_MARKER = 'I already have pyrycode'` (the CTA copy — unique to this screen, and the
  thing AC3 is about). Assert the markup contains it and contains neither `PAIRING_MARKER` nor
  `CONVERSATION_MARKER`.
- **No `globalThis.window` stub**, and assert `expect('window' in globalThis).toBe(false)` inside the
  case — mirroring `WelcomeScreen.test.tsx:96`. Adding a stub here would contradict a shipped
  assertion's stated rationale.
- **Place this describe before the `pairing` describe** (immediately after the `pending` test). The
  pairing describe installs and removes the stub in `beforeEach`/`afterEach`; sitting ahead of it keeps
  the absent-stub assertion honest regardless of hook ordering, and makes an ordering mistake fail
  loudly rather than silently.

**`e2e/smoke.spec.ts`** — `.pairing` → `.welcome` at `:69`, plus the rationale comments at `:12-15` and
`:63-68` which both describe the pairing screen as the unpaired-boot destination. Assert the container
class, not a control, per that file's existing reasoning.

**One addition beyond AC6's literal wording, flagged deliberately:** add a second test to
`smoke.spec.ts` reusing the same isolated unpaired launch — assert `.welcome`, click the CTA, assert
`.pairing`, click `Cancel`, assert `.welcome` again. Rationale: AC3 gets executable proof from all ten
`pairingArrival` drives, but **AC4 otherwise ships with no test at all** — the server-render harness
cannot fire a callback, and no e2e reaches the pairing screen's Cancel. This is ~5 lines in a file that
already owns the fake-free unpaired launch. If you would rather hold the line at AC6's exact wording,
say so in the PR body and mark AC4 as verified by inspection only; do not silently drop it.

**Verification — both Playwright configs are required.** `e2e/` sits outside both tsconfigs, so
`npm run typecheck` sees no spec, and a bare `playwright test` skips every `real-*` spec via
`testIgnore` — nine of the ten call sites. Run:

- `npm run typecheck` and `npm test` (unit).
- `npm run e2e` — the behavioural proof for the fake stack and for smoke.
- `--config playwright.real-claude.config.ts` for the nine `real-*` specs. On a `pyry`-only box a
  subset executes and the rest skip; **record the executed/skipped tally**, because a clean skip proves
  only that the import graph resolved, not that the new CTA hop works.
- `git diff --stat e2e/unpair-repair.spec.ts` must be **empty**. That file staying green *and*
  byte-unchanged is the negative control proving this change did not reach into the session-exit path.

## Open questions

1. **The smoke round-trip test** — recommended above; the developer may hold to AC6's literal wording
   instead. Either way the choice belongs in the PR body, not in silence.
2. **Tense-only edits** (`pairingArrival.ts` invariant 4, `launchPairedApp.ts:200-203`) are optional
   and carry no behaviour. Skip them if the diff is getting noisy; they are not acceptance criteria.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The change moves no data across a boundary: the route is
  renderer-local `useState`, and the only input is the existing `pairingStatus()` invoke, whose shape
  and validation are untouched. The one boundary whose *semantics* change — ADR 0005's
  "conversation only on a genuine `paired`" gate — stays a single ternary in a single function
  (`appRoute.ts:22`) and is strengthened at the type level: narrowing the return to
  `Exclude<AppRoute, 'pending' | 'pairing'>` makes a future launch→pairing mapping a compile error
  rather than a silent behaviour change.
- **[Tokens, secrets, credentials]** No findings. `WelcomeScreen` reads no store and derefs no bridge;
  every string it renders is a module constant (`WELCOME_COPY`, `:30-37`). The e2e edit adds a locator
  keyed on public CTA copy and references `payload` nowhere, so `pairingArrival.ts`'s invariant 2 (the
  payload never reaches a selector, an assertion message, or a `test.step` title) survives the
  extension intact — verified against the shipped module, not assumed.
- **[File / storage operations]** Not applicable, with the reason: no path is constructed, no file is
  read or written, and the secrets-store read behind `pairingStatus()` is unchanged. Only what the
  renderer does with the *answer* moves.
- **[Inter-process / Electron attack surface]** The one genuine reachability change, named rather than
  assumed away: welcome-as-root makes `SETUP_URL`'s `target="_blank"` affordance
  (`WelcomeScreen.tsx:83`) reachable **pre-pairing, on first launch**, where the dormant screen made it
  unreachable. Assessed and accepted — the URL is a module-level `const` (`:46`), never a prop and never
  interpolated, so no relay, daemon, or pairing payload can influence it; the sink
  (`setWindowOpenHandler`, `src/main/index.ts:56-66`) allowlists `https:`/`http:` and returns `deny` on
  every path, so no in-app window and no opener relationship is ever created; `will-navigate` (`:78`)
  independently confines in-place navigation. This is new reachability of an already-hardened sink, not
  a new sink. No `webPreferences` change, no new IPC channel, no new `contextBridge` surface, and the
  callbacks passed to `WelcomeScreen`/`PairingScreen` are zero-argument route flips carrying no
  capability — the renderer gains nothing it did not already have.
- **[Cryptographic primitives]** Not applicable, with the reason: no handshake, key, nonce, or
  comparison appears in the file set. The Noise variant constant and the entire transport are outside
  it, and this ticket adds no `src/main/` file.
- **[Network & I/O]** Not applicable, with the reason: no socket, no frame, no relay-URL parsing.
  `pairingStatus()` is a pre-existing one-shot IPC invoke, not a network call. The e2e change adds no
  timeout and no retuned wait (invariant 3 preserved), so no gate is loosened.
- **[Error messages, logs, telemetry]** **SHOULD FIX** — the developer edits `App.tsx:79`, the launch
  query's catch arm, which today swallows the rejection silently. It must stay silent: a rejection from
  the pairing-status invoke can carry a userData path or internal state, and the renderer console is
  readable by anything that can open DevTools. Do not add a `console.error`/`console.warn` while
  changing that line. Code review should check this specific line.
- **[Concurrency]** No findings, with the argument rather than the assumption: no async task, listener,
  or timer is added, and the `active` StrictMode guard is unchanged on both the resolve and reject
  paths. The one candidate race — a late launch-query resolution overwriting a user-chosen
  welcome→pairing navigation — is structurally impossible: the CTA does not exist until the query
  settles (`pending` renders `null`), and a settled promise cannot settle twice.
- **[Threat model alignment]** ADR 0005's invariant is the only protocol-level property this ticket
  touches, and it is preserved in both non-paired paths (`routeForStatus`'s else-branch and the catch
  arm) — both now land on `welcome`, neither can reach `conversation`. Hostile relay, hostile daemon,
  token theft from disk, and renderer-compromise-reaching-the-transport are all out of this ticket's
  surface: no transport, main-process, or storage code is in the file set. They remain owned by the
  transport tickets, unchanged.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
