import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type {
  ContextUsageCategory,
  ContextUsageMCPTool,
  ContextUsageMemoryFile,
  MessagePayload
} from '@shared/wire/types'
import {
  translateContextUsage,
  subscribeReportedContext,
  ReportedContextData
} from './reportedContextBridge'
import { createReportedContextStore, selectReportedContextFor } from './reportedContextStore'

// Framework-free data-path tests with injected spies (the announcedModelBridge / usageLimitBridge
// idiom): no React, no Electron. The real store is wired only for the nothing-held → held seam.
//
// There is NO ROUTING DECISION to pin here, and that absence is what this file asserts. #1320's bridge
// chose between two store mutations on an exact-equality comparison against a client-owned constant;
// this arm has no benign value, so every translated event takes the one path and the whole module is
// comparison-free. What is left to pin is that the translation is VERBATIM and that nothing else on the
// union reaches the store.

const CATEGORIES: readonly ContextUsageCategory[] = [{ name: 'Messages', tokens: 18_000 }]
const MCP_TOOLS: readonly ContextUsageMCPTool[] = [
  { name: 'query', server_name: 'qmd', tokens: 900 }
]
const MEMORY_FILES: readonly ContextUsageMemoryFile[] = [
  { path: '/Users/someone/CLAUDE.md', type: 'project', tokens: 1200 }
]

/** The owned arm, extracted from the union. `Omit<DaemonEvent, 'type'>` would NOT do: `Omit` over a
 *  union keeps only the keys every member shares, so every field this helper overrides would be
 *  rejected — and `npm run build` is the only gate that says so, since vitest strips types. */
type ContextUsageEvent = Extract<DaemonEvent, { type: 'contextUsage' }>

const contextUsage = (over: Partial<Omit<ContextUsageEvent, 'type'>> = {}): DaemonEvent => ({
  type: 'contextUsage',
  conversationId: 'conv-1',
  model: 'claude-opus-5',
  totalTokens: 22_950,
  maxTokens: 200_000,
  percentage: 11,
  categories: CATEGORIES,
  droppedCategories: 0,
  mcpTools: MCP_TOOLS,
  droppedMcpTools: 2,
  memoryFiles: MEMORY_FILES,
  droppedMemoryFiles: 0,
  ...over
})

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateContextUsage', () => {
  it('maps the owned arm to its eleven fields, verbatim', () => {
    expect(translateContextUsage(contextUsage())).toEqual({
      conversationId: 'conv-1',
      model: 'claude-opus-5',
      totalTokens: 22_950,
      maxTokens: 200_000,
      percentage: 11,
      categories: CATEGORIES,
      droppedCategories: 0,
      mcpTools: MCP_TOOLS,
      droppedMcpTools: 2,
      memoryFiles: MEMORY_FILES,
      droppedMemoryFiles: 0
    })
  })

  it('returns a FRESH literal carrying no `type`, so the arm can gain a field without reaching the store', () => {
    const event = contextUsage()
    const snapshot = translateContextUsage(event)

    expect(snapshot).not.toBe(event)
    expect(snapshot).not.toHaveProperty('type')
    // The three inventories are the event's OWN arrays — nothing sliced, sorted, filtered or deduped.
    expect(snapshot?.categories).toBe(CATEGORIES)
    expect(snapshot?.mcpTools).toBe(MCP_TOOLS)
    expect(snapshot?.memoryFiles).toBe(MEMORY_FILES)
  })

  it('carries an untrusted string through untouched — no trim, no normalise, no allow-list', () => {
    const hostileFiles: readonly ContextUsageMemoryFile[] = [
      { path: '../../../etc/passwd', type: 'javascript:alert(1)', tokens: 1 }
    ]

    const snapshot = translateContextUsage(
      contextUsage({ model: '  __proto__  ', memoryFiles: hostileFiles })
    )

    expect(snapshot?.model).toBe('  __proto__  ')
    expect(snapshot?.memoryFiles).toBe(hostileFiles)
  })

  it('returns null for every other arm, including the adjacent reading', () => {
    // `null` means "not our arm", NEVER "bad data": a malformed payload is rejected upstream inside
    // daemonConnection's decode guard and no event is emitted at all.
    expect(
      translateContextUsage({
        type: 'rateLimited',
        conversationId: 'conv-1',
        status: 'allowed_warning',
        limitType: 'seven_day',
        resetsAt: 1_800_000_000
      })
    ).toBeNull()
    expect(translateContextUsage({ type: 'messageReceived', message })).toBeNull()
  })
})

describe('subscribeReportedContext', () => {
  /** A fake onDaemonEvent that captures the listener and hands back an off spy — the
   *  usageLimitBridge.test.ts helper verbatim. The `emit` closure is what keeps the captured listener
   *  callable: a bare `let listener` narrows to `never` after the assignment TypeScript cannot see. */
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return { onDaemonEvent, emit: (e) => listener?.(e), off }
  }

  it('lands one write per owned event and ignores every other arm', () => {
    const bridge = fakeBridge()
    const setReportedContext = vi.fn()

    subscribeReportedContext(bridge.onDaemonEvent, setReportedContext)
    bridge.emit({
      type: 'rateLimited',
      conversationId: 'conv-1',
      status: 'allowed_warning',
      limitType: 'seven_day',
      resetsAt: 1_800_000_000
    })
    bridge.emit(contextUsage())
    bridge.emit({ type: 'messageReceived', message })

    expect(setReportedContext).toHaveBeenCalledTimes(1)
    expect(setReportedContext).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', percentage: 11 })
    )
  })

  it('writes a verbatim repeat and a fall as two further writes, never coalescing them', () => {
    const bridge = fakeBridge()
    const setReportedContext = vi.fn()

    subscribeReportedContext(bridge.onDaemonEvent, setReportedContext)
    bridge.emit(contextUsage())
    bridge.emit(contextUsage())
    bridge.emit(contextUsage({ percentage: 2 }))

    // The daemon fans this out after every turn end; a repeat is the report that the reading is
    // current and a fall is what a `/clear` or a compaction looks like. Suppressing either would eat
    // ordinary traffic.
    expect(setReportedContext).toHaveBeenCalledTimes(3)
  })

  it('returns the off handle so the React binding can use it as effect cleanup', () => {
    const bridge = fakeBridge()

    expect(subscribeReportedContext(bridge.onDaemonEvent, vi.fn())).toBe(bridge.off)
  })

  it('writes an unrecognised conversation id under its own key rather than redirecting it', () => {
    const bridge = fakeBridge()
    const store = createReportedContextStore()
    subscribeReportedContext(bridge.onDaemonEvent, (snapshot) =>
      store.getState().setReportedContext(snapshot)
    )

    bridge.emit(contextUsage({ conversationId: 'conv-open', percentage: 40 }))
    bridge.emit(contextUsage({ conversationId: 'nothing-selects-this', percentage: 99 }))

    // There is no guard on the id and no `?? activeConversation` fallback anywhere on this path: a
    // stray reading is held under its own key and read by NOTHING, which is a stronger no-match than a
    // filter here could be.
    expect(selectReportedContextFor('conv-open')(store.getState())?.percentage).toBe(40)
    expect(selectReportedContextFor('nothing-selects-this')(store.getState())?.percentage).toBe(99)
  })

  it('takes a reading from nothing-held to held through the real store (the seam)', () => {
    const bridge = fakeBridge()
    const store = createReportedContextStore()

    expect(selectReportedContextFor('conv-1')(store.getState())).toBeNull()

    subscribeReportedContext(bridge.onDaemonEvent, (snapshot) =>
      store.getState().setReportedContext(snapshot)
    )
    bridge.emit(contextUsage())

    expect(selectReportedContextFor('conv-1')(store.getState())).toMatchObject({
      model: 'claude-opus-5',
      droppedMcpTools: 2
    })
  })

  it.each(['conversation.not_found', 'context_usage.unavailable'])(
    'does not clear or fabricate readings when an unrelated failure carries %s', (code) => {
      const bridge = fakeBridge()
      const store = createReportedContextStore()
      const off = subscribeReportedContext(bridge.onDaemonEvent, store.getState().setReportedContext)
      bridge.emit(contextUsage({ conversationId: 'held-conversation' }))
      const held = store.getState()
      bridge.emit({ type: 'failed', error: { code, message: 'generic failure', retryable: true } })
      expect(store.getState()).toBe(held)
      expect(selectReportedContextFor('held-conversation')(store.getState())?.percentage).toBe(11)
      expect(selectReportedContextFor('no-reading')(store.getState())).toBeNull()
      off()
    }
  )
})

describe('ReportedContextData', () => {
  it('server-renders to nothing without a window.pyry bridge', () => {
    // `window.pyry` is dereferenced only inside the effect, never during render (the QueueData
    // invariant), so the leaf renders with no bridge mock at all.
    expect(renderToStaticMarkup(createElement(ReportedContextData))).toBe('')
  })
})
