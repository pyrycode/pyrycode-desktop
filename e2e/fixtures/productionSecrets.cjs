// Playwright's Electron loader installs these mock-protection switches before this hook.
// Native protection probes remove them before app readiness; sandbox settings stay untouched.
const { app } = require('electron')
app.commandLine.removeSwitch('password-store')
app.commandLine.removeSwitch('use-mock-keychain')
