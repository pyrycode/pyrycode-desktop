import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appWindow, attachLaunchFate, createLaunchFateLog, launchIsolatedApp } from './fixtures/desktopIsolation'
import { assertReplayNativeStorage } from './fixtures/replayNativeStorage'

test('missing inspector values do not diagnose native failure on launch or profile relaunch', async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'pyry-native-observation-'))
  const fate = createLaunchFateLog()
  const observations: { launch: number; sqliteReady: boolean; missingResult: boolean }[] = []
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  try {
    for (const launch of [0, 1]) {
      const app = await launchIsolatedApp({ args: ['.', `--user-data-dir=${directory}`], env, fate })
      const child = app.process()
      try {
        await appWindow(app)
        // One client-owned marker proves that the second process reads the saved profile.
        expect(await app.evaluate(({ app }, reopening) => {
          const fs = require('node:fs'), path = require('node:path')
          const marker = path.join(app.getPath('userData'), 'native-observation-marker')
          if (!reopening) fs.writeFileSync(marker, 'saved')
          return fs.readFileSync(marker, 'utf8') === 'saved'
        }, launch === 1)).toBe(true)

        // Forward every evaluation to this actual process. Drop only the first result's
        // value, after recording its boolean; no test-supplied success reaches the gate.
        const session = (app as any)._connection.toImpl(app)._nodeSession
        let reads = 0
        const controlled = { _connection: { toImpl: () => ({ _nodeSession: {
          send: async (method: string, params: object) => {
            const response = await session.send(method, params)
            expect(response.exceptionDetails).toBeUndefined()
            expect(response.result.value).toBe(true)
            const missingResult = reads++ === 0
            observations.push({ launch, sqliteReady: response.result.value === true, missingResult })
            return missingResult ? { ...response, result: {} } : response
          }
        } }) } } as unknown as ElectronApplication
        await assertReplayNativeStorage(controlled)
        expect(reads).toBe(2)
      } finally {
        await fate.closeWatched(app)
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      }
    }
    expect(observations).toEqual([0, 1].flatMap(launch => [
      { launch, sqliteReady: true, missingResult: true },
      { launch, sqliteReady: true, missingResult: false }
    ]))
  } finally {
    await testInfo.attach('native-prerequisite-observations', {
      body: JSON.stringify(observations), contentType: 'application/json'
    })
    await attachLaunchFate(testInfo, fate)
    await rm(directory, { recursive: true, force: true })
  }
})
