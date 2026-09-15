import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'

// Client-owned copy, apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`). NO DAEMON STRING
// REACHES EITHER. The wording restates the channel info sheet's over-limit line rather than importing
// it: that module is sheet-scoped and drags two stores and the write bridge into its module graph, and
// nothing in this directory imports from `screens/conversation/`. The only thing that could drift
// numerically is the bound, and both sides read it from the one shared constant.
const SYSTEM_PROMPT_LABEL = 'Channel system prompt:'
const SYSTEM_PROMPT_OVER_LIMIT = `Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`

/**
 * Shared fields only; each dialog owns submission and continuation. The name field is always rendered:
 * #1436 withdrew the workspace-relative folder choice, because a channel in
 * `<workspace>/channels/<slug>/` opens a workspace group of its own — a workspace is a
 * conversation's `cwd` as an exact string, and nothing below one belongs to it.
 *
 * The channel system prompt (#1428) rides one OPTIONAL BUNDLED prop, so a dialog that passes nothing
 * renders exactly the form it rendered before — which is how Save as channel keeps the name field
 * alone without this file knowing which dialog it is inside. Bundled rather than three parallel
 * optional props, for the reason `WorkspaceCreateControl` is bundled: parallel optional props permit a
 * value with no over-limit state, or a handler with no visible label.
 *
 * SECURITY — the prompt is operator-authored text that may hold a pasted credential. It reaches ONE
 * sink here: the controlled `<textarea value={…}>`, which React renders as an escaped TEXT CHILD
 * server-side and sets as a DOM PROPERTY in the browser — never a serialized attribute, no
 * dangerouslySetInnerHTML, no URL, no filename, no cache key, no React `key`. Nothing in this file
 * logs, and nothing trims or normalises the value: it round-trips to the daemon as a write, so any
 * normalisation would silently change what the operator stored.
 */
export function ChannelForm({ name, busy, error, onNameChange, prompt }: {
  name: string
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
  prompt?: {
    value: string
    /** Derived by the owning container, which needs the same answer to disable OK. */
    overLimit: boolean
    onChange: (next: string) => void
  }
}): JSX.Element {
  return <>
    <label className="create-channel__field">
      <span className="create-channel__label">Channel name:</span>
      <input
        type="text"
        className="create-channel__input"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        disabled={busy}
        autoFocus
      />
    </label>
    {prompt !== undefined && <>
      {/* The wrapping label gives the text area its accessible name from the visible label text — the
          name field's own idiom, no id/htmlFor pair. Four rows over a 20px line and 16px of vertical
          padding is the drawing's 112px box. */}
      <label className="create-channel__field">
        <span className="create-channel__label">{SYSTEM_PROMPT_LABEL}</span>
        <textarea
          className="create-channel__textarea"
          rows={4}
          value={prompt.value}
          onChange={(event) => prompt.onChange(event.target.value)}
          disabled={busy}
        />
      </label>
      {/* Outside the label — inside, it would join the field's accessible name — and deliberately NOT
          role="alert", which would re-announce on every keystroke past the bound. */}
      {prompt.overLimit && <p className="create-channel__notice">{SYSTEM_PROMPT_OVER_LIMIT}</p>}
    </>}
    {error !== null && <p className="create-channel__error" role="alert">{error}</p>}
  </>
}
