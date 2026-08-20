# #560 — Run config: show the running model, resolved by exact match or rendered verbatim

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/560
**Size:** S (confirmed — see § Size check)
**Labels:** `size:s`, `security-sensitive`

Closes the transport → store → surface vertical opened by #587 (wire decode) and #588
(`announcedModelStore`). Both halves shipped dormant; this slice is the render surface.

---

## Files to read first

Codegraph is still uninitialized on this repo (`.codegraph/` holds only `config.json`;
`codegraph_context` errors with *"CodeGraph not initialized"*), so this list is hand-built from the
render surface plus the store contract. Read in this order — it is the turn-1 data load.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/announcedModelStore.ts:36-119` | The whole contract you are consuming. `AnnouncedModel` (`model` verbatim, `truncated` a value never an absence), `announced: null` = not-yet-known, `selectAnnouncedModel`, `useAnnouncedModelStore`. The doc comments at `:46-51` and `:58-65` are the security and `''`-vs-`null` rules this spec turns into markup. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:26-55` | `ModelCatalogEntry`, `MODEL_CATALOG` (the four rows and their `family` tokens), and `matchedFamily` — the substring matcher you must **not** reuse and must not modify. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:100-139` | `RunConfigView`'s prop list and section order — the one place you add a prop and a section. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:291-351` | `ContextWindowSection` — the header + column-body + one-line-fallback idiom this section clones (`.run-config__context`, `.run-config__context-unavailable`). |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:365-404` | The container. Three store hooks already read here; you add a fourth and pass it straight down. |
| `src/renderer/src/screens/conversation/RunConfigSections.test.tsx:1-46` | The harness: `renderToStaticMarkup` + string assertions, and the three extraction helpers (`segmentFor`, `tagWithClass`, `closedBefore`). Read `segmentFor`'s contract carefully — see § Test-collision map. |
| `src/renderer/src/screens/conversation/RunConfigSections.test.tsx:48-158, 283-317, 358-461, 493-522` | The ~51 existing `RunConfigView` render sites and every assertion your new always-rendered copy must not collide with. |
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx:225-257` | The cut-marker idiom in full, with the forgeability argument in the comment. `BACKGROUND_TASK_PANEL_CUT_COPY` is at `:69`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:485-500` | The second cut-marker precedent (`UNRECOGNIZED_TRUNCATED_COPY`), same shape. |
| `src/renderer/src/screens/conversation/conversation.css:1187-1195, 1500-1545` | `.status-sheet__section-header` and the `.run-config__context*` rules your three new rules clone. |
| `src/renderer/src/screens/conversation/conversation.css:2197-2209, 2270-2285` | `overflow-wrap: anywhere` + `min-width: 0` on unbounded daemon text, with the rationale comment. |
| `e2e/real-daemon-session-settings.spec.ts:66-92` | The page-wide `[aria-label="Current model"]` count and the `.run-config__model-row` `hasText` locators. |
| `e2e/run-config-settings.spec.ts:181-190` | The second set of the same locators. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

The run-configuration sheet is a dark bottom sheet: a title row, then five sections, each a muted
`label-large` header (`.status-sheet__section-header`) above a padded column body. **There is no drawn
running-model surface and no not-yet-known state** — verified against the file and against a rendered
screenshot of `20:100`. The new section clones the Context-window body idiom exactly (`20:151`:
`flex-column`, `gap 8`, `pt 4 / px 16 / pb 16`, a `body-large` / `on-surface` value line with an
optional `body-small` / `on-surface-variant` line beneath it) — no new tokens, no new geometry.

---

## Size check

**Verdict: S, no split.**

| Red line | Count | Result |
|---|---|---|
| New files | 0 | pass |
| Total written LOC (prod + CSS + tests) | ~250 (≈70 TSX, ≈30 CSS, ≈150 test) | pass (< 600) |
| New exported types / components | 0 — one optional prop added to the already-exported `RunConfigView`; the section component and both copy constants are module-local | pass |
| Consumer call sites needing simultaneous updates | **0** | pass |
| Acceptance criteria | 5 | pass |
| Distinct reject / error branches | 4 (`null` ⇒ unknown; hit ⇒ name; miss ⇒ verbatim; `truncated` ⇒ marker) | pass |

**Edit fan-out check.** `RunConfigView` has 51 references in its test file (`grep -c` = 51, one being
the import) and one in `ConversationScreen.tsx`. The new prop is **optional**, so every one of those
call sites keeps compiling and passing unmodified — the fan-out is zero, not "mechanical". This is the
one place the ≤10-call-site rule could have bitten, and the optionality is what removes it.

**§4 production-file self-check:** 1 `.tsx` file modified (`RunConfigSections.tsx`). CSS and test files
are excluded from the count and are 1 each regardless. Well under 5.

**File-overlap check (2026-08-20).** `git fetch origin --prune` then a diff of every
`origin/feature/<N>` branch against `origin/main`: all twelve surviving remote feature branches are
already merged (empty diff). **No in-flight branch touches `RunConfigSections.tsx`,
`RunConfigSections.test.tsx`, or `conversation.css`.** No `addBlockedBy` set. #593 (the pairing-scoped
clear) has zero file overlap with this slice, as recorded during refinement.

---

## Context

After #500 the sheet's Model rows are marked from the daemon's **persisted override**. On a daemon
where nothing was overridden that value is `''`, so no row is marked — honest, indistinguishable from
broken, and not the question the operator is asking. `announcedModelStore` now holds what claude
actually announced. This slice puts it on screen as a **read-only surface beside** the override
controls; it changes nothing about the write path.

Three facts drive the whole design:

1. **The identifier is untrusted, model-influenced text** that crossed the subprocess trust boundary.
   The daemon bounds it at 256 bytes and does not sanitize it. #588 had no DOM sink, so it inherited
   the obligation. **This ticket is the render boundary where it is discharged.**
2. **Matching is exact string equality, never inference.** `matchedFamily` (`:52-55`) does a
   case-insensitive substring match — that is the guessing this ticket exists to stop. The running
   surface gets its own lookup and must never call `matchedFamily`.
3. **`truncated` is load-bearing.** A cut identifier can never equal a catalog token, so it always
   takes the verbatim path and renders looking exactly like a legitimate unrecognised model. This
   sheet is the only surface holding both values, so it is the only place that can tell them apart.

---

## Design

### Where the surface goes

A **sixth section** rendered by `RunConfigView`, positioned **immediately before `ModelSection`** —
header `Running model` reusing `.status-sheet__section-header` verbatim, then a column body
`.run-config__running`. Reading order: what is running, then what you can switch to.

Placement before the rows is also the safe side of a test-harness edge: `segmentFor` chunks are
delimited by the *next* occurrence of the class token, so the **last** model row's chunk runs to
end-of-document. A surface placed after the rows would land inside the Haiku chunk that `:53` asserts
negatively over. Before the rows, it lands in `segmentFor`'s chunk 0, which no existing assertion
targets.

**Rejected alternative — a second marker inside `.run-config__model-row`.** Marking the running row
in the list would put a second selection marker on a sheet whose existing marker is asserted by
*count* at six sites including a page-wide e2e count. AC1's *"identifies that row as the running
model"* is satisfied by **naming the row** on the new surface (rendering `entry.name`), and AC2's
*"no row identified as running"* then holds by construction on the miss path. No row markup changes.

### The prop

```ts
// added to RunConfigView's props
announced?: AnnouncedModel | null
```

`AnnouncedModel` is imported as a type from `../../store/announcedModelStore` — do not redeclare it.
**Optional, and absent ≡ `null` ≡ not-yet-known.** That is what keeps all ~51 existing render sites
compiling and passing, and it is why the not-yet-known copy renders in every one of them (see
§ Test-collision map).

### The exact lookup

A new module-local function, sitting beside `matchedFamily` but sharing no code with it:

```ts
function runningCatalogEntry(model: string): ModelCatalogEntry | undefined
```

`MODEL_CATALOG.find((entry) => entry.family === model)` — `===` only. No `toLowerCase`, no
`includes`, no `startsWith`, no regex, no trim.

**It is dormant by design and that is not a defect.** Catalog tokens are family words
(`opus` / `sonnet` / `fable` / `haiku`); claude announces full identifiers, so equality essentially
never fires until the daemon-published list lands (#556 / #561, held behind pyrycode#1646). The
verbatim path is the live path today, and that is the correct outcome. **Say this in a code comment.**
Without it, a later reader "repairs" the lookup into the substring match this ticket exists to forbid
— `matchedFamily` is eight lines away doing exactly that for the override.

### Render contract

One value element, plus one independent marker element:

| `announced` | Value element | Marker |
|---|---|---|
| `undefined` / `null` | `.run-config__running-unknown` holding the client copy | never |
| `{ model, truncated }`, lookup hits | `.run-config__running-value` holding `entry.name` (client-owned) | per `truncated` |
| `{ model, truncated }`, lookup misses | `.run-config__running-value` holding `announced.model` **verbatim** | per `truncated` |

Two rules that are easy to get wrong and are both deliberate:

- **The marker branches on `announced.truncated` alone**, never on which path the value took. The flag
  is the daemon's report about the identifier it delivered; suppressing it on the resolve path would
  let a daemon hide its own cut report by sending a value that happens to equal a catalog token. The
  hit+truncated combination is only reachable from a non-conforming daemon and renders both readings
  honestly rather than silently dropping one.
- **`{ model: '', truncated: false }` takes the verbatim path.** It is a real announcement the daemon
  emitted (reachable per `announcedModelStore.ts:62-65`), so it renders `.run-config__running-value`
  **present with empty text** — it is never collapsed into the not-yet-known sentinel. Collapsing
  would erase the store's deliberate `null`-vs-`''` distinction one layer above where it was
  established. The markup distinction is: value element present, unknown copy absent.

### Copy

Two module-local constants next to `RUN_CONFIG_ERROR_COPY` (`:65-69`), which is the file's convention
for client-owned copy. **Apostrophe-free** — `renderToStaticMarkup` escapes `'` → `&#x27;`.

- unknown: `Running model not yet known`
- cut marker: `Truncated by the daemon` (the `BACKGROUND_TASK_PANEL_CUT_COPY` literal, `:69`)

The cut marker is a **sibling element holding a constant**, never text concatenated into the value —
`{announced.model}{truncated && ' (truncated)'}` would fuse client copy and daemon text into one node,
making an identifier ending in those words indistinguishable from the sheet's own claim. That is
AC3's forgery-resistance requirement, and it is why AC3 is a security property rather than styling.
Nothing slices, measures, re-joins, or re-sinks the identifier to produce the marker.

Neither literal may contain `Current model`, `aria-current`, `aria-busy`, `role="button"`, `tabindex`,
`disabled`, `role="alert"`, `% used`, `NaN`, `undefined`, or `Infinity` — see § Test-collision map for
why each one matters. Both proposed literals clear all of them; re-check if you change the wording.

### The container

`RunConfigSections` adds a fourth store read and passes it straight through:

```ts
const announced = useAnnouncedModelStore(selectAnnouncedModel)
```

Narrow-slice selection, no derivation in the container, no setter — unidirectional exactly as the
three sibling reads. Under server render zustand v5 reads `getInitialState()`, so `announced` is
`null` and the container renders the not-yet-known state with no bridge mock, which is what keeps the
existing container test (`:493-522`) green and mock-free.

### Files touched

| File | Change |
|---|---|
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` | import the store type + hook + selector; `runningCatalogEntry`; two copy constants; `RunningModelSection`; one prop on `RunConfigView`; one line in the container |
| `src/renderer/src/screens/conversation/conversation.css` | three rules, appended in the `#192` run-config block region |
| `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` | one new `describe` block; existing blocks unmodified |

No e2e change: neither run-config spec can produce an announcement (`spawnClaude: false` / fake
daemon), so both keep asserting against the not-yet-known state without edits.

---

## Test-collision map

The new copy renders in **every** existing `RunConfigView` and `RunConfigSections` test, because the
prop is optional and its absence is the not-yet-known state. These are the assertions it passes
through. Treat this table as the RED-run checklist — a wording change that trips any row is a red
test, not a style nit.

| Site | Assertion | Why the design clears it |
|---|---|---|
| `RunConfigSections.test.tsx:55,63,69,75,87,93,108` | `markup.match(/Current model/g)?.length === 1` | new copy contains no `Current model`; no new `aria-label` |
| `:137`, `:503` | `not.toContain('Current model')` | same |
| `:434` | `aria-label="Current model"` count 1 | the new surface renders no `aria-label` at all |
| `:53`, `:107` | `segmentFor(…, 'Haiku 4.5' / 'Fable 5')).not.toContain('Current model')` | surface sits **before** the rows, so it is outside the last row's open-ended chunk |
| `:174`, `:504` | `not.toContain('aria-current')` | no `aria-current` on the new surface |
| `:299`, `:310-311`, `:420-421`, `:460`, `:509` | `not.toContain('role="button"' / 'tabindex' / 'aria-readonly' / 'disabled')` | the surface is inert text: no role, no tabindex, no handler; copy contains none of those substrings |
| `:403-404`, `:488`, `:512` | `not.toContain('aria-busy')` | no `aria-busy` on the new surface |
| `:405` | `expect(allFalse).toBe(omitted)` — byte-identical markup | both omit `announced`, so both render the identical unknown state |
| `:260-264` | `not.toContain('% used' / 'NaN' / 'undefined' / 'Infinity')` | copy contains none; no arithmetic on this surface |
| `:511` | `not.toContain('role="alert"')` | the unknown state is not an error |
| `e2e/real-daemon-session-settings.spec.ts:91` | page-wide `[aria-label="Current model"]` count 1 | no new element carries that label |
| `…:68,85` / `run-config-settings.spec.ts:184` | `.run-config__model-row` `hasText` locators, and count 0 when closed | the surface carries no `run-config__model-row` class |
| `ConversationScreen.test.tsx:1597-1602` | closed screen contains no `Opus 4.7` / `% used` / `high` | the sheet is not rendered when closed; unchanged |

**One trap for the new tests.** `segmentFor(markup, 'run-config__model-row', 'Opus 4.7')` returns the
*first* chunk containing the needle. On the resolve path the surface renders `Opus 4.7` **before** the
rows, i.e. in chunk 0 — so a row-scoped assertion written with `segmentFor` would silently measure the
prefix instead of the row. Assert the new surface by its **own** class instead, via exact serialized
elements (below).

---

## Testing strategy

All in `RunConfigSections.test.tsx`, one new `describe('RunConfigView — running model (#560)')`.
`renderToStaticMarkup` string assertions in the `node` env — no DOM, no clicks, no effects.

Prefer **exact serialized-element** assertions for the value, since AC2 is literally "character for
character": `expect(markup).toContain('<p class="run-config__running-value">…</p>')`. The existing
file already spells escaped expectations out by hand (`:275-277`), so this matches the local idiom.

Scenarios:

- **Not-yet-known, prop omitted** — the unknown copy renders; no value element, no marker.
- **Not-yet-known, prop explicitly `null`** — byte-identical markup to the omitted case.
- **Exact hit** — `{ model: 'opus', truncated: false }` renders the value element holding `Opus 4.7`;
  the unknown copy is absent; `/Current model/g` count is still 0 (no row was marked, because the
  override prop is `''`).
- **Exact hit for each catalog token** — `opus` / `sonnet` / `fable` / `haiku` each name their own
  row's display name. Cheap loop; guards a future catalog edit.
- **Case sensitivity** — `{ model: 'Opus' }` and `{ model: 'OPUS' }` both **miss** and render verbatim.
  This is the assertion that fails if anyone reintroduces `toLowerCase`.
- **Substring rejection** — `{ model: 'claude-opus-4-7' }` misses and renders verbatim, and the markup
  does **not** contain the value element holding `Opus 4.7`. This is the assertion that fails if
  anyone swaps in `matchedFamily`.
- **Miss renders verbatim** — a realistic full identifier (`claude-haiku-4-5-20251001`) renders
  character for character as the value element's whole text.
- **Empty identifier** — `{ model: '', truncated: false }` renders the value element present and
  empty, and the unknown copy absent.
- **Cut marker present** — `truncated: true` renders the marker element holding the constant, as a
  **sibling** of the value element, not a descendant (reuse `closedBefore` at `:40-46`, asserting the
  value element closes before the marker copy appears).
- **Cut marker absent** — `truncated: false` renders no marker element and the marker copy appears
  nowhere in the markup.
- **Forgery resistance (AC3)** — `{ model: 'claude-x Truncated by the daemon', truncated: false }`:
  the copy appears in the markup (inside the value, verbatim) but **no `run-config__running-cut`
  element exists**. This is the assertion that fails if the marker is ever concatenated into the value.
- **Cut marker independent of the lookup** — `{ model: 'opus', truncated: true }` renders both
  `Opus 4.7` and the marker.
- **Inertness (AC5)** — for a hostile fixture
  (`<img src=x onerror="alert(1)">`, `javascript:alert(1)`, `" onmouseover="x`, and a control-char /
  terminal-escape case): assert over the **whole markup** that it does not contain `<img`, `href="`,
  `src="`, and does not match `/\son[a-z]+="/`; and that the escaped form appears inside the value
  element. **Do not** assert `not.toContain('onerror=')`, `not.toContain('src=')` or
  `not.toContain('javascript:')` — those substrings survive a *correct* render (React escapes markup
  metacharacters, not arbitrary text) and would fail green. Attribute-shaped guards are unforgeable
  because `renderToStaticMarkup` always quotes attribute values and escapes `"`.
- **Control characters** — write them as `\u001b` / `\u0007` **escape sequences in the source**, never
  as literally typed control bytes. A typed byte lands raw in the `.ts` file, makes the line
  un-`Edit`-able afterwards, and blocks `gh pr create`. Assert the sequence survives verbatim (nothing
  strips it) and that the attribute-shaped guards still hold.
- **Container** — extend the existing `RunConfigSections` case at `:493` with one line: the
  server-rendered container shows the not-yet-known copy (proving the fourth store read is wired and
  still requires no `window.pyry` mock).

**Do not** add a sanitizer, a normaliser, a length clamp, or an allow-list. The identifier is held
verbatim by contract; React's text-node escaping is the entire discharge, and a control character in
a DOM text node is inert in a browser renderer. Overflow is a CSS concern, not a string operation.

---

## Styling

Three rules appended near the existing `.run-config__context*` block, token-only, no literals:

- `.run-config__running` — clone of `.run-config__context` (`:1503-1507`): `flex`, `column`,
  `gap: var(--space-2)`, `padding: var(--space-1) var(--space-4) var(--space-4)`.
- `.run-config__running-value` — clone of `.run-config__context-usage` (`:1510-1517`) body-large /
  `--color-on-surface`, **plus `min-width: 0` and `overflow-wrap: anywhere`**. This is not
  decoration: the identifier is a 256-byte daemon string with no guaranteed break opportunity, and
  without it a hostile single-token value pushes the sheet into horizontal overflow. Precedent and
  rationale at `conversation.css:2197-2209`.
- `.run-config__running-unknown` and `.run-config__running-cut` — body-small /
  `--color-on-surface-variant` (the `.run-config__context-explainer` / `background-task-panel__type`
  token set). Neither is an error state, so neither takes `--color-error`.

No sheet-layout work: `.status-sheet` is `max-height: 90%` and `.status-sheet__body` is
`overflow-y: auto; min-height: 0` (`:916` / `:993`), so the added section scrolls inside the body.

---

## Error handling

There is no failure mode to surface here — this is a pure read of held renderer state with no I/O, no
async, and no dispatch. The three states are all *normal* states, and none is an error:
not-yet-known is expected before the first turn, a miss is the ordinary case today, and a cut is the
daemon reporting its own bound. Consequently **no `role="alert"`, no `--color-error`, no retry
affordance** — which is also what keeps `:511`'s `not.toContain('role="alert"')` green.

## State + concurrency model

One additional narrow-slice read of an existing app singleton. No new store, no new subscription, no
new effect, no cancellation surface. A repeat announcement produces a fresh object identity
(`announcedModelStore.ts:88-95`), so it re-notifies and re-renders this section with identical output
— acceptable and already anticipated by the store's own comment; do not add memoisation for it.

## Open questions

- **None blocking.** The one judgement call resolved in-spec rather than deferred is the
  `{ model: '', truncated: false }` rendering (value element present and empty). If a later ticket
  wants distinct copy for it, that is a copy change on one branch, not a restructure.
- Out of scope and already filed: **#593** (clearing the announcement when a pairing ends — the
  latch `announcedModelStore.ts:24-32` and `App.tsx:120-125` both park on). It has zero file overlap
  with this slice, so either landing order works.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The boundary is explicit and singular: `announced.model` is
  untrusted daemon-relayed, model-influenced text, and this spec is where it reaches a DOM sink. It
  enters as one named field of one named type (`AnnouncedModel`), flows through exactly one component,
  and reaches exactly one JSX text position. The design forbids the three ways it could stop being
  inert — it is never `dangerouslySetInnerHTML`, never an attribute value, never a URL — and the
  *client-owned* value on the resolve path (`entry.name`) comes from a module constant, so the two
  provenances are never mixed in one node. The upstream contract (`announcedModelStore.ts:46-51`)
  names the same obligation, so the boundary is documented on both sides.
- **[Trust boundaries — control input]** No findings. The identifier selects **nothing** beyond which
  catalog display name is shown. It is not a cache key, a filename, a lookup path, an IPC argument, or
  a store write. `runningCatalogEntry` compares it against a fixed four-entry frozen literal and
  returns a constant or `undefined`; a hostile value can at most cause the verbatim path, which is the
  default. Nothing the app sends is derived from it (AC5's last clause), because this surface
  dispatches nothing at all.
- **[Injection / render sink]** No findings, with one MUST-NOT recorded in the spec: the cut marker
  must never be concatenated into the value node. Concatenation is the one design choice here that
  would be exploitable-as-designed — it lets a daemon forge the sheet's own truncation claim by
  ending an identifier in those words, i.e. present cut text as complete (or complete text as cut).
  The sibling-element rule closes it and the forgery-resistance test asserts it. Note the assertion
  must be *structural* (no `run-config__running-cut` element exists), not `not.toContain(copy)` —
  the copy legitimately appears inside the forged value.
- **[Injection — test vacuity]** SHOULD FIX, mitigated in § Testing strategy. The obvious anti-XSS
  assertions (`not.toContain('onerror=')`, `not.toContain('src=')`, `not.toContain('javascript:')`)
  **pass on a correct render and also on a broken one** for this kind of fixture, so they would give
  false assurance rather than coverage. The spec mandates attribute-shaped guards (`href="`, `src="`,
  `/\son[a-z]+="/`) over the whole markup instead, which are unforgeable from escaped text. Code
  review should reject any weaker form.
- **[Denial of service / resource]** No findings. The value is bounded at 256 bytes by the daemon and
  the store holds exactly one record with O(1) replacement, so a flooding relay costs one allocation
  per frame and one re-render, not unbounded growth. The one *rendering* DoS shape — a 256-byte
  unbroken token forcing horizontal overflow of the sheet — is closed in CSS with
  `overflow-wrap: anywhere`, not by truncating the string (which would violate the verbatim contract
  and re-introduce the very ambiguity AC3 exists to remove).
- **[Electron attack surface / process placement]** No findings. Renderer-only change. No IPC channel
  added, no `contextBridge` surface touched, no `window.pyry` dereference added — the container's new
  read is a zustand selector. Nothing crosses to the main process in either direction.
- **[Tokens, secrets, credentials]** Not applicable, stated rather than skipped: this surface handles
  one model identifier and one boolean. No token, key, or credential is read, rendered, logged, or
  compared here, so there is no constant-time-compare or storage question to answer. The `===` in
  `runningCatalogEntry` compares untrusted text to a **public** constant, which is not a secret
  comparison.
- **[File / storage operations]** Not applicable. No filesystem access, no path construction, no
  persistence. The identifier never becomes a path component — explicitly forbidden above.
- **[Cryptographic primitives]** Not applicable. No randomness, no hashing, no key material.
- **[Network & I/O]** Not applicable to this slice. Frame bounds, `maxPayload`, and the 256-byte cut
  are enforced upstream in #587's decode; this surface consumes the already-decoded record and adds no
  socket, fetch, or URL.
- **[Error messages, logs, telemetry]** No findings. The surface logs nothing and renders no daemon
  text into an error line — the only daemon-derived text is the value node itself, which is the
  ticket's point. Client copy is field-derived constants, matching `RUN_CONFIG_ERROR_COPY`'s
  #269-established rule that daemon message text is never surfaced.
- **[Concurrency]** No findings. No async task, no timer, no listener, no `AbortController`, no
  check-then-act across an `await`. The read is synchronous during render; the store's single writer
  is #588's subscription, untouched here.
- **[Threat model — hostile daemon]** Addressed. A hostile daemon inside the Noise session controls
  `model` and `truncated` freely. Enumerated outcomes: (a) markup injection — closed by React text
  escaping plus the attribute-shaped guards; (b) forging the sheet's truncation claim — closed by the
  sibling-element marker; (c) *suppressing* a truncation claim by sending a catalog token — closed by
  branching the marker on `truncated` alone rather than on the lookup outcome; (d) impersonating a
  well-known model — inherent to the daemon being trusted to report its own model at all, and
  *narrowed* by this design, since exact matching means a daemon must send the exact catalog token to
  get a friendly name, where the pre-existing `matchedFamily` would accept any string containing
  `opus`; (e) resource exhaustion — covered above.
- **[Threat model — renderer compromise]** Out of scope and unchanged. A compromised renderer already
  has this state; this slice grants it no new capability, no new IPC channel, and no new secret.
- **[Threat model — malicious relay]** Not applicable to this slice: the relay is content-blind and
  on-path only; drop / delay / reorder of an announcement degrades to the not-yet-known or a stale
  state, both of which render honestly. The stale-across-pairings latch is the known gap, named as
  out of scope and filed as **#593**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-20
