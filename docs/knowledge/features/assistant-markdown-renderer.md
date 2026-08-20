# Assistant markdown renderer

Converts assistant-reply markdown source into React elements — headings, emphasis, lists, code, blockquotes — with raw HTML incapable of interpretation on this path. Introduced in [#608](../codebase/608.md), shipped **dormant**: nothing imports it outside its own test file, so the thread's rendered markup is unchanged. [#609](https://github.com/pyrycode/pyrycode-desktop/issues/609) is the consumer (blocked-by this ticket) — wiring it into `TimelineRow`'s `assistantText` arm, replacing the plain-text render at `ConversationScreen.tsx:499`. See [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) for the full library-choice rationale and security review.

## What it does

Takes the exact untrusted string `TimelineRow`'s `assistantText` arm already renders as plain, auto-escaped text (`ConversationScreen.tsx:492-499`, the posture this module inherits rather than redefines — see also [Conversation shell](conversation-shell.md)) and turns markdown syntax in it into real markup, while guaranteeing:

- Raw HTML in the source is never interpreted — it renders as literal, escaped text (`<script>` → `&lt;script&gt;`), never deleted, never parsed into a real element.
- Link syntax renders as its visible text only, with **no anchor element**, for every href including `http:`/`https:`/`javascript:`.
- Image syntax renders as its alt text only, with **no `<img>` element** — no element on this path can ever fetch a remote resource, independent of the CSP.

## How it works

One file: `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`.

```tsx
export function AssistantMarkdown({ text }: { text: string }): JSX.Element
```

A pure function of `text` — no state, no effects, no store access, parses synchronously during render, emits no wrapper element of its own (`react-markdown` v10 emits block elements directly; the container and its class are the caller's, per #609's scope). Built on `react-markdown@10.1.0` with:

- **No `rehypePlugins`, no `remarkPlugins`.** No HTML parser exists in the dependency graph at all — interpreting HTML would require adding `rehype-raw` to `package.json`, a visible, reviewable act, not a config flip. `remark-gfm` is deliberately never added; it would auto-link bare URLs, manufacturing exactly the anchors this module suppresses.
- **`skipHtml` left at its default (unset).** The tempting-looking `skipHtml: true` *deletes* HTML tags and promotes their inner text into the message; the default *escapes* them to visible characters instead, matching the bubble's pre-existing untrusted-text posture and preserving the `&lt;`/`&amp;` discriminator tests need.
- **`components.a`** → renders `children` only (no anchor, ever).
- **`components.img`** → renders `alt` only (no `<img>`, ever; `''` when alt is absent).
- **`components.code`** → not overridden. Its `class="language-*"` is React-escaped (inert) and structurally can't collide with an app CSS class (mandatory `language-` prefix) — and it's the sole carrier of the fenced-code language label Figma `16:47` specifies, which #609 needs.

Neither the `a` nor `img` override spreads `{...props}` — a spread would put `href`/`src` straight back while every visible-text test assertion kept passing, so the no-spread rule is enforced by construction (a code comment flags it), not by test coverage alone.

## Configuration and usage

No importer yet — see § Family status. When #609 wires it in: `AssistantMarkdown` is dropped in place of the plain-text render at `ConversationScreen.tsx:499`, inside `.bubble--assistant-text`. Two things are explicitly **not** this module's job and are left to #609:

- The container element/class the output renders into, and neutralising `.bubble--assistant-text`'s `white-space: pre-wrap` ([#607](../codebase/607.md)) *inside* that container so soft-wrapped source paragraphs don't keep their source line breaks doubled with block-level markup spacing.
- Whether to wrap the component in `React.memo` at the render site — parsing runs on every render, and during streaming the timeline re-renders many times per second; `AssistantMarkdown` being a pure function of `text` makes `React.memo` sufficient, but adding it here would be an untestable production change in a module with no call site, so it's deferred to where the cost is actually measurable.

## Edge cases and limitations

- **Reference-style links and autolinks get the same no-anchor treatment as inline links** — `[label][ref]` and `<https://example.com>` both render their visible text/URL with no `<a>`, verified as its own test case rather than assumed to fall out of the inline-link override.
- **A `javascript:` href never reaches the DOM in the first place**, because no anchor is produced at all — this module doesn't rely on `react-markdown`'s built-in `urlTransform` (which independently blanks `javascript:` hrefs) as the safety mechanism. [#610](https://github.com/pyrycode/pyrycode-desktop/issues/610) is the ticket that opens the `http:`/`https:` allowlist and will be the first consumer of `urlTransform`.
- **Empty-alt images (`![]()`) render nothing but leave sibling text intact** — no `<img>`, no placeholder, the empty string from `alt ?? ''`.
- **GFM tables and bare-URL autolinking are out of scope by design**, not a gap — both require `remark-gfm`, which is deliberately not added (see above).
- **A pathological document costs parse time on the render thread, recurring on every re-render** — accepted, bounded in practice by daemon message sizing; `micromark` is fuzz-tested CommonMark, not a backtracking regex engine, so catastrophic blowup isn't the expected failure shape. `React.memo` at the #609 render site is the mitigation seam, not built here.
- **Ships dormant.** Verify with `grep -rn "AssistantMarkdown" src/ | grep -v AssistantMarkdown.tsx | grep -v AssistantMarkdown.test.tsx` — expect no output until #609 lands.

## Related

- [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) — the library choice (`react-markdown` over `markdown-to-jsx`/`marked-react`), the `skipHtml` trap, and the full security rationale.
- [#608 codebase notes](../codebase/608.md) — implementation summary, verified construct-coverage table, code-review record.
- [Conversation shell](conversation-shell.md) — the screen this module will render into (#609), and the origin of the untrusted-text posture this module inherits (`ConversationScreen.tsx:492-499`).
- [#607 codebase notes](../codebase/607.md) — `.bubble--assistant-text`'s `white-space: pre-wrap`, which #609 must neutralise inside this module's future container.
