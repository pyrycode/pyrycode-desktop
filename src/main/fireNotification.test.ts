import { describe, it, expect, vi } from 'vitest'
import {
  fireNotification,
  activateWindow,
  type OsNotification,
  type OsNotificationConstructor,
  type ActivatableWindow
} from './fireNotification'
import type { NotifyKind } from '../shared/ipc/commands'

// A structural stand-in for Electron's Notification class: a vi.fn()-backed constructor that
// captures its options and hands back an object with a spied `show` and a spied `on` that captures
// the click listener (#393). No Electron harness — the helper is typed against the minimal
// OsNotification surface, not the real class. `click()` simulates the OS delivering a click to the
// fired notification by invoking the captured listener.
function fakeNotification(): {
  Notification: OsNotificationConstructor & ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  click: () => void
} {
  const show = vi.fn()
  let clickListener: (() => void) | undefined
  const on = vi.fn((_event: 'click', listener: () => void) => {
    clickListener = listener
  })
  const Notification = vi.fn(function (this: OsNotification) {
    this.show = show
    this.on = on
  }) as unknown as OsNotificationConstructor & ReturnType<typeof vi.fn>
  return { Notification, show, on, click: () => clickListener?.() }
}

// A structural stand-in for Electron's BrowserWindow, minimal to the ActivatableWindow surface
// (#393): spied restore/show/focus plus a fixed isMinimized. No Electron harness.
function fakeWindow(isMinimized: boolean): {
  win: ActivatableWindow
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
} {
  const restore = vi.fn()
  const show = vi.fn()
  const focus = vi.fn()
  return { win: { isMinimized: () => isMinimized, restore, show, focus }, restore, show, focus }
}

describe('fireNotification (#391)', () => {
  it('fires a notification when the window is unfocused', () => {
    const { Notification, show } = fakeNotification()

    fireNotification('turn-complete', {
      isWindowFocused: () => false,
      Notification,
      onClick: vi.fn()
    })

    // Constructed exactly once, with the copy for the kind, and shown exactly once.
    expect(Notification).toHaveBeenCalledTimes(1)
    expect(Notification).toHaveBeenCalledWith({ title: 'Pyrycode', body: 'Your turn is complete.' })
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('fires no notification when the window is focused', () => {
    const { Notification, show } = fakeNotification()

    fireNotification('turn-complete', {
      isWindowFocused: () => true,
      Notification,
      onClick: vi.fn()
    })

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
      fireNotification(kind, { isWindowFocused: () => false, Notification, onClick: vi.fn() })
      expect(Notification).toHaveBeenCalledTimes(1)
      expect(Notification).toHaveBeenCalledWith(expected[kind])
    }
  })

  // #393: the fired notification is actionable — a click invokes the injected onClick.
  it('registers a click listener that invokes onClick when the fired notification is clicked', () => {
    const { Notification, on, click } = fakeNotification()
    const onClick = vi.fn()

    fireNotification('turn-complete', { isWindowFocused: () => false, Notification, onClick })

    // A click listener is registered on the constructed notification...
    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith('click', expect.any(Function))
    // ...and invoking it (the OS delivering a click) invokes onClick exactly once, not before.
    expect(onClick).not.toHaveBeenCalled()
    click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('registers the click listener before showing the notification', () => {
    // A click could arrive the instant the notification is shown; registering first avoids a race.
    const { Notification, show, on } = fakeNotification()

    fireNotification('turn-complete', { isWindowFocused: () => false, Notification, onClick: vi.fn() })

    expect(on.mock.invocationCallOrder[0]).toBeLessThan(show.mock.invocationCallOrder[0])
  })

  it('registers no click listener and never invokes onClick when the window is focused', () => {
    const { Notification, on, click } = fakeNotification()
    const onClick = vi.fn()

    fireNotification('turn-complete', { isWindowFocused: () => true, Notification, onClick })

    expect(Notification).not.toHaveBeenCalled()
    expect(on).not.toHaveBeenCalled()
    click() // no listener was captured — a no-op
    expect(onClick).not.toHaveBeenCalled()
  })

  // #393 AC4 clause 1, end-to-end with no Electron: composing the wiring-site onClick as
  // `() => activateWindow(win)`, a simulated click shows and focuses the window.
  it('a simulated click activates the window when onClick composes activateWindow (AC4)', () => {
    const { Notification, click } = fakeNotification()
    const { win, show, focus } = fakeWindow(false)

    fireNotification('turn-complete', {
      isWindowFocused: () => false,
      Notification,
      onClick: () => activateWindow(win)
    })
    expect(show).not.toHaveBeenCalled()

    click()
    expect(show).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })
})

describe('activateWindow (#393)', () => {
  it('un-minimizes, shows, and focuses a minimized window (AC1)', () => {
    const { win, restore, show, focus } = fakeWindow(true)

    activateWindow(win)

    expect(restore).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('shows and focuses without restoring when the window is not minimized (AC1)', () => {
    const { win, restore, show, focus } = fakeWindow(false)

    activateWindow(win)

    expect(restore).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
