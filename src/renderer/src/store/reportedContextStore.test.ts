import { describe, it, expect } from 'vitest'
import type {
  ContextUsageCategory,
  ContextUsageMCPTool,
  ContextUsageMemoryFile
} from '@shared/wire/types'
import {
  createReportedContextStore,
  initialReportedContextState,
  selectReportedContextFor,
  type ReportedContextSnapshot
} from './reportedContextStore'

// Store-only tests against isolated instances (the usageLimitStore.test.ts idiom): no React, no
// bridge, no Electron. What this file pins is that the ten held fields cross VERBATIM and that the
// two map states — absent key vs. present-but-empty reading — stay apart, because both are contracts
// #1421's settings-derived fallback branches on.
//
// THE HOSTILE-KEY READS BEFORE ANY WRITE are the half that matters: they are what fails if
// `readings` is ever swapped from `ReadonlyMap` to `Record<string, …>`, because a `Record` hands the
// reader `Object.prototype` where `?? null` should have fired. Every assertion below that looks
// paranoid about `__proto__` is guarding that one swap.

/** Realistic-shaped rows. `tokens` figures are arbitrary and NOTHING here asserts they sum to
 *  `totalTokens` — `percentage` is not derivable from the totals and the categories need not
 *  reconcile, so an invariant asserted between any two fields would invent a contract the wire does
 *  not offer. */
const CATEGORIES: readonly ContextUsageCategory[] = [
  { name: 'System prompt', tokens: 2400 },
  { name: 'Messages', tokens: 18_000 }
]

const MCP_TOOLS: readonly ContextUsageMCPTool[] = [
  { name: 'query', server_name: 'qmd', tokens: 900 },
  { name: 'get_screenshot', server_name: 'figma', tokens: 450 }
]

const MEMORY_FILES: readonly ContextUsageMemoryFile[] = [
  { path: '/Users/someone/Workspace/CLAUDE.md', type: 'project', tokens: 1200 }
]

/** The write unit, overridable per case. Ten fields plus the routing key — the whole arm minus its
 *  `type` tag. */
const snapshot = (over: Partial<ReportedContextSnapshot> = {}): ReportedContextSnapshot => ({
  conversationId: 'conv-1',
  model: 'claude-opus-5',
  totalTokens: 22_950,
  maxTokens: 200_000,
  percentage: 11,
  categories: CATEGORIES,
  droppedCategories: 0,
  mcpTools: MCP_TOOLS,
  droppedMcpTools: 0,
  memoryFiles: MEMORY_FILES,
  droppedMemoryFiles: 0,
  ...over
})

const readingFor = (
  store: ReturnType<typeof createReportedContextStore>,
  conversationId: string
) => selectReportedContextFor(conversationId)(store.getState())

describe('createReportedContextStore', () => {
  it('holds all ten fields verbatim under the conversation the snapshot names (AC1)', () => {
    const store = createReportedContextStore()

    store.getState().setReportedContext(snapshot())

    // The routing key STOPS at the map key: it is not copied into the held record, so the object a
    // render surface holds carries no daemon-asserted id at all.
    expect(readingFor(store, 'conv-1')).toEqual({
      model: 'claude-opus-5',
      totalTokens: 22_950,
      maxTokens: 200_000,
      percentage: 11,
      categories: CATEGORIES,
      droppedCategories: 0,
      mcpTools: MCP_TOOLS,
      droppedMcpTools: 0,
      memoryFiles: MEMORY_FILES,
      droppedMemoryFiles: 0
    })
    expect(readingFor(store, 'conv-1')).not.toHaveProperty('conversationId')
  })

  it('carries the three inventories by reference, in arrival order, neither copied nor re-sorted (AC1)', () => {
    const store = createReportedContextStore()

    store.getState().setReportedContext(snapshot())

    // Identity, not deep equality: nothing on the write path slices, sorts, dedups or filters a row
    // array, so the held arrays ARE the ones the decoder produced. A defensive copy would pass a
    // `toEqual` and fail this.
    const held = readingFor(store, 'conv-1')
    expect(held?.categories).toBe(CATEGORIES)
    expect(held?.mcpTools).toBe(MCP_TOOLS)
    expect(held?.memoryFiles).toBe(MEMORY_FILES)
    // The producer's descending-token order is the only ordering signal a consumer gets.
    expect(held?.categories.map((c) => c.name)).toEqual(['System prompt', 'Messages'])
  })

  it('holds a hostile row string as an ordinary value rather than acting on it (AC4)', () => {
    const store = createReportedContextStore()
    const hostileCategories: readonly ContextUsageCategory[] = [{ name: '__proto__', tokens: 1 }]
    const hostileTools: readonly ContextUsageMCPTool[] = [
      { name: 'constructor', server_name: '__proto__', tokens: 2 }
    ]
    const hostileFiles: readonly ContextUsageMemoryFile[] = [
      // Path-shaped descriptive text, never a path: a traversal, a scheme and an embedded newline are
      // three ordinary strings here, because nothing joins, resolves, opens or LOGS one.
      { path: '../../../etc/passwd', type: 'javascript:alert(1)', tokens: 3 },
      { path: 'a\nb', type: '', tokens: 4 }
    ]

    store.getState().setReportedContext(
      snapshot({
        model: '__proto__',
        categories: hostileCategories,
        mcpTools: hostileTools,
        memoryFiles: hostileFiles
      })
    )

    const held = readingFor(store, 'conv-1')
    expect(held?.model).toBe('__proto__')
    expect(held?.categories).toBe(hostileCategories)
    expect(held?.mcpTools).toBe(hostileTools)
    expect(held?.memoryFiles).toBe(hostileFiles)
    // Nothing was keyed by any of them, so no object anywhere gained a prototype-polluted member.
    expect(({} as Record<string, unknown>).tokens).toBeUndefined()
  })

  it('replaces a conversation wholesale on the next frame — a repeat, a fall and a shorter inventory all land (AC1)', () => {
    const store = createReportedContextStore()

    store.getState().setReportedContext(snapshot())
    // A VERBATIM REPEAT is not noise: the daemon re-reports after every turn end, so a repeat is the
    // signal that the reading is current. It is recorded like any other frame.
    store.getState().setReportedContext(snapshot())
    expect(readingFor(store, 'conv-1')?.percentage).toBe(11)

    // A FALL is ordinary traffic — a window shrinks at a `/clear` or a compaction — and is never
    // filtered as "stale". The replacement is WHOLESALE: the previous frame's inventories do not
    // survive alongside the new one's.
    store.getState().setReportedContext(
      snapshot({ percentage: 3, totalTokens: 600, categories: [], droppedCategories: 0 })
    )

    expect(readingFor(store, 'conv-1')).toMatchObject({
      percentage: 3,
      totalTokens: 600,
      categories: []
    })
  })

  it('leaves every other conversation Object.is-identical on a write (narrow-slice correctness)', () => {
    const store = createReportedContextStore()
    store.getState().setReportedContext(snapshot({ conversationId: 'conv-1' }))
    const before = readingFor(store, 'conv-1')

    store.getState().setReportedContext(snapshot({ conversationId: 'conv-2', percentage: 90 }))

    // A write produces a fresh map, but the untouched record object is the SAME object, so a
    // component watching conv-1 sees `Object.is` true and does not re-render.
    expect(readingFor(store, 'conv-1')).toBe(before)
    expect(readingFor(store, 'conv-2')?.percentage).toBe(90)
  })

  it('keeps absence distinct from a present reading whose inventories are empty (AC2)', () => {
    const store = createReportedContextStore()

    // No frame has arrived for this conversation.
    expect(readingFor(store, 'never-seen')).toBeNull()

    store.getState().setReportedContext(
      snapshot({
        conversationId: 'empty',
        categories: [],
        mcpTools: [],
        memoryFiles: [],
        droppedCategories: 0,
        droppedMcpTools: 0,
        droppedMemoryFiles: 0
      })
    )

    // A real, if degenerate, reading the daemon emitted — held as-is, NOT collapsed to absence. The
    // nullable return is what forces #1421 to branch rather than conflating the two.
    const held = readingFor(store, 'empty')
    expect(held).not.toBeNull()
    expect(held?.categories).toEqual([])
    expect(held?.droppedCategories).toBe(0)
  })

  it('reads a hostile conversation id as absent BEFORE any write (the ReadonlyMap contract)', () => {
    const store = createReportedContextStore()

    // On a `Record<string, …>` these three would hand back `Object.prototype`, a function and
    // `undefined` respectively rather than firing `?? null`. `Map.get` performs no prototype-chain
    // lookup, so all three are simply absent keys.
    expect(readingFor(store, '__proto__')).toBeNull()
    expect(readingFor(store, 'constructor')).toBeNull()
    expect(readingFor(store, '')).toBeNull()
  })

  it('treats a hostile conversation id as an ordinary key after a write (the ReadonlyMap contract)', () => {
    const store = createReportedContextStore()

    store.getState().setReportedContext(snapshot({ conversationId: '__proto__', percentage: 7 }))

    expect(readingFor(store, '__proto__')?.percentage).toBe(7)
    // The write created one ordinary own entry and reached nothing else.
    expect(readingFor(store, 'constructor')).toBeNull()
    expect(readingFor(store, 'conv-1')).toBeNull()
  })

  it('records a reading whose every string is empty exactly like any other (no content branch)', () => {
    const store = createReportedContextStore()

    // The setter NEVER branches on arriving content — there is no benign value on this arm and no
    // comparison anywhere on the path — so an all-empty reading is written, not dropped.
    store.getState().setReportedContext(snapshot({ model: '', percentage: 0, totalTokens: 0 }))

    expect(readingFor(store, 'conv-1')).toMatchObject({ model: '', percentage: 0, totalTokens: 0 })
  })

  it('holds the six integers verbatim, including values a client might be tempted to reject', () => {
    const store = createReportedContextStore()

    // None of the six is range-checked in either direction, upstream or here: a `percentage` over
    // 100, a total exceeding the max and a negative are all representable and none is rejected. They
    // are FIGURES, never sizes — nothing here allocates, iterates or sizes anything from one.
    store.getState().setReportedContext(
      snapshot({
        totalTokens: 999_999_999,
        maxTokens: 1,
        percentage: -5,
        droppedCategories: 2_147_483_647,
        droppedMcpTools: -1,
        droppedMemoryFiles: 12
      })
    )

    expect(readingFor(store, 'conv-1')).toMatchObject({
      totalTokens: 999_999_999,
      maxTokens: 1,
      percentage: -5,
      droppedCategories: 2_147_483_647,
      droppedMcpTools: -1,
      droppedMemoryFiles: 12
    })
  })
})

describe('clearAllReportedContext', () => {
  it('drops every conversation at once (AC3)', () => {
    const store = createReportedContextStore()
    store.getState().setReportedContext(snapshot({ conversationId: 'conv-1' }))
    store.getState().setReportedContext(snapshot({ conversationId: 'conv-2' }))

    store.getState().clearAllReportedContext()

    expect(readingFor(store, 'conv-1')).toBeNull()
    expect(readingFor(store, 'conv-2')).toBeNull()
    expect(store.getState().readings.size).toBe(0)
  })

  it('returns initialReportedContextState BY REFERENCE, which is what makes copy-on-write load-bearing', () => {
    const store = createReportedContextStore()
    store.getState().setReportedContext(snapshot())

    store.getState().clearAllReportedContext()

    // The module-shared constant. A writer that ever mutated `s.readings` in place would poison it,
    // and every instance that had cleared would then hand one pairing's readings to the next with no
    // type error.
    expect(store.getState().readings).toBe(initialReportedContextState.readings)
    expect(initialReportedContextState.readings.size).toBe(0)
  })

  it('is a no-op reference on an already-clear store, so no subscriber wakes', () => {
    const store = createReportedContextStore()
    const before = store.getState()

    store.getState().clearAllReportedContext()

    // The `size === 0` guard hands the state OBJECT back, so zustand's `Object.is(next, state)`
    // short-circuit fires and no listener is notified at all.
    expect(store.getState()).toBe(before)
  })

  it('takes no argument at all, so no daemon-supplied id can steer what survives (AC3)', () => {
    const store = createReportedContextStore()

    expect(store.getState().clearAllReportedContext).toHaveLength(0)
  })
})
