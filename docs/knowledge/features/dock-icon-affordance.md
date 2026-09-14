# Dock icon (dev-only, macOS)

`npm run dev` on macOS sets the same drawn icon on the Dock that `build/icon.png`/`build/icon.ico` ship
on an installed build — see [Windows packaging § `build/` holds icon inputs, not app payload](windows-packaging.md#build-holds-icon-inputs-not-app-payload)
for where that artwork comes from. Before [#1446](https://github.com/pyrycode/pyrycode-desktop/issues/1446)
nothing set a dock icon at all, so every dev run showed Electron's own default — the one surface the
operator looks at all day while driving the app as his daily client. A packaged build is untouched: there
is no `mac` target, so a shipped app takes its icon from the bundle electron-builder assembles, never from
this path.

## The gate

`src/main/dockIcon.ts` is the **fourth instance** of the [loopback relay](loopback-relay-affordance.md) /
[secret-backend](secret-backend-affordance.md) / [window-presentation](window-presentation-affordance.md)
shape: a pure, `electron`-free, false-first-on-`isPackaged` selector, unit-tested with plain values.

```ts
export function selectDockIcon(opts: {
  isPackaged: boolean
  platform: NodeJS.Platform
  appPath: string
}): string | undefined {
  if (opts.isPackaged) return undefined
  if (opts.platform !== 'darwin') return undefined
  return join(opts.appPath, 'build', 'icon.png')
}
```

It differs from its three siblings in what it is gating: they each admit a dev/test-only *relaxation*
behind an explicit env-var opt-in (a loopback relay, a keychain-free secret backend, a hidden window).
This one has no opt-in and no env var — every non-packaged darwin run gets the icon, unconditionally.
`isPackaged` is still checked, and checked **first**, for the same reason as the others: a packaged
macOS app would have no `mac` target's bundle to draw from anyway, and checking it first means the
platform branch cannot be reached by a shipped build no matter what value `process.platform` holds.
`appPath` comes from `app.getAppPath()`, not `__dirname`, so the returned path is the clone's root
rather than the `out/main` layout electron-vite builds into.

## Why the composition root loads the file before calling `setIcon`

`app.dock.setIcon` **throws** on a path it cannot read (measured against Electron 33 on darwin: *"Failed
to load image from path"*), rather than no-opping. The call sits as the first statement inside
`app.whenReady` in `src/main/index.ts`, so a naive `app.dock.setIcon(path)` would let a moved or pruned
`build/icon.png` reject the whole `whenReady` promise — no window, no IPC, no daemon connection — for a
cosmetic dev affordance. The guard:

```ts
const dockIcon = selectDockIcon({ isPackaged: app.isPackaged, platform: process.platform, appPath: app.getAppPath() })
if (dockIcon) {
  const icon = nativeImage.createFromPath(dockIcon)
  if (icon.isEmpty()) console.warn(`dock icon unreadable at ${dockIcon}`)
  else app.dock.setIcon(icon)
}
```

`nativeImage.createFromPath` returns an **empty** image instead of throwing, which is what makes a
pre-check possible at all. The empty branch warns rather than staying silent: `setIcon` accepts an empty
image without complaint and simply leaves Electron's default icon in place, so a silent miss would
present as "the ticket never worked" with no signal pointing at a missing file.

## Testing

`src/main/dockIcon.test.ts` drives `selectDockIcon` through plain values: darwin-unpackaged returns the
master's path, non-darwin returns `undefined`, and packaged returns `undefined` **even on darwin** — the
ordering property that a later edit could reverse invisibly, and the one AC2's "a packaged build is
untouched" actually names. There is no e2e spec: the Dock is OS chrome outside the Electron window, so
Playwright cannot see it. Proof of the wired-up call is a recorded `npm run dev` run that reaches a live
relay connection with the icon call as the first statement of `whenReady`, plus a probe confirming
`createFromPath` on the committed master yields a non-empty image that `setIcon` accepts — the pixels on
the Dock tile itself still need a human eyeball.

## Related

- [Windows packaging § `build/` holds icon inputs, not app payload](windows-packaging.md#build-holds-icon-inputs-not-app-payload) — where `build/icon.png`/`build/icon.ico` are rendered from and what they contain.
- [Window-presentation dev affordance](window-presentation-affordance.md), [Secret-backend dev affordance](secret-backend-affordance.md), [Loopback relay dev affordance](loopback-relay-affordance.md) — the three prior instances of the false-first `isPackaged` gate shape.
