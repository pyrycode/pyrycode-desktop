# Conversation shell — workspace and run configuration

Choosing where a session runs and how it is configured: the workspace chip and picker, the run configuration sheet and its sections, and the log data section.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Workspace chip (#278)

A pre-first-message pill at the top of the empty new-discussion thread, showing the workspace `cwd`
the discussion will run in before the user sends the first message, with a "change" affordance
reserved for the not-yet-built [#157](https://github.com/pyrycode/pyrycode-desktop/issues/157)
Workspace Picker sheet. Split from #148 alongside #276/#277/#279; no Figma frame exists (the mobile
file draws only the populated thread), so the design is sourced from the locked mobile design doc
(a Material 3 pill, "Workspace: … (change)", pre-first-message only; mobile #137) rather than a node.

A new discussion is an unpromoted conversation created via the [new-discussion
FAB](new-discussion-fab.md) (#242): the renderer fires `createConversation` and the daemon replies
with `conversationCreated` carrying the chosen `cwd`. That reply already reached [`PairedShell`'s nav
callback](paired-shell.md) — which dropped the payload after triggering the `open` transition. This
ticket is the first consumer of that payload beyond navigation.

**`activeConversationStore.ts` (new)** — a dedicated Zustand store, the `sessionIdStore` /
`conversationListStore` DI-factory → singleton → hook → selector shape, holding
`ConversationCreatedPayload | null` (`null` = "no conversation created/opened this session yet") **verbatim**
— snake_case, no camelCase remap, the `conversationListStore` doctrine — so the chip derives `cwd` and
`is_promoted` at the read boundary rather than the store drifting from the wire shape. `setActiveConversation`,
unconditional whole-value replace (most-recent-wins, no merge). [PairedShell's
`conversation_created` callback](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) is the sole
writer; `WorkspaceChip` (below) is the sole reader — no other consumer exists yet.

[#529](../codebase/529.md) added a second mutation, `clearActiveConversation`, returning the state to
the exported `initialActiveConversationState` constant — for when the conversation context that scoped
the payload ends. Named setters rather than a reducer: the two mutations are independent whole-value
writes, neither reading prior state nor constraining the other's ordering. Shipped with **no production
caller**. `PairedShell.tsx`'s `setActiveConversation` call site was the obvious-looking place to wire a
clear from, and [#530](../codebase/530.md) (navigation, shipped) did touch exactly that call site — but
deliberately did **not** call `clearActiveConversation` there: `setActiveConversation` stays
unconditional (a conversation switch still *records* the new conversation, it just also clears the
timeline and session id first via the new `activateConversation` helper — see [Paired
shell](paired-shell-routing.md#the-pure-view--container-pairedshelltsx)). [#531](../codebase/531.md) (unpair /
pair-another-server, shipped) is `clearActiveConversation`'s sole caller, wired unconditionally into
[`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) — the pairing
context itself ending, rather than the active conversation merely changing, is exactly the case that
call site was reserved for.

Rejected alternative: correlating `sessionIdStore`'s session id against a `conversationListStore` row.
There is no join key — `sessionIdStore` holds a daemon *session* routing id from `sessionTransition`,
`ConversationSummary` is keyed by conversation `id`, and the two are orthogonal ids; a lookup by the
synthetic `MILESTONE_CONVERSATION_ID` send-id would usually miss the daemon's real `conversations` list
too. The `conversationCreated` payload already in hand from the create round-trip is the narrow, correct
source — "the workspace this discussion will run in" is exactly what it carries.

**`WorkspaceChip` (`ConversationScreen.tsx`)** — the exact `ThinkingIndicator` idiom: the container
derives a value and passes it down, the pure exported view self-gates to `null`, no store read inside
the view. Mounted as a **sibling above `Timeline`**, below `ConnectionBannerControl`:

```tsx
<ConnectionBannerControl />
<WorkspaceChip conversation={activeConversation} isEmpty={items.length === 0} />
<Timeline items={items} />
```

```ts
export function WorkspaceChip({
  conversation,   // ConversationCreatedPayload | null — activeConversationStore's held value
  isEmpty,        // items.length === 0 — the pre-first-message window
  onChange        // optional () => void — the #157 seam; absent here
}: WorkspaceChipProps): JSX.Element | null {
  if (!isEmpty || conversation === null || conversation.is_promoted) return null
  // … renders a pill: WORKSPACE_CHIP_LABEL, conversation.cwd, and a Change button
}
```

**Gate:** `isEmpty && conversation != null && !conversation.is_promoted`. `is_promoted === false` is
the wire signal for a *discussion* (vs. a channel) — this is what makes the chip a new-discussion,
pre-first-message affordance only (AC1/AC3): once the first message lands, `items.length` flips
non-zero and the chip disappears; a promoted conversation never shows it at all.

**`cwd` is rendered whole and opaque** (AC2): plain React children (auto-escaped), never
`dangerouslySetInnerHTML`, and never split/basenamed/otherwise interpreted as a filesystem path (a
`cwd.split('/').pop()` would itself be "interpreting it as a path" — the toolCall/sessionBoundary
untrusted-string posture already in this file). An HTML-ish `cwd` (`<b>hi</b>`) renders as escaped text
(`&lt;b&gt;hi&lt;/b&gt;`), never markup. The client-owned `WORKSPACE_CHIP_LABEL = 'Workspace'` constant
is the `EMPTY_THREAD_COPY` idiom — apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;`) and
never a daemon string, so the label itself carries no untrusted content.

**"Change" affordance (AC4):** a `<button disabled={!onChange} onClick={onChange}>`. This ticket's
container passes no `onChange`, so the button ships visibly `disabled` — an honest placeholder, not a
silently-missing feature. #157 lands as a pure additive: pass an `onChange` that opens the Workspace
Picker sheet (Figma node 20-2) and the button un-disables, with no other change to this view — the same
optional-prop extension seam #276 originally reserved for #155's `onChannelInfo?` — [#365](../codebase/365.md)
later retired that speculative prop in favor of `ConversationScreen` owning the Channel Info sheet's
open-state itself (see [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) below), so `onChange?` here was, for
a time, the pattern's only live instance. **[#383](../codebase/383.md) bound it:** `ConversationScreen`
passes `onChange={() => setPickerOpen(true)}` (a `pickerOpen` `useState` twin of `channelInfoOpen`), which
un-disables the button — no other change to this view. See [Workspace Picker
sheet](#workspace-picker-sheet-383) below.

**Why a sibling, not nested inside `EmptyThread`.** #277's `.conversation__empty` surface pins the chip
"to the top of this surface" per its own CSS comment, but `WorkspaceChip` does **not** thread
`conversation`/`onChange` through `Timeline` → `EmptyThread` — that would widen `Timeline`'s
`{ items, now }` contract for an orthogonal concern and cascade its many bare-render test call sites. A
sibling `flex: 0 0 auto` chip above `Timeline` yields the identical visual result (pill on top, empty
surface filling below) with `Timeline`'s contract untouched and zero edits to its existing tests.

Styled `.conversation__workspace-chip*` (`conversation.css`) — token-only, no new token: `--radius-full`
for the Material 3 pill shape (`.tool-row__chip`'s corner at the time, `--radius-sm`, made fully round —
\#722 later moved the tool-row chip on to `--radius-xs` for the desktop redraw, so the precedent is
historical rather than a live cross-reference), `--color-surface-container-high` fill +
`--color-outline-variant` border (the `.conversation__banner` fill), `min-width: 0` +
`text-overflow: ellipsis` on the `cwd` run so an unbounded daemon path can't blow out the layout (the
`.tool-row__summary` treatment, still current).

Not security-sensitive: a pure renderer read of an already-decoded store value, rendered on React's
default-safe escaped path — no transport/crypto/socket surface touched. See [#278 codebase
notes](../codebase/278.md) for the full design and patterns established.

## Workspace Picker sheet (#383)

The UI slice of #157 (Figma node 20-2): a bottom sheet, opened from the `WorkspaceChip`'s "Change"
button, that lists the [recent-workspaces store](recent-workspaces-store.md) (#382), marks the row
matching the active conversation's current `cwd`, and dispatches the existing [`changeWorkspace`
command](conversation-workspace-change.md) (#379) on selection. Everything it consumes — the store +
its dormant data-path bridge (#382), the command (#379), `formatLastActivity` (#141), and the
`.status-sheet__*` chrome (#177/#365) — was already merged; this ticket adds one new file:
`WorkspacePickerSheet.tsx` (a pure view, a one-line dispatch helper, and an in-file container — the
`ChannelInfoSheetView`/`ChannelInfoSheet` split), plus an ~8-line wiring delta in `ConversationScreen`.
No new command, no new transport plumbing, no store change.

```
.conversation
└── WorkspacePickerSheet                (mounted beside ChannelInfoSheet, when pickerOpen)
    ├── RecentWorkspacesData             (#382's dormant bridge — mounted only while open, so
    │                                     each open fires a fresh one-shot requestRecentWorkspaces)
    └── WorkspacePickerSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="workspace-picker-sheet-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Choose workspace" + close
            └── .status-sheet__body
                ├── "Recent" section-header
                ├── .workspace-picker__row × N     path (mono) + "Last used …" + "default" pill (if cwd match)
                ├── .workspace-picker__empty        "No recent workspaces" (workspaces === [])
                │                                   — no row, no empty copy at all when workspaces === null
                ├── "Other" section-header
                └── .workspace-picker__other        "Create new folder under <cwd>" (#398) — disabled only
                │                                     with no active conversation
                    └── CreateFolderDialog           (#398, mounted picker-scoped when open)
                        ├── NewFolderData             (#397's dormant bridge — mounted dialog-scoped)
                        └── CreateFolderDialogView    "Create workspace" dialog (Figma 19-44)
```

**Null-vs-empty store (AC1).** `workspaces` (from `useRecentWorkspacesStore(selectRecentWorkspaces)`)
is `null` while the one-shot request is in flight — the section header renders with no rows and no
empty copy — versus a delivered `[]`, which renders the header plus a client-owned
`.workspace-picker__empty` line. The two are structurally distinct output, the #141/#324 null-vs-empty
precedent, and neither branch crashes.

**"default" pill (AC2).** `activeCwd` — `conversation?.cwd ?? null`, sourced from
`activeConversationStore` (#278) — is compared by exact string equality against each row's `path`; a
match renders `.workspace-picker__default-pill` (secondary-container fill, Figma 20:36). `activeCwd
=== null` (a list-opened thread never populates `activeConversationStore`) marks no row — the same
graceful-empty posture the [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) established for the same
store.

**Choose → dispatch → close (AC3).** Each row is `disabled={!onChoose}`; the container supplies
`onChoose` only when `conversation !== null`, so a list-opened thread's rows render inert — the
`WorkspaceChip` disabled-until-wired idiom, reused for the same reason (no `conversation_id` to
dispatch with). When wired, choosing a row calls the new exported `requestChangeWorkspace(sendCommand,
conversationId, path)` — an inline `{ type: 'changeWorkspace', payload: { conversation_id: cwd }
}` literal (the `requestArchiveConversation` clone), mapping the row's `path` into the wire's `cwd`
field — then `onClose()`. Fire-and-forget, no optimistic update: the conversation **list** picks up the
new workspace only once the daemon's existing `conversation_updated` reply re-triggers the #275 re-list
(see [Conversation workspace change](conversation-workspace-change.md)). The active-conversation chip
itself does not live-update on that reply (`activeConversationStore` is written only on
`conversation_created`) — reopening the picker right after a change still marks the *old* `cwd` until
the next create, a pre-existing #278 limitation, not fixed here.

**"Other" entry — create-folder dialog (#398).** The create-folder row is `disabled={!onCreateFolder}`;
the container now supplies `onCreateFolder` whenever `conversation !== null` (the same gating as
`onChoose` — the dialog needs the `conversation_id` its switch reflects onto), opening a new
`CreateFolderDialog` mounted picker-scoped. The label is now parent-specific — `` `Create new folder
under ${activeCwd}` `` — falling back to the generic `'Create new folder…'` only when there is no active
conversation to derive a parent from. The dialog is a near-clone of `RenameConversationDialog.tsx`
(Figma 19-44: "Create workspace" title, "What should this workspace be called?" field, Cancel/Create
actions), drives the [create-folder round-trip store](new-folder-store.md) (#397) — mounting its
previously-dormant `NewFolderData` bridge dialog-scoped so the daemon reply actually resolves — and on
the `created` outcome switches the conversation to the daemon's **returned** path verbatim via
`requestChangeWorkspace` (never a client-reconstructed path — the #288 EvalSymlinks lesson), then closes
both the dialog and the picker (`onCreated` is the picker's own `onClose`). A `rejected` outcome shows a
generic, apostrophe-free failure line and stays open for retry. See [#398 codebase
notes](../codebase/398.md) for the full implementation and lessons learned.

**Untrusted strings.** `path` renders as auto-escaped React children, never
`dangerouslySetInnerHTML`, never split/basenamed/otherwise resolved as a filesystem path — the
`WorkspaceChip`/`RecentWorkspace` posture carried forward. `last_used_at` is fed only to
`formatLastActivity`, which degrades an unparseable value to `''` (the `|| '—'` fallback) and never
throws.

Two glyphs (`FolderIcon`/`FolderPlusIcon`) are inline `currentColor` Material SVGs, not the Figma's
asset images or accent colors — the app's standing "no asset fetch, no hardcoded illustration hex"
posture, flagged as a non-gating NIT in code review for designer awareness. Styled entirely with
`.workspace-picker__*` classes in `conversation.css` — token-only, no new CSS token (the pill reuses
`--color-secondary-container`/`--color-on-secondary-container`, already introduced by earlier tickets).

Not security-sensitive: a pure renderer read of two already-decoded stores plus a dispatch of an
already-guarded command; no transport/crypto/socket surface touched. Code review PASS, two non-gating
NITs (glyph coloring, the deferred create-folder label). See [#383 codebase
notes](../codebase/383.md) for the full design and patterns established.

## Run configuration sheet (#177)

The host modal for the session's Model / Effort / YOLO controls, context-window state, and
Log-data download — each section is a follow-up ticket (#181 — since split into #187/#188, #182,
\#72) that owns both its header and its content. This ticket ships only the chrome: the trigger and
the empty, dismissible sheet.

`StatusRow` was originally a full-width icon-only `<button aria-label="Run configuration"
aria-haspopup="dialog">` between `MessageThread` and `Composer` (Figma node `16-57`), with a top border
separating it from the thread. Its left summary region (`model · effort · context%`) was intentionally
empty at shell-landing time — that live text was meant as the collapsed mirror of the sheet's read
sections, owned by #188/#182 — and [#330](../codebase/330.md) turned `.status-row__summary` into a flex
row and mounted the two-dot connection indicator as its first child instead; the `model · effort ·
context%` text itself was never built.

**[#962](https://github.com/pyrycode/pyrycode-desktop/issues/962) retired `StatusRow` outright** — the
desktop design (Figma `102:4`) draws nothing in the region between the thread and the composer, and by
then the row's three jobs had all been re-homed elsewhere (permission mode and model/effort to the
input footer, #682/#683; the context gauge to the footer's reading, #811; the connection dots to the
sidebar host row, #672/#718). The trigger is now the `Run configuration` item in the thread's overflow
menu — see [Run-configuration row and background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962).
Clicking it calls `onRunConfiguration`, which flips `sheetOpen` — the same `useState(false)` in
`ConversationScreen` that `StatusRow`'s `onExpand` used to flip (the "trivial single-value local UI state"
case carved out by [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), not its
`useReducer` phase-machine case), untouched by the retirement. It resets to closed on remount for free —
a guarantee [#670](../codebase/670.md) had to restore explicitly via `ConversationScreen`'s `key` once a
sidebar-driven conversation switch could otherwise leave the route on `thread` with no remount at all;
see [the paired shell's `paneKey`
fix](paired-shell-routing.md#the-conversation-switch-remount-bug-and-the-panekey-fix).

`StatusSheet` (Figma node `20-100`) renders as the screen's last child when `sheetOpen` is true:

```
.status-sheet-overlay          absolute, inset: 0, flex column, justify-content: flex-end
├── .status-sheet-overlay__scrim   absolute, inset: 0, --color-scrim @ opacity 0.4, onClick=onClose
└── .status-sheet                 role="dialog" aria-modal="true" aria-labelledby=<title id>
    ├── .status-sheet__handle       32×4 decorative drag bar, aria-hidden
    ├── .status-sheet__header       title (left) + × close control (right, aria-label="Close")
    └── .status-sheet__body         empty, flex:1 1 auto; min-height:0; overflow-y:auto
```

It is an **absolutely-positioned overlay inside `.conversation`** (which gained `position: relative`
for this), not a React portal — no App-level z-index coordination, fully self-contained in the
screen. The scrim is a **separate element**, not the overlay's own background, so the opaque panel
sibling is never dimmed and no bare `rgba()`/`color-mix` literal is needed; it doubles as a
near-free backdrop-click dismissal. The `×` close control is the **authoritative** dismissal path
(clicking it or the scrim both call `onClose`, which flips `sheetOpen` back to `false`); Esc-to-close
was left out (optional per spec, unobservable under the server-render harness).

Two M3 dark-scheme tokens were ported into `tokens.css` ahead of their other consumers (sanctioned
by that file's header comment): `--color-surface-container-low` (the panel fill) and
`--color-scrim` (applied only via `opacity`, never as a raw color-with-alpha literal). Icons are
inline `currentColor` SVGs, the `.composer__send` precedent — no remote asset fetch (CSP blocks it).

Not wired yet at shell-landing time: no live summary text in `StatusRow`, no focus trap/restore on
open-close (accepted for a shell with a single focusable control; worth adding once more than one
section is interactive — see [#177 codebase notes](../codebase/177.md) for the full code-review
record). `StatusRow`'s summary slot gained its first content in [#330](../codebase/330.md) — the
two-dot connection indicator, not the run-config text this paragraph originally meant — and both `StatusRow`
and that indicator were retired by #962 (above); the trigger and the focus-trap gap moved with it onto
`ThreadOverflowMenu`'s `Run configuration` item, which has no focus trap either. The sheet
body itself gained its first section in [#72](#log-data-section-72) below; all
four read-only sections (Model/Effort/YOLO, #188, and Context window, #192) have since landed. See
[#177 codebase notes](../codebase/177.md) for the shell's full design and lessons learned.

A **headless data path** for the Model/Effort/YOLO/Context-window sections landed in
[#187](../codebase/187.md): `<RunConfigData/>`, mounted as the sheet body's first child (ahead of
`<RunConfigSections/>` and `<LogDataSection/>`), requests a fresh `screen_snapshot` on every sheet
open and holds `model`/`effort`/`yolo` (and, since [#192](../codebase/192.md), `usedTokens`/
`windowTokens`) in a dedicated [Run configuration store](run-config-store.md). The Model/Effort/YOLO
render landed in [#188](../codebase/188.md); the Context window render landed in
[#192](../codebase/192.md). See [Run configuration data path](#run-configuration-data-path-187),
[Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), and
[Run configuration Context window section](#run-configuration-context-window-section-192) below.

## Run configuration data path (#187)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

`RunConfigData` is a headless container (`(): null`) — no markup, no header, no rows; it exists
purely to drive the fetch-and-hold data path the moment the sheet opens, ahead of #188 rendering
anything from it. Because the sheet body is conditionally mounted
(`{sheetOpen && <StatusSheet>…}`), `RunConfigData`'s own mount **is** the sheet's open transition,
so "request once per open" reduces to "request once per mount" — a `useRef(false)` guard makes that
hold even under React StrictMode's dev double-invoke. A second effect subscribes to
`window.pyry.onDaemonEvent` (off-handle cleanup, the `daemonEventBridge` idiom) and writes each
arriving `runConfigReceived` verbatim into the [Run configuration store](run-config-store.md)'s
single setter (originally `snapshotReceived`, moved onto the dedicated reply at #491/#500 — see [Run
configuration store § Moved off screen_snapshot](run-config-store.md#moved-off-screen_snapshot-491500)).
See [Run configuration store](run-config-store.md) for the full data-path design and
[#187 codebase notes](../codebase/187.md) for patterns established.

## Run configuration Model/Effort/YOLO sections (#188)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188)
│   └── RunConfigView                  (pure: three primitive props in, markup out)
│       ├── ModelSection                .status-sheet__section-header "Model" + 3-row radio list
│       ├── EffortSection                .status-sheet__section-header "Effort" + 5-segment control
│       └── YoloSection                  .status-sheet__section-header "YOLO mode" + labelled switch
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The three sections the sheet's Model/Effort/YOLO controls needed, mounted between `RunConfigData`
and `LogDataSection`. `RunConfigView` is the exported pure view — three primitive props
(`model`/`effort`/`yolo`) in, markup out, no store read and no `window.pyry`, so it
server-renders with no mock, the same seam `LogDataView`/`RunConfigData` use. `RunConfigSections` is
the thin exported container: `useRunConfigStore(selectSnapshot)` reads one narrow slice and
coalesces `snapshot ?? { model: '', effort: '', yolo: false }` before handing the triple to
`RunConfigView` — so the store's pre-load `null` and a real all-defaults `screen_snapshot` render
through the identical code path (both are AC4's blessed default: no radio filled, no segment marked,
switch off).

- **Model** — shipped at #188 as a static catalog (Opus 4.7 / Sonnet 4.6 / Haiku 4.5, each with a
  one-line descriptor) matched against the snapshot's `model` string via `matchedFamily`, a
  case-insensitive substring match against each catalog entry's family token. [#590](../codebase/590.md)
  added a fourth entry, `Fable 5` (family token `fable`), between Sonnet and Haiku. **Deleted outright
  by #975** — the catalog, `matchedFamily` and all four hardcoded rows are gone; see § Run
  configuration Model section, daemon-published rows (#975) below.
- **Effort** — shipped at #188 as five fixed segments (`low`/`medium`/`high`/`xhigh`/`max`) matched by
  exact equality; the current level carried `aria-current="true"`, both the accessibility marker and
  the CSS hook (`[aria-current='true']`) for the filled-pill style — no parallel modifier class.
  **Rewritten by #976** to offer the selected model's published levels instead — the five-value
  constant is gone; see § Run configuration Effort section, daemon-published levels (#976) below. The
  `aria-current` selection mechanism and its CSS hook are unchanged.
- **YOLO** — a between-justified "Auto-accept tool calls" row with a switch rendered `role="switch"
  aria-checked={yolo} aria-readonly="true"`: honestly read-only (not focusable) until
  [#183](https://github.com/pyrycode/pyrycode-desktop/issues/183) drops `aria-readonly` and wires an
  `onClick`. Figma pins only the off state; the on state (`--color-primary` track, `--color-surface`
  knob) mirrors M3 on-switch semantics with tokens already in the palette — no new token, and
  low-risk since production data is always `yolo: false` until #183 lands the write path.

One more M3 token landed: `--color-surface-container-highest` (the switch's off-track fill; reused by
[#192](../codebase/192.md)'s context-window track below). See [#188 codebase notes](../codebase/188.md)
for the full design and patterns established.

An unconfirmed in-flight change to any of the three ([#558](../codebase/558.md)) no longer renders
identically to a settled one: the owning wrapper (the model list, the effort row, or the switch itself)
carries `aria-busy="true"` plus a dashed `--color-warning` ring/border, sourced from
[#256](../codebase/256.md)'s `selectPendingFields`, clearing through the same reject/confirm/reconnect
paths [Run configuration write store](run-settings-write-store.md) already converges on.

## Run configuration Context window section (#192)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188/#192)
│   └── RunConfigView                  (pure: five primitive props in, markup out)
│       ├── ModelSection
│       ├── EffortSection
│       ├── YoloSection
│       └── ContextWindowSection         .status-sheet__section-header "Context window" + usage gauge
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The fourth and last section of the read-only surface, mounted between `YoloSection` and the sibling
`LogDataSection` per Figma order. Widens the [Run configuration store](run-config-store.md)'s held
`RunConfigSnapshot` (and the `toRunConfigSnapshot` copy) by the two usage figures [#191](../codebase/191.md)
already carries on the transport event (originally `snapshotReceived`, now `runConfigReceived`,
\#491/#500) — `usedTokens`/`windowTokens` — and renders them as:

- **Available (`windowTokens > 0`):** a usage line — `` `${pct}% used (${abbreviateTokens(usedTokens)}
  of ${abbreviateTokens(windowTokens)} tokens)` `` — above a `role="progressbar"` track/fill whose fill
  width is set inline per render (`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label`
  complete the honest a11y contract). `pct` is `used/window` rounded and clamped to `[0, 100]`, so an
  over-full session reads "100% used" with a full (not overflowing) bar, while the raw abbreviated
  figures stay honest about the overflow (e.g. "210K of 200K tokens").
- **Unavailable (`windowTokens <= 0`):** a single muted "Context usage unavailable" line in place of
  the usage line and bar — no progressbar role, no division ever runs.

The container's null-default gained `usedTokens: 0, windowTokens: 0` — the same move [#188](../codebase/188.md)
made for `model`/`effort`/`yolo`, one step further: **the not-yet-loaded default and the daemon's
`window_tokens == 0` "usage unavailable" signal collapse into the identical `windowTokens > 0` branch**,
so there is exactly one guard, not two, and the division genuinely never executes on either falsy
path (AC5 — no NaN, no Infinity, no divide-by-zero). `abbreviateTokens` (1000+ → `"146K"`, else a raw
count) stays an in-file, unexported one-liner; zero new public exports, zero new theme tokens (reuses
`--color-success` and #188's `--color-surface-container-highest`). See
[#192 codebase notes](../codebase/192.md) for the full design and patterns established.

**The percentage itself moved out to a shared function, `contextUsagePercent` (#811).** This section's
own inline expression — `Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))`
behind `windowTokens > 0` — is now `contextUsagePercent(usedTokens, windowTokens)`, in the new
`src/renderer/src/screens/conversation/contextUsage.ts`, so this gauge and the
[composer footer row](conversation-shell-composer.md#composer-footer-row-811)'s "Context: N%" reading share one guard and one clamp
rather than two that could drift apart. `ContextWindowSection` calls it and derives nothing itself —
`pct !== null` replaces the old `available` ternary — and every other line in the section (the usage
string, the `role="progressbar"` triple, the inline fill width, the unavailable line) is byte-identical
to before the extraction; `RunConfigSections.test.tsx`'s existing assertions pass unedited, which is the
extraction's own behaviour-preservation proof. **The guard also gained `Number.isFinite(windowTokens)`**,
closing a real hole the old clamp had: `used_tokens`/`window_tokens` cross the wire through a bare
`typeof === 'number'` check with no range test (`inboundMessage.ts:611-622` rules that deliberately —
a client-invented bound would drop valid future frames, so *"the render slice formats the counter
defensively instead"*), so a daemon frame carrying `used_tokens: 1e999, window_tokens: 1e999` parsed to
`Infinity`/`Infinity` and the pre-#811 clamp rendered `NaN% used` with a `width: NaN%` fill. `windowTokens
<= 0` and non-finite now collapse into the identical unavailable branch — an architect self-review
security finding (MUST FIX), closed in the same extraction rather than as a follow-up.

## Run configuration Model section, daemon-published rows (#975)

The Model section stops guessing. `MODEL_CATALOG`, `ModelCatalogEntry`, its family tokens, its
hand-written descriptors and the `matchedFamily` substring matcher are deleted outright — no model
name and no family token is hardcoded in `RunConfigSections.tsx` anywhere. `ModelSection` renders
one row per entry in [Model-list store](model-list-store.md)'s held [`ModelListEntry`](model-list-store.md)
for the active conversation, in the daemon's published order, deriving nothing: `value` is not
parseable (measured entries: `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`) and no
family is split out of it.

**`RunConfigSections` takes the conversation id as a prop, not a store read.** The container
previously had only `sessionIdStore`'s *session* id in scope — a different identifier that keys
nothing in `modelListStore`'s per-conversation map, so reaching for it would compile clean,
typecheck clean, and render the not-yet-known line forever. `ConversationScreen` now passes
`conversationId={activeConversation?.id ?? null}` at the existing `<RunConfigSections />` mount, the
same `activeConversation`-sourced prop `ComposerSlot` and `BackgroundTaskPanel` already take. The
container memoises the selector factory on the id (`useMemo`, the `useSlashCommandTypeAhead` idiom)
and short-circuits a `null` id through the identical path rather than an invented key.

**Three readings, not two.** `selectModelListFor` returns `null` for "no frame has arrived yet" and
a present entry holding `models: []` for "claude published an empty list" — the Model section keeps
them apart as two different sentences in two different elements (`RUN_CONFIG_MODELS_UNKNOWN_COPY` /
`RUN_CONFIG_MODELS_EMPTY_COPY`), the [`BackgroundTaskPanel`](conversation-shell-question-panel.md)
convention for the identical pair. Neither renders an empty control or a stale menu.

**Selection is exact equality on `value`, full stop** — no `toLowerCase`, `includes`, `startsWith`,
`trim` or regex anywhere on the path — and it round-trips: a row's `onClick` submits its `value`
verbatim, the optimistic overlay ([Run configuration write store](run-settings-write-store.md))
holds that same string, and the identical comparison re-selects the row it came from. The moment
either side normalises, the two stop being the same string, which is why the guard `RunConfigSections.test.tsx:563`
existed for (an announced identifier that is a *superstring* of a published `value` must not select
that row) is re-anchored on a published row rather than dropped with the `matchedFamily` matcher it
used to name.

**The React `key` is the array index, deliberately.** `display_name` and `value` are both
claude-authored text a key would turn into a lookup path — the store's own header assigns this slice
that obligation. There is also no cross-frame identity to preserve: each frame replaces the
conversation's list wholesale, rows never reorder within a render, and claude may legitimately
publish two rows sharing a `value`.

**Both of the frame's truncation reports reach the operator, kept apart.** A row whose
`truncated_fields` is non-empty renders the sheet's existing cut copy (`RUN_CONFIG_CUT_COPY`,
renamed from `RUN_CONFIG_RUNNING_CUT_COPY` and now shared by both this section and
`RunningModelSection`) in a sibling element inside its text column — `null` and `[]` say the
identical thing per the wire, so the check is on length, not presence. A frame reporting
`droppedModels > 0` renders a partial-list notice as a **sibling of the three-way branch**, not a
child of any arm, so an entry reporting drops beside zero carried rows still shows it; `> 0`, never
truthiness, since React renders a bare `0` as a text node.

**The running-model lookup ([§ Running model section](run-config-store.md#running-model-section-560-resolved-onto-the-published-rows-by-975))
moves onto these same rows.** `runningPublishedRow` (renamed `publishedRowFor` by
[#976](https://github.com/pyrycode/pyrycode-desktop/issues/976), which gave it a second caller — see
§ Run configuration Effort section, daemon-published levels below, and exported by
[#988](composer-model-menu.md) for a third, the composer footer's model menu) joins claude's per-turn announcement
(`announcedModelStore`) against a published row's `value` by exact equality — not `resolved_model`,
which the wire contract's join prose excludes and which would give the exactness guard above an
exception (Haiku's `resolved_model` is a superstring of its own `value`). The lookup stays mostly
dormant in practice, the same outcome [#560](../codebase/560.md) already documented and accepted —
claude echoes an identifier at least as specific as the one it was given, so it rarely equals a bare
`value` — but it now joins against real published data instead of four hardcoded family tokens.

**Untrusted text, one boundary.** `display_name`, `value`, `resolved_model` and every
`truncated_fields` element are claude-authored strings that crossed the subprocess trust boundary,
bounded by the daemon and not sanitized by it (the tier [Model-list wire types](model-list-wire-types.md)
declares). Each reaches exactly one JSX text position, escaped by React's default; none reaches an
attribute, a URL, a filename, a cache key, a lookup path, or a log line — and nothing on this path is
logged at all. Each row's second line renders `resolved_model` unconditionally (even an empty or a
`<unmeasured>` value), which is the honest mitigation for the one risk that is *not* client-closable:
a `value` cut mid-token by the daemon (`opus[1m]` → `opus`) still passes the daemon's inbound
`validModel` charset check and silently runs a different model, so showing the concrete resolution
before the first turn is the only defense available here.

CSS gained `.run-config__model-unknown`, `.run-config__model-empty`, `.run-config__model-partial` and
`.run-config__model-cut` on the shipped muted body-small tokens (none is an error state), and paired
`overflow-wrap: anywhere` onto `.run-config__model-name`/`.run-config__model-descriptor` now that both
lines carry unbounded daemon text instead of short static labels — the `.run-config__running-value`
precedent. See [#975 codebase notes](../codebase/975.md) for the full design, the security review,
and why the join key is `value` rather than `resolved_model`.

## Run configuration Effort section, daemon-published levels (#976)

The last hardcoded vocabulary in the sheet goes. `EFFORT_LEVELS`, the five-value constant
(`low`/`medium`/`high`/`xhigh`/`max`) `EffortSection` rendered for every model, is deleted; the
segments offered are now the *selected model's* published `effort_levels`, read off the same
[Model-list store](model-list-store.md) entry the Model section reads. Reasoning-effort support is
per model — measured live against claude 2.1.220 on 2026-08-21, Haiku publishes no levels at all while
the other rows publish all five — so the fixed strip used to offer Haiku five choices it could not use
and ask the daemon for something it would refuse.

**The row is the session's model, not the running one.** `EffortSection` now takes `model` and
`models` props and resolves its row via `publishedRowFor(models, model)` — the same helper and the
same exact-equality-on-`value` rule `ModelSection` marks a row selected by, renamed from
`runningPublishedRow` because #976 gave it a second caller. The two callers join **different strings**
through the identical rule: `RunningModelSection` joins `announced.model` (what claude announced for
the running turn), `EffortSection` joins the session's `model` (the same string `ModelSection` marks a
row selected by). Conflating the two inputs is the mistake a shared name is meant to make visible.

**Four inputs, three renderings** — the section's own `nothingKnown` guard is the one place this table
is written down in code:

| matched row | `effort_levels` | cut reported | renders |
|---|---|---|---|
| none (no list yet, or `model` matches no published row) | — | — | the session's current `effort` value, as plain text |
| yes | non-empty | either | one segment per level, in published order |
| yes | `[]` | no | `RUN_CONFIG_EFFORT_EMPTY_COPY`, "No effort levels offered" |
| yes | `[]` | yes | the current-effort text — **not** the offers-none copy |

The first and fourth rows render identically and that collapse is deliberate — the opposite posture to
`ModelSection` directly above, which keeps "no frame has arrived" and "claude published an empty list"
as different elements with different copy because it is arguing about a different field
(`models: []` there is a *positive statement*). Here, no-list-yet and no-matching-row mean the
identical thing to the client: it has not been told any level is accepted, so it offers none and
states what the session is actually running instead of guessing. **The fourth row is a written
contract MUST, not an invented distinction**: `effort_levels` collapses absent/`null`/empty into one
`[]` (see [Model-list wire types](model-list-wire-types.md)), so a `truncated_fields` naming
`effort_levels` is the *only* signal separating "cut to nothing, or shortened" from "this model exposes
no effort control" — read as *none*, a cut list would silently remove a control the model actually
supports. `modelListStore`'s header named this ticket as the reader that owed that distinction.

**No fallback, ever.** An absent, `null` or unmatched `models` never means "offer all five" — that is
the single failure the four-input table exists to forbid, and it would have re-minted the vocabulary
this ticket deletes in the one place it is being deleted from.

**The cut marker is a sibling, in every reading.** Whenever the matched row's `truncated_fields`
includes `'effort_levels'` (`Array.prototype.includes`, a linear scan by `===` against a client-owned
literal — not an index lookup, so no object is ever keyed by daemon text here), the section renders
the sheet's shared `RUN_CONFIG_CUT_COPY` ("Truncated by the daemon") in its own sibling `<p>` — so a
shortened non-empty list is not presented as complete, and an empty-because-cut one says why it is
offering nothing.

**Selection, keys and the round trip are unchanged in kind.** A segment is marked by exact equality
against the session's `effort` value — no substring, prefix, case fold or trim; `high` is a substring
of `xhigh` and a row can publish both, which is why the guard is exact equality and nothing looser.
Pressing a segment submits the published level **verbatim**, never repaired, so the optimistic overlay
holds the same string the next render compares against — the existing pending/rejection/rollback
behaviour of the effort field (`aria-busy` on `.run-config__effort` in **all three** readings, the
`RunConfigError` line staying a sibling of the busy wrapper, never a descendant) is untouched. The
React `key` is the array index, not the level string, for the Model section's reason unchanged: a key
is a lookup path, these are claude-authored strings, and a row may legitimately publish a repeated
level.

**Untrusted text, same boundary as the Model section.** Every string in `effort_levels` is
claude-authored text that crossed the subprocess trust boundary, bounded by the daemon and not
sanitized by it. Each level reaches exactly one JSX text position, escaped by React's default; none
reaches an attribute, a URL, a filename, a cache key, a lookup path, or a log. **This ticket also
changes what the client *sends*:** `set_session_settings.effort` stops carrying a client-owned constant
and starts carrying a claude-authored string echoed back verbatim — the Model section's shipped
posture applied to a second field. No client-side allowlist is added, deliberately: it would put a
second copy of the vocabulary in the very place this ticket deletes one from. The daemon's inbound
`validEffort` is a **closed** enum at the five measured levels while `validModel` was widened for these
rows, so a level claude adds later, or one cut mid-token, is published and then **refused** on the way
back — an asymmetry that is upstream's, surfaced honestly through the existing `RunConfigError`
rejection line and the store's automatic rollback, never repaired or allow-listed client-side.

CSS: `.run-config__effort` gained `flex-wrap: wrap` (a published level list is unbounded daemon text
of unknown count, unlike the five short static words it used to hold, so it wraps inside the 400px
sheet instead of overflowing it); `.run-config__effort-segment` gained `min-width: 0` and
`overflow-wrap: anywhere` for the same reason. Three new classes —
`.run-config__effort-current` (the current-effort line), `.run-config__effort-empty` (the offers-none
copy) and `.run-config__effort-cut` (the cut marker) — join the shipped muted body-small group beside
`.run-config__model-unknown`; none takes `--color-error`, since none of the three is an error state.

The pre-#976 tests were written against the fixed five and correctly went red: one
(`'always renders all five level labels'`) stated the removed contract and was deleted outright rather
than repaired; the rest gained fixtures that publish real per-row levels (`PUBLISHED_ROWS` now carries
the measured five on one row, a shorter distinct set on another, and `[]` on the Haiku-shaped row) so
one fixture set serves all three readings. Two tests outside the ticket's own cascade went red for a
reason worth remembering: `'leaves a marked control fully operable'` and `'alters no existing
accessible name…'` drew their only `role="button"` and their only `aria-current` from the effort
segments, so once the section stopped rendering unconditionally, both started depending on which
fixture was passed — a class-name grep would not have found them, a `role="button"` grep would. See
`docs/specs/architecture/976-effort-segments-from-published-levels.md` for the full design and the
security review; the "no hardcoded label survives" assertion is written as a count rather than a list,
to avoid re-typing the deleted five levels into the file that proves they are gone.

## Log data section (#72)

The sheet's **first populated section** — the sole user-facing entry point for the client debug-bundle
download (the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) family, whose background
chain — request/reassemble/save/[orchestrator](debug-bundle-orchestrator.md) — was already merged and
inert for want of a UI driver). Mounted as `<LogDataSection/>`, the sheet body's last child (`<RunConfigSections/>`, #188, now
precedes it), last in document order ("beneath Context-window" per Figma node `20-100` subtree
`98:2`/`98:16`):

```
.status-sheet__body
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription)
    └── LogDataView                    (pure: props in, markup out)
        ├── .status-sheet__section-header   "Log data" (reused across future sections)
        └── .log-data
            ├── button.log-data__download   full-width filled-tonal pill, "Download"/"Downloading…"
            └── p.log-data__status[role=status]   count / saved path / mapped error (only when non-null)
```

The download state (`idle` / `downloading{chunks}` / `saved{path}` / `failed{reason}`) is a small,
**pure, total, phase-agnostic** reducer (`logDataDownload.ts`, the `composerSend.ts`/`pairingState.ts`
idiom) driven by `useReducer` per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
— never the session store, since [`translateDaemonEvent`](daemon-event-bridge.md) already returns
`null` for all three `debugBundle*` events. The container's single `onDaemonEvent` subscription filters
those three events via `toDownloadAction` (the `translateDaemonEvent` analogue) and is torn down on
unmount, so a sheet close/reopen nets exactly one live listener. Pressing Download sends the bare
`requestDebugBundle` command and **optimistically** dispatches `requested` (not gated on the first
daemon event — the `unavailable` failure path emits no progress at all). Single-in-flight is
belt-and-suspenders: the button disables while busy and `onDownload` re-checks the phase, with the
deterministic backstop being the [#169 orchestrator](debug-bundle-orchestrator.md)'s own `active`
flag, not a second authoritative guard here. Failure text is drawn from a closed `reason → sentence`
map — never the raw `DebugBundleFailure` token, an errno, or a stack (AC5).

Two more M3 tokens landed for the button: `--color-secondary-container` / `--color-on-secondary-container`
(filled-tonal fill/text). See [#72 codebase notes](../codebase/72.md) for the full design, patterns,
and the one copy-only deviation from spec.
