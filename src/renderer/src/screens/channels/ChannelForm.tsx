import { MAX_SYSTEM_PROMPT_BYTES, type WireModelOption } from '@shared/wire/types'
import { useEffect, useRef, useState } from 'react'
import { ComposerOptionsMenu } from '../conversation/ComposerOptionsPanel'
import { composerModelRowLabel } from '../conversation/ComposerModelMenu'
import modelChevron from '../../assets/channel-model-chevron.svg?raw'

// Client-owned copy, apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`). NO DAEMON STRING
// REACHES EITHER. The wording restates the channel info sheet's over-limit line rather than importing
// it: that module is sheet-scoped and drags two stores and the write bridge into its module graph.
// The only thing that could drift
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
export function ChannelForm({ name, busy, error, onNameChange, prompt, model }: {
  name: string
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
  model?: {
    rows: readonly WireModelOption[]
    selected: WireModelOption | undefined
    onChange: (index: number) => void
  }
  prompt?: {
    value: string
    /** Derived by the owning container, which needs the same answer to disable OK. */
    overLimit: boolean
    onChange: (next: string) => void
  }
}): JSX.Element {
  const [modelChevronUrl, setModelChevronUrl] = useState<string>()
  const modelField = useRef<HTMLDivElement>(null)
  const hasModel = model !== undefined
  useEffect(() => {
    if (!hasModel) return
    // Vite inlines small SVG imports as data URLs, which this app's CSP rejects. Keep the exact
    // local asset in a permitted blob URL, owned and revoked by this mounted field.
    const url = URL.createObjectURL(new Blob([modelChevron], { type: 'image/svg+xml' }))
    setModelChevronUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [hasModel])
  useEffect(() => {
    const field = modelField.current
    const modal = field?.closest('.modal')
    if (!hasModel || field === null || modal === null || modal === undefined) return
    // Only the list escapes the modal's scrollport. Keep its viewport anchor current when the
    // prompt is resized or the modal scrolls, without changing the shared menu's interaction.
    const place = (): void => {
      const trigger = field.querySelector<HTMLButtonElement>('.create-channel__model')
      if (trigger === null) return
      const bounds = trigger.getBoundingClientRect()
      field.style.setProperty('--channel-model-left', `${bounds.left}px`)
      field.style.setProperty('--channel-model-top', `${bounds.bottom}px`)
      field.style.setProperty('--channel-model-width', `${bounds.width}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(modal)
    observer.observe(field)
    modal.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      modal.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [hasModel])
  const chevron = <span className="create-channel__model-chevron" aria-hidden="true"
    style={{ maskImage: modelChevronUrl === undefined ? undefined : `url(${modelChevronUrl})` }} />
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
    {model !== undefined && <div ref={modelField} className="create-channel__field create-channel__model-field" role="group" aria-label="Model">
      <span className="create-channel__label">Model:</span>
      {busy ? <button type="button" className="create-channel__model" disabled>
        <span>{model.selected === undefined ? 'Default' : composerModelRowLabel(model.selected)}</span>
        {chevron}
      </button> : <ComposerOptionsMenu
        options={model.rows.map((row, index) => ({ id: String(index), label: composerModelRowLabel(row) }))}
        currentId={model.selected === undefined ? null : String(model.rows.indexOf(model.selected))}
        onSelect={(id) => model.onChange(Number(id))}
        ariaLabel="Model"
        triggerClassName="create-channel__model"
        triggerContent={<>
          <span>{model.selected === undefined ? 'Default' : composerModelRowLabel(model.selected)}</span>
          {chevron}
        </>}
        placement="bottom-end"
      />}
    </div>}
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
