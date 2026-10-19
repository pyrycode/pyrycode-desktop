const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const target = new RegExp(`^pyrycode://hosts/(${uuid})/apps/(${uuid})(?![\\s\\S])`)

/** Identity only, never resource authority. Deliberately no trimming, decoding or URL normalization. */
export function parseHostedAppLink(value: unknown): { serverId: string; appId: string } | null {
  const match = typeof value === 'string' ? target.exec(value) : null
  return match ? { serverId: match[1], appId: match[2] } : null
}
