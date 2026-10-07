/* global afterEach, beforeEach, by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  removeSnapshot,
  restoreInstalledApp,
  snapshotInstalledApp,
} = require('./backupContainerSnapshot.js');
const {
  createStorageResetGuard,
  installFreshApp,
} = require('./storageProbeResetGuard.e2e.js');
const resetGuard = createStorageResetGuard();

beforeEach(() => resetGuard.assertResetMayContinue());
afterEach(() => resetGuard.afterTest());

async function readProbeResult(mode, timeout = 120000) {
  await waitFor(element(by.id(`backup-probe-${mode}-success`)))
    .toBeVisible()
    .withTimeout(timeout);
  const attributes = await element(
    by.id('backup-probe-result'),
  ).getAttributes();
  return JSON.parse(attributes.label || attributes.text);
}

async function launchProbe(mode, newInstance = false, launchArgs = {}) {
  await device.launchApp({
    newInstance,
    launchArgs: { OROT_BACKUP_PROBE: mode, ...launchArgs },
  });
}

describe('native backup eligibility probe on an isolated Simulator', () => {
  it('preserves key and memory tombstones across process restart', async () => {
    // Synthetic Keychain and app data are seeded only on the assigned probe Simulator.
    await installFreshApp(device, resetGuard);
    await launchProbe('seed');
    await readProbeResult('seed', 90000);
    await device.terminateApp();
    await launchProbe('recover', true);
    const result = await readProbeResult('recover');
    jestExpect(result).toMatchObject({
      evidenceScope: 'synthetic-simulator-process-restart',
      keyMigration: 'migrated',
      keyPreserved: true,
      keyEligible: true,
      storageRelationsReopened: true,
      agentMemoryTombstonePreserved: true,
    });
    jestExpect(result.recording.excludedFromBackup).toBe(false);
    jestExpect(['complete', 'unverified', 'not-complete']).toContain(
      result.recording.fileProtection,
    );
    jestExpect(['ready', 'simulator-protection-unverified']).toContain(
      result.recording.strictPreparation,
    );
    jestExpect(result.recording.sourcePersisted).toBe(
      result.recording.fileProtection === 'complete',
    );
  }, 240000);

  it('prepares a legacy excluded recording and preserves the strict source gate', async () => {
    await installFreshApp(device, resetGuard);
    await launchProbe('legacy-recording');
    const result = await readProbeResult('legacy-recording', 90000);
    jestExpect(result.recording).toMatchObject({
      legacyExcludedBefore: true,
      excludedFromBackup: false,
      fileReadable: true,
    });
    if (result.recording.fileProtection === 'complete') {
      jestExpect(result.recording).toMatchObject({
        strictPreparation: 'ready',
        preparationReady: true,
        preparedCount: 1,
        preparationError: 'none',
        sourcePersisted: true,
        transcriptLinked: true,
      });
    } else {
      // Missing or non-complete Simulator metadata remains a measured fail-closed result.
      jestExpect(['unverified', 'not-complete']).toContain(
        result.recording.fileProtection,
      );
      jestExpect(result.recording).toMatchObject({
        strictPreparation: 'not-ready',
        preparationReady: false,
        sourcePersisted: false,
        transcriptLinked: false,
      });
      jestExpect(result.recording.preparationError).not.toBe('none');
    }
  }, 180000);

  it('rolls back a failed key migration and retries after process restart', async () => {
    await installFreshApp(device, resetGuard);
    await launchProbe('rollback');
    const result = await readProbeResult('rollback', 120000);
    jestExpect(result).toMatchObject({
      evidenceScope: 'synthetic-simulator-process-restart',
      keyPreserved: true,
      keyEligible: false,
      rollbackVerified: true,
      keyAccessibility: 'this-device-only',
    });

    await device.terminateApp();
    await launchProbe('rollback-recover', true);
    const recovered = await readProbeResult('rollback-recover', 120000);
    jestExpect(recovered).toMatchObject({
      keyMigration: 'migrated',
      keyPreserved: true,
      keyEligible: true,
      storageRelationsReopened: true,
    });
  }, 240000);

  it('reopens recording relationships from a restored app-container snapshot', async () => {
    const simulatorId = process.env.OROT_BACKUP_SIMULATOR_UDID;
    jestExpect(simulatorId).toMatch(/^[0-9A-Fa-f-]{36}$/);
    await installFreshApp(device, resetGuard);
    await launchProbe('snapshot-seed');
    const seeded = await readProbeResult('snapshot-seed', 120000);
    const recordingId = seeded.recording.recordingId;
    jestExpect(recordingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    jestExpect(seeded).toMatchObject({
      evidenceScope: 'synthetic-simulator-app-container-snapshot',
      keyEligible: true,
    });
    jestExpect(seeded.recording).toMatchObject({
      sourcePersisted: true,
      transcriptLinked: true,
      fileReadable: true,
      excludedFromBackup: false,
    });

    let snapshotRoot;
    try {
      await device.terminateApp();
      const snapshot = snapshotInstalledApp(simulatorId, recordingId);
      snapshotRoot = snapshot.snapshotRoot;
      jestExpect(snapshot.copiedPaths).toContain('Library/orot-secure.db');
      jestExpect(
        snapshot.copiedPaths.some(path =>
          path.includes(`/Recordings/${recordingId}.`),
        ),
      ).toBe(true);

      // App uninstall removes its container; Keychain remains a separate restore boundary.
      await device.uninstallApp();
      await device.installApp();
      const restored = restoreInstalledApp(
        simulatorId,
        snapshotRoot,
        recordingId,
      );
      jestExpect(restored.restoredPaths).toContain('Library/orot-secure.db');
      jestExpect(
        restored.restoredPaths.some(path =>
          path.includes(`/Recordings/${recordingId}.`),
        ),
      ).toBe(true);

      await launchProbe('snapshot-recover', true, {
        OROT_BACKUP_PROBE_RECORDING_ID: recordingId,
      });
      const recovered = await readProbeResult('snapshot-recover', 120000);
      jestExpect(recovered).toMatchObject({
        evidenceScope: 'synthetic-simulator-app-container-snapshot',
        keyPreserved: true,
        keyEligible: true,
        storageRelationsReopened: true,
        agentMemoryTombstonePreserved: true,
      });
      jestExpect(recovered.recording).toMatchObject({
        recordingId,
        sourcePersisted: true,
        transcriptLinked: true,
        fileReadable: true,
        excludedFromBackup: false,
        sourceFixture: 'pre-existing-synthetic-snapshot-record',
      });
    } finally {
      if (snapshotRoot) removeSnapshot(snapshotRoot);
    }
  }, 240000);
});
