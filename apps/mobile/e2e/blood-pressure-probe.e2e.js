/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('Blood-pressure import on a dedicated iOS Simulator', () => {
  it('persists a synthetic correlation in SQLCipher and reads it after app restart', async () => {
    const metroPort = process.env.OROT_BLOOD_PRESSURE_METRO_PORT || '8218';
    const launchArgs = { RCT_jsLocation: `localhost:${metroPort}` };
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: false,
      launchArgs,
    });

    // The Debug React Native loop stays awake while SQLCipher performs the import.
    await device.disableSynchronization();
    const result = element(by.id('blood-pressure-probe-result'));
    await waitFor(result)
      .toHaveText(
        /^(?:healthStoreAvailability=available; productionQuery=notRun; productionSamples=unverified; productionValues=withheld; syntheticChanges=completed; syntheticCorrelation=passed; systolicDiastolicMapping=passed; originalDisplayUnit=unavailable; sqlCipher=available; persistedReadback=passed; sameProcessReplay=passed; syntheticReadAuthorization=notObservable; healthStoreWrites=none|Blood-pressure Simulator probe failed; details are withheld)$/,
      )
      .withTimeout(30000);
    const initialSummary = await readSummary(result);
    assertSummary(initialSummary, 'persistedReadback=passed');
    assertSummary(initialSummary, 'sameProcessReplay=passed');
    console.log('BLOOD_PRESSURE_SQLCIPHER_INITIAL ' + initialSummary);
    await device.takeScreenshot('blood-pressure-sqlcipher-initial');

    // Termination closes the process-owned database connection; relaunch opens the same encrypted file.
    await device.terminateApp();
    await device.launchApp({ newInstance: true, launchArgs });
    await waitFor(result)
      .toHaveText(
        /^(?:healthStoreAvailability=available; productionQuery=notRun; productionSamples=unverified; productionValues=withheld; syntheticChanges=completed; syntheticCorrelation=passed; systolicDiastolicMapping=passed; originalDisplayUnit=unavailable; sqlCipher=available; processReopenReadback=passed; persistedCursor=passed; syntheticReadAuthorization=notObservable; healthStoreWrites=none|Blood-pressure Simulator probe failed; details are withheld)$/,
      )
      .withTimeout(30000);
    const reopenedSummary = await readSummary(result);
    assertSummary(reopenedSummary, 'processReopenReadback=passed');
    assertSummary(reopenedSummary, 'persistedCursor=passed');
    console.log('BLOOD_PRESSURE_SQLCIPHER_REOPENED ' + reopenedSummary);
    await device.takeScreenshot('blood-pressure-sqlcipher-reopened');
  });
});

async function readSummary(result) {
  const attributes = await result.getAttributes();
  const summary = attributes.text ?? attributes.label ?? '';
  jestExpect(attributes.identifier).toBe('blood-pressure-probe-result');
  if (summary.startsWith('Blood-pressure Simulator probe failed'))
    throw new Error(summary);
  jestExpect(summary).toContain('healthStoreAvailability=available;');
  jestExpect(summary).toContain('productionQuery=notRun');
  jestExpect(summary).toContain('productionSamples=unverified');
  jestExpect(summary).toContain('productionValues=withheld');
  jestExpect(summary).toContain('syntheticChanges=completed');
  jestExpect(summary).toContain('syntheticCorrelation=passed');
  jestExpect(summary).toContain('systolicDiastolicMapping=passed');
  jestExpect(summary).toContain('originalDisplayUnit=unavailable');
  jestExpect(summary).toContain('sqlCipher=available');
  jestExpect(summary).toContain('syntheticReadAuthorization=notObservable');
  jestExpect(summary).toContain('healthStoreWrites=none');
  return summary;
}

function assertSummary(summary, expected) {
  jestExpect(summary).toContain(expected);
}
