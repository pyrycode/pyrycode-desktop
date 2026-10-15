import { MAX_SERVER_ID_LENGTH } from './unpair'
export const HOSTED_PANE_CHANNEL = 'pyry:hosted-pane'
export type HostedPaneState = { type: 'closed'; generation: number } | {
  type: 'loading' | 'ready' | 'disconnected' | 'unsupported' | 'unavailable'
  generation: number; serverId: string; appId: string; hostLabel: string; appLabel: string
}
export type HostedPaneCommand = { type: 'select'; serverId: string; appId: string } | { type: 'snapshot' } |
  { type: 'close'; generation: number } | { type: 'reopen'; generation: number } |
  { type: 'layout'; generation: number; visible: boolean; bounds: { x: number; y: number; width: number; height: number } }
export function isHostedPaneCommand(v: unknown): v is HostedPaneCommand {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !('type' in v)) return false
  const keys = Object.keys(v).sort().join(',')
  if (v.type === 'snapshot') return keys === 'type'
  if (v.type === 'select') return keys === 'appId,serverId,type' && 'serverId' in v &&
    typeof v.serverId === 'string' && v.serverId.length > 0 && v.serverId.length <= MAX_SERVER_ID_LENGTH &&
    'appId' in v && typeof v.appId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.appId)
  if (!('generation' in v) || typeof v.generation !== 'number' || !Number.isSafeInteger(v.generation) || v.generation < 0) return false
  if (v.type === 'close' || v.type === 'reopen') return keys === 'generation,type'
  if (v.type !== 'layout' || keys !== 'bounds,generation,type,visible' || !('visible' in v) || typeof v.visible !== 'boolean' || !('bounds' in v)) return false
  const b = v.bounds
  return typeof b === 'object' && b !== null && Object.keys(b).sort().join(',') === 'height,width,x,y' &&
    'x' in b && 'y' in b && 'width' in b && 'height' in b &&
    [b.x, b.y, b.width, b.height].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
}
