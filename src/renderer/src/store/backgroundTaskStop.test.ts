import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionStore, createSessionStore, selectStatusFor } from './sessionStore'
import { backgroundTaskStopSupported } from '../screens/conversation/BackgroundTaskPanel'
import type { DaemonEvent } from '@shared/ipc/events'

const ack = { protocol_version: 'v2', server_id: 'untrusted-other-host', conn_id: 'conn', capabilities: ['stop_background_task'] }
describe('background task stop capability', () => {
  it('uses only the owning host status and capability, excluding Codex', () => {
    const session = createSessionStore()
    session.getState().dispatch({ type: 'connected', ack, serverId: 'host-b' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
    session.getState().dispatch({ type: 'connected', ack: { ...ack, capabilities: [] }, serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
    session.getState().dispatch({ type: 'connected', ack, serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(true)
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'codex')).toBe(false)
    session.getState().dispatch({ type: 'disconnected', serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
  })
})
