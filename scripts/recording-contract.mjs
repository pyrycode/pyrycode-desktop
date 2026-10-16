const queriesAllowed = new Set(['list_conversations', 'thread_catch_up', 'thread_page', 'request_session_settings',
  'request_context_usage', 'request_model_list', 'request_system_prompt'])
const identities = new Set(['conversation_id', 'session_id', 'modal_id', 'message_id', 'device_id', 'answer_token', 'epoch', 'attachment_id', 'tool_use_id', 'task_id'])

/** Compare the UI's real request contract, ignoring only fresh opaque identities and query order. */
export function requestContract(recording) {
  const aliases = new Map()
  const inputs = Object.entries(recording.scenario.inputs ?? {}).filter(([, value]) =>
    typeof value === 'string' && value.length > 0 || typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => String(b[1]).length - String(a[1]).length)
  const inputText = value => inputs.reduce((text, [name, input]) => text.replaceAll(String(input), `<scenario:${name}>`), value)
  const normalize = (value, key = '') => {
    if (typeof value === 'string' && value && identities.has(key)) {
      if (!aliases.has(value)) aliases.set(value, `${key}:${aliases.size + 1}`)
      return aliases.get(value)
    }
    if (typeof value === 'string') return inputText(value)
    if (Array.isArray(value)) return value.map(child => normalize(child))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child, key)]))
    return value
  }
  const steps = []
  let queries = []
  const flush = () => { if (queries.length) steps.push(queries.sort()); queries = [] }
  let barrier = 0, connection = 1
  for (let index = 0; index <= recording.wire.length; index++) {
    while (recording.barriers?.[barrier]?.before === index) {
      flush(); steps.push({ checkpoint: recording.barriers[barrier++].name })
    }
    const entry = recording.wire[index]
    if (!entry) break
    if ((entry.connection ?? 1) !== connection) {
      flush(); connection = entry.connection; steps.push({ connection })
    }
    if (entry.direction !== 'client') continue
    const message = entry.message
    const { id: _id, ts: _ts, ...contract } = message
    const signature = JSON.stringify(normalize(contract))
    if (queriesAllowed.has(message.type)) queries.push(signature)
    else { flush(); steps.push(signature) }
  }
  flush()
  return JSON.stringify({ scenario: recording.scenario.id, historyRetry: recording.scenario.historyRetry, steps })
}
