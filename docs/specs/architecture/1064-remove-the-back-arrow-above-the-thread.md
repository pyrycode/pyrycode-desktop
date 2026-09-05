# 1064 — Remove the back arrow above the thread

## Files read

Codegraph is not initialised in this repo (every `mcp__codegraph__*` call returns "CodeGraph not
initialized"), so this list was built with Grep and Read rather than `codegraph_context`. Noted here
because the reading list is normally that tool's output.

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `BackControl`, its mount site inside
  `ConversationScreen`, and the `onBack` field of `ConversationScreenProps` — the control being deleted,
  the prop that stays, and the `{onBack && <ThreadOverflowMenu …/>}` gate that must survive it.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__back` and its `:hover` /
  `:focus-visible` / `-icon` companions (deleted), plus the three surviving comments that cite them:
  `.tool-row__chip--toggle:focus-visible`, `.status-sheet__close`, `.conversation__overflow-trigger`.
  Also `.conversation__overflow` — `position: absolute`, which is why nothing reflows into the gap.
- `src/renderer/src/screens/settings/settings.css` → the file header and `.settings__back` — the
  surviving twin of the deleted rule, and the two comments that cite the deleted one as their source.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__archive`,
  `.channel-list__settings`, `.channel-list__fab` — three more comments citing the deleted rule.
- `src/renderer/src/PairedShell.test.tsx` → `BACK_MARKER` and the `route='thread'` test that asserts it —
  the file the ticket newly names, and the one that goes red without an edit.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `#140` pair of tests around
  `aria-label="Back"` — the AC1 detector lives here, inverted.
- `src/renderer/src/pairedRoute.ts` → `nextPairedRoute` — confirms `back` is absolute (always `list`),
  which is what makes the Settings detour a faithful substitute for the deleted click.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the sidebar gear, `aria-label="Settings"` — the
  replacement route's entry point; a Grep of the whole renderer confirms that accessible name is unique,
  so `getByRole('button', { name: 'Settings' })` stays unambiguous with the thread mounted.
- `e2e/paired-shell-navigation.spec.ts`, `e2e/thread-scroll-pin.spec.ts`, `e2e/paired-shell-card.spec.ts`
  and the seven throwaway-navigation specs listed under **Design** — the eleven click sites.
- `docs/knowledge/features/e2e-harness.md` § the #451/#452 entries → the sheet-scrim lesson: the
  Channel-info sheet's `.status-sheet-overlay` blocked `.conversation__back` until `.status-sheet__close`
  was clicked. That lesson is the stated reason for the close click at
  `conversation-create-rename.spec.ts`, and this ticket is what invalidates the reason. Resolved under
  **Design**.
- `docs/knowledge/features/conversation-shell-chrome.md` § "Back control (#140)" and § "Unpair control
  (#166, deleted by #1061)" → the shape the documentation phase will fold this into. Not edited here.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3321

The chat screen's `Content` frame, read as an *absence*. It is an 820×1262 column holding exactly two
children — `Message area` at y=20 and `Input area` below it — plus the detached options overlay. The
screenshot confirms the metadata: the first thing drawn inside the frame is an assistant message bubble
flush against the card's 20px inset. There is no header band, no leading glyph and no title row above the
thread, so the change this ticket makes is to *stop* drawing something the design never drew. Nothing new
is added and no token is consulted. The header row Juhana will draw later is a separate frame not yet in
this node.

## Context

`BackControl` is the mobile chat screen's leading affordance (#140), ported when the app showed one
screen at a time. Since #670 the sidebar is permanently mounted beside the thread, so the arrow no longer
navigates anywhere — it *deselects*, flipping the shell's route from `thread` to `list` and emptying the
right pane while the sidebar stays exactly as it was. Operator call of 2026-09-04: it goes.

The header region itself stays. Juhana ruled the same day that it comes back drawn, carrying a channel
title and a channel settings button, and that he will draw it. This ticket removes one control, not the
region. Its sibling #1061 removed the Unpair control and the bare header row from the same region and has
merged; after this ticket the region's only survivor is the overflow trigger, floating with no row until
the drawn header lands.

The consequence is deliberate and is not a regression to compensate for. The arrow was the only deselect
*from inside the thread*; the empty pane itself stays reachable three other ways, all landing on route
`list` (`back` is absolute in `nextPairedRoute`): the shell enters at `list`, Settings and Archive return
there through their own back controls, and the delete and archive exits dispatch `back` too. The thread
starts ~56px higher (a 48px control plus `--space-1` margins in a flex column with no top padding), and
the absolutely-positioned `.conversation__overflow` — which reserves no flow space — comes to float over
the thread's top-right corner. Both are expected. **No compensating padding, spacer or reserved band.**

No ADR is warranted: this deletes a control, introduces no contract and reverses no recorded decision.

## Design

Five edits, no new code.

**1. Delete the control.** Remove `BackControl` from `ConversationScreen.tsx` (the function, its `#140`
comment block, and its call site at the top of `.conversation`'s children). `onBack` stays on
`ConversationScreenProps` and its `{onBack && <ThreadOverflowMenu …/>}` gate stays untouched — the prop is
the screen's "am I mounted in the paired shell" signal, and dropping it would unmount the overflow menu,
which is not the ask. Two comments in this file name the deleted symbol and are re-worded rather than
left dangling: the `onBack` prop's own comment ("when absent, `BackControl` renders null") and the
overflow-menu gate's ("the established … signal (BackControl's gate)").

**2. Delete the rules.** `.conversation__back`, `:hover`, `:focus-visible`, `.conversation__back-icon`
and the `#140` comment block above them go from `conversation.css`. No other rule body changes anywhere.

**3. Re-point eight comment citations across three stylesheets.** A comment citing a rule that no longer
exists is worse than one citing none.

| Site | Treatment |
|---|---|
| `conversation.css` → `.conversation__overflow-trigger` | re-point the "glyph-in-48px treatment" at `.composer__send`, which survives |
| `conversation.css` → `.status-sheet__close` | collapse the parenthetical addressed to this ticket by number — it exists only to explain a deferral this ticket resolves |
| `conversation.css` → `.tool-row__chip--toggle:focus-visible` | swap the leading name out of the `:focus-visible` example list, and correct the asserted count |
| `settings.css` → file header, and `.settings__back` | `.settings__back` was the *duplicate*; it is now the original. State the treatment directly rather than sourcing it from a deleted rule |
| `channels.css` → `.channel-list__archive` (×2), `.channel-list__settings`, `.channel-list__fab` | re-point at `.settings__back`, the surviving twin carrying the identical 48px treatment — the preference `archive.css` already expresses |

The count in the `.tool-row__chip--toggle` comment ("this file's `:focus-visible` idiom at seven call
sites") is wrong today, not merely wrong after the deletion: `conversation.css` currently declares
`outline: 1px solid var(--color-outline)` in 21 rule blocks. It becomes 20 once `.conversation__back`
goes, and that is what the comment will say. The same deletion invalidates a second count of the same
thing in the same file — the `#1063` note above `.composer__row`'s retired ring says "21 other call
sites" — so that one is corrected in the same pass. It is one word, in a sentence about the same fact,
and leaving two counts of one quantity disagreeing inside one file is not a smaller change than fixing it.

**4. Renderer tests.** `ConversationScreen.test.tsx` holds the shipped `#140` pair — one test asserting
the affordance renders with `onBack`, one asserting it does not without. After this change both renders
agree, so the second is no longer discriminating anything and goes; the first is **inverted in place** and
becomes the AC1 detector. `PairedShell.test.tsx` goes red without an edit: `BACK_MARKER` is one of its
route discriminators and the `route='thread'` test asserts `toContain(BACK_MARKER)`. `CONVERSATION_MARKER`
(`aria-label="Send"`) already discriminates the thread, so the marker const, its assertion, and the two
comments describing the thread as carrying `aria-label="Back"` all go together.

**5. e2e — eleven clicks in ten specs, three treatments.**

*Throwaway navigation (eight sites, seven specs): delete the round trip, act on the target directly.*
Every one of these clicked back only to reach a sidebar element, and since #670 the sidebar is already on
screen while the thread is open. Two of these specs already carry comments recording an *earlier*
`.conversation__back` click deleted for this reason, so this is the same edit again.
`conversation-archive-lifecycle` (→ `.channel-list__archive`), `conversation-create-rename` ×2 (→
`.channel-list` assertions), `conversation-state-fake` (→ `.channel-list__rename`), `default-workspace`
(→ `.channel-list__settings`), `push-toggle-persist-relaunch` (→ the Settings gear by role),
`save-as-channel-promote` ×2 (→ `.channel-list` assertions, then `.channel-list__save`).
`push-toggle-persist-relaunch` pairs its click with a `expect(.conversation).toHaveCount(0)` gate whose
only job was to prove the route flip landed before the gear click; it goes with the click it gated.

At `conversation-create-rename` the preceding `.status-sheet__close` click is justified by a comment
saying the sheet's scrim must be dismissed "before the back button is clickable". **Decision: the click
stays, the reason is re-pointed.** The scrim reason is genuinely gone — `.status-sheet-overlay` is
absolute inside `.conversation`, so since #670 it never covered the sidebar the following assertions read,
and those are `toBeVisible()` checks, which do not hit-test. What earns the click its place instead is
that it completes the sheet's own flow: the Channel-info sheet's rename does not self-close (unlike
`onArchive`/`onDeleteConfirm`, per the harness overview), so without it the spec makes its closing
assertions from behind a modal left open over the pane — a state no operator reaches and a landmine for
any later hit-tested assertion. The comment will say that rather than the retired reason.

*The deselect test itself (one site).* `paired-shell-navigation`'s step 2 tests that Back empties the pane
to `null` rather than to a mounted-but-blank screen. There is no control left to drive it, so the step is
deleted and the spec kept — its other half, that opening a row fills the pane, is untouched and is what
the spec is for. Deliberately **not** replaced with a synthetic dispatch, which would pin a route flip the
thread can no longer reach. Its step 3 then clicks the sidebar gear from the `thread` route, which is
sound: `aria-label="Settings"` is unique in the whole renderer. The spec's preamble comment naming
"three back buttons (thread / settings / archive)" drops to two.

*Load-bearing machinery (two sites): replace the route, do not delete it.*
`thread-scroll-pin` uses Back to unmount and remount the *same* thread, proving the scroll pin dies on
remount; `paired-shell-card` uses it to reach the empty pane and measure that it still draws the card.
Both are routed through Settings instead — gear → `.settings__back` — which works because `back` from
Settings is absolute: it lands on `list`, the pane renders empty, and nothing clears the active
conversation on the way (`activateConversation` resets a timeline only when the id changes, and re-entry
is a click on the same row). Switching rows instead would reset the timeline and destroy
`thread-scroll-pin`. Both keep their `expect(.conversation).toHaveCount(0)` unmount gate: the Settings
route replaces the whole shell, so it still reddens correctly.

Four comments in `real-daemon-conversation-lifecycle.spec.ts` mention `.conversation__back` to explain
that no such click stands there. They drive nothing (this ticket needs no `needs-real-claude` label and no
`e2e:real:gate` run), but they would be left citing a class that no longer exists, so their text is
re-pointed. Comment-only; the spec's drive is untouched.

## State + concurrency model

Unchanged. No store slice, no subscription, no async work, no effect and no teardown path is touched.
`onBack` still reaches `ConversationScreen` from `PairedShellView` and still gates the overflow menu; the
shell's `back` action still exists and is still dispatched by Settings, Archive, and the delete and
archive exits.

## Error handling

No failure modes. The change is a deletion of one presentational control plus comment text; there is no
I/O, no IPC, no parse and no result type in the diff.

## Testing strategy

*vitest (node, `renderToStaticMarkup`)* — the AC1 detector is
`expect(renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)).not.toContain('aria-label="Back"')`,
the shipped `#140` test inverted. It is a real detector: it is the *only* one of the two `#140` tests that
was ever discriminating, since the `onBack`-absent twin passed before this change and passes after. The
bare-screen twin is deleted rather than kept as a second inverted copy. AC1's "unreachable rather than
merely invisible" is what makes the accessible-name assertion the right one — a `display: none` rule would
still leave the name in the markup and would still redden it. `PairedShell.test.tsx`'s `route='thread'`
test keeps `CONVERSATION_MARKER` and loses `BACK_MARKER`; AC2's "Settings and Archive keep their own back
controls" stays proven by `SettingsScreen.test.tsx` and `ArchiveScreen.test.tsx`, which assert
`aria-label="Back"` on their own screens and are untouched.

*Playwright (`e2e/`, fake transport)* — AC2's second half (the shell's `back` still works from Settings
and Archive and still lands on the empty pane) is proven by `paired-shell-navigation` steps 6 and 8, which
survive unchanged, and now additionally by `thread-scroll-pin` and `paired-shell-card`, whose replacement
route *is* that path and which both keep a `toHaveCount(0)` gate on it. AC3 (switching conversations still
works and still keys the pane) is `conversation-switch-remount` and `conversation-switch-keeps-both-threads`,
neither of which clicks the arrow and neither of which is edited. AC4 (the overflow menu untouched) is
`ConversationScreen.test.tsx`'s overflow pair plus the four e2e opens that locate its items by accessible
name; the gate they depend on is explicitly preserved. AC5 is a grep.

No new spec is written. Interaction that a spec proves today is either preserved through a different
route or deleted along with the control that was its only subject — nothing that survives needs a
harness it does not already have.

Scoped gate for this run: `npm test` on the two touched renderer specs, `npm run build`, and
`npx playwright test` on the two replacement-route specs (`thread-scroll-pin`, `paired-shell-card`) —
the only two e2e edits that add steps rather than remove them, and so the only two that can fail for a
reason a deletion cannot. The full suites are the verifier's gate.

## Size

Four production files, one mount site, no new exported types, components or stores, no new state, no
error branches; outside `conversation.css` the production edits are comment text only. Estimated total
written work ~350 lines, nearly all deletion — inside the 800-line and 5-file boundaries.

**One boundary is exceeded and the ticket ships anyway: consumer call sites needing simultaneous update.**
The raw count is 14 — eleven e2e clicks plus three renderer-test sites — against a boundary of 10. No
rationalisation about the edits being mechanical is offered; the count is the count. The ticket ships
whole because **the floor rule outranks the ceiling here and there is no seam to split on**: deleting
`BackControl` reddens all eleven e2e specs and both renderer specs in the same instant, so any child that
deletes the control alone leaves the tier red, and any child that edits specs alone edits them against a
control that still exists. Neither half stands on its own, which is the condition the floor rule names.
By the deliverables test this is one deliverable — one control stops rendering — and the numbers that
drive edit cost stay small: one production call site, zero production consumers, zero signature changes.
The nearest analogue, #1061, was the same deletion in the same region and landed 426+/249- across ten
files as a single S ticket.

## Open questions

1. **Does the `.status-sheet__close` click at `conversation-create-rename` still earn its place?**
   Resolved in **Design** § 5: yes, with a re-pointed reason.
2. **What is the true `:focus-visible` count in `conversation.css`?** Resolved in **Design** § 3:
   21 rule blocks today, 20 after this deletion — and a second stale count of the same quantity, in the
   `#1063` note, is corrected alongside it.
3. **Do comments citing the `BackControl` *symbol* (rather than the `.conversation__back` rule) need
   re-pointing too?** `SettingsScreen.tsx` (×2) and `ChannelList.tsx` (×1) cite it as design provenance
   ("mirroring #140's BackControl"). Deliberately **out of scope**: the ticket enumerates rule citations
   specifically, AC5 greps for the class alone, and touching those two files would take this ticket from
   four production files to six, over the boundary. Flagged here for the documentation phase, which owns
   `conversation-shell-chrome.md` § "Back control (#140)" and will restate that section as the history of
   a deleted control in the shape #1061 established.

## Revisions

### 2026-09-05 — verifier rework (PR #1110 review)

The verifier passed the production change and failed the PR on one test-side finding, plus two
comment-accuracy items and three nits. All six are addressed on the same branch. The design of the
production change is unchanged; what changed is one e2e gate and five comments.

**MUST FIX — `conversation-create-rename`'s AC3 gate went non-detecting (design error in § 5).**
The plan classified this spec's back-arrow click as throwaway navigation, along with the other seven.
That was wrong: in this one spec the round trip was doing a second job. It also parked the drive on
route `list`, where `.conversation__overflow-trigger` is *absent* — and that absence is precisely what
made the next `toBeVisible()` a create-nav gate. With the click deleted the drive never leaves the
thread, so the trigger is mounted from `launchPairedApp` onward and the assertion resolved whether or
not create-nav happened, while its comment still claimed it was the gate.

The new contract: gate on **which conversation is open** rather than on the trigger's presence.
`aria-current="true"` marks the open sidebar row (#1098) and tracks `activeConversation`, which
`useConversationCreatedNav` moves onto the minted row; the created row is unnamed
(`titleFor(null)` = `'Untitled'`) where SEED is named, so reading the marked row's title separates the
two. A create-nav regression leaves the mark on SEED and reddens. This mirrors
`conversation-switch-keeps-both-threads`'s `expectOnlyOpenRow` rather than inventing a locator idiom.

Chosen over the review's suggested alternative (asserting the rename dialog's `"Untitled"` prefill)
because it restores the detector *at the step it belongs to* — immediately after the FAB click, where
AC3's claim is made — rather than several interactions downstream inside AC4's rename flow, where a
failure would no longer name create-nav as the thing that broke.

**The general lesson, recorded because the plan's per-spec analysis is what missed it:** "the deleted
click only existed to reach the sidebar" was checked against what *follows* the click, and that is not
sufficient. A navigation click also establishes a *route*, and an assertion after it may be gating on
something that is only observable from that route. The sibling `conversation-archive-lifecycle` is the
contrast case and survives untouched: its Archive round trip independently lands on `list` before its
own FAB click, so its identical trigger auto-wait still gates.

**SHOULD FIX ×2 — comment claims that overreached.**
- `conversation.css`'s deletion note claimed the class name is "spelled nowhere in this repo any more".
  It returns 16 hits under `docs/`, three of them live package overviews. Scoped to `src/` and `e2e/`,
  which is what AC5 actually asks for, and the surviving `docs/` mentions are named as the
  documentation phase's to hold.
- `paired-shell-navigation`'s step-2 deletion note credited steps 6 and 8 with asserting the empty
  pane. They assert `list` is visible and never read the pane. Re-worded to separate *reached* from
  *asserted*, and to point the surviving assertion at `paired-shell-card`'s `children.length === 0`.

**NIT ×3.** The AC1 detector's name claimed both arms while the body renders only the `onBack` arm
(name corrected, not a second assertion — there is no code path left for a second arm to discriminate).
The `#276` comment still read "gated on onBack presence exactly like BackControl" in the present tense;
re-worded, and it explicitly declines to re-point at the surviving `SettingsScreen` / `ArchiveScreen`
`BackControl`s, which never shared that gate. Open question 3's file-count argument for leaving symbol
citations alone does not apply to a file this PR already edits, so this one is fixed here; the two
untouched files stay out of scope on that argument. Four re-pointed comment lines at 136–152 chars were
re-flowed to the surrounding ~110-char wrap.
