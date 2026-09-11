import { _electron as playwrightElectron } from '@playwright/test'

// Check the runner's environment, not the child options: callers may replace the child env.
export const electron = {
  async launch(options: Parameters<typeof playwrightElectron.launch>[0]) {
    if (process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt') {
      throw new Error(
        'Electron tests on macOS must run outside the Codex sandbox. ' +
          'Request approved execution outside the sandbox before retrying. ' +
          'Do not unset CODEX_SANDBOX or change Electron security settings.'
      )
    }
    return playwrightElectron.launch(options)
  }
}
