import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';
import { iosTestConfig } from './ios-test-config.mjs';
import { verifyTestRunContract } from './ios-test-run-contract.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';
import { executeBackupPhases, readBackupAttachment } from './backup-test-phases.mjs';
import { resetIosTestFixtureContainer } from './ios-test-fixture-container.mjs';

const snapshotTools = createRequire(import.meta.url)(
  '../../apps/mobile/e2e/backupContainerSnapshot.js',
);
const [runFile, ownerFile, output] = process.argv.slice(2);
if (!output || !existsSync(runFile) || existsSync(output))
  throw new Error('Backup execution requires products, ownership and new evidence directory');
const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
const directory = resolve(output);
const products = dirname(resolve(runFile));
const app = join(products, 'Release-iphonesimulator/Orot.app');
const spec = iosTestConfig('backup');
const runData = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', runFile], { encoding: 'utf8' }),
);
verifyTestRunContract(runData, spec);
if (!existsSync(app)) throw new Error('Backup Release application product is missing');
function verifyOwner() {
  if (verifyIosTestSimulator(owner, 'backup').state !== 'Booted')
    throw new Error('Backup execution requires its booted dedicated destination');
}
verifyOwner();
mkdirSync(directory, { recursive: true });
let phase = 0;
const observations = [];
const transfer = [];
const started = Date.now();
function digests(root, paths) {
  return Object.fromEntries(
    paths.map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex'),
    ]),
  );
}
const results = await executeBackupPhases({
  reset({ preserveKeychain }) {
    // Independent cases reset the dedicated destination's Keychain, matching the original fresh-install contract.
    // Snapshot reinstall intentionally retains it: file transfer cannot substitute for the separate key restore boundary.
    resetIosTestFixtureContainer('backup', owner, app, { preserveKeychain });
  },
  run(identifier, recordingID) {
    verifyOwner();
    const name = String(++phase).padStart(2, '0');
    const resultBundle = join(directory, name + '.xcresult');
    let selectedRunFile = runFile;
    if (recordingID) {
      // An execution-local copy changes only the synthetic input; portable paths still resolve from the verified product directory.
      selectedRunFile = join(products, '.backup-snapshot-' + owner.udid + '.xctestrun');
      if (existsSync(selectedRunFile)) throw new Error('Backup execution input already exists');
      const data = structuredClone(runData);
      data[spec.uiTarget].EnvironmentVariables.OROT_BACKUP_SNAPSHOT_RECORDING_ID = recordingID;
      verifyTestRunContract(data, spec);
      writeFileSync(selectedRunFile, JSON.stringify(data), { flag: 'wx' });
      execFileSync('plutil', ['-convert', 'xml1', selectedRunFile]);
    }
    // run-command preserves the first failing exit and its complete log. There is no retry or continuation after failure.
    try {
      execFileSync(
        'scripts/ci/run-command.sh',
        [
          'backup-phase-' + name,
          join(directory, name + '.log'),
          '--',
          process.execPath,
          'scripts/ci/run-ios-tests.mjs',
          'backup',
          selectedRunFile,
          ownerFile,
          resultBundle,
          identifier,
        ],
        { stdio: 'inherit' },
      );
    } finally {
      if (recordingID) unlinkSync(selectedRunFile);
    }
    const report = JSON.parse(
      execFileSync(
        'xcrun',
        ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact'],
        { encoding: 'utf8' },
      ),
    );
    observations.push(...verifyIosTestResults(report, [identifier]));
    const attachments = join(directory, name + '-attachments');
    execFileSync('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      resultBundle,
      '--output-path',
      attachments,
    ]);
    const mode =
      phase === 4
        ? 'snapshot-seed'
        : phase === 5
          ? 'snapshot-recover'
          : phase === 1
            ? 'recover'
            : phase === 2
              ? 'legacy-recording'
              : 'rollback-recover';
    return readBackupAttachment(attachments, identifier, mode, owner.udid);
  },
  snapshot(recordingID) {
    verifyOwner();
    const snapshot = snapshotTools.snapshotInstalledApp(owner.udid, recordingID);
    if (!snapshot.copiedPaths.includes('Library/orot-secure.db'))
      throw new Error('Snapshot database missing');
    snapshot.digests = digests(snapshot.snapshotRoot, snapshot.copiedPaths);
    return snapshot;
  },
  restore(snapshot, recordingID) {
    verifyOwner();
    const restored = snapshotTools.restoreInstalledApp(
      owner.udid,
      snapshot.snapshotRoot,
      recordingID,
    );
    if (restored.targetRoot === snapshot.sourceRoot)
      throw new Error('Snapshot restore did not use a reinstalled container');
    const actual = digests(restored.targetRoot, restored.restoredPaths);
    if (JSON.stringify(actual) !== JSON.stringify(snapshot.digests))
      throw new Error('Restored snapshot bytes differ');
    transfer.push({
      copiedPaths: snapshot.copiedPaths,
      restoredPaths: restored.restoredPaths,
      digests: actual,
    });
    writeFileSync(
      join(directory, 'snapshot-transfer.json'),
      JSON.stringify(transfer, null, 2) + '\n',
    );
  },
  cleanup(snapshot) {
    snapshotTools.removeSnapshot(snapshot.snapshotRoot);
  },
});
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    { profile: 'backup', observations, results, transfer, elapsedMs: Date.now() - started },
    null,
    2,
  ) + '\n',
);
console.log(
  `IOS_BACKUP_RESULTS_VERIFIED passed=${observations.length} elapsed_ms=${Date.now() - started}`,
);
