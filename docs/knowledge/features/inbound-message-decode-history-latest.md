# Inbound message decode — extension history (latest extensions)

Part of [Inbound message decode — extension history](inbound-message-decode-history.md); see that
document for the split's own rationale. This portion covers every additive extension from
`rate_limited` (#1318) onward. Split out of
[Recent extensions](inbound-message-decode-history-recent.md) 2026-09-24, once `attachment_offered`
(#1619) needed room; each entry keeps the wording it had in the parent.

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

[#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454) extended it once more, additively, with
`context_usage` → `{ kind: 'context-usage', contextUsage: ContextUsagePayload }` via
`parseContextUsagePayload` — claude's own report of what is in the context window, the daemon's
translation published after every turn end on the interactive path (pyrycode#2370 shape / #2371
producer). Decided 2026-09-14: the claude-reported figure becomes the display source; the
`session_settings`/`screen_snapshot` transcript-scan route — which reads 0% for a conversation opened in
a workspace and whose window half is a guess until a turn ends — becomes the fallback.
`ContextUsagePayload{conversation_id, model, total_tokens, max_tokens, percentage}` is
`parseRateLimitedPayload`'s shape minus one string and its nullable list plus two numbers: two
`requireString` calls, three `requireNumber` calls, no new helper.

**THIS SLICE DECODES THE FRAME'S READING ONLY.** The frame carries six more keys — three inventories
(`categories`, `mcp_tools`, `memory_files`) and their three dropped counts — on every real frame, not a
hypothetical future one; they are deliberately not declared on `ContextUsagePayload` and the fresh
five-field literal tolerates and drops them. A declared-but-unparsed field would put a type on the wire
surface with no narrowing behind it, so the follow-on slices own both the declaration and the parsing
of each inventory together. The test fixture transcribes the daemon's own committed `context_usage.json`
whole (rather than inventing an extra key), which proves the drop against real traffic and against
deliberately adversarial inventory values — a `../../../etc/passwd` memory-file path, markup
metacharacters in a tool name — none of which cross even as opaque data at this slice. Whichever slice
decodes `memory_files` inherits a path-traversal surface (that slice is #1460).

**[#1455](https://github.com/pyrycode/pyrycode-desktop/issues/1455) decodes the first of those
inventories, additively.** `categories: ContextUsageCategory[]` plus its own
`dropped_categories: number` join `ContextUsagePayload` (now seven fields), via
`parseContextUsageCategory` — an `isRecord` gate, one `requireString` for `name`, one `requireNumber` for
`tokens` — mapped over the array by `parseContextUsagePayload`'s new `Array.isArray`-then-`raw.map` guard,
the `parseModelListPayload`/`parseModelOption` shape. This is the point where the prior paragraph's "none
of which cross even as opaque data" stops being true for `categories`: the adversarial fixture's
`Messages <&>` now crosses as a decoded, typed value, byte-for-byte and unescaped — decoding makes the
row's *shape* trusted, never its *content*, and the escaping obligation is written into
`ContextUsageCategory`'s docblock for the IPC carry (#1419) and the surfaces (#1421) to read.
`null`/absent/non-array `categories` fails the whole frame closed, since `MarshalJSON` normalises a nil
slice to `[]` and an empty array is claude's positive report of no categories. The rows arrive as a
prefix in descending-token order; `dropped_categories` accumulates two independent cuts (the producer's
entry/string caps plus the mapper's frame-byte budget) and is never cross-checked against the retained
length — the committed fixture's `3` beside two retained rows is the case that proves it. One malformed
row throws `WireDecodeError` for the whole frame, naming the failure category only. `mcp_tools` and
`memory_files`, with their two dropped counts, followed in #1459 and #1460 respectively,
`../../../etc/passwd` decoded verbatim by #1460 below.

**[#1459](https://github.com/pyrycode/pyrycode-desktop/issues/1459) decodes the second of those
inventories, additively.** `mcp_tools: ContextUsageMCPTool[]` plus its own `dropped_mcp_tools: number`
join `ContextUsagePayload` (now nine fields), via `parseContextUsageMCPTool` — `parseContextUsageCategory`
one field wider: an `isRecord` gate, two `requireString` calls (`name`, `server_name`), one
`requireNumber` for `tokens` — mapped over the array by the same `Array.isArray`-then-`.map` guard
`categories` uses, applied a second time. `mcp_tools` is never `null`, an empty array is claude's positive
report of no MCP tools, and the rows arrive as a prefix in descending-token order — the never-null /
positive-empty / prefix-order rule extended rather than re-derived, and the committed fixture's `5` beside
two retained rows is this inventory's case proving `dropped_mcp_tools` is no evidence of completeness.
**The two inventories are never cross-read**: the daemon divides one envelope across three lists and can
cut all three at once, so neither list's length nor either dropped count says anything about the other.

**`server_name` is the new field, and it is decoded as inert.** Its name collides with the
actuation-crossing `ServerName` on the daemon's `MCPReconnectPayload`, which crosses an actuation seam
verbatim and is validated by nothing; this one names a contributor to a reading, never an actuation
target, an authorization input, or a value to join against `mcp_status` — the prohibition is written at
three levels (the row type, the payload type, and the union docblock) because a consumer reading only
one of them must still see it. Both `name` and `server_name` are narrowed with plain `requireString`
rather than `requireNonEmptyString`, on purpose: that helper exists for a field whose `''` is a *failed
lookup*, and nothing resolves either of these strings, so an empty one is a legitimate display value
the daemon's contract keeps present. The committed fixture's embedded newline (`query\ndocs`) and
`remote<mcp>` metacharacters cross byte-for-byte and unescaped, the escaping owed at the render sink
(#1421); the newline is also why neither string may reach a log field for an integrity reason, not only
a privacy one — the diagnostic stream is line-delimited JSON, and a logged tool name could forge a
record. `memory_files` and its dropped count followed in #1460 below, `../../../etc/passwd` included.

**[#1460](https://github.com/pyrycode/pyrycode-desktop/issues/1460) decodes the third and last of those
inventories, additively.** `memory_files: ContextUsageMemoryFile[]` plus its own
`dropped_memory_files: number` join `ContextUsagePayload` (now eleven fields), via
`parseContextUsageMemoryFile` — `parseContextUsageMCPTool`'s shape with different key names: an
`isRecord` gate, two `requireString` calls (`path`, `type`), one `requireNumber` for `tokens`. **Every
key the daemon writes is now declared and read.** `memory_files` is never `null`, an empty array is
claude's positive report of no memory files, and the rows arrive as a prefix in descending-token order —
the never-null / positive-empty / prefix-order rule extended a third time rather than re-derived, and the
committed fixture's `7` beside two retained rows is this inventory's case proving `dropped_memory_files`
is no evidence of completeness. **The three inventories are never cross-read**: the daemon divides one
envelope across three lists and can cut all three at once, so no count is evidence about another.

**`path` is the new field, and it is decoded as inert — path-shaped descriptive text, never a file
handle.** The daemon's own comment states the constraint: nothing joins, cleans, resolves or opens it,
because doing so would imply the frame acts on a real file, which it does not — rejecting a
traversal-shaped value would also be worse than useless here, since `../CLAUDE.md` is an ordinary
memory-file reference in a monorepo. The committed fixture carries `../../../etc/passwd`; it crosses
byte-for-byte and unnormalised, pinned by a test that checks both literal equality and non-normalisation
structurally (still starts with `..`, no leading-slash gain, no segment collapse). `type` beside it
carries the same constraint and is claude's own label, never a discriminant — a field spelled `type`
looks like one in a file whose every other `type` narrows an envelope, and it is not; nothing may branch
security-relevant behaviour on it. Both are narrowed with plain `requireString`, `parseContextUsageMCPTool`'s
stated reason: neither is a lookup key, so `''` is a legitimate display value rather than a failed
resolution. A memory-file `path` is the **strongest disclosure ground on the frame** — stronger than
`server_name`'s workspace-configuration ground one inventory over — because it names who the user is and
where they work: the fixture value alone leaks a home-directory username and a project name. A POSIX path
may also legitimately contain a newline, extending the MCP inventory's forge-a-log-record integrity
ground to this field too.

**PROVENANCE IS MIXED WITHIN THE ONE PAYLOAD**, the field-level fact this kind's docblock names
separately rather than giving the type one blanket sentence: `conversation_id` is DAEMON-authored, filled
from the daemon's own registry record; `model`, every row's `name` and every `type` are CLAUDE-authored
descriptive text that crossed the subprocess trust boundary, neither validated nor sanitized upstream;
every `server_name` and every `path` are WORKSPACE-authored — configuration and filesystem layout the
operator set up, never claude's own words. A reader assuming one provenance for the whole struct is wrong
most of the time, in the direction that promotes one of these strings to a checked value. `model` stays
inert text — never a lookup key, a Map key, a path, an icon name, an attribute or a URL — and it is NOT
an identity: `model_announced` remains the authority on which model is running, and this string is
descriptive text beside a token count.

**THE READING IS INFORMATIONAL: no range check and no cross-field check on any of the three integers.**
The daemon neither recomputes nor normalizes claude's figures, so nothing may assume `percentage` is
derivable from `total_tokens` and `max_tokens` — a client that recomputed it would disagree with the
figure claude reported, which is the whole reason this frame displaces the transcript route. A
`percentage` over 100, a `total_tokens` exceeding `max_tokens`, a `max_tokens` of `0` beside a non-zero
total, and a negative are all ordinary, undecoded-rejecting traffic; a table of exactly those cases pins
the no-range-check posture in the tests. `requireNumber` checks the type, not truthiness, so `0` survives
as `0` — precisely what the daemon's committed `context_usage_empty.json` fixture carries for all three
integers, alongside `''` for every string via the same posture in `requireString`. The unguarded-
`Infinity` hazard a `max_tokens` of `0` creates is a RENDER concern, already documented on the renderer's
`contextUsagePercent`, and does not belong at this boundary.

**Takes no `FrameTimestamp`**, the `thinking_progress`/`rate_limited` precedent — the mix-in marks exactly
the arms `decodeHistoryEvent` draws, and this kind gains no arm there (a regression pin: even a fully
well-formed stored `context_usage` still skips). Content-free-logged as `inbound-decoded(code:
'context_usage')` before the `default` branch; neither `conversation_id`, `model`, any row's `name`,
`server_name`, `path` or `type`, nor any of the three integers ever reaches a log line — `model` and every
row's `name`/`type` are unsanitized claude-influenced text that would otherwise land in a file whose
readers assume it is machine-written, every `server_name` is workspace-configuration disclosure, every
`path` names the operator's own filesystem (the strongest such ground on the frame), and the three
integers disclose how much private work is in the window, a side-channel as unwelcome as the correlating
`conversation_id` beside them. That is strictly safer than the `default:` arm it replaces for the type,
which logged the wire-supplied `envelope.type`. Ships dormant, the same two-step already taken for
`question_shown` (#884/#885), `modal_shown` (#870/#871) and `thinking_progress`/`rate_limited`
themselves: `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops here until the
carry slice claims it. Decode spanned four slices replacing #1254's first criterion, on the
`rate_limited` precedent: the reading (#1454), the category breakdown (#1455), the MCP-tool inventory
(#1459) and the memory-file inventory (#1460) — after which every key the daemon writes is declared and
read — then IPC carry #1419, store #1420, surfaces #1421 — #1254 is re-cut to the popover alone.
Architect (builder) self-review PASS, no MUST FIX findings for #1460.

[#1514](https://github.com/pyrycode/pyrycode-desktop/issues/1514) extended it once more, additively, with
`resetting` → `{ kind: 'resetting', resetting: ResettingPayload }` via `parseResettingPayload` — which
phase of a session reset a conversation is in (pyrycode#2453 shape / #2478 producer,
`internal/protocol/interactive.go` `ResettingPayload`). Joins the status-peer cluster right after
`compacting` in both the `EnvelopeType` union and the interface order, sharing its two-edge,
conversation-scoped, turn-opening-and-closing-neither shape — but the provenance runs the other way:
`stall`/`api_retry`/`compacting` report what CLAUDE is doing, this reports what the DAEMON is doing TO
claude, and every field on the frame is the daemon's own rather than a value claude authored.

**That reversed provenance is why this decoder narrows where its neighbours don't.** `WireResetPhase`
(`'wrapping_up' | 'restarting' | ''`) and `WireResetHandoff` (`'pending' | 'written' | 'skipped' | ''`)
are two closed wire enums, `parseSessionTransitionPayload`'s `reason` idiom cloned once per token — a
comparand chain covering non-string and unknown-string alike, narrowing without a cast — where
`RateLimitedPayload`'s `status`/`limit_type` one screen over deliberately stay open precisely because
those *are* claude's. **`''` is inside each union, not bolted on as `| ''`, and is admitted
unconditionally on both fields regardless of `active`.** The daemon declares no `omitempty`, so every
key is always on the wire and `''` is its declared zero value once a reset ends; a chain admitting only
the named tokens would reject every falling edge and leave an indicator nothing can clear. Gating the
token set on `active` would be cross-field validation, which this decoder family refuses by name
(`parseQueuedItem`'s posture), so `active: true` with `phase: ''` — a pair the daemon's three emitted
rows never produce — decodes rather than throwing: rejecting an unobserved combination would fail-close
a daemon that later adds a phase or reorders its edges. `requireBoolean` checks `active`'s type, never
truthiness, since `false` *is* the falling edge rather than an absence.

**A closed union is not a trust upgrade, and this frame is where that distinction had to be spelled out
explicitly rather than inherited.** Narrowing here makes both tokens' *shape* trusted, never a claim
that the daemon is honest: a hostile daemon can still send any of the sixteen field combinations, not
only the producer's three, so a consumer (#1515) must handle all of them and must never branch
security-relevant behaviour on either token. `handoff: 'written'` names no path — nothing downstream can
resolve, open or join one — and `conversation_id` is a daemon-asserted routing key, never an
authorization signal.

**Takes no `FrameTimestamp`, unlike the immediately neighbouring `compacting` arm** — the nearest
sibling is the wrong half of the family to copy here, since the mix-in marks exactly the arms
`decodeHistoryEvent` draws and `resetting` is ephemeral status with no replay ring or durable history
upstream, so it gains no arm there either (a regression pin: a fully well-formed stored `resetting`
still skips). Content-free-logged as `inbound-decoded(code: 'resetting')` before the `default` branch,
narrowed before the log call so a malformed frame leaves no record at all; neither token nor
`conversation_id` ever reaches a log line. The reason is *not* `rate_limited`'s — both tokens are daemon
constants, not unsanitized claude text — it is workflow disclosure: the id beside a phase and a handoff
status says which conversation the operator reset and whether a handoff was written. Ships dormant, the
same two-step already taken for `question_shown`/`modal_shown`/`rate_limited`/`context_usage`:
`daemonConnection.ts`'s inbound switch has no catch-all, so the report stops here until #1515 claims it.

Out of scope here, named for the carry slice rather than silently deferred: a consumer must not rely on
the falling edge arriving, since a daemon that crashes or is killed mid-reset sends no `active: false`,
and nothing at this decode boundary can supply the independent clearing path (disconnect, conversation
exit, turn activity) that a stuck indicator would need. Architect (builder) self-review PASS, no MUST
FIX findings; one SHOULD FIX recorded for #1515 — handle all sixteen combinations rather than only the
three the producer emits, since a narrowed value is still a claim by a peer.

[#1489](https://github.com/pyrycode/pyrycode-desktop/issues/1489) added a new kind, `mcp_status` →
`mcp-status` — claude's MCP server list for one conversation, published live and as the answer to
`mcp_status_request` (correlated by `in_reply_to`, not yet declared on this side). Two new parsers:
`parseMCPServerStatus` (the row) is `parseContextUsageMCPTool`'s structure scaled to five plain
`requireString` fields in wire order (`name`/`status`/`error`/`scope`/`version`), and
`parseMCPStatusPayload` (the frame) is `parseContextUsagePayload`'s list shape over a single
inventory — an `isRecord` gate, `requireString` for `conversation_id`, an `Array.isArray`-then-`.map`
guard on `servers`, a plain `requireNumber` for `dropped_servers` — returning a fresh three-field
literal. `servers` is never `null`: the daemon's `MarshalJSON` normalises a nil slice to `[]`, so an
empty array is the positive report that claude has no servers, while `null`/absent/non-array fails the
whole frame closed. `dropped_servers` is copied from the producer and never reconciled against the
retained length — `servers.length + dropped_servers` is the original size, and the daemon's entry cap
is not a wire constant, so no client-side cap is added. One malformed row drops the whole frame rather
than yielding a partial list.

**All five row fields are always present, and `''` is a value on every one of them** — a missing or
zero-valued source string encodes as `''` daemon-side, so `requireString` is used throughout, never
`requireNonEmptyString`: nothing here is a lookup whose emptiness would signal a failure. `status` and
`scope` are claude's open-set claims, never closed enums — the daemon states the value set is
unmeasured beyond the handful the fixture and the ticket forecast, so narrowing either would fail-close
a future release's new word, the `rate_limited`/`status` precedent applied a second time. `version` is
opaque and never semver-parsed (the fixture's `2.0-beta` exists to prove exactly that). `error` carries
a 256-byte producer cap, a size bound and not sanitisation.

**`name`'s provenance inverts `ContextUsageMCPTool.server_name`'s, and the row parser's docblock says so
rather than copying that field's inertness doctrine across.** `server_name` names a contributor to a
*reading* and is never an actuation target; here `name` **is** the server list's own identity, and a
later slice may legitimately carry it into an MCP actuation verb (`mcp_reconnect`/`mcp_toggle`), where
the daemon gates per device and the actuation seam is its sole validator. What still binds on this side
is the client-side rule only: a `name` is never a lookup key, a React key, a `Map` index or a
plain-object key (`__proto__` is an ordinary server name here), a path, a filename or a cache key. Every
row string crossed the subprocess trust boundary and is neither validated nor sanitised upstream —
inert text, escaped at the render sink, never fed to an HTML sink, an attribute or a URL. The fixture's
`remote<&>` name and the embedded newline in `dial refused\nretry?` cross byte-for-byte, which is also
why no row string may reach a log field: the diagnostic stream is line-delimited JSON, and a logged
value could forge a record.

Content-free-logged as `inbound-decoded(code: 'mcp_status')` before the `default` branch, narrowed
before the log call so a malformed frame leaves no record; neither a row string nor `conversation_id`
ever reaches a log line. Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent` — the
`context_usage`/`rate_limited` precedent, since this type has no replay ring or durable history
upstream. Ships dormant, the same two-step already taken for `question_shown`/`modal_shown`/
`rate_limited`/`context_usage`/`resetting`: `daemonConnection.ts`'s inbound switch has no catch-all, so
the list stops at this boundary until the carry slice (#1490) claims it. Architect (builder) self-review
PASS, no MUST FIX findings. A lesson from the build: the row parser's docblock must state the inverted
provenance explicitly, since copying `parseContextUsageMCPTool`'s structure without also copying its
prohibition-on-actuation clause would otherwise read as though it had been copied too.

[#1619](https://github.com/pyrycode/pyrycode-desktop/issues/1619) added a new kind, `attachment_offered`
→ `{ kind: 'attachment-offered', attachmentOffered: AttachmentOfferedPayload }` via
`parseAttachmentOfferedPayload` — the daemon's announcement that claude sent the operator a file via its
`send_file` tool (pyrycode#2165 tool / #2166 producer), decoding `docs/protocol-mobile.md` § Attachments'
`attachment_offered` frame. Mobile already decoded this frame (pyrycode-mobile#898); this is the desktop
catch-up. `AttachmentOfferedPayload{conversation_id, attachment_id, filename}` follows
`parseResettingPayload`'s isRecord-gate-then-`requireString` shape — three always-present fields, no
optional — rather than `parseAttachmentStoredPayload`'s single-field shape, since none of the three
fields here is a correlation handle the way `attachment_stored`'s lone `attachment_id` is.

**This is the boundary's first production check of a UUIDv4 shape**, and the reason none of the file's
existing guards could be reused is itself the finding worth recording. `isAttachmentIdList`
(`src/shared/ipc/commands.ts`) checks only that a string is non-empty; `CANONICAL_ATTACHMENT_ID`
(`src/main/attachmentPath.ts`) is a looser path-safety alphabet built to keep a value out of a filesystem
join, not to assert it is a UUID. Neither guard's job is "is this the shape the daemon mints," so a new,
module-private `ATTACHMENT_ID_UUID_V4` regex
(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`) does that job instead of
widening either existing one — tightening `isAttachmentIdList` or `CANONICAL_ATTACHMENT_ID` to match was
explicitly declared out of scope, since both guards still have callers whose contract does not want a
UUID-only restriction. The regex carries no `i` flag, so an uppercase id is rejected rather than
normalized, and it is anchored on both ends with fixed-width quantifiers and no nesting, so it cannot
backtrack catastrophically. The security review flagged this anchoring and case-sensitivity explicitly
and asked that it be pinned by test rather than left to the pattern alone; the suite covers uppercase, a
trailing newline (JS `$` without the `m` flag matches only at end of input, so a bare regex mistake here
would have silently accepted one) and a leading space.

**`conversation_id` is a daemon-asserted routing key, not an authorization signal** — the frame is
broadcast to every attached client, so a consumer filters on it rather than trusting it as proof the
operator's own conversation is the one being addressed, the same posture every other daemon-asserted id
on this boundary already carries. **`filename` is claude-authored display text**, required non-empty and
capped at 255 UTF-8 bytes via `Buffer.byteLength(filename, 'utf8')` — the file's existing multibyte-safe
idiom (`TurnEndPayload`'s stopped-turn reports use the same measure), not a character count, so a
256-byte multibyte string whose character count is under 255 still rejects. It is never used as a path,
a lookup key or a cache key by this decoder, and it never reaches a log line on either the accept path
or the drop path — each pinned by its own test. **What this slice deliberately does not do**: sanitize
`filename` for display. A hostile or buggy `send_file` call can put control characters, a bidi override
(an RLO spoofing a false extension), path separators or a NUL byte into the string, and none of that is
neutralized here — the security review named this explicitly as out of scope, deferred to the render
slice of the #1617 family, which must bound and neutralize the string for display and must never let it
reach an attribute, a URL, a filename or a log.

**Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent`**, the `resetting`/`mcp_status`
precedent: the frame is live-only, with no replay ring or durable history upstream. Content-free-logged
as `inbound-decoded(code: 'attachment_offered')` before the `default` branch, narrowed before the log
call so a malformed frame leaves no record; neither `filename` nor `conversation_id` ever reaches a log
line. Ships dormant: `daemonConnection.ts`'s inbound switch has no case for `'attachment-offered'` yet,
and its inner switch has no `assertNever`, so the new kind compiles unconsumed rather than failing the
build — the IPC carry and the render are later slices of the #1617 family, out of scope here. Architect
(builder) self-review PASS, no MUST FIX findings.
