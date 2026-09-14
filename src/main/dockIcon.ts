import { join } from 'path'

// The dev-only dock-icon affordance (#1446), quarantined to its own module so the composition root
// keeps one line rather than a platform test and a path join. It answers ONE question — "which file,
// if any, should this build hand to the macOS dock?" Everything here is pure and synchronous; nothing
// reads `app.isPackaged` or `process.platform` itself, so this module imports no `electron` and
// unit-tests with plain values. It mirrors `windowPresentation.ts` (#1067), `relayPolicy.ts` (#97) and
// `secretBackend.ts` (#99) in shape, and is the fourth instance of that gate.
//
// WHY THE GATE IS FALSE-FIRST ON isPackaged rather than merely consistent with its three siblings: a
// packaged macOS app takes its dock icon from the bundle electron-builder assembles, and there is no
// `mac` target, so a shipped build has no business overriding it from a path that only exists in a
// clone. Checking `isPackaged` first means the platform branch below cannot be reached by a shipped
// build at all, which is what AC2's "a packaged build is untouched" names.

/** Where the icon lives in a clone, relative to the app path. The 512² master `dist:win` also uses. */
const MASTER_ICON = ['build', 'icon.png']

/**
 * The file a build should set as its dock icon, or `undefined` for every build that should leave the
 * dock alone: every packaged build, and every platform but darwin, where Electron does not define
 * `app.dock` at all (its typing says otherwise — `readonly dock: Dock`, non-optional — so this check
 * is the real guard, not the type).
 *
 * `appPath` rather than `__dirname`: the caller passes `app.getAppPath()`, which is the clone's root,
 * so the path here does not encode the `out/main` layout electron-vite happens to build into today.
 */
export function selectDockIcon(opts: {
  isPackaged: boolean
  platform: NodeJS.Platform
  appPath: string
}): string | undefined {
  if (opts.isPackaged) return undefined
  if (opts.platform !== 'darwin') return undefined
  return join(opts.appPath, ...MASTER_ICON)
}
