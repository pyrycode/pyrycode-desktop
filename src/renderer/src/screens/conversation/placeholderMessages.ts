// Static placeholder conversation for the visual shell. #12 replaces this import
// with store-fed streamed replies — keep this array the sole data source so that
// swap stays one line. The discriminated union on `type` follows the project's
// sealed-event convention and is forward-compatible with the richer message kinds
// (tool calls, code blocks, session delimiters) #12 adds.
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }

export const placeholderMessages: Message[] = [
  {
    id: 'm1',
    type: 'user',
    text: 'Can you help me think through the schema migration plan?'
  },
  {
    id: 'm2',
    type: 'daemon',
    text: 'Sure — let me read the existing schema first.'
  },
  {
    id: 'm3',
    type: 'daemon',
    text: 'Three things stand out: legacy field naming inconsistency, the cascade-delete on user_id, and the missing index on order_status.'
  },
  {
    id: 'm4',
    type: 'user',
    text: 'I think the migration script needs to handle the legacy schema first. Let me check the latest exports…'
  },
  {
    id: 'm5',
    type: 'daemon',
    text: 'Good thinking. The conversion logic can live close to the legacy type, so it is easy to delete once the migration ships.'
  },
  {
    id: 'm6',
    type: 'user',
    text: 'What about edge cases? Some legacy orders have null user_ids.'
  },
  {
    id: 'm7',
    type: 'daemon',
    text: 'Good catch — null user_ids come from the cascade-delete. We can drop them as orphaned data, reassign them to a system account, or keep them behind a nullable flag.'
  },
  {
    id: 'm8',
    type: 'user',
    text: 'Let us reassign them. Dropping data is hard to undo.'
  }
]
