const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getFixturePaths,
  removeSnapshot,
  restoreFixtureFiles,
  snapshotFixtureFiles,
} = require('../../../e2e/backupContainerSnapshot.js');

const recordingId = 'b3f4c10a-210d-4716-a003-39bb67c0c1c3';

describe('backup container snapshot fixtures', () => {
  let fixtureRoot;
  let sourceRoot;
  let targetRoot;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orot-backup-test-'));
    sourceRoot = path.join(fixtureRoot, 'source');
    targetRoot = path.join(fixtureRoot, 'target');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('copies only the synthetic database, SQLite sidecars, and permanent recording', () => {
    for (const relativePath of getFixturePaths(recordingId)) {
      const file = path.join(sourceRoot, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relativePath);
    }
    const cache = path.join(sourceRoot, 'Library/Caches/transcription.txt');
    const temporary = path.join(sourceRoot, 'tmp/share.txt');
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    fs.writeFileSync(cache, 'temporary transcription');
    fs.writeFileSync(temporary, 'temporary share');

    const snapshot = snapshotFixtureFiles(sourceRoot, recordingId, {
      snapshotRoot: path.join(fixtureRoot, 'snapshot'),
    });
    const restored = restoreFixtureFiles(
      snapshot.snapshotRoot,
      targetRoot,
      recordingId,
    );

    expect(snapshot.copiedPaths).toEqual(getFixturePaths(recordingId));
    expect(restored.restoredPaths).toEqual(getFixturePaths(recordingId));
    expect(fs.existsSync(path.join(targetRoot, 'Library/Caches'))).toBe(false);
    expect(fs.existsSync(path.join(targetRoot, 'tmp'))).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          targetRoot,
          'Library/Application Support/Recordings',
          `${recordingId}.m4a`,
        ),
      ),
    ).toBe(true);
  });

  test('rejects unsafe IDs, formats, and nonempty restore targets', () => {
    expect(() => getFixturePaths('../orot-secure.db')).toThrow(
      'A UUID recording ID is required',
    );
    expect(() => getFixturePaths(recordingId, 'txt')).toThrow(
      'recording format is unsupported',
    );
    for (const relativePath of getFixturePaths(recordingId)) {
      const file = path.join(sourceRoot, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relativePath);
    }
    fs.mkdirSync(path.join(targetRoot, 'Library'), { recursive: true });
    fs.writeFileSync(
      path.join(targetRoot, 'Library/orot-secure.db'),
      'existing',
    );
    expect(() =>
      restoreFixtureFiles(sourceRoot, targetRoot, recordingId),
    ).toThrow('restore target must be a fresh app data container');

    fs.rmSync(path.join(targetRoot, 'Library/orot-secure.db'));
    fs.rmSync(path.join(targetRoot, 'Library'), {
      recursive: true,
      force: true,
    });
    fs.mkdirSync(path.join(targetRoot, 'Library'), { recursive: true });
    fs.writeFileSync(
      path.join(targetRoot, 'Library/orot-secure.db-wal'),
      'orphan',
    );
    expect(() =>
      restoreFixtureFiles(sourceRoot, targetRoot, recordingId),
    ).toThrow('restore target must be a fresh app data container');
  });

  test('detects and restores a CAF recording without broadening the file allowlist', () => {
    fs.mkdirSync(path.join(sourceRoot, 'Library'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, 'Library/orot-secure.db'),
      'database',
    );
    const recording = path.join(
      sourceRoot,
      'Library/Application Support/Recordings',
      `${recordingId}.caf`,
    );
    fs.mkdirSync(path.dirname(recording), { recursive: true });
    fs.writeFileSync(recording, 'audio');

    const snapshot = snapshotFixtureFiles(sourceRoot, recordingId, {
      snapshotRoot: path.join(fixtureRoot, 'caf-snapshot'),
    });
    const restored = restoreFixtureFiles(
      snapshot.snapshotRoot,
      targetRoot,
      recordingId,
    );

    expect(snapshot.extension).toBe('caf');
    expect(snapshot.copiedPaths).toEqual([
      'Library/orot-secure.db',
      `Library/Application Support/Recordings/${recordingId}.caf`,
    ]);
    expect(restored.extension).toBe('caf');
    expect(fs.existsSync(recording.replace(sourceRoot, targetRoot))).toBe(true);
  });

  test('removes an owned temporary snapshot directory', () => {
    for (const relativePath of getFixturePaths(recordingId)) {
      const file = path.join(sourceRoot, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relativePath);
    }
    const snapshot = snapshotFixtureFiles(sourceRoot, recordingId);

    expect(fs.existsSync(snapshot.snapshotRoot)).toBe(true);
    removeSnapshot(snapshot.snapshotRoot);
    expect(fs.existsSync(snapshot.snapshotRoot)).toBe(false);
  });
});
