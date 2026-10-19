import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../src/healthkit/autoSyncCheckpoint';
import App from '../App';

interface SimulatorHealthKitFixtureModule {
  prepareSyntheticFixtures(
    features: readonly HealthKitAutoSyncFeature[],
  ): Promise<{ readonly mode: string }>;
  removeSyntheticFixture(): Promise<void>;
}

const healthKitFixture =
  NativeModules.HealthKitModule as SimulatorHealthKitFixtureModule;

/** Primes only the in-memory Simulator fixture before App's startup auto-sync begins. */
export function HealthKitFixtureApp({
  features,
}: {
  readonly features: readonly HealthKitAutoSyncFeature[];
}) {
  const [status, setStatus] = useState<'preparing' | 'ready' | 'failed'>(
    'preparing',
  );

  useEffect(() => {
    let active = true;
    let prepared = false;
    void healthKitFixture
      .prepareSyntheticFixtures([...features])
      .then(async result => {
        if (result.mode !== 'synthetic') {
          throw new Error('The Simulator fixture was not synthetic.');
        }
        prepared = true;
        if (active) setStatus('ready');
        else await healthKitFixture.removeSyntheticFixture();
      })
      .catch(() => active && setStatus('failed'));

    return () => {
      active = false;
      if (prepared)
        void healthKitFixture.removeSyntheticFixture().catch(() => undefined);
    };
  }, [features]);

  return (
    <View style={styles.container}>
      {status === 'ready' ? (
        <App />
      ) : (
        <Text accessibilityRole="alert" testID="healthkit-fixture-status">
          {status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
