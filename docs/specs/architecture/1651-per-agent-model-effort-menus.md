# #1651 — a conversation's model and effort menus offer only its own agent's models

## Files read

- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `publishedRowFor`, `effortRowFor`, `INHERITED_DEFAULT_MODEL_VALUE`, `useSessionSettingsConnected`, `RunConfigView`, `RunningModelSection`, `ModelSection`, `EffortSection`, `RunConfigSections` — the two lookups every menu joins by, and the sheet's three agent-sensitive sections.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`, `modelFamily`, `firstShown`, `ComposerModelMenuView`, `ComposerModelMenu` — the footer model menu; the row label is computed inline today.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel`, `ComposerEffortMenuView` (the two Claude-naming tooltip strings), `ComposerEffortMenu`.
- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` → `composerPermissionModeMenuModel` — reads `supports_auto_mode` off `publishedRowFor`'s row.
- `src/renderer/src/screens/conversation/EffortDefaultData.tsx` → `effortDefaultToApply`, `EffortDefaultInput`, `EffortDefaultData` — applies the remembered effort through `effortRowFor`.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationAgentFor`, `selectConversations` — #1649's per-conversation agent answer (reads `byServer`).
- `src/renderer/src/screens/conversation/unpairAction.ts` → `serverIdForOpenConversation` — the owner resolution `useSessionSettingsConnected` already uses; the agent hook reuses it so no container needs a new prop.
- `src/shared/wire/types.ts` → `WireAgent`, `agentFromWire`, `WireModelOption.agent` — an untagged row counts as Claude.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `selectOpenAgent` — the existing reader of the open conversation's agent; the containers are rendered here with `conversationId` only, and this file is NOT touched.

Overlap: `origin/feature/1544` edits comments and the container comment in `ComposerPermissionModeMenu.tsx`. Not a dependency; edits here stay additive and local to `composerPermissionModeMenuModel` and the container's props.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=115-3683 (model button), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=115-3688 (effort button), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=121-3879 (options panel)

Nothing new is drawn. The existing footer buttons and the dark options panel (a column of plain text rows, the current one highlighted) are reused unchanged; on a Codex conversation they list Codex's families and their levels instead of Claude's. No token, component or asset changes, so no screenshot comparison is owed beyond the existing markup.

## Context

With `multi_agent` advertised, every conversation's `model_list` is one merged list (Claude rows, then one Codex row per family). The menus match `value` across the whole list and map every row, so a Codex conversation would list Claude models, offer Claude's `default` levels with no model set, and derive "Gpt" from `gpt-6-luna`. A model of the other agent is refused on a session. No ADR is needed: this is a filter on an existing join.

## Design

### Lookups (`RunConfigSections.tsx`)

- `rowAgent(row: WireModelOption): WireAgent` — module-private: `row.agent ?? 'claude'` (the wire rule: absent counts as Claude).
- `modelRowsFor(models, agent): readonly WireModelOption[]` — exported. The entry's rows whose `rowAgent` equals `agent`, in the daemon's order; `[]` with no entry. Used by both row lists (sheet and footer).
- `publishedRowFor(models, model, agent: WireAgent)` — the agent becomes a **required** third parameter; the match is `value === model && rowAgent(row) === agent`. Required so no production caller can forget it (7 call sites, no test calls it directly).
- `effortRowFor(models, model, agent: WireAgent)` — the empty model substitutes `default` **only when `agent === 'claude'`**; on Codex `''` returns `undefined` (no inherited-default row exists for Codex).
- `useConversationAgent(conversationId): WireAgent` — exported hook beside `useSessionSettingsConnected`: resolve the owner with `serverIdForOpenConversation(selectConversations)`, then read `selectConversationAgentFor(serverId, conversationId)` through a `useMemo`-stable selector; a null id or unattributable owner answers `'claude'`. Every container calls it, so `ConversationScreen.tsx` is untouched.

### Sheet (`RunConfigSections.tsx`)

`RunConfigView` gains `agent?: WireAgent` (absent = Claude, so every existing view test is the Claude path). `RunningModelSection`, `ModelSection` and `EffortSection` each take it: running line → `publishedRowFor(…, agent)`; model rows → `modelRowsFor(models, agent)` (an agent with no rows reads the existing "No models offered" sentence, frame-level partial notice unchanged); effort → `effortRowFor(…, agent)`. The container passes `useConversationAgent(conversationId)`.

### Footer model menu (`ComposerModelMenu.tsx`)

- `composerModelRowLabel(row: WireModelOption): string` — exported (reused by #1658). Claude row: today's rule (`modelFamily(value)`, else `display_name`). Codex row: `display_name` verbatim, never derived.
- `composerModelMenuModel(models, layers, agent: WireAgent = 'claude')` — optional third argument so the ~40 existing Claude-path calls stay byte-identical. Options come from `modelRowsFor(models, agent)` mapped through `composerModelRowLabel`. All lookups pass `agent`.
  - Trigger on Claude: unchanged. Trigger on Codex: `row ? row.display_name : shown` — no `modelFamily` anywhere on the Codex path.
  - Codex with nothing shown and a snapshot present (`stored === ''`): label `COMPOSER_MODEL_DEFAULT_LABEL = 'Default'`, `currentId: null`, options = the Codex rows (so it still opens). No snapshot (`stored === null`) → `null`, as today.
- `ComposerModelMenuView` gains `agent?: WireAgent`; the container passes `useConversationAgent`.

### Footer effort menu (`ComposerEffortMenu.tsx`)

- `composerEffortMenuModel(models, model, effort, agent: WireAgent = 'claude')` → `effortRowFor(models, model, agent)`. Codex + `''` model → no levels → the inert label.
- Tooltip copy: the agent's name substitutes for `Claude` in the two agent-naming descriptions (`'Codex reports no model effort parameter.'`, `'Codex default; applied effort is unavailable.'`); Claude strings byte-identical. `ComposerEffortMenuView` gains `agent?: WireAgent`.

### Permission menu (`ComposerPermissionModeMenu.tsx`)

`composerPermissionModeMenuModel(models, model, permissionMode, agent: WireAgent = 'claude')` passes `agent` to `publishedRowFor`; the `supports_auto_mode` rule itself is unchanged. View gains `agent?`; container passes the hook.

### Effort default (`EffortDefaultData.tsx`)

`EffortDefaultInput` gains `agent?: WireAgent` (absent = Claude, so the 20 existing input literals are unchanged); `effortDefaultToApply` passes it to `effortRowFor`. On Codex with no model, no row → nothing applied. The container reads the hook and adds `agent` to the effect's deps.

## State + concurrency model

No new store or async work. One new read per container: the conversation-list store, through two narrow selectors returning a stable array reference and a primitive. No teardown changes.

## Error handling

No new failure mode. A Codex conversation with an untagged (Claude-only) list reads an empty row set: the sheet says "No models offered", the footer model menu is an inert label, the effort menu inert. That is the honest reading, never a fallback to Claude's rows.

## Security

`display_name` stays daemon text reaching one escaped JSX text child, exactly as today; the Codex path removes a derivation rather than adding a sink. The agent is client-held (`agentFromWire`), never rendered or logged. No logging added (no new lifecycle or error event).

## Testing strategy

Vitest, static render, co-located:

- `RunConfigSections.test.tsx`: `RunConfigView` over a merged list — Claude (default) lists only Claude rows; Codex lists only Codex rows with `display_name` verbatim; Codex effort for `luna` lists exactly its levels incl. `xhigh`; Codex effort with `''` model offers no segments while Claude `''` still resolves `default`'s levels; running line on Codex matches only a Codex row. Container: a seeded Codex conversation in `conversationListStore` renders Codex rows (proves `useConversationAgent`).
- `ComposerModelMenu.test.tsx`: merged list — Claude options/labels unchanged; Codex options are Codex rows with `display_name`, trigger over a hit shows `display_name` (not "Gpt"); Codex `stored: ''` → label Default, `currentId` null, options non-empty; `composerModelRowLabel` for each agent. Existing untagged calls untouched.
- `ComposerEffortMenu.test.tsx`: Codex row levels incl. `xhigh`; Codex `''` model → no options; tooltip names Codex vs Claude.
- `ComposerPermissionModeMenu.test.tsx`: on Codex a Claude row sharing the value does not hide Auto; Codex row `supports_auto_mode: false` hides it.
- `EffortDefaultData.test.tsx`: Codex + `''` model applies nothing where Claude would; Codex + `luna` applies a listed level.

No Playwright spec: no interaction changes; the fake transport sends untagged lists, so the existing e2e tier asserts the Claude path unchanged.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: fold the per-agent lookup rule into the conversation-screen package overview.

## Open questions

- Should the Codex trigger on an announcement miss fall back to the session row's `display_name`? Decision for now: no — the verbatim shown string, matching Claude's miss rule, and no client-built name.

## Revisions

- **2026-09-25, during implementation.** `useConversationAgent` is a thin `useMemo` wrapper over an exported pure selector, `selectAgentForConversation(conversationId)(state)`, that does both steps (owner via `serverIdForOpenConversation`, then `selectConversationAgentFor`) in one subscription. Reason: the server renderer reads a zustand store's initial state, so a seeded container render cannot prove the hook. The selector is unit-tested against a real `createConversationListStore` instead. The contract is unchanged: a primitive `WireAgent`, Claude for a null id, an unknown id or an unattributable owner.
- **Open question resolved.** The Codex trigger on a miss shows the shown string verbatim, as planned; no fallback to the session row.
