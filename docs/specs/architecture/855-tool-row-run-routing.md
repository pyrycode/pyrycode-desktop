# #855 — which of the tool row's two runs the headline lands in, per call

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/855

**Size:** S. Five files, **no new files**, **two production source files**
(`toolHeadline.ts`, `ConversationScreen.tsx`), two new exported symbols, **zero CSS changes**, zero new
tokens, zero new dependencies.

**Shape:** one new exported function beside `toolHeadline` that returns the two runs instead of one
string; two lines in `ToolRow` become conditional; one stale comment figure corrected; one existing
byte-level assertion updated; new unit cases in two files; one new e2e sibling test.

`toolHeadline` itself — its signature, its body, its four rules, its shortening decision — is **not
edited**, and `toolHeadline.test.ts` (299 lines) stays green **untouched**. That untouched file is the
evidence for AC4's "the picker's Bash-first rule and preferred-field order are unchanged"; a diff that
reaches it has overshot the ticket. Likewise `toolBody.ts`, `shortenPath.ts`, `conversation.css`, the
reducer, the wire types and the expanded body are **not touched**.

---

## Files to read first

Codegraph is wired but **not indexed** for this repo (`codegraph_status` → "CodeGraph not initialized",
re-probed 2026-08-31; the same result as the 2026-08-24, 2026-08-27 and #854 probes). Everything below
was located by grep/Read; the list is complete, so no exploratory sweep is needed.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/toolHeadline.ts:1-45` | The module header (why it is React-free, the SAFETY posture) and `ToolHeadlineSource` — the three-field contract the new function reuses verbatim. |
| `src/renderer/src/screens/conversation/toolHeadline.ts:75-83` | `BASH_FIELDS` and its doc comment. **The one stale figure this ticket corrects** (§ 4) and the list the new routing reuses. |
| `src/renderer/src/screens/conversation/toolHeadline.ts:100-120` | `firstNonEmpty` — module-private, returns `{ key, value }`. **This is the probe the new function reuses**; it is why the routing needs no second implementation and why nothing moves to a new file. |
| `src/renderer/src/screens/conversation/toolHeadline.ts:131-212` | `pick` and `toolHeadline`. Read the four-rule chain and the "shortening is keyed on the FIELD NAME" argument. **Neither is edited** — the new function calls `toolHeadline` for the general case. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:799-884` | `ToolRow` — the `command` const at `:820` (the `consumed twice → a const` precedent), and `chipRuns` at `:829-884`. **The only two lines edited are `:832` and `:838`.** |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:704-797` | The SAFETY comment block, ending at #854's paragraph. § 3 appends one paragraph in exactly that shape. Read it before touching the markup. |
| `src/renderer/src/screens/conversation/toolBody.ts:57-93` | `COMMAND_FIELD` (`:58`), `OMITTED_SHELL_FIELDS` (`:74`) and `isShellCall` (`:91`) — the **naming precedent** for the two field constants § 2 adds, and the recorded ruling on when to import `BASH_TOOL_NAME` versus re-declare a list. |
| `src/renderer/src/screens/conversation/toolBody.ts:95-135` | `shellCommandBlock`, and at `:103-107` the **already-corrected 11.2% figure** plus the recorded ruling that the header/body command repeat is wanted. § 4's edit brings `toolHeadline.ts` into line with this comment; § 5 says why the repeat survives. |
| `src/renderer/src/screens/conversation/conversation.css:1243-1306` | `.tool-row__left` / `.tool-row__right` / `.tool-row__chevron` (#854). `:1259-1263` is the recorded declaration that an over-wide lead **hard-cuts at the group boundary** — the ticket's "no new bounding rule". **Not edited.** |
| `src/renderer/src/screens/conversation/conversation.css:1308-1352` | `.tool-row__name` (`:1320`) and `.tool-row__summary` (`:1342`). Confirm the lead run's four type declarations and `flex: 0 0 auto; white-space: nowrap` before § 6 claims no CSS is needed. **Not edited.** |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:370-384` | The `toolItem(result, input?, name = 'read_file')` builder. Every new unit case below is one call to it — **no new fixture machinery**. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:541-600` | The #705/#854 byte-level block, `RESOLVED_CHIP_HEAD` / `RESOLVED_CHIP_TAIL`. These must stay green **unedited** (§ 7) — they render `read_file`, whose markup is byte-identical after this change. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:904-922` | **The one existing assertion that goes red by construction** (`:921`), and the comment above it that must be rewritten with it. Nothing else in this file's `Bash` block moves. |
| `src/renderer/src/screens/conversation/toolHeadline.test.ts` (all 299 lines) | Skim only. Its idiom is what the new `toolHeadlineRuns` cases follow, and the whole file must stay green **unedited**. |
| `e2e/tool-row-toggle.spec.ts:181-354` | #854's sibling test — `boxOf`, `WIDTH_TOLERANCE_PX`, the frame builders, `chipMetricsOf`, the `.nth()`-scoped locators. § 8's new test is a fourth sibling in this shape. |
| `src/shared/wire/types.ts:720-726` | `ToolUsePayload`, with `input?: Record<string, string>` at `:726`. Confirms the e2e fake can drive a shell call with an `input` map without any fixture change. |
| `docs/knowledge/features/thread-timeline.md` | The package overview's tool-row section — read for context. **Do not edit it**; the documentation phase owns it. |

**Trap carried from #854:** line numbers written *inside* `conversation.css` comments have drifted and are
wrong. Trust the class names in those comments, never their numbers, and do not "fix" them.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553

Real calls drawn into every case: [155-566](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-566).

One row, one header, two switchable runs inside the Left group (`156:629`): **Lead** (`155:555`) is
monospace tertiary at 14/16, hugging and never wrapping; **Subject** (`155:556`) is `M3/body/medium`
prose at 14/20/0.25 in on-background, filling the group and cutting when long. The two new cases hide one
run each — a described shell call (`155:621`) draws **Subject only**, starting at the Left group's hard
left with no leading gap, and an undescribed one (`155:662`) draws **Lead only**, carrying the raw
command line in the same mono tertiary type the tool name takes. The Right group, the chevron, the count
node and the row's chrome are untouched by this ticket.

Design-context readback, so the developer need not re-fetch:

| Figma | Value | Decision |
| --- | --- | --- |
| `155:662` Lead (the command) | `Roboto Mono`, `14px`, `leading-16`, `Schemes/tertiary`, `whitespace-nowrap`, `shrink-0` | **Exactly `.tool-row__name`'s shipped rule** — `--font-mono`, `--text-body-medium-size` 14px, `--text-tool-name-line` 16px, `--color-tertiary`, `white-space: nowrap`, `flex: 0 0 auto`. Reuse the class; add no modifier, no second rule. |
| `155:662` Lead tracking | none bound | `.tool-row__name` applies `--text-body-medium-tracking` (0.25px) to its mono run already, and #854 recorded why (sub-perceptual on a short mono identifier, inside the ±1px convention, and `.code-block__body` does the same). The same argument covers a command; **do not add a tracking override.** |
| `155:621` Subject, sole child | `flex: 1 0 0`, `min-w-px`, `overflow-hidden`, `text-ellipsis`, `whitespace-nowrap` | `.tool-row__summary`'s shipped `min-width: 0` + ellipsis chain, with the default `flex: 0 1 auto`. **Equivalent here** — see § 6. **Do not add a `flex` declaration.** |
| Left group gap | `12px` | `.tool-row__left`'s `gap: var(--space-3)`, unchanged. CSS `gap` applies only *between* children, so a single-child group has no leading gap — which is AC1's "starts at the header's hard left", for free. |
| Right group / chevron / count | unchanged from `155:553` | #854's and #856's. Not read, not drawn, not edited here. |

---

## 1. The shape of the change

Today `ToolRow` renders two runs unconditionally and calls `toolHeadline(item)` for the second one. The
row needs to render **zero or one** of each, and the choice depends on the tool and on which field the
picker's rule 1 landed on — a fact `toolHeadline`'s `string` return has already thrown away.

So one new function returns both runs, and the component renders each one that is non-null. The routing
rule lives in `toolHeadline.ts`, not in the component, for the module's own recorded reason: the renderer
test tier is `renderToStaticMarkup` in the `node` environment, so a rule expressed inside `ToolRow` could
only ever be asserted through rendered markup, while a rule expressed here is a value in and a value out.

**It stays in `toolHeadline.ts` rather than becoming a new file, and that is load-bearing rather than
tidiness.** The routing needs `firstNonEmpty` and `BASH_FIELDS`, both module-private. A new file would
have to export them, which would let a future edit change rule 1's probe without changing the router's —
exactly the drift `toolBody.ts:80-85` argues against for `BASH_TOOL_NAME`. Keeping them private makes
"the router probes what rule 1 probes" unreachable-to-break rather than merely true today.

---

## 2. The contract

Three additions to `toolHeadline.ts` and one correction. Nothing is removed and nothing existing changes
behaviour.

**Two module-private field constants**, in `toolBody.ts:58`'s `COMMAND_FIELD` idiom, with `BASH_FIELDS`
**built from them** rather than repeating their strings:

```ts
const BASH_DESCRIPTION_FIELD = 'description'
const BASH_COMMAND_FIELD = 'command'
const BASH_FIELDS: readonly string[] = [BASH_DESCRIPTION_FIELD, BASH_COMMAND_FIELD]
```

Why derived here, where `toolBody.ts:66-69` deliberately declares its list independently: this is not a
second copy of the same fact, it is **the same list, read twice** — once as rule 1's probe order and once
as the router's two-way key switch. If a third member were ever added to `BASH_FIELDS` and the switch
still read `=== 'description'`, the new field would silently route to the lead. Naming both members is
what makes the switch total over the list it switches on. `readonly string[]` and never `as const`, for
the reason `PREFERRED_FIELDS` already records.

**One exported result type.** Two independent nullable runs, not a discriminated union: the three reachable
shapes (both, subject-only, lead-only) are the *product* of two independent presence facts, and the
component reads them independently. CLAUDE.md's sealed-union convention is scoped to daemon events and
user actions crossing a boundary, not to a screen-local helper's return.

```ts
export interface ToolHeadlineRuns {
  lead: string | null
  subject: string | null
}
```

`null` means **draw no element**, and it is distinct from `''`, which means draw the element with no text
— today's shape for a call whose `inputSummary` is empty, preserved exactly (§ 7).

**One exported function**, `toolHeadlineRuns(source: ToolHeadlineSource): ToolHeadlineRuns`. Same argument
type as `toolHeadline`, so the call site still passes the whole item. Behaviour, as a chain:

1. If `source.name === BASH_TOOL_NAME` **and** `input` is present, probe
   `firstNonEmpty(input, BASH_FIELDS)` — rule 1's own probe, the same function and the same list.
   - key is `BASH_DESCRIPTION_FIELD` → `{ lead: null, subject: value }`
   - otherwise (the key is `BASH_COMMAND_FIELD`) → `{ lead: value, subject: null }`
2. Everything else, including a shell call the probe found nothing in →
   `{ lead: source.name, subject: toolHeadline(source) }`.

Rule 2 is **today's shape verbatim**, which is what makes AC3 and AC4 structural rather than three
branches that could drift: the general row is not re-derived here, it is the one expression
`ToolRow` already evaluated.

**The tool test comes first and the key test only inside it.** This is the ticket's central ruling and it
must be stated in the doc comment: `description` is not exclusive to shell calls — subagent launches carry
one on all 208 corpus calls and task creation on 97.5% of 121 — and `description` is last in
`PREFERRED_FIELDS`, so a router keyed on the picked key alone would strip the tool name off those rows
too. `===` and never `startsWith`, for `BashOutput`'s sake: it is a real tool name, it carries a `command`
field of its own, and it must keep the general treatment. This is `toolBody.ts:87-89`'s ruling, reached
independently for the same reason.

**The second probe inside `toolHeadline` is deliberate redundancy, not an oversight.** On a shell call
that falls through to step 2, `pick` runs rule 1 again and finds nothing again. That is what keeps
`toolHeadline` a black box this function *calls* rather than reimplements; the alternative — exporting
`pick` and branching on its key — is the coupling § 1 exists to avoid.

**`toolHeadline` stays exported.** Its only production consumer moves to `toolHeadlineRuns`, but the
export and its 299-line test file are what pin "the picker is unchanged". Do not un-export it, do not
inline it, do not fold its tests into the new ones.

---

## 3. The markup

`ToolRow` keeps its `result` binding, its `rowClass`, its `body`, its `command`, its `<button>`/`<div>`
fork, both group wrappers and the whole trailing group **unchanged**. Two lines inside
`.tool-row__left` become conditional:

```
<span className="tool-row__left">
  {runs.lead !== null && <span className="tool-row__name">{runs.lead}</span>}
  {runs.subject !== null && <span className="tool-row__summary">{runs.subject}</span>}
</span>
```

`const runs = toolHeadlineRuns(item)` is declared beside `command` (`:820`) and for the identical stated
reason: it is consumed twice, and `command`'s comment already records that a value consumed twice gets a
`const` while one consumed once stays inline.

Four things are load-bearing and each must be stated in the comment beside it:

- **`!== null`, never a bare `&&` on the string.** `runs.subject` can legitimately be `''` (a call whose
  `inputSummary` is empty — `toolHeadline.test.ts:228` pins that return), and a truthiness test would
  silently drop the element for it, changing today's markup. Naming the one falsy value that means
  absence is `command !== null`'s shipped argument at `:929`, on the same kind of value.
- **The classes do not change and no modifier is added.** A command in the lead uses
  `.tool-row__name` verbatim, which is AC2's "in the same type and ink the tool name takes there"
  expressed as the cascade rather than as a second rule (§ 6). No `--command` variant, no inline style.
- **Nothing is gated on `result` here.** Both switches live entirely inside the left group, which reaches
  the pending `<div>` branch and the resolved `<button>` branch through the one shared `chipRuns`
  fragment. A described shell call that is still running draws its subject and no lead, exactly as
  Figma's "Find all assertNever sites" row does.
- **No empty element in either direction.** AC1 says the lead is off, not blank; a rendered
  `<span class="tool-row__name"></span>` would still take one side of the left group's 12px gap and push
  the subject off the hard left. This is #854's "the whole group, not just the chevron" argument one
  level down, and § 7's first two unit cases pin it.

### The SAFETY block

Append one paragraph in the block's existing shape (`:783-787` is #854's, the model to follow). It says:
**#855 adds no newly untrusted string and opens no new sink.** `command` and `description` already reach
the DOM today — as `.tool-row__summary`'s children via rule 1, and `command` again as the code block's
`<pre>` children — so this ticket only **moves** an existing untrusted string between two `<span>`s that
both already carry auto-escaped daemon text. Two clauses inherited verbatim, each a MUST FIX if it ever
appears:

- **NO `title`, a sixth time.** The lead now holds a value that hard-cuts (§ 6), which makes
  `title={command}` the natural next edit for whoever notices. The answer to a cut lead is that the row
  opens and the body draws the command in full, unwrapped and unbounded — never an attribute.
- **NO linkification of a command, and no `AssistantMarkdown` for either run.** `curl https://…` is an
  ordinary shell command; an `<a href>` or a markdown render around it is the outbound-beacon shape
  `:769-781` already declined for the same string in the body.

One clause is genuinely new and is a MUST FIX: **the lead is still text children of a `<span>` and never
becomes anything else.** `.tool-row__name` previously only ever carried `item.name`; it now carries a
model-authored shell command line. `src/shared/wire/types.ts:696-699` states the contract that governs
it — display strings, not capabilities, never resolved, opened, fetched or executed.

---

## 4. The stale figure

`BASH_FIELDS`'s doc comment (`toolHeadline.ts:78-82`) cites "6459 real `Bash` calls, 1397 of them (22%)
carry no `description`". This ticket's measurement supersedes it: **93227 calls across 4988 sessions on
2026-08-24; shell is 62.4% of them; 88.8% of shell calls carry a `description`, so 6538 (11.2%) do not.**
`toolBody.ts:103` already carries the corrected 11.2%, so this edit brings the two files into agreement
rather than introducing a new number.

Correct the **rationale**, not only the digits. The old comment argued the `command` fallback prevents a
*blank* headline on nearly a quarter of shell calls. After this ticket the fallback is stronger than
that: on those 6538 calls the command is not a substitute for the headline, it **is the row's entire
visible content** — the only run drawn. Say so.

---

## 5. What this ticket does not change

State explicitly in the PR description, and keep every existing assertion green:

- **`toolHeadline`'s four rules, its preferred-field order, and its shortening decision.** A path tool
  still lands on `file_path` through rule 2 and is still shortened by `PATH_FIELDS` membership. Nothing
  here is a tool-name list: the only name matched anywhere is `BASH_TOOL_NAME`, which already exists.
- **#780's command block and #706's field list.** #780 keys on the same shared `BASH_TOOL_NAME` rather
  than on where the headline lands, so the two are independent in both directions. The header/body
  command repeat on an undescribed shell call is **not new and not a defect** — it ships today with the
  command in the subject, and `toolBody.ts:103-107` records why it is wanted. It moves to the lead; it
  does not appear or disappear.
- **The pending row's 50% dimming and the error row's border.** The design draws neither state; that is a
  gap in the design, not an instruction to drop behaviour.
- **#854's two groups, the chevron, and the chip's own gap, padding and width mechanic.** The count node
  (`155:557`) is #856's — do not draw it, do not add a placeholder, do not add a prop.
- **`conversation.css`.** Not opened for editing at all (§ 6).

---

## 6. Why there is no CSS change

Three claims, each checkable against the shipped rules:

- **The command lead needs no rule.** `155:662`'s Lead is mono / 14px / 16px leading / tertiary / nowrap /
  `shrink-0`, and `.tool-row__name` (`:1320`) is exactly that, token for token. Reusing the class is not
  an approximation of the design here; it is the design.
- **The sole-child subject needs no rule.** Figma gives it `flex: 1 0 0`; `.tool-row__summary` has no
  `flex` declaration, so it resolves to `flex: 0 1 auto`. The two differ only in whether the box *grows*
  past its content. With one left-aligned child in a `flex-start` container and nothing after it, growing
  changes no painted pixel — the text starts at the same x and ellipsises at the same width, because
  `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` still bound it against the group.
  **Adding `flex: 1 1 auto` would be a second idiom for the same job and a byte of churn; do not.**
- **An over-long command in the lead needs no new bounding rule.** `.tool-row__name` is
  `flex: 0 0 auto; white-space: nowrap` and `.tool-row__left` is `overflow: hidden`, so the lead
  hard-cuts at the group boundary — the design's own `overflow-clip`, recorded at
  `conversation.css:1259-1263`. The ticket rules that this is the intended degrade: the header cuts to
  one line and the body does not, and a command long enough to be cut is exactly why the row opens.
  **No `max-width`, no ellipsis on the lead, no second truncation chain.**

One inherited behaviour worth naming so nobody "fixes" it: a `description` or `command` carrying a
newline is collapsed to a space by `white-space: nowrap` on whichever run draws it. Both runs already set
it, so a multi-line value cannot break the single-line row from either side. This is unchanged — rule 1
already put such a `description` in the subject today.

---

## 7. Testing strategy

Test-first, per CLAUDE.md. Both new tiers assert on values and markup; no DOM, no clicks.

### `toolHeadline.test.ts` — a new `describe` block for `toolHeadlineRuns`

The five existing blocks are **not edited**. New scenarios, as bullets (the developer writes them in the
file's existing idiom — a bare call, a `toEqual` on the returned object):

- A `Bash` call with `description` (and a `command` beside it) → `{ lead: null, subject: <description> }`.
  The `command` beside it is load-bearing: it proves the description **wins** rather than merely being
  present.
- A `Bash` call with `command` and no `description` → `{ lead: <command>, subject: null }`.
- A `Bash` call with `description: ''` and a `command` → the empty description is skipped and the command
  takes the lead. This is `firstNonEmpty`'s `!== ''` reaching the router; without it the row would draw a
  blank subject and no lead.
- A `Bash` call with **no `input` map at all** → `{ lead: 'Bash', subject: <inputSummary> }` (AC4).
- A `Bash` call with `input: {}` → identical to the line above. Reads the same by design, as rule 4 does.
- A `Bash` call whose `input` carries **neither** field but does carry something else (e.g.
  `{ timeout: '5' }`) → `{ lead: 'Bash', subject: '5' }` — today's shape, the picker's rule 3 untouched.
  The gap the ticket's table does not spell out, resolved by falling through rather than by a new branch.
- **`BashOutput` with a `command` field** → `{ lead: 'BashOutput', subject: <command> }`. The load-bearing
  negative: it is the name a `startsWith` test would wrongly catch, it really carries a `command`, and it
  must keep the general treatment.
- **A non-shell tool carrying a `description`** → `{ lead: <name>, subject: <description> }`. Drive it
  with `Task` and a name in the `mcp__…` shape. This is the ticket's central ruling as a test: a router
  keyed on the picked key would return `{ lead: null, … }` here and strip the tool name off 208 subagent
  rows.
- A path tool (`file_path` deep enough to shorten) → `{ lead: <name>, subject: <shortened> }`, proving
  the shortening still happens through the untouched picker.
- A search (`Grep`, `pattern`) and a long-tail MCP tool (rule 3) → `{ lead: <name>, subject: <picked> }`
  (AC3's three cases).
- **A structural pair:** for a spread of sources covering every branch, `toolHeadlineRuns` never returns
  both runs `null`, and its `subject` equals `toolHeadline(source)` on every non-shell source. The second
  half is the machine-checked form of "rule 2 is today's shape verbatim".

### `ConversationScreen.test.tsx` — the markup half

**One existing assertion is updated, not loosened** — `:921`, inside "still draws the block when there is
no description, headline repeat and all (AC3)". The command now draws in the lead:

- `'<span class="tool-row__summary">CMD_SENTINEL_zzz</span>'` → `'<span class="tool-row__name">CMD_SENTINEL_zzz</span>'`.
- `markup.split('CMD_SENTINEL_zzz')).toHaveLength(3)` at `:920` **stays exactly as it is** — still twice,
  now lead plus block. Do not touch it.
- The comment at `:916-919` is rewritten in place: the repeat is still wanted and still for the same
  reason, but the header half is now the **lead**, routed by #855, not the summary via rule 1.

New cases, as scenarios:

1. **A described shell call draws no lead element at all (AC1).** `toolItem(resolved, { description: 'D' }, 'Bash')`
   → the chip is byte-pinned as `<span class="tool-row__left"><span class="tool-row__summary">D</span></span>`,
   and the markup contains no `tool-row__name` anywhere. Byte-level, in `RESOLVED_CHIP_HEAD`'s idiom — a
   `not.toContain('tool-row__name')` alone would not catch an empty element being emitted *and* the
   summary still being right.
2. **An undescribed shell call draws no subject element at all (AC2).** `toolItem(resolved, { command: 'git status' }, 'Bash')`
   → byte-pinned as `<span class="tool-row__left"><span class="tool-row__name">git status</span></span>`,
   and no `tool-row__summary` in the markup. The class is the type-and-ink claim; § 8 checks the cascade
   actually lands.
3. **Both new shapes reach a pending row too.** Render case 1's item with `result: null`; assert the same
   left-group markup inside the `<div>` chip. The switches live in the shared fragment, which is the half
   a resolved-row test cannot reach.
4. **A shell call with no `input` map is today's shape (AC4).** `toolItem(resolved, undefined, 'Bash')`
   → both runs, `Bash` in the lead and the builder's `inputSummary` in the subject.
5. **Every other call is byte-identical (AC3).** Drive a path tool, a `Grep`, and a long-tail
   `mcp__…` name; each renders both runs in order. Pairs with the untouched `RESOLVED_CHIP_HEAD` cases at
   `:566-600`, which already pin the `read_file` shape byte-for-byte and must stay green **unedited**.
6. **The escaping posture holds on the new run.** Render a shell call whose `command` is
   `'<img src=x onerror=alert(1)>'` with no description; assert the lead carries the escaped text and the
   markup contains no `<img`, no `title=`, no `aria-label`, no `href`. `:997`'s case is the model.

Everything else in this file stays green **unedited** — the whole `#697`/`#705`/`#854` block, the four
other `Bash` body cases at `:874`, `:924`, `:941`, `:958`, `:1018`, and `interactiveRoundtrip.test.tsx`.
They render `read_file` or assert on the body, and neither moves. **If one of them needs touching, the
routing is wrong.**

### E2E — one new sibling `test(...)` in `e2e/tool-row-toggle.spec.ts`

Two claims are cascade/geometry facts the `renderToStaticMarkup` tier structurally cannot observe, and
they are the two the ACs name in visual language. A **sibling test** launching its own app, in #854's
shape; the two existing tests are **not edited**.

Three rows land on the page, every locator scoped by `.nth()` (#670's strict-mode collisions):
`0` a described shell call, `1` an undescribed one, `2` a `read_file` call. Both shell payloads carry an
`input` map — `ToolUsePayload.input` already exists on the wire (`types.ts:726`), so this is one extra
field on the existing builder, not new fixture machinery. Assertions:

- **Row 0 (AC1's hard left):** `.tool-row__name` count 0, `.tool-row__summary` count 1, and the summary's
  box left edge equals the chip's **content-box** left (border-box x plus computed `padding-left` and
  `border-left-width`, read via `evaluate` rather than hardcoded) within `WIDTH_TOLERANCE_PX`. This is
  the assertion an empty lead element would fail while a `not.toContain` would not.
- **Row 1 (AC2's type and ink):** `.tool-row__summary` count 0, `.tool-row__name` count 1 carrying the
  command text, and its computed `fontFamily`, `color`, `fontSize` and `lineHeight` **equal row 2's**
  tool-name lead. A comparative assertion, never hardcoded token values, so a retune of the tokens does
  not turn this red — and a `--command` modifier class added later does.
- **Both shell rows still resolve normally:** `.tool-row__right` and `.tool-row__chevron` count 1 each,
  and the chip's height matches row 2's — one line, nothing pushed onto a second.

Not asserted here, on purpose: the hard cut of an over-long command. `.tool-row__left`'s `overflow: hidden`
ships and is #854's, this ticket adds no rule that could regress it, and the ticket rules the cut is the
intended degrade — a test for it would be a defence for an unobserved failure mode.

### Gates

`npm test`, `npm run typecheck`, `npm run build`, `npm run e2e`.

---

## 8. Open questions

None blocking. Two notes for the follow-ups:

- **#856** lands the count node in `.tool-row__right` and is untouched by this ticket in both directions:
  it reads the result, this reads the input, and they meet at no shared value. The Figma cases drawn at
  `155:566` show a count beside every one of this ticket's shapes.
- **The one residual the routing inherits**, stated so it is a known cost rather than a surprise: a
  `Task` or MCP call whose only useful field is `description` still draws its tool name in the lead, which
  is correct per the ticket's ruling but means a `description`-carrying non-shell row reads slightly
  denser than a shell one. That is the deliberate trade — a rule keyed on the tool cannot spread to a tool
  where the headline is a guess, and 95% of calls are the five known shapes.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary and no boundary moved. Both values this ticket routes —
  `input.description` and `input.command` — already cross the untrusted→display boundary at #642's
  decoder in the main process and arrive at the renderer as `Readonly<Record<string, string>>` on the
  item. `ToolHeadlineSource` (`toolHeadline.ts:37-45`) is the same narrowed contract `toolHeadline`
  already consumes; `toolHeadlineRuns` adds a reader of it, not a parser. Downstream, the two runs stay
  `string | null` all the way to auto-escaped React children — the same signal `toolHeadline`'s bare
  `string` carried. **One classification change, and it is narrower than the status quo, not wider:**
  `.tool-row__name` previously only ever held `item.name`, itself untrusted daemon text
  (`types.ts:686-687`), and now also holds `command`. Both are untrusted display strings reaching the
  same sink under the same escaping, so the *set* of untrusted strings in the DOM is unchanged and the
  *number of sinks* they reach is unchanged. § 3 records this in the SAFETY block.
- **[Tokens, secrets, credentials]** Not applicable, and the spec is what makes it so: nothing in this
  ticket reads, writes, derives, stores, logs or compares a token, key or credential. It adds no log line
  at all — deliberately, per ADR 0007's content-free rule, since any useful one here would carry
  `name`, `command` or `description` into a log file.
- **[File / storage operations]** Not applicable by construction, and this is the category the ticket most
  invites, so it is stated rather than skipped. The lead now carries a value the wire contract explicitly
  warns about (`types.ts:696-699`: "a `file_path` is not canonicalised and may be relative or traversing;
  a `Bash` `command` is a literal shell command line"). The spec's rule is that **the routed value is
  read exactly once, as text children of a `<span>`** — never a path, a filename, a cache key, a lookup
  key, an `import`, an `fs` argument or a `child_process` argument. The renderer has no filesystem
  capability to reach anyway, and `shortenPath` is applied only through the untouched
  `PATH_FIELDS.includes` test, which `description` and `command` are not members of — so a command line
  can never be mangled into something that reads like a path. No `path.join`, no `existsSync`, no
  TOCTOU surface.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API, no
  `webPreferences`, no protocol handler, no navigation surface is added or touched. The whole diff is two
  renderer files; nothing crosses `ipcMain`. The transport, keys and Noise session are untouched and stay
  in the main process — process placement is unchanged.
- **[Cryptographic primitives]** Not applicable. No randomness, no hashing, no comparison against a
  secret. The one equality this ticket adds is `source.name === BASH_TOOL_NAME`, comparing untrusted
  daemon text to a client-owned constant — a display-routing decision with no secret on either side, so
  `timingSafeEqual` would be noise.
- **[Network & I/O]** Not applicable. No socket, no fetch, no URL is constructed or dereferenced. The
  one adjacent hazard is real and is declined explicitly in § 3: the picker can promote a field literally
  named `url` into the subject, and the routed `command` routinely contains one — **no linkification, no
  `<a href>`, no `AssistantMarkdown` on either run**, because a daemon-chosen URL rendered as a link or an
  `<img>` from a privileged renderer is the outbound-beacon shape `ConversationScreen.tsx:769-781`
  already declined for this same string. MUST FIX if it appears.
- **[Error messages, logs, telemetry]** No findings. `toolHeadlineRuns` is total over its input type —
  every branch is a comparison, a property read or a call to two functions that are themselves total —
  so it throws nothing and produces no message that could carry daemon content. It adds no `console`
  call, no telemetry, no renderer DevTools output. The e2e test's one failure diagnostic names the
  element, never a value (`boxOf`'s shipped shape).
- **[Concurrency]** Not applicable. No async work, no timer, no listener, no `AbortController`, no store
  mutation. `toolHeadlineRuns` is a pure function of its argument called during render; `ToolRow`'s only
  state is the unchanged `useState` toggle, and no new check-then-act sequence is introduced.
- **[Threat model alignment]** The applicable desktop threat is **hostile daemon response**, and the
  design's answer is that this ticket narrows rather than widens what a hostile daemon can do with the
  header. A hostile daemon controls the tool name, both field names and both values. It can therefore:
  choose which of the two runs its text lands in (by sending or omitting `description` on a call it
  labels `Bash`) — a cosmetic choice between two runs that already render its text; send a 4000-rune
  command into the lead, which hard-cuts at the group boundary (§ 6) with no layout escape, since
  `.tool-row__left` is `overflow: hidden` and `.tool-row__right` is `flex: 0 0 auto`, so the chevron
  cannot be squeezed; or send a newline, which `white-space: nowrap` collapses to a space so the
  single-line row cannot be broken. Values are bounded daemon-side at 4000 runes and the row is bounded
  independently by CSS, so there is no unbounded-string vector here. **Malicious relay** is unaffected
  (content-blind, and this ticket adds no wire surface). **Token theft** and **renderer compromise
  reaching the transport** are out of scope and unchanged: the diff adds no capability the renderer did
  not already have.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-31
