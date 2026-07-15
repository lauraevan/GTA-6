// Minimal preload: expose a desktop flag so the client can adapt (e.g. show
// "Quit" instead of relying on browser navigation).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('GTA_DESKTOP', {
  version: process.versions.electron,
  platform: process.platform,
});
