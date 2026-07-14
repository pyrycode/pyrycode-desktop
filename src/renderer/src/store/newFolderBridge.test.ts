import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  translateNewFolderEvent,
  subscribeNewFolder,
  NewFolderData
} from './newFolderBridge'
import { createNewFolderStore, selectNewFolderRoundTrip } from './newFolderStore'

// Framework-free data-path tests with injected spies (the recentWorkspacesBridge.test idiom): no
// React, no Electron. The real store is wired only for the in-flight-gate end-to-end seam tests.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateNewFolderEvent', () => {
  it('maps a workspaceFolderCreated to a folderCreated, passing path through (the owned arm)', () => {
    const event: DaemonEvent = { type: 'workspaceFolderCreated', path: '/home/pyry/new' }
    expect(translateNewFolderEvent(event)).toEqual({ type: 'folderCreated', path: '/home/pyry/new' })
  })

  it('maps a workspaceFolderRejected to a bare folderRejected (the owned arm)', () => {
    const event: DaemonEvent = { type: 'workspaceFolderRejected' }
    expect(translateNewFolderEvent(event)).toEqual({ type: 'folderRejected' })
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'recentWorkspacesReceived', recentWorkspaces: [] }
    ]
    for (const event of others) expect(translateNewFolderEvent(event)).toBeNull()
  })
})

describe('subscribeNewFolder', () => {
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
    subscribeNewFolder(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('dispatches folderCreated on a workspaceFolderCreated event', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeNewFolder(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'workspaceFolderCreated', path: '/home/pyry/new' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'folderCreated', path: '/home/pyry/new' })
  })

  it('dispatches folderRejected on a workspaceFolderRejected event', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeNewFolder(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'workspaceFolderRejected' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'folderRejected' })
  })

  it('does not dispatch for an unrelated event', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeNewFolder(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('forwards unconditionally — the bridge does not apply the in-flight gate (the store does)', () => {
    // With a spy dispatch there is no store to gate against; the bridge still forwards the translated
    // event. The gate lives in the reducer (see the integration seam below), not here.
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeNewFolder(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'workspaceFolderCreated', path: '/x' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'folderCreated', path: '/x' })
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeNewFolder(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives a real in-flight store to created on a workspaceFolderCreated (the gate honored end-to-end)', () => {
    const bridge = fakeBridge()
    const store = createNewFolderStore()
    subscribeNewFolder(bridge.onDaemonEvent, (event) => store.getState().dispatch(event))

    store.getState().dispatch({ type: 'createRequested' })
    bridge.emit({ type: 'workspaceFolderCreated', path: '/home/pyry/new' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({
      status: 'created',
      path: '/home/pyry/new'
    })
  })

  it('leaves an idle store idle on a stray workspaceFolderRejected (the gate honored end-to-end)', () => {
    const bridge = fakeBridge()
    const store = createNewFolderStore()
    subscribeNewFolder(bridge.onDaemonEvent, (event) => store.getState().dispatch(event))

    // No createRequested dispatched — the store is idle when the (unsolicited) rejection arrives.
    bridge.emit({ type: 'workspaceFolderRejected' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'idle' })
  })
})

describe('NewFolderData (container)', () => {
  // Server-render sanity — the RecentWorkspacesData.test idiom. The binding is headless (renders null)
  // and dereferences window.pyry only inside its effect, so a server render (effects never run)
  // produces empty markup without a bridge mock.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(NewFolderData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
