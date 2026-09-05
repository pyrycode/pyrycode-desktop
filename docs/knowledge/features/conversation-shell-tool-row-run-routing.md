# Conversation shell — tool row run routing

Split out of [Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to
keep every section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Tool row header run routing (#855)

Makes #854's Left group's two runs (`.tool-row__name` the lead, `.tool-row__summary` the subject)
independently switchable per call, instead of always both — the change that turns a thread of shell
calls from a wall of identical `Bash` chips into a scannable column. One row, two parts, either can be
off; never two row styles. `toolHeadline.ts` and `ConversationScreen.tsx` only; no new file, no CSS
change beyond one declaration (below), no new token.

**The routing, as three cases.** A `Bash` call carrying a `description` draws it in the subject with
**no lead at all** — the subject starts at the header's hard left, since `.tool-row__left`'s `gap`
only falls *between* children. A `Bash` call carrying a `command` but no `description` draws the raw
command in the lead — `.tool-row__name` verbatim, no modifier class — with **no subject at all**.
Every other call, including a `Bash` call whose input map is absent or carries neither field, keeps
today's shape unchanged: the tool name in the lead, `toolHeadline(item)`'s picked text in the subject.
That third case is not re-derived, it **is** the pre-#855 expression — `toolHeadlineRuns`'s fallback
arm literally returns `{ lead: source.name, subject: toolHeadline(source) }` — which is what makes "a
path tool, a search, a long-tail MCP call all render exactly as they did before" structural rather than
a third branch that could drift.

**Keyed on the TOOL, checked before the field.** `toolHeadlineRuns` first tests
`source.name === BASH_TOOL_NAME`, and only inside that branch probes which of `description`/`command`
the picker's rule 1 landed on. A router keyed on the picked *key* alone would have been wrong: measured
over the same 2026-08-24 corpus, subagent launches carry `description` on all 208 calls and task
creation on 97.5% of 121, and `description` sits last in `PREFERRED_FIELDS` — so a key-only rule would
silently strip the tool name off every one of those rows too. `===`, never `startsWith`: `BashOutput`
is a real tool name that carries its own `command` field and must keep the general treatment, the same
ruling `toolBody.ts`'s `isShellCall` (#780) already recorded for the identical reason.

**`toolHeadline` itself is untouched.** Its four-rule chain, `PREFERRED_FIELDS`, `PATH_FIELDS` and the
shortening decision are byte-identical, and its 299-line test file needed only an import-line edit —
that's the evidence AC4 rests on ("the picker's Bash-first rule and preferred-field order are
unchanged"). `toolHeadlineRuns` calls `toolHeadline` for the fallback case rather than reimplementing
rule 1, and re-probes with the same module-private `firstNonEmpty`/`BASH_FIELDS` a shell call already
failed — deliberate redundancy, not an oversight, since exporting `pick` and branching on its key would
let a future edit change rule 1's probe without changing the router's. `BASH_FIELDS` is now built from
two named constants (`BASH_DESCRIPTION_FIELD`, `BASH_COMMAND_FIELD`) rather than repeating the two
strings, so a third field added there without a matching switch clause fails loud rather than routing
silently to the lead.

**`ToolHeadlineRuns` is two independent nullable fields, not a discriminated union** — `{ lead: string |
null; subject: string | null }`. The three reachable shapes are the *product* of two independent
presence facts and `ToolRow` reads them independently, so CLAUDE.md's sealed-union convention (scoped to
daemon events and user actions crossing a boundary) doesn't reach a screen-local helper's return.
`null` means draw no element; `''` still means draw the element with no text — the pre-existing shape
for a call whose `inputSummary` is empty. `ToolRow` tests `!== null`, never a bare `&&`, for exactly
that reason: a truthiness test would silently drop the subject on that call too. Both switches live in
the shared `chipRuns` fragment `ToolRow`'s `<button>`/`<div>` fork both consume, so a still-running
(pending) shell call routes identically to a resolved one.

**The stale `BASH_FIELDS` figure is corrected in place.** The doc comment used to cite 1397 of 6459
`Bash` calls (22%) with no `description`; it now cites the 2026-08-24 measurement — 93227 calls across
4988 sessions, shell 62.4% of them, 6538 of 58199 shell calls (11.2%) with no `description` — matching
the figure `toolBody.ts` already carried. The comment's *argument* changed along with the number: the
fallback used to read as "keeps the row from going blank on a quarter of shell calls"; since #855 it's
stronger than that — on those 6538 calls the command is the row's **entire** visible content, not a
substitute for a headline.

**One CSS declaration, where the spec predicted zero.** `min-height: var(--text-body-medium-line)` on
`.tool-row__left`. Before #855 every row drew the subject, whose 20px line box set the header's height
unconditionally; an undescribed shell call now draws the mono lead alone, whose leading is 16px, so
without a floor that row rendered 4px shorter than its neighbours — the ragged-heights failure #854's
two groups exist to prevent, caught by the new e2e test before the rule was added. Stated as the *left
group's* floor rather than a height on the chip or a modifier on the lead, so it stays true for #856's
count node too. **The design and the shipped box differ by 2px and that's expected, not a bug**: Figma
draws every collapsed row at 36px, but the shipped row computes to 38px once `.tool-row__chip`'s
`--space-2` padding and 1px border are added on both sides — the file's own ±2px convention, not a
miss on the `min-height` value.

**Lesson for the next conditional-run ticket (#856's count node included): switching a run off can
silently change a row's height, not just its content.** A flex row's height tracks its tallest child's
line box; removing the run with the larger leading (body-medium's 20px) shrinks the row to the
survivor's (mono's 16px) unless something floors it. Neither the `renderToStaticMarkup` unit tier nor a
plain element-count assertion can see this — only geometry, so only e2e catches it.

**Tests.** A new `describe` block in `toolHeadline.test.ts` (10 cases) covers the description-wins,
command-only, empty-description-falls-through, absent-input-map, empty-input-map, neither-field,
`BashOutput`-keeps-general-treatment, non-shell-tool-with-description, path-tool and search/long-tail
shapes, plus a structural pair test that `toolHeadlineRuns` never returns both runs `null` and that its
`subject` equals `toolHeadline(source)` on every non-shell source. `ConversationScreen.test.tsx` gained
6 markup cases (no-lead-element, no-subject-element, both-reach-the-pending-row, absent-input-map is
today's shape, every-other-call byte-identical, the escaping posture on the new lead run) and one
existing assertion was **updated, not loosened** — #780's headline-repeat case (`:920`'s occurrence
count) now finds `CMD_SENTINEL_zzz` in the lead plus the code block, not the subject plus the block. A
new sibling `test(...)` in `e2e/tool-row-toggle.spec.ts` pins the subject's hard-left start (content-box
edge, not hardcoded), the lead's computed font/color/size/line-height matching a path row's lead
comparatively (never literal token values), and the height-parity fact above.

**What this does not touch:** `toolHeadline`'s rules (above); #780's shell command block and #706's
field list, both keyed on `BASH_TOOL_NAME` independently of where the headline lands, so neither moves
in either direction; #722's width mechanic and its three e2e width equalities; #854's chevron and right
group; the pending row's 50% dimming and the error row's border, neither drawn by the Figma source and
neither an instruction to drop.

See commit `b404285` for the full record; there is no `docs/knowledge/codebase/855.md` — that directory
was frozen 2026-08-26, and this section is #855's only home.

