# Reply to a timeline message

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: renderer-only ownership, static-render limits and browser evidence.
- `docs/knowledge/features/conversation-shell-message-bubble.md` → The copy control: source text, 13px column and non-overlapping padded targets.
- `docs/knowledge/features/composer-send.md` → The controlled composer: exact retained drafts; trimming belongs only to submission.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `Timeline`, `TimelineRow`, `MessageActions`, `ComposerSlot`, `Composer`: pane coordinates, current source and the existing textarea ref.
- `src/renderer/src/store/composerDraftStore.ts` → `selectDraft`, `setDraft`: nested host/conversation keys preserve other drafts, including equal ids on different hosts.
- `src/renderer/src/PairedShell.tsx` → `paneKey`: chat switches remount transient pane state.
- `src/renderer/src/screens/conversation/copyMessageText.ts` and its tests: adjacent pure text helper and content-free diagnostics.
- `src/renderer/src/screens/conversation/conversation.css` → `.message-actions`, `.bubble__copy`: existing tokens and button geometry.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → message actions cases: settled, streaming, attached and queued rows.
- `e2e/message-copy.spec.ts`, `e2e/conversation-switch-remount.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: encrypted fake-frame delivery, navigation and outgoing payload observation.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4225 and component https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=808-12242. Both design contexts and screenshots were read.

Extend `MessageActions` with the supplied `reply-solid-full` asset (13×12px), below copy in the 13px column. Use `--color-inverse-primary` (#32628d), `--space-3` (12px) between glyph margin boxes, vertical centring, and the existing padded button/focus-outline treatment. The 20px-high targets leave a 4px gap; hover and pressed appearance stay constant.

## Context

Answering an earlier message currently requires manual copying. One renderer-only deliverable appends its full source to the selected draft and places the caret below it. No wire or send contract changes, new dependency or ADR is needed.

In-flight overlaps: #1729, #1731 and #1761 touch the screen; their question placement, queue projection and suggestion changes do not supply a dependency. Keep this wiring additive and local.

Sizing: approximately 450 written lines including plan, unit/static tests, browser tests and asset; one new exported helper, fewer than 10 updated consumers, four observable acceptance criteria, no new error/reject state machine.

## Design

- Add pure `appendMessageQuote(draft: string, role: 'user' | 'assistant', text: string): string` beside `copyMessageText`. Preserve the draft exactly, add one separator newline only when needed, then `User:` or `Assistant:`, newline, straight double quotes around the literal full source, and a final newline. No escaping, attachment text or truncation.
- Add an optional `onReply(role, text)` callback to `Timeline`, passing it through `TimelineRow` to `MessageActions`. Both buttons use the same current `item.text`; queued rows retain no actions.
- The pane callback reads the latest draft from `composerDraftStore.getState()`, uses its retained `selectedHost` and `openConversationId`, and calls `setDraft`. This works for offline/saved chats and never derives ownership from an id-only cache. Null coordinates do not write.
- Increment a pane-local focus request counter on each reply and pass it through `ComposerSlot` to `Composer`. Existing callers default to zero. `Composer` consumes each counter once with a ref in `useThreadLayoutEffect`, after the controlled value commits, then focuses `typeAhead.inputRef` and collapses selection at `textarea.value.length`.
- A static `Reply to message` accessible name and native button provide keyboard activation. Emit only a static diagnostic event/code for a successful draft append, never message or draft content.

## State + concurrency model

Text remains in the existing Zustand draft store. Replies read its latest state synchronously, so repeated activation appends in order. The focus counter is transient pane state; remounts discard it and the consumed ref prevents typing from replaying it. There is no new async job, stream or subscription. Existing send gating and submission trimming remain authoritative.

## Error handling

Draft append is synchronous and adds no I/O failure mode. Missing pane coordinates prevent an anonymous write; a missing textarea ref requires no deferred retry. Clipboard rejection remains owned by `copyMessageText`. Quoted source reaches only the controlled textarea value, never HTML, attributes or logs.

## Testing strategy

- Vitest: both labels, multiline markdown and embedded quotes, empty/existing drafts with and without trailing newline, repeated replies and very long source retained in full.
- Static markup: native named reply below copy on user and assistant sides, streaming tail, attachments and queued exclusion. Update the existing actions-order assertion for the second control.
- One focused fake-transport Playwright spec: pointer and Tab/keyboard activation, repeated append, caret/focus, editing and outgoing trimmed payload; chat and host isolation including identical ids, plus saved/offline drafting and no focus replay. Check icon geometry, centring, gap, target separation and focus outline. Capture synthetic app state at 1280px and 800px widths and compare with Figma.
- After final main merge: pre-verify check, build, and the focused browser spec; unchanged live tests remain dispatcher-owned.

## Open Questions

None. The pane-local counter is the simplest focus wiring: it avoids adding transient focus state to the retained draft store.
