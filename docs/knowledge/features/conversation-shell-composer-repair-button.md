# Conversation shell — connection recovery actions

Part of [Composer](conversation-shell-composer.md) and
[Conversation shell](conversation-shell.md). Connection feedback and recovery now
share the [Top overlay](conversation-shell-chrome.md#connection-banner-279);
the [composer status row](conversation-shell-composer-status.md) keeps its other
connected-only occupants.

## Actionable-error button, and the row that grows to fit it (#963; Re-pair split out by #1604)

\#963 put actionable connection errors in the composer status row. #1604 moved
Re-pair to the Top overlay; [#2076](https://github.com/pyrycode/pyrycode-desktop/issues/2076)
moved Reconnect and the remaining connection/saved-history feedback there too.
The composer has no connection chip, Reconnect button or recovery callback now.
Both actions use `top-overlay-pill top-overlay-pill--error`, wrap within the pane
and leave timeline/composer geometry unchanged. They have no dismiss X or live
region; the explanatory pill owns the connection announcement.

### Eligibility and copy

The unchanged [pure predicates](composer-send-internals.md#5-re-pair-gate--shouldofferrepair-167)
remain disjoint:

| Action | Predicate | Fixed visible and accessible label |
| --- | --- | --- |
| Re-pair | Non-retryable `error` with `code === 'pairing-rejected'` | Pairing error - Re-pair |
| Reconnect | Non-retryable `error` excluding `pairing-rejected`, `unpair` and `not-paired` | Connection error - Reconnect |

Every non-error state and every retryable error offers neither action. A sealed
`auth.invalid_token` frame establishes pairing rejection. A bare fatal socket
close, including 4421 or 4401, establishes only connection failure and offers
Reconnect. Using a socket close as the repair fixture would exercise the wrong
route. `unpair` avoids a failed-removal loop; `not-paired` has no saved host to dial.

Both labels remain constants in `composerSend.ts`. Error fields select a branch
but never supply DOM text, attributes or logs. Static sentinel tests must keep the
real `pairing-rejected` code to enter the repair arm; an arbitrary code would test
Reconnect instead. Native keyboard focus outlines remain; interactive action
pills share the [overlay hover treatment](conversation-shell-chrome.md#top-overlay-hover).

### Click-time host routing

`TopOverlayControl` reads `useOpenConnectionStatus` for the open conversation's
host. Missing attribution or an unreported host is disconnected, independently of
another server's last event. Both handlers re-read the active conversation,
resolve `conversationHostNow` and recheck that host's current predicate at click
time. Selected host coordinates take precedence; otherwise list ownership must
be unique. A missing owner or an action that became ineligible is a no-op.

`handleReconnect` awaits `window.pyry.reconnectServer(serverId)` for that host.
Main-process lifecycle events remain authoritative; it does not navigate, erase
credentials or set optimistic connection state. A bridge rejection emits only
`composer-reconnect-failed` / `bridge-rejected`, retaining no exception details.

`handleRepair` calls `onRepairHost(serverId)` and opens
[the existing recovery pane beside the sidebar](paired-shell-routing.md#host-recovery-and-navigation-lifetime).
It never calls `runUnpair` or clears stores. Cancel returns to the prior thread;
fingerprint-confirmed same-host pairing replaces credentials and reconnects while
preserving held conversations. Explicit removal remains in Settings.

`ComposerErrorSlotControl` still reads the same host-qualified connection status,
but only to gate its remaining occupants. The pure slot returns
`recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null`
while connected, and `null` otherwise. Hidden reports retain their existing
lifetimes. Usage and the Markdown failure pill remain independent overlay
occupants. Sending and automatic retries keep their prior policy.

### The row grows to fit the button — now only for Reconnect (#963; narrowed by #1604)

This heading retains the old geometry reference. #2076 retired the connection-driven
24px-to-32px transition entirely: neither Reconnect nor Re-pair occupies the row.
The row retains its existing minimum height and activity alignment for other
occupants. Historical chip/button width measurements do not describe the overlay;
its existing Error treatment wraps instead of using the single-line button base.

## Testing

`TopOverlay.test.tsx` uses static markup for connection copy, the saved/loading
matrix, action markup, escaping/sentinel isolation, one atomic polite connection
region and coexistence with existing notices. `ConversationScreen.test.tsx`
asserts the retired surfaces are absent and remaining slot occupants stay
connected-only. `composerSend.test.ts` keeps the disjoint policy matrix and tests
`connectionNotice`. Static renders execute neither handlers nor effects.
Store-bound renders must stage `getInitialState()` for Zustand v5, including the
open conversation, host attribution and matching status; setting only current
state would leave the tested render on an empty initial snapshot.

Mounted `e2e/connection-pills.spec.ts` covers transitions/clearing over empty,
hidden-only and visible saved snapshots, independent restoration settlement,
host switching and recovery routing. At 800px and 1280px it checks wrapping,
unchanged thread/composer bounds, a coexisting usage pill and wheel scrolling
through a gap. `e2e/unpair-repair.spec.ts` exercises both recovery routes, cancellation
and retry after another terminal close. Reconnect completion requires enabled
Send and the owning host's authenticated connection, rather than disappearance
of the button, which also occurs during connecting. `e2e/host-row-per-server.spec.ts`
checks per-host isolation after positively observing the failed host's daemon
state; relay state alone would let an absence assertion pass too early.

Recorded Linux x64 evidence for reviewed head
`11921baa490ad71f014d953d48adb6027f61eedb` comes from the
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2082#issuecomment-6230926518)
on 2026-10-17:

| Recorded run/suite | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Unit gate | 9,272 | 9,272 | 0 | 3 |
| Full configured Playwright application gate | 497 | 495 | 2 | 4 |
| Dispatcher rerun of the two failures | 2 | 2 | 0 | 0 |
| `connection-pills.spec.ts` subset | 5 | 5 | 0 | 0 |
| `unpair-repair.spec.ts` subset | 4 | 4 | 0 | 0 |
| `host-row-per-server.spec.ts` subset | 2 | 2 | 0 | 0 |
| Recorded-client and recorded-permission replay subset | 29 | 29 | 0 | 1 |

The verdict confirms these named mounted suites were present and all their tests
passed. The five connection-pill cases include “connection pills clear and float
over empty rows”, the corresponding hidden/saved cases, “empty saved read loading
is independent of connection and settles silently”, and “switching hosts replaces
connection pills and recovery targets the selected host”. Build/typecheck and
documentation gates also passed. The original failures in `hosted-app-links.spec.ts`
and `thread-activation.spec.ts` remain recorded; the verifier accepted them under
dispatcher flake tracking after the counted rerun, not as a clean initial run.

The verifier also compared integrated empty/saved usage-stack captures at
800×673 and 1280×673 and Reconnect at 800×600 with Figma message area `132:4171`
and pill `347:6617`, with no design deviation. The four application skips were
three macOS-only cases and the existing system-prompt Reset fixme; unit skips
were existing opt-in live cases. These are recorded fake-transport/replay results,
not a fresh documentation-stage test run or live-provider evidence. Live-provider
acceptance is not required for this presentation change; macOS is outside this
Linux ticket's verification scope.
