const controls = new Set(['create_conversation', 'send_message', 'modal_answer'])
const identities = new Set(['conversation_id', 'session_id', 'modal_id', 'message_id', 'device_id', 'answer_token', 'epoch'])

/** Compare the UI's real request contract, ignoring only fresh opaque identities and query order. */
export function requestContract(recording) {
  const aliases = new Map()
  const normalize = (value, key = '') => {
    if (typeof value === 'string' && value && identities.has(key)) {
      if (!aliases.has(value)) aliases.set(value, `${key}:${aliases.size + 1}`)
      return aliases.get(value)
    }
    if (Array.isArray(value)) return value.map(child => normalize(child))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child, key)]))
    return value
  }
  const steps = []
  let queries = []
  const flush = () => { if (queries.length) steps.push(queries.sort()); queries = [] }
  for (const entry of recording.wire) {
    if (entry.direction !== 'client') continue
    const message = entry.message
    const signature = JSON.stringify({ type: message.type, payload: normalize(message.payload) })
    if (controls.has(message.type)) { flush(); steps.push(signature) }
    else queries.push(signature)
  }
  flush()
  return JSON.stringify({ scenario: recording.scenario.id, historyRetry: recording.scenario.historyRetry, steps })
}
