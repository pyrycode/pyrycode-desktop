export const RECONNECT_SERVER_CHANNEL = 'pyry:reconnect-server'

export type ReconnectServerRequest = { serverId: string }

export function reconnectServerRequest(serverId: string): ReconnectServerRequest {
  return { serverId }
}

/** Validate the closed request shape; ids are matched verbatim by the registry. */
export function isReconnectServerRequest(value: unknown): value is ReconnectServerRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Reflect.ownKeys(value)
  return (
    keys.length === 1 &&
    keys[0] === 'serverId' &&
    'serverId' in value &&
    typeof value.serverId === 'string'
  )
}
