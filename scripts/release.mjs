// Makes a release's files, ready to publish (stop 4c, docs/Releasing.md). It never publishes:
// that's done separately, only when the maintainer chooses.
//   npm run release              checks, every test, the installer, checksums and notes
//   npm run release -- --practice  the build and the files only, to try the steps out: it skips
//                                  the checks on the repository and the tests, and writes into
//                                  release\practice. Not for publishing.
//
// 1. Refuses if there are uncommitted changes, it isn't main, the version is already released, the
//    changelog has no section for it, or the third-party notices are out of date.
// 2. Runs the typecheck, the unit tests, and the whole-app tests on the development build and the
//    packaged app.
// 3. Builds the installer, then builds the app a second time: the app's own files must come out
//    the same, so anyone can rebuild them from the source and compare.
// 4. Writes the checksum file and the release notes, and checks neither holds personal details.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { noticesText } from './make-notices.mjs';
import { changelogSection, checksumFile, isUpdateFile, personalDetails, refusals, releaseNotes } from './release-checks.mjs';

const practice = process.argv.includes('--practice');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (command) => {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
};
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const stop = (lines) => {
  console.error(`\nNo release made:\n${lines.map((l) => `- ${l}`).join('\n')}`);
  process.exit(1);
};

console.log(practice ? `Practice release of ScribeForge ${version} (not for publishing).` : `Releasing ScribeForge ${version}.`);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section = changelogSection(changelog, version);

// 1. The checks.
if (!practice) {
  let tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  try {
    tags = [...tags, ...git('ls-remote', '--tags', 'origin').split('\n').map((l) => l.split('refs/tags/')[1]).filter(Boolean)];
  } catch {
    console.log("(Couldn't read GitHub's tags, so only this PC's tags were checked.)");
  }
  const problems = refusals({
    version,
    changes: git('status', '--porcelain').split('\n').filter(Boolean),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    tags,
    changelog,
    noticesFresh: noticesText() === readFileSync('THIRD-PARTY-NOTICES.md', 'utf8').replace(/\r\n/g, '\n'),
  });
  if (problems.length) stop(problems);

  // 2. Every test.
  run('npm run typecheck');
  run('npm test');
  run('npm run e2e');
  run('npm run e2e:packaged');
} else if (!section) stop([`CHANGELOG.md has no section for ${version}.`]);

// 3. The installer, and the app built a second time.
const started = Date.now();
run('npm run dist');
const installerName = `ScribeForge Setup ${version}.exe`;
const installer = path.join('release', installerName);
const appFiles = [
  { name: 'ScribeForge.exe', file: path.join('release', 'win-unpacked', 'ScribeForge.exe') },
  { name: 'resources/app.asar', file: path.join('release', 'win-unpacked', 'resources', 'app.asar') },
];
for (const f of [installer, ...appFiles.map((a) => a.file)]) if (!existsSync(f) || statSync(f).mtimeMs < started) stop([`The build didn't make ${f}.`]);
const updateFiles = readdirSync('release').filter((n) => isUpdateFile(n) && statSync(path.join('release', n)).mtimeMs >= started);
if (updateFiles.length) stop([`The build made files for automatic updates (${updateFiles.join(', ')}). electron-builder.yml should turn them off.`]);
const sums = [{ name: installerName, sha256: sha256(installer) }, ...appFiles.map((a) => ({ name: a.name, sha256: sha256(a.file) }))];

run('npm run pack');
const again = appFiles.filter((a) => sha256(a.file) !== sums.find((s) => s.name === a.name).sha256);
if (again.length) stop([`${again.map((a) => a.name).join(' and ')} came out different the second time, so the app couldn't be checked by rebuilding it.`]);

// 4. The checksum file and the notes.
const outDir = practice ? path.join('release', 'practice') : 'release';
mkdirSync(outDir, { recursive: true });
if (practice) copyFileSync(installer, path.join(outDir, installerName));
const sumsName = `ScribeForge ${version} SHA256SUMS.txt`;
const notesName = `ScribeForge ${version} notes.md`;
const sumsText = checksumFile(sums);
const notesText = releaseNotes(version, section ?? '', sums);
const personal = [...personalDetails(sumsText, userInfo().username), ...personalDetails(notesText, userInfo().username)];
if (personal.length) stop([`The release files would contain ${[...new Set(personal)].join(' and ')}.`]);
writeFileSync(path.join(outDir, sumsName), sumsText);
writeFileSync(path.join(outDir, notesName), notesText);

console.log(`
${practice ? 'Practice release' : 'Release'} files for ScribeForge ${version}, in ${outDir}:
  ${installerName}   (publish this)
  ${sumsName}   (publish this)
  ${notesName}   (the release's description)

The app's own files came out the same on two builds.`);
if (practice) console.log('\nThis was a practice run: the repository wasn\'t checked and the tests weren\'t run. Don\'t publish these files.');
else
  console.log(`
Nothing has been published. To publish, see docs/Releasing.md. With GitHub's command-line tool:
  gh release create v${version} "${installer}" "${path.join(outDir, sumsName)}" --title "ScribeForge ${version}" --notes-file "${path.join(outDir, notesName)}"`);
