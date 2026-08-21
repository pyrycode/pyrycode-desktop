# Spec — open `http:`/`https:` links in assistant markdown in the OS browser (#610)

**Size:** S (confirmed; PO said S). Two production files — the `a` override in `AssistantMarkdown.tsx`
and one rule appended to `conversation.css` — plus one rewritten unit-test block and one new e2e spec.
Production `*.ts`/`*.tsx` file count for the §4 gate: **1**.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-43

The assistant bubble `16:43` is a `surface-container-high` column at 14/12 padding holding body-medium
prose and a fenced code block. **The mock draws no link treatment at all** — there is no anchor anywhere
in the node, so the design source confirms scope rather than supplying it: the anchor's colour and
underline are derived from `tokens.css` below, and a bespoke link style would be a Figma-side addition
to `16:43` first (ticket body's own instruction).

## Files to read first

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:81-101` — the `components` object, the
  never-spread rule, and the existing deny-first `a` override this ticket replaces. **:90-96 is the
  comment that must be rewritten**, not just the one line under it.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:35-79` — `fenceLanguage`. The house style
  for a module-local, fail-closed helper with a docstring carrying the reasoning. `allowedLinkHref`
  below is its sibling and should read like it.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:5-19` — the file's stated vacuity
  rule (every negative assertion needs a positive one in the same case) and the `render`/`lines` helpers.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:98-126` — the four link cases. Three
  go red on this change and are rewritten; the `javascript:` one keeps its assertions verbatim.
- `src/main/index.ts:53-67` — `setWindowOpenHandler`. Read the exact shape: it calls `shell.openExternal`
  for `http:`/`https:` and returns `{ action: 'deny' }` on **every** path, including the allowed one.
  Unchanged by this ticket; this is the contract the renderer allowlist narrows to match.
- `src/main/index.ts:79-81` + `:95-104` — the `will-navigate` guard and `isSameTarget`. Read to understand
  why a *plain* anchor click would do nothing at all. Unchanged.
- `src/renderer/src/screens/conversation/conversation.css` — selectors `.bubble__markdown`,
  `.bubble__markdown > *`, `.bubble__markdown pre`, `.bubble__markdown h1`…`h6`, and
  `.bubble__markdown code:not(.code-block__body code)`. The last is #630's rule and is the append point.
  **Cite selectors, never line numbers** — the anchors moved when #609/#623/#628/#629/#630 landed.
- `src/renderer/src/theme/tokens.css:15-39` — the colour roles. `--color-primary` is `#9dcbfc`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:522` — the sole `.bubble__markdown` call
  site. This is the whole of AC4's "and nothing else" reach argument.
- `e2e/window-reopen-converges.spec.ts:44-75` — the `app.evaluate(({ BrowserWindow }) => …)` idiom off the
  `launchPairedApp` fixture's `app` handle, plus the positive-control discipline.
- `e2e/assistant-whitespace.spec.ts:615-650` — `launchPairedApp({ buildReplyFrames })` and how a reply is
  streamed into the thread and awaited before assertions.
- `docs/knowledge/decisions/0010-markdown-renderer-capability-absent-html.md:35` — the paragraph this
  ticket supersedes. **Read it, do not follow it** (see Trap 1).

## Context

Markdown rendering landed deny-first (#608/#609): `components.a` renders `<>{children}</>`, so no anchor
and no `href` ever reached the DOM whatever the scheme. That was deliberate — the repo was never in a
state where an unvetted href had shipped. This slice opens the allowlist to exactly `http:` and `https:`.

Three properties make this narrow rather than wide:

1. The decision is made **in the renderer, at render time, before an anchor element exists**. It does not
   lean on the main-process guards, because a `javascript:` href executes in the document rather than
   navigating it and so is never seen by `will-navigate`.
2. The renderer allowlist **narrows to match `setWindowOpenHandler`**, not the other way round. `mailto:`
   is permitted by react-markdown's default transform but denied by the handler, so it renders as text.
3. Relative and protocol-relative hrefs are denied **without being resolved**, so a dev build and a
   packaged build behave identically.

### Verified behaviour of react-markdown 10.1.0 (measured, not assumed)

Probed against `react-markdown@10.1.0` (the version `package.json` pins) with `renderToStaticMarkup`,
capturing the `href` the `a` override actually receives after the built-in `urlTransform` has run:

| markdown | `href` the override receives | `new URL(href)` with no base |
|---|---|---|
| `[t](https://example.com/a)` | `"https://example.com/a"` | `https:` |
| `[t](javascript:alert(1))` | `""` | throws |
| `[t](data:text/html,…)` | `""` | throws |
| `[t](file:///etc/passwd)` | `""` | throws |
| `[t](pyry-evil://do/thing)` | `""` | throws |
| `[t](mailto:a@b.example)` | **`"mailto:a@b.example"`** | `mailto:` |
| `[t](./doc.md)` | **`"./doc.md"`** | throws |
| `[t](//example.com/x)` | **`"//example.com/x"`** | throws |
| `[t]()` | `""` | throws |
| `[t](<not a url>)` | **`"not%20a%20url"`** | throws |
| `https://example.com` (bare text) | *no anchor created at all* | — |

Two conclusions, both load-bearing:

- **`urlTransform` alone cannot satisfy AC2.** Keeping the anchor and letting the transform sanitise
  emits `<a href="">t</a>` for `javascript:`, `data:`, `file:`, a custom scheme and an empty href — an
  anchor, a click target, and the literal string `href` in the markup, all three forbidden. The `a`
  override is therefore the enforcement point, and the transform is a prior, independent narrowing this
  design does not depend on.
- **`new URL(href)` with no base argument *is* the "reject without resolving" primitive.** Every relative
  and protocol-relative form throws on it. Nothing else is needed to get that property.

### The base-resolution divergence, measured

The ticket motivates rejecting relative hrefs by dev-vs-packaged disagreement. Verified:

| href | no base | dev base `http://localhost:5173/index.html` | packaged base `file:///…/index.html` |
|---|---|---|---|
| `./doc.md` | throws | `http://localhost:5173/doc.md` | `file:///…/doc.md` |
| `//example.com/x` | throws | `http://example.com/x` | `file://example.com/x` |
| `http:example.com` | `http://example.com/` | **`http://localhost:5173/example.com`** | `http://example.com/` |

The first two are the ticket's own argument, confirmed. **The third is a case the ticket does not name
and the scheme check alone does not close:** `http:example.com` is a scheme *without an authority*, so it
parses absolutely (allowed) but the browser still resolves it against the document base when the click
navigates — to the dev server in a dev build, to the real host when packaged. The design closes it with an
explicit authority requirement rather than accepting a known-divergent case in the one rule whose stated
purpose is making the two builds agree. It is bounded (both resolutions stay `http:`, so the allowlist is
never escaped) — but "bounded" is not "agrees", and agreeing is the criterion.

## Design

### 1. The predicate — `AssistantMarkdown.tsx`

One module-local helper, sibling to `fenceLanguage`, in the same fail-closed style:

```ts
/** The href verbatim when it is an absolute http/https URL carrying an authority; null otherwise. */
function allowedLinkHref(href: string | undefined): string | null
```

Total over every input, with **no error path and no logging** (the value is untrusted daemon text and the
repo's diagnostics are content-free, #126 — the same argument `fenceLanguage`'s docstring already makes).
Three conditions, each with a distinct job; a reader asking a different question reads a different line:

1. `href === undefined` → null. The prop is optional in react-markdown's types.
2. Parse with `new URL(href)` and **no base argument**; a throw → null. This is the reject-without-
   resolving rule: relative, protocol-relative, empty and unparseable hrefs all land here.
3. `url.protocol` is `'http:'` or `'https:'` → otherwise null. **This is the allowlist** — the one line to
   read when asking "what schemes ship". `protocol` is lowercased by the parser, so `HTTPS://…` is
   matched case-insensitively by construction; no `toLowerCase()` belongs here.
4. The original string starts `http://` or `https://`, case-insensitively → otherwise null. **This is the
   base-independence guard**, not a second scheme check.

Do **not** collapse 3 and 4 into a single regex even though 4 implies 3 today. They answer different
questions, and fusing them means a future widening of the allowlist silently also drops the authority
requirement. Keep both, each with its own comment naming its job.

**Return the original `href` string, never `url.href`.** The parser normalises: `https://example.com` →
`https://example.com/` (trailing slash added), `https://exámple.com/ä` → `https://xn--exmple-qta.com/%C3%A4`
(punycode + percent-encoding). AC1 requires the href **unchanged**, so the parse decides and the original
renders. This is safe precisely because of condition 4: with an authority present, the string that was
checked and the string the browser resolves are the same URL.

### 2. The `a` override

```tsx
a: ({ href, children }) => { /* allowed → anchor; else <>{children}</> */ }
```

- Destructure only `href` and `children`. **Never spread `{...props}`** — the file's existing absolute
  rule. A spread reintroduces `title` and every other attribute while the visible-text assertions keep
  passing. (Probe confirms `title` is among the props react-markdown supplies, for `[t](url "title")`.)
- Denied → `<>{children}</>`, byte-identical to today's behaviour. The visible link text renders; no
  element, no `href`, nothing clickable.
- Allowed → `<a href={allowed} target="_blank" rel="noreferrer">{children}</a>`.

**`target="_blank"` is the mechanism, not decoration.** It is what routes the click to
`setWindowOpenHandler` (which externalises to `shell.openExternal` and denies the in-app window). Without
it the click is a same-document navigation, `will-navigate` prevents it, and **the link does nothing at
all** — AC3 fails silently while the anchor still looks correct. This is the single most important line in
the change and needs a comment saying so.

`rel="noreferrer"` makes the anchor correct in isolation rather than correct-only-because-another-process
guards it — different fabric, one attribute. The handler denies the child window on every path, so no
opener relationship is ever created; this is belt to that suspender, not a load-bearing control.

Leave `urlTransform` **unconfigured**. It is already running (it is the default), it is not what enforces
anything here, and touching it would suggest otherwise.

### 3. The style — `conversation.css`

One rule, appended after `.bubble__markdown code:not(.code-block__body code)` (#630's), following the
established append order:

```css
.bubble__markdown a { color: var(--color-primary); text-decoration: underline; }
```

Reasoning that belongs in the comment above it:

- **Colour role.** `--color-primary` is the app's interactive/selected role — `archive.css:118` (tab
  underline), `channels.css:428`/`:625` (dialog action labels), `settings.css:98`, `pairing.css:143`. The
  apparent objection, `conversation.css`'s "status vocabulary" comment above `.bubble--compacting`, is
  scoped to the four 4px leading accent bars on bubbles, a different construct — not a prohibition.
- **The underline is load-bearing, not decorative.** On the bubble fill `--color-surface-container-high`
  (#272a2f), `--color-primary` measures **8.5:1** — comfortably legible. But against the surrounding
  prose colour `--color-on-surface` (#e0e2e8) it is only **1.31:1**, far below the 3:1 that WCAG technique
  G183 asks for when colour is the *only* cue distinguishing a link from its text. Colour alone therefore
  cannot carry AC4's "visually distinguishable"; the underline is what actually does, and it must be
  declared rather than inherited from the UA so the rule states its own treatment. `text-decoration` is
  used nowhere else in `src/` today — this is its first use, which is why it is spelled out here.
- **No literals.** `underline` is a keyword, not a colour/size/spacing value. No
  `text-underline-offset` — that would need a px literal AC4 forbids.
- **`:visited` needs no separate rule.** Author normal declarations beat UA normal declarations in the
  cascade whatever the UA rule's specificity, so this one rule overrides `-webkit-link` for both the
  unvisited and visited states. AC4's "the UA default link colour does not ship" holds for both.
- **Descendant selector**, matching `.bubble__markdown pre` / `h1`…`h6` / the `code` rule. It reaches an
  anchor nested in a list item, a blockquote or a heading.
- **Reach, both halves.** `.bubble__markdown` has exactly one call site (`ConversationScreen.tsx:522`,
  the settled assistant reply), and `<a>` appears nowhere else in `src/renderer/src` — grep-confirmed. So
  the rule reaches assistant-markdown links and, structurally, nothing else.
- **No margin, no font-family, no word-break** — inherited, and restating them repeats settled rules
  (#607's precedent, followed by #623/#628/#629/#630).

**#630 composes unchanged**, as its body predicted. `[`code`](https://x)` renders `<a><code>`; #630's
ancestry-scoped `:not()` still matches, the `<code>` inherits `--color-primary` from the anchor, and that
measures **10.9:1** on the inline-code fill `--color-surface` (#101418). No change to #630's rule.

## State + concurrency model

None. `AssistantMarkdown` stays a pure function of `text` — no state, no effects, no store access, no
async. `allowedLinkHref` is pure and synchronous. No store slice, no subscription, no teardown. The click
side effect belongs entirely to Electron's existing window-open path in the main process.

## Error handling

The only failure mode is "this href is not an allowed link", and it is not an error condition — it is one
of the two normal outcomes. `new URL`'s throw is caught and mapped to `null` inside the helper; nothing
propagates, nothing is logged, nothing is surfaced to the operator. A denied link renders as its visible
text, which is a complete and intentional UI state, not a degraded one.

## Testing strategy

### Unit — `AssistantMarkdown.test.tsx` (server-render, vitest `node` env)

Both allowlist criteria are properties of the emitted markup, so this tier owns them. Follow the file's
stated rule: every `not.toContain('<a')` is paired with a positive assertion in the same case, and the
accepted cases below are what keep the rejections from passing vacuously on an empty render.

**Rewrite** the three cases that assert deny-first on `https:` hrefs — they go red and must be rewritten,
not deleted:

- inline link → anchor carrying `href="https://example.com"`, `target="_blank"`, visible text `click me`
- reference-style `[label][ref]` → anchor carrying the resolved `https://ref.example/target`, text `label`
- autolink `<https://example.com>` → anchor whose href and visible text are both the URL

Add an `http:` (not just `https:`) accepted case — AC1 names both schemes and only `https:` is covered by
the rewrites.

**Keep verbatim:** `gives a javascript: href the same no-anchor treatment (AC3)`.

**Add** one denied case per remaining AC2 input, each in its own `render()` call so a denied fixture never
shares markup with an accepted one (`not.toContain('href')` would fail across a shared render). Each
asserts the visible text is present **and** `not.toContain('<a')` **and** `not.toContain('href')` — that
last assertion is what fails the naive `urlTransform`-only implementation, so it is the mutation-catching
one and must not be dropped:

`data:` · `file:` · `mailto:a@b.example` · a custom scheme (`pyry-evil://do/thing`) · relative `./doc.md` ·
protocol-relative `//example.com/x` · empty `[t]()` · unparseable `[t](<not a url>)`.

Use `[t](<not a url>)` for the "does not parse as a URL at all" case, **not** `[t](not a url)` — the
latter is not link syntax in CommonMark at all (it renders as literal text), so it would pass without
exercising the predicate. The angle-bracket form reaches the override with `href="not%20a%20url"`, which is
what makes it a real test of condition 2.

Keep the link **text** of every denied fixture free of the substring `href` (use `t`, `evil`, `label`).
`not.toContain('href')` is asserted against the whole render, and a fixture like `[href](javascript:x)`
would fail it on its own visible text while the code under test is behaving correctly.

**Add** a regression case for the no-`remark-gfm` design: bare `https://example.com` typed as plain text
renders as text with no anchor. Verified above: no anchor is created.

**Add** the base-independence case: `[t](http:example.com)` is denied. This is condition 4's only guard;
without a test it can be deleted by a future "simplification" with every other test still green.

### E2E — new `e2e/assistant-link-opens-externally.spec.ts`

Owns AC3, which no server-render test can express.

- Stream an assistant reply containing an `https:` link into the thread via
  `launchPairedApp({ buildReplyFrames })`, following `assistant-whitespace.spec.ts`.
- **Positive control first**, per `window-reopen-converges.spec.ts`: assert the anchor exists and carries
  the expected href, so a "nothing opened" failure is distinguishable from "the link never rendered".
- **Stub `shell.openExternal` before the click.** Non-negotiable — the real call launches the operator's
  browser on every run. Via `app.evaluate`, replace it with a recorder that pushes the URL onto a global.
- Click the anchor, then assert: the recorded URL is exactly the href; `BrowserWindow.getAllWindows()`
  count is unchanged (no in-app window opened); the main window's URL is unchanged (no navigation).

Appearance is deliberately **not** asserted here. `e2e/` has never asserted a colour or a border — #623's
`.code-block` border shipped unguarded — so AC4 is review-tier, and inventing the repo's first
computed-colour e2e assertion for it would be a new precedent this ticket has no reason to set.

### Types

`npm run typecheck` covers the override's conformance to react-markdown's `Components['a']`. Note that
`e2e/` is outside both tsconfigs, so the new spec's types are **not** covered by that gate — read the e2e
diff at production altitude in review.

## Out of scope — do not do these

- **The ADR 0010 follow-on entry.** Its link paragraph (`:35`) describes the pre-#610 state and explicitly
  names this ticket as what changes it, so the record does need updating — but `docs/knowledge/` is the
  **documentation phase's** to write, from this spec plus the merged diff. It is not a developer AC and
  must not be added as one; doing so pushes fixed-cost housekeeping into the implementation turn budget.
- The CSP (`src/renderer/index.html`), both main-process guards (`src/main/index.ts`), and the dependency
  set. No new package. **No `remark-gfm`** — a bare URL staying inert text is the design, not a gap.
- Tool rows, user bubbles, session boundaries, the streaming cursor, image suppression, fenced code.
- Hover/focus states for the anchor. AC4 asks for distinguishable-from-prose; a focus-visible treatment is
  a separate, app-wide question and no rule for it exists anywhere in `src/` yet.

## Traps

1. **ADR 0010 says #610 "will re-enable `urlTransform`". Do not follow that.** It is the pre-implementation
   plan, and the probe above disproves it: `urlTransform` blanks a href, it does not remove the anchor, so
   relying on it emits `<a href="">` for five of the nine denied inputs and fails AC2. The ADR paragraph is
   what the documentation phase corrects afterwards.
2. **Never spread `{...props}`** into the `a` override.
3. **`target="_blank"` or the feature silently does nothing** — see §2.
4. **Render the original href, not `url.href`** — normalisation would violate AC1's "unchanged".
5. **Cite selectors, not line numbers, for `conversation.css`.**
6. Do not add `text-underline-offset` or any px value to the anchor rule.

## Open questions

1. **Is `shell.openExternal` writable for the e2e stub?** Electron's `shell` is a plain module object and
   monkeypatching it in the main process is the standard idiom, but this has not been exercised in this
   repo. If a direct assignment silently fails or throws under the built app, fall back to
   `Object.defineProperty(shell, 'openExternal', { value: recorder, configurable: true })`. Verify at
   implementation time; if **both** fail, the fallback is to assert the window-open handler's decision
   rather than the shell call, and to say so in the PR body rather than leaving AC3 unguarded.
2. **`http://` in a shipped reply.** The allowlist admits plaintext `http:` because
   `setWindowOpenHandler` does and the two must agree (the ticket's explicit instruction). Narrowing both
   to `https:` only is a coherent future position but would change main-process behaviour, so it is out of
   scope here and belongs in its own ticket if wanted.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The untrusted→trusted crossing is a single named function,
  `allowedLinkHref`, with exactly one call site (the `a` override); it is not scattered. Downstream, the
  emitted href is re-validated **independently and in a different process** by `setWindowOpenHandler`
  (`src/main/index.ts:56-67`), which re-derives the scheme with its own `new URL(url).protocol`. The two
  checks agree only because condition 4 requires an authority — without it the renderer would check
  `http:example.com` while the main process received the base-resolved
  `http://localhost:5173/example.com`. That coupling is the reason condition 4 exists and is documented at
  its definition, so a later "simplification" that drops it has to read the reason first.
- **[Tokens, secrets, credentials]** No secrets on this path — no token, key, or credential of the app's is
  read, compared, or emitted. Noted, not a finding: an allowed href may itself embed credentials
  (`https://user:pass@host/`, verified reachable), but they originate in daemon text rather than app state,
  and modern browsers strip or warn on them.
- **[Phishing / visible-text integrity]** OUT OF SCOPE, named rather than discovered later. Opening the
  allowlist necessarily creates the classic link surface: `[https://bank.example](https://evil.example)`
  shows one destination and navigates to another, and no scheme check can close it. This is inherent to
  the feature the ticket asks for, not a defect in the design. The seam for a mitigation is a `title`
  attribute on the anchor (native tooltip showing the real destination) or a hover affordance; both are UX
  decisions with a Figma dependency and neither is in this ticket's ACs, so they need their own ticket.
- **[File / storage]** No findings, with a concrete reason rather than an N/A: no filesystem path is
  constructed anywhere on this path, and the one scheme that could reach the filesystem — `file:` — is
  denied twice over, by condition 3 in the renderer and independently by the window-open handler.
- **[Electron attack surface]** No findings, and this is the category that matters most here. The design
  adds **zero** IPC surface: no `contextBridge` API, no `ipcMain` channel, no preload change. The click
  routes through Electron's built-in window-open path, which the ticket explicitly required instead of a
  new channel. `webPreferences` (`sandbox: true`, `contextIsolation: true`) is untouched. Critically, the
  handler returns `{ action: 'deny' }` on **every** path including the allowed one, so Electron never
  constructs the child window — remote content is therefore never loaded into any renderer, privileged or
  otherwise; the URL only ever reaches `shell.openExternal`. `createWindow()` is the sole `BrowserWindow`
  construction site and always registers the handler, so there is no window that could miss it.
  `will-navigate` still blocks the drag-a-link-onto-the-window path unchanged.
- **[Renderer capability]** No findings. A compromised renderer could already call `window.open` and reach
  the same handler before this change, so the design grants it no capability it did not already have. The
  widening is to *daemon-authored content*, not to renderer code.
- **[Cryptographic primitives]** Not applicable, with reason: no RNG, no key material, no comparison
  against a secret, no Noise interaction anywhere on this path.
- **[Network & I/O]** SHOULD FIX, deferred — a real finding the deny-first design did not have. Rendering
  a live anchor lets Chromium speculatively resolve DNS / preconnect to a daemon-chosen host on hover,
  *before any click*, which is a small outbound side channel that did not exist when no anchor was ever
  constructed. It is not content exfiltration (no response reaches the page) and the hostnames are ones an
  authenticated, paired daemon already chose. The mitigation is a
  `<meta http-equiv="x-dns-prefetch-control" content="off">` in `src/renderer/index.html` — a file AC5
  explicitly freezes for this ticket, so it **cannot** be fixed here without violating a criterion. Filing
  it as its own ticket is the right disposition; it does not gate this one.
- **[Error messages, logs, telemetry]** No findings, by deliberate design rather than omission: the
  predicate logs nothing on the deny path. The value that would be logged is untrusted daemon text and the
  repo's diagnostics are content-free (#126), so the silence is the correct behaviour and is documented at
  the helper, following `fenceLanguage`'s existing precedent.
- **[Concurrency]** Not applicable, with reason: the render is pure and synchronous. No async task, no
  listener, no timer, no `AbortController`, no shared mutable state, and therefore no ownership,
  cancellation, or shutdown question to answer.
- **[Threat model alignment]** The applicable desktop threat is **hostile daemon response**. A compromised
  daemon can now place a clickable link in front of the operator where previously it could place none.
  That widening is bounded on four sides and each bound is enforced by code cited above: scheme is
  `http:`/`https:` only, an operator click is required, the target opens in the OS browser rather than any
  in-app window, and no in-app navigation occurs. **Malicious relay** is unaffected — it is content-blind
  and outside the Noise session, so it cannot author the markdown that reaches this renderer.
  **Renderer-compromise-reaching-transport** is unchanged, per the Renderer capability finding above.
- **[Denied-path completeness]** No findings. The deny set was verified by measurement, not reasoning: all
  nine AC2 inputs were probed against the pinned `react-markdown@10.1.0` and each either fails to parse
  absolutely or carries a non-allowlisted scheme. Backslash-authority forms (`https:\\host`) fail
  condition 4 and are denied — fail-closed, which is the correct direction. The condition-4 regex is
  anchored with no backtracking, so it carries no ReDoS exposure on an unbounded untrusted href.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
