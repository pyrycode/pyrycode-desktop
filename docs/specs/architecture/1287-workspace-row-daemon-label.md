# #1287 — the workspace row shows the daemon's workspace label

The read half of the daemon-side workspace label (pyrycode/pyrycode#2208). Three inbound payloads gain
a required, nullable `workspace_label`; the sidebar's workspace row prefers it over the folder name it
derives today. Split from #1182. The write half (#1288, #1289) and the pen that sends one (#1180) are
separate tickets and nothing here waits on them: a label set from any client arrives on the next list
reply, so the read is live the moment this lands.

## Files read

- `src/shared/wire/types.ts` → `ConversationSummary`, `ConversationCreatedPayload`,
  `ConversationUpdatedPayload` — the three interfaces that gain the field, and their docblocks, which
  each state the "all always present, no `omitempty`" contract this addition has to join.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`,
  `parseConversationCreatedPayload`, `parseConversationUpdatedPayload` — the three fail-closed
  narrowers; and `requireStringOrNull`, the existing required-nullable-string primitive whose semantics
  (`typeof !== 'string' && !== null` throws, so a missing key and an `undefined` both fail) are exactly
  what AC1 asks for.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`,
  `workspaceLabelFor`, `UNKNOWN_WORKSPACE_LABEL`, `UNKNOWN_WORKSPACE_KEY` — the grouper whose label
  source changes and the key derivation that must not. `workspaceLabelFor`'s docblock states the rule
  this ticket leans on twice: it returns `string | null` rather than folding the fallback in, precisely
  so the caller can tell "no usable label" from "a label that reads like the fallback".
- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow`, `renderBody` — the render call
  and, above it, the comment block that today calls the label "the last segment of an untrusted `cwd`,
  derived by `workspaceLabelFor`" and enumerates four declined sinks. The claim about the *source*
  stops being true here; every one of the four declines stays true and stays necessary.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `WORKSPACE_ROW_MARKER`,
  `WORKSPACE_LABEL_OPEN`, `workspaceRowTagsIn` — exact attribute strings and a tag-scoped
  no-`aria-label`/no-`title` assertion. The markup must not drift under this change.
- `src/renderer/src/screens/channels/channelListViewModel.test.ts` → its `row(over)` factory — the
  one-line-per-file shape most of the fixture cascade takes.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake`, `DEFAULT_SEED`,
  `DEFAULT_CREATED_CWD`, the `create_conversation` / `promote_conversation` / `change_workspace` arms —
  the fake that has to hold one label per `cwd` the way the daemon does (see § The both-trees trap).
- `e2e/fixtures/launchPairedApp.ts` → its two default `ConversationSummary` seeds, ridden by 28 specs.
- `e2e/workspace-collapse.spec.ts` → the two-trees-one-workspace idiom the new spec borrows, including
  why the second tree has to be minted by the FAB rather than seeded.
- `docs/knowledge/features/channel-list.md` § "Workspace grouping" — the `Map`-not-object rule and the
  "`''` is collision-proof by construction" argument, both of which survive unchanged.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1059

The Workspace component in the Hosts frame (node `106-3160`), Idle and Hover: a 28px row, 8px left
inset, a 12×10 folder glyph, then a title-small label (14px / weight 500 / `--schemes/on-surface`) on
one line; Hover reveals a pen and a chevron at the right edge. **No drawing changes in this ticket** —
the row already renders exactly this. What changes is only where the text comes from. Worth noting that
the node's own exemplar text is "Second Brain", a *name* rather than a path segment, which is the
change this ticket makes. The pen is #1180's and is not added here.

## Context

`groupByWorkspace` labels every workspace row with `workspaceLabelFor(row.cwd)` — the last usable
segment of the group's directory — and nothing else. Juhana's reason for changing that, 2026-09-06:
folder names are not always the best. His second ruling the same day: the name travels with the
workspace, so it lives on the daemon, not in this client's local storage.

The daemon half has shipped and the operator's binary carries it (`strings ~/.local/bin/pyry` finds
`workspace_label` with no `,omitempty`, confirming the required-present contract this plan encodes).
Every `ConversationSummary` row of a `list_conversations` reply, and the `conversation_updated` and
`conversation_created` payloads, now carry `workspace_label: string | null`. The label is stored against
the exact `cwd` string, so every row of one group agrees and taking the first row's is well-defined.

No ADR is warranted: this adds no decision the existing records do not already cover. The untrusted-
daemon-text posture is ADR 0007 plus CLAUDE.md's 2026-08-20 ruling, and the no-drift rule for
`src/shared/wire/` is decision 0002. Both are applied here, neither is amended.

### The size overage, stated rather than hidden

The one-ticket boundary's "≤10 consumer call sites needing simultaneous update" line is exceeded: at
`88a4a37` there are 34 full `ConversationSummary`-shaped literals under `src/` and 25 under `e2e/`
(`git grep -c 'last_message_ts:'`), and a required wire field cannot land without all of them. Every
other line of the boundary holds — 3 production files, ~520 lines of total written work, 0 new exported
types, 5 acceptance criteria, 3 new reject branches.

**The floor rule decides it, and it says build.** The only split available is (A) the wire field, its
parse and the whole literal cascade, then (B) the label preference plus its e2e spec. A's sole
deliverable — the field surviving decode — is consumed by exactly one sibling, B, and nothing outside
this family; #1288 / #1289 / #1180 are the *write* half and consume none of it. So A is part of B, not
a ticket of its own, and the split would carry all ~59 sites into A regardless — buying nothing on the
line that actually binds. When the floor and the ceiling disagree the floor wins: merge back, state the
overage, build. The refiner reached the same conclusion on the estimate line; this is the independent
re-derivation, not a deferral to it. Split depth is 1 (parent #1182, no grandparent), so no
`needs-human:sizing` marker applies.

## Design

### 1. The wire types (`types.ts`)

`workspace_label: string | null` is appended to `ConversationSummary`, `ConversationCreatedPayload` and
`ConversationUpdatedPayload`. Last in each interface, matching the daemon's own append. Its posture is
`cwd`'s, and the docblocks say so: untrusted daemon-supplied text carried as opaque display text, never
resolved into a filesystem path. It differs from `cwd` in exactly one way worth writing down — `cwd` is
a *path* and this is a *name*, so it has no segment structure and nothing may parse it.

`null` is a value, never an absence: "this workspace has no label, use the folder name". The daemon
writes the key unconditionally, so a *missing* key is a contract violation and fails closed — the
`ConversationSummary.name` contract exactly, and the reason the field is not optional.

`RecentWorkspace` is deliberately untouched. `recent_workspaces_list` rows carry no label and need
none: the sidebar's workspace rows are grouped from conversation rows' `cwd` via `groupByWorkspace`, and
`recentWorkspacesStore` feeds the Workspace Picker Sheet and the Settings default-workspace row, which
show a path on purpose.

### 2. The parse half (`inboundMessage.ts`)

Each of the three narrowers gains one `requireStringOrNull(payload, 'workspace_label')` call and copies
the result through. No new primitive: `requireStringOrNull` already fails closed on a missing key, on
`undefined`, and on any non-string non-`null`, and its message is `missing required field:
workspace_label` — the field *name*, never its value, which is the category-only posture the file's
three docblocks already promise for `name` and `cwd`.

Field position within each returned object literal follows the interface's order, i.e. last. The
returned objects stay the same "only the known fields" shape, so a server-added key still rides along
unread and uncopied.

### 3. The label preference (`channelListViewModel.ts`)

`groupByWorkspace` keeps its signature and its `Map`. One expression changes — the label a group is
created with:

- the group's `key` is still `workspaceLabelFor(row.cwd) === null ? UNKNOWN_WORKSPACE_KEY : row.cwd`,
  computed from the `cwd` alone (AC3). No label ever reaches a key.
- a real group's label is the **first row's** `workspace_label` when non-null, otherwise the folder
  segment. Because the `Map` sets a group's label only when it is created, "the first row's" falls out
  of the existing structure with no extra bookkeeping — later rows of the same group are appended and
  their labels are not consulted. That is correct rather than merely convenient: the daemon holds one
  label per `cwd`, so within a group the values agree, and reading the first is the cheapest way to say
  so.
- the unknown-workspace group is labelled `UNKNOWN_WORKSPACE_LABEL` **whatever its rows carry** (AC2).
  This one is not an oversight to be tidied away later: that group is a bucket, not a workspace. Every
  row with an unusable `cwd` collapses into it regardless of origin, so labelling it with one member's
  name would assert something false about the others.

**A non-null label is used verbatim, including a blank one.** No trim, no blank-to-fallback guard, in
deliberate contrast to `titleFor`. `workspaceLabelFor`'s docblock already states the rule — the client
normalises nothing — and here it has teeth: a label is state a user set from some client, and rewriting
a blank one locally would make this desktop disagree with mobile about what the workspace is called,
silently and only on this machine. Rejecting a blank label belongs to the verbs that *set* one (#1288 /
#1289) and to the dialog that sends it (#1180), where it can be refused to the user's face. Recorded in
Open Questions so the choice is visible rather than inferred.

`WorkspaceGroup` is unchanged — `label` is already the carrier and `ChannelList` already renders it, so
no new prop and no signature change reach `ChannelListView`. `partitionByPromotion`, `partitionActive`
and `groupByServer` are untouched.

### 4. `ChannelList.tsx` — comment only

No code changes. The comment above `WorkspaceRow` currently asserts the label is "the last segment of
an untrusted `cwd`, derived by `workspaceLabelFor`"; that becomes false and is corrected to name both
sources. The four declined sinks it enumerates (no `aria-label`, no `aria-controls`/`id`, no `title`,
no log line) all stay, and the correction says explicitly that they now cover a second daemon string.
The paragraph explaining that every fake fixture seeds `cwd: '/fake/workspace'` so the default tier
renders the literal "workspace" also gains a clause: with the label null in every default seed, that
stays true, which is what keeps 28 specs' locators unchanged.

### 5. `shared/ipc/events.ts` — comment only

Found by the security pass below, not by the ticket body. Three arms of the daemon-event union
enumerate, in prose, exactly which fields cross the IPC boundary, and two of them additionally name
which of those fields are untrusted: `conversationsReceived` ("carries only ids, a nullable title, two
flags, a workspace path (opaque display text), and two timestamps"), `conversationCreated` ("an id, a
flag, a nullable title, a workspace path, and a timestamp"), and `conversationUpdated` (the same
enumeration plus "`name` and `cwd` are UNTRUSTED daemon-supplied strings … render them as plain text,
NEVER HTML"). All three reuse the wire type by reference, so all three carry `workspace_label` the
moment § Design 1 lands, and all three enumerations become false.

The correction adds the field to each enumeration and adds `workspace_label` to the
`conversationUpdated` arm's untrusted-strings warning. This is the whole change to the file — no type
edit is needed, since the arms reference `ConversationSummary` / the two payload types directly. It
matters because those comments are how a later consumer decides what it is holding: a new untrusted
string absent from an enumeration that reads as exhaustive is exactly how a "never used as X" contract
gets inherited as false.

### 6. The fixture cascade

Every full literal of the three payload shapes gains one line. `tsc` names each site, so the work is
mechanical; the count, not the difficulty, is why this ticket is large. The default value everywhere is
`null` — the "no label, use the folder name" value — which keeps every existing rendered label and every
existing assertion byte-identical. Only the new specs seed a non-null one.

`e2e/fixtures/conversationStateFake.ts` needs more than a default. See below.

### The both-trees trap

The `workspace-collapse.spec.ts` idiom gets its second tree by minting a row with the FAB, and
`conversationStateFake`'s `create_conversation` arm builds that row itself with `cwd:
payload.cwd ?? DEFAULT_CREATED_CWD` — the same `/fake/workspace` the seed uses. The two trees group
separately, so the Chats group takes the *minted* row's label. A fake that mints `null` there would
render the folder name in one tree and the label in the other, reddening AC4 against correct production
code.

The fix models the daemon rather than patching the symptom: **the fake holds one label per `cwd`.** A
module-local `Map<string, string | null>` is built from the seeded rows at factory time, and a small
`labelFor(cwd)` resolves a row's label from it (absent ⇒ `null`). The `create_conversation` arm mints
through `labelFor`, and the two arms that *move* a row — `promote_conversation` and `change_workspace`,
both of which assign `row.cwd` — re-resolve the label through it too, so a moved row takes its new
workspace's name instead of carrying the old one. A `Map` and not a `Record`, for the reason
`groupByServer`'s docblock gives: a `__proto__` key on a plain object resolves `Object.prototype`.
Fixture-authored keys make that unreachable today; the `Map` is the free second fabric.

## State + concurrency model

Nothing is added. No new store, no new store slice, no `localStorage` key, no async task, no
subscription and no teardown path (AC5). The label rides the existing `list_conversations` →
`conversationListStore` → `ChannelList` read path and the existing `conversation_created` /
`conversation_updated` bridges, all of which copy whole payload objects and so need no change to carry
one more field. A label set from another client appears on the next list reply through machinery that
already exists.

Re-render behaviour is unchanged: `groupByWorkspace` is called during `renderBody` on rows the
component already selects, and returns a fresh array as it does today.

## Error handling

- **Decode.** A missing, `undefined` or wrongly-typed `workspace_label` throws `WireDecodeError` from
  `requireStringOrNull`, failing the whole payload closed — one bad row fails the entire
  `conversations` reply, as one bad `cwd` does today. The message names the field, never the value.
  This is the fail-closed direction on purpose: a silently-defaulted absent field would let a stale or
  impersonating daemon suppress a label the user set.
- **Render.** No error path exists. `groupByWorkspace` is total over its input: every row lands in
  exactly one group, and every group gets a non-null `string` label, since both branches of the label
  expression end in a `string`.
- **Display.** A hostile label reaches exactly one sink — an auto-escaped React text child — so the
  worst it can do is be long or misleading, both already handled (the label ellipsizes; the group's
  identity remains its `cwd`).

## Testing strategy

**vitest** — `inboundMessage.test.ts`, per parser (`parseConversationSummary` via a `conversations`
reply, plus the `conversation_created` and `conversation_updated` frames):

- a string `workspace_label` is copied through unchanged;
- a literal `null` decodes as `null`, not as an absence;
- a payload with the key **missing** throws;
- a payload with the key `undefined` throws;
- a payload with a non-string non-null value (a number) throws;
- the thrown message contains neither the offending value nor a `cwd`.

**vitest** — `channelListViewModel.test.ts`, on `groupByWorkspace`:

- a group whose first row carries a label is labelled with it, while its `key` stays the raw `cwd`;
- a later row's differing label does not change the group's label (first-row rule, pinned so a future
  last-wins refactor reddens);
- `null` on the first row falls back to the folder segment, exactly as today;
- a row whose `cwd` has no usable segment lands in the unknown group labelled `UNKNOWN_WORKSPACE_LABEL`
  even when it carries a non-null label (AC2's "whatever its rows carry");
- a blank (whitespace-only) label is used verbatim — pinning the deliberate non-normalisation above, so
  that a later "helpful" trim has to argue with a test;
- grouping membership is unchanged when labels differ but `cwd`s match (AC3).

**vitest** — `ChannelList.test.tsx`: a labelled group renders its label between `WORKSPACE_LABEL_OPEN`
and its close, and `workspaceRowTagsIn` still finds no `aria-label` and no `title` on the row tag when
the label is a hostile string. One test seeds a label containing `<script>` and asserts the rendered
markup carries the escaped form and no raw `<script`, proving the auto-escaped-child claim rather than
asserting it in prose.

**Playwright, fake tier** — a new `e2e/workspace-label.spec.ts`, borrowing `workspace-collapse.spec.ts`'s
idiom: seed one promoted row with `cwd: '/fake/workspace'` and a non-null label; mint the second with
the FAB so the Chats tree exists; then assert `.channel-list__workspace-label` reads the seeded label in
**both** trees (`.nth(0)` and `.nth(1)`), and that it is not the folder segment `workspace`. The
negative half matters: without it the spec would pass against a build that ignored the field, since the
label would still be *a* string.

The seed label is a fixed non-secret display literal chosen to share no substring with any existing
locator's text (the `launchPairedApp` strict-locator constraint), and to differ from `workspace` so the
negative assertion has teeth.

**Not run here.** AC4's second half asks for `npm run e2e:real:gate`. The real-claude tier is not the
builder's to run: this fork has no automatic gate configured, so the `needs-real-claude` label parks the
ticket in Inbox after verification for the operator to run it by hand. The premise it checks — that the
shipped daemon really sends the key on every list reply — was verified statically here: the installed
binary contains `workspace_label` with no `,omitempty`. That is evidence, not the gate; the gate is the
operator's. Flagged in the PR body.

Full-suite `npm test` and the whole Playwright tier are the verifier's gate, not run here (§ B2).

## Open questions

1. **Blank labels.** Resolved in § Design 3: a non-null label is used verbatim, blank included, because
   the client normalises nothing and a locally-rewritten label would disagree with every other client.
   Rejection belongs to #1288 / #1289 / #1180.
2. **Field position in the interfaces.** Appended last, matching the daemon's own append. Nothing reads
   these types positionally, so this is a readability call, not a contract one.
3. **Whether `conversationStateFake` should take an explicit label option.** Resolved: no. Deriving the
   per-`cwd` map from the seeded rows is strictly smaller and models the daemon's actual invariant; an
   option would let a spec seed a state the daemon cannot produce.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the label's sibling makes a round trip back OUT to the wire, so
  "the key comes from `cwd` alone" is a security invariant, not an AC-compliance detail.** The
  `CollapsibleWorkspaceGroup` call site in `renderBody` passes `create.onCreate(group.key)`, and the
  comment there says what that means: the group's key "is daemon-asserted text making its first trip
  back OUT as a command field". So `groupByWorkspace` has one output that is display-only
  (`WorkspaceGroup.label`) and one that becomes an outbound `create_conversation` `cwd`
  (`WorkspaceGroup.key`). This ticket adds a *second* daemon string to that function and points it at
  the first output. A plausible future simplification — "the label is the nicer identity, key on it" —
  would send a daemon-asserted workspace *name* to the daemon as a *directory path*. Main re-validates
  at its own boundary and would rebuild the literal, so this is not exploitable today; what is missing
  is that nothing in the code says the separation is load-bearing. **Phase B: state it in
  `groupByWorkspace`'s docblock, and add a unit test that a group whose row carries a non-null label
  still has `key === row.cwd` — asserted on the key, not merely on the label.** That test is in
  § Testing strategy; this finding is why it is not optional.
- **[Trust boundaries] SHOULD FIX — three IPC arm docblocks enumerate what crosses the boundary and go
  stale, one of them a live untrusted-strings warning.** Detailed in § Design 5. The
  `conversationUpdated` arm's warning names `name` and `cwd` as the untrusted daemon strings a consumer
  must render as plain text and never as HTML; `workspace_label` joins them and would be absent from a
  list that reads as exhaustive. This is the comment-shaped form of inheriting a false "never used as
  X" contract. **Phase B: correct all three enumerations and add the field to that warning.**
- **[Trust boundaries] No further findings.** The boundary is explicit and singular: the three
  narrowers in `inboundMessage.ts`, each a named function, each fail-closed. Downstream the label is
  typed `string | null` — identical to `cwd`, which is the correct signal, since its handling
  constraints are `cwd`'s. Verified rather than assumed, per the field's posture: `WorkspaceRow` uses
  `label` exactly once, as an auto-escaped React text child inside `<span
  className="channel-list__workspace-label">`; it reaches no attribute, no `title`, no `aria-label`, no
  React key, no URL and no lookup path. The four sinks that comment block declines are unchanged and
  now cover a second daemon string — restated there in Phase B rather than left to be re-derived.
- **[Tokens, secrets, credentials] Not applicable by construction.** No token, key or credential is
  read, written, compared or transported. The field is display text on an already-established event
  path; no new storage of any kind is introduced (AC5), so there is no lifecycle to address.
- **[File / storage operations] Not applicable, and confirmed rather than assumed.** The label is a
  *name*, not a path, and nothing parses it: no `path`, no `fs`, no `node:*`, no `URL`. It is never a
  filename, a cache key or a lookup path. On the web-storage question specifically —
  `conversationListStore.ts` contains no `localStorage` reference, so conversation rows are held in
  memory only and the label cannot ride an existing persistence into web storage; the workspace-fold
  state in `ChannelList.tsx` is React state whose own docblock records that it touches neither disk nor
  `localStorage`. AC5's "no `localStorage` key is added" therefore holds by construction, not by
  promise.
- **[Inter-process / Electron attack surface] No findings.** No `BrowserWindow` option, no
  `contextBridge` API, no `ipcMain` channel and no protocol handler is added or widened. The field
  rides three existing main→renderer event arms as one more `string | null` on payload objects already
  crossing whole; the renderer→main direction is untouched, so no new renderer-supplied value reaches
  main. Structured clone carries `string | null` faithfully, and the field is never `undefined` after
  the parse.
- **[Cryptographic primitives] Not applicable.** No randomness, no hashing, no key material, no
  comparison against a secret. The Noise session and its variant constant are untouched.
- **[Network & I/O] No findings.** No socket, timeout, TLS setting, reconnect path or frame cap is
  changed; the label arrives inside frames the existing codec already size-caps. The label is
  unbounded daemon text, but so is the `cwd` segment rendered in that same `<span>` today — the
  exposure is unchanged, and the span already ellipsizes.
- **[Error messages, logs, telemetry] No findings, verified.** The three narrowers reach the label
  through `requireStringOrNull`, whose message is `missing required field: workspace_label` — the field
  name, never its value, matching the file's category-only posture for `name` and `cwd`. No log line is
  added on any path this feeds; the label never reaches `console.*` (both the view-model and
  `ChannelList` are log-free by construction and say so), and no production code serialises a whole
  payload — every `JSON.stringify` under `src/main/` and `src/renderer/src/store/` is in a test, most
  of them asserting that content is *absent* from a log.
- **[Concurrency] Not applicable.** No async task, timer, listener, subscription or shared-state
  mutation is introduced. `groupByWorkspace` stays a pure synchronous function over an array.
- **[Threat model alignment] Two threats named, both accepted with reasons.**
  - *Hostile or impersonating daemon.* It can set an arbitrary label for any workspace and thereby
    mislabel a workspace row — a spoofing surface that did not exist when the label was derived
    locally from the `cwd`. Accepted: it is the ticket's whole point that the name is daemon-held and
    travels between clients, and the group's *identity* remains its `cwd`, which is what the plus
    control and the grouping both key on. The label misleads; it cannot redirect.
  - *Stale daemon, availability.* Because the field is required-present, a daemon older than
    pyrycode#2208 now fails every `list_conversations` reply closed — the sidebar would show no
    conversations at all rather than degrade. Accepted: AC1 mandates fail-closed, and the alternative
    (defaulting an absent key to `null`) would let a stale or impersonating daemon silently suppress a
    label the user set. Mitigation is verification, not code: the installed binary was checked
    statically here (`workspace_label`, no `,omitempty`), and AC4's `npm run e2e:real:gate` is the real
    proof — operator-run on this fork, flagged in the PR body.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
</content>
</invoke>

## Revisions

**2026-09-08 — one existing log assertion had to change, and the fixture cascade had a category the plan
did not name.**

- `inboundMessage.test.ts`'s #1249 test "logs the same content-free record whether or not the ack is
  correlated" asserted `expect(lines[0]).not.toContain('41')` over the WHOLE log line, including the
  `hash` field. That field is a sha256 over the frame bytes, so adding one payload field reshuffled it,
  and the new digest happens to contain `e641`. The assertion's intent (the correlation handle is not
  logged) is right; its implementation was a lottery, since a 64-hex-character digest carries a given
  two-character decimal substring most of the time. Narrowed to sweep every logged field EXCEPT `hash`,
  with the reasoning in a comment: the digest is derived from the frame by construction, so it cannot be
  an echo of anything the frame contains. Not a behaviour change and not a weakening — the fix is in the
  test only, and the production log is byte-identical.
- The plan counted the cascade as "full literals of the three payload shapes", found by
  `git grep 'last_message_ts:'` and by `tsc`. Two categories escaped both, and cost a cycle each:
  **inline envelope payloads in main-side tests** (`daemonConnection.test.ts`,
  `daemonConnection.roundtrip.test.ts`) are typed `unknown` at the envelope boundary, so `tsc` sees
  nothing and only the runtime decode rejects them; and **a `ConversationUpdatedPayload` literal in an
  e2e spec with no `last_message_ts`** (`channel-system-prompt.spec.ts`), which the grep could not match
  and no tsconfig covers. The e2e one was found by the ad-hoc `tsc --noEmit` sweep over `e2e/`, which is
  the only thing that typechecks that directory. Both are recorded under Lessons learned on the PR.
