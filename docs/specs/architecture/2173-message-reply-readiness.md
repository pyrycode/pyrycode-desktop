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
