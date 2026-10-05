import { describe, it, expect, vi } from 'vitest'
import {
  fireNotification,
  notificationBody,
  notificationTitle,
  activateWindow,
  windowHasFocus,
  type OsNotification,
  type OsNotificationConstructor,
  type ActivatableWindow,
  type FocusableWindow
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
// (#393): spied restore/show/focus plus a fixed isMinimized. `destroyed` (#518) defaults false;
// `isMinimized` is spied too, so a destroyed-window test can prove the guard precedes every touch.
// No Electron harness.
function fakeWindow(
  isMinimized: boolean,
  destroyed = false
): {
  win: ActivatableWindow
  isMinimized: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
} {
  const minimized = vi.fn(() => isMinimized)
  const restore = vi.fn()
  const show = vi.fn()
  const focus = vi.fn()
  return {
    win: { isDestroyed: () => destroyed, isMinimized: minimized, restore, show, focus },
    isMinimized: minimized,
    restore,
    show,
    focus
  }
}

// A structural stand-in for the focus half of the same real BrowserWindow (#518): a spied
// isFocused, so a destroyed-window test can assert the guard short-circuits above the touch.
function fakeFocusableWindow(
  focused: boolean,
  destroyed = false
): { win: FocusableWindow; isFocused: ReturnType<typeof vi.fn> } {
  const isFocused = vi.fn(() => focused)
  return { win: { isDestroyed: () => destroyed, isFocused }, isFocused }
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

  it('titles the notification with the given name and keeps the kind’s body (#1593)', () => {
    const { Notification } = fakeNotification()

    fireNotification(
      'prompt',
      { isWindowFocused: () => false, Notification, onClick: vi.fn() },
      'deploy-bot'
    )

    expect(Notification).toHaveBeenCalledWith({ title: 'deploy-bot', body: 'Waiting for your response.' })
  })

  it('cleans the name before it becomes the title (#1593)', () => {
    const { Notification } = fakeNotification()

    fireNotification(
      'turn-complete',
      { isWindowFocused: () => false, Notification, onClick: vi.fn() },
      'build\n\u0000ops'
    )

    expect(Notification).toHaveBeenCalledWith({ title: 'buildops', body: 'Your turn is complete.' })
  })

  it('uses the cleaned preview as the body when one comes with the command (#1737)', () => {
    const { Notification } = fakeNotification()

    fireNotification(
      'turn-complete',
      { isWindowFocused: () => false, Notification, onClick: vi.fn() },
      'deploy-bot',
      'All\n\ttests  pass.\u0007'
    )

    expect(Notification).toHaveBeenCalledWith({ title: 'deploy-bot', body: 'All tests pass.' })
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

describe('notificationBody (#1737)', () => {
  it('falls back to the fixed copy for each kind when no preview is given', () => {
    expect(notificationBody('turn-complete', undefined)).toBe('Your turn is complete.')
    expect(notificationBody('prompt', undefined)).toBe('Waiting for your response.')
  })

  it('cuts a 4000-character preview to 200 code points ending in an ellipsis', () => {
    const body = notificationBody('turn-complete', 'a'.repeat(4000))
    expect([...body]).toHaveLength(200)
    expect(body).toBe(`${'a'.repeat(199)}…`)
  })

  it('keeps a preview of exactly 200 characters whole', () => {
    expect(notificationBody('turn-complete', 'b'.repeat(200))).toBe('b'.repeat(200))
  })

  it('drops control characters and collapses newlines and whitespace runs to one space', () => {
    const preview = '  \u0000Fixed\u001b the\n\nflaky\r\n\ttest\u007f\u0085 now.  '
    expect(notificationBody('turn-complete', preview)).toBe('Fixed the flaky test now.')
  })

  it('falls back to the fixed copy when nothing is left once cleaned', () => {
    expect(notificationBody('turn-complete', '')).toBe('Your turn is complete.')
    expect(notificationBody('prompt', ' \n\t\u0000\u0007 ')).toBe('Waiting for your response.')
  })

  it('counts by code point, so a surrogate pair is never split at the cut', () => {
    const body = notificationBody('turn-complete', '😀'.repeat(300))
    expect([...body]).toHaveLength(200)
    expect(body).toBe(`${'😀'.repeat(199)}…`)
  })

  it('does not leave a space before the ellipsis', () => {
    const body = notificationBody('turn-complete', `${'c'.repeat(198)} ${'d'.repeat(50)}`)
    expect(body).toBe(`${'c'.repeat(198)}…`)
  })
})

describe('notificationTitle (#1593)', () => {
  it('falls back to "Pyrycode" when no name is given', () => {
    expect(notificationTitle(undefined)).toBe('Pyrycode')
  })

  it('keeps a plain name as it is', () => {
    expect(notificationTitle('deploy-bot · staging')).toBe('deploy-bot · staging')
  })

  it('drops C0, DEL and C1 control characters', () => {
    expect(notificationTitle('a\nb\tc\u0000d\u007fe\u009bf\u001bg')).toBe('abcdefg')
  })

  it('cuts the name to 80 characters', () => {
    expect(notificationTitle('x'.repeat(81))).toBe('x'.repeat(80))
    expect(notificationTitle('x'.repeat(10_000))).toBe('x'.repeat(80))
  })

  it('counts characters, not UTF-16 units — a surrogate pair at the cut is never split', () => {
    const title = notificationTitle('x'.repeat(79) + '🙂🙂')
    expect(title).toBe('x'.repeat(79) + '🙂')
    expect(Array.from(title)).toHaveLength(80)
  })

  it('counts only the kept characters toward the limit', () => {
    expect(notificationTitle('\n'.repeat(100) + 'y'.repeat(80))).toBe('y'.repeat(80))
  })

  it('falls back to "Pyrycode" for a name that is empty once cleaned', () => {
    expect(notificationTitle('')).toBe('Pyrycode')
    expect(notificationTitle('   ')).toBe('Pyrycode')
    expect(notificationTitle('\n\u0000\u009b')).toBe('Pyrycode')
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

  // #518: on macOS the window can be destroyed while the app keeps running, so a notification
  // click can land on a destroyed window. Every member below throws once destroyed.
  it('is a total no-op on a destroyed window — no member is touched (#518)', () => {
    const { win, isMinimized, restore, show, focus } = fakeWindow(false, true)

    expect(() => activateWindow(win)).not.toThrow()

    expect(isMinimized).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })
})

describe('windowHasFocus (#518)', () => {
  it('reports a live focused window as focused', () => {
    const { win } = fakeFocusableWindow(true)
    expect(windowHasFocus(win)).toBe(true)
  })

  it('reports a live unfocused window as unfocused', () => {
    const { win } = fakeFocusableWindow(false)
    expect(windowHasFocus(win)).toBe(false)
  })

  it('reports a destroyed window as unfocused without querying isFocused', () => {
    // A closed window cannot hold focus, so `false` is the semantically right answer — and it is
    // the condition under which a notification should fire. Asserting isFocused was never called
    // is what proves the guard precedes the touch (isFocused() throws once destroyed).
    const { win, isFocused } = fakeFocusableWindow(true, true)

    expect(() => windowHasFocus(win)).not.toThrow()
    expect(windowHasFocus(win)).toBe(false)
    expect(isFocused).not.toHaveBeenCalled()
  })
})
