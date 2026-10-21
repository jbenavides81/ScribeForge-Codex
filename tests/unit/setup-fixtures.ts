// Makes the test PDFs once, before any unit test runs (test files run side by side, so making
// them in each file could let one file read a PDF while another is still writing it).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function setup(): void {
  execFileSync(process.execPath, ['scripts/make-fixtures.mjs'], { cwd: path.resolve(import.meta.dirname, '../..'), stdio: 'ignore' });
}
