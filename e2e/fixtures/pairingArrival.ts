import { expect, type Page } from '@playwright/test'

// The shared unpaired-launch pairing-arrival step (#661). Ten e2e sites — the fake-stack fixture
// (launchPairedApp) and nine `real-*` specs — each ran the SAME six lines after an unpaired launch:
// locate the pairing textarea, wait for it, fill it, click Pair, wait for the fingerprint card, click
// Confirm. Divergence begins only AFTER Confirm (the fixture's list→thread click and Send-enabled wait;
// each real-* spec's own readiness gate), so the seam is drawn there and this module owns everything
// above it. That paid off immediately: #662 moved what an unpaired launch lands on (the welcome screen,
// not the pairing form) and it was the ONE-LINE edit below — the CTA click — instead of a ten-file sweep
// in which a missed file stays GREEN, because `e2e/` sits outside both tsconfigs, so no spec is ever
// type-checked, and a bare `playwright test` skips every `real-*` spec via testIgnore, so a partial
// sweep surfaces nowhere until someone runs the real-daemon config.
//
// A PLAIN, SIDE-EFFECT-FREE helper, not a Playwright fixture — the `conversationStateFake.ts` convention
// for shared e2e modules that are not themselves fixtures.
//
// INVARIANTS
//  1. Import ONLY `@playwright/test`. Never import from `launchPairedApp.ts` or `realDaemon.ts`: both
//     call `base.extend(...)` at module scope and export their own `test`, so importing either here
//     would drag a second fixture extension into specs that must keep using the other one. That
//     constraint is why this third home exists; it also rules out reusing either `encodePairingPayload`
//     (private at launchPairedApp.ts:129, exported from realDaemon.ts) — deduping those is out of scope.
//  2. `payload` is SECRET-BEARING and opaque. It is filled into the textarea and referenced nowhere
//     else: never asserted on (no `toHaveValue(payload)` — its failure diff would print the payload),
//     never interpolated into a custom assertion message or a `test.step` title, never console-logged or
//     attached to the report. Every assertion here reads DOM visibility only, so Playwright's own
//     timeout message names the selector and the timeout, never the filled value — which is what carries
//     the callers' secret-hygiene contract through the extraction.
//  3. The step ENDS at Confirm. Post-confirm readiness gates differ per caller and are not this module's
//     business; it introduces no wait and no timeout override of its own.
//  4. `unpair-repair.spec.ts` is deliberately NOT a caller. Its two pairing-textarea locators sit after
//     a MID-SESSION unpair flip, not an unpaired launch, and serve as a teardown proof (count 0 while
//     the thread is live, visible after the flip) rather than driving the form. Do not "finish the
//     sweep": #662 used that file staying green AND byte-unchanged as the negative control for its
//     deliberately-out-of-scope pin on the mid-session `onUnpaired` flip — which still routes to
//     `pairing`, not `welcome`, so those two locators stay correct exactly as written.

/**
 * Drive an unpaired launch — welcome screen, then the pairing form — to a confirmed pairing.
 *
 * The caller owns the launch above and the readiness gate below. `payload` is the caller-built pairing
 * code — the fake stack's synthetic-token payload or the real daemon's `pairFields`; the contents differ
 * between the two stacks, the arrival and the driving do not.
 */
export async function pairFromUnpairedLaunch(page: Page, payload: string): Promise<void> {
  // #662: an unpaired launch now lands on the WELCOME screen, and its primary CTA is what opens the
  // pairing form. The click's own actionability wait settles the pending→welcome route, taking over the
  // role the pasteBox visibility wait below used to play. `exact` matches this file's idiom and keeps
  // the locator correct if a second button ever joins the screen; `.welcome__pair` is the fallback if
  // the CTA copy churns.
  await page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click()

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  // Not redundant after the hop above: this now proves the CTA actually LANDED on the pairing screen,
  // which is the only executable proof of #662's welcome→pairing navigation across all ten drives.
  // `exact` on Pair avoids the busy `Pairing…` label and the `Cancel` button.
  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()

  // Fingerprint card proves #97 active — reached only because parsePairingPayload accepted the
  // loopback ws:// relay. Its presence is the proof; no need to compare the fingerprint text.
  await expect(page.locator('[aria-label="Server key fingerprint"]')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
}
