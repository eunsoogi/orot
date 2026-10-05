import { useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import App from '../App';
import { runCommonObservationsStorageProbe } from '../src/healthkit/commonObservations/e2eProbe';
import type { CommonObservationFeature } from '../src/healthkit/commonObservations/types';

const native = NativeModules.HealthKitModule as Parameters<
  typeof runCommonObservationsStorageProbe
>[0];

/** Uses the production App route and production storage with a non-persistent Simulator fixture. */
export function CommonObservationsProbe() {
  const [summary, setSummary] = useState(
    'probe=ready; storage=encrypted-local',
  );

  async function importSelected(
    selectedFeatures: readonly CommonObservationFeature[],
  ) {
    setSummary('probe=running; storage=encrypted-local');
    try {
      const outcome = await runCommonObservationsStorageProbe(
        native,
        selectedFeatures,
      );
      setSummary(outcome.summary);
      return outcome.result;
    } catch (error) {
      setSummary('probe=failed; storage=encrypted-local');
      console.error('COMMON_OBSERVATIONS_SIMULATOR_FAILURE');
      throw error;
    }
  }

  return (
    <View style={styles.container}>
      <App importHealthObservations={importSelected} />
      <Text
        accessibilityLiveRegion="polite"
        style={styles.summary}
        testID="common-observations-probe-summary"
      >
        {summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  summary: {
    position: 'absolute',
    bottom: 1,
    left: 4,
    right: 4,
    fontSize: 9,
  },
});
