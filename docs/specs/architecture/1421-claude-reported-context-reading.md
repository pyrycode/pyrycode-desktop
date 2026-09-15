# #1421 — the context reading and the gauge take claude's own figure

## Files read

- `src/renderer/src/screens/conversation/contextUsage.ts` → `contextUsagePercent`, `contextUsageStep` —
  the ONE clamp and the ONE severity ladder both surfaces keep going through. Its header states the leaf
  discipline (no imports at all, so it cannot join the import cycle `runConfigLive` documents) that the new
  module inherits verbatim.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ContextUsageControl` (the private
  store-bound container), `ContextUsageReading` (the exported pure view), `NO_USAGE_LIMIT_READING` /
  `NO_TASK_ROSTER` (the hoisted no-conversation selector constants this ticket adds a third of), and the
  `composer__footer` row where every sibling control already takes `conversationId` as a prop.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `RunConfigSections` (the container, which
  already holds the `useMemo`-stable per-id selector idiom twice), `RunConfigView` (documented
  props-in/markup-out), `ContextWindowSection` (the gauge), `abbreviateTokens`.
- `src/renderer/src/store/reportedContextStore.ts` → `selectReportedContextFor`, `useReportedContextStore`,
  `ReportedContextReading`. Its `selectReportedContextFor` docblock states the absent-vs-degenerate-present
  rule this ticket's third criterion is the consumer of, and names this ticket as the surface that must
  branch rather than collapse.
- `src/renderer/src/store/runConfigStore.ts` → `selectSnapshot` — the settings pair that becomes the
  fallback; unchanged.
- `src/main/transport/inboundMessage.ts` → `parseContextUsagePayload`, `requireNumber` — what the six
  integers were and were not checked for before they reached the store (nothing but `typeof === 'number'`).
- `src/shared/ipc/events.ts` → the `contextUsage` arm's docblock — the provenance split (`conversationId`
  daemon-authored, everything else claude- or workspace-authored) and the never-allocate-from-a-figure rule.
- `src/renderer/src/store/reportedContextBridge.ts` → `translateContextUsage`, and `App.tsx`'s
  `ReportedContextData` mount — proof the write half is already live, which is what makes the e2e drive
  possible without new wiring.
- `e2e/composer-context-severity.spec.ts` — the fake-tier template for driving a turn edge and reading
  `.composer__context`; the new spec is its sibling, one frame further along.
- `docs/knowledge/features/reported-context-store.md` § the read surface — why the module is named for the
  reading rather than for the usage, and why the nullable return is the whole contract.
- `docs/knowledge/features/conversation-shell-run-configuration.md` § Context window — the gauge's history:
  the percentage moved out to `contextUsagePercent` at #811 so two surfaces could not drift.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=110-3497 (footer reading),
node 20-151 (run-configuration gauge).

The footer reading is a single short text run, `Context: 84%`, in the composer footer row. The gauge is a
header-plus-body block: one line reading `73% used (146K of 200K tokens)`, a full-width rounded track with a
green fill at that fraction, and a two-line explainer below in the muted body style. **No visual change in
this ticket** — both renderings already ship exactly as drawn, and only which two integers feed them moves.
The gauge screenshot is the evidence for the second criterion's consistency demand: 146K of 200K reads 73%,
so the percentage, the numerator and the denominator in 20:152 are three views of one pair and must stay so.

## Context

`ContextUsageControl` and `ContextWindowSection` both derive their figure from `runConfigStore`'s
`usedTokens` / `windowTokens`, which come from the daemon's transcript scan. That route reads 0% for any
conversation opened in a workspace (pyrycode#2423) and guesses the window until a turn ends. #1420 landed
claude's own reading per conversation and shipped it dormant; this is the first surface to read it.

The change is a **source swap, not a computation change**. Both surfaces keep going through
`contextUsagePercent` and `contextUsageStep`, computed from claude's `totalTokens` / `maxTokens` rather than
from its `percentage` field, so the clamp, the finiteness guard and the severity ladder stay the one
computation. Claude's `percentage` is held by the store and deliberately not displayed — the wire contract
says a client that recomputes disagrees with the figure claude reported, and this ticket recomputes anyway
to keep one clamp across two surfaces. That contradiction is deliberate and recorded on the ticket; do not
flip it on reading `ContextUsagePayload`'s docblock.

No ADR is warranted: the decision this encodes ("claude's figure is the display source, the transcript route
is the fallback pending a later retirement") is already recorded on the ticket and in
`reportedContextStore`'s header.

## Design

### The new leaf module — `screens/conversation/contextTokenSource.ts`

One exported function and one exported type. It answers exactly one question — *which pair of integers do
the surfaces render?* — and answers it for both, so the two cannot disagree for one conversation.

```ts
export interface ContextTokens { usedTokens: number; windowTokens: number }

export function contextTokenSource(
  reported: { totalTokens: number; maxTokens: number } | null,
  settings: ContextTokens | null
): ContextTokens
```

Behaviour, in full:

- `reported !== null` → `{ usedTokens: reported.totalTokens, windowTokens: reported.maxTokens }`. The
  branch is on **presence alone**. No test of either figure, no truthiness, no `maxTokens > 0` term — a
  present reading whose maximum is zero stays the winner and resolves downstream to the unavailable state
  each surface already ships, because `contextUsagePercent(_, 0)` returns `null`. That is the third
  criterion, and making it structural (the only branch is `=== null`) is what stops a later edit from
  quietly re-reading a zero as an absence.
- `reported === null` → `{ usedTokens: settings?.usedTokens ?? 0, windowTokens: settings?.windowTokens ?? 0 }`
  — `RunConfigSections`' shipped coalescing verbatim, now written once instead of at each surface.

Three deliberate shapes:

1. **No imports at all**, `contextUsage.ts`'s discipline. The first parameter is the structural minimum
   `{ totalTokens, maxTokens }` rather than `ReportedContextReading`, so the module neither imports from the
   store nor can join the import cycle `runConfigLive` documents. A `ReportedContextReading` satisfies it
   structurally, and a rename of either field still fails to typecheck at the call site.
2. **A freshly built pair on both arms**, never the argument returned by reference. The `settings` argument
   is a `RunConfigSnapshot`, which also carries `model` — a daemon-supplied string. Rebuilding the pair is
   what guarantees nothing but two integers leaves this function, so no consumer can reach a string through
   a value typed as a token pair.
3. **A pair, not two functions.** The consistency guarantee is that the numerator and the denominator come
   from the same source in the same pass; two independent resolutions could each pick a different winner.

### Footer — `ContextUsageControl` in `ConversationScreen.tsx`

Gains `conversationId: string | null` as a **prop**, joining every sibling in the `composer__footer` row
(`ComposerActionsMenu`, `ComposerPermissionModeMenu`, `ComposerModelMenu`, `ComposerEffortMenu`,
`EffortDefaultData`), all fed from the `activeConversationId` already in scope at that row. Not a fifth
store read.

It then reads the reading through a `useMemo`-stable selector per id, resolves the pair, and passes the two
integers into the untouched `ContextUsageReading`:

- selector: `conversationId === null ? NO_REPORTED_CONTEXT : selectReportedContextFor(conversationId)`,
  with `NO_REPORTED_CONTEXT` a hoisted module constant beside `NO_USAGE_LIMIT_READING` and `NO_TASK_ROSTER`
  and typed exactly as `selectReportedContextFor`'s return — a closure built inline would be a fresh
  identity every render, which `useSyncExternalStore` answers with a re-subscribe per render for a value
  that is always the same `null`.
- `useMemo` on `[conversationId]` (the `RunConfigSections` idiom) rather than the bare conditional
  `UsageLimitControl` uses: that one re-derives anyway because `nowSeconds` moves, and this one does not.

`ContextUsageReading` itself — its markup, its three renderings, its copy and the ladder — is **untouched**.

### Gauge — `RunConfigSections.tsx`

`conversationId` is already a prop. A third instance of the container's existing `useMemo`-stable per-id
selector idiom (the announced model and the model list are the first two) reads the reading; the container
resolves the pair and passes it down as the existing `usedTokens` / `windowTokens` props.

`RunConfigView` stays props-in/markup-out with primitive props, and `ContextWindowSection` is **untouched**.
That is what keeps the roughly hundred assertions in `RunConfigSections.test.tsx` and the no-mock server
render intact — and it is also how the second criterion's *internal* consistency falls out for free: the
section derives its percentage from the same two integers it abbreviates into `(X of Y tokens)`, so a single
winning pair makes the drawn triple consistent by construction rather than by three agreeing edits.

### Data flow

```
daemon context_usage frame
  → inboundMessage.parseContextUsagePayload → DaemonEvent 'contextUsage'
  → reportedContextBridge.translateContextUsage → reportedContextStore (keyed by conversationId)
  → selectReportedContextFor(openId) ─┐
                                      ├→ contextTokenSource → { usedTokens, windowTokens }
runConfigStore.selectSnapshot ────────┘        │
                                               ├→ ContextUsageReading  (footer)
                                               └→ ContextWindowSection (gauge)
```

## State + concurrency model

No new store, no new slice, no new async work, no new subscription lifecycle. Two additional narrow-slice
zustand reads through the existing `useReportedContextStore` binding, each keyed by one conversation id.

Re-render correctness is inherited rather than invented: `selectReportedContextFor` returns the **held
record itself** or `null`, both stable references, so a write for another conversation leaves this one
`Object.is`-identical and wakes neither surface. A verbatim repeat for *this* conversation does produce a
fresh record identity and so re-renders — anticipated and stated by the store, and harmless here because
both surfaces render the same markup from the same figures. The `useMemo` on the selector is what keeps the
subscription itself from churning.

There is nothing to cancel and nothing to tear down: both reads are pure render-body reads with no effect.

## Error handling

No result type and no new failure mode — this path has no I/O. The whole of its "error handling" is the
absence contract and the arithmetic guard, both already typed:

| State | Where it resolves | What renders |
|---|---|---|
| No frame has arrived for this conversation | `selectReportedContextFor` → `null` | the settings-derived figure, exactly as today |
| No conversation open | `NO_REPORTED_CONTEXT` → `null` | same fallback, through the same path, with no invented key |
| Reading present, `maxTokens > 0` | `contextTokenSource` → claude's pair | claude's figure on both surfaces |
| Reading present, `maxTokens === 0` | `contextUsagePercent` → `null` | footer renders nothing; gauge renders `Context usage unavailable`. **No fallback.** |
| Reading present, `maxTokens` non-finite | `contextUsagePercent`'s `Number.isFinite` term → `null` | same unavailable state; no `NaN`, no `width: NaN%` |
| Settings snapshot not yet loaded | `contextTokenSource`'s `?? 0` | `windowTokens: 0` → the same unavailable path |

## Testing strategy

**Unit — `contextTokenSource.test.ts` (new, the fourth criterion's named three plus their neighbours):**
a present reading wins; an absent reading falls back to the settings pair; a present reading with
`maxTokens: 0` still wins and is *not* replaced by a non-zero settings pair (the criterion's sharp edge —
seeded so a fallback would be visible as a real percentage); a `null` settings argument coalesces to the
zero pair; the returned object is a fresh pair carrying only the two fields.

**Renderer — `ConversationScreen.test.tsx`:** through the mounted screen, with the `getInitialState` spy
idiom the file already uses for `runConfigStore` (zustand v5 reads `getInitialState()` under
`renderToStaticMarkup`, so a `setState` seed is invisible), staged over `stageOpenConnection`'s open
conversation. Three cases: the reading's percentage displaces a *different* settings-derived percentage;
absence leaves the settings-derived percentage standing (the shipped test already covers this arm and must
keep passing untouched); a present reading with `maxTokens: 0` renders no reading at all even with a
non-zero settings pair seeded.

**Renderer — `RunConfigSections.test.tsx`:** a module-level `vi.mock` of `reportedContextStore` overriding
only `useReportedContextStore` onto a seeded `createReportedContextStore()` instance, keeping
`...importActual` for the selector — the file's existing `modelListStore` mock shape, and the shape the
store's own docblock prescribes. Two cases: the gauge's percentage **and** both abbreviated figures come
from the reading (one assertion on the whole `N% used (X of Y tokens)` line, so the triple cannot be
consistent in the percentage alone); a present reading with `maxTokens: 0` renders `Context usage
unavailable` rather than the settings figure.

**e2e — `e2e/composer-context-claude-reading.spec.ts` (new, fake tier, the fifth criterion):** the
`composer-context-severity.spec.ts` template. Answer `request_session_settings` with a settings pair whose
percentage is unique, drive a `turn_state` thinking → idle pair, assert the footer shows the
settings-derived text, then push one `context_usage` frame carrying claude's own figures for the seeded
conversation and assert the footer text changes to claude's. Both texts are unique, so neither can be
satisfied by the other's reading. The standing fake-tier rule is kept: every frame is one production
produces — `session_settings` in reply, `context_usage` fanned out unprovoked after a turn end.

No new DOM environment, no testing-library, no new dependency.

## Documentation handoff

The ticket body has no **Documentation handoff** section and no documentation-only acceptance criterion.
Nothing in `docs/knowledge/` is edited by this ticket. Two overviews will want folding by the documentation
stage — `docs/knowledge/features/reported-context-store.md` (its read surface now has its first consumer)
and `docs/knowledge/features/conversation-shell-run-configuration.md` § Context window (the gauge's source
changed) — **pending, for the documentation stage**, not this one.

## Open questions

1. Does the fake-tier launch path gate `context_usage` behind a daemon capability the seeded pairing does
   not advertise? If it does, the e2e seeds the capability rather than inventing a frame. Resolve in Phase B
   against `launchPairedApp` / `fakeDaemonSetup`; record under `## Revisions` if it moves the design.
2. Does `vi.mock`ing `reportedContextStore` at module scope in `RunConfigSections.test.tsx` disturb any
   existing assertion in that file? Expected not — the only render with a seeded id asserts model labels,
   and the `conversationId={null}` render selects nothing through `NO_REPORTED_CONTEXT`. Verify by running
   the file whole.

## Revisions

**2026-09-15 — both Open Questions resolved, no design change.**

1. **Fake-tier capability gate:** there is none on the inbound side. The `context_usage` frame is decoded
   and fanned to `reportedContextBridge` unconditionally — the fanout gate is the daemon's, not the
   client's — so the e2e pushes the frame with no seeded capability and no new fixture wiring.
2. **Module-level `vi.mock` of `reportedContextStore` in `RunConfigSections.test.tsx`:** disturbs nothing.
   All 100 assertions in that file pass unchanged; the `conversationId={null}` render selects nothing and
   the seeded-id render asserts only model labels.

One implementation-time simplification, recorded because it departs from the plan's Design text: the plan
specified a hoisted `NO_REPORTED_CONTEXT` constant for the no-conversation arm, beside
`NO_USAGE_LIMIT_READING` and `NO_TASK_ROSTER`. It is not needed and was not written. Those two exist
because their reads have no `useMemo` and so would rebuild the closure every render; both of this ticket's
reads are inside a `useMemo` keyed on `[conversationId]`, which already gives the closure one identity per
id. Both call sites therefore use the inline `() => null` form — which is `RunConfigSections`' own shipped
idiom for exactly this arm, at the announced-model and model-list selectors beside it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary, and the existing one is explicit and upstream: every integer on
  this path crossed `parseContextUsagePayload`, which admits them through `requireNumber` — a bare
  `typeof === 'number'` with **no range check in either direction**, by documented contract. So this design
  must assume `totalTokens` and `maxTokens` are arbitrary, possibly negative, possibly larger than
  `Number.MAX_SAFE_INTEGER`, and possibly `Infinity` (`JSON.parse('1e999')` yields it, notwithstanding the
  narrower's comment). The design holds them behind `contextUsagePercent`'s `Number.isFinite(windowTokens)`
  term and its `[0, 100]` clamp, which is exactly where the shipped transcript-route figures are already
  held — the source swap adds no unguarded arithmetic, because `contextTokenSource` performs none. `NaN` is
  genuinely unreachable: `JSON.parse` cannot produce it and `requireNumber` rejects every non-number.
- **[Trust boundaries — provenance]** The `contextUsage` arm mixes provenance field by field, which is the
  fact most likely to be got wrong here. This design touches **only `totalTokens` and `maxTokens`**. It
  reads no `model`, no category `name`, no `server_name`, no `path`, no `type` — none of the
  claude-/workspace-authored strings — and `conversationId` is used **only as a map key for a lookup**, in
  `selectReportedContextFor`, never rendered, never joined, never a React key, never a path segment. The
  `contextTokenSource` design decision that makes this structural rather than conventional is finding-driven
  and stated in the Design section: the function rebuilds a two-integer pair on both arms rather than
  returning its `settings` argument by reference, so a `RunConfigSnapshot`'s `model` string cannot ride out
  through a value the caller has typed as a token pair.
- **[DOM sinks]** Two sinks receive a value derived from these integers, both **inside** the
  `pct !== null` branch and therefore both downstream of the finiteness guard and the clamp: the gauge's
  inline `style={{ width: \`${pct}%\` }}` and its `aria-valuenow={pct}`. Both take `pct`, never a raw
  figure, so the worst reachable value is the integer `100`. No raw daemon integer reaches an attribute, a
  URL, a class name, a filename or a cache key. Neither surface uses `innerHTML` or
  `dangerouslySetInnerHTML`, and this ticket adds no markup at all.
- **[DOM sinks — the text line]** *Noted, not a finding.* The gauge's `(X of Y tokens)` line renders raw
  figures through `abbreviateTokens`, as inert text. `windowTokens` there is always finite and positive
  (the branch guard). `usedTokens` is not guarded, so a hostile `total_tokens` of `1e999` would render
  `100% used (InfinityK of 200K tokens)` — visually odd, arithmetically honest, and **not exploitable**:
  no allocation, no iteration, no sizing, no attribute. This is the shipped behaviour of the transcript
  route as well, so it is pre-existing rather than introduced; per scope discipline it is not fixed here and
  no defence is shipped for an unobserved failure. If it is ever observed, it belongs in `abbreviateTokens`
  as its own ticket.
- **[Never allocate from a figure]** The arm's sharpest rule, and the design complies structurally: nothing
  on this path constructs an array, runs a loop, sets a timer, sizes a buffer or indexes anything from any
  of the six integers. `contextTokenSource` copies two numbers; `contextUsagePercent` divides, rounds and
  clamps. The three inventories and the three dropped counts are not read at all by this ticket.
- **[Tokens, secrets, credentials]** Not applicable, and structurally so: this is renderer-side view
  derivation over two integers already held in a renderer store. No token, key, credential or secret is
  read, written, compared or stored, and nothing reaches `safeStorage` or disk.
- **[File / storage operations]** Not applicable — no filesystem access, no path construction, no
  persistence. `path`-typed fields exist on the arm and are deliberately never read (above).
- **[Inter-process / Electron attack surface]** No change. No `contextBridge` API, no `ipcMain` channel, no
  `webPreferences`, no protocol handler, no navigation, and no new IPC message shape. The transport stays in
  the background process; this ticket adds no renderer capability whatsoever.
- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no comparison against a secret,
  no Noise surface touched.
- **[Network & I/O]** No socket, no fetch, no timeout, no reconnect. The frame that feeds this path is
  already decoded, size-capped and rate-shaped upstream; this ticket consumes a store, not a wire.
- **[Error messages, logs, telemetry]** **Nothing on this path is logged, on any branch** — this design adds
  no log call, and that is deliberate rather than incidental: `reportedContextBridge`'s header records that
  the three integers disclose how much private work is in the window. No thrown error either, so nothing
  from this path can reach a stack trace or a crash reporter. The one error-adjacent surface left alone is
  the four exhaustive bridges' `assertNever` guard, which stringifies the whole event — untouched here.
- **[Concurrency]** No async work, no effect, no listener, no timer, no `AbortController`, nothing to tear
  down. The one check-then-act shape a reader might look for — reading the reading and the settings snapshot
  separately, then combining them — is not one: both are render-body reads in a single synchronous pass, and
  the pair is resolved atomically by one function, which is precisely why the second criterion's
  "cannot disagree" guarantee holds.
- **[Threat model — hostile daemon]** The realistic attack is a daemon that reports a flattering or alarming
  context figure. That is **accepted by design**: the reading is informational, nothing branches on it, and
  no security-relevant behaviour anywhere reads it. The one thing a hostile figure must not do is corrupt
  the render, and the clamp plus the finiteness guard are what prevent that.
- **[Threat model — renderer compromise]** Unchanged. This ticket grants the renderer no new reach; a
  compromised renderer gains nothing from a two-integer view derivation it could not already read from the
  store.
- **[Threat model — out of scope]** The retirement of the transcript route (the ticket's own "later
  cleanup") and #1254's breakdown popover, which renders the untrusted **strings** on this arm and therefore
  carries a materially larger inert-text obligation than this ticket does. Both are named on the ticket and
  neither is touched here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
