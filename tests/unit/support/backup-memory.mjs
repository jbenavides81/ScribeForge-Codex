// Runs one backup or restore in a process of its own, and prints how much more memory the process
// needed at its peak than just before (stop 4a's memory check, tests/unit/backup-folder.test.ts).
// The vault code is TypeScript, which Node runs as it is once relative imports may leave out ".ts".
//   node backup-memory.mjs <backup-file|backup-folder|restore-file|restore-folder> <vault folder> <target> <password>
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { Vault } = await load('src/main/vault/vault.ts');
const folders = await load('src/main/vault/backupFolder.ts');

const [what, vaultDir, target, password] = process.argv.slice(2);
const vault = new Vault(vaultDir, { cost: 10 });
if (what.startsWith('backup') && !vault.unlock(password)) throw new Error('wrong password');
const before = process.resourceUsage().maxRSS;
if (what === 'backup-file') vault.backup(target);
else if (what === 'backup-folder') {
  const snap = vault.snapshot('aaaaaaaaaaaa');
  await folders.prepareFolder(target);
  await folders.copyNewFiles(target, snap.stored);
  await folders.writeSnapshot(target, snap.name, snap.bytes);
} else if (what === 'restore-file') vault.restoreBackup({ file: target }, password);
else if (what === 'restore-folder') vault.restoreBackup({ folder: target, snapshot: folders.listSnapshots(target)[0].name }, password);
else throw new Error(`unknown: ${what}`);
// resourceUsage gives kilobytes.
process.stdout.write(`${Math.round((process.resourceUsage().maxRSS - before) / 1024)}\n`);
