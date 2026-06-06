const { contextBridge, ipcRenderer } = require('electron');

const validSendChannels = new Set([
  'transcribe-chunk',
  'list-sessions',
  'get-session',
  'create-session',
  'save-session',
  'delete-session',
  'get-config',
  'set-config',
  'polish-summary',
  'cancel-polish',
  'export-pdf',
  'open-session-folder',
  'check-model-ready'
]);

const validReceiveChannels = new Set([
  'model-download-progress',
  'whisper-ready',
  'whisper-error',
  'ai-stream-chunk',
  'ai-stream-done',
  'ai-stream-error'
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (validSendChannels.has(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Unknown channel: ${channel}`));
  },

  on: (channel, callback) => {
    if (validReceiveChannels.has(channel)) {
      const wrapped = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    }
  },

  once: (channel, callback) => {
    if (validReceiveChannels.has(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  }
});
