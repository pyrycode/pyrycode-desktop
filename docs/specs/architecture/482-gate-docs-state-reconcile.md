# Spec #482 — Gate-docs state reconcile: one state page, three pointers

**Ticket:** [#482](https://github.com/pyrycode/pyrycode-desktop/issues/482) · **Size:** S · **Type:** documentation (zero production code) · **Not security-sensitive · No Figma (docs, not rendered UI)**

## Files to read first

Read all four target files end-to-end before editing — the deliverable is their *mutual* consistency, so you must hold all four in view at once. This is a comment-only / prose-only pass; no `src/` change.

- `README.md:22-50` — § Pre-ship gate + § License. The section to rewrite. It currently overclaims (`npm run e2e:real-claude` presented as the working "one net", line 35; "that is the RED this test exists to catch", line 44) and predates the #449 arc entirely (no mention of `e2e:real:gate`, `live-drive.mjs`, or current state).
- `docs/knowledge/features/live-e2e-runbook.md:72-133` — "## Automated coverage is deferred" + "## Cross-references". **This file becomes the single state page.** Lines 88–94 (the "as of #449 … red … do not treat as a working pre-ship gate" paragraph), the `e2e:real:gate` tail at 105–106 ("#449 must land first"), the `live-drive.mjs` framing at 108–113 ("in place of the still-red e2e:real-claude"), and the two cross-ref bullets at 126 and 132 all carry stale #449-red framing.
- `docs/knowledge/features/real-claude-liveness-e2e.md:79-85, 213-217, 244-245` — the three stale #449-red callouts to drop (a blockquote, an edge-case bullet, a Related bullet). Lines 33–60 describe the three sibling specs as *capabilities* (what they test) — **leave those; they are architecture description, not state claims.**
- `e2e/real-claude.spec.ts:22-38` — the header comment. Lines 28–31 are the stale `TODO(#449) … currently RED` block to drop. Lines 24–26 (skip-gating), 33–35 (SCOPE), 36–38 (SECRET HYGIENE) stay.
- `docs/knowledge/features/live-e2e-runbook.md:108-122` (already in the range above) — read closely to internalize that `scripts/live-drive.mjs` is the **live-RELAY** gate (built app → *production* relay → live daemon). `e2e:real-claude` never dials the live relay — it uses a *local* fake relay. #449 curing does **not** retire `live-drive.mjs`; only the "use it because e2e:real-claude is red" framing changes.

**Out of scope — do not touch:** `docs/knowledge/codebase/*.md` (449.md, 252.md, 445.md, 446.md, 432.md, 480.md, …) are documentation-phase-owned. `docs/specs/architecture/13-live-e2e-round-trip-runbook.md` is the #13 architecture spec, a different file from the runbook — do not confuse them. Any `src/` production file.

## Context

On **2026-07-16** the first full `npm run e2e:real-claude` run landed **5 passed / 3 failed**. That flipped the gate docs stale in two opposite directions at once:

1. **README overclaims.** § Pre-ship gate names `e2e:real-claude` as the working gate with no nuance — it predates the whole #449 arc (PR #476's doc reconcile updated the runbook, feature doc, and spec header but missed README).
2. **The #449-red callouts are now stale the other way.** The runbook, feature doc, and spec header still say the send/stream spec is red on the isolated-HOME reply-fan-out issue. The 2026-07-16 run proved **#449 cured** — send/stream green in ~7.7s, first ever, fixed by the 2026-07-15 daemon repairs. The three specs that fail now are different (`real-claude-interrupt`, `real-claude-queue-drop`, `real-claude-permission-modal`), all on daemon bug **pyrycode#1050**.

**Root cause of both drifts: current gate state is copied into four places, so any state change strands the copies.** The fix is structural, not a one-time text patch: make the **runbook the single page that carries current gate state**, and have README, the feature doc, and the spec header *point at it* instead of restating it. After this change, the next state flip updates one section, not four.

## Design principle

> **One state page. Three pointers.** The runbook (`live-e2e-runbook.md`) owns the *only* standalone red/green/pass/fail assertion about the real-claude gate. README, the feature doc, and the spec header describe what the gate *is* and *does* (stable facts) and link the runbook for what state it is *in* (volatile fact). No file outside the runbook may make a claim a reader must independently keep in sync.

This is the same "push responsibility to the single owner" shape the pipeline uses elsewhere — the volatile fact lives in exactly one place; everyone else references it.

## Per-file change spec

### File A — `docs/knowledge/features/live-e2e-runbook.md` (gains the state; becomes the single owner)

**A1. Add a new, prominently-named state section** so the other three files have a stable target to point at. Place it as a standalone `##` section immediately **before** "## Automated coverage is deferred" (top of the automated-gate discussion, giving a clean anchor). Suggested heading + content (adapt to the runbook's voice; the *facts* are the contract, per AC2):

```markdown
## Current real-claude gate state

**Last run: 2026-07-16** — first full `npm run e2e:real-claude` run: **5 passed / 3 failed**.

- **#449 send/stream is CURED.** The core send/stream spec (`real-claude.spec.ts`) streamed a real
  reply and went **green for the first time (~7.7s)**, fixed by the 2026-07-15 daemon repairs. The
  isolated-HOME reply-fan-out gap that had kept it red is resolved.
- **Three specs still red**, all on daemon bug **[pyrycode#1050](https://github.com/pyrycode/pyrycode/issues/1050)**:
  `real-claude-interrupt.spec.ts`, `real-claude-queue-drop.spec.ts`, `real-claude-permission-modal.spec.ts`.

This section is the **single** authoritative record of real-claude gate state. README, the feature
doc (`real-claude-liveness-e2e.md`), and the spec header point here instead of restating it — so the
next state change updates one place, not four.
```

Facts that MUST appear (AC2): 2026-07-16 run · 5 passed / 3 failed · #449 send/stream cured (green, ~7.7s, fixed by 2026-07-15 daemon repairs) · the three named red specs · failing on pyrycode#1050 · explicit "this is the single page carrying gate state." Link pyrycode#1050 to the daemon repo (`pyrycode/pyrycode`, not this repo).

**A2. Rewrite the stale #449-red paragraph** (currently ~lines 88–94, "As of #449 that harness spec is red on the live stack … do not treat `npm run e2e:real-claude` as a working pre-ship gate until it lands an actual live green there; the live diagnosis is tracked on #449"). Keep the stable facts (it SKIPs cleanly under the `testIgnore` gate in `playwright.config.ts`; never seeded green in the pipeline's `npm run e2e`). Drop the "as of #449 red / do not treat as a working gate / tracked on #449" state framing and point at § Current real-claude gate state for the run result.

**A3. Trim the `e2e:real:gate` paragraph tail** (~lines 96–106). Keep the whole description (exit-code-safe form of the harness; turns silent all-skip into a non-zero exit naming the missing prerequisite; still dials a **local** fake relay; does **not** supersede `scripts/live-drive.mjs`). **Drop only the stale closing clause** "it does **not** resolve the #449 live reply-fan-out gap — a real green still needs the real stack, and #449 must land first."

**A4. Reframe the `live-drive.mjs` paragraph** (~lines 108–113) — do **not** delete it (live-RELAY path, complementary; see Context note 2). It currently reads as "the current interim operator pre-ship gate … Run it before a ship **in place of the still-red `e2e:real-claude` harness spec**." Reframe as the **live-RELAY** pre-ship gate (built app → *production* relay → live daemon → vault workdir) that `e2e:real-claude` never exercises (it dials a *local* fake relay). It is complementary, not a stand-in-for-a-red-spec. **Keep** the #480 exit-code / `finally`-cleanup safety paragraph (~115–122) intact.

**A5. Fix the two cross-reference bullets:**
- ~Line 126 (Real-claude liveness e2e bullet): drop "**currently red for #449** pending the isolated-HOME reply-fan-out diagnosis"; point at § Current real-claude gate state instead.
- ~Line 132 (`scripts/live-drive.mjs` bullet): drop "while `e2e:real-claude` stays red"; reframe as the live-RELAY companion (covers the live-relay path `e2e:real-claude` never touches).

### File B — `README.md` § Pre-ship gate (lines 22–46) (loses the overclaim; gains a pointer)

Rewrite so the section (AC1): describes the gate **commands** (`npm run build`, `npm test`, and the real-claude gate), and **links the runbook** for current state. It must carry **no standalone state claim** — no "this is the working gate" / "the one net that catches…", no #449 assertion, no red/green claim a reader must keep in sync.

- **Keep** the intro ("There is no CI (by policy), so before shipping run the gate locally:") and the three-command code block. In the block, name the real-claude gate command and its exit-code-safe sibling `npm run e2e:real:gate` (#479); replace the "(see below)" comment with a runbook pointer.
- **Replace** the mechanism paragraph (current lines 32–37): keep a one-sentence *mechanism* description (drives a real `pyry` daemon running real `claude --model haiku` through an in-process, content-blind **local** fake relay, and skips cleanly when `claude`/`pyry`/a credential is missing) — but **remove** the "this is the one net that catches 'the real daemon never replied'" working-gate framing.
- **Add** a pointer line, e.g.: *"See the [live e2e runbook](docs/knowledge/features/live-e2e-runbook.md) § Current real-claude gate state for the current pass/fail state, the full prerequisite list, the exit-code-safe `npm run e2e:real:gate`, and the live-relay `scripts/live-drive.mjs` gate."*
- **Prerequisites block (lines 39–46):** you may keep a compact prerequisite list (it is stable usage info, not a red/green claim) **but strip the state-flavored parenthetical** "(that is the RED this test exists to catch)" on line 44 — that is a state assertion and violates AC5. Preferred: trim the block to a one-line "skips cleanly without `claude`/`pyry`/a credential" and defer the detail to the runbook pointer, to avoid re-stranding a prerequisite copy.

Net: README ends with commands + one mechanism sentence + one runbook pointer, and zero red/green/#449/#1050/cured wording.

### File C — `docs/knowledge/features/real-claude-liveness-e2e.md` (drops three stale callouts)

Remove all three #449-red callouts (AC3) and point at the runbook for current state instead of asserting its own:

- **C1 — blockquote (~lines 79–85):** the "> **As of [#449] this spec is red on the live stack** … do not treat `npm run e2e:real-claude` as a working pre-ship gate — `scripts/live-drive.mjs` is the current interim gate …" block. **Delete it.** Replace with a one-line pointer, e.g. *"For the current pass/fail state of this gate, see the [live e2e runbook](live-e2e-runbook.md) § Current real-claude gate state — the single page that carries it."*
- **C2 — edge-case bullet (~lines 213–217):** currently "**RED/GREEN is a manual PR observation, not automated.** … Per #449, the current live-stack observation is RED for a different, still-open reason (isolated-HOME reply-fan-out) — see the callout above." Reword so it makes **no current-state claim**: keep the stable methodology fact (pass/fail is a manual PR observation — no CI, no agent creds — recorded once by the operator, mirroring `pyrycode#854`'s convention) and drop the "Per #449 … RED … see the callout above" sentence, replacing it with a pointer to the runbook § Current real-claude gate state. Avoid the literal "RED/GREEN" phrasing where it could read as a live state assertion (see AC5 grep note).
- **C3 — Related bullet (~lines 244–245):** currently "#449 codebase notes — the isolated-HOME reply-fan-out diagnosis that **currently keeps this spec red on the live stack**; `scripts/live-drive.mjs` is the interim gate until it resolves." Reword to past tense / historical (the #449 diagnosis is resolved) and point at the runbook for current state, **or** drop the bullet. It must not assert a current red state.

Leave the sibling-spec descriptions (lines 33–60) and every other paragraph untouched — they describe *what the specs test*, not gate state.

### File D — `e2e/real-claude.spec.ts` header (drops the stale TODO)

Delete the `TODO(#449) … currently RED …` block (lines 28–31) and replace with a one-line pointer (AC4). Comment-only; no code / no behavior change. Example replacement:

```ts
// Current gate state (which real-claude specs pass/fail) lives in the live e2e runbook —
// docs/knowledge/features/live-e2e-runbook.md § Current real-claude gate state — the single page
// that carries it. This header stays state-free so it never drifts.
```

Keep lines 24–26 (skip-gating) and 33–38 (SCOPE, SECRET HYGIENE). No `RED`/`GREEN`/`#449`/`#1050`/`cured` wording survives here.

## Verification (this replaces "testing strategy" — no unit tests for a docs pass)

1. **AC5 negative grep — the load-bearing check.** After editing, confirm no state claim survives outside the runbook:
   ```bash
   grep -rniE 'red|green|cured|#449|1050' \
     README.md \
     docs/knowledge/features/real-claude-liveness-e2e.md \
     e2e/real-claude.spec.ts
   ```
   Every hit must be gone, OR be a non-state usage (e.g. an unrelated word). No hit may be a standalone red/green/pass/fail assertion about the real-claude gate. Then grep the runbook and confirm the state *does* live there:
   ```bash
   grep -niE '5 passed|3 failed|cured|1050|2026-07-16' docs/knowledge/features/live-e2e-runbook.md
   ```
2. **Salvage gate stays green:** `npm run build` (typecheck + electron-vite build). No `src/` was touched and the spec-header edit is comment-only, so this must remain clean. `npm test` is unaffected (it does not load the `testIgnore`'d real-claude spec). No need to run `npm run e2e:real-claude` — the agent environment can't (no daemon/claude/creds), and this pass changes no test behavior.
3. **Link sanity:** every pointer resolves — README → `docs/knowledge/features/live-e2e-runbook.md`; feature doc → `live-e2e-runbook.md` (same dir); spec header → the runbook path as plain comment text. Each names the § Current real-claude gate state section rather than a raw anchor (so a future heading rename doesn't break it).

## Acceptance criteria mapping

- **AC1** → File B. **AC2** → File A1 (+ A2–A5 remove the stale competing claims). **AC3** → File C. **AC4** → File D. **AC5** → Verification step 1 (only the runbook makes a red/green claim).

## Open questions

- **Exact "5 passed" breakdown.** The AC pins the 3 failures by name and the send/stream pass; it does not enumerate all 5 passes. Record the numbers and the named breakdown verbatim from the ticket (operator-observed facts). Do not compute or invent a per-spec arithmetic reconciliation — if the passing set is obvious from the run, a parenthetical is fine, but the 3 named red specs + the cured send/stream are the load-bearing facts.
- **State-section placement.** Recommended immediately before "## Automated coverage is deferred". If the developer finds a more natural home *within* that section, that's acceptable as long as it is a clearly-named heading the other three files can reference by name.

## Scope note — why this is one ticket, not four

Four files trip the mechanical ">3 files" red line, but this is the documented cross-file-**consistency** exception, not a rationalized override: the deliverable *is* the mutual consistency of the four files. Per-file children cannot be self-contained — splitting would strand exactly the copies this ticket exists to unify (the precise failure mode). Zero production lines, zero compile/test coupling, no max_turns risk for a bounded doc pass. Production-source-file count (per the commit-time self-check: `*.ts`/`*.tsx` excluding `*.spec.ts`/`*.test.ts`/`*.md`/the spec) is **0**. Human pre-validated `size:s`. **Not split.**
