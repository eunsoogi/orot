import type { HealthKitAutoSyncFeature } from '../src/healthkit/autoSyncCheckpoint';
import { HealthKitFixtureApp } from './HealthKitFixtureApp';

// The health-import UI journey checks medication refresh alongside the BP library.
const healthImportFeatures: readonly HealthKitAutoSyncFeature[] = [
  'bloodPressure',
  'medications',
];

/** Starts the production app only after the non-persistent Simulator fixture is ready. */
export function BloodPressureProbe() {
  return <HealthKitFixtureApp features={healthImportFeatures} />;
}
