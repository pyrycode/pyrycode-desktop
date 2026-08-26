# 776 — Persist the per-conversation last-read marks across restarts

**Ticket:** [#776](https://github.com/pyrycode/pyrycode-desktop/issues/776) · size `s` · `security-sensitive`
**Depends on:** #775 (the holder — CLOSED, merged)
**Feeds:** #777 (writes the mark), #778 (derives unread), #779 (clears at the pairing boundary), #676 (draws the dot)

## Design source

N/A — this slice renders nothing, per the ticket body ("Not UI-visible… #676 owns the dot and carries the Figma reference"). The visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is wired for this repo but **not indexed** — `.codegraph/` holds only `.gitignore` and `config.json`, no database, so every `codegraph_*` call errors with "CodeGraph not initialized" (re-confirmed 2026-08-26). This list was built by reading, not by `codegraph_context`. Don't burn a turn re-probing it.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationLastReadStore.ts` (whole file, 232 lines) | **The file you are editing.** The header is the contract this ticket inherits: :57–68 the retention ruling it defers to you, :76–93 the `ReadonlyMap`-not-`Record` mandate and the sentence at :84–87 naming *"#776 owns solving [persistence encoding] without reintroducing the hazard"*, :95–100 the log-free rule and the "persistence is #776's" deferral. |
| `src/renderer/src/store/conversationLastReadStore.test.ts` (whole file, 260 lines) | **The test file you are extending.** Note the 19 `createConversationLastReadStore(...)` call sites, the `lastReadFor` helper (:36), the `hostileKeys` table (:41), and the four "invisible to `tsc`" properties documented at :16–32. All 19 existing tests must keep passing **unchanged** — see § Signature. |
| `src/renderer/src/store/pushNotificationPrefStore.ts:29–86` | The closest precedent: port interface, key const, `encodePushPref`/`decodePushPref` as **separately exported pure functions**, and the window-guarded real port. Copy this shape. :43–47 is the key-namespacing deferral this ticket rules on. |
| `src/renderer/src/store/pushNotificationPrefStore.test.ts:23–31, 99–132` | The `fakeStorage(seed)` closure-with-`vi.fn` idiom, the simulated-restart test, and the "codec tested directly because the `node` runtime can't reach it through the window-guarded port" block. Copy all three. |
| `src/renderer/src/store/defaultWorkspaceStore.ts:26–57` | The first port; :39–45 is the canonical *"deliberately NOT a defensive try/catch"* paragraph. Reuse its reasoning verbatim in spirit. |
| `src/shared/wire/types.ts:14–22` | `MAX_FRAME_BYTES = 256 KiB`. Referenced only by § Security review (it bounds a hostile conversation id's length). No code change here. |
| `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` | Why the decode's reject path must be silent. |

Nothing else. There is no bridge, no IPC channel, no preload change, no screen, no main-process file in this ticket.

## Context

The last-read marks live in memory only. A restart drops them and every conversation reads as unread — the exact noise the mark exists to remove. #775 shipped the holder and explicitly deferred persistence here, leaving three open questions on this ticket's desk: how to encode a `Map` keyed by untrusted text without re-materialising the prototype hazard the `Map` removes; whether a retention bound is warranted once the map outlives a process; and whether the third `localStorage` key finally triggers the key-namespacing helper two comments have deferred.

Both existing persisted preferences (`defaultWorkspaceStore` #403, `pushNotificationPrefStore` #408) hold a **scalar**. This one is a **keyed map**, and that difference is the whole design: it adds a decode step over untrusted input, and it lands on a write path that already has a same-value guard.

## Design

### Shape

One module changes: `src/renderer/src/store/conversationLastReadStore.ts`. Five new exports, all in that file, in the order the precedents use (port interface → key const → codec → real port → factory):

```ts
export interface ConversationLastReadStorage {
  read(): ReadonlyMap<string, LastReadMark>
  write(marks: ReadonlyMap<string, LastReadMark>): void
}

export const CONVERSATION_LAST_READ_KEY = 'pyry.conversationLastRead' as const

export function encodeLastReadMarks(marks: ReadonlyMap<string, LastReadMark>): string
export function decodeLastReadMarks(raw: string | null): ReadonlyMap<string, LastReadMark>
export function localStorageConversationLastRead(): ConversationLastReadStorage
```

`read()` returns a map, never `null`. This is the one deliberate deviation from `PushNotificationPrefStorage`, whose `read(): boolean | null` keeps "never set" distinguishable from a stored `false` because a real consumer needs the distinction. Here nothing does: absent, unparseable and non-conforming all hydrate to the same empty map (AC4), so a nullable return would be a distinction with exactly one consumer that immediately discards it. The port stays a faithful "what is persisted, decoded" reporter; it just has nothing to be faithful *about* in the empty case.

There is deliberately **no `clear()`**. #779's pairing-boundary clear is served by `write(new Map())` — `encodeLastReadMarks(new Map())` is `'[]'`, which round-trips to empty. Adding a `clear()` here would ship an unused seam, the same refusal #775 made about the DI seam itself. Say so in the port's docstring so #779's design pass doesn't re-open it.

### Encoding: an array of entries, never an object

`encodeLastReadMarks` emits `JSON.stringify(Array.from(marks))` — a JSON **array of `[id, mark]` pairs**, e.g. `[["c1",4],["c2",9]]`. `decodeLastReadMarks` validates that array and feeds it to `new Map(entries)`.

This is the structural answer to the constraint at `conversationLastReadStore.ts:84–87`. The untrusted `conversationId` is a JSON **array element** on the wire-to-disk format and a `Map` key in memory — it is never an object key anywhere, in either direction. `Object.fromEntries`, spreading the map into an object literal, `JSON.stringify(map)` (which yields `{}` — the map's entries are not own enumerable properties, a silent total-data-loss bug), and any `obj[id] = mark` loop are all **out**, each for the reason the header gives. Spreading into an *array* (`[...marks]` / `Array.from(marks)`) is not the same operation and is fine.

The ticket's correction stands and should be reflected in the code comment: `JSON.parse('{"__proto__":3}')` creates an ordinary **own** property and pollutes nothing, so the hazard is not in `JSON.parse`. The step that loses data is `obj[id] = mark` by assignment — with a *numeric* value the `__proto__` setter no-ops, so the entry **vanishes silently** and no prototype changes. That is why AC5 leads with survival and read-back, not with "alters no prototype": for a number the pollution half is nearly free and the survival half is what actually fails. The entries-array format means neither half is reachable by construction rather than by validation — the same posture the `Map` itself takes.

Pin the format itself with an assertion on the exact encoded string (§ Testing), so a future "tidier" `Object.fromEntries` rewrite fails a test rather than compiling clean.

### Decoding: reject whole, silently

`decodeLastReadMarks(raw)` returns an empty map for every one of:

- `raw === null` (absent).
- `JSON.parse` throws (malformed). Wrap in `try`/`catch`; the catch returns the empty map and does nothing else.
- The parsed value is not an array.
- **Any** element fails the pair predicate: it must be an array of length exactly 2, with `typeof e[0] === 'string'` and `typeof e[1] === 'number' && Number.isInteger(e[1]) && e[1] >= 0`.

Otherwise `new Map(entries)`.

Three properties to hold on to:

- **Whole-blob reject, not per-entry salvage** (AC4, and the ticket is explicit). One bad entry costs every mark for that run. The marks are cheap to re-earn; per-entry salvage is a second decode path to get wrong.
- **`Number.isInteger` is the load-bearing check**, not `typeof === 'number'`. It excludes `NaN`, `Infinity` and fractions in one call. And note the reachable-through-our-own-encoder case the ticket names: `JSON.stringify` turns `NaN`/`Infinity` into `null`, so a non-number arrives even from a blob this app wrote — `typeof null === 'object'` fails the check and the blob is rejected.
- **The reject path is silent.** No `console.warn`, no `console.error`, not even a content-free one. The module is log-free by construction (`conversationLastReadStore.ts:95–97`, ADR 0007), and the only value a diagnostic here could carry is the untrusted, daemon-asserted id or the raw blob containing it. A silent reject is by design, not a swallowed error; say that in the catch's comment so a later reader does not "fix" it. Equally: the `catch` must not rethrow, and must not build an error message from `raw`.

The `try`/`catch` here is **not** in tension with the precedents' deliberate refusal to try/catch `localStorage`. Those refuse a defence against an *unobserved* quota/disabled failure. This one implements AC4, an explicitly required behaviour over a blob the ticket states is hand-editable on disk. Keep the distinction in the comment: the codec catches, the port does not.

### The real port

`localStorageConversationLastRead()` mirrors both precedents exactly: `read()` is `typeof window === 'undefined' ? new Map() : decodeLastReadMarks(window.localStorage.getItem(CONVERSATION_LAST_READ_KEY))`; `write(marks)` returns early when `window` is undefined, else `setItem(CONVERSATION_LAST_READ_KEY, encodeLastReadMarks(marks))`. No `removeItem` path (no clear). No try/catch — carry the `defaultWorkspaceStore.ts:39–45` reasoning across.

The `typeof window` guard is what makes this safe to name as the factory's default parameter (below) under the `node` test runtime and under `renderToStaticMarkup`.

### Signature: default the port to the real one

```ts
export function createConversationLastReadStore(
  storage: ConversationLastReadStorage = localStorageConversationLastRead()
)
```

The `init?: ConversationLastReadState` seed parameter is **replaced**, not supplemented: the port is now the single hydration source, and two hydration sources would be a genuine smell. Seeding in a test becomes seeding the fake port.

Why a default rather than a required parameter (both precedents require theirs):

- Under `node` the default port's window guard makes `read()` an empty map and `write()` a no-op, so all 17 zero-argument `createConversationLastReadStore()` call sites in the test file keep their exact current behaviour with **no edit**. Only the 2 seeded call sites (`conversationLastReadStore.test.ts:75` and `:257`) change, to pass a seeded fake. That keeps the edit fan-out at 2, not 19.
- The default is the **production** wiring, so the failure mode a default normally introduces — someone forgets to inject and silently gets no persistence — does not exist here. Omitting the argument is never *less* correct than the composition root.

Keep the singleton explicit anyway (`createConversationLastReadStore(localStorageConversationLastRead())`), matching the two sibling stores, so a reader of the composition root sees the dependency named. Document the default in the factory's docstring as the test-ergonomics affordance it is.

`initialConversationLastReadState` stays exported and unchanged. Its role narrows from "the factory's default" to "the named empty baseline"; `conversationLastReadStore.test.ts:255` still asserts it. Do not have `decodeLastReadMarks` return it — the codec should not import a state object; a fresh `new Map()` per reject is correct and costs nothing.

### Write-through: inside the updater, after the guard

```ts
recordLastRead: (conversationId, itemsSeen) =>
  set((s) => {
    if (s.marks.get(conversationId) === itemsSeen) return s   // unchanged
    const next = new Map(s.marks)                             // unchanged
    next.set(conversationId, itemsSeen)                       // unchanged
    storage.write(next)                                       // the one new line
    return { marks: next }
  })
```

This is the whole write-path delta: one line, on the change branch only.

**The precedents' `write`-then-`set` ordering is wrong here**, and AC3 is why. Both persist unconditionally because their scalar setters have no guard. `recordLastRead` has one at :183, and it fires on the *common* case: `appendDelta` (`threadTimeline.ts:239–250`) grows the tail `assistantText` item in place rather than appending, so `items.length` does not move across the deltas of a streamed assistant message, while #777's AC3 stamps the open conversation on **every** arriving delta. Persisting ahead of the guard would fire one synchronous `localStorage.setItem` per delta for the length of every reply.

The side effect sits inside the zustand updater rather than in the action body. That is deliberate and has two justifications:

- **It cannot be reordered wrongly.** Guard, clone, persist and return are one expression; no future edit can hoist the write above the guard without deleting the guard.
- **Vanilla zustand invokes the updater exactly once, synchronously, per `set`.** There is no React StrictMode double-invocation for a vanilla store and no middleware in this store's stack that re-runs it. Do not take that on trust — § Testing pins it with a call-count assertion.

The rejected alternative was reading through `get()` in the action body to keep the updater pure. It is equally correct and equally race-free (no `await`, so no suspension point either way), but it moves the guard away from the write and invalidates the header's `:171–174` paragraph for no gain. If a reviewer prefers it, it is a one-for-one swap.

The existing atomicity note at `:171–174` still holds verbatim: a synchronous `set` with no `await` inside means the check-then-act has no suspension point. `localStorage.setItem` is synchronous, so adding it introduces none.

### Header comment updates (in scope, same file)

Three edits to the module header, each closing a question the header itself left open. These are not decoration — a future reader who finds the questions still open will re-litigate them.

1. **:95–100** ("Nothing is persisted either, and must not be from HERE") is now false. Rewrite it to describe the port, the fixed key, the entries-array format, and the reject-whole-silently rule.
2. **:66–68** ("Persisted size is a real forward question once #776 lands… #776 is where a ceiling or a prune-on-load would be measurable and justified") — record the answer: **no bound, no prune-on-load, no LRU.** An entry is one bounded id plus one small integer plus JSON punctuation, on the order of 50 bytes, against a `localStorage` budget in the megabytes — roughly a hundred thousand conversations since the last pairing. No growth failure has been observed, and the keyspace is bounded by the user's own opening of conversations, not by anything the daemon can mint (see § Security review). #779 remains the only floor.
3. **The third-key ruling** (new sentence beside the key const): **no shared key-namespacing helper.** `pushNotificationPrefStore.ts:43–44` has the stronger argument — "the const NAME is a preference, but the STRING is the contract" — and a helper turns three greppable literals into three derived values, costing the ability to enumerate the app's persisted keyspace with one grep for `'pyry.`. The three keys share a five-character prefix and nothing else: no shared serialization, no shared lifecycle, no shared clear. `` `pyry.${name}` `` is not an abstraction. No collision or drift has been observed. **Nothing outside this file is edited either way** — CLAUDE.md forbids refactoring adjacent code, and the two older deferral comments stay as they are. Record the ruling here so a fourth key finds it answered.

### State + concurrency model

Unchanged from #775, plus one synchronous I/O call. No async task, no timer, no listener, no teardown, no `AbortController`, no subscription to the cross-document `storage` event (a deliberate omission: this is a single-window app, and a multi-window sync seam is unbuilt and unneeded). Unidirectional is preserved — one read-only selector, one store-owned write path, never two-way bound. Hydration happens once, at construction, with no explicit load step at any call site (AC1).

### Error handling

| Failure | Layer | Result |
|---|---|---|
| Key absent | port `read()` | empty map; store starts with nothing read |
| Blob is malformed JSON | `decodeLastReadMarks` | empty map, silently (AC4) |
| Blob parses to a non-array, or any element fails the pair predicate | `decodeLastReadMarks` | empty map, whole-blob, silently (AC4) |
| `localStorage` quota exceeded / storage disabled | port `write()` | **not handled** — unobserved failure mode, matching both precedents |
| No `window` (node / `renderToStaticMarkup`) | port | `read()` empty, `write()` no-op |

Nothing surfaces to the UI. There is no banner, no dialog, and no state field for "persistence failed" — a lost mark costs a conversation reading as unread once, which is the pre-#776 behaviour.

## Testing strategy

All in `src/renderer/src/store/conversationLastReadStore.test.ts`, `npm test` (vitest, `environment: 'node'`). No DOM, no React, no Playwright — nothing here is interactive or rendered. Type-level coverage rides on `npm run typecheck`.

**Fake port** — `fakeStorage(seed?: ReadonlyMap<string, number>)`: a closure over a mutable map exposing `read`/`write` as `vi.fn`, where `write` replaces the backing value so a second store over the same fake is a simulated restart. Store the **decoded** map directly, as `pushNotificationPrefStore.test.ts:23–31` does, so store tests never touch the codec.

Scenarios — store:

- All 19 existing tests pass **unchanged** (the two seeded ones at :75 and :257 rewritten to seed the fake). This is a required outcome, not an optional one.
- A store over a fake seeded with one mark hydrates it; `selectLastReadFor` returns it; `read` called exactly once. (AC1)
- A store over an empty fake hydrates empty — the `:44` "starts with nothing read" behaviour survives the change.
- Record a mark on store A, construct store B over the *same* fake: B reads it back. The simulated restart. (AC1 + AC2)
- A changed record calls `write` exactly **once**, with a map holding the new entry plus every pre-existing one. (AC2, and the once pins the updater's exactly-once invocation.)
- A verbatim repeat (same id, same count as held) calls `write` **zero** times. Sharper form: record 5, then 5 again, then assert `write` has been called exactly once in total. (AC3)
- A **first** record of `0` on an absent key *does* write through — `undefined === 0` is false, so the create path and the persist both run. The numeric-guard trap of #775, now on the persistence path.
- A record of a **lower** value than the held one writes through (replacement, never `Math.max`).
- The map passed to `write` is the same object the state then holds, and the previously held map is untouched.

Scenarios — codec, tested directly (the `node` runtime cannot reach it through the window-guarded real port):

- `decodeLastReadMarks(null)` → empty. (AC4)
- Malformed JSON (`'{'`, `'not json'`) → empty, no throw. (AC4)
- Valid JSON of the wrong top-level shape (`'{}'`, `'3'`, `'null'`, `'"x"'`) → empty. (AC4)
- Elements that are not 2-tuples (`'[1]'`, `'[["a"]]'`, `'[["a",1,2]]'`) → empty.
- Non-string key (`'[[1,2]]'`) → empty.
- Non-conforming values (`'[["a","1"]]'`, `'[["a",1.5]]'`, `'[["a",-1]]'`, `'[["a",null]]'` — the last being the `NaN`/`Infinity`-through-`JSON.stringify` route) → empty.
- **Whole-blob reject:** `'[["a",1],["b",-1]]'` → empty, `size` 0. The good entry is dropped too. This is the AC4 trade made explicit; a per-entry-salvage implementation passes every other decode test and fails only this one.
- `encodeLastReadMarks(new Map())` is `'[]'`, and it decodes back to empty — the #779 clear path.
- Round-trip: a three-entry map encodes then decodes to an equal map (same size, same value under each key).
- **Round-trip under all three hostile keys** (`__proto__`, `constructor`, `''`, reusing the `hostileKeys` table at :41) with distinct values: each reads back under its exact key, `size` is 3, and `Object.getPrototypeOf({})` is still `Object.prototype` with no stray own property on it. (AC5)
- A **hand-authored** blob decodes the same way: `'[["__proto__",7]]'` → `get('__proto__')` is `7`, prototype untouched. The untrusted-input direction, which the round-trip test alone does not cover. (AC5)
- **Format pin:** `encodeLastReadMarks(new Map([['__proto__', 7]]))` is exactly `'[["__proto__",7]]'`. This is the assertion that fails when someone rewrites the encoder with `Object.fromEntries`.

Scenarios — real port:

- `CONVERSATION_LAST_READ_KEY` is `'pyry.conversationLastRead'`.
- With no `window`: `read()` returns an empty map and `write(new Map([['c1', 1]]))` does not throw. The import-safety guard, and what makes the default parameter safe.

## Scope

**In:** `src/renderer/src/store/conversationLastReadStore.ts` and its test file. Two files, one of them production.

**Out:** every other file. In particular — no edit to `defaultWorkspaceStore.ts` or `pushNotificationPrefStore.ts` (the key-namespacing ruling is "no," and would be out of this diff even if it were "yes"); no knowledge-base doc (the documentation phase owns `docs/knowledge/features/conversation-last-read-store.md` and folds this in after code review); no bridge, no screen, no IPC, no main-process change.

## Open questions

None blocking. Two notes forward:

- **#779** must persist its clear, or a restart resurrects marks from a previous pairing. `storage.write(new Map())` is the whole mechanism and this ticket's port already supports it — flagged here so #779's design pass does not have to rediscover it.
- **#777** is where the write frequency actually lands. AC3's guard makes the streamed-delta case free; if a future writer stamps on something that genuinely changes per delta, the `localStorage` write rate becomes worth measuring. Not a concern for any writer that exists today.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The persisted blob is untrusted input — the ticket states it is hand-editable on disk, and its keys are daemon-asserted conversation ids. The boundary is one named function, `decodeLastReadMarks`, and it is the only path from a stored string to in-memory state; nothing downstream holds `unknown`, and the validated `ReadonlyMap<string, LastReadMark>` is the type signal that the crossing happened. The ids remain untrusted *strings* after decode, and the scoping at `conversationLastReadStore.ts:76–79` continues to hold: lookup keys only, never rendered, never concatenated, never a filename, cache key or URL, never compared against a secret. Persistence adds exactly one new sink for them — `JSON.stringify` into a `localStorage` value — which escapes its input and writes to opaque per-origin storage. No IPC boundary is crossed at all: this ticket adds no channel, no `contextBridge` surface and no main-process code.

- **[Tokens, secrets, credentials]** No findings, and the `localStorage`-is-not-for-tokens rule was checked rather than assumed. A `LastReadMark` is a count of timeline items (`conversationLastReadStore.ts:111`); the blob contains no token, key, message body or credential, so `safeStorage` is not warranted and would be the wrong instrument. The residual disclosure is real and accepted: anything running as the user can read *which conversation ids were opened and roughly how far*. That is strictly less identifying than `pyry.defaultWorkspace`, which already stores a filesystem path in the same store, and an attacker with that access already has the renderer's whole web-storage area. Named, not silently inherited.

- **[File / storage operations]** No findings. No filesystem path is constructed anywhere. The `localStorage` key is a fixed client-owned constant, never derived from a conversation id — which is precisely the "one whole-map value under a single FIXED key" requirement #775 set at `:87`, and it is what keeps the untrusted string out of the key space entirely. No path traversal surface; no TOCTOU (a single synchronous `getItem` at construction, no check-then-open). Durability: Chromium flushes the backing store asynchronously, so a hard kill can lose the most recent `setItem`, and in principle leave a truncated value. **AC4 is itself the defence** — a torn blob is unparseable and rejects whole, costing the marks rather than the start-up. That is why the whole-blob reject is a requirement rather than a preference, and it is why no atomic-write dance (temp-file-plus-rename) is needed for a single-key store.

- **[Inter-process / Electron attack surface]** No findings. Zero new IPC channels, zero new preload exports, no `BrowserWindow` or `webPreferences` change, no protocol handler, no navigation surface. Process placement holds by construction: no key, socket, Noise state or token is touched, and nothing moves across the main/renderer boundary. The category-3 rule that *sensitive state must not touch renderer-side web storage* is satisfied because the state is not sensitive — argued above under Tokens, not waved through.

- **[Cryptographic primitives]** Not applicable, and the reason is specific rather than definitional: no randomness is generated, no value is derived, and the only comparison on the path is `s.marks.get(id) === itemsSeen` — a client-originated integer against a client-originated integer, not an attacker-controlled value against a secret. `crypto.timingSafeEqual` would be meaningless here.

- **[Network & I/O]** No findings; no network code is added. One inherited bound is worth naming because the retention ruling leans on it: a conversation id's length is capped transitively by `MAX_FRAME_BYTES` (256 KiB, `src/shared/wire/types.ts:22`) and the relay's 1 MiB per-message cap, so a hostile daemon cannot mint an unbounded-length id for persistence.

- **[Error messages, logs, telemetry]** SHOULD FIX, addressed in the spec — this was the pass's real catch. The decode's reject path is the natural place for a developer to add a `console.warn('bad last-read blob', raw)`, on the entirely reasonable instinct that silently swallowing a parse failure is bad practice. That log would put untrusted, daemon-asserted conversation ids into the renderer console and any capture of it, violating ADR 0007 and the module's log-free-by-construction rule at `:95–97`. § Decoding states the constraint explicitly, requires the silence to be commented as deliberate rather than accidental, and forbids rethrowing or building a message from `raw`. Code review should check this line specifically. No user-facing error surface exists, so nothing leaks to the UI either.

- **[Concurrency]** No findings. No async, no timer, no listener, no teardown; the write is synchronous inside a single `set` with no suspension point, so the check-then-act guard cannot interleave. Shutdown mid-write is covered under File / storage operations. Two windows sharing one origin's `localStorage` would last-write-wins with divergent in-memory maps — **out of scope**: this is a single-window app, no second `BrowserWindow` loads app UI, and the `storage`-event sync seam is deliberately not built. If a second window ever lands, that ticket owns it.

- **[Threat model alignment]** No findings; the four desktop-specific threats walked concretely. *Malicious relay* — content-blind and off this path entirely; it cannot see or alter a renderer-local blob. *Token theft from disk* — no token here. *Hostile daemon response* — the daemon can influence the **keys** (it names conversation ids) but not the values (marks are client-originated counts), and it cannot mint entries: an entry is created only when the user opens that conversation, since #777 stamps the *open* conversation. So the keyspace is bounded by user action and each key is bounded in length by the frame cap — which is what makes the no-retention-bound ruling safe against a storage-exhaustion attempt, not merely against organic growth. *Renderer compromise* — anything running in the renderer already has `localStorage` access; this ticket adds no new capability and no new reach toward keys, tokens or the socket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
