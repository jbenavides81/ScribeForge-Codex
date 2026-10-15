// Removes the throwaway data folders that whole-app test runs create in the Windows temp folder.
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export default function cleanup(): void {
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith('scribeforge-e2e-')) {
      rmSync(path.join(tmpdir(), name), { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
