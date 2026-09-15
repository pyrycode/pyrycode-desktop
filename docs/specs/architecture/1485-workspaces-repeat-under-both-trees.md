# #1485 — workspaces repeat under both trees

## Files read

- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace` — the grouper this
  ticket widens; its key/label split (raw `cwd` key, `workspace_label`-preferring label) is the invariant
  the second parameter must not disturb. Also `groupByServer` — the per-host split that has to run on the
  complement too, and whose docblock states the join-direction security property the union inherits.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderServerTrees` — the one production caller of
  `groupByWorkspace`; its local `workspaceGroups` closure is where the complement lands. `renderBody` —
  the level holding both `channels` and `discussions`, so the only place the complement can be supplied.
  `CollapsibleWorkspaceGroup` — renders `{expanded && children}`, so an empty group needs no new branch.
- `docs/knowledge/features/channel-list-workspace-grouping.md` § "A group leaves both trees the same way
  it arrives" — the prior-ticket lesson this change amends: presence in a tree stops being decided by that
  tree's own rows alone. Also its § Fixture note, which records that the two trees group independently and
  that `conversationStateFake` holds one label per `cwd` — the invariant that keeps a mirrored group's
  label agreeing with its origin group's.
- `docs/knowledge/features/channel-list.md` § Server grouping — why the server level sits above the
  workspace level at all: a bare `cwd` repeats across machines.
- `e2e/fixtures/mintChatRow.ts` → `mintChatInWorkspace` — its "WHY THIS CONTROL AND NOT THE PLUS"
  paragraph states the very gap this ticket closes, so the claim (not the helper) needs correcting.
- `e2e/sidebar-row-geometry.spec.ts` → the `.channel-list__workspace` read after the `Create chat` press —
  a `toHaveCount(1)` that then boxes the same locator as single-match, so it goes strict-mode-red.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `WORKSPACE_ROW_MARKER`,
  `WORKSPACE_HEAD_MARKER`, `workspaceLabelsIn` — the three readers whose expected numbers move.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2959
(workspace row itself: node 399:1059)

The sidebar draws two identically-structured trees, Channels then Chats, each a section header with a
plus, then one host row per paired machine (folder-stack icon, label, chevron, connection dots, pen and
plus), then one workspace row per workspace (folder icon, label, chevron) at a deeper left inset, then
that workspace's conversation rows. The frame repeats the *same* host and workspace levels under both
headers — which is the whole of this ticket. No new drawing: a group with no rows in the tree being drawn
is the existing workspace row (`399:1059`) with nothing rendered beneath it.

## Context

Both trees already draw every paired host — `groupByServer` emits a bucket per entry of `serverIds`
whether or not it holds rows. Workspaces do not repeat: `renderServerTrees` derives each host's workspace
rows from *that tree's own rows alone*, so a workspace appears under Channels only when a promoted row
lives in it and under Chats only when an unpromoted one does. The Add-workspace dialog (#1189) starts a
chat, so a new workspace lands in Chats and Channels never learns of it; a channel-only workspace is
missing from Chats and so offers no Create-chat plus and no pen.

The fix makes the set of workspace groups per host the union of both trees' rows for that host. A group
with no rows in the tree being drawn still renders its head row, with its plus and its pen, and expands to
nothing.

This change makes two claims in `docs/knowledge/features/channel-list-workspace-grouping.md` stale — that
"a group leaves both trees the same way it arrives: by having no row left", and that a workspace is drawn
"only while a live conversation sits in it". Both remain true of the *union*, and both are now false of a
single tree. The documentation phase owns that page; see **Documentation handoff** below. No ADR is
warranted — this is a widening of an existing derivation, not a new decision.

## Design

`groupByWorkspace` gains a second, optional parameter; nothing else in the view model changes.

```ts
groupByWorkspace(
  rows: readonly ConversationSummary[],
  alsoFrom?: readonly ConversationSummary[]
): readonly WorkspaceGroup[]
```

`alsoFrom` rows contribute their **key and label** and never their rows. The existing accumulation loop is
untouched; a second loop runs after it and, per `alsoFrom` row:

- skips the row when `workspaceLabelFor(row.cwd)` is `null` — the fallback bucket is never propagated
  (AC4). This also makes `UNKNOWN_WORKSPACE_KEY` unreachable from the secondary list *by construction*
  rather than by a guard on the key: a non-null segment implies the `cwd` has a usable segment, so it can
  never be the empty string the bucket is keyed by;
- skips the row when its key is already a group — the primary list owns the label and the order of every
  key it put there;
- otherwise creates a group with `rows: []` and the same label rule as the primary loop
  (`row.workspace_label ?? segment`), so a mirrored group reads the name the daemon holds for that `cwd`
  exactly as its origin group does (#1287).

Order falls out of the `Map` for free: primary keys in primary first-appearance order, then
secondary-only keys in secondary first-appearance order. The two trees may therefore order one host's
workspaces differently, each leading with the keys its own rows put there — accepted for this slice per
the ticket; a canonical shared order is a separate ticket.

The key stays the raw `cwd` and the label/key split stays load-bearing for its existing reason: the key
makes a round trip back out as a create's `cwd`. A mirrored group's key is the *other* tree's row's `cwd`,
which is the same class of daemon-asserted text arriving by the same path.

`renderServerTrees` gains `otherRows: readonly SidebarRow[]` as its **second** positional parameter — data,
beside `rows`, ahead of the callbacks, matching how `serverIds` is placed. It calls `groupByServer` a
second time, on `otherRows` with the *same client-held* `serverIds`, and indexes the result into a
`Map<string, readonly SidebarRow[]>` so each host's complement is looked up by id rather than by index
parity between two arrays. The local `workspaceGroups` closure takes that complement as a third argument
and passes it to `groupByWorkspace`.

**The union is taken per host, never across hosts.** That is the point of splitting by server first and it
is the reason the complement cannot simply be `otherRows`: the group key is a bare path that repeats
across machines, so a cross-host union would draw `/home/user/project` under Macbook because Pyrybox has
it. `groupByServer` runs on the complement to prevent exactly that.

**The unattributed run is left alone.** `renderServerTrees` ends with `workspaceGroups(unattributed)`,
drawn under no host row, and that call keeps grouping its own rows by themselves — the complement's own
unattributed rows are discarded. Those rows name no machine, so a union there would merge two unknown
machines' paths, the cross-host merge the per-host union exists to prevent. #1068 stamps every daemon
event main-side, so the bucket is unreachable in production anyway.

`renderBody` passes the complement at its two call sites: `discussions` to the Channels tree, `channels`
to the Chats tree. It already holds both partitions, so nothing is threaded further up.

`CollapsibleWorkspaceGroup` is unchanged: its `children` is the mapped row array, `{expanded && children}`
renders an empty array as nothing, and toggling an empty group flips one boolean and draws nothing.

## State + concurrency model

No store slice, no async work, no subscription, no IPC arm, no wire change. This is a pure derivation
inside one render pass over data the sidebar already holds, so there is nothing to cancel or tear down.

Per-tree and per-server disclosure independence is untouched and needs nothing added: the two trees are
two sibling lists and each server's groups sit inside that server's own keyed `<Fragment>`, so a mirrored
group is a *distinct* `CollapsibleWorkspaceGroup` instance with its own `expanded` cell. Folding the
mirror in Chats leaves the origin group in Channels expanded, which is the existing property, not a new
one.

Re-render cost is unchanged in shape: both partitions already come from the one `partitionActive` call in
`renderBody`, so no new subscription and no new selector.

## Error handling

No new failure mode and no new result type — neither function performs I/O, and both are total over their
inputs. The three degenerate inputs the widening admits are answered by the design rather than by a guard:
an empty `alsoFrom` (the default) reproduces today's output exactly; an `alsoFrom` row with an unusable
`cwd` contributes nothing; an `alsoFrom` row whose key is already present contributes nothing. No
`console.*` on this path — a useful log would have to carry the `cwd`, which ADR 0007's content-free rule
and `CLAUDE.md` both forbid.

## Testing strategy

**`channelListViewModel.test.ts` (vitest, node) — the union rule:**

- A key present only in `alsoFrom` yields a group with that key, that label, and `rows: []`.
- A key present in both yields ONE group, whose rows are the primary's alone and whose label comes from
  the primary's first row — the secondary never overwrites a label.
- Order: primary keys in primary order, then secondary-only keys in secondary first-appearance order.
- A secondary-only group's label prefers `workspace_label` and falls back to the `cwd` segment.
- A secondary row with an unusable `cwd` contributes NO group — asserted on the absence of
  `UNKNOWN_WORKSPACE_KEY` (AC4), and separately that a primary-sourced unknown bucket still survives.
- Omitting the second argument is identical to today (the back-compat every existing caller relies on).

**`ChannelList.test.tsx` (vitest, `renderToStaticMarkup`) — the two-tree render:**

- One promoted row seeded: both trees draw the group; the Chats mirror head row carries the Create-chat
  plus and the pen; no `.channel-list__row` renders under the mirror (AC2, AC3).
- One unpromoted row seeded: the mirror appears in Channels with the Create-channel plus and the pen (the
  AC1 render half).
- Per-host: a row on host A alone leaves host B drawing no group in either tree.
- The unknown bucket does not cross (AC4).
- Plus the count sweep: `WORKSPACE_ROW_MARKER` / `WORKSPACE_HEAD_MARKER` / `workspaceLabelsIn`
  expectations across the file move by one group per host for every seed whose rows land in a single tree.
  The seeds do not change, only the expected numbers — this is the fix landing, not a regression.

**Playwright, fake transport (`e2e/`)** — AC1's dialog round trip is already driven by
`e2e/sidebar-add-workspace.spec.ts`, where `conversationStateFake` round-trips the create back into the
list; its existing label assertions move from one match to two. `e2e/sidebar-row-geometry.spec.ts`'s
`toHaveCount(1)` becomes two and its box read is scoped to the Chats tree's group rather than left as a
single-match locator. The sweep is wider than the two files the ticket named: every sidebar spec seeding
rows into one tree now draws a mirror group, so `sidebar-workspace-create`, `sidebar-workspace-edit`,
`sidebar-tree-geometry`, `sidebar-offline-mutations`, `host-conversation-list`, `rename-workspace-command`
and `sidebar-create-channel` carry count expectations to re-base. The full fake tier is the dispatcher's
gate; anything that tier reds that this sweep missed comes back triaged.

**`e2e/fixtures/mintChatRow.ts`** — its "WHY THIS CONTROL AND NOT THE PLUS" paragraph asserts the gap this
ticket closes. The helper and every caller stay as they are; only the claim is corrected.

## Open questions

- Whether `otherRows` should be required (both call sites supply it) or optional with an `[]` default.
  Resolved in the design above in favour of REQUIRED and positioned second: an optional complement would
  be a fourth way to render a sidebar, and there are only two call sites to update. Recorded here because
  the alternative is what the ticket's wording ("gains the other tree's rows as an argument") leaves open.
- Whether the e2e sweep beyond the two named files fits this ticket's budget. It is expectation churn on
  one derivation, not a second deliverable, so it stays here; if wall clock forces it, the unrun specs are
  named in the PR and the dispatcher's gate triages them.

## Documentation handoff

Pending for the documentation stage — the builder does not edit these paths:

- `docs/knowledge/features/channel-list-workspace-grouping.md` § "A group leaves both trees the same way
  it arrives: by having no row left" and the paragraph above it ("a workspace is drawn only while a live
  conversation sits in it, so a folder gets a row here for the first time the moment its first chat is
  created"). Both are now true only of the union across the two trees, not of a single tree: a group is
  drawn in a tree when *either* tree has a row for that `cwd` on that host, and it leaves both trees only
  when *both* have none.
- The same page's § Fixture note and the `mintChatRow` reference in it, now that the "an empty tree draws
  no group and therefore no plus" reason has stopped holding.

The ticket body carries no Documentation handoff section of its own and no documentation-only acceptance
criterion.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding, and the reason is a value-set argument rather than "it looks the
  same". A mirrored group's key is a `cwd` supplied by the *other* partition's row, and it leaves the
  renderer only through the existing `createConversation` / `renameWorkspace` IPC arms. Both partitions
  come from one `partitionActive` call over one `conversationListStore`, populated by the one
  `list_conversations` read path, so no row crosses a boundary it did not already cross. The set of `cwd`
  values the sidebar can send for a host is unchanged: it was already "any `cwd` the daemon put on any
  active row of that host", because the Chats tree could already send an unpromoted row's `cwd` and the
  Channels tree a promoted one's. What moves is which tree's control sends which — not what can be sent.
  Nothing in `daemonConnection`'s `createConversation` keys off `is_promoted` for validation: it rebuilds a
  fresh `{ is_promoted, name, cwd }` literal (#236's fresh-literal posture) and routes by
  `command.serverId`.
- **[Trust boundaries / MUST NOT REGRESS — SHOULD FIX, pin with a test]** The one place this change could
  create a genuine cross-host disclosure is the complement's granularity. `index.ts` routes a create as
  `servers.route(command.serverId)?.createConversation(command.payload)`, so the `cwd` goes to the host
  named by `serverId`. If the complement were passed to `groupByWorkspace` as a flat `otherRows` list
  instead of being split by `groupByServer` first, host A's path would be drawn under host B's row and
  B's plus would send A's directory path to B — an operator creating in a directory they never chose, on
  a machine that was never told that path. The design takes the union per host precisely to prevent this,
  and `groupByServer`'s own docblock names the same hazard for the primary list. Because the defence is
  structural and invisible at the call site, Phase B adds a unit test that pins it: two hosts, a row on
  host A alone, host B draws no group in either tree.
- **[Trust boundaries / join direction]** No finding. The second `groupByServer` call uses the SAME
  client-held `serverIds` as the first, so a row's stamp is still only ever TESTED against the client's
  own paired list and can never mint a key. The read-side property that docblock states as load-bearing
  is inherited by the complement unchanged.
- **[Tokens, secrets, credentials]** Not applicable by design: no token, key, credential or pairing
  material exists on this path. The derivation reads `cwd`, `workspace_label`, `is_promoted`,
  `is_archived` and `serverId` and nothing else.
- **[File / storage operations]** No finding, and the decision that makes the category inapplicable is
  explicit and pre-existing: `cwd` is an opaque remote display string, never a local path. The renderer
  performs no `path`, `fs`, `node:*` or `URL` work on it (`workspaceLabelFor` is deliberately string
  splitting and nothing else), so there is no traversal, TOCTOU or boundary-check surface to widen. A
  mirrored group's key is handled byte-identically to an origin group's — echoed verbatim, resolved never.
  No disk write, no `localStorage`, no cache key: collapse state stays one `useState` boolean that dies
  with the renderer.
- **[Inter-process / Electron attack surface]** No finding. No IPC channel, `contextBridge` API,
  `webPreferences`, protocol handler or navigation guard is added or changed; the two reachable commands
  are the ones these controls already sent. **SHOULD FIX, pin with a test:** the mirror group's plus and
  pen must inherit the *drawn host's* gate — `serverId !== undefined && statuses.get(serverId)?.type ===
  'connected'` — and not the origin host's. The design gets this for free because the gate is evaluated in
  `workspaceGroups` against the host being rendered, but "for free" is exactly what regresses silently, so
  Phase B asserts a disconnected host's mirror group draws neither control.
- **[Cryptographic primitives]** Not applicable: no randomness, no hashing, no key schedule, no
  comparison of an attacker-controlled value against a secret. The grouping key is compared with `Map`
  lookup equality, which guards no secret — `timingSafeEqual` would be meaningless here.
- **[Network & I/O]** No finding. The change issues no request, opens no socket and adds no frame, so
  `maxPayload`, TLS, timeout and reconnect discipline are untouched. **Considered and accepted:** a
  hostile daemon listing N rows with N distinct `cwd`s now yields up to 2N workspace head rows instead of
  N. That is a constant factor on a list the client already renders in full, with no per-group work beyond
  one row, so it is not an amplification vector. A cap on list size is a pre-existing posture question and
  explicitly **out of scope** here — it belongs with the `list_conversations` read path, not with a
  derivation over rows already held.
- **[Error messages, logs, telemetry]** No finding — and stated as a decision, not an absence: no
  `console.*` is added on this path, because every useful log here would have to carry the `cwd` or the
  label, which ADR 0007's content-free rule and `CLAUDE.md`'s 2026-08-20 ruling both forbid. The label
  reaches the DOM only as an auto-escaped React child (`WorkspaceRow`), never an attribute, URL, filename
  or cache key — unchanged, and a mirrored group's label travels the same way.
- **[Concurrency]** No finding. The whole change is synchronous derivation inside one render pass: no
  `await`, so no check-then-act gap; no timer, listener, socket or long-lived task, so nothing to abort or
  tear down. Both accumulators are function-local and freshly allocated per call. The secondary loop
  writes into the SAME `Map` the primary loop uses — never a plain object — so the `__proto__`-key hazard
  `groupByServer`'s docblock records stays closed for a key that is arbitrary daemon text. `otherByServer`
  is a `Map` for the same reason even though its key is client-held.
- **[Threat model alignment]** Hostile/compromised daemon: it gains one extra head row per workspace,
  bearing a label it already controlled, whose plus would send a `cwd` it already supplied back to itself
  — no new value and no new destination. Renderer compromise reaching the transport: unchanged, no key,
  socket or token is on this path, and process isolation is untouched. Malicious relay: content-blind and
  irrelevant to a render-time derivation. Token theft from disk: nothing is written. **Out of scope and
  named:** the two trees may order one host's workspaces differently, each leading with its own rows'
  keys; that is a usability question the ticket explicitly defers to a separate canonical-order ticket,
  not a security one — group identity is the key, and the key is unaffected by position.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15

## Revisions

### 2026-09-15 — the count sweep completed (rework 1)

Driven by the verifier's triage finding on PR #1498: the fake-transport tier went red on three specs the
sweep had missed (`sidebar-workspace-plus-name-pill`, `workspace-label`, `workspace-updated-relist`), all
confirmed as this PR's doing against baseline `6e66bad`. **No production code changed in this leg** — the
derivation and the render are as committed; only expectation churn and stale prose moved. What the design
gained is one decision and one correction it did not previously state:

**The two trees are told apart positionally, and that is now written down.** There is no per-tree ancestor
element: `renderBody` draws both trees as sibling runs inside one `.channel-list__tree`, separated by a
`.channel-list__divider`, so a spec that needs one tree's group reads `.nth(0)` for Channels and `.nth(1)`
for Chats. `sidebar-row-geometry` already relied on this in the first leg; `workspace-label` now does too.
Naming it here because it is the shape of every future re-base of this kind, and because it is the reason
a *scoped* read is available at all when an exhaustive one stops discriminating.

**`workspace-label.spec.ts` needed a judgment call, not a number** (the verifier's point 3). Its step 1
pinned `[WORKSPACE_LABEL]` before the mint and step 3 `[WORKSPACE_LABEL, WORKSPACE_LABEL]` after it; under
the union step 1 also reads two, so re-basing it would have made the two steps character-identical and the
spec would have stopped distinguishing "the minted row's group arrived" from "the mirror was always there".
Resolved by scoping step 1 per tree (the Channels group, then the Chats mirror named explicitly) and
keeping step 3 exhaustive, with the discriminating claim moved onto step 2's auto-waiting row count — which
is the only read that *can* carry it, the two states rendering identical text. The trap the spec was
written for is untouched: after the mint the Chats tree owns a row at that key, so the primary list owns
the label and a fake minting `null` still reddens step 3.

**One consequence the verifier did not name, found by sweeping the real tier for control ambiguity rather
than for label counts.** `real-daemon-workspace-rename.spec.ts` does `editWorkspace.click()` on a
`getByRole('button', { name: 'Edit workspace' })`. The union draws a pen per tree, so that click would
have gone strict-mode-red — a failure the label arithmetic alone would not have predicted. Scoped to
`.first()` (the Channels tree's pen) with the equivalence stated: both pens close over the same
`group.key` and the same `serverId`, so either opens the dialog on the same `cwd`, and the `nameField`
read below is what proves which workspace it opened on.

**The rest of the real tier is safe, and this was checked rather than assumed.** Every `real-claude-*`
spec that clicks a `Create chat` plus seeds one UNPROMOTED row with `seedCwdSubdir` unset (both are the
`realDaemon` fixture's defaults), so each host has exactly one workspace key: the Chats tree draws the
real group and the Channels tree the mirror, whose plus reads `Create channel`. `Create chat` stays
unique. Ambiguity would need two keys on one host, which no spec in that tier seeds.

Also corrected, in the same family as the first leg's `mintChatRow.ts` fix: `real-daemon-create-channel`'s
pre-read gave the *reason* for its unique plus as "a promoted-only list gives the Chats tree no group and
therefore no 'Create chat' plus of its own" — the claim this ticket retires. The plus is unique because
each tree names its own control, not because the other tree is empty.

The real tier's three specs are re-based but **unrun** — that tier is the dispatcher's, and this agent
holds no Claude credential. Their arithmetic is derived from the seed shape each one declares.
