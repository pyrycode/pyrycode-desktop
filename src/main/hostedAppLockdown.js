// Installed before page scripts by the native document-start hook. No native API is exposed.
for (const name of ['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker',
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker',
  'cookieStore', 'CookieStore']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false })
}
Object.defineProperty(navigator, 'sendBeacon', { value: () => false, writable: false, configurable: false })
Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: false })
