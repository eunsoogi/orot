import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeRuntimeTestImports } from '../runtime-test-imports.mjs';

/** Keep symlink fixtures isolated from the repository's runtime source tree. */
function withWorkspace(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orot-symbolic-imports-'));
  try {
    for (const directory of ['apps/mobile/src', 'apps/mobile/e2e', 'packages'])
      mkdirSync(path.join(root, directory), { recursive: true });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

test('symbolic runtime sources and test candidates fail closed', () => {
  withWorkspace((root) => {
    const candidate = 'apps/mobile/src/feature/__tests__/feature.test.ts';
    write(root, candidate, 'export const feature = true;');
    mkdirSync(path.join(root, 'runtime-sources'));
    write(root, 'runtime-sources/consumer.ts', "import '../feature/__tests__/feature.test';");
    symlinkSync(
      path.join(root, 'runtime-sources'),
      path.join(root, 'apps/mobile/src/linked'),
      'dir',
    );

    const linkedSource = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(linkedSource.status, 'unknown');
    assert.equal(linkedSource.reason, 'source-read-or-parse-failed');

    const linkedCandidate = 'apps/mobile/src/feature/__tests__/linked.test.ts';
    symlinkSync(path.join(root, candidate), path.join(root, linkedCandidate), 'file');
    const candidateResult = analyzeRuntimeTestImports([linkedCandidate], { root });
    assert.equal(candidateResult.status, 'unknown');
    assert.equal(candidateResult.reason, 'candidate-not-regular-file');
  });
});

test('symbolic workspace ancestors of runtime sources fail closed', () => {
  withWorkspace((root) => {
    const mobileRoot = path.join(root, 'mobile-runtime');
    const candidate = 'packages/feature/src/__tests__/feature.test.ts';
    mkdirSync(path.join(root, 'packages/feature/src/__tests__'), { recursive: true });
    mkdirSync(path.join(mobileRoot, 'src/feature'), { recursive: true });
    mkdirSync(path.join(mobileRoot, 'e2e'), { recursive: true });
    write(root, candidate, 'export {};');
    writeFileSync(
      path.join(mobileRoot, 'src/feature/consumer.ts'),
      "import '../../../packages/feature/src/__tests__/feature.test';",
    );
    rmSync(path.join(root, 'apps/mobile'), { recursive: true, force: true });
    symlinkSync(mobileRoot, path.join(root, 'apps/mobile'), 'dir');

    const result = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'source-read-or-parse-failed');
  });
});
