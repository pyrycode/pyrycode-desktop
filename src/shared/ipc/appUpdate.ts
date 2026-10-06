export const APP_UPDATE_STATE_CHANNEL = 'pyry:app-update-state'
export const APP_UPDATE_ACTION_CHANNEL = 'pyry:app-update-action'
export type AppUpdateState = { type: 'idle' } | { type: 'ready'; version: string | null } | { type: 'failed' }
export type AppUpdateAction = { type: 'restart' } | { type: 'dismiss' }

export function validateUpdateVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 &&
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value) && value.trim() === value ? value : null
}
export function projectAppUpdateState(value: unknown): AppUpdateState {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    if (value.type === 'failed') return { type: 'failed' }
    if (value.type === 'ready') return { type: 'ready', version: validateUpdateVersion('version' in value ? value.version : null) }
  }
  return { type: 'idle' }
}
export function isAppUpdateAction(value: unknown): value is AppUpdateAction {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && Object.keys(value)[0] === 'type' &&
    'type' in value && (value.type === 'restart' || value.type === 'dismiss')
}
