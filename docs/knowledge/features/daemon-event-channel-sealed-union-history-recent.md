# Daemon event channel — the sealed union: per-member history (recent members)

Part of [Daemon event channel — the sealed union: per-member history](daemon-event-channel-sealed-union-history.md);
see that document for the union type declaration and the split's own rationale. This half covers
every member from `slashCommandList` (#937) onward, plus the two standing rules that govern the
whole union rather than one member. Split further 2026-09-08 alongside the early-members half once
the combined list again exceeded the size cap.

- **`slashCommandList{conversationId,commands,droppedCommands}`**
  ([#937](https://github.com/pyrycode/pyrycode-desktop/issues/937)) carries the workspace's
  slash-command menu the last hop across IPC — the wire vocabulary
  ([#935](https://github.com/pyrycode/pyrycode-desktop/issues/935)) and the fail-closed decode
  ([#936](https://github.com/pyrycode/pyrycode-desktop/issues/936)) already existed; this arm is the
  emit. Placed at the union's tail rather than beside its wire neighbours the question arms:
  `questionShown` sits mid-file because it copies `modalShown`'s conversation-scoping shape and the two
  families are read together, but this arm opens its own family and has no such neighbour. Its
  structural relative is `backgroundTaskRoster` above — one id, the rows, and a drop count — and the
  name follows that precedent: a noun naming the snapshot, not a past participle naming an occurrence,
  and deliberately not `slashCommandsReceived` (the union's `…Received` arms name a reply to a request
  this client made; this frame is unsolicited). A **snapshot, not a delta**: each frame replaces a
  reader's view of the menu, and `commands: []` is a positive statement that claude offered nothing for
  that conversation — unlike `questionShown`'s empty array, which is out of contract, the two read
  alike and mean opposite things.

  Top-level fields are snake→camel (`conversation_id`→`conversationId`,
  `dropped_commands`→`droppedCommands`); **the row type is reused verbatim** —
  `commands: readonly WireSlashCommand[]` stays snake_case (`argument_hint`, `truncated_fields`), the
  `queueState`/`conversationsReceived`/`backgroundTaskRoster`/`questionShown` nested-array precedent,
  since #936's narrower already stripped every row to its known fields. This family nests one level,
  unlike `questionShown`'s two. All three fields are required, never optional — an assigned `undefined`
  survives the structured clone across this channel, so an optional field would invent an absence case
  the daemon never produces. `droppedCommands` is this frame's only truncation report at the frame level
  (`commands.length + droppedCommands` is the menu's true size, `0` a value never consulted for
  truthiness); each row's own `truncated_fields` names that row's own cut fields, `null` distinct from
  `[]`, never hoisted or flattened. A `truncated_fields` naming `aliases` is the only signal separating
  "cut to nothing" from "none" — reading it as "none" greys out a working command, since the Actions
  menu's own `reset` entry is an alias of `clear`, not a command name (#681).

  SECURITY: `name`, `argument_hint`, `description` and every string in `aliases` are
  **workspace-authored** — a lower trust tier than the claude-authored strings
  `modelAnnounced`/`questionShown` carry — bounded by the daemon and not sanitized; the render slice
  owes the escaping (plain text only, never HTML, an attribute, a URL, a filename, a cache key, or a
  log). `name` is not an identifier (one measured name is `__remote-workflow`). `conversationId` is an
  outbound routing/scoping key, not a nonce, unlike `questionShown`'s `questionBatchId` — the never-log
  rule applies here for log-forgery reasons (`0x0a` is the only sub-`0x20` byte measured across the
  capture), not for secrecy.

  Ships dormant no longer: [the slash-command-list store (#954, shipped)](slash-command-list-store.md)
  is a fifth, independent observer catching this arm in the `announcedModelBridge` posture, alongside
  the four exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`),
  which keep their no-ops permanently — the call #937 left open, resolved in #954's favour of a
  dedicated subscriber over folding into an existing bridge. Nothing renders the store's held list yet;
  #940 and #681 are its first readers. See [Slash-command-list wire types](slash-command-list-wire-types.md)
  for the wire shape and [Inbound message decode](inbound-message-decode.md) for #936's decode.
- **`modelList{conversationId,models,droppedModels}`**
  ([#973](https://github.com/pyrycode/pyrycode-desktop/issues/973)) carries the daemon's published model
  menu the last hop across IPC — the wire vocabulary
  ([#971](https://github.com/pyrycode/pyrycode-desktop/issues/971)) and the fail-closed decode
  ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)) already existed; this arm is the
  emit, structurally identical to `slashCommandList` above it: a fresh named-field literal built in
  `daemonConnection`'s `case 'model-list':`, never `return event` and never a spread of the decoded
  payload. Placed at the union's tail for `slashCommandList`'s own stated reason — the frame opens its
  own family and has no wire-neighbour to sit beside. A **noun naming the snapshot**, not a `…Received`
  participle: the union's `…Received` arms name a reply to a request this client made, and this frame is
  unsolicited (it rides a `control_response` but is not correlated by this client's outstanding-request
  memory).

  Top-level fields are snake→camel (`conversation_id`→`conversationId`,
  `dropped_models`→`droppedModels`); **the row type is reused verbatim** — `models: readonly
  WireModelOption[]` stays snake_case (`resolved_model`, `value`, `display_name`, `effort_levels`,
  `supports_auto_mode`, `truncated_fields`), the `queueState`/`conversationsReceived`/
  `backgroundTaskRoster`/`questionShown`/`slashCommandList` nested-array precedent, since #972's
  narrower already rebuilds every row as a fresh six-field literal. All three fields are required, never
  optional — an assigned `undefined` survives the structured clone across this channel, so an optional
  field would invent an absence case the daemon never produces. `droppedModels` is this frame's only
  truncation report at the frame level (`models.length + droppedModels` is the menu's true size, cut
  from the tail so the carried rows are claude's first N in his own order; `0` is a value, never
  consulted for truthiness); each row's own `truncated_fields` names that row's own cut fields, `null`
  distinct from `[]`, never hoisted or flattened. `models: []` is a positive statement that claude
  offered nothing for that conversation, and must still emit exactly one event — the same posture
  `slashCommandList`'s `commands: []` carries and the opposite of `questionShown`'s empty array, which is
  out of contract.

  **Exactly two other arms carry a field named `model`, and this one means a third thing.**
  `runConfigReceived.model` is the per-session *override* (`''` = "inherited default, no override");
  `modelAnnounced.model` is what claude announced *for the current turn*. This arm's rows are the
  *menu* — what claude will accept, not what was chosen or what ran.

  SECURITY: `resolved_model`, `value`, `display_name` and every string in `effort_levels` are
  **claude-authored** — a *higher* trust tier than `slashCommandList`'s workspace-authored strings,
  reachable by prompt injection in a way workspace text is not — bounded by the daemon and not
  sanitized; the render slice owes the escaping (plain text only, never HTML, an attribute, a URL, a
  filename, a cache key, or a log). The never-log clause rests on the *contract* here (the daemon bounds
  and does not sanitize, so a control byte is permitted rather than excluded), not on a measurement —
  `slashCommandList`'s `0x0a`-across-51-entries evidence is that sibling's and does not transfer.
  `conversationId` is an outbound routing/scoping key, not a nonce, the same posture `modalShown` and
  `questionShown` carry.

  Consumed as a no-op by all four exhaustive bridges (`daemonEventBridge`, `timelineBridge`,
  `modalBridge`, `questionBridge`), each documented **permanent**: none of the four will ever own
  this arm. Ships dormant no longer: [the model-list store (#974,
  shipped)](model-list-store.md) is a fifth, independent observer catching this arm in the
  `announcedModelBridge`/`slashCommandListBridge` posture. Nothing renders the store's held list
  yet; #975, #976, #683 and #682 are its queued readers. See [Model-list wire
  types](model-list-wire-types.md) for the wire shape and [Inbound message
  decode](inbound-message-decode.md) for #972's decode.
- **`historyPageReceived{conversationId,entries,cursor,atStart}` / `historyRequestFailed{conversationId,reason,retryable}`**
  ([#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222)) are conversation scroll-back's
  transport pair — one backward step of a walk over the daemon's append-only on-disk log, and its
  refusal. **`conversationId` on both arms is client-owned**, not daemon-asserted like every routing
  key above it in this file: a `history_page` carries no conversation id at all, so [daemon
  connection](daemon-connection.md)'s new `pendingHistoryRequests` map resolves it from the envelope
  id the request itself was sent under (the `runConfigReceived` provenance argument, restated for a
  second reply that names no conversation). `entries: readonly HistoryEntry[]` is reused **verbatim**
  — the `queueState`/`conversationsReceived` nested-array precedent — and is this union's most
  untrusted payload: each entry is replayed content carrying exactly the trust class of the live frame
  it mirrors (the daemon's § *Security model* threat 1), and nothing about being stored makes it more
  trusted. `cursor`/`atStart` cross **as sent**, never inferred from each other or from the entry
  count — `atStart` is the only termination signal, and a short page is not an end-of-log signal.
  `reason: HistoryRequestFailure` is a **new, six-member sibling** of `DebugBundleFailure`'s
  information-minimising shape, duplicating `HistoryRejectReason`'s five members by hand (the
  `AttachmentUploadFailure`/`DaemonErrorOutcome` mirroring precedent, since `inboundMessage.ts` is
  IPC-free by placement rule) plus one, `'unclassified'` — not a hedge, but where a correlated
  `message.too_long` lands (§ *Page size*'s over-cap entry case), so a correlated refusal always
  settles the ask. `retryable` is **computed once, at this emit**, diverging deliberately from
  `DaemonErrorOutcome`'s documented-not-computed posture: this verb's five codes are published in one
  section with exactly one retryable member (`history-unavailable`), where the consumer that would
  otherwise re-derive it is a scroll-back walk driver ([#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224))
  — precisely where a wrong re-derivation becomes a self-inflicted retry loop against a relay that is
  merely withholding the frame. Ships dormant/permanent-null across all four exhaustive bridges:
  `daemonEventBridge`/`modalBridge`/`questionBridge` null both arms **permanently** (a replayed frame
  is never a `SessionAction`, a modal, or a question — even though a page may *carry* a stored
  `modal_shown` among its entries without *being* one), while `timelineBridge` nulls them **dormantly**
  — a page's entries are literally timeline items, and [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)
  is expected to claim them. See [Request history send](request-history-send.md) for the whole verb
  pair: the outbound builder, the fail-closed decode, and the correlation map both arms are emitted
  from.
- **`systemPromptReceived{conversationId,systemPrompt,sessionPromptStatus}`**
  ([#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230)) is the read half of a
  conversation's system prompt. **`conversationId` is client-owned**, `historyPageReceived`'s
  provenance exactly — the reply carries no conversation id at all, so [daemon
  connection](daemon-connection.md)'s new `pendingSystemPromptRequests` map resolves it from the
  envelope id the request was sent under; the omission is a **security property** here, keeping an
  unhosted conversation's reply byte-identical to a hosted-but-quiet one. `systemPrompt: string |
  undefined` is a **required key**, not optional, so the tri-state (absent/`''`/text) survives the
  bridge unchanged; `sessionPromptStatus` is a closed three-value literal, independent of the prompt.
  Untrusted operator text reaching no log sink; the four exhaustive bridges each take a dormant no-op
  arm, since their shared `assertNever` is the one sink left. This verb has **no error frame** at all,
  unlike `historyPageReceived`'s sibling refusal. See [System prompt send](system-prompt-send.md) for
  the whole verb pair.

- **`workspaceUpdated{path, label}`** ([#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288))
  also maps to *no* `SessionAction`, consumed by **none** of the four exhaustive bridges — each takes a
  one-line no-op `case`, the same tax `conversationDeleted`/`workspaceFolderCreated` paid. The real
  consumer is [conversation list store](conversation-list-store.md)'s `shouldRefreshList`, which reacts
  to the event's *occurrence* alone and re-requests `list_conversations` — **neither field is ever
  read, and that is the design, not an oversight**: the daemon correlates this frame by `in_reply_to`
  when this client asked for a workspace rename and pushes it unsolicited to every other connected
  client, and both shapes decode and emit identically, so **no `inReplyTo` rides the arm** — the
  `workspaceFolderCreated` precedent, restated for a frame that is sometimes correlated rather than
  never. Emitted as a **fresh two-field literal**, never a spread of the decoded payload — the
  small-payload idiom `workspaceFolderCreated{path}` / `conversationDeleted{id}` already use; only the
  six-field `conversationUpdated` wraps a wire type by reference. `path` takes
  `workspaceFolderCreated`'s posture — an **untrusted remote daemon-side path**, never resolved, never
  keyed into a lookup, never logged; `label` is untrusted operator text, `string | null`
  (`ConversationUpdatedPayload.workspace_label`'s contract verbatim — a cleared label is a literal
  `null`, never an absent key), owed plain-text rendering only, never HTML. The label the sidebar
  actually renders arrives later, on the authoritative `conversations` reply through the decode path
  [#1287](channel-list.md) hardened — patching a row straight from this frame's fields would put
  untrusted daemon text on screen bypassing that decode, which is why
  `conversationListBridge.test.ts` asserts `setConversations` is never called for this event. See
  [conversation list store § the `workspaceUpdated` refresh trigger](conversation-list-store.md) and
  [inbound message decode — extension history](inbound-message-decode-history.md) for the decode half.

- **`thinkingProgress{estimatedTokens,conversationId}`**
  ([#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313)) carries claude's only mid-turn
  proof of life on the stream-json surface the last hop across IPC — the wire vocabulary and the
  fail-closed decode ([#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) already
  existed; this arm is the emit, placed directly after `modelAnnounced` so the switch mirrors
  `InboundDaemonMessage`'s own arm order. **A reading, not a state transition** — unlike every
  `apiRetry`/`compacting` neighbour, it has no rising and no falling edge, so no consumer may look for
  one; it carries no `turn_id` and opens/closes no turn, which makes it daemon state by the
  `queueState` #720 rule (an identity report *about* a turn is not an item *in* one) rather than a
  turn-stream item.

  **Two of the wire's three fields cross.** `estimated_tokens_delta` does **not**: nothing consumes it
  (the render slice [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) shows the total
  alone) and the payload's own contract says the deltas received do not sum to the turn's total, so an
  arm carrying one would invite exactly the accumulation it forbids — a field crosses when something
  needs it, not before. **No `daemonTs`**, and the omission is the design, not an oversight: that
  mix-in marks the arms `decodeHistoryEvent` draws, which need (`type`, `ts`) as the join key between a
  served page and the live stream, and a stored `thinking_progress` is still skipped, so there is no
  page half to join against — `modelAnnounced`, not `apiRetry`, is the precedent for this literal's
  shape. `estimatedTokens: 0` is a **value, never an absence** — neither wire field carries
  `omitempty`, so the daemon's zero round-trips as legal traffic and nothing may consult truthiness on
  it; nor may anything assume the reading only grows, since it restarts near zero at every
  inference-request boundary, four times inside the daemon's own committed single-turn capture.
  `conversationId` is **required, never optional** — an optional routing key invites `??
  activeConversation` fallbacks, the misattribution the per-conversation work exists to remove.

  **Not deduped, and the emit needs that said more loudly than its neighbours**: no dedup, no
  coalescing, no timer, no last-value memo, and none keyed by `conversationId` either. The wire
  re-fires as the count climbs — a monotonic filter or same-value suppressor would invent wire
  semantics the daemon does not have and would starve #1314 of readings it must draw. Not
  compile-forced (`daemonConnection`'s inbound switch has no `assertNever`) — the round-trip test is
  what guards this emit, including a `Object.keys(...).sort()` assertion that the delta and the snake
  spellings never ride along.

  SECURITY: `estimatedTokens` is an **unbounded daemon-asserted integer** — a consumer must never size
  an allocation, index a buffer, or bound a loop proportionally to it (`attachment_chunk`'s
  `total_chunks` is the neighbour that earned the rule: never allocate from a claim) — and it is a
  **side-channel on how much claude thought** about private work, which is why it reaches no log on
  any path: `emitDaemonEvent` is log-free by construction and #1312's decode-side log line is pinned
  content-free independently. `conversationId` is a daemon-asserted routing key, never rendered text,
  reaching no sink on this leg. Consumed as a **permanent** no-op by three of the four exhaustive
  bridges (`daemonEventBridge`, `modalBridge`, `questionBridge`) — none of the three will ever own this
  arm — and a **dormant** no-op by the fourth (`timelineBridge`), the member of this group a reader is
  most likely to want there, since a mid-turn thinking reading looks exactly like thread chrome for the
  running turn. Whether #1314 claims it through `timelineBridge` (the `apiRetry`/`compacting` posture)
  or through a fifth independent subscriber (the `questionShown`/`slashCommandList` posture) is that
  slice's call, not this carry slice's — what is settled here is only that nothing draws it yet.
- **`rateLimited{conversationId,status,limitType,resetsAt}`**
  ([#1319](https://github.com/pyrycode/pyrycode-desktop/issues/1319)) carries the daemon's usage-limit
  report the last hop across IPC — the wire vocabulary and the fail-closed decode
  ([#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318)) already existed; this arm is the
  emit, placed directly after `thinkingProgress` so the switch mirrors `InboundDaemonMessage`'s own arm
  order. **A reading, not a state transition**, the `thinkingProgress` rule restated for a second arm:
  no rising and no falling edge, no `turn_id`, opens and closes no turn — daemon state by the
  `queueState` #720 rule rather than a turn-stream item, since a usage-limit window is orthogonal to
  whichever turn happened to observe it.

  **Four of the wire's five fields cross.** `truncated_fields` does **not**: nothing consumes it — the
  eventual surface renders no daemon-authored string at all, selecting client-owned copy by `status` /
  `limitType` and falling back to generic wording on a miss, so a value the producer cut misses that
  lookup exactly as an unrecognised one does. **No `daemonTs`**, the `thinkingProgress`/`modelAnnounced`
  precedent: the decode arm takes no `FrameTimestamp`, so there is no served-page half to join a
  (`type`, `ts`) key against. `conversationId` is **required, never optional** — the same
  misattribution-avoidance rule every routing key on this union carries.

  **Neither open string is narrowed on this boundary.** `status` and `limitType` cross verbatim — no
  allow-list, no normalising, no rejection of the one measured-benign value — because the daemon left
  both sets open (the value set beyond `allowed_warning` is unmeasured) and narrowing here would drop
  the first real limit that fires. `resetsAt` crosses unpoliced in the other direction: `0` means claude
  did not report an instant, not the epoch, so a truthiness read is wrong and nothing on this leg or
  downstream may schedule, allocate or iterate from it (`attachment_chunk`'s "never allocate from a
  claim", one field over).

  **Not deduped**: no dedup, no coalescing, no timer, no last-value memo, none keyed by
  `conversationId` — the daemon re-reports the window once per run whatever its state, and a suppressor
  would eat the report that says the reading is still current. Not compile-forced (`daemonConnection`'s
  inbound switch has no `assertNever`) — the round-trip test is what guards this emit, including an
  `Object.keys(...).sort()` assertion that `truncated_fields` and the snake-cased fields never ride
  along.

  SECURITY: `status` and `limitType` are **claude-authored open strings that crossed the subprocess
  trust boundary** — usable only as lookup keys for client-owned copy, never rendered verbatim, never an
  authorization signal, never a filename, a cache key or a lookup path; a client **must not branch
  security-relevant behaviour on `status`**. This is a deliberate, named divergence from
  `RateLimitedPayload`'s own docblock, which forbids using either string as a lookup key at all — the
  wire's prohibition targets a key that resolves a *resource* (a filename, a path, an icon URL, a cache
  entry), where an attacker-chosen value escapes the program's own constants, while a key into a
  client-owned copy table selects only among strings this client wrote and falls back to generic wording
  on a miss. `conversationId` is a daemon-asserted routing key; if a consumer indexes by it, the index is
  a `Map`. **A frame is not proof anything was blocked** — the one measured non-benign status
  (`allowed_warning`, `seven_day`) fired while every turn kept running normally, so a consumer rendering
  "you are blocked" from this arm alone would mislead the operator. Nothing decoded reaches a log on any
  path: `emitDaemonEvent` is log-free by construction and #1318's decode-side log line is pinned
  content-free; together `status`/`limitType` disclose the account's quota posture, a fact about the
  operator rather than about the frame. Consumed as a **permanent** no-op by all four exhaustive bridges
  (`daemonEventBridge`, `modalBridge`, `questionBridge`, `timelineBridge`) — none of the four will ever
  own this arm.
  [#1320](https://github.com/pyrycode/pyrycode-desktop/issues/1320) settled the routing question this
  paragraph used to leave open: the reading goes to a **fifth independent subscriber**
  (`usageLimitBridge` → [usage-limit store](usage-limit-store.md)), the `questionShown`/`slashCommandList`
  route, not through `timelineBridge` the way `apiRetry`/`compacting`/`thinkingProgress` each eventually
  went. The deciding fact was lifetime rather than layout: a usage-limit window is conversation-scoped and
  outlives a turn end, a `/clear` and a session transition, so state a turn rebuilds would drop it at the
  wrong moment and cost every reducer arm an extra field to carry. `timelineBridge`'s `rateLimited` case
  now exists only so its `assertNever` guard makes a new arm a compile error.
- **`contextUsage{conversationId,model,totalTokens,maxTokens,percentage,categories,droppedCategories,mcpTools,droppedMcpTools,memoryFiles,droppedMemoryFiles}`**
  ([#1419](https://github.com/pyrycode/pyrycode-desktop/issues/1419)) carries claude's own report of how
  full the context window is, plus the three inventories that say how it got that way. The decode landed
  across four earlier slices — the reading (#1454), the category breakdown (#1455), the MCP-tool
  inventory (#1459), the memory-file inventory (#1460) — and this arm is the emit, placed directly after
  `rateLimited` so the switch mirrors `InboundDaemonMessage`'s own arm order. **A reading, not a state
  transition**, the `rateLimited`/`thinkingProgress` rule restated: no rising or falling edge, no
  `turn_id`, opens and closes no turn — daemon state by the `queueState` #720 rule, fanned out after
  every turn end.

  **All eleven wire fields cross**, unlike `rateLimited`: the frame carries no truncation marker to drop
  and every field has a consumer once #1420/#1421 land. **Top-level fields are snake→camel; the three row
  types (`ContextUsageCategory`, `ContextUsageMCPTool`, `ContextUsageMemoryFile`) are reused verbatim with
  their snake_case fields** — the settled house rule for nested arrays, with `queueState.queued` and
  `backgroundTaskRoster.tasks` as precedent: the row narrower already stripped each row to its known
  fields, so there is nothing to drop and no mapping to write. Hence `server_name` stays snake_case inside
  its row while `mcp_tools` becomes `mcpTools` at the top level. `readonly` on each array mirrors both
  precedents; the row interfaces themselves stay mutable. **No `daemonTs`**, the `rateLimited`/
  `thinkingProgress` precedent: the decode arm takes no `FrameTimestamp`, so there is no served-page half
  to join a (`type`, `ts`) key against.

  **The three arrays cross by reference, unmapped** — safe only because each row parser
  (`parseContextUsageCategory`/`parseContextUsageMCPTool`/`parseContextUsageMemoryFile`) returns a fresh
  two- or three-field literal built from named `requireString`/`requireNumber` reads, verified in the tree
  rather than trusted from the ticket. Had any parser returned its input record, a `__proto__` planted as
  an own data property inside a row would have ridden across IPC; the property is now pinned from the IPC
  side too, by a test that a key planted inside a row does not cross, so a future decoder change that
  breaks it reddens where the value actually crosses rather than only upstream.

  **Provenance is mixed within this one arm**, the field a reader is likeliest to get wrong:
  `conversationId` is daemon-authored (filled from the daemon's own registry record), while `model` and
  every row label, `server_name` and `path` are claude- or workspace-authored. **The reading is
  informational and nothing reconciles** — `percentage` is not derivable from `totalTokens`/`maxTokens`,
  the categories need not sum to the total, each dropped count is independent (an inventory's true size is
  `list.length` + its own dropped count), and no count is evidence about another's length. Rows arrive as
  a prefix in the producer's descending-token order — a cut always takes entries off the tail, so
  re-sorting or de-duplicating destroys the only ordering signal a consumer gets. `0` and `[]` are both
  values, never absences; nothing may test either for truthiness.

  **Never allocate, iterate or size anything from any of the six integers** — sharper here than anywhere
  else on this union: a dropped count is a count of rows that are *not present*, so the natural "…and 3
  more" rendering invites `Array(droppedCategories)` or a loop to that bound, an allocation sized by an
  unbounded daemon-supplied number. Render the figure, never a structure sized by it. Not deduped: one
  event per decoded frame, verbatim repeats included, since a window legitimately repeats and legitimately
  falls (a `/clear` or a compaction).

  SECURITY: **this is the first arm on the union whose untrusted content is nested** rather than sitting
  in flat scalar fields on the arm itself — `model` is the only untrusted string at the top level; every
  other one (a row's `name`, `server_name`, `path`, `type`) lives inside one of the three inventories, so
  a consumer that has internalised "the untrusted fields are the string-typed ones on the arm" handles
  exactly one of them. Each row prohibition is stated on its own row type rather than delegated: `name` is
  a label, never a handle to call anything by; `server_name` is inert despite colliding by name with the
  actuation-crossing `MCPReconnectPayload.ServerName` — never fed to an MCP verb or joined against
  `mcp_status`; `path` is path-shaped descriptive text and not a file handle — never an `href`, a
  `shell.openExternal` target, a `path.join` argument, a filename or a cache key, since the daemon
  constrains neither scheme nor shape (a `javascript:` URI or a UNC path arrives as an ordinary `path`
  exactly as `../../../etc/passwd` does in the committed fixture); `type` beside it is a label, never a
  discriminant to `switch` on. If a consumer indexes any inventory by any of its strings, the index is a
  `Map` — `__proto__` and `../..` are ordinary values in all three. `model` is also not an identity;
  `modelAnnounced` remains the authority on which model is running. Nothing decoded reaches a log on any
  path, and the grounds escalate across the frame: the three integers disclose how much private work is in
  the window, each per-row figure discloses how the window is *composed*, a `server_name` is workspace
  configuration disclosing what the operator wired up, and a `path` is the strongest — it discloses who
  the user is and where they work. It is also an integrity rule, not only a privacy one: the diagnostic
  stream is line-delimited JSON, and an embedded newline in a tool name or a POSIX path could forge a
  record.

  Consumed as a **permanent** no-op by all four exhaustive bridges — `daemonEventBridge`, `modalBridge`,
  `questionBridge` and, since [#1420](https://github.com/pyrycode/pyrycode-desktop/issues/1420), also
  `timelineBridge`, whose case was left DORMANT here pending that ticket's routing choice. #1420 settled it
  the `rateLimited`/`questionShown` way: the reading goes to a **subscriber of its own**
  (`reportedContextBridge` → [reported-context store](reported-context-store.md)), not through
  `timelineBridge` the way `apiRetry`/`compacting`/`thinkingProgress` each eventually went. The deciding
  fact was lifetime rather than layout, the same one that settled `rateLimited`: a context window is
  conversation-scoped and outlives a turn end, a `/clear` and a session transition, so state a turn rebuilds
  would drop it at the wrong moment and cost every reducer arm ten extra fields to carry.
  `timelineBridge`'s `contextUsage` case now exists only so its `assertNever` guard makes a new arm a
  compile error — and it matters more here than on any neighbouring arm, because that guard stringifies the
  **whole** event into an `Error` message and this is the largest arm on the union and the one carrying the
  most disclosive fields: deleting the case on the strength of "the arm is handled elsewhere now" would put
  every memory-file path and every MCP server name into a stack trace and a crash reporter.
- **`resetting{conversationId,active,phase,handoff}`**
  ([#1515](https://github.com/pyrycode/pyrycode-desktop/issues/1515)) carries the daemon's report that a
  conversation's session is being reset, and which phase of it the conversation is in, the last hop across
  IPC — the wire vocabulary and the fail-closed decode
  ([#1514](https://github.com/pyrycode/pyrycode-desktop/issues/1514)) already existed; this arm is the emit,
  placed directly after `contextUsage` so the switch mirrors `InboundDaemonMessage`'s own arm order. **Two
  edges, not a reading** — unlike `thinkingProgress`/`rateLimited`/`contextUsage` directly above, `active`
  is a rising and an explicit falling edge, the `apiRetry`/`compacting` shape. **The rising edge re-fires as
  the phase advances** (`wrapping_up` → `restarting`), one event per actual change, so a second rising edge
  is a real transition and never a duplicate to suppress. No `turn_id`, opens and closes no turn — daemon
  state by the `queueState` #720 rule, since a reset is orthogonal to whichever turn happened to be running.

  **All four decoded fields cross**, copied by name from the already-validated payload, never a spread —
  there is nothing to leave behind. **No `daemonTs`**, the `rateLimited`/`thinkingProgress` precedent rather
  than `compacting`'s: the decode arm takes no `FrameTimestamp`, because a stored `resetting` is **skipped**
  rather than served, so there is no served-page half for a (`type`, `ts`) key to join against; the union's
  timestamp stays optional on every arm, so only the emit site and its round-trip test — not the type system
  — catch a stray stamp. `HistoryTimelineEvent` gains nothing, since `resetting` has no replay ring.

  **Both empty strings cross intact on the falling edge — as the contract's own zero value, not as
  `undefined` and not as an absent key.** The daemon writes both keys on every frame (nothing upstream is
  `omitempty`), `''` is Go's zero value and a declared member of both closed sets, and the window gates on
  `active`: a consumer that saw a missing key could not tell a falling edge from a malformed one. Structured
  clone preserves an `undefined`-valued property across this bridge, so "absent" and "present and empty" are
  distinctions the boundary can actually keep — the `'conversationId' in event` ban in `timelineBridge`'s
  `timelineTargetFor` docblock is the standing lesson about probing for a field instead of requiring it.
  **Neither token is widened to `string` here** — `WireResetPhase` and `WireResetHandoff` cross as the
  closed sets #1514 established, the `WireTurnState` precedent, unlike `rateLimited`'s `status`/`limitType`
  two arms above: every field on this arm is daemon-authored, so narrowing is safe where widening would
  throw away a four-value switch for an open one.

  **Not deduped**: no dedup, no coalescing, no timer, no last-value memo, none keyed by `conversationId` —
  the rising edge re-firing as the phase advances means a suppressor would eat a real transition. Not
  compile-forced (`daemonConnection`'s inbound switch has no `assertNever`) — the round-trip test is what
  guards this emit, including an explicit `Object.keys` presence check beside the `toEqual`: `toEqual`
  alone ignores an undefined-valued property, so it cannot by itself distinguish "empty string" from
  "dropped key" or "stray `daemonTs`" from "correctly absent."

  SECURITY: **narrowed is not trusted** — a closed union is a compile-time invitation to read a value as
  settled fact, and it is only a claim by a peer. The set is **2 × 3 × 4 = 24** combinations of
  (`active`, `phase`, `handoff`), not sixteen (the figure inherited verbatim from `ResettingPayload`'s own
  contract block at #1514, which carries the same correction owed); a consumer handles all of them, not
  only the daemon's three observed rows, and must not branch security-relevant behaviour on either token.
  `handoff: 'written'` describes a file the daemon wrote and the payload carries **no path** — nothing
  downstream can resolve, join, open, stat or link one; the token is a status, not a locator. Nothing
  decoded reaches a log on any path: `emitDaemonEvent` is log-free by construction and #1514's decode-side
  line is pinned content-free, which matters for the phase/handoff pair as much as for the id — together
  they disclose which conversation the operator reset and whether a handoff note was written, a fact about
  the operator's workflow rather than about this frame. `conversationId` is a daemon-asserted routing key;
  if a consumer indexes by it, the index is a `Map`. **A consumer must not rely on the falling edge
  arriving** — a daemon killed mid-reset sends no `active: false`, so an indicator cleared only by that
  frame pins forever, and the clearing path needs an independent trigger (disconnect, conversation exit,
  turn activity). Nothing on this leg can defend that; the obligation rides forward to this arm's
  consumers.

  Ships **dormant**: three of the four exhaustive bridges (`daemonEventBridge`, `modalBridge`,
  `questionBridge`) no-op it **permanently** — a reset is orthogonal to connection status, is not a
  permission prompt (no `modal_id`, nothing daemon-side waiting on an answer) and is not an ask (unsolicited,
  nothing outstanding), each reporting what the daemon is doing to a session rather than anything the
  session store, a modal or claude wants from the operator. `timelineBridge`'s case stays **dormant**, the
  `apiRetry`/`compacting`-before-#493/#496 shape: a reset is transient thread chrome, and whether it becomes
  an owned arm is [#1517](https://github.com/pyrycode/pyrycode-desktop/issues/1517)'s call, on the surface
  its composer status row owns. All four cases exist only so each bridge's `assertNever` guard makes a new
  arm a compile error — and it is not a formality: it stringifies the whole event into an `Error` message,
  which would put the conversation id and both tokens into a stack trace and a crash reporter.
- **The two unions stay separately declared, per layer.** `DaemonEvent` lives in `shared/ipc`, `SessionAction` in the renderer store. The 1:1 correspondence is a convenience for #19, **not a coupling** — the IPC contract can evolve independently of the store's action vocabulary.
- **Members reuse the wire payload types verbatim** from `../wire/types` (imported by relative path — see below): `connected.ack` is `HelloAckPayload`, `messageReceived.message` is `MessagePayload`, `messagesReceived.messages` is a `MessagePayload[]`, `conversationsReceived.conversations` is a `readonly ConversationSummary[]`. No redefinition, no drift.
- **`failed.error` is the wire `ErrorPayload`**, not the store's `ConnectionError`. The union stays wire-typed; #19 maps `ErrorPayload → ConnectionError` (a trivial field copy) at the store boundary. Transport-level failures with **no** wire envelope — silent Noise-handshake failure, dropped socket (detected in #4/#7) — are emitted by *synthesizing* a valid `ErrorPayload` (`{ code: 'transport' | 'handshake', message, retryable }`). See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md), which defined `ConnectionError` for exactly this.
- **`messagesReceived` carries complete messages, not partial tokens** — it mirrors the wire `message_chunk` (`MessageChunkPayload.messages`), a backfill batch. It flattens to the `messages` array directly, so `MessageChunkPayload` itself is *not* a member (its only field is the array the member already carries). `readonly` is a compile-time no-mutate signal; it is erased harmlessly across the IPC structured-clone boundary.
