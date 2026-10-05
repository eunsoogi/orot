import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import type { HealthKitSampleSnapshot } from '../src/healthkit/types';
import { mapHealthKitSleepSample } from '../src/healthkit/sleep/mapper';
import { summarizeSleepByDay } from '../src/healthkit/sleep/summary';
import type {
  HealthKitSleepSampleSnapshot,
  SleepDeviceMetadata,
} from '../src/healthkit/sleep/types';

interface SleepProbeNative {
  prepareSyntheticFixture(feature: 'sleep'): Promise<void>;
  removeSyntheticFixture(): Promise<void>;
  inspectReadAuthorizationPlan(feature: 'sleep'): Promise<{
    availability: 'available' | 'unsupportedFeature';
    readTypeIdentifiers: readonly string[];
    writeTypeIdentifiers: readonly string[];
  }>;
}

type SleepBridgeMetadata = {
  readonly sourceVersion?: string | null;
  readonly sourceProductType?: string | null;
  readonly device?: SleepDeviceMetadata | null;
  readonly timeZone?: string | null;
};

const native = NativeModules.HealthKitModule as SleepProbeNative;
const healthKit = createHealthKitClient(NativeModules.HealthKitModule, 'ios');
const startDate = '2026-10-01T23:30:00.000Z';
const endDate = '2026-10-02T00:30:00.000Z';

export function SleepImportProbe() {
  const [result, setResult] = useState(
    'Sleep import Simulator probe running; source=synthetic',
  );

  useEffect(() => {
    runProbe().then(setResult, (error: unknown) => {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error('Sleep import Simulator probe failed:', error);
      setResult('Sleep import Simulator probe failed: ' + detail);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" testID="sleep-import-probe-result">
        {result}
      </Text>
    </View>
  );
}

async function runProbe(): Promise<string> {
  let fixtureInstalled = false;
  try {
    // Availability reads the real store; sleep samples come only from the Debug Simulator adapter.
    const availability = await healthKit.getAvailability();
    const plan = await native.inspectReadAuthorizationPlan('sleep');
    if (
      plan.availability === 'available' &&
      (plan.writeTypeIdentifiers.length !== 0 ||
        [...plan.readTypeIdentifiers].sort().join(',') !==
          'HKCategoryTypeIdentifierSleepAnalysis')
    ) {
      throw new Error('Sleep authorization requested an unexpected type set.');
    }

    await native.prepareSyntheticFixture('sleep');
    fixtureInstalled = true;
    const authorization = await healthKit.requestReadAuthorization('sleep');
    if (authorization.readAuthorization !== 'notObservable') {
      throw new Error(
        'HealthKit read authorization was reported as observable.',
      );
    }
    if (
      authorization.availability === 'available'
        ? authorization.requestStatus !== 'completed'
        : authorization.requestStatus !== 'notRequested'
    ) {
      throw new Error('The sleep authorization result was inconsistent.');
    }

    const result = await healthKit.querySamples({
      feature: 'sleep',
      sampleKind: 'sleep',
      startDate,
      endDate,
      limit: 25,
    });
    if (
      result.availability !== 'available' ||
      result.status !== 'completed' ||
      result.samples.length !== 1
    ) {
      throw new Error(
        'The synthetic sleep sample did not cross the native boundary.',
      );
    }
    const raw = result.samples[0];
    if (
      raw?.typeIdentifier !== 'HKCategoryTypeIdentifierSleepAnalysis' ||
      typeof raw.categoryValue !== 'number'
    ) {
      throw new Error('The sleep sample category or type is invalid.');
    }

    // Verify the sleep-specific anchored bridge and resume cursor without reading HealthKit storage.
    const changes = await healthKit.querySampleChanges({
      feature: 'sleep',
      sampleKind: 'sleep',
      limit: 25,
      cursor: null,
    });
    if (
      changes.availability !== 'available' ||
      changes.status !== 'completed' ||
      changes.addedSamples.length !== 1 ||
      changes.addedSamples[0]?.id !== 'synthetic-sleep' ||
      changes.addedSamples[0]?.categoryValue !== 1 ||
      changes.addedSamples[0]?.sourceIdentifier !==
        'com.orot.healthkit.synthetic' ||
      changes.hasMore ||
      typeof changes.cursor !== 'string'
    ) {
      throw new Error(
        'The anchored sleep sample change did not cross the native boundary.',
      );
    }
    const resumedChanges = await healthKit.querySampleChanges({
      feature: 'sleep',
      sampleKind: 'sleep',
      limit: 25,
      cursor: changes.cursor,
    });
    if (
      resumedChanges.status !== 'completed' ||
      resumedChanges.addedSamples.length !== 0 ||
      resumedChanges.deletedSampleIds.length !== 0 ||
      resumedChanges.cursor !== changes.cursor
    ) {
      throw new Error(
        'The sleep change cursor did not resume deterministically.',
      );
    }

    const bridge = raw as HealthKitSampleSnapshot & SleepBridgeMetadata;
    const input: HealthKitSleepSampleSnapshot = {
      id: raw.id,
      typeIdentifier: raw.typeIdentifier,
      startDate: raw.startDate,
      endDate: raw.endDate,
      categoryValue: raw.categoryValue,
      sourceIdentifier: raw.sourceIdentifier,
      sourceName: raw.sourceName,
      ...(bridge.sourceVersion === undefined
        ? {}
        : { sourceVersion: bridge.sourceVersion }),
      ...(bridge.sourceProductType === undefined
        ? {}
        : { sourceProductType: bridge.sourceProductType }),
      ...(bridge.device === undefined ? {} : { device: bridge.device }),
      ...(bridge.timeZone === undefined ? {} : { timeZone: bridge.timeZone }),
    };
    const observation = mapHealthKitSleepSample(input);
    if (
      observation.id !== raw.id ||
      observation.stage !== 'asleepUnspecified' ||
      observation.source.identifier !== raw.sourceIdentifier ||
      observation.source.name !== raw.sourceName
    ) {
      throw new Error(
        'Sleep normalization lost category or source provenance.',
      );
    }

    const summaries = summarizeSleepByDay([observation], {
      fromDay: '2026-10-01',
      throughDay: '2026-10-03',
      timeZone: 'UTC',
    });
    if (
      summaries[0]?.asleepDurationMs !== 30 * 60 * 1000 ||
      summaries[1]?.asleepDurationMs !== 30 * 60 * 1000 ||
      summaries[2]?.status !== 'noData'
    ) {
      throw new Error(
        'Sleep summaries did not split at midnight or preserve no-data.',
      );
    }

    const deviceState = !Object.prototype.hasOwnProperty.call(
      observation,
      'device',
    )
      ? 'omitted'
      : observation.device === null
        ? 'absent'
        : 'present';
    return (
      'availability=' +
      availability.status +
      '; sleepAuthorization=' +
      authorization.requestStatus +
      '; readAuthorization=notObservable; stage=asleepUnspecified; midnightSplit=passed; noData=preserved; anchorResume=passed; device=' +
      deviceState +
      '; source=synthetic; realSamples=unverified'
    );
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});
