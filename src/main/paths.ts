import { app } from 'electron';
import path from 'node:path';

// Where ScribeForge keeps its settings. This must run before the app is ready.
//   SCRIBEFORGE_USER_DATA  a test run's own throwaway folder
//   SCRIBEFORGE_TRIAL=1    trial mode: %APPDATA%\ScribeForge Trial
//   otherwise              %APPDATA%\ScribeForge
export const isTrial = process.env.SCRIBEFORGE_TRIAL === '1';

if (process.env.SCRIBEFORGE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.SCRIBEFORGE_USER_DATA));
} else if (isTrial) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ScribeForge Trial'));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'ScribeForge'));
}

export function dataDir(): string {
  return app.getPath('userData');
}
