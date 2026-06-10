const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (handler) => {
  const wrapped = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('vault', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial) => ipcRenderer.invoke('config:set', partial)
  },
  mic: {
    request: () => ipcRenderer.invoke('mic:request')
  },
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    download: (model) => ipcRenderer.invoke('whisper:download', model),
    deleteModel: (model) => ipcRenderer.invoke('whisper:delete-model', model),
    installBrew: () => ipcRenderer.invoke('whisper:install-brew'),
    onDownloadProgress: on('whisper:download-progress'),
    onInstallLog: on('whisper:install-log')
  },
  record: {
    start: () => ipcRenderer.invoke('record:start'),
    sendPcm: (buf) => ipcRenderer.send('record:pcm', buf),
    finish: () => ipcRenderer.invoke('record:finish'),
    cancel: () => ipcRenderer.invoke('record:cancel'),
    onSegment: on('transcript:segment'),
    onError: on('transcript:error')
  },
  sessions: {
    save: (data) => ipcRenderer.invoke('session:save', data),
    list: () => ipcRenderer.invoke('sessions:list'),
    search: (q) => ipcRenderer.invoke('sessions:search', q),
    load: (dir) => ipcRenderer.invoke('sessions:load', dir),
    remove: (dir) => ipcRenderer.invoke('sessions:delete', dir)
  },
  polish: {
    run: (payload) => ipcRenderer.invoke('polish:run', payload),
    testKey: (key) => ipcRenderer.invoke('polish:test-key', key),
    onDelta: on('polish:delta')
  },
  exporter: {
    copy: (text) => ipcRenderer.invoke('export:copy', text),
    pdf: (opts) => ipcRenderer.invoke('export:pdf', opts),
    reveal: (dir) => ipcRenderer.invoke('export:reveal', dir)
  },
  dialog: {
    chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  }
});
