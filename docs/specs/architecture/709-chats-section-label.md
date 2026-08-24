# #709 — Relabel the non-promoted sidebar section to "Chats"

## Files to read first

- `src/renderer/src/screens/channels/ChannelList.tsx:252-284` — `renderBody`'s two-section JSX. Line 270 is the **only** production edit; 271 is its adjacent comment. Note the three `length > 0` gates at 254 / 265 / 268 — those are what AC4 guards, and they are not touched.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:1-39` — the `renderToStaticMarkup` harness. `render()` returns a plain HTML string with **no** React comment markers, which is what makes `toContain('>Chats<')` a valid exact-text pin (see Design § 3).
- `src/renderer/src/screens/channels/ChannelList.test.tsx:59-100` — the five assertions and one comment to update. `:98` keeps its `'>Channels<'` shape; `:63` keeps its bare `'Channels'` shape (pre-existing inconsistency, out of scope — neither line names the literal being changed).
- `e2e/save-as-channel-promote.spec.ts:102-144` — the default-tier locator pair. `:111` is the live locator; `:107` is one of the three comments that *argue from* the literal.
- `e2e/real-daemon-promote.spec.ts:80-140` — the real-tier twin. `:88` live locator, `:83` argument comment. Skipped by default, so nothing here can go red in CI.
- `src/renderer/src/screens/channels/channels.css:30-39` — the section-header rule. Confirms `on-surface-variant` + `opacity: .85` + label-large tokens already match the Figma node exactly. **No CSS work in this ticket.**
- `CLAUDE.md` § Conventions — the 2026-08-20 operator ruling on client-owned chrome strings (see Design § 1).

**Tooling note.** `codegraph` is wired but not indexed for this repo (`.codegraph/` holds only `.gitignore` + `config.json`; every `codegraph_*` call errors "CodeGraph not initialized" — confirmed 2026-08-24). This reading list was built by grep, which is also the correct tool here regardless: the changing token is a *display string literal*, 28 of whose 31 occurrences live inside comments — a symbol graph would not index any of them.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

The sidebar stacks two identically-styled label headers separated by a hairline rule: `Channels` (`103:2984`) above, `Chats` (`106:3257`, text child `106:3258`) below. Verified against the node, not assumed: `106:3258` is a TEXT node whose content is literally `Chats`, styled M3 label-large on `schemes/on-surface-variant` at 85% opacity — which is precisely what `.channel-list__section-header` already implements (`channels.css:31-39`). **The label text is the entire visual delta**; the header's type, color, opacity, spacing and the divider between the two trees are already shipped and unchanged.

## Context

The sidebar splits conversations by the promoted flag (`partitionActive` → `{ channels, discussions }`) and renders one header per non-empty partition. The promoted header already reads "Channels"; the non-promoted one still carries the mobile-era "Recent discussions". The desktop design names it "Chats".

This is the copy change alone, landing ahead of the structure that stacks on top of it: the host row is #710, workspace grouping #703, connection dots #672.

## Scope check

| Red line | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Total written LOC | ~600 | **31 modified, 0 net new** |
| New exported types / components | 5 | **0** |
| Acceptance criteria | 5 | **4** |
| Reject / error branches | 10 | **0** |
| Consumer call sites | 10 | **31 occurrences, 8 files** — see below |

Five of six lines clear by an order of magnitude. The sixth needs stating plainly rather than waving away, because 31 > 10 and the "they're only mechanical edits" framing is exactly the rationalization that sank pyrycode#75.

Two things distinguish this from that shape, and the second is the load-bearing one:

1. **No symbol changes.** The fan-out red line targets renamed interfaces, signatures, union members and props, where each consumer needs per-site reasoning to locate the edit and a wrong edit breaks the build. Nothing of that kind changes here — the body pins `discussions` identifiers, CSS classes and store fields explicitly out of scope. What fans out is one 18-character display literal with zero variants across 31 lines, 28 of them inside comments where a wrong edit cannot break a gate.
2. **No partition satisfies the line anyway.** The production label (`ChannelList.tsx:270`), its six unit assertions, and the default-tier e2e locator (`save-as-channel-promote.spec.ts:111`) must land in **one** commit or `npm test` and `npm run e2e` both go red. That atomic floor is already 3 files / 15 sites — above 10 on its own. The only separable residual is 16 comment-only edits across five e2e files, which would make a ticket with no behaviour, no test and no liveness proof, would leave AC2 unsatisfiable in the parent, and would re-touch two files the parent also touches — a guaranteed merge conflict that §1.5's own overlap check would serialize regardless.

Sizing stands at **XS**. Flagging the tension rather than hiding it: this ticket sits above one red line whose split has no valid slicing, not below it.

**Branch-overlap check (§1.5): clean.** `git fetch origin --prune` then a per-branch diff of every `origin/feature/<N>` against `main` found no other in-flight branch touching any of the eight files. No `blockedBy` needed.

**Security review: not applicable.** The ticket carries `enhancement`, `done:po`, `wip:architect`, `size:xs` — no `security-sensitive` label, consistent with the family's render-slice convention.

## Design

### 1. The production change — an inline literal, not a new constant

`ChannelList.tsx:270` — swap the JSX text child:

```tsx
<header className="channel-list__section-header">Chats</header>
```

Line 271's comment is re-worded from "Recent discussions pass the affordance…" to name the Chats rows instead. Nothing else in the file changes.

**Decision — no module-level constant.** The ticket body's Context paragraph reads "it is a client-owned module-level constant". The binding half of that requirement is **never a daemon string**, which an inline source literal satisfies completely — it is client-owned by construction. Introducing a named const for "Chats" while its sibling "Channels" stays inline one JSX block above (`:256`) would be gratuitous asymmetry, an adjacent-code refactor CLAUDE.md forbids, and would make the unit assertion tautological if the test then imported it. The house `SETTINGS_COPY` / `SERVER_ROW_LABEL` idiom cited in the body governs the settings screen, which has no such sibling-literal to diverge from. Code review should read the inline literal as the intended shape, not a missed requirement.

### 2. The substitution inventory — 31 occurrences, 8 files

Grep is the checklist; this table is the cross-check. If the two disagree, trust the grep.

| File | Sites | Kind |
|---|---|---|
| `src/renderer/src/screens/channels/ChannelList.tsx` | 270 · 271 | label + comment |
| `src/renderer/src/screens/channels/ChannelList.test.tsx` | 64 · 71 · 81 · 90 · 96 | assertions |
| ” | 97 | **argument comment — reword** |
| `e2e/save-as-channel-promote.spec.ts` | **111** | live locator, default tier |
| ” | 107 | **argument comment — reword** |
| ” | 21 · 47 · 103 · 120 · 138 · 152 | comments |
| `e2e/real-daemon-promote.spec.ts` | **88** | live locator, real tier |
| ” | 83 | **argument comment — reword** |
| ” | 32 · 38 · 81 · 111 · 116 · 135 · 136 | comments |
| `e2e/conversation-create-rename.spec.ts` | 31 · 108 | comments |
| `e2e/real-daemon-conversation-lifecycle.spec.ts` | 41 · 162 | comments |
| `e2e/real-daemon-workspace.spec.ts` | 92 | comment |
| `e2e/conversation-archive-lifecycle.spec.ts` | 147 | comment |

The literal is unique and variant-free, so a per-file `replace_all` handles 28 of the 31; the three marked rows need prose written by hand (§ 4).

**Vocabulary scope — deliberate and worth not "fixing".** Several comments say bare *"Recent"* or *"discussion"* without the literal (`ChannelList.tsx:257`, `ChannelList.test.tsx:51-56`, `save-as-channel-promote.spec.ts:104,127`, `real-daemon-promote.spec.ts:82,121`). AC2's grep does not catch these and they stay as written. That is correct, not an oversight: `partitionActive` still returns `{ channels, discussions }` and the affordance is still gated on the non-promoted partition, so prose saying "the Recent row's affordance" still names something real in the code. Renaming the domain vocabulary is #709-out-of-scope by the body. Expect mixed vocabulary — header says "Chats", code-level concept says `discussions` — until a future ticket renames the identifiers.

### 3. Unit assertions — five substitutions plus one strengthened pin

`ChannelList.test.tsx:64 · 71 · 81 · 90` are pure substitutions of the literal inside existing `toContain` / `not.toContain` calls.

`:96` (the discussions-only case) takes the anchored form instead of the bare one:

```ts
expect(markup).toContain('>Chats<')
```

**Why the one deviation from pure substitution.** AC1 is "the section label *reads* Chats", and a bare `toContain('Chats')` would pass against a label reading "Recent Chats" — it cannot fail in the direction AC1 cares about. The anchored form pins the header's exact rendered text, costs one character-pair, is valid because `renderToStaticMarkup` emits no comment markers around a single static text child, and makes that test internally symmetric with `:98`'s existing `not.toContain('>Channels<')`. Leave `:81` (both-sections case) bare, matching its bare `toContain('Channels')` neighbour at `:80`.

**No new tests.** AC4 is a regression guard, already covered: `:87-92` (channels only → no second header, no divider), `:94-100` (discussions only → no Channels header, no divider), `:74-85` (both → divider present), `:68-72` (loaded-empty → no headers).

### 4. The three argument comments — restate, don't substitute

`save-as-channel-promote.spec.ts:107`, `real-daemon-promote.spec.ts:83` and `ChannelList.test.tsx:97` do not merely name the literal; each *justifies* its locator or assertion on the grounds that "Recent discussions" does not contain "Channels", nor the reverse. Blind substitution leaves a sentence that is still true but no longer explains the real hazard, because the new pair is a much closer near-miss.

The reworded comments must carry this claim:

> `hasText` / `toContain` match on substrings. "Chats" and "Channels" share the prefix "Cha" but **neither is a substring of the other**, so each locator resolves only its own header.

For the two Playwright comments, add that `hasText` with a string argument is also **case-insensitive**, and that the non-containment holds case-insensitively too ("chats" ⊄ "channels", "channels" ⊄ "chats") — so the case-folding does not reopen the ambiguity.

### 5. Why the locators stay sound

- `.channel-list__section-header` has exactly two render sites, both in `ChannelList.tsx` (`:256`, `:270`) — verified by grep; the only other hit is a prose mention in `settings.css:93`. No third element can join the match set.
- The two headers are mutually exclusive per the `length > 0` gates, which is what makes "Channels appears AND Chats disappears" a valid proxy for "the row moved sections". Unchanged by this ticket.
- `"Chats"` occurs **0×** under `src/` and `e2e/` today, case-insensitively — verified by grep. The new literal collides with no existing locator, assertion or fixture name, in either direction: no fixture title contains "Chats", and "Channels" does not contain "Chats".

### 6. State, concurrency, error handling

None. `renderBody` is a pure function of `(conversations, now, handlers)`; no store slice, no async work, no subscription, no new failure mode, no IPC surface. The string is a compile-time constant with no daemon provenance, so no escaping or length-bounding question arises.

## Testing strategy

- **`npm test`** — the six `ChannelList.test.tsx` updates are this change's own liveness proof. `:96`'s anchored assertion fails if the label text is wrong in any way; `:64`/`:71`/`:90` fail if the header leaks into a state that should not render it.
- **`npm run build`** — the salvage gate; must pass.
- **Default-tier e2e** — `npx playwright test e2e/save-as-channel-promote.spec.ts` must pass. This is AC3's first half and the only *executed* proof that the new locator resolves against real rendered DOM.
- **Real-tier e2e** — `real-daemon-promote.spec.ts` is skipped by default, so a stale locator there stays green and the run still exits 0. It cannot be proven in this ticket. Its substitute proof is mechanical:

  ```bash
  grep -rn "Recent discussions" src/ e2e/    # must print nothing
  ```

  AC2 exists precisely to close that silent-green hole: the real-tier locator at `:88` is one of the 31 occurrences, so a clean grep is proof it was updated. Run this as the last step before committing.
- **`docs/` is out of scope.** Nine files there mention the literal as the shipped record of #141/#423/#440/#443/#451/#452. Scope the grep to `src/` and `e2e/`; rewriting the history would be wrong and would make AC2 unsatisfiable.

## Open questions

None blocking. One thing to hand forward: after #710 stacks a host row beneath each section label, the "exactly two `.channel-list__section-header` elements" invariant that both promote specs lean on will need re-checking — a repeated, class-selectable, text-containing element under those headers is the shape that turns a `hasText` locator into a Playwright strict-mode violation rather than a clean assertion failure. Out of scope here; noted for #710's spec.
