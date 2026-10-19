import { _electron as playwrightElectron } from '@playwright/test'
import { installMainProcessControl } from './mainProcessControl'
import { withWorkerDisplay } from './runDisplay'

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
    const env = await withWorkerDisplay(options?.env)
    const app = await playwrightElectron.launch({ ...options, env })
    try { installMainProcessControl(app) }
    catch (error) {
      try { await app.close() } catch { /* Preserve the setup error. */ }
      throw error
    }
    return app
  }
}
