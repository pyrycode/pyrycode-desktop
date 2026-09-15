/**
 * Shared fields only; each dialog owns submission and continuation. The name field is the whole
 * form: #1436 withdrew the workspace-relative folder choice, because a channel in
 * `<workspace>/channels/<slug>/` opens a workspace group of its own — a workspace is a
 * conversation's `cwd` as an exact string, and nothing below one belongs to it.
 */
export function ChannelForm({ name, busy, error, onNameChange }: {
  name: string
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
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
    {error !== null && <p className="create-channel__error" role="alert">{error}</p>}
  </>
}
