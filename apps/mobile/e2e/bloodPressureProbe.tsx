import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleQuery,
  HealthKitSampleSnapshot,
} from '../src/healthkit/types';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { bloodPressureSampleTypeIdentifiers as typeIds } from '../src/healthkit/bloodPressure/types';

interface BloodPressureProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
}

const native = NativeModules.HealthKitModule as BloodPressureProbeModule;
const healthKit = createHealthKitClient(native, 'ios');
const measurementWindow = {
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-10-03T00:00:00.000Z',
};

export function BloodPressureProbe() {
  const [result, setResult] = useState(
    'Blood-pressure Simulator probe running; production values are withheld',
  );

  useEffect(() => {
    runProbe().then(setResult, (error: unknown) => {
      // Native framework errors are withheld to keep production HealthKit details out of artifacts.
      console.error(
        'Blood-pressure Simulator probe failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      setResult('Blood-pressure Simulator probe failed; details are withheld');
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" testID="blood-pressure-probe-result">
        {result}
      </Text>
    </View>
  );
}

async function runProbe(): Promise<string> {
  let fixtureInstalled = false;
  try {
    const availability = await healthKit.getAvailability();

    // This probe uses synthetic samples; real-store reads belong to the user-consented import flow.
    const fixture = await native.prepareSyntheticFixture('bloodPressure');
    fixtureInstalled = true;
    if (fixture.mode !== 'synthetic')
      throw new Error('The HealthKit fixture mode is invalid.');

    const authorization =
      await healthKit.requestReadAuthorization('bloodPressure');
    if (
      authorization.availability !== 'available' ||
      authorization.requestStatus !== 'completed' ||
      authorization.readAuthorization !== 'notObservable'
    ) {
      throw new Error(
        'The synthetic blood-pressure authorization boundary is invalid.',
      );
    }

    const result = await healthKit.querySamples(query());
    if (
      result.availability !== 'available' ||
      result.status !== 'completed' ||
      result.readAuthorization !== 'notObservable' ||
      result.samples.length !== 1
    ) {
      throw new Error(
        'The synthetic blood-pressure correlation did not cross the native bridge.',
      );
    }

    const correlation = result.samples[0];
    if (
      correlation?.typeIdentifier !== typeIds.correlation ||
      correlation.sourceIdentifier !== 'com.orot.healthkit.synthetic'
    ) {
      throw new Error(
        'The synthetic blood-pressure source was not identified.',
      );
    }

    const mapped = mapBloodPressureCorrelation(
      asSyntheticCorrelation(correlation),
    );
    if (
      mapped.systolic?.normalizedValue !== 120 ||
      mapped.diastolic?.normalizedValue !== 80 ||
      mapped.provenance.sourceSampleId !== correlation.id
    ) {
      throw new Error(
        'The synthetic systolic/diastolic mapping did not match its fixture.',
      );
    }

    return (
      `healthStoreAvailability=${availability.status}; productionQuery=notRun; ` +
      'productionSamples=unverified; productionValues=withheld; syntheticCorrelation=passed; ' +
      'systolicDiastolicMapping=passed; ' +
      'syntheticReadAuthorization=notObservable; healthStoreWrites=none'
    );
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

function asSyntheticCorrelation(
  sample: HealthKitSampleSnapshot,
): Parameters<typeof mapBloodPressureCorrelation>[0] {
  return {
    ...sample,
    components: (sample.components ?? []).map(component => ({
      ...component,
      originalValue: component.value ?? Number.NaN,
      originalUnit: component.unit ?? '',
    })),
  };
}

function query(): HealthKitSampleQuery {
  return {
    feature: 'bloodPressure',
    sampleKind: 'bloodPressure',
    ...measurementWindow,
    limit: 25,
  };
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
