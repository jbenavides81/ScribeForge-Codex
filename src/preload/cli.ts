import { contextBridge, ipcRenderer } from 'electron';
import type { CliBridge, RenderJob, RenderResult } from '../shared/cli';

// The command-line tool's window only: it's given a job and sends back the result, or a password.
const { mode, fileName, retry } = ipcRenderer.sendSync('cli:window') as { mode: string; fileName: string; retry: boolean };

const bridge: CliBridge = {
  mode,
  fileName,
  retry,
  ready: () => ipcRenderer.send('cli:ready'),
  onJob: (listener: (job: RenderJob) => void) => {
    ipcRenderer.on('cli:job', (_event, job: RenderJob) => listener(job));
  },
  sendResult: (result: RenderResult | { error: string }) => ipcRenderer.send('cli:result', result),
  sendPassword: (password: string | null) => ipcRenderer.send('cli:password', typeof password === 'string' ? password : null),
};

contextBridge.exposeInMainWorld('scribeforgeCli', bridge);
