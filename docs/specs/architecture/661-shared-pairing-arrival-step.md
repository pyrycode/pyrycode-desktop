# #661 — e2e: funnel every unpaired-launch pairing drive through one shared arrival step

**Size:** S · **Security-sensitive:** yes · **Production LOC:** 0 — the diff is confined to `e2e/`.

Scaffolding half of #658. #662 (relocate the unpaired entry point behind the welcome screen) is `blockedBy` this ticket and consumes the step this spec creates.

## Design source

N/A — test-only refactor with zero production diff. No rendered surface changes, so there is no visual-fidelity check to perform. #662 carries the entry-point change and its Figma anchor.

## Files to read first

Codegraph is blind to `e2e/` (a `codegraph_context` query for the pairing-arrival surface returned only unrelated `src/**/*.test.ts` symbols), so this list is grep-derived and the line anchors below are authoritative. Anchors are relative to `main` at `be0c711`.

- `e2e/fixtures/launchPairedApp.ts:199-239` — the fixture's pairing drive in full. **Lines 213–223 are the segment being extracted**; 206–211 (payload construction) and 231–239 (list→thread + Send-enabled) stay. Read the surrounding comments — several of them travel with the code.
- `e2e/fixtures/launchPairedApp.ts:187-197` — the `reuseUserDataDir` early return. The shared step belongs strictly **below** this; hoisting it above hangs (no pairing screen on a reused paired dir).
- `e2e/fixtures/launchPairedApp.ts:25-46` — the fixture's header, including the secret-hygiene paragraph the new module inherits.
- `e2e/fixtures/realDaemon.ts:1-20` + `:422-426` — the other fixture family: `base.extend` at module scope (`:129`) and `encodePairingPayload` exported at `:425`. Extract the constraint: the new module must not import from here, and must not touch `encodePairingPayload`.
- `e2e/fixtures/conversationStateFake.ts:1-30` and `:70-92` — the precedent for a **plain, side-effect-free helper module living in `e2e/fixtures/`** (no `base.extend`), imported by 8 specs. This is the home convention the new module follows.
- `e2e/real-daemon-session-settings.spec.ts:40-56` — the smallest, cleanest instance of the nine-spec pattern. Read this one first; the other eight are the same six lines.
- `e2e/real-claude.spec.ts:94-123` — the variant where the two doomed declarations sit inside a larger locator block whose other members **stay**. Same for `real-claude-interrupt`, `real-claude-permission-modal`, `real-claude-queue-drop`.
- `e2e/unpair-repair.spec.ts:13-27` — the secret-hygiene contract (AC5) **and** the boundary. Read it; do not edit it. See "The boundary" below.
- `playwright.config.ts:14` (`testIgnore`) and `playwright.real-claude.config.ts:14` (`testMatch`) — why the default run exercises none of the nine.
- `docs/knowledge/codebase/420.md:22` and `:28` — two load-bearing verification facts, restated in "Testing strategy": a clean `N skipped` from `e2e:real-claude` **is** the load-time proof for a fixture-module move, and a standalone `tsc` over `e2e/` has documented pre-existing noise so it is not a gate.
- `e2e/reporters/zeroExecutedGate.ts` — why "everything skipped" is an accepted pipeline outcome for `real-*`, and which npm script upgrades it to a failure.

## Context

Ten independent e2e sites each drive the pairing form after an unpaired launch, running the same six lines verbatim. Verified counts on `main`:

| Selector | Occurrences in `e2e/` today |
|---|---|
| `textarea[aria-label="Pairing code"]` | 14 (10 drive sites + 4 in `unpair-repair.spec.ts`) |
| `[aria-label="Server key fingerprint"]` | 10 |
| `getByRole('button', { name: 'Pair', exact: true })` | 10 |
| `getByRole('button', { name: 'Confirm', exact: true })` | 12 (10 drive sites + 2 unrelated) |

The `Pair` count of exactly 10 is the proof the enumeration is complete: one per listed site, no eleventh drive hiding behind a different locator.

This duplication is latent cost today and a trap the moment #662 moves the unpaired entry point, because two properties compound: `e2e/` sits outside both tsconfig `include`s, so `npm run typecheck` never type-checks a spec; and `npx playwright test` skips every `real-*` spec via `testIgnore`. A sweep that updates the fixture and misses the nine leaves the default run **green** with nine broken specs.

This ticket carries no behaviour change. It must pass on this branch exactly as it does on `main`. A green run against unchanged production code is the whole proof.

## Design

### The new module

**`e2e/fixtures/pairingArrival.ts`** — one new file, one exported function.

```ts
import { expect, type Page } from '@playwright/test'

/** Drive an unpaired launch through the pairing form to a confirmed pairing. */
export async function pairFromUnpairedLaunch(page: Page, payload: string): Promise<void>
```

Behaviour — the six-line common segment, moved verbatim, in order: wait for `textarea[aria-label="Pairing code"]` to be visible → `fill(payload)` → click `Pair` (`exact: true`) → wait for `[aria-label="Server key fingerprint"]` to be visible → click `Confirm` (`exact: true`). Returns `void`; resolves immediately after the `Confirm` click, adding no wait of its own.

The comments currently at `launchPairedApp.ts:214-215` (why the pre-fill visibility wait settles the pending→pairing route; why `exact` on `Pair` avoids the busy `Pairing…` label and the `Cancel` button) and `:220-221` (the fingerprint card's presence is the proof, its text is never compared) explain the moved lines and travel with them into the new module's body.

**Why `e2e/fixtures/`, not a new directory.** `conversationStateFake.ts` already establishes `e2e/fixtures/` as the home for shared, side-effect-free e2e modules that are not Playwright fixtures; `docs/knowledge/codebase/420.md` calls this "the `e2e/fixtures/` convention". A new `e2e/steps/` directory would buy nothing the existing convention doesn't already provide.

### Module invariants (state these in the file header)

1. **Import only `@playwright/test`.** Never import from `launchPairedApp.ts` or `realDaemon.ts`. Both call `base.extend(...)` at module scope and export their own `test`; importing either from here would drag a second fixture extension into specs that must keep using the other one. This is the constraint that forced a third home in the first place, and the header is where it stays enforced against a future "just reuse the encoder" edit.
2. **`payload` is secret-bearing and opaque.** It is filled into the textarea and referenced nowhere else — see "Error handling" for the specific prohibitions.
3. **The step ends at `Confirm`.** Post-confirm readiness gates differ per caller and are not this module's business.
4. **`unpair-repair.spec.ts` is deliberately not a caller.** Say so here, so the next reader doesn't "finish the sweep".

### The seam

Divergence begins **after** `Confirm`, not after the fill. The fingerprint assertion and the `Confirm` click are inside the common segment. Drawing the seam at the fill instead would leave ten duplicated fingerprint/`Confirm` pairs behind and re-create the exact silent fan-out this ticket removes.

After `Confirm`, the fixture does its list→thread row click plus the Send-enabled wait; each `real-*` spec runs its own readiness gate (a seeded row, a Rename pencil, a save-as-channel affordance). None of that is common; none of it moves.

### Call-site edits

Every site already has `page` and `payload` in scope, so each is a two-part edit: delete the now-dead locator declarations, and replace the five-line drive with `await pairFromUnpairedLaunch(page, payload)`.

| File | Delete declarations | Replace drive block |
|---|---|---|
| `e2e/fixtures/launchPairedApp.ts` | (inline — no named locators; see note) | 213–223 |
| `e2e/real-claude.spec.ts` | 104, 105 | 110–114 |
| `e2e/real-claude-interrupt.spec.ts` | 127, 128 | 136–140 |
| `e2e/real-claude-permission-modal.spec.ts` | 138, 139 | 147–151 |
| `e2e/real-claude-queue-drop.spec.ts` | 156, 157 | 173–177 |
| `e2e/real-daemon-conversation-lifecycle.spec.ts` | 79, 80 | 82–86 |
| `e2e/real-daemon-promote.spec.ts` | 106, 107 | 109–113 |
| `e2e/real-daemon-rename.spec.ts` | 57, 58 | 60–64 |
| `e2e/real-daemon-session-settings.spec.ts` | 47, 48 | 50–54 |
| `e2e/real-daemon-workspace.spec.ts` | 87, 88 | 90–94 |

Notes on applying these:

- **Anchors are from `main` and shift after the first edit in a file.** Within each file, apply the *higher*-numbered edit (the drive block) before the lower-numbered one (the declarations), or re-read between edits.
- **In four specs the two doomed declarations sit inside a larger locator block whose other members stay.** `real-claude` (`conversation`, `sendButton`, `composer`), `real-claude-interrupt` (+ `interruptButton`), `real-claude-permission-modal` (+ `dialog`), `real-claude-queue-drop` (+ the queued-flow locators). Delete exactly the `pasteBox` and `fingerprint` lines; leave the rest and their comments untouched.
- **Import line.** Nine specs add `import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'` alongside their existing `./fixtures/realDaemon` import; the fixture adds `from './pairingArrival'`. Do **not** re-export the step from either fixture module — that would recreate the coupling invariant 1 exists to prevent.
- **`expect` stays imported everywhere.** All ten files retain other `expect` calls after the edit; confirm rather than assume when removing lines.
- **`real-claude-permission-modal.spec.ts:108`** holds a *dialog-scoped* `Confirm` locator (`dialog.getByRole(...)`) unrelated to pairing. It stays.
- **Update the fixture's block comment at `launchPairedApp.ts:199-205`.** It currently claims "All pairing/navigation selectors live here", which stops being true. The payload-construction rationale in the same comment stays.

### The boundary — `unpair-repair.spec.ts` is not an eleventh site

It holds the same textarea selector twice (`:36`, `:67`) but after a **mid-session unpair flip** from an already-paired session, and it uses the locator as a *teardown proof* (count 0 while the thread is live, visible after the flip) — never to drive the form. Re-pointing it through an arrival step would be semantically wrong.

It also destroys a downstream control if touched: #662 pins `App.tsx:133`'s mid-session `onUnpaired` flip as deliberately out of scope and uses this file staying green **and byte-unchanged** as the negative control proving the pin held.

AC5 names this file as the place the secret-hygiene contract is written down. **Read it as a reference; do not edit it.** `git diff -- e2e/unpair-repair.spec.ts` must be empty.

### Out of scope — named so the developer doesn't drift

- **Deduping `encodePairingPayload`** (private at `launchPairedApp.ts:129`, exported at `realDaemon.ts:423`). The obvious adjacent cleanup; explicitly not this ticket.
- **`smoke.spec.ts:69`'s `.pairing` unpaired-boot assertion.** A semantic claim about what an unpaired launch shows — it changes with #662's behaviour, not with this extraction.
- **Re-pointing the pairing selector, retuning waits, or parameterising the step into a second launcher.** Behaviour-preserving extraction only. The payload *contents* differ between the fake stack and the real daemon; the arrival and the driving do not.

## State + concurrency model

No store, no state. The step is a straight-line sequence of awaited Playwright actions on a `Page` the caller owns.

- **No timeouts introduced or changed.** Every wait uses Playwright's default assertion timeout, exactly as the ten sites do today. Do not add a `timeout` option; the callers' own generous element-level timeouts (`HANDSHAKE_TIMEOUT_MS`) live past the seam and stay there.
- **No lifecycle ownership.** The step launches nothing and registers no teardown. The fixture's LIFO teardown drain (`launchPairedApp.ts:244-250`) is unaffected — the step creates no resource to release.
- **No `test.step()` wrapper.** It would change trace and report structure (a behaviour change under AC4's "exactly as on `main`") and a step title is one more place a payload could be interpolated. Keep it a plain async function.
- **Placement inside the fixture is load-bearing:** strictly below the `reuseUserDataDir` early return at `:194-197`. On a reused paired dir the persisted blob routes straight to the ChannelList, so there is no pairing screen and the step would hang.

## Error handling

Failure surfaces as a Playwright locator timeout from the underlying `expect`/`click`/`fill` — unchanged from today, since the calls move verbatim.

- **No `try`/`catch`, no custom error messages, no re-thrown wrappers.** A hand-written message is both a behaviour change and the most likely place a payload leaks.
- **Do not add a custom assertion message argument** to any of the two `expect` calls.
- **Never assert on the payload's value.** Specifically, no `toHaveValue(payload)` — a failing value assertion prints both sides of the diff, which would put the pairing payload straight into the report. No site does this today; do not introduce it.
- **No `console.log`, `testInfo.attach`, or `testInfo.annotations`** in the new module.

Playwright's own timeout message names the selector and the timeout only, never the filled value — that property is what preserves the secret-hygiene contract through the extraction.

## Testing strategy

**No new test.** This is a behaviour-preserving extraction; the ten call sites *are* the test, and the repo's test-first convention is satisfied by the pre-existing green suite. A vitest unit over a Playwright `Page` driver would test nothing real — do not write one.

Verification is three gates, in order. Run `npm run build` (or use the npm e2e scripts, which chain it) before reading any run as a pass: a failed build leaves a stale `out/` that Playwright will happily drive and report green against.

**Gate 1 — behavioural, covers the fixture edit.** `npm run e2e`. The 28 fixture riders actually execute the extracted step end to end. This is the only gate where the step's runtime behaviour is proven. Must be green, with the same test count as `main`.

**Gate 2 — load-time, covers the nine.** `npm run e2e:real-claude`. On the agent pipeline the real stack is absent, so the expected result is **`N skipped`, not an error**. Per `docs/knowledge/codebase/420.md:22`, that clean skip is the documented load-time proof for a fixture-module move: a wrong import path fails at Playwright module resolution, before collection, and the run *errors* rather than skips. Record the count and state explicitly in the PR whether the specs skipped or executed — a skipped run does **not** prove the nine bodies are correct, only that their import graph resolves.

**Gate 3 — completeness, deterministic.** The sweep itself is the deliverable, and a half-sweep is invisible to gates 1 and 2. Assert the post-sweep counts:

| Command | Before | After |
|---|---|---|
| `grep -rF 'Pairing code' e2e/ \| wc -l` | 14 | **5** (1 in `pairingArrival.ts` + 4 in `unpair-repair.spec.ts`) |
| `grep -rF 'Server key fingerprint' e2e/ \| wc -l` | 10 | **1** |
| `grep -rF "name: 'Pair', exact: true" e2e/ \| wc -l` | 10 | **1** |
| `grep -rF "name: 'Confirm', exact: true" e2e/ \| wc -l` | 12 | **3** (`pairingArrival.ts`, `real-claude-permission-modal.spec.ts:108`, `unpair-repair.spec.ts:58`) |

Plus two diff assertions: `git diff --name-only main` lists nothing outside `e2e/` (bar this spec file), and `git diff -- e2e/unpair-repair.spec.ts` is empty.

**Not a gate:** a standalone `tsc` pass over `e2e/`. `docs/knowledge/codebase/420.md:28` records pre-existing `env: {[k]: string | undefined}` vs Playwright's `{[k]: string}` errors in `electronApp.ts` / `launchPairedApp.ts` / `smoke.spec.ts` that Playwright's own transpiler tolerates. If run at all, run it on `main` first and diff the error sets — only new errors mean anything.

## Open questions

- **Nothing blocks implementation.** The seam, the home, the signature, and all ten anchors are settled above.
- **#613 (pairing restyle) re-points this exact selector** and is `OPEN` with `rework-count:1`. Its branch is 0 commits ahead of `main` today, so there is no file overlap and no block is warranted. If #613 lands first, the anchors above shift and the developer re-derives them with the greps in Gate 3. If it lands after, the shared step is the single place it edits — which is this ticket working as intended, not a conflict.
- **The function name is chosen to survive #662.** When the welcome screen goes in front of the pairing form, `pairFromUnpairedLaunch` gains a "click through the welcome CTA" line and the name still reads true. Do not rename it to something that encodes today's entry point.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the module introduces no boundary. `payload` is already-encoded, caller-constructed test data crossing from the test process into the app's real pairing UI, which is exactly the boundary the ten sites exercise today; the app-side validation (`parsePairingPayload`, the `#97` loopback check) is untouched production code. Driving the *real* UI rather than a test hook is preserved — no forced route dispatch, no store mutation, no relaxed validation.
- **[Tokens, secrets, credentials]** No findings, with an enforced constraint. The step becomes the single chokepoint every e2e pairing payload flows through, which concentrates the risk: one careless diagnostic would break secret hygiene across all ten sites at once. The design forecloses each vector explicitly under "Error handling" — no custom assertion message, no `toHaveValue(payload)` (its failure diff would print the payload), no `test.step` title interpolation, no `console.log`/`attach`/`annotations`, no `try`/`catch` wrapper. The synthetic-token discipline is unchanged: the fixture's `DUMMY_TOKEN` (`launchPairedApp.ts:46`) and the real fixture's `daemon.pairFields.token` are constructed by the callers, and the step neither inspects, stores, returns, nor re-encodes what it is handed.
- **[File / storage operations]** Not applicable by design — the module touches no filesystem path. Per-run `--user-data-dir` isolation and its `rm` teardown stay entirely in `launchPairedApp.ts:154-158`, above the extracted segment.
- **[Inter-process / Electron attack surface]** No findings — zero production LOC. No `webPreferences`, IPC channel, `contextBridge` surface, protocol handler, or navigation guard is added or altered. AC3 (diff confined to `e2e/`) is asserted mechanically by Gate 3's `git diff --name-only` check, so a drift into `src/` cannot pass silently.
- **[Cryptographic primitives]** Not applicable — no RNG, no key handling, no hashing. `encodePairingPayload` (base64url of JSON, both copies) is explicitly out of scope and untouched; the Noise handshake still runs unchanged past the seam.
- **[Network & I/O]** No findings — no socket, no URL parsing, no timeout policy. The relay URL still reaches the app only through the caller-built payload, and the loopback affordance (`#97`) is neither widened nor bypassed. Notably the step does **not** introduce a timeout override, so no wait is silently lengthened past a hostile-relay deadline.
- **[Error messages, logs, telemetry]** No findings — this is the category most at risk from the extraction and it is the one the design constrains hardest (see Tokens above). Reinforcing property: `playwright.real-claude.config.ts:10-11` deliberately enables no screenshot, trace, or video precisely because a trace could capture more than DOM text. The spec adds nothing that would change what a report contains, and forbids `testInfo.attach`, which is the one API in a plain helper that could write payload bytes into a report artifact.
- **[Concurrency]** No findings — straight-line awaited calls, no launched task, no timer, no listener, no `AbortController` to thread. The step creates no resource, so `launchPairedApp.ts`'s LIFO teardown drain is unaffected. One real placement hazard is called out rather than left to chance: the step must sit below the `reuseUserDataDir` early return (`:194-197`) or it hangs waiting for a pairing screen that never mounts — a hang, not a leak, but it would strand the fixture.
- **[Threat model alignment]** No findings for this ticket; two threats named and deferred. *Renderer compromise reaching the transport* and *malicious relay* are unaffected — zero production change. **OUT OF SCOPE:** the entry-point relocation and its `App.tsx:133` mid-session `onUnpaired` pin belong to **#662**, which is `blockedBy` this ticket; the `unpair-repair.spec.ts` byte-unchanged requirement (AC2) is what preserves #662's negative control, so editing that file here would silently remove a downstream safety property. That coupling is documented in "The boundary" so it survives review.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
