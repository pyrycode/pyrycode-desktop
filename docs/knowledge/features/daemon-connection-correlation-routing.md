# Correlation routing (#1119)

Split out of [Daemon connection — per-server routing](daemon-connection-routing.md) 2026-09-07 to keep that document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links. Sibling of [Conversation routing (#1118)](daemon-connection-conversation-routing.md), which this section's own first heading contrasts itself against.

\#1118 closed routing for the ten commands that carry a `conversation_id`. Five remained on
`registry.active`: `answerModal`/`cancelModal` (keyed by `modal_id`), `answerQuestions`/
`refuseQuestions` (keyed by `question_batch_id`), and `setSessionSettings` (keyed by the daemon's own
`session_id`). None of these carries a `conversation_id` — ADR 0009 rules that no `conversation_id`
rides an ANSWER, since the daemon resolves the correlation id against its own outstanding state — so
\#1118's index cannot route them, and with two servers paired an answer minted for host A's modal could
land on host B's wire. `createCorrelationRouter` (`src/main/correlationRouter.ts`) closes this for all
five, resolving each correlation id to the server that minted it — read off the stamped `modalShown` /
`questionShown` / `runConfigReceived` / `sessionSettingsUpdated` / `sessionTransition` events, never a
hint the renderer supplies (the renderer can name an id, never a server).

## A sibling module, not a fourth map in `conversationRouter.ts`

Same observation point as #1118 — nested in the `sink:` position `createConnection` builds
(`sink: correlations.observe(router.observe(live.sink))`), under `bindServerOrigin` — but a **separate
module**, because the two indexes have opposite lifetime rules. #1118's conversation index only ever
grows: a conversation stays nameable for the process lifetime. A modal ends at `modalDismissed` /
`modalAnswerRejected` and a question batch at `questionDismissed`, and a long session raises many of
both, so a map that only grows here would leak over a multi-day run. `sessions` has no settle event and
inherits #1118's grow-and-cap posture unchanged.

Three module-local `Map<string, string>`s (id → server id) — never a bare object, the same `__proto__`
reasoning `conversationRouter.ts` states for its own map.

| Index | Learns from | Forgets on |
|---|---|---|
| `modals` | `modalShown.modalId` | `modalDismissed`, `modalAnswerRejected` |
| `batches` | `questionShown.questionBatchId` | `questionDismissed` |
| `sessions` | `runConfigReceived.sessionId`, `sessionSettingsUpdated.sessionId`, `sessionTransition.newSessionId` | *(nothing — grow + cap, #1118's posture)* |

`''` is never learned in any space — for `sessions` this is AC3 (a `session_id` of `''` means "no
session resolved," not an address); the same guard covers the other two for free.

**Since [#1176](https://github.com/pyrycode/pyrycode-desktop/issues/1176), `runConfigReceived` itself
only fires for a correlated `session_settings` reply** — `daemonConnection.ts` now drops an
uncorrelatable one before emitting anything, so `sessions` also learns nothing from it. Accepted, not a
regression: a session id this client cannot tie to a request it sent is exactly the input this index
must not accept. `conversationId`, the field #1176 added to the event, is read by nothing here —
`sessions` keys on `sessionId` alone.

## Last write wins — and the reason is not #1118's

\#1118 argues last-write-wins from conversations that genuinely move hosts. A live modal id or question
batch does not move hosts — `serverId` is the paired host's own stable identifier — so the first draft
made the two settling spaces **first-write-wins**, on the theory that a second server claiming a live
nonce is anomalous and should be refused. The security review rejected this as a MUST FIX: both
renderer stores (`modalPrompts.ts`, `questionBatches.ts`) are match-and-replace on a re-delivered id, so
first-write-wins would let the operator read host B's re-delivered title/prompt/options while the
answer still routed to host A — an approval attributed to a prompt they never saw. Last-write-wins keeps
the index and the screen agreeing, which the security review generalised: *an index that disagrees with
the store the operator is reading is more dangerous than one that obeys an anomalous re-point.* What
actually closes the cross-host case is origin-checked eviction (below) plus the unguessability of the
ids, not the write rule.

A re-point that actually changes the owner logs a content-free `<kind>-reindexed`/`reassigned`; an
identical re-write logs nothing.

## Origin-checked eviction

`forget(index, id, serverId)` deletes only when the held owner equals the stamped origin — the one rule
\#1118 has no equivalent for, since nothing there evicts. Without it, a second paired host could retire
host A's outstanding modal by echoing its id in a `modal_dismissed` frame: a cross-host denial of the
operator's own prompt. A settle frame from the wrong host is a no-op instead.

## The three routing calls, and the two refusals

`routeModal`/`routeQuestions`/`routeSession` share one `resolve` body, on #1118's own two-branch shape:

1. Id absent (never learned, settled, or over cap) → `null`, logged `<kind>-route-refused
   { code: 'unknown-correlation' }`.
2. Id known but `connectionFor(serverId)` answers `null` → delete the mapping, then `null`, logged
   `<kind>-route-refused { code: 'server-not-connected' }`.

`<kind>` is one of the three static literals `modal`/`question`/`session` — the AC4 "which kind was
refused" requirement, met on both branches without widening `DiagnosticEvent`. There is no fallback,
ever: refusing is the safety property, since a refused command never reaches the connection method that
mints the answer token, so nothing is ever minted on the wrong wire.

The five call sites in `src/main/index.ts` are one-liners in #1118's shape, e.g.
`correlations.routeModal(payload.modal_id)?.answerModal(payload)`.

## Caps, and why the entry cap alone doesn't bound this map

`MAX_INDEXED_CORRELATIONS = 10_000`, per index — #1118's constant, unchanged. But a correlation id,
unlike a conversation id, is bounded only by `MAX_FRAME_BYTES` (256 KiB), so an entry cap alone would
bound each index at ~2.5 GB rather than the ≈1 MB `MAX_INDEXED_CONVERSATIONS`'s own argument assumes.
`MAX_CORRELATION_ID_LENGTH = 512` closes that (real ids are UUID-shaped, 36 characters) — an over-long
id is never learned and fails closed. `conversationRouter.ts` carries the same latent exposure and is
deliberately left alone; noted for whoever revisits it.

## No id ever reaches a log

Every diagnostic call here is a pair of string literals — no template, no interpolation — so a
correlation id is not merely absent from a log line, it is structurally unrepresentable from this
module. This matters most for `question_batch_id`: it is the batch's one-time unguessable nonce, and
`events.ts` rules it must never reach a log; the answer tokens are secrets on the same leg and are
equally excluded. `DiagnosticEvent` gained no new field (it is `{ event, code? }` with no
identifier-shaped member) — widening it would drag the renderer-facing `RendererDiagnosticEvent`
allowlist and its `Omit` pin along, which stayed out of scope.

## `sessionTransition` — added after ship, on a verifier MUST FIX

The first version fed `sessions` from `runConfigReceived`/`sessionSettingsUpdated` only, on the premise
that the run-config store addresses whatever `runConfigReceived` last reported. That premise is false:
every footer control reads `sessionIdStore` (via `selectSessionId`), and that store has **two**
independent writers — `runConfigSnapshot.ts`'s `subscribeRunConfig` (off `runConfigReceived`) and
`sessionIdBridge.ts`'s `subscribeSessionId` (off `sessionTransition.newSessionId`) — with neither
preferred over the other by the store's own docblock.

The gap was reachable on a **single** paired server: after a `/clear`, `sessionTransition` lands a new
session id in `sessionIdStore` while `runConfigSnapshot.ts` leaves the run-config snapshot untouched,
and `runConfigLive.ts`'s refresh trigger fires on only two edges (a rising `connected`, or a
running→idle turn) — neither of which a bare `/clear` produces. In that window, every Model / Effort /
YOLO / permission-mode change resolved against the *old* session id, which the index had never learned
as belonging to the new one, while `submitSettingsChange`'s optimistic overlay had already drawn the
change as applied. The operator would see a change take effect that was never sent.

The fix reads `sessionTransition.newSessionId` as a third learning arm into the same `sessions` map —
safe on every `WireSessionTransitionReason` (the event is stamped; `''` is caught by `learn`'s existing
guard; an `idle_evict` marker mirrors the previous id, so it's an identical re-write that logs nothing).
\#501 (the standing session-id-vs-conversation-id confusion bug) is unaffected: this arm names a
**session** id and lands in the session map only, same as the other two.

## `needs-real-claude`, added against the ticket's own declared scope

The ticket declared itself deliberately not a real-claude ticket — "the new behaviour is per-server
routing, which the real-claude tier cannot exercise at all, its fixture spawns one daemon" — and #1118
shipped the same way. The `sessionTransition` fix invalidated that reasoning for this ticket
specifically: AC3 now depends on a **single-daemon** sequence (`/clear` → `session_transition` → a
footer-control write) that the fake tier has zero coverage for (no run-config spec seeds a
`session_transition`) and that only a live claude session can drive (`/clear` is intercepted
client-side, see CLAUDE.md § Driving a running session). Code review added `needs-real-claude` on pass,
parking the PR for a live confirmation before merge even though the routing design itself needed no
split and no real-claude label by its own original construction. Read this as a standing lesson for the
family: a design that starts out provably single-daemon-safe can stop being so mid-implementation, and
the real-claude label decision belongs at review time, not only at planning time.

Full design, the two design-vs-implementation reversals above, and the security review (PASS, one MUST
FIX resolved on the write rule before ship, one MUST FIX resolved during code review on the session-
learning arm) are in `docs/specs/architecture/1119-correlation-routing-indexes.md`.

