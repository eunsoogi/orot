import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { correlation } from '../src/healthkit/bloodPressure/testSupport';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from '../src/healthkit/bloodPressure/types';

const ingestedAt = '2026-10-07T00:00:00.000Z';
const sourceName = 'Synthetic Safe Area fixture';
const sourceIdentifier = 'com.example.orot.safe-area-fixture';

// A long deterministic list forces the real App route to exercise its own scroller.
const observations: readonly BloodPressureObservation[] = Array.from(
  { length: 12 },
  (_, index) => {
    const snapshot = correlation(`safe-area-blood-pressure-${index}`);
    return mapBloodPressureCorrelation(
      {
        ...snapshot,
        sourceName,
        sourceIdentifier,
        components: snapshot.components?.map(component => ({
          ...component,
          sourceName,
          sourceIdentifier,
        })),
      },
      ingestedAt,
    ).observations;
  },
).flat();

const emptySyncResult: BloodPressureSyncResult = {
  status: 'completed',
  readAuthorization: 'notObservable',
  upserted: 0,
  deleted: 0,
  cursorAdvanced: false,
};

async function loadSyntheticObservations() {
  return observations;
}

async function completeEmptySyntheticImport() {
  return emptySyncResult;
}

function SafeAreaBloodPressureProbeEntry() {
  // Injected callbacks keep the geometry probe independent of HealthKit and app storage.
  return (
    <App
      importBloodPressure={completeEmptySyntheticImport}
      loadBloodPressureObservations={loadSyntheticObservations}
    />
  );
}

AppRegistry.registerComponent(appName, () => SafeAreaBloodPressureProbeEntry);
