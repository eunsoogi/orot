import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  clearDetoxFrameworkCacheArtifacts,
  inspectDetoxFrameworkCacheArtifacts,
} from '../detox-framework-cache-artifacts.mjs';

function makeCacheRoot() {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-framework-cache-'));
  for (const name of ['framework/Detox.framework/Detox', 'xcuitest-runner/Runner.app/Runner']) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `fixture:${name}`);
  }
  return root;
}

test('fingerprints both Detox framework outputs and rejects altered cache contents', () => {
  const root = makeCacheRoot();

  try {
    const saved = inspectDetoxFrameworkCacheArtifacts(root);
    assert.equal(saved.reason, null);
    assert.deepEqual(Object.keys(saved.artifacts).sort(), ['framework', 'xcuitestRunner']);
    assert.equal(inspectDetoxFrameworkCacheArtifacts(root, saved.artifacts).reason, null);

    writeFileSync(join(root, 'framework/Detox.framework/Detox'), 'changed binary');
    assert.equal(
      inspectDetoxFrameworkCacheArtifacts(root, saved.artifacts).reason,
      'detox_artifact_digest_mismatch',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clears only fixed Detox outputs and never follows an output symlink', () => {
  const root = makeCacheRoot();
  const unrelatedFile = join(root, 'unrelated.txt');
  writeFileSync(unrelatedFile, 'keep');

  try {
    rmSync(join(root, 'framework'), { recursive: true, force: true });
    symlinkSync(unrelatedFile, join(root, 'framework'), 'file');
    clearDetoxFrameworkCacheArtifacts(root);

    assert.equal(existsSync(join(root, 'framework')), false);
    assert.equal(existsSync(join(root, 'xcuitest-runner')), false);
    assert.equal(readFileSync(unrelatedFile, 'utf8'), 'keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for missing, empty, or symlinked Detox outputs', () => {
  const root = makeCacheRoot();

  try {
    assert.equal(
      inspectDetoxFrameworkCacheArtifacts(root, null).reason,
      'detox_artifact_manifest_missing',
    );

    rmSync(join(root, 'xcuitest-runner'), { recursive: true, force: true });
    mkdirSync(join(root, 'xcuitest-runner'), { recursive: true });
    assert.equal(inspectDetoxFrameworkCacheArtifacts(root).reason, 'detox_xcuitest_runner_empty');

    rmSync(join(root, 'framework'), { recursive: true, force: true });
    symlinkSync(join(root, 'outside'), join(root, 'framework'), 'dir');
    assert.equal(inspectDetoxFrameworkCacheArtifacts(root).reason, 'detox_artifact_symlink');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
