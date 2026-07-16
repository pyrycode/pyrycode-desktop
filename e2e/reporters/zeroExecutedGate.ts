import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'

/**
 * ZeroExecutedGate — the operator pre-ship gate's exit-code enforcement layer (#479).
 *
 * `npm run e2e:real-claude` exits 0 when every `real-*` spec skips (a missing `pyry` / `claude` / a
 * credential). On the agent pipeline that green-on-all-skip is load-bearing — a clean skip proves the
 * fixture graph resolved without needing the real stack (see docs/knowledge/codebase/420.md). But an
 * operator on an under-provisioned machine gets the identical green exit, indistinguishable from a real
 * live pass, so the pre-ship gate can silently run NOTHING and still look like a pass.
 *
 * This reporter — wired ONLY into the separate `e2e:real:gate` entry point via the CLI `--reporter` flag,
 * never the plain `e2e:real-claude` command — closes that gap. When the run PASSED but executed zero
 * tests, it prints the fixture's own skip reason(s) and overrides the run status to `failed`, so the shell
 * sees a non-zero exit.
 *
 * It ONLY upgrades a clean pass. A genuine Playwright failure / timeout / interruption, or a load-time
 * collection error, already exits non-zero and flows through untouched (the `status === 'passed'` guard) —
 * the gate never masks a real failure. A genuine live pass (executed > 0) is likewise left alone.
 *
 * The skip reasons are the fixture's own `testInfo.skip(...)` descriptions (e.g. `` `pyry` not found ``),
 * read verbatim from the test annotations — one source of truth, no re-derivation of which prerequisite is
 * missing. A `testInfo.skip()` fired during fixture setup surfaces on `result.annotations`; a declared skip
 * surfaces on `test.annotations`; both are merged so whichever one carries the string is captured. A Set
 * dedupes the reason all the `real-*` specs share (they gate on the same `pyry` binary first), so an
 * agent/operator machine prints the distinct reason(s) once, not once per spec.
 */
export default class ZeroExecutedGate implements Reporter {
  private executed = 0
  private readonly skipReasons = new Set<string>()

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') {
      this.executed += 1
      return
    }
    for (const annotation of [...result.annotations, ...test.annotations]) {
      if (annotation.type !== 'skip') continue
      const description = annotation.description?.trim()
      if (description) this.skipReasons.add(description)
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | void> {
    // Only ever UPGRADE a clean pass. A non-passed run (real failure / timeout / interruption / load-time
    // error) already exits non-zero — leave it alone. A genuine live pass with executed > 0 is a real pass.
    if (result.status !== 'passed' || this.executed > 0) return

    // Zero tests executed but the run "passed" — the silent-nothing-ran trap. Surface the fixture's own
    // skip reasons (a defensive floor if none were captured, so the gate never fails silently), then fail.
    const reasons =
      this.skipReasons.size > 0
        ? [...this.skipReasons]
        : ['zero tests executed; no skip reason captured']
    for (const reason of reasons) {
      process.stderr.write(`zero-executed gate: no real-* e2e ran — ${reason}\n`)
    }
    return { status: 'failed' }
  }
}
