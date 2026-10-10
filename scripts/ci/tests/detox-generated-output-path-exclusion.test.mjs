import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashCurrentInputs } from '../detox-cache-inputs.mjs';
import { listChangedDetoxBuildInputs } from '../detox-cache-fingerprint.mjs';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('excludes large generated iOS build trees before buffering Git input paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-generated-inputs-'));
  try {
    const sourcePath = join(root, 'apps/mobile/ios/Podfile.lock');
    const generatedDirectory = join(root, 'apps/mobile/ios/build-detox-release');
    const generatedFileCount = 5000;
    const trackedGeneratedPaths = [];
    mkdirSync(join(root, 'apps/mobile/ios'), { recursive: true });
    mkdirSync(generatedDirectory, { recursive: true });
    writeFileSync(sourcePath, 'source input');
    for (let index = 0; index < generatedFileCount; index += 1) {
      const fileName = `tracked-${String(index).padStart(4, '0')}-${'x'.repeat(220)}`;
      const generatedPath = join(generatedDirectory, fileName);
      writeFileSync(generatedPath, 'generated output');
      trackedGeneratedPaths.push(generatedPath);
    }
    git(root, 'init', '-q');
    git(root, 'add', '--all');
    git(
      root,
      '-c',
      'user.name=Orot Test',
      '-c',
      'user.email=orot-test@example.invalid',
      'commit',
      '-q',
      '-m',
      'fixture',
    );
    for (const generatedPath of trackedGeneratedPaths) {
      writeFileSync(generatedPath, 'updated generated output');
    }

    // Both Git path lists exceed Node's default buffer if generated paths reach it before filtering.
    for (let index = 0; index < generatedFileCount; index += 1) {
      const fileName = `${String(index).padStart(4, '0')}-${'x'.repeat(220)}`;
      writeFileSync(join(generatedDirectory, fileName), '');
    }

    assert.equal(hashCurrentInputs(root, ['apps/mobile/ios']).count, 1);
    assert.deepEqual(listChangedDetoxBuildInputs(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
