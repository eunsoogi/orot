import { NativeModules } from 'react-native';
import App from '../App';
import { createHealthKitClient } from '../src/healthkit/client';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
} from '../src/healthkit/types';
import { syncHealthKitBloodPressure } from '../src/healthkit/bloodPressure';
import type { BloodPressureSyncResult } from '../src/healthkit/bloodPressure/types';
import { listLocalBloodPressureObservations } from '../src/healthkit/bloodPressure/importLocal';
import {
  getCipherVersion,
  openLocalStorage,
} from '../src/storage/secureDatabase';

interface BloodPressureProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
}

const native = NativeModules.HealthKitModule as BloodPressureProbeModule;
const healthKit = createHealthKitClient(native, 'ios');

// Detox routes through App so the probe covers the same explicit user action and results screen.
export function BloodPressureProbe() {
  return (
    <App
      importBloodPressure={importSyntheticBloodPressure}
      loadBloodPressureObservations={listLocalBloodPressureObservations}
    />
  );
}

async function importSyntheticBloodPressure(): Promise<BloodPressureSyncResult> {
  let fixtureInstalled = false;
  try {
    const fixture = await native.prepareSyntheticFixture('bloodPressure');
    fixtureInstalled = true;
    if (fixture.mode !== 'synthetic') {
      throw new Error('The Simulator fixture is not synthetic.');
    }
    const repository = await openLocalStorage();
    if (!(await getCipherVersion())) {
      throw new Error('SQLCipher is not active for local storage.');
    }
    const result = await syncHealthKitBloodPressure({
      healthKit,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    if (result.readAuthorization !== 'notObservable') {
      throw new Error('The read-authorization boundary changed.');
    }
    return result;
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}
