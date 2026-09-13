import type { ChannelLocation } from './SaveAsChannelDialog'

export function channelsParent(cwd: string): string {
  return cwd.replace(/\/+$/, '') + '/channels'
}

/** Shared fields only; each dialog owns submission and continuation. */
export function ChannelForm({ name, location, busy, error, onNameChange, onLocationChange }: {
  name: string
  location: ChannelLocation
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
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
    <label className="create-channel__option">
      <input type="radio" name="create-channel-location" value="scratch"
        checked={location === 'scratch'} disabled={busy}
        onChange={() => onLocationChange('scratch')} />
      <span>Use shared scratch folder</span>
    </label>
    <label className="create-channel__option">
      <input type="radio" name="create-channel-location" value="dedicated"
        checked={location === 'dedicated'} disabled={busy}
        onChange={() => onLocationChange('dedicated')} />
      <span>Create a dedicated channel folder</span>
    </label>
    {error !== null && <p className="create-channel__error" role="alert">{error}</p>}
  </>
}
