import type { AppUpdateState, AppUpdateAction } from '@shared/ipc/appUpdate'
import updateIcon from '../../assets/app-update.svg'

export function AppUpdateRow({ state, onEvent }: {
  state: AppUpdateState; onEvent: (event: AppUpdateAction) => void
}): JSX.Element | null {
  if (state.type === 'idle') return null
  const ready = state.type === 'ready'
  return (
    <div className="app-update" role="status">
      <div className="app-update__rule" />
      <div className="app-update__row">
        <span className="app-update__icon" aria-hidden="true" style={{ maskImage: `url(${updateIcon})` }} />
        <div className="app-update__content">
          <div className="app-update__title">{ready ? 'Update ready' : 'Update could not install'}</div>
          <div className={`app-update__caption${ready ? '' : ' app-update__caption--failed'}`}>
            {ready ? state.version === null ? 'An update installs when you restart.' :
              `Version ${state.version} installs when you restart.` : 'Pyrycode will try again next launch.'}
          </div>
          <div className="app-update__actions">
            {ready && <button type="button" className="button-small channel-info__mcp-reconnect"
              onClick={() => onEvent({ type: 'restart' })}>Restart now</button>}
            <button type="button" className="app-update__dismiss" onClick={() => onEvent({ type: 'dismiss' })}>
              {ready ? 'Later' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
