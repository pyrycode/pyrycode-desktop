# 1426 — the new-discussion FAB goes; the workspace row's plus starts every chat

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `NewConversationFab` — the control that goes; `ChannelListView` — its mount and the `onNewConversation` prop; `ChannelList` — the container closure, and the `soleServerId` / `defaultWorkspace` reads that exist only for it.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody`, `renderServerTrees`, `WorkspaceRow` — where the replacement plus comes from. `renderServerTrees` builds each workspace group's `create` control from `groupByWorkspace(serverRows)`, so **a tree draws a plus only for a workspace that has a row in that tree's partition**. This is the fact the ticket's migration note does not carry; see § Design.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `CREATE_CHAT_CONTROL_LABEL` (`'Create chat'`, the Chats tree) and `CREATE_CHANNEL_CONTROL_LABEL` (`'Create channel'`, the Channels tree) — the two trees' pluses are **not** interchangeable: the Chats one sends `create_conversation`, the Channels one opens a naming dialog and mints a promoted row.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace` — groups are derived from the rows handed in, never from the full list, which is why a promoted-only seed leaves the Chats tree with no group.
- `src/renderer/src/screens/channels/channels.css` → the `.channel-list__fab*` rules and the `.channel-list` / `.channel-list__actions` comments that cite them.
- `src/renderer/src/screens/settings/settings.css` → the comment citing the FAB's radius rule as a token-mapping precedent.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `FAB_MARKER` and the two hover-control `disabled` assertions.
- `e2e/fixtures/conversationStateFake.ts` → the default seed (promoted, named) and `DEFAULT_CREATED_CWD`, which a null-cwd create resolves to — the same `/fake/workspace` the seeds use, so a plus press and a FAB press address the same workspace.
- `e2e/fixtures/realDaemon.ts` → `seedPromoted`, default `false`. Nine of the eleven real-tier specs take that default (their seed is a Chats-tree row); `real-claude-effort-default` and `real-daemon-conversation-lifecycle` set it `true`.
- `e2e/sidebar-workspace-plus-name-pill.spec.ts`, `e2e/sidebar-offline-mutations.spec.ts` → the established press shape for the plus: `getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })`.
- `docs/knowledge/features/channel-list.md`, `new-discussion-fab.md` → what the sidebar draws today and the control's history; both are documentation-stage property, listed here as read-only context.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2959

Read against the file on 2026-09-14. The sidebar card is a single dark column: the actions cluster (gear, archive) at the top-left, a `Channels` header with a trailing plus, a host subtree, a full-width divider, a `Chats` header with its own plus, a second host subtree — and then empty card below the last row. **Nothing floats over the list, at either corner.** The redrawn card keeps it that way, so this ticket is a pure deletion against the drawing: no element is added, moved or restyled, and the visual check is the absence of the 56px primary-container square the app draws today at bottom-right.

## Context

The sidebar draws two create affordances for the same act. `NewConversationFab` was invented for the mobile-era flat list (#242), before the tree had a plus: it mints a chat in the Settings default workspace on the sole paired host, and disables itself whenever the host count is not exactly one. #1178/#1185/#1189 gave every workspace row its own `Create chat` plus, which mints in the clicked row's directory on that row's host — a strictly more general control, and the one the drawing has. Juhana ruled on 2026-09-14 that the FAB goes. #1425 (the top-bar restructure) is blocked on this so its tree restructure has no sticky FAB to carry.

The blast radius is almost entirely in the specs: 28 press sites across 27 files use the FAB as a way to mint a conversation, 25 of them as a setup step.

No ADR is warranted — this retires an invented control in favour of a shipped one, and the reasoning lives on the ticket.

## Design

### Production

One deletion, in three files.

**`ChannelList.tsx`.** Delete `NewConversationFab` and its docblock; delete its mount in `ChannelListView` and the `onNewConversation` prop from that component's parameter list and prop type; delete the container's `onNewConversation` closure. `soleServerId` and `defaultWorkspace` each have exactly one reader — that closure — so both go, along with the `useDefaultWorkspaceStore` / `selectDefaultWorkspace` import. `serverIds` stays (four other readers in the tree). `requestNewConversation` stays: the workspace plus calls it. `canMutateHost` stays: `onCreateChat` and its siblings call it.

**`channels.css`.** Delete `.channel-list__fab`, `.channel-list__fab:hover`, `.channel-list__fab:focus-visible`, `.channel-list__fab-icon` and the comment block above them.

**Comment sweep**, to the ticket's stated boundary. In `ChannelList.tsx`: the file header's FAB paragraph; `SettingsButton`'s and `ArchiveButton`'s "clones NewConversationFab's shape"; the `.channel-list__fab pattern` citation on the rename control; and the five comments naming "the `onNewConversation` discipline". That last convention — dereference `window.pyry` only inside a callback, never during render — outlives the prop, so each citation is re-pointed at a surviving example (`onCreateChat`) rather than deleted. In `channels.css`: the header paragraph, the `.channel-list` comments naming the FAB among the sticky children and as the reason for the bottom padding, the `__fab-icon` citations in the `display: block` convention notes, the actions-cluster "the FAB precedent" / "the FAB inverted to the top", and the overlay note about sitting above the sticky FAB. In `settings.css`: the one radius-precedent citation. The `.channel-list` bottom padding value itself is untouched — #1425 moves it. Files that mention the FAB as historical attribution (`PairedShell.tsx`, `conversationCreatedBridge.ts`, `conversationListBridge.ts`, `defaultWorkspaceStore.ts` and their tests) are left alone.

### The spec migration, and the fact the ticket's note is missing

The ticket says the replacement press is "the plus on the seeded default workspace's row". That is true only where the seeded workspace has a row **in the Chats tree**. `renderServerTrees` builds each group's create control from `groupByWorkspace(serverRows)` where `serverRows` is one partition, so:

- A spec whose seed is `is_promoted: false` draws a Chats group at `/fake/workspace` with a `Create chat` plus → a one-line locator swap.
- A spec whose seed is `is_promoted: true` draws **only** a Channels group. Its plus reads `Create channel`, opens a naming dialog and mints a *promoted* row — not a substitute for the FAB by any reading.

Eight of the twenty-six migrating sites are in the second case. Three ways to close it were considered:

1. **The host row's `Add workspace` plus.** Works in every case, including a host with no conversations, but it is a dialog with a remote path field and a two-stage create-then-name round trip. Four-plus lines per site and a new dependency on the fake's folder validation. Rejected as the general answer.
2. **Flip the seed to `is_promoted: false`.** One line, and correct where the seed's tree membership is incidental.
3. **Seed a second, unpromoted row at the same `cwd`.** Gives the workspace a row in *both* trees — which is the state the FAB press used to produce — so the Chats plus exists from launch.

The rule, applied per spec:

| Situation | Migration |
|---|---|
| Chats tree already has the seeded workspace's group | Swap the locator to `getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })`, scoped to the matching group where more than one workspace is seeded. |
| Promoted-only seed, and its tree membership is not asserted | Flip the seed to `is_promoted: false`, then press as above. |
| Promoted-only seed, and the spec asserts the workspace appears in **both** trees or reads the `Channels` section | Seed a second unpromoted row at the same `cwd`, then press its group's plus. Where the FAB press existed only to bring that second row into being and nothing downstream turns on it having been *created*, drop the press and let the seed stand in — adjusting the row counts that shift. |

`{ force: true }` rather than a hover, matching `sidebar-workspace-plus-name-pill.spec.ts`: the plus is `opacity: 0` until its row is hovered or focused, and forcing the click is the shape the suite already uses.

The created row still lands unnamed and `aria-current="true"`, and still at `/fake/workspace` — the plus passes the group's `cwd` verbatim, and that is the same value `DEFAULT_CREATED_CWD` resolved the FAB's null `cwd` to — so the assertions following each press need no change.

### The two specs that are not migrated

`e2e/default-workspace.spec.ts` is deleted whole. Its subject is that the Settings default-workspace choice reaches the FAB's create command; with no FAB there is no such path, and the setting's own store and row keep their unit coverage (`DefaultWorkspaceRow.test.tsx`, `SettingsScreen.test.tsx`).

`e2e/sidebar-offline-mutations.spec.ts` loses both of its FAB sites rather than re-pointing them:

- The `toBeDisabled()` assertion inside `sidebar ownership follows the target in both open-chat directions` proves the *global* create is inert while two hosts are paired. The plus is per-row and has no such state, so the assertion is deleted; the rest of that test is about the per-row controls and is untouched.
- `the sole-host global create targets that host, and failed-host local controls remain usable` opens with the FAB press and its two `createConversation` assertions as its first subject. That half is deleted and the test renamed to the half that survives. The host-targeting claim is not lost: the sibling test `chat creation and scratch promotion address the connected sidebar host while another chat is open offline` presses the plus and asserts the resulting `createConversation` carries the right `serverId` and `cwd`.

## State + concurrency model

Unchanged. Nothing is added to a store and nothing is subscribed. One store read is *removed* from `ChannelList` — `useDefaultWorkspaceStore(selectDefaultWorkspace)` — which narrows the container's re-render surface by one slice; changing the Settings default no longer wakes the sidebar. The create path itself (`requestNewConversation` → `create_conversation` → the daemon's `conversation_created` → `useConversationCreatedNav`) is untouched: the plus already calls it.

## Error handling

No failure mode changes. The FAB's own guard — `canMutateHost(soleServerId)`, plus the `disabled` attribute keyed on "exactly one host, connected" — disappears with it. The equivalent guard on the surviving path is stricter and already shipped: `renderServerTrees` withholds a group's create control entirely unless its `serverId` is defined and that host's status is `connected`, so an offline host draws no plus at all rather than a disabled global one.

## Testing strategy

- **`ChannelList.test.tsx` (vitest, static render).** Drop `FAB_MARKER`, the `onNewConversation={noop}` prop from the `render()` helper, and the two `disabled` assertions in the hover-control tests. The three-state test that asserted the FAB's presence in the not-loaded, empty and populated states inverts to assert its **absence** in all three — the AC's own wording, and the assertion that would redden if the control were ever reinstated.
- **Fake Playwright tier.** Each migrated spec's own assertions are the proof that the plus substitutes cleanly; no new spec is added, because `sidebar-workspace-plus-name-pill.spec.ts` and `sidebar-workspace-create.spec.ts` already own the plus's behaviour. I run the migrated fake specs I touched plus `npm run build`; the full `npm run e2e` is the verifier's gate.
- **Real tier.** Eleven specs change and only that tier proves the migrated press against a real daemon. `needs-real-claude` stays on the issue; the MacBook dispatcher runs `npm run e2e:real:gate`. Pending live acceptance is not a builder error and I do not run it.

## Open questions

- Whether each promoted-seed spec lands in row (2) or row (3) of the migration table is settled per spec while implementing, by reading what that spec actually asserts. Any spec whose classification turns out to cost more than a few lines is recorded in `## Revisions`.
- `question-picks.spec.ts`, `sidebar-row-geometry.spec.ts` and `sidebar-tree-geometry.spec.ts` have per-test seeds rather than one module-level seed; their press sites are classified against the seed of the test that presses, not the file.

## Sizing

Over one line of the one-ticket boundary, deliberately, and not split — the refiner's reading, re-checked here and agreed. Test-locator call sites are 28 against a ceiling of 10. The only clean cut is "migrate every press" then "delete the FAB", and the migration half still carries 27 sites while changing no behaviour, reddening no gate, and being consumed by exactly one sibling: it fails the floor rule, and the floor wins over the ceiling. Every other line is clear: 1 production `.tsx` (plus two stylesheets) against 5, ~600 lines of total written work against 800, no new exported types, 4 acceptance criteria, no state machine.

## Documentation handoff

Pending, owned by the documentation stage. Not touched by this ticket.

- `docs/knowledge/features/new-discussion-fab.md` — a 181-line overview whose entire subject this ticket deletes; its § "The FAB" and § "CSS" document code that no longer exists. Retire in place or remove is that stage's call.
- `docs/knowledge/features/channel-list.md` — "A new-discussion FAB floats bottom-right over the list, present in all three states" is false after this ticket.
- `docs/knowledge/features/conversation-create.md` — names the FAB as a live `create_conversation` caller, in its opening paragraph and in § "Data flow".
- `docs/knowledge/features/default-workspace-store.md` — says the FAB reads the setting and closes over its current value; after this, nothing consumes the setting.
- `docs/knowledge/CATALOG.md` — the entry for `new-discussion-fab.md` follows whatever that file becomes.

This list is the floor, not the ceiling; remaining overviews that mention the FAB in passing are that stage's judgment.
