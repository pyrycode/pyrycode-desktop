# Supplied agent cards

## Files read
- `docs/knowledge/INDEX.md`, `CLAUDE.md`: process boundaries and verification rules.
- `docs/knowledge/features/conversation-shell.md`: existing desktop conversation layout.
- `docs/knowledge/features/conversation-shell-timeline-render.md`: supplied route, stable wrappers and scroll restoration.
- `docs/knowledge/features/development-verification.md`: static versus mounted proof.
- Daemon `docs/knowledge/features/thread-package-agents-and-background-work.md` and ADR 042: lifecycle, saved links and parent authority.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `threadItemPresentations`: injectable snapshot adapter.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`, `ToolRow`, `renderGroup`, `useThreadScrollPin`: cards, markers, expansion and scrolling.
- `src/renderer/src/screens/conversation/foldToolRuns.ts` → `foldToolRuns`: fold boundaries without legacy inference.
- `src/renderer/src/screens/conversation/groupToolRows.ts` → `GroupedToolRow`: existing projection contract, used only as reference.
- `src/renderer/src/screens/conversation/threadItems.test.tsx`, `e2e/thread-items.spec.ts`: supplied-input proofs and injected owner.
- `src/shared/wire/thread.ts`, `src/shared/chatHistory.ts`: held snapshot shape; no changes.

## Design source
**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4
The screenshot shows a fixed sidebar beside the scrolling conversation and translucent controls. Reuse existing ToolRow cards, agent markers, typography and theme tokens; existing depth classes cap indentation at two levels. No new assets or styling are needed.

## Context
The dormant supplied route currently draws agents as fallback summaries. It must use saved daemon facts independently of roster inference and main-turn state. Production wiring remains #1908; task controls remain #1938. No ADR is needed.

## Design
Extend the existing ItemPresentation with ancestry, depth, child count/disclosure, linked placement, marker and outcome facts. Agent launch content adapts to an existing tool card only when required display fields and agent status are understood; otherwise retain the bounded escaped summary. Keep saved launch results/denials as details, without manufacturing a result for a final status.
Only shown agent IDs can own shown rows. Disconnect cyclic/self parent edges; retain other valid descendants. Flatten a forest into stable keyed sibling rows so repair never remounts a child. Count distinct shown descendant tool_call IDs only; messages still establish disclosure.
For each sibling lane, insert linked-agent markers at creation order, settle inactive linked cards by positive ended_order (otherwise creation order), and append active linked cards ordered by creation order. Descendants stay with their owner. Validate saved task/call link identities and their dropped/truncated markers. Ordinary linked shells remain tool rows.
ToolRow receives optional supplied outcome treatment, leaving every legacy caller unchanged. Top-level active controls activity and status controls outcome; session endings include escaped saved causes, and gone means unknown outcome. Recorded session/agent attribution remains untouched.
Reuse foldToolRuns with the supplied ancestry and card/marker barriers. Preserve ID-based tool and folded-run expansion. Marker navigation scrolls to the corresponding card and reveals ancestors only; it never changes the target's expansion.
No overlapping in-flight branches were found.

## State + concurrency model
No new protocol/store state or subscription. Existing immutable completed snapshots drive projection; view-local expansion sets and node refs are scoped by host/conversation/epoch. Existing scroll observers and cleanup remain in use with snapshot.items as the presentation change signal.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Child before parent, late parent and reparent | projection: supplied ancestry; mounted: supplied agents repair |
| Self/cycle, hidden/missing/non-agent parent | projection: supplied ancestry |
| Deep nesting and text-only disclosure | projection: supplied ancestry |
| Launch result, stopping and genuine final | static: supplied outcomes; mounted: supplied agents repair |
| Main reply end followed by child work | mounted: supplied agents repair |
| Prior-session reopen and reused scopes | mounted: supplied agents repair |
| Collapse/reveal, revision and older prepend | mounted: supplied agents repair; existing authoritative identity tests |
| Regroup while following or holding reader | mounted: supplied agents repair |

## Error handling
Unsupported status or malformed display content falls back to summary bounded to 4096 characters, rendered as escaped React text. Invalid task identities provide no background membership; invalid parent edges provide no ownership. No I/O or new failure branch is introduced.

## Testing strategy
Test first with projection/static cases beside threadItems.test.tsx covering nesting, counts, lifecycle, linked placement, shell classification, marker identity and malformed fallbacks. Extend the existing injected e2e owner to prove mounted repairs, expansion/navigation and reader retention, prior-session settlement and scope reset. Run the focused fake spec and capture at 1280/800; no live test is changed. Run pre-verify and build after merging main.

## Open Questions
None. The simpler flat forest projection preserves mounted identity across lane changes and avoids recursive component ownership.

## Size check
One card-presentation deliverable, five observable acceptance criteria; approximately 700–760 total written lines, no new exported symbols, three production files, two consumer routes, no protocol state machine. All sizing ceilings hold.

## Revisions
2026-10-11: Child text can share the main reply's recorded session/agent/turn. The new regression demonstrated that the existing usage join would move main usage onto that child. Include recorded parent identity in this display-only join; `keeps main reply usage independent of child traffic sharing a turn` covers it.

2026-10-11: Mounted catch-up-parent tests exposed collapsed residual folded runs when their former first member moved into a card. Remember every member ID when opening a supplied run, so surviving members retain expansion after repair or older prepends. This changes only the supplied route.

2026-10-11: Verifier finding 1 identified that `agentWork` saves an entire `background_task_roster` payload in `task_link`, while `applyAgent` saves the selected `task_id` separately. Accept either a direct link or one roster entry whose usable task/call IDs both match the saved content. Each candidate retains the existing truncation/dropped-field checks; mismatched or damaged entries cannot establish membership. Producer-shaped projection/static tests cover placement, marker/card identity and shell outcomes; the mounted supplied-agent tests now use roster links and assert active/settled ordering before exercising navigation and retained state. No state, styling, wire or legacy-route contract changes.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/conversation-shell-timeline-render.md` § Supplied daemon item presentation — authoritative agent nesting, visibility, descendant tool counts, lifecycle/status fallback, direct and roster-shaped saved task links, sibling placement and launch-marker navigation. Keep the route's inactive production status and #1908/#1938 ownership explicit.
- Pending documentation stage: the same path, § Scoped identity, expansion and attachments and § Saved content and activity — scope reset and expansion retention through parent repair/reparenting/prepends, remembering all folded-run member IDs, and usage attribution including recorded parent identity.
