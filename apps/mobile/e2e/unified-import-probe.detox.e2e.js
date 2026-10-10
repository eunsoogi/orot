/* global by, device, element, expect, waitFor, describe, it */

const measurementSummaryPattern = (eventKitQueryCalls = '\\d+') =>
  new RegExp(
    [
      'healthKitAuthorizationCalls=1',
      'healthKitAuthorizationStartOffsetMs=\\d+',
      'healthKitRequestInvocationOffsetMs=\\d+',
      'healthKitAuthorizationFinishedOffsetMs=\\d+',
      'healthKitAuthorizationMs=\\d+',
      'eventKitAuthorizationCalls=1',
      'eventKitAuthorizationStartOffsetMs=\\d+',
      'eventKitRequestInvocationOffsetMs=\\d+',
      'eventKitAuthorizationFinishedOffsetMs=\\d+',
      'eventKitAuthorizationMs=\\d+',
      'healthKitQueryCalls=\\d+',
      'healthKitQueryStartOffsetMs=\\d+',
      'healthKitQueryFinishedOffsetMs=\\d+',
      'healthKitQueryMs=\\d+',
      `eventKitQueryCalls=${eventKitQueryCalls}`,
      'eventKitQueryStartOffsetMs=\\d+',
      'eventKitQueryFinishedOffsetMs=\\d+',
      'eventKitQueryMs=\\d+',
      'healthKitPersistenceOperations=\\d+',
      'healthKitPersistenceStartOffsetMs=\\d+',
      'healthKitPersistenceFinishedOffsetMs=\\d+',
      'healthKitPersistenceMs=\\d+',
      'eventKitPersistenceOperations=\\d+',
      'eventKitPersistenceStartOffsetMs=\\d+',
      'eventKitPersistenceFinishedOffsetMs=\\d+',
      'eventKitPersistenceMs=\\d+',
      'localStorePreparationStartOffsetMs=\\d+',
      'localStorePreparationFinishedOffsetMs=\\d+',
      'localStorePreparationMs=\\d+',
    ].join(';'),
    'u',
  );

const mode =
  process.env.OROT_UNIFIED_IMPORT_PROBE_MODE === 'live'
    ? 'live'
    : process.env.OROT_UNIFIED_IMPORT_PROBE_MODE === 'cancellable'
      ? 'cancellable'
      : 'synthetic';

describe('selected HealthKit and EventKit import on iOS Simulator', () => {
  it('covers consent ordering and the cancellable synthetic retry path', async () => {
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
      mode === 'live'
        ? ['heartRate', 'steps']
        : mode === 'cancellable'
          ? ['heartRate', 'steps']
          : syntheticSelection;
    for (const feature of selected) {
      await element(by.id(`unified-import-toggle-${feature}`)).tap();
    }
    if (mode !== 'cancellable') {
      await element(by.id('unified-import-toggle-eventKit')).tap();
    }
    await element(by.id('unified-import-start')).tap();

    const status = element(by.id('unified-import-status'));
    if (mode === 'cancellable') {
      const cancel = element(by.id('unified-import-cancel'));
      const start = element(by.id('unified-import-start'));
      const cancellationSummary = element(
        by.id('unified-import-probe-cancellation-summary'),
      );

      await waitFor(status).toHaveText('preparingStorage').withTimeout(30000);
      await waitFor(cancel).toExist().withTimeout(10000);
      // The probe wrapper releases its in-memory gate only after run.cancel().
      await cancel.tap();
      await waitFor(status).toHaveText('cancelled').withTimeout(30000);
      for (const feature of selected) {
        await expect(
          element(by.id(`unified-import-feature-status-${feature}`)),
        ).toHaveText('cancelled');
      }
      await expect(cancellationSummary).toHaveText(
        'fakeFeatureRuns=0;queryOperations=0;persistenceOperations=0;syntheticStoredRecords=0',
      );

      // A terminal cancellation releases the coordinator for this same-selection retry.
      await start.tap();
      await waitFor(status).toHaveText('complete').withTimeout(30000);
      for (const feature of selected) {
        await expect(
          element(by.id(`unified-import-feature-status-${feature}`)),
        ).toHaveText('complete');
      }
      await expect(cancellationSummary).toHaveText(
        'fakeFeatureRuns=2;queryOperations=2;persistenceOperations=2;syntheticStoredRecords=2',
      );
      return;
    }

    if (mode === 'live') {
      console.log('UNIFIED_IMPORT_LIVE_WAIT_FOR_SYSTEM_CONSENT');
      await waitFor(status)
        .toHaveText(/^(complete|empty|partial|failed|cancelled)$/u)
        .withTimeout(600000);
      const liveSummary = await element(
        by.id('unified-import-probe-measurements'),
      ).getAttributes();
      const liveText = liveSummary.label || liveSummary.text;
      // Detox replaces global expect with native matcher dispatch for UI elements.
      if (!measurementSummaryPattern().test(liveText)) {
        throw new Error(
          'Live HealthKit and EventKit authorization measurements are missing.',
        );
      }
      console.log(`UNIFIED_IMPORT_LIVE_MEASUREMENTS ${liveText}`);
      return;
    }

    await waitFor(status)
      .toHaveText(/^(complete|empty)$/u)
      .withTimeout(240000);
    for (const feature of syntheticSelection) {
      // The checkbox is an input; each outcome has its own status node.
      await expect(
        element(by.id(`unified-import-feature-status-${feature}`)),
      ).toHaveText(/^(complete|empty)$/u);
    }
    await expect(
      element(by.id('unified-import-eventkit-candidate-0')),
    ).toExist();
    await element(by.id('unified-import-eventkit-select-0')).tap();
    await element(by.id('unified-import-eventkit-confirm')).tap();
    await waitFor(element(by.id('unified-import-eventkit-confirmed')))
      .toExist()
      .withTimeout(30000);
    const summary = element(by.id('unified-import-probe-measurements'));
    await expect(summary).toHaveText(measurementSummaryPattern('1'));
  });
});
