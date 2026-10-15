# Development verification — evidence that cannot pass too early

Positive processing barriers and nonvacuous absence assertions.
See [development verification](development-verification.md) for the topic map.

## Evidence that cannot pass too early

A closing absence assertion can pass before an action completes.
First wait for a positive effect of that specific action, then check the absence.
A positive assertion can also be vacuous if history already satisfies it.
Measure the pre-action count and wait for an increase.
Keep an opening absence check when it proves that a later observation is new.

Renderer evaluation completion does not establish delivery of fire-and-forget IPC. When an
observation callback sends synchronously, a later sentinel command on the same ordered outbound
path, received at the fake daemon, establishes processing before checking that no publication
occurred. Keep the exclusion condition active until that receipt; restoring it earlier can let
an incorrect excluded publication satisfy the subsequent positive poll. See
[visible-tail read publication](development-verification-what-each-test-tier-proves.md#visible-tail-read-publication)
for the focus/context-usage barrier and the forced-publication control that rejects this false pass.

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

The reset regression in
[`composer-context-claude-reading.spec.ts`](../../../e2e/composer-context-claude-reading.spec.ts),
`reset completion requests context once and refreshes footer and gauge without a message`,
holds the completion reply while both displays retain 40%. Visible wrapping-up and restarting
labels establish that phase frames were processed before checking that no request was added.
The inactive edge produces one new request addressed to the reset conversation. Two more inactive
frames precede the correlated reply; the footer and gauge changing to 5%, with 10K of 200K tokens,
form the positive processing barrier before checking that request count stayed at two and no message
was sent. An immediate count after pushing inactive frames could pass before they reached the app.
Reopening then produces its separate activation ask.

The [verifier verdict for #1749](https://github.com/pyrycode/pyrycode-desktop/pull/1798#issuecomment-6006397775)
confirms this named regression was present and passed, along with the other two tests in that spec,
in the dispatcher gate at `1f994132db599066efd744a9df57a542195133e0` on 2026-10-06:
279 executed, 279 passed, 0 failed and 4 skipped. This is fake-transport evidence; no live-Claude
result is claimed.

A streaming assistant row includes cursor and metadata text, so an exact-text locator
can miss a visible delivery marker. Target the assistant role wrapper with `hasText`
for the positive barrier, then assert duplicate absence. In
[`live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts), a later
`assistant_delta` on the same encrypted stream proves the preceding receipts passed
through the mounted app before the one-row checks; an immediate count alone could
pass before either receipt arrived.

Visible assistant text can also precede `turn_end` processing. A whole-row replay
snapshot taken then includes the streaming cursor, so normal settlement can look
like a replay mutation. In
[`disconnected-message-delivery.spec.ts`](../../../e2e/disconnected-message-delivery.spec.ts),
observe each answer with its cursor before pushing its `turn_end`, then wait for
that answer's cursor to disappear before reading the baseline. Requiring the
cursor to appear first prevents an absence assertion from passing before the delta
is rendered. Keep the later replay-processing barrier before comparing rows;
settlement and replay processing are separate observations. The
[delivery verification](daemon-connection-disconnected-delivery.md#delivery-verification) records
the controlled reproduction and counted automatic, explicit and terminal evidence.

The footer needs a session-settings snapshot before its controls can render.
Check the current refresh trigger. A lone idle event does not produce a transition
from running to idle. Drive the prerequisite transition when the fixture requires it.
