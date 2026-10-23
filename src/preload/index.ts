import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MakeCertificateRequest, MenuCommand, SaveBesideRequest, SaveManyRequest, SaveRequest, ScribeForgeApi, SettingsChange } from '../shared/api';
import type { NewDocument, NewVersion, SearchOptions } from '../shared/vault';

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
  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  vaultCreate: (password: string, withRecoveryCode: boolean) => ipcRenderer.invoke('vault:create', password, withRecoveryCode),
  vaultUnlock: (secret: string, kind: 'password' | 'recovery') => ipcRenderer.invoke('vault:unlock', secret, kind),
  vaultLock: () => ipcRenderer.send('vault:lock'),
  vaultActive: () => ipcRenderer.send('vault:active'),
  vaultDocuments: () => ipcRenderer.invoke('vault:documents'),
  vaultThumbnail: (id: string) => ipcRenderer.invoke('vault:thumbnail', id),
  vaultChooseFiles: (purpose?: 'add' | 'version') => ipcRenderer.invoke('vault:choose-files', purpose ?? 'add'),
  vaultAdd: (items: NewDocument[]) => ipcRenderer.invoke('vault:add', items),
  vaultOpen: (id: string) => ipcRenderer.invoke('vault:open', id),
  vaultUpdate: (id: string, change: { title?: string; labels?: string[]; note?: string }) => ipcRenderer.invoke('vault:update', id, change),
  vaultVoid: (id: string, reason: string) => ipcRenderer.invoke('vault:void', id, reason),
  vaultRestoreDocument: (id: string) => ipcRenderer.invoke('vault:restore-document', id),
  vaultErase: (id: string, reason: string) => ipcRenderer.invoke('vault:erase', id, reason),
  vaultSaveCopy: (id: string) => ipcRenderer.invoke('vault:save-copy', id),
  vaultHistory: () => ipcRenderer.invoke('vault:history'),
  vaultSaveText: (suggestedName: string, text: string) => ipcRenderer.invoke('vault:save-text', suggestedName, text),
  vaultChangePassword: (current: string, next: string) => ipcRenderer.invoke('vault:change-password', current, next),
  vaultRecoveryCode: (password: string) => ipcRenderer.invoke('vault:recovery-code', password),
  vaultBackup: () => ipcRenderer.invoke('vault:backup'),
  vaultChooseBackup: () => ipcRenderer.invoke('vault:choose-backup'),
  vaultRestoreBackup: (secret: string, kind: 'password' | 'recovery', restore: boolean) => ipcRenderer.invoke('vault:restore-backup', secret, kind, restore),
  vaultForgetBackup: () => ipcRenderer.send('vault:forget-backup'),
  vaultSearch: (query: string, options: SearchOptions) => ipcRenderer.invoke('vault:search', query, options),
  vaultUnindexed: () => ipcRenderer.invoke('vault:unindexed'),
  vaultIndex: (entries: { id: string; pageTexts: string[] }[]) => ipcRenderer.invoke('vault:index', entries),
  vaultClearIndex: () => ipcRenderer.invoke('vault:clear-index'),
  vaultTextless: () => ipcRenderer.invoke('vault:textless'),
  vaultVersions: (id: string) => ipcRenderer.invoke('vault:versions', id),
  vaultAddVersion: (id: string, item: NewVersion) => ipcRenderer.invoke('vault:add-version', id, item),
  vaultOpenVersion: (id: string, versionId: string) => ipcRenderer.invoke('vault:open-version', id, versionId),
  vaultVersionNote: (versionId: string, note: string) => ipcRenderer.invoke('vault:version-note', versionId, note),
  onVaultLocked: (listener: (why: string) => void) => {
    const handler = (_event: unknown, why: string) => listener(why);
    ipcRenderer.on('vault:locked', handler);
    return () => {
      ipcRenderer.removeListener('vault:locked', handler);
    };
  },
};

contextBridge.exposeInMainWorld('scribeforge', api);
