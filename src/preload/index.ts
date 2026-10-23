import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MakeCertificateRequest, MenuCommand, SaveBesideRequest, SaveManyRequest, SaveRequest, ScribeForgeApi, SettingsChange } from '../shared/api';

// The only things the screens can ask the rest of the app to do.
const api: ScribeForgeApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  changeSettings: (change: SettingsChange) => ipcRenderer.invoke('settings:change', change),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  openPath: (path: string) => ipcRenderer.invoke('file:open-path', path),
  openMany: () => ipcRenderer.invoke('file:open-many'),
  saveFile: (request: SaveRequest) => ipcRenderer.invoke('file:save', request),
  saveFiles: (request: SaveManyRequest) => ipcRenderer.invoke('file:save-many', request),
  saveBeside: (request: SaveBesideRequest) => ipcRenderer.invoke('file:save-beside', request),
  setUnsaved: (unsaved: boolean) => ipcRenderer.send('doc:unsaved', unsaved === true),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  recentFiles: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (path: string) => ipcRenderer.invoke('recent:remove', path),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  openLink: (address: string) => ipcRenderer.invoke('link:open', address),
  onMenu: (listener: (command: MenuCommand) => void) => {
    const handler = (_event: unknown, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu', handler);
    return () => {
      ipcRenderer.removeListener('menu', handler);
    };
  },
  rememberedCertificate: () => ipcRenderer.invoke('sign:remembered'),
  chooseCertificate: () => ipcRenderer.invoke('sign:choose'),
  unlockCertificate: (path: string, password: string) => ipcRenderer.invoke('sign:unlock', path, password),
  signDigest: (digest: Uint8Array) => ipcRenderer.invoke('sign:sign', digest),
  forgetCertificate: () => ipcRenderer.send('sign:forget'),
  trustList: () => ipcRenderer.invoke('sign:trust-list'),
  trustCertificate: (der: string) => ipcRenderer.invoke('sign:trust-add', der),
  untrustCertificate: (der: string) => ipcRenderer.invoke('sign:trust-remove', der),
  makeCertificate: (request: MakeCertificateRequest) => ipcRenderer.invoke('sign:make', request),
};

contextBridge.exposeInMainWorld('scribeforge', api);
