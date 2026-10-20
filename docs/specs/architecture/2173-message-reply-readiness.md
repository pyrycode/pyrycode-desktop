# Message reply source readiness

## Files read

- `e2e/message-reply.spec.ts` → named pointer/keyboard case: visibility is already satisfied by the partial assistant source; preserve all existing interaction assertions.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `MessageActions`: Reply closes over the committed source prop.
- `src/renderer/src/screens/conversation/copyMessageText.ts` → `appendMessageQuote`: appends the literal source without later replacement.
- `playwright.config.ts` → clipboard serialization, native-writer prerequisite and existing worker/retry policy.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: repository verification boundaries.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → Evidence that cannot pass too early: observe the specific renderer commit before activation.
- `docs/knowledge/features/conversation-shell-message-bubble-testing.md` → Streaming copy input readiness: retain a controlled comparison and distinguish it from historical timing.

## Change

Replace the second Reply's Markdown visibility check with an exact rendered code-block text check for `const x = 1\n`. The fenced suffix is absent from PARTIAL, so this check establishes the full source's React commit before Enter. Keep the initial exact PARTIAL quote and subsequent exact SOURCE quote, including fences, newlines and quotes, and every existing input, focus/caret, remount, editing, payload, clipboard and geometry assertion. Add a scenario-local held-suffix comparison: demonstrate that the old visibility barrier accepts PARTIAL and an activation quotes only PARTIAL, then start the repaired barrier while the suffix is withheld, release the suffix and require the full quote. No product, shared harness, timeouts, retry or scheduling changes.

One useful behaviour: reliable current-source reply verification, with its diagnosis and regression. Estimate ≤180 written lines including this plan and evidence receipts; 0 production files, exported symbols, consumer updates or reject branches; 3 acceptance criteria. No in-flight remote feature branch touches `e2e/message-reply.spec.ts` after the initial fetch. No lifecycle/identity state is added. No visual or documentation requirements apply. The issue labels were read before this plan commit; no security-sensitive label is present.

## Testing strategy

- First run the held-suffix control with the old boundary and observe the missing-suffix failure; retain its report. Then keep an explicit passing before/after comparison in the spec using the repaired readiness check.
- Linux only: build, run the controlled comparison, run the original named case 20 consecutive times with retries disabled, run the entire message-reply spec, and run the full default `npm run e2e` suite. Preserve native-writer dependencies and configured workers. Report exact counts, actual workers, revision and report paths; confirm the original named case executes.
- After merging latest main, run the pre-verify check against `src/renderer/src/screens/conversation/copyMessageText.test.ts` and `npm run build`. No provider credentials or fresh live acceptance required.
- Publish a cause/evidence receipt on #2173, retaining historical failure/rerun references and explicitly limiting the controlled proof to the reproduced readiness gap.

## Historical evidence

- #2166 verifier source `86484e0c680078e229dd85c6b63b60c4c7f0ca9b`: 523 executed, 522 passed, 1 unrelated failure, 5 skipped; unchanged-tree targeted rerun 4 executed/passed, 0 failed/skipped/retried, including this exact case. Four configured workers, one actual rerun worker. Retrieved bundle `/tmp/builder-2173/evidence-2166/7e8f100df68550534890f992bdd6c4ec8a4c7fa7489309495b156c7503591f04/` contains the verdict, rerun JSON log and original tail. Its `pointers.json` retains the full original on build-hp-1 at `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2166_7.log`, SHA-256 `021f313b28067571a3c1b21e228eade3dc95111198972e1ce1c8d293a295002a`; the tail omits this assertion.
- [#2089 occurrence](https://github.com/pyrycode/pyrycode-desktop/issues/2173#issuecomment-6290819089), source `7049f002ef789c14a131082bacd14a098091dd8c`: 526 executed, 525 passed, 1 failed, 4 skipped, zero retries; second quote missing the code-fence suffix. Unchanged-source loaded comparison: 5 executed/passed, 0 failed/skipped/retried, two configured/actual workers, native-writer retained. Original build-fractal-2 paths `/tmp/manual-2089-20261020-7049f002/application-runtime.stdout` and `loaded-rerun.stdout`; PR #2093 retains hashes/context.
- [Refinement inventory](https://github.com/pyrycode/pyrycode-desktop/issues/2173#issuecomment-6291823801) also retains #2125's 2026-10-20T08:46:41.866Z occurrence. These historical reports establish intermittency and the missing-suffix symptom, without recovering their exact input/delivery/commit schedule. The held-suffix test supplies a separate controlled ordering proof.

## Revisions

2026-10-20: Controlled baseline reproduced the missing-code-fence quote on unchanged production at `7db59e7b0af351d22aa49e5dbdd922dc9e275582` plus the retained diagnostic test diff. The old visibility barrier accepted partial content, trusted Enter appended PARTIAL, and delivering the suffix afterward did not repair the draft: 2 executed, 1 native-writer passed, 1 comparison failed, 0 skipped/retried, 3 configured / 1 actual worker. Report `/tmp/builder-2173/old-control.json`, log `old-control.log`, failure context under `old-control-results/`; diagnostic source `old-boundary-control.spec.ts` SHA-256 `4d9fe9b6ec8ac10817cb3f246ac5cce3874a62d771611013cf674d1335d5b4cc`. This is a controlled schedule, not a reconstruction of historical schedules.

The shipping comparison retains that old-boundary partial quote, starts the content-specific barrier before release, observes absent code and a pending barrier after renderer animation frames, then releases the suffix in `finally` and awaits readiness before Enter. Its attachment records the exact before/after quotes. The original named case changes only its readiness assertion. No design departure or open question remains.

## Linux acceptance receipts

Tested candidate `dd069c67295a0e015d3fad6e519dc6838b62a59e`, with main `e83ec64fd338` merged. Normal build provenance records that revision and `sourceDirty: false`; retained at `/tmp/builder-2173/build-provenance.json`. Linux x64/Xvfb, Electron 33.4.11. Subsequent receipt edits affect this plan only.

| Run | Executed | Passed | Failed | Skipped | Retried | Configured / actual workers |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Named case, 20 consecutive repetitions | 20 | 20 | 0 | 0 | 0 | 3 / 1 |
| Complete message-reply spec, including native prerequisite | 7 | 7 | 0 | 0 | 0 | 3 / 1 |
| Initial complete default suite | 529 | 528 | 1 | 4 | 0 | 3 / 3 |
| Unchanged-code thumbnail comparison, including native prerequisite | 2 | 2 | 0 | 0 | 0 | 3 / 1 |
| Second complete default suite | 529 | 528 | 1 | 4 | 0 | 3 / 3 |

The repetition invocation additionally executed/passed its one native-writer prerequisite (21 total executed/passed). The named case and held-suffix comparison each executed/passed once in the complete spec and both full default suites. Every result had retry index 0. The final complete default attempt's receipt follows on completion.

Commands retained normal project scheduling and workers: `npx playwright test e2e/message-reply.spec.ts --grep 'pointer and keyboard replies' --repeat-each=20 --retries=0 --reporter=list,json`, `npx playwright test e2e/message-reply.spec.ts --reporter=list,json`, and `npm run e2e -- --reporter=list,json`. Each used `PLAYWRIGHT_JSON_OUTPUT_NAME` and `--output` under `/tmp/builder-2173/`; reports are `repeat20.json`, `spec.json`, `default.json`, with matching `.log` files and `*-results/` artifacts. The original failed control is `old-control.json` and `old-control.log`.

Final pre-verify passed all five checks, including 16 executed/passed quote/copy units, 0 failed/skipped, after the final main merge. Candidate build passed, and the full default command rebuilt the same clean candidate. Logs: `candidate-pre-verify.log`, `candidate-build.log`, `default.log`. Native ABI preparation ran sequentially before browser acceptance. No provider credentials or live-Claude proof were required; macOS is outside this ticket's verification scope.

Report SHA-256: `old-control.json` = `563c97e02e3c6c8b03b3627816387caabb28570f60c9e86c6550b92d655b28ec`; `spec.json` = `d94cf35212da8582dbe1c00d2b7310666230a3b60642bb2305eacca139928c76`; `repeat20.json` = `f8a8737d0d275ecd12132dade0435ccab1affd2dd990ec428f443d388a6d9fe7`. Committed test source SHA-256 = `fa4a78f16789ddcc7584bcab17b4341eab6324b1db07ceea1e9415f08918ce70`.

The initial default report completed despite the builder's wall-clock stop. Its only failure was the untouched `thread-scroll-pin.spec.ts` case `a thumbnail resolving leaves a scrolled-up reader where they were, above them or below them`, at the pre-resolution parked-scroll equality (expected 1260, observed 2416). Both reply cases passed. Existing/open issue searches found no owner; [#2183](https://github.com/pyrycode/pyrycode-desktop/issues/2183) now owns this separate investigation in Backlog at priority:low. No scroll production code, test, timeout or scheduling was changed or skipped. The exact thumbnail case then passed unchanged with its native prerequisite, so a new full default run was started without changing code or suite selection.

Initial failed report `default.json` SHA-256 = `03c6cf0b3d1c08b516529d00d616e3f64a2feda0a1bef33349c9ec848221535a`; focused comparison `thumbnail-rerun.json` SHA-256 = `bf45166fd508a53140cf62bb4828ed7687a10350bb7106b72cb42ed8b9a4bff0`. Logs/contexts remain under `/tmp/builder-2173/default.log`, `default-results/`, `thumbnail-rerun.log` and `thumbnail-rerun-results/`. The second full build records clean revision `2f04ed82ad26de46832aa2505f89937d8763aa9b` in `rerun-build-provenance.json`; its only difference from `dd069c67` is this plan's evidence. No historical failed result is converted into a pass.

The second full run passed the thumbnail case and both reply cases, but the existing held-items case `defers 8333 held items and commits real composer input during unfinished expansion` failed waiting for row 8339 containing `Revised while closed` after reopening (120-second existing deadline). The initial full run passed this same case. Existing [#2184](https://github.com/pyrycode/pyrycode-desktop/issues/2184) owns its expansion/closed-revision investigation; its priority and assertions remain untouched. This occurrence is at the later reopened-revision wait, distinct from #2184's retained initial-expansion timeout. Report `default-rerun.json` SHA-256 = `13356a457249184913d6b8ba14e2dc17660590cfa0d2c190a415dc29c15c650a`, with `default-rerun.log` and `default-rerun-results/` retained. One final full attempt will keep all original tests, timeouts, retries, workers and dependencies.
