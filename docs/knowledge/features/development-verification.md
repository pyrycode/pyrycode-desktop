# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## What each test tier proves

Renderer unit tests use static server rendering. They do not execute effects,
click handlers, focus changes, or layout. A removed bridge mount can leave its
import and all unit tests green. Check that each bridge is mounted in the app.
Use the fake-transport browser tier to prove event delivery through the app.

Permission resolution coverage separates these proofs explicitly.
[`modalPrompts.test.ts`](../../../src/renderer/src/store/modalPrompts.test.ts) checks held-owner
detection, silent local/unknown dismissals, per-chat replacement, stale-object guards, reconnect
preservation and pairing reset. [`TopOverlay.test.tsx`](../../../src/renderer/src/screens/conversation/TopOverlay.test.tsx)
pins both client copies, Default treatment, accessible X and usage/resolution/Re-pair order.
Neither static rendering nor reducer tests execute the display timer or navigation cleanup.
[`permission-resolution-notices.spec.ts`](../../../e2e/permission-resolution-notices.spec.ts)
injects `modal_shown`/`modal_dismissed` frames through fake transport to prove both sources, local
silence, X, expiry, deferred display beyond four seconds, chat isolation, navigation without replay
and replacement across the old deadline. Its paused browser clock checks visibility at 3999ms and
absence at 4000ms from display. Same-copy replacement is essential: a timer keyed only to kind/copy
could pass a remote-to-timeout case while expiring a timeout-to-timeout replacement early.

The end-to-end directory has historically been outside the project's TypeScript
configurations. Playwright strips types when it loads a spec. Check the current
configurations before claiming that a green build typechecks a changed spec.
When doing a focused typecheck, distinguish errors in the changed file from known
fixture errors. A fixture option in the wrong argument can be silently ignored.
Read the fixture signature before supplying launch options.

A test that derives its expected value from the same transformation the code under test
performs re-implements that transformation rather than checking it. A wrong mapping is then
reproduced faithfully on both sides and the test passes green. State the expected value
independently, alongside the input, instead of computing one from the other.

A heterogeneous `it.each` table whose rows do not share every field widens to a union type
each row is missing keys from. This can be the only signal that a table-driven test is
silently under-specified; do not treat the resulting type error as unrelated noise to
work around.

A `readonly` array field makes a `TargetType[]` cast in a test a compile error. Narrow on a
discriminant field instead of casting — it typechecks, and unlike a cast it fails loudly if
the value under test turns out to be the wrong union member.

The dispatcher stops its mechanical gate sequence at the first failure.
Later commands then have no verdict. Report which gates actually ran.
Follow the verifier's current instructions for any remaining validation.

A baseline can fail on a different spec from the proposed change. Compare actual
assertions and inputs before calling the difference a regression.
An Electron connection failure is not an application assertion failure.
Investigate the failing spec with repeated focused runs when the evidence suggests
a race. Do not rerun blindly until one result is green.

## Evidence that cannot pass too early

A closing absence assertion can pass before an action completes.
First wait for a positive effect of that specific action, then check the absence.
A positive assertion can also be vacuous if history already satisfies it.
Measure the pre-action count and wait for an increase.
Keep an opening absence check when it proves that a later observation is new.

A width assertion must distinguish the before and after layouts.
A test that passes at both widths cannot prove that resizing changed anything.
`launchPairedApp` initially clicks an unfiltered `.channel-list__row-open` locator,
so seed exactly one conversation for that step. For off-screen routing or a resting,
unopened row, push the second conversation after launch returns. Seeding both in the
initial reply fails before the feature is exercised; see
[`banner-reports.spec.ts`](../../../e2e/banner-reports.spec.ts).

Optimistic state can disappear in the same frame when the fake immediately replies.
Hold the fake response, assert the optimistic state, then send the correlated reply.
A rejection can distinguish states whose successful renderings look identical.

The footer needs a session-settings snapshot before its controls can render.
Check the current refresh trigger. A lone idle event does not produce a transition
from running to idle. Drive the prerequisite transition when the fixture requires it.

## Layout and input

A sticky offset is relative to the scrollport content box.
Read the running window's boxes when a padded scroller is involved.
Flow arithmetic alone can predict the wrong boundary.
An overlay can paint beneath a later positioned sibling when both use automatic
stacking. Check the complete ancestor and sibling arrangement.

Resolution-pill visual evidence covers four states: remote and timeout at both 1280×800 and
800×600 window sizes (1280×772 and 800×572 content viewports). The
[review of implementation revision `1b6aabfe`](https://github.com/pyrycode/pyrycode-desktop/pull/1719#issuecomment-5929842972)
records all four captures compared with Figma Top overlay `132:4171` and Default pill `347:6617`:
token colours, body-small typography, padding, radius, shadow, right alignment, 12px stack spacing
and the exact 8px X matched, and both copies fit at minimum width. Integrated captures show usage
plus resolution; simultaneous usage/resolution/Re-pair order is a static-render assertion backed
by shared layout source, rather than a three-pill screenshot. Captures prove appearance; the
fake-transport spec above proves lifetime and interaction.

Text truncation needs a shrinkable chain of flex items on the relevant main axis.
A bare text node cannot carry its own bounded truncation box.
Check every ancestor between the label and the row.
A parent's computed background cannot detect a child painting over it.
Assert the property on the element whose paint must change.

Do not assume opening a menu or dialog moves focus into it.
Read its focus code and all competing Escape listeners.
A composer-focused key event can reach several document listeners.

A native clipboard bitmap can advertise Files without an image MIME entry.
A simulated keyboard shortcut does not necessarily execute a trusted paste.
Use the Electron window's native paste operation for this case.
Seed the clipboard before the first paste and distinguish rejection branches in
the fake responses.

## Live-test diagnosis

A real-Claude failure can come from the installed daemon being too old or too new
for the client contract. It can also be an unrelated race.
Check the daemon version and the capabilities the test needs.
Compare neighbouring gate runs and per-spec durations before assigning the cause.
Search existing bug tickets before creating another.

The real suite can exit successfully while every test skipped.
Read executed counts, skip reasons and failure evidence.
The automatic dispatcher gate remains the acceptance check for live behaviour.
Follow the Desktop harness and current role instructions for credentials and runs.
Do not import the daemon repository's Go-specific live-test commands.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
