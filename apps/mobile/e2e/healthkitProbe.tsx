import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import { healthKitFeatures } from '../src/healthkit/types';
import type {
  HealthKitFeature,
  HealthKitSampleQuery,
} from '../src/healthkit/types';
import {
  assertAuthorizationPlan,
  assertSampleTypeMappings,
  type AuthorizationPlan,
  type HealthKitProbeModule,
} from './healthkitProbeAssertions';

const native = NativeModules.HealthKitModule as HealthKitProbeModule;
const healthKit = createHealthKitClient(native, 'ios');
const range = {
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-10-02T00:00:00.000Z',
};

export function HealthKitProbe() {
  const [result, setResult] = useState(
    'HealthKit Simulator probe running; sample source=synthetic',
  );

  useEffect(() => {
    runProbe().then(setResult, (error: unknown) => {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error('HealthKit Simulator probe failed:', error);
      setResult('HealthKit Simulator probe failed: ' + detail);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" testID="healthkit-probe-result">
        {result}
      </Text>
    </View>
  );
}

async function runProbe(): Promise<string> {
  let fixtureInstalled = false;
  try {
    // This is the real store availability; permission and sample results use fixtures.
    const availability = await healthKit.getAvailability();
    const plans = new Map<HealthKitFeature, AuthorizationPlan>();
    for (const feature of healthKitFeatures) {
      const plan = await native.inspectReadAuthorizationPlan(feature);
      plans.set(feature, plan);
      assertAuthorizationPlan(feature, plan);
    }
    await assertSampleTypeMappings(plans, native);

    await native.prepareSyntheticFixture('steps');
    fixtureInstalled = true;
    const authorization = await healthKit.requestReadAuthorization('steps');
    if (
      authorization.availability !== 'available' ||
      authorization.requestStatus !== 'completed' ||
      authorization.readAuthorization !== 'notObservable'
    ) {
      throw new Error(
        'Synthetic authorization boundary reported an invalid state.',
      );
    }

    const steps = await healthKit.querySamples(query('steps', 'steps'));
    if (
      steps.availability !== 'available' ||
      steps.status !== 'completed' ||
      steps.samples.length !== 1 ||
      steps.samples[0]?.sourceIdentifier !== 'com.orot.healthkit.synthetic'
    ) {
      throw new Error(
        'The synthetic steps fixture did not cross the query boundary.',
      );
    }

    const sleep = await healthKit.querySamples(query('sleep', 'sleep'));
    if (
      sleep.availability !== 'available' ||
      sleep.status !== 'completed' ||
      sleep.samples.length !== 1 ||
      sleep.samples[0]?.typeIdentifier !==
        'HKCategoryTypeIdentifierSleepAnalysis'
    ) {
      throw new Error(
        'A steps request prevented an unrelated synthetic sleep query.',
      );
    }

    const empty = await healthKit.querySamples(query('bodyMass', 'bodyMass'));
    if (
      empty.availability !== 'available' ||
      empty.status !== 'completed' ||
      empty.samples.length !== 0 ||
      empty.readAuthorization !== 'notObservable'
    ) {
      throw new Error('The synthetic empty query was misreported.');
    }
    if ('denied' in empty || 'noData' in empty)
      throw new Error('An empty result was interpreted as denial or absence.');

    const medicationPlan = plans.get('medications');
    let medicationResult = 'unsupportedFeature';
    if (medicationPlan?.availability === 'available') {
      await native.prepareSyntheticFixture('medications');
      const medications = await healthKit.queryMedicationDefinitions(25);
      if (
        medications.availability !== 'available' ||
        medications.status !== 'completed' ||
        medications.medications[0]?.displayText !== 'Synthetic medication'
      ) {
        throw new Error('The synthetic medication-definition query failed.');
      }
      medicationResult = 'supported';
    }

    return `availability=${availability.status}; authorizationPlan=feature-scoped; writeTypes=0; \
syntheticSteps=passed; unrelatedSleep=passed; emptyQuery=completed; medications=${medicationResult}; \
sampleTypes=passed; readAuthorization=notObservable; realSamples=unverified`;
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

function query(
  feature: HealthKitFeature,
  sampleKind: HealthKitSampleQuery['sampleKind'],
): HealthKitSampleQuery {
  return { feature, sampleKind, ...range, limit: 25 };
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
