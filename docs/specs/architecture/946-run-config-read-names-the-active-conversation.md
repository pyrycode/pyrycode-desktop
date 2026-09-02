# 946 — the run-config read names the active conversation

Root-cause slice 2 of #941, on top of #945 (merged). #945 gave the outbound
`request_session_settings` frame the ability to name a conversation; this slice supplies the name at
the two renderer sites that ask, and closes the optional command shape #945 deliberately left open.

## Files read

| Path | Symbols that matter | Why it matters |
| --- | --- | --- |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` | `requestRunConfigSnapshot` | The single sender both sites go through — where the id arrives and where the no-active-conversation decision lands |
| `src/renderer/src/screens/conversation/RunConfigData.tsx` | `RunConfigData` | The sheet-open read: one request per open, `requested` ref guard, effect-only `window.pyry` deref |
| `src/renderer/src/screens/conversation/runConfigLive.ts` | `createRunConfigRefreshTrigger`, `subscribeRunConfigRefresh`, `RunConfigLiveData` | The turn-edge refresh; its header and trigger doc both assert the dead daemon-wide contract |
| `src/shared/ipc/commands.ts` | `RendererCommand`, `isRendererCommand`'s `requestSessionSettings` arm, `isRequestSessionSettingsPayload` | The renderer→main contract AC3 tightens; the guard arm that currently accepts an absent and an explicitly-undefined payload |
| `src/main/transport/requestSessionSettingsEnvelope.ts` | `RequestSessionSettingsInput.conversationId` | Its doc promises "Optional only until #946" — a promise that goes stale the moment this lands (AC5) |
| `src/main/index.ts` | the `onCommand` switch's `requestSessionSettings` case | Confirms the main-side chain keeps working unchanged: `command.payload?.conversation_id` simply stops receiving `undefined` |
| `src/renderer/src/store/activeConversationStore.ts` | `activeConversationStore`, `ActiveConversationState.activeConversation` | The id source; a vanilla store safe to read non-reactively via `getState()` |
| `src/renderer/src/PairedShell.tsx` | the `onOpen` nav callback | Proof the id exists on the e2e path: opening a seeded row goes through `activateConversation`, which records the active conversation before navigating |
| `src/renderer/src/activateConversation.ts` | `activateConversation`, `ActivateConversationDeps.setActiveConversation` | The write path both nav sites share — created-event and list-open alike |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | the `activeConversation` slice read, `RunConfigData` mount inside `StatusSheet` | The existing `activeConversation?.id ?? null` idiom this slice reuses, and where the sheet body mounts |
| `docs/knowledge/features/run-config-store.md` | § *Conversation-keyed since 2026-08-20 (#945/#946)*, § *Edge cases and limitations* | Names this slice by name; supplies the "no correlation on the reply" constraint and the edge-set argument the ticket asks to preserve. Read-only here — the documentation phase owns it |
| `e2e/real-daemon-session-settings.spec.ts` | the write assertion and the fresh-read assertion | AC4's proof; also confirms an active conversation always exists on that path, which is why AC2 has no e2e route |
| `src/renderer/src/screens/conversation/runConfigLive.test.ts`, `runConfigSnapshot.test.ts`, `src/shared/ipc/commands.test.ts` | the four `requestSessionSettings` guard cases; `fires exactly one bare requestSessionSettings`; `takes no arguments into refresh` | The specs whose premises AC5 inverts |

## Design source

**Figma:** N/A — no visible surface changes. This slice changes which id an outbound request carries;
the sheet's rendering is untouched and its visual fidelity was settled by #188/#192/#560.

## Context

Since the daemon commits that landed 2026-08-20 (pyrycode#1586 / pyrycode#1610),
`request_session_settings` is answered only for the conversation the request names. An unnamed
request draws a zero-valued reply — no error frame, no log line. That zero reply carries
`session_id: ''`, which `isAddressableSessionId` correctly refuses, so `RunConfigSections` withholds
its change handler and every model row is inert. That is #941 exactly: four rows render, the header
reads "Running model not yet known", clicking Sonnet does nothing.

#945 threaded the capability through `src/main/` and `src/shared/` and stopped there, leaving the
command's payload optional because the sole renderer sender still emitted the bare literal. This
slice supplies a real id and removes that optionality.

No ADR is warranted. This is the second half of a fix whose design rationale already lives in
`docs/knowledge/features/run-config-store.md` § *Conversation-keyed since 2026-08-20 (#945/#946)*,
which the documentation phase will fold this ticket into.

## Design

### 1. `requestRunConfigSnapshot` — the id arrives, and the send becomes conditional

```ts
export function requestRunConfigSnapshot(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void
```

The second parameter is **required**, not optional: a caller that forgets to resolve an id must be a
compile error, not a silent unnamed request — the exact regression this ticket exists to remove. The
two parameters are not cross-wireable (a function is not assignable to `string | null`), so no
named-deps-object treatment is needed.

Behaviour: an unaddressable id sends **nothing at all**; an addressable one sends exactly
`{ type: 'requestSessionSettings', payload: { conversation_id } }`.

"Unaddressable" is `null` **and** `''`, tested with one falsy check. `null` is the ticket's
no-conversation-active case. `''` is the same case spelled differently: it serialises to the same
wire frame, draws the same zero reply, and `setSnapshot` replaces the whole snapshot — so either
would wipe held values that a request which could never have improved them has no business
touching. The guard is one check because the failure is one failure, not because `''` has been
observed.

`isRequestSessionSettingsPayload` keeps accepting `''` at the IPC boundary: that guard checks type,
not emptiness, and the renderer-side decision not to *send* an unaddressable id is this helper's
job, not the boundary's. Nothing is weakened by the two disagreeing — the boundary is a structural
gate, the helper is a behavioural one.

### 2. Both call sites resolve the active conversation non-reactively

`RunConfigData`'s effect and `RunConfigLiveData`'s refresh arrow each read
`activeConversationStore.getState().activeConversation?.id ?? null` at call time. That is the idiom
`runConfigLive.ts` already uses for sibling stores inside callbacks (`runConfigStore.getState()`),
and it keeps both leaves subscription-free: neither re-renders on a conversation switch, and
`RunConfigData`'s render stays free of store reads.

The one-line expression is **duplicated at the two sites rather than extracted**. The three plausible
homes for a shared helper are all worse: `runConfigSnapshot.ts` would lose its store-free,
fully-injected property (the thing that makes it unit-testable with plain spies);
`runConfigLive.ts` would be imported by `RunConfigData.tsx`, closing the import cycle
`ConversationScreen → RunConfigData → runConfigLive → ConversationScreen` that
`runConfigLive.ts`'s own header exists to avoid; and `activeConversationStore.ts` would mean a sixth
production file and a new export for a two-token expression.

### 3. The refresh names the *active* conversation, never the edge's

`createRunConfigRefreshTrigger` is untouched. The edge set stays daemon-wide — a turn ending in any
conversation is a valid edge, because another conversation may be the one spending the window — and
`subscribeRunConfigRefresh`'s `refresh: () => void` seam stays nullary, so the trigger's
`event.conversationId` is structurally incapable of reaching the request. The id the request carries
is resolved at the binding, from the active conversation, whichever conversation's turn ended.

This is the ticket's one open design question and it is settled by the reply shape: a
`session_settings` reply describes exactly one conversation's session and carries no correlation id,
and the sheet shows the active conversation. Asking about a conversation the sheet is not showing
would put the wrong values in the store.

### 4. `RendererCommand.requestSessionSettings` — payload required

```ts
| { type: 'requestSessionSettings'; payload: RequestSessionSettingsPayload }
```

and the guard arm collapses to the neighbours' idiom:

```ts
return 'payload' in value && isRequestSessionSettingsPayload(value.payload)
```

Both of #945's acceptance arms go. The explicitly-`undefined` case is now rejected *by value*, which
matters for the same structured-clone reason #945 documented in the other direction: the bridge
preserves an explicitly-undefined property, so `'payload' in value` alone would let one through —
`isRequestSessionSettingsPayload` is what refuses it.

`isRequestSessionSettingsPayload` itself is unchanged.

### 5. Where the tightening stops

The main-side chain #945 built keeps its optional signatures — `main/index.ts`'s
`command.payload?.conversation_id`, `DaemonConnection.requestSessionSettings(conversationId?)`, and
`buildRequestSessionSettings`'s `?? ''` normalisation. They simply stop receiving `undefined`.
Tightening them buys no behaviour change and would put this slice over the size-S file ceiling. The
one main-side touch is comment-only: `RequestSessionSettingsInput.conversationId`'s doc says
"Optional only until #946 gives the renderer an id to supply", a promise about this ticket that goes
stale on landing (AC5).

## State + concurrency model

No new state, no new store, no new async work. Both sites are existing effects with existing
lifetimes:

- `RunConfigData` — mounts on sheet open, unmounts on close; its `requested` ref keeps a StrictMode
  double-invoke to one request per open. Unchanged.
- `RunConfigLiveData` — app-lifetime; two effects, each returning its `onDaemonEvent` off handle.
  Unchanged.

The store read is a synchronous `getState()` inside a callback, so there is no read-then-await gap to
race. `window.pyry` stays dereferenced only inside effects and callbacks, never during render, so
both leaves keep server-rendering to empty markup without a bridge mock.

Ordering on the e2e path: the channel-list row click runs `activateConversation` (recording the
active conversation) before navigating, and the sheet opens after that, so the id is present by the
time `RunConfigData` mounts. A `connected` edge that fires before any conversation is active now
sends nothing, where it previously sent an unnamed request — strictly fewer wasted frames.

## Error handling

No new failure mode. The request is fire-and-forget (`sendCommand` is `void`); an unaddressable
conversation is handled by not sending rather than by an error path; the daemon answers an
unresolvable id with a zero reply rather than an error frame, so there is still no
`conversation.not_found` to fire into. The pre-existing "no correlation on the reply" property is
unchanged and still relied upon: any arriving `session_settings` is landed unconditionally.

## Testing strategy

Vitest, in the pure helpers where a spy reaches the decision:

- `runConfigSnapshot.test.ts` — `requestRunConfigSnapshot` sends exactly one command carrying the
  given id and nothing else (asserting the key sets, not just the shape); sends **nothing** for
  `null`; sends nothing for `''`. The `null` case is AC2's only proof — the e2e spec seeds and opens
  a promoted conversation, so an active one always exists there.
- `commands.test.ts` — the payload-absent and payload-explicitly-`undefined` cases invert to
  rejection; the well-formed and malformed-payload cases stand; the union-membership case becomes a
  compile-time proof that a bare literal no longer typechecks, via `@ts-expect-error` (the idiom
  `src/shared/wire/types.test.ts` already uses, and `src/shared/**/*` is inside
  `tsconfig.node.json`'s include, so an unused expectation is itself an error).
- `runConfigLive.test.ts` — the nullary-`refresh` assertion stands but its stated reason inverts: the
  seam carries nothing because the edge is daemon-wide and the id comes from the active
  conversation, not because the request is bare (AC5).

Neither request effect can be driven from vitest (`environment: 'node'`, no DOM, no effects), so the
mount wiring is covered by the Playwright real-daemon tier:

- `npx playwright test --config playwright.real-claude.config.ts e2e/real-daemon-session-settings.spec.ts`,
  reading the **executed count and the skip reasons**, never the exit code — the real tier skips
  silently and exits 0 when a binary is missing. `pyry` is on PATH in this worktree and the spec sets
  `spawnClaude: false`, so no `claude` binary and no credential are needed.

Fakes over mocks throughout: the existing `fakeBridge` in `runConfigLive.test.ts` and plain `vi.fn()`
spies for `sendCommand`.

## Open questions

1. **Which conversation the refresh names** — settled in § Design 3: the active one, whichever
   conversation's turn edge triggered it. The edge set is explicitly *not* narrowed.
2. **Whether `''` is treated as "no conversation"** — settled in § Design 1: yes, one falsy check,
   because the wire outcome and the wipe hazard are identical to `null`. If implementation shows the
   guard reading better as two named cases, that is a revision worth recording rather than a silent
   change.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and one property strengthened. The relevant boundary is
  renderer→main at `isRendererCommand`'s `requestSessionSettings` arm; this slice makes it *stricter*
  (an absent or explicitly-undefined payload is now rejected where it was accepted), so the change
  moves in the safe direction. The value crossing it is client-owned — the renderer's own
  `activeConversationStore` state, recorded by `activateConversation` from a `conversation_created`
  payload or a `ConversationSummary`. It is daemon-asserted in origin, which is why what happens to
  it downstream matters: it reaches only `buildRequestSessionSettings`, which rebuilds a fresh
  one-key literal, so no renderer-supplied key reaches the wire. It is never rendered, never
  concatenated, never a filename, URL, attribute, cache key or log field, and never compared against
  a secret.
- **[Prototype pollution]** No findings. The id is used as an object *value* (`{ conversation_id: id }`),
  never as a key — `obj[id] = …` appears nowhere on this path. The one place a daemon-asserted id *is*
  used as a key on the run-config path is `createRunConfigRefreshTrigger`'s `Set`, which this slice
  does not touch and which is a `Set` for exactly this reason. A `__proto__` conversation id would
  travel through this design as an inert string.
- **[Tokens, secrets, credentials]** No findings — nothing on this path touches a token, key, or
  session secret. The `session_id` the reply carries is landed by the existing listener, unchanged by
  this slice.
- **[File / storage operations]** Not applicable — no filesystem access, no `safeStorage`, no path
  construction anywhere in the changed code. The id never becomes a path component.
- **[Electron attack surface]** No findings. No new `contextBridge` API, no new `ipcMain` channel, no
  `webPreferences` change, no navigation or protocol handler. The one IPC surface touched is an
  existing command member whose validation is being narrowed. `window.pyry` remains dereferenced only
  inside effects and callbacks.
- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no comparison against a
  secret, no Noise-layer change. The frame this slice fills in is built and encrypted by the existing
  main-process path.
- **[Network & I/O]** No findings, with a small reduction in outbound volume: a `connected` edge
  arriving before any conversation is active now sends nothing instead of an unnamed request. The
  frame is a fixed-shape ~110-byte envelope plus one client-owned id; the encode path's cap
  (`MAX_PLAINTEXT_BYTES`) is unchanged and the sole caller already catches, so an over-cap id fails
  closed as a dropped send. No new timeout, socket, or retry surface.
- **[Error messages, logs, telemetry]** No findings — the changed code is log-free by construction,
  matching `runConfigLive.ts`'s existing posture. Deliberately so: the only value a diagnostic here
  could carry is the conversation id, and the renderer console is readable by anything that can open
  DevTools (#126). The not-sent branch is a silent early return, not a warning.
- **[Concurrency]** No findings. No new async work, no timer, no `AbortController`, no listener. The
  store read is a synchronous `getState()` inside an existing callback, so there is no check-then-act
  gap across an `await`. Effect lifetimes and cleanup handles are untouched.
- **[Threat model alignment]** *Hostile daemon response* — the id this slice sends originates in a
  daemon-asserted payload held verbatim by `activeConversationStore`, so a hostile daemon controls
  its content. Addressed rather than deferred: the only sinks are a JSON value in a rebuilt literal
  and a falsy check, both of which are content-agnostic; see [Trust boundaries] and [Prototype
  pollution]. *Malicious relay* — content-blind and unchanged by this slice; it can still drop or
  delay the request, whose failure mode is a stale snapshot, not a leak. *Renderer compromise
  reaching the transport* — unchanged: the renderer still reaches the wire only through the validated
  command channel, and this slice narrows what that channel accepts.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
