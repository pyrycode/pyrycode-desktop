import { describe, it, expect } from 'vitest'
import { initialTimelineState, type ThreadItem } from './threadTimeline'
import type { ConversationSlice, ConversationTimelineState } from './conversationTimelineStore'
import { NOTIFICATION_PREVIEW_CHARS, notificationPreviewIn, type NotifyEvent } from './notificationPreview'

// Pure lookups over a hand-built timeline state: no store singleton, no React. Each slice is filed under
// `conv` and stamped with server `srv` unless a test says otherwise.

function stateWith(items: ThreadItem[], serverId: string | undefined = 'srv'): ConversationTimelineState {
  const slice: ConversationSlice = {
    ...(serverId === undefined ? {} : { serverId }),
    timeline: { ...initialTimelineState, items },
    history: null,
    prependedRows: 0,
    liveKeys: new Set()
  }
  return { timelines: new Map([['conv', slice]]) }
}

function turnEnd(turnId: string, serverId: string | null = 'srv'): NotifyEvent {
  return { type: 'turnEnd', turnId, stopReason: 'end_turn', conversationId: 'conv', serverId }
}

function modal(cls: 'permission' | 'trust', prompt: string): NotifyEvent {
  return {
    type: 'modalShown',
    conversationId: 'conv',
    modalId: 'm1',
    class: cls,
    title: 'Permission',
    prompt,
    options: [],
    defaultOptionId: 'allow',
    serverId: 'srv'
  }
}

function text(turnId: string, body: string): ThreadItem {
  return { kind: 'assistantText', turnId, text: body }
}

function toolCall(name: string, input: Record<string, string>, done = false): ThreadItem {
  return {
    kind: 'toolCall',
    turnId: 't1',
    toolUseId: `${name}-${Object.values(input).join()}`,
    name,
    inputSummary: JSON.stringify(input),
    input,
    result: done ? { isError: false, resultSummary: 'ok' } : null
  }
}

describe('notificationPreviewIn — turn end (#1737)', () => {
  it('previews the newest assistant text of the ending turn', () => {
    const state = stateWith([text('t1', 'First part.'), text('t1', 'Second part.')])
    expect(notificationPreviewIn(state, turnEnd('t1'))).toBe('Second part.')
  })

  it('strips markdown, keeping link text and code content', () => {
    const reply = [
      '## Done',
      '',
      'I **fixed** the _flaky_ test, see [the PR](https://example.com/pr/1).',
      '',
      '- run `npm test`',
      '',
      '```ts',
      'const x = 1',
      '```'
    ].join('\n')
    expect(notificationPreviewIn(stateWith([text('t1', reply)]), turnEnd('t1'))).toBe(
      'Done I fixed the flaky test, see the PR. run npm test const x = 1'
    )
  })

  it('never uses text from an earlier turn', () => {
    const state = stateWith([text('t0', 'Old reply.'), toolCall('Bash', { command: 'ls' }, true)])
    expect(notificationPreviewIn(state, turnEnd('t1'))).toBeNull()
  })

  it('cuts a long reply to the preview length, ending in an ellipsis', () => {
    const preview = notificationPreviewIn(stateWith([text('t1', 'word '.repeat(200))]), turnEnd('t1'))
    expect(preview).not.toBeNull()
    expect([...(preview ?? '')]).toHaveLength(NOTIFICATION_PREVIEW_CHARS)
    expect(preview?.endsWith('…')).toBe(true)
  })

  it('gives nothing for a conversation with no slice, as after eviction', () => {
    expect(notificationPreviewIn({ timelines: new Map() }, turnEnd('t1'))).toBeNull()
  })

  it('never lets a slice stamped with another server supply the preview', () => {
    const state = stateWith([text('t1', 'Other host reply.')], 'other-srv')
    expect(notificationPreviewIn(state, turnEnd('t1'))).toBeNull()
  })

  it('reads an unstamped slice', () => {
    const state = stateWith([text('t1', 'Reply.')], undefined)
    expect(notificationPreviewIn(state, turnEnd('t1'))).toBe('Reply.')
  })

  it('gives nothing when the reply is empty once stripped', () => {
    expect(notificationPreviewIn(stateWith([text('t1', '  \n---\n')]), turnEnd('t1'))).toBeNull()
  })
})

describe('notificationPreviewIn — prompts (#1737)', () => {
  it('names the tool and the newest result-less matching row’s headline for a permission prompt', () => {
    const state = stateWith([
      toolCall('Bash', { command: 'npm run lint' }),
      toolCall('Read', { file_path: 'a.ts' }),
      toolCall('Bash', { command: 'npm test' })
    ])
    expect(notificationPreviewIn(state, modal('permission', 'Bash'))).toBe('Wants to run Bash: npm test')
  })

  it('skips a matching row that already has its result', () => {
    const state = stateWith([toolCall('Bash', { command: 'ls' }), toolCall('Bash', { command: 'pwd' }, true)])
    expect(notificationPreviewIn(state, modal('permission', 'Bash'))).toBe('Wants to run Bash: ls')
  })

  it('gives nothing when no result-less row has that tool name', () => {
    const state = stateWith([toolCall('Read', { file_path: 'a.ts' }), toolCall('Bash', { command: 'ls' }, true)])
    expect(notificationPreviewIn(state, modal('permission', 'Bash'))).toBeNull()
  })

  it('gives nothing for a trust modal or a question batch', () => {
    const state = stateWith([toolCall('Bash', { command: 'npm test' })])
    expect(notificationPreviewIn(state, modal('trust', 'Bash'))).toBeNull()
    const question: NotifyEvent = {
      type: 'questionShown',
      conversationId: 'conv',
      questionBatchId: 'b1',
      questions: [],
      serverId: 'srv'
    }
    expect(notificationPreviewIn(state, question)).toBeNull()
  })
})
