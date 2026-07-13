// The running app's build string (#350), substituted at build time by the Vite `define` in
// electron.vite.config.ts (app) and vitest.config.ts (tests), fed from package.json's `version`. Declared
// ambient (no import/export) so it is a global visible to every renderer module without importing it —
// picked up by tsconfig.web.json's src/renderer/src/**/* glob, alongside env.d.ts.
declare const __APP_VERSION__: string
