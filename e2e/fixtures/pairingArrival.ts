import { expect, type Page } from '@playwright/test'
import { observeWelcomeClick } from './welcomeDiagnostics'

// The shared unpaired-launch pairing-arrival step (#661). Ten e2e sites — the fake-stack fixture
// (launchPairedApp) and nine `real-*` specs — each ran the SAME six lines after an unpaired launch:
// locate the pairing field, wait for it, fill it, click Pair, wait for the fingerprint card, click
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
//  1. Import only Playwright and plain helpers. Never import from `launchPairedApp.ts` or `realDaemon.ts`: both
//     call `base.extend(...)` at module scope and export their own `test`, so importing either here
//     would drag a second fixture extension into specs that must keep using the other one. That
//     constraint is why this third home exists; it also rules out reusing either `encodePairingPayload`
//     (private at launchPairedApp.ts:129, exported from realDaemon.ts) — deduping those is out of scope.
//  2. `payload` is SECRET-BEARING and opaque. It is filled into the pairing field and referenced nowhere
//     else: never asserted on (no `toHaveValue(payload)` — its failure diff would print the payload),
//     never interpolated into a custom assertion message or a `test.step` title, never console-logged or
//     attached to the report. Every assertion here reads DOM visibility only, so Playwright's own
//     timeout message names the selector and the timeout, never the filled value — which is what carries
//     the callers' secret-hygiene contract through the extraction.
//  3. The step ENDS at Confirm. Post-confirm readiness gates differ per caller and are not this module's
//     business; it introduces no wait and no timeout override of its own.
//  4. `unpair-repair.spec.ts` is deliberately NOT a caller. Its two pairing-field locators sit after
//     a MID-SESSION unpair flip, not an unpaired launch, and serve as a teardown proof (count 0 while
//     the thread is live, visible after the flip) rather than driving the form. That boundary still
//     holds: converting it into a caller remains wrong and remains out of scope. (#664 re-pointed those
//     two locators at the accessible name — the sweep #662 had deferred while it used that file staying
//     byte-unchanged as its negative control. The mid-session `onUnpaired` flip stays out of scope and
//     still routes to `pairing`, not `welcome`.)

/**
 * Drive an unpaired launch — welcome screen, then the pairing form — to a confirmed pairing.
 *
 * The caller owns the launch above and the readiness gate below. `payload` is the caller-built pairing
 * code — the fake stack's synthetic-token payload or the real daemon's `pairFields`; the contents differ
 * between the two stacks, the arrival and the driving do not.
 *
 * `label` (#834) is the operator's optional host name. OPTIONAL, so all ten existing call sites are
 * untouched and keep pairing without one. Invariant 2 applies to it as written: it is filled and
 * referenced nowhere else — never asserted on by value, never interpolated into a `test.step` title or
 * an assertion message, never logged. It is not a credential, but the field sits directly below the
 * pairing-code field and a mis-paste of the payload into it is an anticipated mistake
 * (PairingScreen.tsx:306-315 bounds the field for exactly that reason), so it gets the same hygiene.
 */
export async function pairFromUnpairedLaunch(
  page: Page,
  payload: string,
  label?: string
): Promise<void> {
  // #662: an unpaired launch now lands on the WELCOME screen, and its primary CTA is what opens the
  // pairing form. The click's own actionability wait settles the pending→welcome route, taking over the
  // role the pasteBox visibility wait below used to play. `exact` matches this file's idiom and keeps
  // the locator correct if a second button ever joins the screen; `.welcome__pair` is the fallback if
  // the CTA copy churns.
  await observeWelcomeClick(page, () => page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click())

  await drivePairingForm(page, payload, label)
}

/**
 * Drive a PAIRED session's second pairing — Settings, then "Pair another server", then the same form —
 * to a confirmed pairing (#1091).
 *
 * The second entry point this module gained. The first pairing enters at the welcome CTA; a session
 * that is ALREADY paired reaches the very same `PairingScreen` through the shell's `pairServer` route,
 * behind the sidebar menu and then the Settings row — the navigation `paired-shell-navigation.spec.ts`
 * already drives. Only the form tail below is common, which is exactly why it is now factored out
 * rather than transcribed a second time: invariant 2 is the reason. A copied tail would be a SECOND
 * place for a payload-bearing assertion to creep in, and there is no gate in this repo that would
 * catch it — `e2e/` is type-checked by nothing and a `real-*` spec is `testIgnore`d out of the default
 * tier.
 *
 * The caller owns the readiness gate below (invariant 3 unchanged): post-Confirm the shell routes to
 * the NEW server's list via `navigateToNewServerList`, but waiting for that is the caller's business,
 * not this module's.
 *
 * `label` carries the same meaning and the same hygiene it carries above.
 */
export async function pairAnotherServerFromSettings(
  page: Page,
  payload: string,
  label?: string
): Promise<void> {
  // The always-mounted sidebar menu is reachable from both list and thread.
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Pair another server', exact: true }).click()

  await drivePairingForm(page, payload, label, true)
}

/**
 * The form itself — paste, optional host name, Pair, fingerprint, Confirm. Module-PRIVATE: it is the
 * shared tail of the two exported entry points above and never an entry point of its own, because a
 * caller reaching it directly would be one that skipped the navigation proving it landed on the right
 * screen.
 *
 * Every assertion inside reads DOM visibility only, so Playwright's own timeout message names the
 * selector and the timeout and never the filled value — the one place invariants 2's payload hygiene
 * is now enforced for both flows.
 */
async function drivePairingForm(page: Page, payload: string, label?: string, modal = false): Promise<void> {
  const pasteBox = page.locator('[aria-label="Pairing code"]')
  // Not redundant after the caller's navigation: this proves that navigation actually LANDED on the
  // pairing screen — the only executable proof of #662's welcome→pairing hop across all ten unpaired
  // drives, and now equally the proof of #1091's Settings→"Pair another server" hop.
  // `exact` on Pair avoids the busy `Pairing…` label and the `Cancel` button.
  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)

  // BEFORE Pair, not after: `EntryPage` and `ReviewCard` are alternative phases of `PairingView`, so
  // this field is gone by the fingerprint card. The reducer carries `state.label` through submitting →
  // reviewing → confirming, and the confirm sends it (trimmed; an empty or whitespace-only one is sent
  // as no label at all — pairingState.ts). Attribute selector on the accessible name, this file's idiom.
  if (label !== undefined) {
    await page.getByRole('textbox', { name: modal ? 'Host name' : 'Host name (optional)', exact: true }).fill(label)
  }

  await page.getByRole('button', { name: 'Pair', exact: true }).click()

  // Fingerprint card proves #97 active — reached only because parsePairingPayload accepted the
  // loopback ws:// relay. Its presence is the proof; no need to compare the fingerprint text.
  await expect(page.locator('[aria-label="Server key fingerprint"]')).toBeVisible()
  await page.getByRole('button', { name: modal ? 'Pair' : 'Confirm', exact: true }).click()
}
