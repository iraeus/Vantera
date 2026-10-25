const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("vantera", {
  saveUrl: (url) => ipcRenderer.invoke("save-url", url),
  retry: () => ipcRenderer.invoke("retry"),
  changeUrl: () => ipcRenderer.invoke("change-url"),
});
