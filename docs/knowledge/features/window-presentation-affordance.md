# Window-presentation dev affordance

A deterministic, **test/dev-only** affordance that lets a non-packaged build's main process keep every window it opens unshown — so the default-tier Playwright harness can drive the whole pairing arrival with the app **never frontmost**, immune to the operator occluding or unfocusing it mid-run — while a **packaged build stays byte-identical to today**: `ready-to-show` always shows the window, `backgroundThrottling` at Electron's documented default. Introduced in [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067), split into its own module for the same reason its two siblings were: this is a security-sensitive surface (it can suppress a live client's only visible surface) and belongs audited in isolation from e2e plumbing.

It is the **third instance** of the [loopback relay affordance](loopback-relay-affordance.md) ([#97](../codebase/97.md)) / [secret-backend affordance](secret-backend-affordance.md) ([#99](../codebase/99.md)) shape: same `isPackaged`-false-first gate, same quarantined pure module, same "provably unreachable in a packaged build" security posture.

## Why it exists

[`e2e/fixtures/desktopIsolation.ts`](e2e-harness.md#desktop-isolation-default-tier-launches) needed two levers to stop the default tier's launches from being disturbed by the operator's own desktop: Chromium switches that exempt a renderer from occlusion/backgrounding throttling, and not showing the window at all. Neither alone is sufficient — a hidden window is still an occluded one, so hiding it without the switches earns back exactly the throttling being removed; the switches alone leave every launch stealing the operator's focus 49 times a run. This affordance is the second lever, on the main-process side.

## What it does

`selectWindowPresentation({ isPackaged, env })` returns `'shown'` or `'hidden'`. Bounded on **two independent axes, both required at once**:

1. **`!isPackaged`** — a deterministic code gate, checked **false-first**, so a packaged build never even reads the env flag (belt-and-suspenders "different fabric": code, not config).
2. **explicit env opt-in** — `env['PYRY_HIDDEN_WINDOW'] === '1'` (exact string).

`'hidden'` is not only "don't call `show()`": it also sets `backgroundThrottling: false` on that window's `webPreferences`. The two are inseparable, which is why they are one value rather than two flags — `backgroundThrottling: false` is the one knob that keeps the Page Visibility API reporting the page as visible, which is what timers, transitions, and Playwright's own rAF-based stability check depend on. `'shown'` leaves `backgroundThrottling: true` (Electron's documented default), so every packaged launch is unchanged in effect.

## How it works

`src/main/windowPresentation.ts` is pure and synchronous, and imports no `electron` — the effectful inputs (`app.isPackaged`, `process.env`) are read once, at the composition root in `index.ts`, and the resulting `WindowPresentation` value is passed down into `createWindow` and, through `openWindow`, to every window the app opens:

```ts
export const HIDDEN_WINDOW_ENV_FLAG = 'PYRY_HIDDEN_WINDOW'
export type WindowPresentation = 'shown' | 'hidden'

export function selectWindowPresentation(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): WindowPresentation {
  if (opts.isPackaged) return 'shown'                          // env NOT consulted when packaged
  if (opts.env[HIDDEN_WINDOW_ENV_FLAG] === '1') return 'hidden'
  return 'shown'
}
```

`createWindow(presentation)` acts on the value in exactly two places: it skips attaching the `ready-to-show → show()` listener when hidden, and sets `webPreferences.backgroundThrottling: !hidden`. Nothing else about the window moves — `sandbox`, `contextIsolation`, the `will-navigate` guard, and `setWindowOpenHandler`'s deny are all untouched. `selectWindowPresentation` is called **once**, in `app.whenReady().then(...)`, beside [`selectRelayPolicy`](loopback-relay-affordance.md); its value is threaded through `openWindow` so the dock-reopened window (the `activate` handler) cannot diverge from the first one — one decision site, not one per window.

## Security properties

The builder self-review verdict is **PASS**. The finding the `security-sensitive` label was applied for: a window that is never shown while the app is otherwise fully live — IPC handlers registered, daemon session connected, secrets readable — is an **invisible paired client**. If a packaged build could be talked into that state, an attacker with only environment control would get to run the operator's paired client with no visible surface. It cannot: `isPackaged` is checked **before** the env read, so a shipped build never consults the flag regardless of what is exported into its environment, and [`windowPresentation.test.ts`](#testing) asserts the packaged-plus-flag-set case explicitly — the property is the *order* of two checks, which a later edit could silently reverse without failing any happy-path test.

- `app.commandLine`/the launch's argv are read only from the **e2e side**, inside `app.evaluate` — no production code gains a way to read its own launch command line.
- No IPC channel, `contextBridge` API, or protocol handler is added; `nodeIntegration` is not touched.
- `backgroundThrottling: false` is reachable only on the hidden path and is a CPU/battery property, not a privilege one.

## Testing

`src/main/windowPresentation.test.ts` (plain Node, no `electron` import, the `relayPolicy.test.ts`/`secretBackend.test.ts` shape): packaged+flag-set → `'shown'` (the load-bearing case); unpackaged+no-flag → `'shown'`; unpackaged+`'1'` → `'hidden'`; unpackaged + `''`/`'0'`/`'true'`/`' 1'`/`'1 '` → `'shown'`.

## Edge cases and limitations

- **Opt-in is exact.** Only `'1'` hides the window; an unset var or any other string resolves to `'shown'`.
- **Fail-open to shown, not fail-closed to hidden.** Every path except the single opt-in path shows the window — a developer machine that forgets to export the flag just gets the normal, visible app.
- **Clipboard writes and image decode were verified to survive a hidden window empirically, not assumed.** [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067)'s revisions record that `navigator.clipboard.writeText` (`message-copy.spec.ts`) and thumbnail decode + scroll geometry (`thread-scroll-pin.spec.ts`, `attachment-image-thumbnail.spec.ts`) all pass with the window never shown — `backgroundThrottling: false` reporting the page as visible was enough, so the `showInactive()` fallback the ticket planned for was never needed.

## Related

- [E2E test harness § Desktop isolation](e2e-harness.md#desktop-isolation-default-tier-launches) — the sole consumer: `e2e/fixtures/desktopIsolation.ts` sets `HIDDEN_WINDOW_ENV_FLAG` alongside the Chromium renderer-throttling switches.
- [Loopback relay dev affordance](loopback-relay-affordance.md) / [#97](../codebase/97.md) and [Secret-backend dev affordance](secret-backend-affordance.md) / [#99](../codebase/99.md) — the two prior instances of this exact shape; this is their third. [Dock icon (dev-only, macOS)](dock-icon-affordance.md) / [#1446](https://github.com/pyrycode/pyrycode-desktop/issues/1446) is the fourth, though it gates an unconditional dev affordance rather than an env-opt-in relaxation.
