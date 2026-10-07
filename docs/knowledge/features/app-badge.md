# App icon attention badge

The Dock (macOS) or taskbar (Windows) icon shows how many conversations need the operator, so it
is visible from another window without opening the app. Introduced in [#1592](https://github.com/pyrycode/pyrycode-desktop/issues/1592).
Notifications ([push notifications](push-notifications.md), #391/#392) already tell the operator
*that* something happened; the badge is the missing persistent count of *how many* things still
need them.

## What it does

The badge counts every non-archived, non-muted conversation, across every paired host, whose
sidebar status dot resolves to `input-required` or `new-messages` — exactly the rows
[`ConversationStatusDotControl`](channel-list-status-dot.md) draws a dot for. An outstanding permission
or trust prompt or a pending question batch makes a conversation `input-required`; holding both still
counts once, because the badge counts conversations rather than prompts or batches. `working` does not
count: the sidebar shows it as working, not attention, and counting it would tick the badge up on
every streamed turn. A conversation muted on its host ([#1607](https://github.com/pyrycode/pyrycode-desktop/issues/1607))
does not count either, even with an outstanding prompt — the sidebar status dot is unchanged and
still shows it, only the badge and [notifications](push-notifications.md) go quiet. macOS gets the
system's own Dock badge (`app.setBadgeCount`); Windows, which has no such API, gets a drawn taskbar
overlay — a red disc with a white count, `9+` above nine, cleared at zero.

## Key types and files

| Piece | File |
|---|---|
| `countAttentionConversations`, `conversationStatusNow`, `attentionCountNow`, `subscribeToAttentionStores`, `subscribeAppBadge`, `useAppBadge` | `src/renderer/src/store/appBadgeBridge.ts` |
| `setBadgeCount` `RendererCommand` member, `BadgeCountPayload`, `isBadgeCountPayload` guard | `src/shared/ipc/commands.ts` |
| `badgeLabel`, `drawBadgeBitmap`, `applyBadgeCount` (electron-free) | `src/main/appBadge.ts` |
| `case 'setBadgeCount':` dispatch + `diagnosticLog.event({ event: 'app-badge', count })` | `src/main/index.ts` |
| mount site | `src/renderer/src/PairedShell.tsx`, beside `usePushNotify()` |

## The renderer half: reusing the dot's own composition, not restating it

`conversationStatusNow(row)` takes the actual row's `id`, `read_up_to` and `latest_entry_id`, and
repeats the dot control's five-source read over `getState()` —
`selectHasOutstandingFor`, `selectBatchFor`, `selectActivityFor`, `selectTimelineFor`, `selectLastReadFor`.
The input-required fact is `selectHasOutstandingFor(id)(modalStore.getState()) ||
selectBatchFor(id)(questionBatchStore.getState()) !== undefined`, fed into
`resolveConversationStatus(…, isConversationUnread(timeline, lastRead, row))` with the activity and unread facts. Keep this
composition aligned with the row control when adding an attention source.
`attentionCountNow()` applies the same
`!is_archived` filter the [Channel List view model](channel-list.md) applies to its active list,
plus `row.is_muted !== true` since [#1607](https://github.com/pyrycode/pyrycode-desktop/issues/1607),
over `selectConversations` (every paired server's rows in one array), then calls the pure
`countAttentionConversations(conversations, statusOf)` — which takes its list from the **caller**,
not a fixed source, so the muted-channel filter is one more `.filter` at the call site, not a
change to the counting rule itself. `countAttentionConversations` stays one rule over whatever rows
it is handed; it passes each **row**, rather than only its ID, to `statusOf(row)` and does not know
what "muted" or "archived" mean.

Complete daemon rows count as new messages when `latest_entry_id > read_up_to`, including before
any local timeline is loaded. Each host's row supplies its own read state: two hosts advertising
the same ID can contribute twice, and reading one clears only its contribution. An ID-only status
callback or first-match lookup would lose that isolation. Read advances notify the list subscription
immediately, before refreshed metadata arrives; local opening cannot clear daemon unread.
Incomplete rows keep the persisted local-count fallback. Input-required still outranks working,
which outranks new messages; only input-required/new-messages count, and archived/muted rows remain
excluded even with pending input. Linux browser coverage observes `setBadgeCount` delivery, not
native OS badge rendering; see [verification evidence](development-verification.md#what-each-test-tier-proves).

`subscribeAppBadge({ subscribe, count, sendCommand })` computes once on subscribe and again on every
notification from the six source stores (`conversationListStore`, `modalStore`, `questionBatchStore`,
`conversationActivityStore`, `conversationTimelineStore`, `conversationLastReadStore`, fanned out by
`subscribeToAttentionStores`), and sends `{ type: 'setBadgeCount', payload: { count } }` only when
the count differs from the last one sent. The last-sent value starts `null`, so the very first
computed value always sends — including `0` — which is what makes a reload or reopen re-assert
main's badge rather than trust whatever main is still showing. **The returned teardown is the
last-host clear**: it sends `0` (unless `0` was already the last value) before unsubscribing.
`useAppBadge()` mounts this in `PairedShell` beside `usePushNotify`; unpairing the last host
unmounts `PairedShell`, so the same teardown that stops the subscription is the one that clears the
badge. No new store — the fan-out and the last-sent comparison are the only state, and both live in
the hook's own effect closure.

The question-batch subscription makes both arrival and dismissal recompute the count
([#1700](https://github.com/pyrycode/pyrycode-desktop/issues/1700)). Answer and Cancel each dispatch
`dismissed`; once no prompt or batch remains, the status falls back to the other facts. The row may
still count if it becomes `new-messages`. Reading the question store without subscribing to it would
leave a correct direct status calculation but a stale badge. `appBadgeBridge.test.ts` checks both:
question-only status returns to idle on dismissal, question-only and prompt-plus-question rows each
count once, and writes to every source wake the listener until teardown removes all six subscriptions.

The three closures (`attentionCountNow`, `subscribeToAttentionStores`, `subscribeAppBadge`) are
exported and unit-tested directly, rather than only through `useAppBadge`, because the renderer test
tier is a static `renderToStaticMarkup` render with no DOM and no effects (see the root
`CLAUDE.md`'s renderer-tests note) — a hook body is otherwise unreachable outside Playwright.
`window.pyry` is dereferenced only inside `useAppBadge`'s effect, so `PairedShell` itself stays
server-renderable.

## The boundary: a bare non-negative integer, nothing else

`isBadgeCountPayload` requires `Number.isSafeInteger(value.count) && value.count >= 0` — not
`Number.isInteger`, which admits values like `1e300` that are integers but not a meaningful count.
This rejects negative, fractional, `NaN`, `±Infinity`, non-number and unsafe-magnitude values at the
one place a renderer-controlled number crosses into main. The payload is `{ count: number }` only:
no conversation id, no name, no host string, so a compromised renderer can at worst show a
misleading number — cosmetic, not a leak. `setBadgeCount` is main-local like `notify` (see [Command
channel § the `notify` member](command-channel.md)): it never reaches `../wire/types`, because it
never reaches the daemon.

## The main half: drawing a bitmap Electron can't draw for you

`nativeImage` renders neither SVG nor text, so the Windows overlay is drawn as a raw 32×32 BGRA
bitmap in `drawBadgeBitmap`: a hard-edged red disc (Windows' own critical-badge red, `#C42B1C`) with
the count centred in white, from a small built-in 5×7 pixel font covering `1`–`9` and `+`.
`badgeLabel(count)` closes the input down to that font's exact alphabet before any drawing happens —
`null` at zero, the digit up to nine, `'9+'` above — so `drawBadgeBitmap` never receives anything
outside the glyphs it has.

Every pixel's alpha is either 0 or 255, deliberately: `nativeImage.createFromBitmap` expects
**premultiplied** BGRA, and a hard edge makes premultiplication a non-question (a 0% or 100%-alpha
pixel premultiplies to itself either way). An anti-aliased edge would need real premultiplication or
it renders with a visible halo — noted in the PR's lessons learned as a trap worth avoiding rather
than solving.

**A `flatMap` trap that only a real build caught.** The first pass built the glyph list with
`[...label].flatMap((char) => GLYPHS.get(char))`. Vitest's node environment strips types without
checking them, so `flatMap` happily flattened each glyph's *own* row array (`readonly string[]`)
into the outer array — producing a flat list of row-strings instead of a list of glyphs — and the
unit suite still passed, because pixel positions were merely wrong, not thrown. Only `npm run build`
(the typecheck) or an actual rendered bitmap would have shown it. The fix wraps each hit in a
single-element array (`glyph === undefined ? [] : [glyph]`) so `flatMap` only ever flattens the
outer, intentional level.

`applyBadgeCount(count, deps)` takes the platform, `setBadgeCount`, `overlayWindow()` and `toImage`
all as injected dependencies — the same shape as `fireNotification`/`selectDockIcon` — so every
branch unit-tests against plain values and a fake window, with no `electron` import in the module
itself. On `win32` it calls `setOverlayIcon` on the current window (skipped when absent or
destroyed), `null` to clear at zero, otherwise the drawn image with a description built only from
the label (`"1 conversation needs attention"` / `"N conversations need attention"`). Every other
platform calls `app.setBadgeCount(count)` directly, which macOS both draws and clears itself.

**A deviation from the ticket's note.** The ticket named `live.window` as the overlay target, but
`LiveWindow.window` (see [live window](live-window.md)) exposes only the focus/activate faces
`push notifications` needs, not `setOverlayIcon`. Widening it would have added a sixth production
file to an estimated five. The composition root instead calls
`BrowserWindow.getAllWindows()[0] ?? null`: the app holds at most one window at a time, a reopen
happens only at zero windows, so the first window in that list is always the current one. A
reopened window's renderer re-sends its count regardless, because the bridge's `lastSent` starts
`null` on every fresh mount.

## Edge cases and limitations

- **The Dock badge outlives the renderer on macOS.** The app keeps running after its last window
  closes; the count-computing renderer is gone with it, so the badge keeps showing its last value
  until a Dock reopen (`activate` → a fresh window) mounts a new shell and re-sends. Flagged at code
  review as a shared, pre-existing limit — `usePushNotify` is renderer-owned the same way — and not
  worth a fix without an observed complaint.
- **The 32×32 overlay's on-screen fidelity is unverified.** There is no Windows runner; the unit
  tests pin the bitmap's shape and the call, and the author rendered it to a PNG at 6× in scratch to
  eyeball the disc and glyphs, but how Windows scales a 32×32 bitmap into its actual small overlay
  size has not been checked on real hardware.
- **Offline e2e command recorders had to learn to skip this command.** `setBadgeCount` rides the
  same `sendCommand`/`COMMAND_CHANNEL` seam as every daemon-bound command. Four fake-transport specs
  that record every renderer command to prove "nothing daemon-bound goes out while offline"
  (`chat-history-recording.spec.ts`'s `observeCommands` and its host-repair `ipcMain` listener,
  `offline-conversation-actions.spec.ts`'s `observe`) started capturing the badge's `count: 0` on
  reading an unread row and had to be updated to skip only `setBadgeCount` by name — every other
  command, daemon-bound or not, is still recorded, so the "nothing sent while offline" assertions
  are exactly as strict as before this ticket. A new main-local command added later will need the
  same one-line skip in each of those three recorders if it should not trip them.

## Related

- [Channel List § the status dot](channel-list-status-dot.md) — `ConversationStatusDotControl`, the
  exact composition `conversationStatusNow` reproduces so the badge and the dots agree.
- [Push notifications](push-notifications.md) — the sibling main-local command, mounted the same way
  in `PairedShell`, that tells the operator *something* happened where this counts *how many* things
  still need them.
- [Command channel](command-channel.md) — the `setBadgeCount` member and `isBadgeCountPayload` guard
  this feature's command rides on.
- [Dock icon (dev-only)](dock-icon-affordance.md) — a different, unrelated main-side icon control:
  that one sets the Dock's *image* in `npm run dev`; this one sets the Dock's *badge* in every build.
- [Live window](live-window.md) — the holder whose narrow `window` face is why the overlay target is
  `BrowserWindow.getAllWindows()[0]` rather than `live.window`.
