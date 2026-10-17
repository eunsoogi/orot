import type { HealthKitAutoSyncFeature } from '../src/healthkit/autoSyncCheckpoint';
import { HealthKitFixtureApp } from './HealthKitFixtureApp';

const commonObservationFeatures: readonly HealthKitAutoSyncFeature[] = [
  'heartRate',
  'steps',
  'bodyMass',
];

/** Keeps this capability fixture separate from the production Records navigation. */
export function CommonObservationsProbe() {
  return <HealthKitFixtureApp features={commonObservationFeatures} />;
}
