import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const { getFixturePaths, removeSnapshot, restoreFixtureFiles, snapshotFixtureFiles } =
  createRequire(import.meta.url)('../../../apps/mobile/e2e/backupContainerSnapshot.js');

test('snapshot cleanup refuses directories not created by its snapshot operation', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-backup-unowned-fixture-'));
  const marker = join(root, 'preserved.txt');
  writeFileSync(marker, 'synthetic unrelated data');
  try {
    assert.throws(() => removeSnapshot(root), /owned snapshot/);
    assert.ok(existsSync(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retains every present SQLite sidecar and the exact recording while excluding unrelated and temporary files', () => {
  const source = mkdtempSync(join(tmpdir(), 'orot-backup-source-fixture-'));
  const target = mkdtempSync(join(tmpdir(), 'orot-backup-restore-fixture-'));
  const id = '11111111-2222-4333-8444-555555555555';
  const paths = getFixturePaths(id, 'm4a');
  let snapshot;
  try {
    for (const path of [...paths, 'tmp/share.m4a', 'Library/unrelated.db']) {
      const file = join(source, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'synthetic bytes for ' + path);
    }
    snapshot = snapshotFixtureFiles(source, id);
    assert.deepEqual(snapshot.copiedPaths, paths);
    assert.equal(existsSync(join(snapshot.snapshotRoot, 'tmp/share.m4a')), false);
    assert.equal(existsSync(join(snapshot.snapshotRoot, 'Library/unrelated.db')), false);
    assert.deepEqual(restoreFixtureFiles(snapshot.snapshotRoot, target, id).restoredPaths, paths);
    for (const path of paths)
      assert.deepEqual(readFileSync(join(target, path)), readFileSync(join(source, path)));
    assert.throws(
      () => restoreFixtureFiles(snapshot.snapshotRoot, target, id),
      /fresh app data container/,
    );
    assert.throws(() => getFixturePaths('../foreign'), /UUID/);
    assert.throws(() => getFixturePaths(id, 'wav'), /unsupported/);
    removeSnapshot(snapshot.snapshotRoot);
    assert.equal(existsSync(snapshot.snapshotRoot), false);
    assert.throws(() => removeSnapshot(snapshot.snapshotRoot), /owned snapshot/);
    snapshot = null;
  } finally {
    if (snapshot) removeSnapshot(snapshot.snapshotRoot);
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
