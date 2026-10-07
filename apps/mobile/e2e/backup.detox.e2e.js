/* global afterEach, beforeEach, by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  createStorageResetGuard,
  installFreshApp,
} = require('./storageProbeResetGuard.e2e.js');
const resetGuard = createStorageResetGuard();

beforeEach(() => resetGuard.assertResetMayContinue());
afterEach(() => resetGuard.afterTest());

describe('native backup eligibility probe on an isolated Simulator', () => {
  it('preserves key and memory tombstones across process restart', async () => {
    // The test deliberately seeds synthetic Keychain and app data only on its configured Simulator.
    await installFreshApp(device, resetGuard);
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_BACKUP_PROBE: 'seed' },
    });
    await waitFor(element(by.id('backup-probe-seed-success')))
      .toBeVisible()
      .withTimeout(90000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_BACKUP_PROBE: 'recover' },
    });
    await waitFor(element(by.id('backup-probe-recover-success')))
      .toBeVisible()
      .withTimeout(120000);

    const attributes = await element(
      by.id('backup-probe-result'),
    ).getAttributes();
    const result = JSON.parse(attributes.label || attributes.text);
    jestExpect(result).toMatchObject({
      evidenceScope: 'synthetic-simulator-process-restart',
      keyMigration: 'migrated',
      keyPreserved: true,
      keyEligible: true,
      storageRelationsReopened: true,
      agentMemoryTombstonePreserved: true,
    });
    jestExpect(result.recording.excludedFromBackup).toBe(false);
    jestExpect(['complete', 'unverified']).toContain(
      result.recording.fileProtection,
    );
    jestExpect(['ready', 'simulator-protection-unverified']).toContain(
      result.recording.strictPreparation,
    );
    jestExpect(result.recording.sourcePersisted).toBe(
      result.recording.fileProtection === 'complete',
    );
  }, 240000);
});
