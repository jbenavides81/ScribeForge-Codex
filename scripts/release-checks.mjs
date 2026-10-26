// The checks and the words of a release (stop 4c, docs/Plan_Phase4.md section 6), apart from the
// script that runs them (scripts/release.mjs), so the tests can check every one.

/** The changelog's section for a version (without its heading), or null if there isn't one. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, '\\.')}( |$)`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return body || null;
}

/**
 * Why a release can't be made now, in plain words; empty when it can.
 * `state`: the version, uncommitted changes (git status lines), the branch, the version tags
 * that exist (here and on GitHub), the changelog, and whether the notices are up to date.
 */
export function refusals({ version, changes, branch, tags, changelog, noticesFresh }) {
  const out = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) out.push(`The version in package.json (${version}) isn't three numbers, such as 1.10.0.`);
  if (changes.length) out.push(`There are changes that aren't committed (${changes.length === 1 ? '1 file' : `${changes.length} files`}). Commit them first, so the release is exactly what's in the repository.`);
  if (branch !== 'main') out.push(`This is the "${branch}" branch. Releases are made from main.`);
  if (tags.includes(`v${version}`)) out.push(`Version ${version} is already released (it has a v${version} tag). Change the version in package.json first.`);
  if (!changelogSection(changelog, version)) out.push(`CHANGELOG.md has no section for ${version}. Add "## ${version} (date)" with what's new.`);
  if (!noticesFresh) out.push('THIRD-PARTY-NOTICES.md is out of date. Run "npm run notices" and commit it.');
  return out;
}

/** A checksum file, in the usual layout (`sha256sum` and PowerShell's Get-FileHash both read it): the checksum, two spaces, the file. */
export function checksumFile(entries) {
  return entries.map((e) => `${e.sha256}  ${e.name}\n`).join('');
}

/** The release notes: what's new (from the changelog), installing, and checking the download. */
export function releaseNotes(version, section, sums) {
  const installer = sums.find((s) => s.name.endsWith('.exe') && s.name.startsWith('ScribeForge Setup'));
  const app = sums.filter((s) => s !== installer);
  return `# ScribeForge ${version}

${section}

## Installing

Download **${installer.name}** and run it. The installer isn't signed, so Windows shows "Windows protected your PC" the first time: click **More info**, then **Run anyway**. Choose **Only for me** to install without administrator rights.

ScribeForge never checks for new versions itself. New releases appear on this page.

## Checking your download

In PowerShell, in the folder you downloaded it to:

\`\`\`
Get-FileHash ".\\${installer.name}"
\`\`\`

The Hash should be:

\`\`\`
${installer.sha256.toUpperCase()}
\`\`\`

The same checksums are in **ScribeForge ${version} SHA256SUMS.txt**, with these for the app's own files, in the folder ScribeForge is installed in:

| File | SHA-256 |
|---|---|
${app.map((s) => `| \`${s.name}\` | \`${s.sha256}\` |`).join('\n')}

These two files come out the same every time this version is built, so they can also be checked against a build made from this version's source code (\`npm ci\`, then \`npm run pack\`; they're in \`release\\win-unpacked\`).
`;
}

/**
 * Personal details that must never go into a release's files: a path inside someone's user
 * folder, an email address, or the name of the person making the release. Returns what was found.
 */
export function personalDetails(text, userName) {
  const found = [];
  const folder = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`|]+/i.exec(text);
  if (folder) found.push(`a path in a user folder (${folder[0]})`);
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) found.push('an email address');
  if (userName && userName.length > 2 && text.toLowerCase().includes(userName.toLowerCase())) found.push(`the user name "${userName}"`);
  return found;
}

/** Files a build leaves for automatic updates, which ScribeForge doesn't have; none may be published. */
export const isUpdateFile = (name) => name === 'latest.yml' || name.endsWith('.blockmap');
