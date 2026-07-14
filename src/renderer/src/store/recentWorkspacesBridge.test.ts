import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload, RecentWorkspace } from '@shared/wire/types'
import {
  translateRecentWorkspacesEvent,
  requestRecentWorkspaces,
  subscribeRecentWorkspaces,
  RecentWorkspacesData
} from './recentWorkspacesBridge'
import { createRecentWorkspacesStore, selectRecentWorkspaces } from './recentWorkspacesStore'

// Framework-free data-path tests with injected spies (the conversationListBridge.test idiom): no
// React, no Electron. The real store is wired only for the not-loaded → loaded seam test.

const row = (over: Partial<RecentWorkspace> = {}): RecentWorkspace => ({
  path: '/home/pyry/project',
  last_used_at: '2026-07-10T12:05:00Z',
  ...over
})

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateRecentWorkspacesEvent', () => {
  it('maps a recentWorkspacesReceived to its recentWorkspaces array (the owned arm)', () => {
    const list = [row({ path: '/a' }), row({ path: '/b' })]
    const event: DaemonEvent = { type: 'recentWorkspacesReceived', recentWorkspaces: list }
    expect(translateRecentWorkspacesEvent(event)).toBe(list)
  })

  it('maps an empty recentWorkspacesReceived to [] — not null (loaded-zero)', () => {
    const event: DaemonEvent = { type: 'recentWorkspacesReceived', recentWorkspaces: [] }
    expect(translateRecentWorkspacesEvent(event)).toEqual([])
    expect(translateRecentWorkspacesEvent(event)).not.toBeNull()
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateRecentWorkspacesEvent(event)).toBeNull()
  })
})

describe('requestRecentWorkspaces', () => {
  it('fires exactly one requestRecentWorkspaces command (the bare #380 member)', () => {
    const sendCommand = vi.fn()
    requestRecentWorkspaces(sendCommand)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'requestRecentWorkspaces' })
  })
})

describe('subscribeRecentWorkspaces', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeRecentWorkspaces(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated list on a recentWorkspacesReceived event (AC3)', () => {
    const bridge = fakeBridge()
    const setRecentWorkspaces = vi.fn()
    subscribeRecentWorkspaces(bridge.onDaemonEvent, setRecentWorkspaces)

    const list = [row({ path: '/a' })]
    bridge.emit({ type: 'recentWorkspacesReceived', recentWorkspaces: list })
    expect(setRecentWorkspaces).toHaveBeenCalledTimes(1)
    expect(setRecentWorkspaces).toHaveBeenCalledWith(list)
  })

  it('does not call setRecentWorkspaces for an unrelated event', () => {
    const bridge = fakeBridge()
    const setRecentWorkspaces = vi.fn()
    subscribeRecentWorkspaces(bridge.onDaemonEvent, setRecentWorkspaces)

    bridge.emit({ type: 'connecting' })
    expect(setRecentWorkspaces).not.toHaveBeenCalled()
  })

  it('writes an empty list (loaded-zero) — the !== null guard, not truthiness', () => {
    const bridge = fakeBridge()
    const setRecentWorkspaces = vi.fn()
    subscribeRecentWorkspaces(bridge.onDaemonEvent, setRecentWorkspaces)

    bridge.emit({ type: 'recentWorkspacesReceived', recentWorkspaces: [] })
    expect(setRecentWorkspaces).toHaveBeenCalledTimes(1)
    expect(setRecentWorkspaces).toHaveBeenCalledWith([])
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRecentWorkspaces(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-loaded (null) to loaded on a recentWorkspacesReceived (AC6)', () => {
    const bridge = fakeBridge()
    const store = createRecentWorkspacesStore()
    subscribeRecentWorkspaces(bridge.onDaemonEvent, (list) =>
      store.getState().setRecentWorkspaces(list)
    )

    expect(selectRecentWorkspaces(store.getState())).toBeNull()
    const list = [row({ path: '/a' }), row({ path: '/b' })]
    bridge.emit({ type: 'recentWorkspacesReceived', recentWorkspaces: list })
    expect(selectRecentWorkspaces(store.getState())).toEqual(list)
  })
})

describe('RecentWorkspacesData (container)', () => {
  // Server-render sanity — the ServerInfoData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effects, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (subscribe-before-request / one-shot ref guard /
  // StrictMode dedup) is verified by inspection against the ConversationListData ref-guard idiom, not
  // unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(RecentWorkspacesData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
