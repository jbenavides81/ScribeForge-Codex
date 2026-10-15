// Trial mode: runs ScribeForge from source with its own data folder, so trying things out
// never touches your real settings or recent files.
//   npm run trial         start it (reloads when the code changes)
//   npm run trial:reset   delete the trial data folder
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const trialDir = path.join(process.env.APPDATA ?? '', 'ScribeForge Trial');

if (process.argv.includes('--reset')) {
  if (!process.env.APPDATA) {
    console.error('APPDATA is not set, so the trial folder could not be found.');
    process.exit(1);
  }
  if (existsSync(trialDir)) {
    rmSync(trialDir, { recursive: true, force: true });
    console.log(`Trial data deleted: ${trialDir}`);
  } else {
    console.log('There was no trial data to delete.');
  }
  process.exit(0);
}

console.log(`Trial mode. Data folder: ${trialDir}`);
const child = spawn('npx electron-vite dev', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SCRIBEFORGE_TRIAL: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
