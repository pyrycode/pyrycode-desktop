// The test/dev-only window-presentation affordance (#1067), quarantined to its own module so
// `createWindow` stays free of any dev/env code. It answers ONE question — "should this build show its
// window when it is ready?" — and is the only place a build can ever be told not to. Everything here is
// pure and synchronous; `selectWindowPresentation` runs ONCE at the composition root (index.ts) and its
// value is passed down to every window, so the dock-reopened window of the `activate` handler cannot
// diverge from the first one. Nothing here reads `app.isPackaged` or `process.env` itself — the effectful
// choice is passed in, so this module unit-tests with plain values and imports no `electron`. It mirrors
// `relayPolicy.ts` (#97) and `secretBackend.ts` (#99) in shape, and is the third instance of that gate.
//
// WHY THE GATE IS FALSE-FIRST ON isPackaged, and not merely consistent with its two siblings: a window
// that is never shown while the app is otherwise fully live — IPC handlers registered, daemon session
// connected, secrets readable — is an INVISIBLE PAIRED CLIENT. `process.env` is writable by anything
// already running as the operator, so if a shipped build consulted the flag at all, env control would buy
// a way to run the operator's paired client with no visible surface. A packaged build therefore never
// reads it. `windowPresentation.test.ts` asserts that ordering directly rather than only the happy paths,
// because it is a property of the ORDER of two checks and a later edit could reverse it without changing
// anything the other tests observe.
//
// The relaxation is bounded on two independent axes, BOTH required simultaneously: (1) `!isPackaged` — a
// deterministic code gate checked false-first; (2) an explicit env opt-in equal to exactly `'1'`.

/**
 * The environment variable that opts a non-packaged build out of showing its window. Single-sourced here
 * so a rename is one edit; the default-tier e2e harness imports this constant rather than retyping the
 * string. Honest name: it hides the window, nothing more — it relaxes no validation, widens no IPC
 * surface, and touches no secret. Analog of #97's LOOPBACK_RELAY_ENV_FLAG and #99's
 * TEST_SECRET_BACKEND_ENV_FLAG.
 */
export const HIDDEN_WINDOW_ENV_FLAG = 'PYRY_HIDDEN_WINDOW'

/**
 * How a window presents itself once its content is ready. `'shown'` is every real launch: the
 * `ready-to-show` listener shows the window, and background throttling keeps Chromium's default. Under
 * `'hidden'` the window is never shown AND its renderer opts out of background throttling — the two are
 * inseparable, which is why they are one value rather than two flags. A hidden window is an occluded
 * window, so hiding it without that opt-out would earn precisely the renderer stalls the affordance
 * exists to remove.
 */
export type WindowPresentation = 'shown' | 'hidden'

/**
 * The deterministic, `isPackaged`-false-first gate — belt-and-suspenders "different fabric" (code, not
 * config). When packaged, the env flag is NEVER read, so a shipped build always shows its window
 * regardless of environment. Opt-in is exact: only the string `'1'` hides it — an unset var, empty
 * string, `'0'`, or `'true'` all resolve to `'shown'`.
 */
export function selectWindowPresentation(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
}): WindowPresentation {
  if (opts.isPackaged) return 'shown'
  if (opts.env[HIDDEN_WINDOW_ENV_FLAG] === '1') return 'hidden'
  return 'shown'
}
