/* global by, device, element, expect, waitFor, describe, it */

describe('unified HealthKit and Calendar import on iOS Simulator', () => {
  it('batches selected HealthKit types before the Calendar query and local import', async () => {
    // Synthetic mode is deterministic; live mode pauses here for the actual Simulator system consent screens.
    const mode =
      process.env.OROT_UNIFIED_IMPORT_PROBE_MODE === 'live'
        ? 'live'
        : 'synthetic';
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_UNIFIED_IMPORT_PROBE: mode },
    });

    const probe = element(by.id('unified-import-probe-status'));
    const sheetStatus = mode === 'live' ? 'not-captured' : 'not-observed';
    await waitFor(probe)
      .toHaveText(`probe=ready;source=${mode};systemSheets=${sheetStatus}`)
      .withTimeout(120000);
    const syntheticSelection = [
      'medications',
      'bloodPressure',
      'sleep',
      'heartRate',
      'steps',
      'bodyMass',
    ];
    const selected =
      mode === 'live' ? ['heartRate', 'steps'] : syntheticSelection;
    for (const feature of selected) {
      await element(by.id(`unified-import-toggle-${feature}`)).tap();
    }
    await element(by.id('unified-import-toggle-calendar')).tap();
    await element(by.id('unified-import-start')).tap();

    const status = element(by.id('unified-import-status'));
    if (mode === 'live') {
      console.log('UNIFIED_IMPORT_LIVE_WAIT_FOR_SYSTEM_CONSENT');
      await waitFor(status)
        .toHaveText(/^(complete|empty|partial|failed|cancelled)$/u)
        .withTimeout(600000);
      const liveSummary = await element(
        by.id('unified-import-probe-measurements'),
      ).getAttributes();
      const liveText = liveSummary.label || liveSummary.text;
      expect(liveText).toMatch(
        /healthKitAuthorizationCalls=1;healthKitAuthorizationStartOffsetMs=\d+;healthKitAuthorizationFinishedOffsetMs=\d+;eventKitRequestCalls=1;eventKitRequestOffsetMs=\d+;eventKitAuthorizationFinishedOffsetMs=\d+;/u,
      );
      console.log(`UNIFIED_IMPORT_LIVE_MEASUREMENTS ${liveText}`);
      return;
    }

    await waitFor(status)
      .toHaveText(/^(complete|empty)$/u)
      .withTimeout(240000);
    for (const feature of syntheticSelection) {
      await expect(
        element(by.id(`unified-import-toggle-${feature}`)),
      ).toHaveText(/complete|empty/u);
    }
    await expect(element(by.id('unified-import-toggle-calendar'))).toHaveText(
      /empty/u,
    );

    const summary = element(by.id('unified-import-probe-measurements'));
    await expect(summary).toHaveText(
      /healthKitAuthorizationCalls=1;healthKitAuthorizationStartOffsetMs=\d+;healthKitAuthorizationFinishedOffsetMs=\d+;eventKitRequestCalls=1;eventKitRequestOffsetMs=\d+;eventKitAuthorizationFinishedOffsetMs=\d+;healthKitQueryCalls=\d+;eventKitQueryCalls=\d+;firstQueryOffsetMs=\d+;localStoreOperations=\d+;healthKitAuthorizationMs=\d+;eventKitAuthorizationMs=\d+;eventKitQueryMs=\d+;localStoreMs=\d+/u,
    );
  });
});
