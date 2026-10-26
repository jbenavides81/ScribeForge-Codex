// Stop 4b's required checks (docs/Plan_Phase4.md, section 7): every command in the contributing
// guide exists and every link in the guides leads somewhere; the GitHub checks run the typecheck,
// the unit tests and the whole-app tests (the zero-network check among them), safely; the issue
// forms ask what's needed and warn against attaching private PDFs.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/inspect';

/** A file's text, with Windows line endings (as Git checks files out on Windows) made plain. */
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const GUIDES = ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.github/pull_request_template.md', 'README.md', 'CHANGELOG.md', 'docs/Releasing.md'];

/** A heading's anchor, as GitHub makes it. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

describe('the contributing guides', () => {
  it('name only commands that exist', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts as Record<string, string>);
    for (const guide of ['CONTRIBUTING.md', '.github/pull_request_template.md']) {
      const named = [...read(guide).matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
      expect(named.length, guide).toBeGreaterThan(0);
      for (const name of named) expect(scripts, `${guide}: npm run ${name}`).toContain(name);
    }
  });

  it('link only to files, and headings, that exist', () => {
    for (const guide of GUIDES) {
      // Examples in `code` aren't links.
      for (const [, target] of read(guide).replace(/`[^`\n]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [file, anchor] = target.split('#');
        const where = file ? path.join(path.dirname(guide), file) : guide;
        expect(existsSync(path.join(ROOT, where)), `${guide}: ${target}`).toBe(true);
        if (anchor) {
          const headings = [...read(where).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]));
          expect(headings, `${guide}: ${target}`).toContain(anchor);
        }
      }
    }
  });

  it('are linked from where people look: the README and the contributing guide', () => {
    const contributing = read('CONTRIBUTING.md');
    expect(contributing).toContain('(CODE_OF_CONDUCT.md)');
    expect(contributing).toContain('(SECURITY.md)');
    expect(read('README.md')).toContain('(SECURITY.md)');
  });
});

describe('the GitHub checks', () => {
  const workflow = read('.github/workflows/checks.yml');

  it('run the typecheck, the unit tests and the whole-app tests on Windows, from the lock file', () => {
    expect(workflow).toMatch(/runs-on: windows-latest/);
    for (const step of ['npm ci', 'npm run typecheck', 'npm test', 'npm run e2e']) expect(workflow).toContain(`run: ${step}\n`);
    expect(workflow).toContain('run: npm run e2e:packaged');
    // The whole-app tests include the zero-network check.
    expect(read('tests/e2e/app.spec.ts')).toMatch(/no network requests/);
  });

  it('run on every pull request and every push to main', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/m);
  });

  it('run safely: read-only, no credentials kept, never with the target repo\'s rights, and every building block pinned to an exact commit', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow).toContain('persist-credentials: false');
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.map((u) => u.split('@')[0]).sort()).toEqual(['actions/checkout', 'actions/setup-node']);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('the issue forms', () => {
  it('turn off blank issues, and point security problems to the private route', () => {
    const config = read('.github/ISSUE_TEMPLATE/config.yml');
    expect(config).toMatch(/^blank_issues_enabled: false$/m);
    expect(config).toContain('/security/advisories/new');
  });

  it('a problem report asks for the steps, the ScribeForge version and Windows version, and warns against private PDFs', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug_report.yml');
    expect(bug).toMatch(/^name: Report a problem$/m);
    expect(bug).toContain("don't attach private PDFs");
    for (const label of ['What happened', 'Steps to make it happen again', 'ScribeForge version', 'Windows version']) expect(bug).toContain(`label: ${label}`);
    expect(bug.match(/required: true/g)).toHaveLength(4);
  });

  it('an idea says what ScribeForge never does', () => {
    const idea = read('.github/ISSUE_TEMPLATE/feature_request.yml');
    expect(idea).toMatch(/^name: Suggest an idea$/m);
    expect(idea).toContain('it never goes online');
  });

  it('hold no personal paths or email addresses', () => {
    for (const file of [...GUIDES, '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/workflows/checks.yml']) {
      const text = read(file);
      expect(text, file).not.toMatch(/[A-Za-z]:\\Users\\(?!…)[^\\\s`]+/);
      expect(text, file).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
