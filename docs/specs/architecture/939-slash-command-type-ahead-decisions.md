# #939 — the slash type-ahead's opening, filtering and completion decisions

One pure module in `src/renderer/src/screens/conversation/` that answers, from the composer's text and
the published command list alone: does the panel open, which rows does it show and in what order, and
what text does a picked row put in the box. No component, no store read, no mount — #940 composes it
with `ComposerOptionsPanel` and `resolveComposerOptionsKey`.

## Files read

- `src/renderer/src/screens/conversation/composerOptionsKeyboard.ts` → `resolveComposerOptionsKey`,
  `initialFocusedOptionIndex` — the sibling this composes with, and the module shape being copied
  (pure data, `environment: 'node'`-provable, container left thin enough to inspect). Its header names
  this ticket's parent as its reason for being standalone; its `Enter` arm is already range-guarded for
  the narrowing this module causes.
- `src/renderer/src/screens/conversation/composerOptionsKeyboard.test.ts` — the spec shape to mirror:
  AC-tagged `describe` blocks, a totality sweep, comments carrying the *reason* rather than the
  restatement.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsPanelOption`,
  `ComposerOptionsPanel`, `ComposerOptionsMenu` — the eventual render surface. Two things matter here:
  its consumers gate on `options.length` (so "no rows" already means "no panel" in this cluster), and
  its row text is an ordinary auto-escaped React child, which is where a command `name` lands.
- `src/shared/wire/types.ts` → `WireSlashCommand` — the row type, and the doc comment carrying the
  cut-aliases rule this module transposes, the trust tier, and the measured facts (33 of 51 hints
  empty, `__remote-workflow`, `0x0a` the only sub-`0x20` byte).
- `src/shared/wire/types.test.ts` § `slash-command-list wire vocabulary (#935)` — the committed
  upstream fixture rows (`claude-api`, `clear`, `config`, `model`, `usage`) this spec lifts its
  fixture from, so a contract change shows up as a fixture diff rather than as two hand-written
  guesses disagreeing. `clear`'s `aliases: ['reset', 'new']` is the ticket's own worked case.
- `docs/knowledge/features/slash-command-list-wire-types.md` — the collapse ("claude never emits
  `aliases: []`; 42 of 51 omit the key, 9 carry a non-empty one"), and why the unknown-aliases reading
  is only sound on a narrowed frame.
- `docs/knowledge/features/slash-command-list-store.md` → `selectSlashCommandListFor`,
  `SlashCommandListEntry` — the read surface #940 will feed this module from: `null` for "no frame has
  arrived", an entry with `commands: []` for "claude published an empty menu". Both are inputs this
  module must answer *closed* for, through different arms. It also records that rows are held verbatim
  and by reference, which is why this module returns the row objects rather than a projection.
- `CLAUDE.md` § Conventions — the daemon-text ruling in full, and the renderer-test posture that makes
  a pure module the only provable form of this behaviour.

## Design source

**Figma:** N/A — this slice renders nothing. It exports two functions and no markup, no component and
no CSS; the panel it feeds is #838's shipped `ComposerOptionsPanel`, already built to its own Figma
node (121:3879). The visual-fidelity check belongs to #940, which mounts it. The ticket body carries no
`## Figma` section for the same reason, which is a correct omission rather than a refiner gap.

## Context

The commands already work — the composer sends text straight through, so `/compact` typed by hand runs
today. What is missing is discovery: the operator has to know the name, spell it, and gets no feedback
until the reply comes back. This slice is the decision half of the type-ahead.

It is a module rather than a handler for `composerOptionsKeyboard.ts`'s reason verbatim: nothing in this
repo can click. `vitest.config.ts` sets `environment: 'node'`, there is no jsdom and no
`@testing-library`, and every renderer spec renders through `renderToStaticMarkup`. So the proof has to
be *arranged* — everything the type-ahead decides becomes a total function over two values a vitest spec
can supply, and what is left in #940's container is the `useState` and the wiring, thin enough to be
correct by inspection.

No ADR is warranted. This makes no architectural choice of its own: it is the fifth module in an
established local cluster (`composerSend`, `composerOptionsPlacement`, `composerOptionsKeyboard`,
`threadScrollPosition`), and the one cross-cutting rule it applies — a cut `aliases` reads as *unknown*
— is already legislated at `WireSlashCommand` and in
`docs/knowledge/features/slash-command-list-wire-types.md`. This slice transposes it; it does not
decide it.

## Design

`src/renderer/src/screens/conversation/slashCommandTypeAhead.ts`, two exported functions and no
exported types.

```ts
function slashCommandTypeAheadRows(
  text: string,
  commands: readonly WireSlashCommand[] | null
): readonly WireSlashCommand[]

function completeSlashCommand(command: WireSlashCommand): string
```

**The returned array *is* the open state — there is no `open` flag, and that is the point.** AC1 says
the panel opens exactly when the text is a bare slash-fragment *and* there is at least one row to show,
and that "no match reports closed rather than showing an empty box". Encoding the answer as a row list
whose emptiness means closed makes the state "open with zero rows" unrepresentable, rather than
forbidden by a guard someone can forget. All six closed cases the AC enumerates — empty text, a slash
after any other character, a slash followed by a space, `commands === null`, `commands === []`, and a
fragment nothing can match — return `[]` through this one encoding. It also matches the cluster's
existing convention: `ComposerOptionsMenu`'s consumers already gate on `options.length`, and
`resolveComposerOptionsKey` already answers `ignore` for everything but `Escape` at `optionCount <= 0`.
The one hazard is that `[]` is truthy, so the container writes `rows.length > 0 && <panel/>`, never
`rows.length && …`; the docblock says so.

**Rows are returned by reference, the array is fresh per call.** The row objects are the ones the store
holds — verbatim, snake_case, nothing projected or normalised, matching `slashCommandListStore`'s own
posture. The array itself is a new one each call and its identity is deliberately **not** a contract:
#940 must not `useEffect` on it. (`ComposerOptionsMenu`'s layout effect already deps on `[open]` alone,
for exactly this reason, so a fresh array costs nothing there.)

Two private helpers, neither exported:

- `openFragment(text): string | null` — the open predicate and the fragment reader in one, matching
  `/^\/(\S*)$/`: `null` when the text is not a bare slash-fragment, otherwise the characters after the
  slash (`''` for a lone `/`). One regex covers everything the parent ticket asked for, because claude
  only intercepts a message that *begins* with a slash: a slash first opens, a slash anywhere else
  matches nothing, deleting the slash closes, and the space before an argument closes. `\S` rather than
  a literal space so a tab or a newline closes it too — a fragment is one unbroken run by construction,
  and JS's `$` is strict end-of-input (it does not match before a trailing newline the way Python's
  does), so `"/foo\n"` is closed.
- `hasUnknownAliases(command): boolean` — `truncated_fields !== null && truncated_fields.includes('aliases')`,
  written with the explicit null test rather than `?.includes(…)`. The optional-chaining form is the
  exact shape `WireSlashCommand`'s doc comment names as the trap: on an unvalidated frame an absent key
  is `undefined` and `?.` is falsy for the same reason `null` is, silently inverting the rule.

**Matching, as three buckets rather than a sort.** One pass over `commands`; each row is ranked against
the lower-cased fragment over its own `name` and each of its visible `aliases`, and pushed into one of
three arrays that are concatenated at the end. Stable by construction, so claude's published order is
preserved within each bucket with no appeal to `Array.prototype.sort`'s stability guarantee:

| bucket | membership |
| --- | --- |
| prefix | `name` or some alias **starts with** the fragment |
| contained | no prefix hit, but `name` or some alias **contains** it |
| unknown | nothing visible matched, and `hasUnknownAliases(command)` |

A row that merely contains on its `name` but prefixes on a *later* alias ranks prefix, so the per-row
scan keeps looking after a contains hit rather than breaking on it. An empty fragment (a lone `/`)
prefix-matches every row through `''.startsWith('')`, yielding the whole list in published order with
no special case — and a cut-aliases row lands in the prefix bucket there, because its **name** genuinely
matched.

**Case folding is `toLowerCase()`, never `toLocaleLowerCase()`, and there is no other normalisation.**
The locale-aware form makes the same input match differently for a Turkish-locale user (dotless `i`);
the ticket asks for the case-insensitive comparison and nothing beyond it, so no `normalize()`, no
trim, no charset assumption — one measured name is `__remote-workflow`.

**`completeSlashCommand` takes the whole row, not `(name, argumentHint)`.** Two `string` parameters
transpose silently and produce a wrong answer with no type error, which is
`composerOptionsPlacement.ts`'s stated reason for taking an object; here the row is already the natural
unit. It returns `` `/${name}` `` with exactly one trailing space when `argument_hint !== ''` and none
when it is `''` — a literal emptiness test, not a trimmed one, since 33 of the capture's 51 entries
carry an empty hint and normalising the other 18 is normalisation nobody asked for. The name is copied
**verbatim**: no escape, no trim, no case change. It is a canonical name even for a row matched only by
an alias, so nothing downstream has to resolve an alias back. The two rules agree by construction — a
hinted completion ends in a space, and a slash followed by a space is closed — so the panel gets out of
the way exactly when an argument is about to be typed.

**Deliberately not handled:** a cut `name` (per the ticket: completing a truncated name costs a
zero-cost "Unknown command", where a mishandled cut alias silently hides a working one), an empty
`name` (it matches only the empty fragment and completes to `/`; inventing an exclusion would be a
defence for a failure mode nothing has produced), and duplicate names (row identity for React keys is
#940's problem, and `name` may not be a key — it is not an identifier).

## State + concurrency model

None, and that is the slice. No store read, no subscription, no async work, no timer, no listener, no
`AbortSignal`, so there is nothing to cancel or tear down. Both functions are pure and synchronous:
same inputs, same output, no mutation of the arrays or rows handed in (`commands` is `readonly` and the
buckets are freshly allocated). Where the inputs come from is #940's business — `selectSlashCommandListFor(openId)`
for the list, the composer's controlled value for the text.

## Error handling

No result type and no throw: both functions are **total** over their declared parameter types. A
malformed frame cannot reach here — #936's fail-closed narrower already rejected it in the main
process — so a second, weaker check in the renderer would only invent a disagreement with the one that
matters. The degenerate inputs are answers, not errors: `commands === null` (no frame has arrived) and
`commands: []` (claude published an empty menu) both return `[]`, which is exactly the closed panel,
and text that is not a slash-fragment does the same.

**No logging anywhere in this module**, inherited from the store's path and binding here for the same
measured reason: `0x0a` is the only sub-`0x20` byte across the capture's 51 entries' four string
fields, so the control character that actually occurs is the one that splits a log line. No
`console.*`, no diagnostic for "nothing matched", and no error message that could embed a row.

## Testing strategy

`slashCommandTypeAhead.test.ts`, co-located, vitest, `environment: 'node'` — the whole slice is provable
there because it touches no DOM and no React. Nothing needs a Playwright spec: this module has no
transition to drive, and #940 owns the interaction tier when it mounts one.

Fixture rows are lifted from `src/shared/wire/types.test.ts`'s committed upstream values (`claude-api`
with its abridged newline-and-em-dash description and reported `description` cut, `clear` with
`aliases: ['reset', 'new']`, `config`, `model`, `usage`), plus two hand-authored rows the ACs name: one
whose `truncated_fields` is `['aliases']`, and `__remote-workflow`.

Scenarios, by AC:

- **AC1, opening** — `/` alone opens on the whole list; `/cl` opens; empty text, `hello`, `say /clear`,
  `/clear ` (trailing space), `/clear x`, `"/foo\n"`, `commands === null`, `commands === []`, and `/zzz`
  each yield `[]`. Both no-frame and empty-menu are asserted separately, since they are different
  states in the store and must not be distinguished here.
- **AC2, filtering and order** — `/c` returns the c-named rows in published order; a fragment matching
  only mid-name (`onfi`) still returns the row; a fragment that prefixes one row and is contained in
  another orders the prefix first regardless of published position (a "return the filter result"
  implementation fails here); `/CL` and `/cl` return the same rows, proving case-insensitivity in both
  directions; `reset` finds `clear` by alias, and the row returned is `clear` itself.
- **AC3, unknown aliases** — a row with `truncated_fields: ['aliases']` whose visible name and aliases
  fail to match is still returned; it sorts **after** every genuine match (asserted as a position, not
  as membership); as the only candidate it opens the panel rather than closing it; and a row with
  `truncated_fields: null` in the same position is excluded, which is the control that proves the
  bucket is driven by the flag and not by an accident. A `truncated_fields: ['description']` row is
  excluded too — naming a *different* cut field must not grant the exemption.
- **AC4, completion** — `/clear ` for a hinted row, `/usage` for an empty-hint row, the canonical name
  for a row reached by the alias `reset`, and the same for a cut-aliases row; the trailing space is
  asserted as exactly one character, and the hinted completion is fed back through
  `slashCommandTypeAheadRows` to pin the "completing closes the panel" agreement as an executable
  property rather than a comment.
- **AC5, purity and untrusted input** — `__remote-workflow` matched and completed with its leading
  underscores intact; a description carrying `\n` and a non-ASCII rune neither matched against nor
  altered (rows come back `Object.is`-identical to the fixture objects, which is the strongest form of
  "verbatim"); the input array not mutated and its published order unchanged after a call; and a
  totality sweep over a grid of texts × list shapes asserting every return is an array whose every
  element came from the input.

Gate (§ B2): `npm test -- src/renderer/src/screens/conversation/slashCommandTypeAhead.test.ts` and
`npm run build`. On a red typecheck, `npx tsc --noEmit -p tsconfig.web.json` runs separately before any
error count is read as the blast radius — `npm run typecheck` short-circuits on a node-side failure and
hides every renderer error.

## Open questions

1. Should the matched alias be reported alongside the row, so #940 can show *why* a row appeared
   (`reset → /clear`)? Deferred: no AC asks for it, and adding it now would export a wrapper type this
   slice has no consumer for. Resolution to be recorded in `## Revisions` if implementation forces it.
2. Is `\S` the right terminator, or should only a literal space close the panel? Proceeding with `\S`:
   a tab or a newline in the box means the text is no longer a bare command fragment, and treating them
   as fragment characters would offer completions for a string the user cannot send as a command.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary; the one that matters is upstream and explicit —
  `parseSlashCommandListPayload` (#936) in the main process is the single narrowing point, and
  `daemonConnection`'s decode guard drops a rejected frame, so no malformed payload reaches this
  module. What crosses in is structurally trusted and **content-untrusted**: `name`, `argument_hint`,
  `description` and every alias are workspace-authored, a *lower* tier than the claude-authored strings
  `model_list` carries. The design decision that makes this sound rather than lucky is that the module
  **depends on the narrowing for correctness, not just for safety**: `hasUnknownAliases` reads
  `truncated_fields !== null`, and on a bare-`as` frame an absent key would be `undefined` and invert
  the rule. This repo has no branded-string convention, so the tier is carried by docblock — the same
  mechanism `slashCommandListStore` and `announcedModelStore` use.
- **[Tokens, secrets, credentials]** Nothing on this path is a secret and none can reach it: the module
  takes a `string` and a row array, and the only value it produces is text for the user's own composer.
  It reads no store, no `window.pyry`, no storage of any kind — and none may be added: caching the
  match result in `localStorage`/`sessionStorage`/IndexedDB would put workspace-authored text into
  renderer web storage that outlives the pairing that scoped it, defeating #955's clear.
- **[File / storage operations]** No filesystem access. The live rule from the adjacent category is
  the one that binds: `name` **is not an identifier** (`__remote-workflow` is measured), so nothing here
  keys a cache, a memo or a lookup path by it. The three buckets are arrays; no `Map`, `Set` or object
  index is ever built from workspace-authored text, so a duplicate or empty `name` can collide with
  nothing. #940 inherits the rule for its React keys.
- **[Inter-process / Electron attack surface]** No IPC channel, no `contextBridge` surface, no
  `ipcMain` handler, no preload API, no `BrowserWindow` option and no navigation or protocol handler.
  The module does not dereference `window` at all, in render or out of it. Process placement is
  unchanged: this is a decision function over already-typed data, and the transport, keys and socket
  stay in the main process.
- **[Cryptographic primitives]** Not applicable by process placement rather than by absence: no
  randomness is generated (nothing here is a token, a nonce or an id) and no comparison is made against
  a secret, so neither the RNG rule nor `timingSafeEqual` has a site. The string comparison this module
  *does* perform is over public workspace text where timing carries nothing.
- **[Network & I/O]** No socket, no fetch, no request half — and the absence is deliberate rather than
  incidental: the menu arrives unsolicited and a client-side re-fetch for a missing one would turn a
  relay withholding the frame into a spin. Frame size is already capped by `MAX_PLAINTEXT_BYTES` before
  any parse (14,277 bytes for the whole measured 51), so no second bound belongs here; a
  stricter-than-wire cap would fail-close a valid frame. **Input-shaped DoS considered and dismissed on
  the arithmetic, not on faith:** the scan is O(rows × aliases × |fragment|) with a single
  non-backtracking anchored regex (`^\/(\S*)$` is linear), against a list the daemon caps and a
  fragment the composer bounds.
- **[Error messages, logs, telemetry]** The category with teeth here, and it is **binding on the
  implementation**: zero log calls, zero `console.*`, no "nothing matched" diagnostic, and no thrown
  error that could embed a row — the module is total, so it has no error path to leak through in the
  first place. The reason is measured: `0x0a` is the only sub-`0x20` byte across the capture's 51
  entries' four string fields, so the control character that actually occurs is the one that splits a
  log line, and a logged `description` would let a workspace author forge log records in a file
  readable by anything running as the user.
- **[Concurrency]** No findings, discharged by construction rather than by statement: no async work, no
  timer, no listener, no shared mutable state, and no `await`, so there is no check-then-act gap, no
  cancellation path to thread and nothing that can outlive the window. Both functions are pure, so
  concurrent calls cannot interfere.
- **[Threat model alignment]** The applicable desktop threat is the **hostile-workspace / hostile-daemon
  string** — a repository author who writes a command name or alias designed to be mistaken for another,
  or to escape a sink. This module answers the sink half by having no sink: its only output is plain
  text into a controlled `<textarea>` value, never markup, an attribute, a URL, a filename or a log.
  The *confusability* half — a workspace shipping a `/cIear` that reads like `/clear` — is **OUT OF
  SCOPE and named**: this module preserves claude's published order and does not rank, score or
  de-confuse, and no homograph defence is in any AC. It belongs with #940, which decides what a row
  looks like; the mitigation available there is showing the row's own `description` beside the name,
  which the panel already renders as an escaped text child. A malicious/compromised relay is upstream
  of the narrower and out of this slice's reach.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
