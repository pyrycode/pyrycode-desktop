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
