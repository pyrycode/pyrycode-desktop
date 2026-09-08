// #1078: the channel info sheet's System prompt section — the surface for a whole vertical that has
// been built and dark since #1230. It reads `systemPromptStore` (what this conversation holds, and
// whether the running session was started with something else) and `systemPromptWriteStore` (what
// happened to the last save), edits the value, shows the 8192-byte bound WHILE TYPING, and submits
// through `submitSystemPrompt`. It adds no wire type, no envelope and no IPC arm.
//
// Its own file rather than a fourth thousand lines in ConversationScreen.tsx — the WorkspacePickerSheet /
// CreateFolderDialog precedent in this directory. Three exports, in the order the state flows:
// the pure state machine, the pure view, and the thin container that owns the draft and the dispatch.
//
// SECURITY — `systemPrompt` IS UNTRUSTED, OPERATOR-AUTHORED, NETWORK-RELAYED TEXT, and this file is the
// first consumer that RENDERS AND EDITS it rather than holding it. `systemPromptStore`'s header restates
// the deny-list rather than inheriting it by reference for exactly this moment; discharging it is this
// file's job. The value reaches ONE sink: a controlled `<textarea value={…}>`, which React renders as an
// escaped TEXT CHILD server-side and sets as a DOM PROPERTY in the browser — never a serialized HTML
// attribute, so the "never into an attribute" clause is not violated by the `value=` spelling. There is
// no dangerouslySetInnerHTML, no URL, no filename, no cache key, no lookup path, and no `key={}` on
// prompt text anywhere below (this section renders no list). Nothing here trims, normalises or
// shape-checks the value: it round-trips back to the daemon as a write, so any normalisation would
// silently change what the operator stored.
//
// NOTHING ON THIS PATH IS EVER LOGGED, on any branch — not even a byte count. The count IS rendered,
// into the operator's own window, because AC3 requires it; the renderer console, a log file and
// telemetry are the sinks both store headers forbid, and none is touched here. The draft lives in
// `useState` and dies with the sheet's unmount: an operator can paste a credential into a system prompt,
// so nothing on this path touches localStorage, sessionStorage, IndexedDB or zustand persist/devtools.
import { useState } from 'react'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'
import type { SystemPromptWriteFailure } from '@shared/ipc/events'
import {
  selectSystemPromptReading,
  useSystemPromptStore,
  type SystemPromptReading
} from '../../store/systemPromptStore'
import {
  selectSystemPromptWriteFor,
  systemPromptWriteStore,
  useSystemPromptWriteStore,
  type SystemPromptWrite
} from '../../store/systemPromptWriteStore'
import { submitSystemPrompt } from '../../store/systemPromptWriteBridge'

// The section's copy — module-level, client-owned constants (the CHANNEL_INFO_* idiom in
// ConversationScreen.tsx). Every literal is apostrophe-free: renderToStaticMarkup escapes `'` →
// `&#x27;` (the standing desktop lesson). NO DAEMON STRING REACHES ANY OF THEM. The two things the
// daemon supplies that steer copy — `SystemPromptWriteFailure` and `SessionPromptStatus` — are closed
// unions narrowed at the decode boundary against constants, so what is switched on below is a
// client-owned literal, and the daemon's own error message is never surfaced.
const SYSTEM_PROMPT_HEADER = 'System prompt'
const SYSTEM_PROMPT_LOADING = 'Reading the stored prompt from the daemon'
const SYSTEM_PROMPT_HINT =
  'This prompt is stored on the channel, so two channels on one repository can behave differently.'
const SYSTEM_PROMPT_OVER_LIMIT = `Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`
const SYSTEM_PROMPT_SAVE = 'Save'
const SYSTEM_PROMPT_CLEAR = 'Clear'
const SYSTEM_PROMPT_EDITOR_LABEL = 'System prompt for this channel'
const WRITE_IN_FLIGHT = 'Saving'
const WRITE_CONFIRMED =
  'Saved. A running session keeps the prompt it started with until New session.'
const SESSION_DIFFERS =
  'The running session was started with a different prompt. New session applies the saved one.'

// One line per SystemPromptWriteFailure member. `prompt-too-long` names the bound rather than repeating
// the count, because reaching it at all means the pre-flight gate below was bypassed (an over-length
// value pasted and saved in the same frame, say) — main refuses it independently and always will.
const WRITE_REJECTED: Record<SystemPromptWriteFailure, string> = {
  'prompt-too-long': `Not saved: the prompt is over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit.`,
  'protocol-malformed': 'Not saved: the daemon refused the request.',
  'conversation-not-found': 'Not saved: the daemon has no record of this channel.',
  unclassified: 'Not saved: the daemon refused the write.'
}

// Hoisted, because otherwise a fresh encoder is allocated on every keystroke. It MUST agree exactly with
// main's `Buffer.byteLength(prompt, 'utf8')` in daemonConnection.ts, and does: both encode UTF-8 and both
// replace an unpaired surrogate with U+FFFD. A disagreement would let this section report "under" on a
// value main refuses, which is the precise failure AC3 exists to remove.
const UTF8 = new TextEncoder()

/**
 * Everything the section renders, as a pure function of the two stores plus the local draft.
 *
 * `loading` is the reading-has-not-arrived arm and it is the whole of AC1's fail-closed half: no editor,
 * no Save, no Clear. `system_prompt` is REPLY-ONLY (nothing publishes it unsolicited), so a relay that
 * withholds or delays the reply leaves the section here indefinitely — which is correct, and the reason
 * this arm is keyed on the reading ALONE and not weakened by a held write marker.
 */
export type SystemPromptSectionModel =
  | { state: 'loading' }
  | {
      state: 'ready'
      /** What the editor shows. */
      text: string
      /** UTF-8 bytes of `text`. */
      byteLength: number
      /** `byteLength > MAX_SYSTEM_PROMPT_BYTES` — the bound is INCLUSIVE, matching main's `>`. */
      overLimit: boolean
      canSave: boolean
      canClear: boolean
      countLine: string
      /** What happened to the last write, or `null` when nothing is known — the fourth reading. */
      writeLine: string | null
      /** The `differs` notice, or `null`. `matches` and `no_session` say nothing of the kind. */
      sessionLine: string | null
    }

/**
 * THE EDITOR SEED IS THE ONE PLACE THE TRI-STATE LEGITIMATELY COLLAPSES, and it is written as an
 * explicit `undefined` branch rather than `?? ''` so that stays a decision instead of a habit.
 * `undefined` (this conversation holds no prompt) and `''` (it holds an explicitly empty one) are
 * indistinguishable to the eye and always will be — both are an empty box.
 *
 * THE TRI-STATE SURVIVES ON THE WRITE SIDE, which is where it matters: Save always sends a `string`
 * (`''` when the box is empty) and Clear always sends `null`. A clear is a control the operator presses,
 * NEVER inferred from an empty box — that inference is precisely what makes the clear path unreachable.
 */
function seedFor(reading: SystemPromptReading): string {
  if (reading.systemPrompt === undefined) return ''
  return reading.systemPrompt
}

function writeLineFor(write: SystemPromptWrite | null): string | null {
  if (write === null) return null
  switch (write.status) {
    case 'in-flight':
      return WRITE_IN_FLIGHT
    case 'confirmed':
      return WRITE_CONFIRMED
    case 'rejected':
      return WRITE_REJECTED[write.reason]
  }
}

/**
 * The whole state machine. `draft === null` means UNTOUCHED — the editor shows the reading's seed; any
 * string means the operator has typed, INCLUDING `''`.
 *
 * That distinction is load-bearing rather than tidy: an on-path relay can delay the `system_prompt`
 * reply arbitrarily, and a section that re-seeded from a reading landing after the operator started
 * typing would silently replace their text, so the next Save would store the daemon's value under the
 * operator's intent. Once `draft` is non-null the reading is never read for display again.
 *
 * Both controls are withheld while a write is in flight. That is #1250's two-writes ambiguity closed
 * BEHAVIOURALLY, as that store's docblock requires: this verb correlates on the conversation id alone,
 * so two outstanding writes against one conversation are indistinguishable and a client-minted change id
 * was rejected upstream rather than deferred. It also bounds the outbound frame rate to one per settled
 * write, so holding a control cannot flood an on-path relay.
 */
export function deriveSystemPromptSection(
  reading: SystemPromptReading | null,
  write: SystemPromptWrite | null,
  draft: string | null
): SystemPromptSectionModel {
  if (reading === null) return { state: 'loading' }
  const text = draft === null ? seedFor(reading) : draft
  const byteLength = UTF8.encode(text).length
  const overLimit = byteLength > MAX_SYSTEM_PROMPT_BYTES
  const settled = write === null || write.status !== 'in-flight'
  return {
    state: 'ready',
    text,
    byteLength,
    overLimit,
    canSave: settled && !overLimit,
    canClear: settled,
    countLine: `${byteLength} / ${MAX_SYSTEM_PROMPT_BYTES} bytes`,
    writeLine: writeLineFor(write),
    sessionLine: reading.sessionPromptStatus === 'differs' ? SESSION_DIFFERS : null
  }
}

/**
 * The pure view — props in, markup out, no store and no window.pyry, so tests server-render it with an
 * injected model (the ChannelInfoSheetView / WorkspacePickerSheetView discipline). It owns its own
 * `.status-sheet__section-header`, so the sheet's slot is self-contained the way RunConfigSections is
 * inside StatusSheet.
 *
 * The editor borrows the Rename dialog's outlined field (Figma 19:16) — a wrapping `<label>` giving the
 * textarea its accessible name from the visible label text, no id/htmlFor pair — because the section
 * itself is not drawn and the ticket directs borrowing over inventing chrome.
 */
export function SystemPromptSectionView({
  model,
  onTextChange,
  onSave,
  onClear
}: {
  model: SystemPromptSectionModel
  onTextChange: (next: string) => void
  onSave: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <>
      <p className="status-sheet__section-header">{SYSTEM_PROMPT_HEADER}</p>
      {model.state === 'loading' ? (
        // No editor and NO CONTROLS: an unanswered conversation cannot be saved blank over a value the
        // daemon is still holding (AC1).
        <p className="system-prompt__empty">{SYSTEM_PROMPT_LOADING}</p>
      ) : (
        <>
          <p className="system-prompt__hint">{SYSTEM_PROMPT_HINT}</p>
          <label className="system-prompt__field">
            <span className="system-prompt__label">{SYSTEM_PROMPT_EDITOR_LABEL}</span>
            {/* The prompt reaches the DOM here and nowhere else — an escaped React text child
                server-side, a DOM property in the browser. Never markup, never an attribute. */}
            <textarea
              className="system-prompt__input"
              rows={4}
              value={model.text}
              onChange={(e) => onTextChange(e.target.value)}
            />
          </label>
          <p
            className={
              model.overLimit ? 'system-prompt__count system-prompt__count--over' : 'system-prompt__count'
            }
          >
            {model.countLine}
          </p>
          {model.overLimit && <p className="system-prompt__over">{SYSTEM_PROMPT_OVER_LIMIT}</p>}
          {model.sessionLine !== null && (
            <p className="system-prompt__session">{model.sessionLine}</p>
          )}
          {model.writeLine !== null && <p className="system-prompt__write">{model.writeLine}</p>}
          <div className="system-prompt__actions">
            <button
              type="button"
              className="system-prompt__save"
              onClick={onSave}
              disabled={!model.canSave}
            >
              {SYSTEM_PROMPT_SAVE}
            </button>
            <button
              type="button"
              className="system-prompt__clear"
              onClick={onClear}
              disabled={!model.canClear}
            >
              {SYSTEM_PROMPT_CLEAR}
            </button>
          </div>
        </>
      )}
    </>
  )
}

/**
 * The interaction container — the ChannelInfoSheet-mounts-RenameConversationDialogView shape. It reads
 * two narrow slices (each selector returns the HELD object, so a re-render happens only on a real
 * transition), owns the draft as transient UI state (ADR 0006), and dereferences `window.pyry` ONLY
 * inside the two callbacks, so the whole subtree stays server-renderable with no bridge stub.
 *
 * `conversationId` is REQUIRED, not nullable: the sheet supplies this section only in its
 * `conversation !== null` branch, so there is no id-or-empty-string fallback to get wrong.
 *
 * Clear sets the draft to `''` as well as sending `null`, so the box the operator is looking at empties
 * immediately. That is a DISPLAY effect only — it stores nothing optimistically, and what the
 * conversation now holds stays the read path's answer (#1250's no-optimistic-value rule).
 */
export function SystemPromptSection({ conversationId }: { conversationId: string }): JSX.Element {
  const reading = useSystemPromptStore(selectSystemPromptReading)
  const write = useSystemPromptWriteStore(selectSystemPromptWriteFor(conversationId))
  const [draft, setDraft] = useState<string | null>(null)
  const model = deriveSystemPromptSection(reading, write, draft)
  const submit = (systemPrompt: string | null): void =>
    submitSystemPrompt(
      {
        sendCommand: window.pyry.sendCommand,
        dispatch: (event) => systemPromptWriteStore.getState().dispatch(event)
      },
      conversationId,
      systemPrompt
    )
  return (
    <SystemPromptSectionView
      model={model}
      onTextChange={setDraft}
      // Save sends a `string` always — `''` when the box is empty, which STORES an explicitly empty
      // prompt rather than clearing. The two are different daemon states and this is the seam that keeps
      // them apart.
      onSave={() => {
        if (model.state === 'ready') submit(model.text)
      }}
      onClear={() => {
        submit(null)
        setDraft('')
      }}
    />
  )
}
