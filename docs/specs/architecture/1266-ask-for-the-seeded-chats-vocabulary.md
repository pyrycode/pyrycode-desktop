# #1266 — the real-claude effort drive ASKS for the seeded chat's vocabulary

Spec-only. One drive step added to `e2e/real-claude-effort-default.spec.ts` and one named
diagnostic reworded. No production file is touched, and the client's ask-once-never-retry
posture is not touched either — this converts a wait on a lossy push into a request the drive
itself causes, using the route the app already supports.

## Files read

- `e2e/real-claude-effort-default.spec.ts` → the drive under repair: it activates the seeded row
  ahead of turn 1, then reads `.run-config__effort-segment` with no ask behind that read.
- `src/renderer/src/activateConversation.ts` → `activateConversation` — `requestConversationConfig`
  is called OUTSIDE the changed-id gate, on purpose and documented as such, so re-activating the
  row already open re-fires the ask. The clear branch (`dispatchTimeline reset`, `clearSessionId`,
  `clearRunConfig`) is INSIDE that gate, so a re-click of the open row disturbs neither the thread
  nor the run configuration.
- `src/renderer/src/PairedShell.tsx` → `requestConversationConfig` — the four asks it fires, one of
  them `requestModelList`; and `onOpen`, the sidebar row callback that runs `activateConversation`.
- `src/renderer/src/store/modelListBridge.ts` → `requestModelList` — unconditional given a non-null
  conversation id, no memo, no per-conversation gate: a second activation genuinely sends a second
  `request_model_list`. Its header states the rule this ticket must respect: one shot per
  activation, never a retry.
- `src/renderer/src/store/historyPageBridge.ts` → `requestOpeningHistory` — the ONE ask in that set
  that does carry a per-conversation gate (`getHeld(...) !== null` returns early), which is what
  makes a re-click safe: the deliberately non-idempotent history prepend does not run twice.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the row render — the open row is still a
  live `<button className="channel-list__row-open" aria-current="true" onClick={onOpen}>`, so the
  drive's existing `seededRow` locator addresses a clickable control after the chat is open, not a
  disabled or re-tagged one.
- `docs/knowledge/features/composer-effort-menu.md` § the `real-claude-effort-default.spec.ts`
  paragraph → why the one real turn is driven through the SEEDED row (the bootstrap session is the
  source of the daemon-wide fallback), which this change must not disturb.

## Design source

N/A — spec-only. Zero production files, nothing rendered changes, so there is no visual surface for
a Figma node to pin. The ticket carries no `## Figma` section for the same reason.

## Context

The drive's read of the seeded chat's effort segments has no request behind it. The client asks for
a conversation's model list exactly once per activation, and the drive activates the seeded row
*before* turn 1 — when the bootstrap session has no claude child and therefore no vocabulary — so
that ask is answered with nothing. Everything after turn 1 rides on the daemon's **unsolicited**
push once the child spawns, a frame `modelListStore`'s header documents as best-effort and lossy,
landing inside a 15 s timeout. A lost push presents exactly as the 2026-09-07 19:31 UTC red did: a
real turn, then a timeout wearing a daemon-side diagnostic that was not true. The refiner's triage
falsified the stale-daemon reading three ways (same binary either side of the transition, no
relevant commit between, every relevant symbol present in the binary).

## Change

Between turn 1's quiesce and the sheet open, the drive re-activates the seeded row — one click on
the `.channel-list__row-open` button it already holds a locator for. That runs
`activateConversation` with an unchanged id, which skips the clear branch and fires
`requestConversationConfig` → `requestModelList` for the seeded conversation, whose bound session
now has a live claude child with a retained list. The read that follows is then preceded by an ask
the drive caused, at a moment when the daemon has something to answer with.

The named diagnostic on that read is reworded to match. It currently blames a stale or changed
`pyry`, which is the reading this ticket exists to retire; it now states that the ask was made after
the child was live and went unanswered, which is the actionable cause once a lost push is off the
table. It keeps `ROUNDTRIP_TIMEOUT_MS` unchanged — the timeout is a round trip for a request that
now exists, not a window for a push to arrive — and there is no skip and no soft-pass, so a daemon
that genuinely publishes nothing still fails here (AC2).

Nothing else in the drive moves. The header gains a paragraph naming the re-activation and why it
is a request rather than a retry.

### Rejected, and why they are worth naming

- **An opening `toHaveCount(0)` on the segments before the ask**, to prove the ask caused the read.
  It proves nothing: the sheet is closed at that point, so the locator is empty whatever the store
  holds — a vacuous gate of exactly the family this drive's header already documents twice. Opened
  first to make it non-vacuous, it would fail on the ~14-in-15 runs where the push DID land, turning
  a rare flake into a common one.
- **A drive-side re-ask loop** (click, check, click again). That is the self-inflicted spin against
  a withholding relay that `modelListStore`'s header forbids the client, and a drive that spins
  where the app may not is asserting a behaviour the app does not have. One caused ask, then the
  existing timeout.
- **Navigating away and back.** The only other conversation is minted by the FAB later in the
  drive; an activation with a CHANGED id runs the clear branch and would drop the seeded chat's
  session id and run configuration on the way back.

### Accepted limitation

The re-activation's effect is not independently observable. With the daemon free to push the same
frame unsolicited, no DOM state distinguishes "the list arrived because we asked" from "the list
arrived anyway", and this tier has no outbound frame capture (the daemon is a separate process
behind the content-blind relay — the header's standing divergence list says so). What the change
buys is that the read no longer *depends* on the push; it is not a new assertion.

## Testing strategy

No unit tier applies: this file is a Playwright drive and the change is one interaction step plus
comment text.

- **Typecheck by hand.** No tsconfig includes `e2e/` and Playwright strips types with esbuild, so a
  type error in a spec surfaces in no gate. An ad-hoc `tsc --noEmit` over the spec is the only
  detector; `realDaemon.ts` noise in that output is pre-existing and read by filename.
- **`npm run build`** — unchanged-production proof and the salvage gate.
- **AC3 is discharged by the operator's `npm run e2e:real:gate`**, not by this run: the real-claude
  tier is not the builder's to run, and the ticket carries `needs-real-claude` precisely so it parks
  for that hand-run. A ~1-in-15 flake is also not falsifiable by one green run — the evidence for
  this change is the mechanism (an ask exists where none did), and the gate run confirms the drive
  still passes with the ask in place.

## Open questions

None. The two mechanism questions the design rested on were closed by reading the code rather than
deferred: `requestModelList` has no per-conversation gate (so the re-activation really re-asks), and
`requestOpeningHistory` does have one (so the re-activation does not double the seeded thread's
history page).
