const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundleIdentifier = 'com.orot.mobile';
// Keep SQLite sidecars paired with the database; temporary transcription/share paths stay out.
const databasePaths = [
  'Library/orot-secure.db',
  'Library/orot-secure.db-wal',
  'Library/orot-secure.db-shm',
  'Library/orot-secure.db-journal',
];

function normalizedRecordingId(recordingId) {
  if (
    typeof recordingId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      recordingId,
    )
  ) {
    throw new Error('A UUID recording ID is required for the backup fixture.');
  }
  return recordingId.toLowerCase();
}

function getFixturePaths(recordingId, extension = 'm4a') {
  const normalizedId = normalizedRecordingId(recordingId);
  if (!['m4a', 'caf'].includes(extension)) {
    throw new Error('The backup fixture recording format is unsupported.');
  }
  return [
    ...databasePaths,
    `Library/Application Support/Recordings/${normalizedId}.${extension}`,
  ];
}

function getAppDataContainer(deviceId, appBundleIdentifier = bundleIdentifier) {
  if (typeof deviceId !== 'string' || !/^[0-9A-Fa-f-]{36}$/.test(deviceId)) {
    throw new Error(
      'A dedicated Simulator ID is required for the snapshot probe.',
    );
  }
  const result = execFileSync(
    'xcrun',
    ['simctl', 'get_app_container', deviceId, appBundleIdentifier, 'data'],
    { encoding: 'utf8' },
  ).trim();
  if (!path.isAbsolute(result)) {
    throw new Error('Simulator did not return an absolute app data container.');
  }
  return result;
}

function copyFixtureFiles(sourceRoot, targetRoot, recordingId, extension) {
  const normalizedId = normalizedRecordingId(recordingId);
  const recordingExtension =
    extension ??
    ['m4a', 'caf'].find(candidate =>
      fs.existsSync(
        path.join(
          sourceRoot,
          'Library/Application Support/Recordings',
          `${normalizedId}.${candidate}`,
        ),
      ),
    );
  if (!recordingExtension) {
    throw new Error('The synthetic permanent recording file must exist.');
  }
  const allowedPaths = getFixturePaths(normalizedId, recordingExtension);
  const databasePath = path.join(sourceRoot, databasePaths[0]);
  const recordingPath = path.join(
    sourceRoot,
    allowedPaths[allowedPaths.length - 1],
  );
  if (!fs.existsSync(databasePath) || !fs.existsSync(recordingPath)) {
    throw new Error(
      'The synthetic database and recording fixture must both exist.',
    );
  }

  const targetContainsBackupData = [
    ...databasePaths,
    ...['m4a', 'caf'].map(
      candidate =>
        `Library/Application Support/Recordings/${normalizedId}.${candidate}`,
    ),
  ].some(relativePath => fs.existsSync(path.join(targetRoot, relativePath)));
  if (targetContainsBackupData) {
    throw new Error('The restore target must be a fresh app data container.');
  }

  const copiedPaths = [];
  for (const relativePath of allowedPaths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    copiedPaths.push(relativePath);
  }

  return { copiedPaths, extension: recordingExtension };
}

function snapshotFixtureFiles(sourceRoot, recordingId, options = {}) {
  const ownsSnapshotRoot = options.snapshotRoot === undefined;
  const snapshotRoot =
    options.snapshotRoot ??
    fs.mkdtempSync(path.join(os.tmpdir(), 'orot-backup-fixture-'));
  try {
    const { copiedPaths, extension } = copyFixtureFiles(
      sourceRoot,
      snapshotRoot,
      recordingId,
      options.extension,
    );
    return { snapshotRoot, copiedPaths, extension, ownsSnapshotRoot };
  } catch (error) {
    if (ownsSnapshotRoot)
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function restoreFixtureFiles(
  snapshotRoot,
  targetRoot,
  recordingId,
  options = {},
) {
  const { copiedPaths, extension } = copyFixtureFiles(
    snapshotRoot,
    targetRoot,
    recordingId,
    options.extension,
  );
  return { restoredPaths: copiedPaths, extension };
}

function removeSnapshot(snapshotRoot) {
  fs.rmSync(snapshotRoot, { recursive: true, force: true });
}

function snapshotInstalledApp(deviceId, recordingId, options = {}) {
  const sourceRoot = getAppDataContainer(deviceId, options.bundleIdentifier);
  return {
    sourceRoot,
    ...snapshotFixtureFiles(sourceRoot, recordingId, options),
  };
}

function restoreInstalledApp(
  deviceId,
  snapshotRoot,
  recordingId,
  options = {},
) {
  const targetRoot = getAppDataContainer(deviceId, options.bundleIdentifier);
  return {
    targetRoot,
    ...restoreFixtureFiles(snapshotRoot, targetRoot, recordingId, options),
  };
}

module.exports = {
  copyFixtureFiles,
  getAppDataContainer,
  getFixturePaths,
  removeSnapshot,
  restoreFixtureFiles,
  restoreInstalledApp,
  snapshotFixtureFiles,
  snapshotInstalledApp,
};
