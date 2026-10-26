import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Give each import-analysis case an isolated workspace and remove it after assertions finish.
export function withWorkspace(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orot-test-imports-'));
  try {
    for (const directory of ['apps/mobile/src', 'apps/mobile/e2e', 'packages'])
      mkdirSync(path.join(root, directory), { recursive: true });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Keep fixtures workspace-relative while creating each required parent directory.
export function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}
