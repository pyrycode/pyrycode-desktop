# Inbound message decode — extension history (recent extensions)

Part of [Inbound message decode — extension history](inbound-message-decode-history.md); see that
document for the split's own rationale. This half covers every additive extension from `model_list`
(#972) onward. Split 2026-09-08 once the combined history again exceeded the size cap; each entry keeps
the wording it had in the parent.

[#972](https://github.com/pyrycode/pyrycode-desktop/issues/972) added a twenty-fourth kind, `model_list`
→ `model-list` — the fail-closed decode of the daemon's model inventory into the [model-list wire
types](model-list-wire-types.md) vocabulary ([#971](https://github.com/pyrycode/pyrycode-desktop/issues/971)),
the `model_list`/`slash_command_list` sibling pair's other half. Two new parsers: `parseModelOption`
(an `isRecord` guard, `resolved_model`/`value`/`display_name` via `requireString`, `effort_levels` via
`requireStringArray`, `supports_auto_mode` via `requireBoolean`, `truncated_fields` via
`requireStringArrayOrNull`) is `parseSlashCommand`'s five-field shape scaled to six, and
`parseModelListPayload` clones `parseSlashCommandListPayload`'s shape exactly, trap included — within
one frame `models: null` fails closed (`Array.isArray(null)` is `false`) while a row's own
`truncated_fields: null` is a valid value. **Every string goes through `requireString`, none through
`requireNonEmptyString`**: the daemon's all-zero fixture is legal traffic, since neither struct carries
`omitempty` on any key, so an empty `resolved_model`/`value`/`display_name` is a real value rather than
a truncation signal. Thirteen reject branches, one test each — one bad row throws the whole frame
closed rather than yielding a partial menu.

Trust tier is the file's second claude-authored kind after `question_shown`, and **higher** than
`slash_command_list`'s workspace-authored strings — the never-into-a-log clause rests on the daemon's
bounds-but-does-not-sanitize contract rather than on a transcribed measurement, since no control byte is
measured in these short model labels the way `0x0a` was across `slash_command_list`'s 51
workspace-authored entries; copying the sibling's evidence here would have been a false claim about this
frame (`WireModelOption`'s own docblock, [#971](https://github.com/pyrycode/pyrycode-desktop/issues/971),
says so explicitly). No entry cap, no charset check, no length check, and no closed set over either
array field's elements — a closed `effort_levels` set would discard the evidence a consumer needs once
claude publishes a level the daemon's own inbound `validEffort` enum has not yet widened to match.
`dropped_models` is carried verbatim, never cross-checked against `models.length` and never
range-checked (JSON carries no `NaN`/`Infinity`, so `typeof === 'number'` is complete against the wire).
Content-free-logged as `inbound-decoded(code: 'model_list')` before the `default` branch, narrowed
before logging so a malformed frame leaves no record; deliberately no `count`, the
`background_task_roster`/`model_announced`/`slash_command_list` posture. Ships dormant and unclaimed:
`daemonConnection.ts`'s inbound switch has no case for `'model-list'` and no catch-all, so the IPC carry,
the store and the run-configuration rows that replace `RunConfigSections.tsx`'s hardcoded
`MODEL_CATALOG`/`EFFORT_LEVELS` are the slices below this one in the family, unbuilt as of this ticket.
Architect self-review PASS.
[#973](https://github.com/pyrycode/pyrycode-desktop/issues/973) has since claimed this arm — a
`case 'model-list':` in `daemonConnection.ts`'s inbound switch emits the decoded value onward as the
`modelList` `DaemonEvent` arm, a fresh named-field literal built at the emit rather than a spread of
this decode's payload. See [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md).

[#998](https://github.com/pyrycode/pyrycode-desktop/issues/998) added a twenty-fifth kind,
`attachment_chunk` → `attachment-chunk` — the same `EnvelopeType` member [#860](attachment-chunk-envelope.md)
already produces on the upload leg, now also recognised on the **retrieval** leg (the daemon's answer
to a `request_attachment`, [#993](request-attachment-envelope.md)), into the [attachment-chunk
retrieval decode](attachment-chunk-retrieval-decode.md) vocabulary. `parseAttachmentChunkPayload` is
`parseAttachmentStoredPayload`'s shape (#964) scaled to eight fields plus a base64 decode:
`attachment_id` through the existing `requireNonEmptyString`, `total_chunks` then `index` each through
`requireNumber` plus an integer + range check (narrowed in that order so the range check has its
bound), `filename`/`mime_type`/`sha256`/`size` through plain `requireString`/`requireNumber` (type
only — the reassembler owns integrity, against the assembled bytes, not this decode), and `data`
through `base64StdDecode(requireString(…))` — the wire codec's STRICT decoder, which requires the
input to be the exact base64-std re-encoding rather than tolerating Node's lenient `Buffer.from`. No
new field narrower: every check reuses an existing helper. The kind is the file's first to type
`inReplyTo` **required** rather than optional, where the three prior kinds that surface it
(`daemon-error`/`session-settings`/`session-settings-updated`) all type it `?: number` — a retrieval
chunk cannot legitimately arrive unsolicited, so one without a correlation is malformed rather than an
uncorrelated variant, checked *before* the payload is parsed so an uncorrelatable frame is rejected
before the base64 decode's work is spent. Deliberately **not** precedent from `attachment-stored`'s
no-`inReplyTo` decision — the two arms sit adjacent in the switch and argue opposite directions for
the same envelope field. Content-free-logged as `inbound-decoded(code: 'attachment_chunk')` before the
`default` branch, narrowed (including the `inReplyTo` check) before logging, stricter than upstream
permits: never the id, index or total the daemon's own doc allows logging. The same ticket also
corrected two field docs on `AttachmentChunkPayload` itself — `filename`/`mime_type` were documented as
the uploading client's own strings, true inbound and false on this newly-decoded retrieval direction,
where the daemon sanitises the filename and sniffs the media type instead; a provenance correction
only; every client obligation (sanitise before render, never a path, never a privileged dispatch)
survives verbatim. Ships dormant and unclaimed: `daemonConnection.ts`'s inbound switch has no case for
`'attachment-chunk'` and no catch-all, so the reassembler that concatenates chunks into a file is the
first intended consumer, not yet started. Architect self-review PASS.

[#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222) added a twenty-sixth kind,
`history_page` → `history-page` — the answer half of conversation scroll-back's transport slice (the
ask is the new `request_history` outbound envelope; see [Request history send](request-history-send.md)
for the whole verb pair), decoding one backward step of a walk over the daemon's append-only on-disk
log (pyrycode#2112/#2113/#2116). Two new parsers plus one new field helper: `requireRecord(payload,
field)` narrows a required OBJECT field for the first time in this file — the near-miss `optionalStringMap`
requires string *values* where an entry's `payload` is arbitrary nested JSON, so neither existing
helper fit. `parseHistoryEntry` (an `isRecord` guard, `requireNumber`/`requireString`/`requireRecord`/
`requireString` over `id`/`type`/`payload`/`ts`) is a fresh four-field literal, deliberately **not**
narrowing `type` to `EnvelopeType` or any closed set — it is a stored string nothing re-validates,
spanning the whole live-lane vocabulary, and a client MUST tolerate one it does not recognise.
`parseHistoryPagePayload` takes `entries` through `parseQueueStatePayload`'s inline shape
(`Array.isArray` + `raw.map`, one bad element fails the whole page, `[]` valid and never `null`), then
`requireString('cursor')` — **not** `requireNonEmptyString`, since the reply's cursor is empty
whenever `at_start` is true — and `requireBoolean('at_start')`. **No count bound and no size bound**,
the `parseBackgroundTaskRosterPayload` posture: the frame-level `MAX_PLAINTEXT_BYTES` guard already
fails an oversized frame before any parse, and the daemon clamps the entry count at construction and
re-asks a too-large page rather than truncating one, so a bound here would either defend an
unreachable failure or drop valid pages. `entries`/`cursor`/`at_start` are carried exactly as sent —
`at_start` is the only termination signal, and nothing here normalises a short or empty page into an
end-of-log flag.

The kind's `inReplyTo` is **optional**, the `session-settings` posture rather than
`attachment-chunk`'s required one, because the reply names no conversation at all — the correlation
handle is the only way to attribute a page, and an absent one is merely uncorrelatable (a fail-closed
drop one layer up in [daemon connection](daemon-connection.md)), not a malformed frame. The same
ticket also widens the pre-existing `daemon-error` kind with a **second**, sibling narrower,
`HistoryRejectReason` — deliberately *not* a widening of `DaemonErrorOutcome`, since that type is
inherited whole by `AttachmentTransferFailure`/`AttachmentUploadFailure` and a history reject code
there would land in the attachment-upload failure union with no producing path. It mirrors its
neighbour's every property (total, never throws, the untrusted `code` string as a comparand only) and
diverges in one: it returns `undefined` outside its five-member set rather than an `'unclassified'`
member of its own, because a correlated `message.too_long` (one stored entry too large for any page)
is a real case `narrowDaemonErrorOutcome` *does* classify and this narrower does not — the field
carrying it, `historyReject?: HistoryRejectReason`, is optional where `outcome` is required, since
absence here has exactly one meaning read at exactly one emit. Content-free-logged as
`inbound-decoded(code: 'history_page')` before the `default` branch, narrowed before logging so a
malformed page leaves no record; no cursor, entry payload, entry `type`, entry `id`, or reject string
ever reaches a log line. Ships with a real consumer immediately: [daemon
connection](daemon-connection.md)'s new `pendingHistoryRequests` correlation map attributes each page
to the conversation its request named and emits `historyPageReceived`/`historyRequestFailed`, but all
four exhaustive renderer bridges (`daemonEventBridge`/`timelineBridge`/`modalBridge`/`questionBridge`)
intentionally null both arms. The independent `historyPageBridge.ts` consumes both:
received pages update rows and coverage, while failures settle request state for
[user-demand paging and explicit Retry](request-history-send.md#the-one-fact-that-shapes-every-piece). Architect (builder)
self-review PASS, no MUST FIX findings.

[#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230) added a twenty-seventh kind,
`system_prompt` → `system-prompt` — the read half of a conversation's system prompt (the write half,
`set_system_prompt`, is pyrycode#2151 and not this client's yet); see [System prompt
send](system-prompt-send.md) for the whole verb pair (the ask is the new `request_system_prompt`
outbound envelope). Answers a conversation's stored system prompt and whether the running session was
started with a different one, reading `internal/protocol/system_prompt.go` field-for-field. One new
narrower plus one new field helper: `narrowSessionPromptStatus(value)` is the comparand idiom
(`narrowDaemonErrorOutcome`'s shape) applied to a **rejecting** rather than catch-all narrower — it
switches the untrusted `session_prompt_status` string against the three client-owned literals the
daemon publishes and returns `null` outside them, and the caller turns `null` into a throw naming only
the field constant, never the rejected value, so a hostile status string never reaches a message this
narrower could build. `parseSystemPromptPayload` (an `isRecord` guard, then `optionalString(payload,
'system_prompt')` for the tri-state, then the status narrow) is the file's first payload where the
existing `optionalString` tri-state (absent → `undefined`, `''` → `''`, text → text, `null`/non-string
→ throw) is exactly the field's whole contract rather than one of several fields narrowed the same
way — `permission_mode` and the other optional wire strings in this file get the identical treatment,
but none of them carries a documented three-state meaning the way this one does. An explicit
`system_prompt: null` is off-contract (the daemon's `*string`-with-`omitempty` encoding never emits
one) and is rejected by `optionalString`'s existing `null` throw, not by a new check.

**No length bound and no `daemon-error` counterpart, both deliberate.** The frame-level
`MAX_PLAINTEXT_BYTES` guard already fails an oversized frame before this runs, and the daemon caps the
prompt write-side at 8192 bytes the way it caps `model` at 256, so a second bound here would either
defend an unreachable failure or fail-close a valid prompt. More sharply than any prior kind in this
file: **this verb mints no wire error code and has no failure branch at all**, so unlike
`history_page`/`session_settings` there is no sibling widening of the `daemon-error` kind to record —
every unresolvable case (no such conversation, no session, an unnamed request) already has a truthful
answer, `session_prompt_status: 'no_session'`, which deliberately merges five daemon states and must
be read as one reading, never repaired back apart.

Content-free-logged as `inbound-decoded(code: 'system_prompt')` before the `default` branch, narrowed
before logging so a malformed reply leaves no record; neither the prompt nor the status ever reaches a
log line, and `parseSystemPromptPayload`'s throw messages name the client-owned field constant only
(`'malformed field: session_prompt_status'`), never the daemon's string. Ships with a real consumer
immediately: [daemon connection](daemon-connection.md)'s new `pendingSystemPromptRequests` correlation
map attributes each reply to the conversation its request named and emits `systemPromptReceived`;
the independent `systemPromptBridge.ts` consumes that event. All four unrelated
exhaustive renderer bridges intentionally null the arm so each bridge's `assertNever`
guard, which stringifies the whole event into an `Error` message, cannot become a second sink for the
prompt text. Architect (builder) self-review PASS, no MUST FIX findings (one SHOULD FIX — the emitted
`conversationId` must come from the correlation map and not the decoded payload — closed by a
dedicated test before ship).

[#1249](../codebase/1249.md) is the write half's transport leg, `set_system_prompt` (pyrycode#2151),
and it changes this module twice — both additive, no new kind and no new payload parser. First,
**`conversation-updated` gains `inReplyTo?: number`**, propagated from `envelope.in_reply_to` in `case
'conversation_updated':`. The pre-existing member comment claiming that kind is never correlated was
wrong as of this ticket and was corrected in the same edit: the daemon replies to the requester with
`in_reply_to` on all six conversation write verbs, this one included, though the emit stays
unconditional and first regardless of correlation — see [Daemon connection — correlation § System-prompt
write correlation (#1249)](daemon-connection-correlation.md#system-prompt-write-correlation-1249) for
why the ack must not consume the frame the way a `daemon-error` match does. Second, **`daemon-error`
gains a *third* per-verb narrowed sibling field**, `systemPromptReject?: SystemPromptRejectReason`
(`'protocol-malformed' | 'conversation-not-found'`), set beside `historyReject` off the same untrusted
`code`. `narrowSystemPromptRejectReason` is `narrowHistoryRejectReason`'s twin exactly — `isRecord`, a
`string` check, a `switch` comparing the untrusted code against client-owned literals and dropping it,
total and never-throwing, `undefined` outside its two-member set rather than a member of its own. Two
pre-existing whole-object `toEqual` assertions on the `daemon-error` kind went red the moment this
narrower started classifying `protocol.malformed` (`toEqual` tolerates a missing property but not a
newly-*defined* one); both were repaired by naming the sibling field explicitly, deliberately not
loosened to `toMatchObject`. See [System prompt write](system-prompt-write.md) for the full design,
including the outbound builder, the client-side byte bound, and the two `DaemonEvent` arms this
decode change feeds. Architect (builder) self-review PASS, no MUST FIX findings.

[#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288) extended it once more, additively,
with `workspace_updated` → `{ kind: 'workspace-updated', workspaceUpdated: WorkspaceUpdatedPayload }`
via `parseWorkspaceUpdatedPayload` — the daemon's report that a *workspace's* label changed (SSOT
pyrycode#2209), where `workspace_folder_created` above reports that a workspace *directory* was made.
Built on the existing `isRecord`/`requireString`/`requireStringOrNull` helpers verbatim, no new helper
needed: `path` (required, the `workspace_folder_created` posture — an untrusted remote daemon-side path,
never resolved, never keyed, never logged) and `label` (required but nullable,
`ConversationUpdatedPayload.workspace_label`'s contract verbatim — a cleared label is a literal `null`,
never an absent key). Both fields have deliberately different nullability, and the payload returns a
fresh two-field object rather than reaching for one shared nullable-field helper.

The frame decodes identically **with and without** `Envelope.in_reply_to`: the daemon correlates it to
the client that asked for the rename and pushes it unsolicited to every other connected client, and both
shapes mean the same thing to every consumer — a workspace's label moved — so the `workspace-updated`
kind carries no `inReplyTo` at all (the `workspace-folder-created` precedent, restated for a frame that
is *sometimes* correlated rather than never). Content-free-logged as
`inbound-decoded(code: 'workspace_updated')` before the `default` branch, narrowed before logging so a
malformed frame leaves no record; neither `path` nor `label` ever reaches a log line, and the parser's
throw messages name the client-owned field constant only (`malformed workspace_updated payload`,
`missing required field: path`, `missing required field: label`), never the daemon's string.

The emit half, in [daemon connection](daemon-connection.md)'s consumer switch, builds a fresh
`{ type: 'workspaceUpdated', path, label }` literal — never a spread of the decoded payload — and the
[conversation list store](conversation-list-store.md)'s `shouldRefreshList` gained a fourth arm treating
the event purely as a re-list trigger: **neither field is ever read downstream.** That is the ticket's
central security property, not an incidental one — patching a sidebar row straight from this frame's
`label` would put untrusted daemon text on screen bypassing the `conversations` reply's own decode path,
so the emit and the trigger exist only to make the *existing* re-list mechanism (`conversationUpdated`'s)
reachable from a frame `conversation_updated` cannot cover: a bare workspace rename touches no
conversation, so it never fans out a `conversation_updated` broadcast. See [Daemon event channel — the sealed union:
per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md) for the
`workspaceUpdated` arm's own entry and the four compile-forced no-op bridge cases (`daemonEventBridge`,
`timelineBridge`, `modalBridge`, `questionBridge`). Architect (self-review) PASS, two SHOULD FIX (both about the shipped-but
unread `path`/`label` fields carrying a trust-tier warning at their declaration for whichever consumer
reads them first — closed by the doc comments on `WorkspaceUpdatedPayload` and the `events.ts` arm, not
by code, since nothing here reads either field yet).

[#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312) extended it once more, additively,
with `thinking_progress` → `{ kind: 'thinking-progress', thinkingProgress: ThinkingProgressPayload }`
via `parseThinkingProgressPayload` — claude's only mid-turn proof of life on the stream-json surface,
the daemon's translation of its `system/thinking_tokens` line (pyrycode#1386). `ThinkingProgressPayload{
conversation_id, estimated_tokens, estimated_tokens_delta}` scales `parseApiRetryPayload`'s shape down
from four fields to three and one boolean to none — a `requireString` plus two `requireNumber` calls,
no new helper. **A periodic READING, not a state transition**: no rising or falling edge, no `turn_id`,
opens/closes no turn — the daemon groups it alone in `codes.go` rather than with the `api_retry`/
`compacting` pair or the `background_task_*` three. **Deliberately not range- or monotonicity-checked**:
`estimated_tokens` restarts near zero at every inference-request boundary (measured four times inside
one captured turn), so the usual "no range check on a wire integer" rule is sharper here — a
monotonicity rule would fail-close ordinary traffic, not merely reject hypothetical future values. The
wire type's own docblock records two further measured hazards: the frames are rate-bounded and do not
enumerate claude's lines (33 lines measured as 8 frames), and the deltas received do not sum to the
turn's total (674 arrived as 243, no field reporting the residue). **Takes no `FrameTimestamp`** —
[#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225)'s mix-in marks exactly the ten arms
`decodeHistoryEvent` draws, and AC3 keeps this kind armless there (a regression pin: even a fully
well-formed stored `thinking_progress` still skips). Content-free-logged as `inbound-decoded(code:
'thinking_progress')` before the `default` branch; neither `conversation_id` nor either integer ever
reaches a log line — a reading of how much claude thought is a side-channel on private work. Carries no
claude-authored text at all (ADR 025), the one respect in which it is safer than every sibling in its
family. Ships dormant, the same two-step already taken for `question_shown` (#884/#885) and
`modal_shown` (#870/#871): `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops
here until the carry slice claims it. Architect (builder) self-review PASS, no MUST FIX findings; one
SHOULD FIX recorded for the eventual carry/render slice — a consumer must not allocate or iterate
proportionally to either daemon-supplied number.

[#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318) extended it once more, additively,
with `rate_limited` → `{ kind: 'rate-limited', rateLimited: RateLimitedPayload }` via
`parseRateLimitedPayload` — claude's usage-limit window report, the daemon's translation of its
top-level `rate_limit_event` claude line, not a `system/*` subtype like its two neighbours above (which
is why the daemon's own `system`-subtype count excludes it; SSOT pyrycode#1405 shape / #1410 producer).
`RateLimitedPayload{conversation_id, status, limit_type, resets_at, truncated_fields}` is
`parseBackgroundTaskStartedPayload`'s shape minus two strings plus one number: three `requireString`
calls, one `requireNumber` for `resets_at`, and `truncated_fields` through the existing
`requireStringArrayOrNull` — no new helper.

**`status` and `limit_type` are OPEN STRINGS, never closed enums, and here that is a SECURITY decision
as well as the usual no-drift one.** The daemon states the value set beyond the one measured-benign
status is UNMEASURED — no capture of a limit actually in force exists on any claude version — so a
closed set would drop the first real limit that fires, and narrowing either set is the first step of
branching on a value the daemon says a client MUST NOT branch security-relevant behaviour on. The empty
string decodes for both: the producer's cut-to-nothing case, reported by `truncated_fields` rather than
an absence. **`resets_at` is claude's number, unvalidated in both directions** — `0` means claude did
not report a reset instant, never the epoch, and negative/past/absurd magnitudes all decode; rejecting
one would be a validation rule with no captured negative case behind it. The plan's security review
named the sharper hazard for the eventual carry slice: a "limit lifts" timer computed as `resets_at *
1000 - Date.now()` fires *immediately* both when negative and when past `setTimeout`'s ~24.8-day 32-bit
clamp — `attachment_chunk`'s `total_chunks` "never allocate from a claim" family, one field over. **A
FRAME IS NOT PROOF THAT ANYTHING WAS BLOCKED** — the daemon's own named realistic client bug: the one
measured non-benign status, `allowed_warning` (2026-08-22, claude 2.1.239, `limit_type: seven_day`),
fired while every turn kept running normally, so a carry slice rendering "you are rate limited" would
mislead the operator. (One SSOT discrepancy worth recording: `RateLimitedPayload`'s Go docblock names
only `five_hour` as an observed `limit_type`; `docs/protocol-mobile.md`'s field table is newer and adds
`seven_day` from the same `allowed_warning` capture. Nothing here turns on which is right — the field
is open either way — but a slice that closed the set on the Go docblock alone would have closed it
around the wrong values; the protocol doc's table is the fresher source.)

**Takes no `FrameTimestamp`**, the `thinking_progress`/`model_announced` precedent — the mix-in marks
exactly the arms `decodeHistoryEvent` draws, and AC5 keeps this kind armless there (a regression pin:
even a fully well-formed stored `rate_limited` still skips). Content-free-logged as
`inbound-decoded(code: 'rate_limited')` before the `default` branch; neither `conversation_id`, `status`
nor `limit_type` ever reaches a log line — `status`/`limit_type` are claude-authored text that crossed
the subprocess trust boundary, unsanitized, and the pair together discloses the account's quota
posture. Ships dormant, the same two-step already taken for `question_shown` (#884/#885) and
`modal_shown` (#870/#871): `daemonConnection.ts`'s inbound switch has no catch-all, so the report stops
here until the carry slice claims it. This ticket also corrected three comments — the
`UnrecognizedMessagePayload` `WHAT THIS CLIENT DECODES` docblock, `decodeHistoryEvent`'s docblock, and
the AC3 skip-table comment in `inboundMessage.test.ts` — that had named `rate_limited` as the one type
with no parser at all, a claim left behind when #1312 moved `thinking_progress` off that same list.
Architect (builder) self-review PASS, no MUST FIX findings; one SHOULD FIX recorded for the carry slice
— never schedule, allocate or iterate from `resets_at`, since a delay derived from it can fire both too
early and immediately-instead-of-never.
