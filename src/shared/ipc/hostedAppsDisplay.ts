import { MAX_SERVER_ID_LENGTH } from './unpair'
export const HOSTED_APPS_DISPLAY_CHANNEL = 'pyry:hosted-apps-display'
export type HostedAppsDisplayState = { serverId: string } & (
  { type: 'unavailable' | 'unsupported' | 'loading' | 'failed' } |
  { type: 'ready'; items: { appId: string; title: string; state: 'starting' | 'running' | 'stopped' | 'failed' }[] }
)
export type HostedAppsDisplayCommand = { type: 'watch' | 'unwatch' | 'refresh'; serverId: string; token: number }
export function isHostedAppsDisplayCommand(v: unknown): v is HostedAppsDisplayCommand {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    Object.keys(v).sort().join(',') === 'serverId,token,type' && 'type' in v &&
    (v.type === 'watch' || v.type === 'unwatch' || v.type === 'refresh') &&
    'serverId' in v && typeof v.serverId === 'string' && v.serverId.length > 0 && v.serverId.length <= MAX_SERVER_ID_LENGTH &&
    'token' in v && typeof v.token === 'number' && Number.isSafeInteger(v.token) && v.token >= 0
}
