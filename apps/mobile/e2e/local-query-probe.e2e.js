/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('bounded local record queries on iOS Simulator', () => {
  it('reads synthetic source-linked records from encrypted storage and removes its fixtures', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    // The Release build embeds the probe entry; a Metro override would load the app's default entry.
    await device.launchApp({ newInstance: false });

    const status = element(by.id('local-query-probe-summary'));
    const expectedSummary =
      'healthQueries=5; healthRecords=6; bloodPressure=2; sleep=asleepDeep; dose=not_logged; medication=timeBasis:local_ingest; appointment=confirmed; transcript=source-linked; cipher=available; wrongKey=rejected; cleanup=true';
    // Storage setup and synthetic query execution complete asynchronously after the view appears.
    await waitFor(status)
      .not.toHaveText('probe=ready; storage=encrypted-local')
      .withTimeout(240000);
    const attributes = await status.getAttributes();
    const summary = attributes.label || attributes.text;
    jestExpect(summary).toBe(expectedSummary);
    console.log('LOCAL_QUERY_SIMULATOR ' + summary);
  });
});
