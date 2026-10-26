// Trial mode: runs ScribeForge from source with its own data folder, so trying things out
// never touches your real settings or recent files.
//   npm run trial             start it (reloads when the code changes)
//   npm run trial:second-pc   the same, with a second data folder of its own: on one PC, it acts
//                             as another PC would (stop 4a's manual test of moving between PCs)
//   npm run trial:reset       delete the trial data folders
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const trialDir = path.join(process.env.APPDATA ?? '', 'ScribeForge Trial');
const secondDir = path.join(process.env.APPDATA ?? '', 'ScribeForge Trial (second PC)');

if (process.argv.includes('--reset')) {
  if (!process.env.APPDATA) {
    console.error('APPDATA is not set, so the trial folder could not be found.');
    process.exit(1);
  }
  let deleted = false;
  for (const dir of [trialDir, secondDir]) {
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    console.log(`Trial data deleted: ${dir}`);
    deleted = true;
  }
  if (!deleted) console.log('There was no trial data to delete.');
  process.exit(0);
}

const second = process.argv.includes('--second-pc');
console.log(`Trial mode${second ? ', as a second PC' : ''}. Data folder: ${second ? secondDir : trialDir}`);
const child = spawn('npx electron-vite dev', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SCRIBEFORGE_TRIAL: '1', ...(second ? { SCRIBEFORGE_USER_DATA: secondDir } : {}) },
});
child.on('exit', (code) => process.exit(code ?? 0));
