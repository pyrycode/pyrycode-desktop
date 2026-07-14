import { describe, it, expect, vi } from 'vitest'
import {
  fireNotification,
  type OsNotification,
  type OsNotificationConstructor
} from './fireNotification'
import type { NotifyKind } from '../shared/ipc/commands'

// A structural stand-in for Electron's Notification class: a vi.fn()-backed constructor that
// captures its options and hands back an object with a spied `show`. No Electron harness — the
// helper is typed against the minimal OsNotification surface, not the real class.
function fakeNotification(): {
  Notification: OsNotificationConstructor & ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
} {
  const show = vi.fn()
  const Notification = vi.fn(function (this: OsNotification) {
    this.show = show
  }) as unknown as OsNotificationConstructor & ReturnType<typeof vi.fn>
  return { Notification, show }
}

describe('fireNotification (#391)', () => {
  it('fires a notification when the window is unfocused', () => {
    const { Notification, show } = fakeNotification()

    fireNotification('turn-complete', { isWindowFocused: () => false, Notification })

    // Constructed exactly once, with the copy for the kind, and shown exactly once.
    expect(Notification).toHaveBeenCalledTimes(1)
    expect(Notification).toHaveBeenCalledWith({ title: 'Pyrycode', body: 'Your turn is complete.' })
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('fires no notification when the window is focused', () => {
    const { Notification, show } = fakeNotification()

    fireNotification('turn-complete', { isWindowFocused: () => true, Notification })

    expect(Notification).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })

  it('maps each kind to its main-owned copy — the command supplies no text (#391)', () => {
    // Pins the copy table (AC5, AC7): `kind` is the function's sole content input, so proving each
    // kind → its exact { title, body } proves the text comes only from the closed enum, never a field.
    const expected: Record<NotifyKind, { title: string; body: string }> = {
      'turn-complete': { title: 'Pyrycode', body: 'Your turn is complete.' },
      prompt: { title: 'Pyrycode', body: 'Waiting for your response.' }
    }

    for (const kind of Object.keys(expected) as NotifyKind[]) {
      const { Notification } = fakeNotification()
      fireNotification(kind, { isWindowFocused: () => false, Notification })
      expect(Notification).toHaveBeenCalledTimes(1)
      expect(Notification).toHaveBeenCalledWith(expected[kind])
    }
  })
})
