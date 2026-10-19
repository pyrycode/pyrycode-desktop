import { recordedTest as test, expect } from './fixtures/launchRecordedApp'
import { drivePermissionScenario, PERMISSION_PROMPT, PERMISSION_REPLY } from './fixtures/permissionScenario'

test('recorded Claude permission waits for confirmation and renders the completed reply', async ({ recordedApp, recording }) => {
  expect(recording.scenario.prompt).toBe(PERMISSION_PROMPT)
  expect(recording.scenario.expectedReply).toBe(PERMISSION_REPLY)
  const result = await drivePermissionScenario(recordedApp.page, {
    allowLabel: async () => recording.scenario.allowLabel!
  })
  expect(result.historyRetry).toBe(recording.scenario.historyRetry)
})
