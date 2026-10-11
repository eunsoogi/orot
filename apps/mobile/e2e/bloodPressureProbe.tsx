import { useCallback, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import App from '../App';
import { createHealthKitClient } from '../src/healthkit/client';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
} from '../src/healthkit/types';
import { BLOOD_PRESSURE_CHECKPOINT_KEY } from '../src/healthkit/bloodPressure/importChanges';
import { syncHealthKitBloodPressure } from '../src/healthkit/bloodPressure';
import type { BloodPressureSyncResult } from '../src/healthkit/bloodPressure/types';
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
const syntheticCursor = 'bloodPressure:bloodPressure:anchor-v1';

// Detox routes through App so the probe covers the same explicit user action and results screen.
export function BloodPressureProbe() {
  const [storageEvidence, setStorageEvidence] = useState('storage=notRead');
  const [syncEvidence, setSyncEvidence] = useState('sync=notRun');

  const loadObservations = useCallback(async () => {
    const repository = await openLocalStorage();
    const [observations, checkpoint, cipherVersion] = await Promise.all([
      repository.list('health_observation'),
      repository.getSyncCheckpoint(BLOOD_PRESSURE_CHECKPOINT_KEY),
      getCipherVersion(),
    ]);
    // Expose only whether the fixture cursor returned, never a raw HealthKit anchor.
    setStorageEvidence(
      `sqlCipher=${cipherVersion ? 'available' : 'unavailable'}; ` +
        `rows=${observations.filter(item => item.concept.startsWith('blood pressure ')).length}; ` +
        `cursor=${checkpoint?.value === syntheticCursor ? 'fixture-anchor' : 'missing-or-mismatch'}`,
    );
    return observations;
  }, []);

  const importBloodPressure = useCallback(async () => {
    const result = await importSyntheticBloodPressure();
    setSyncEvidence(
      `status=${result.status}; upserted=${result.upserted}; ` +
        `deleted=${result.deleted}; cursorAdvanced=${result.cursorAdvanced}`,
    );
    return result;
  }, []);

  return (
    <View style={styles.root}>
      <App
        importBloodPressure={importBloodPressure}
        loadHealthObservations={loadObservations}
      />
      <View pointerEvents="none" style={styles.evidence}>
        <Text style={styles.evidenceText} testID="blood-pressure-probe-storage">
          {storageEvidence}
        </Text>
        <Text style={styles.evidenceText} testID="blood-pressure-probe-sync">
          {syncEvidence}
        </Text>
      </View>
    </View>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  evidence: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    bottom: 1,
    left: 2,
    position: 'absolute',
    right: 2,
  },
  evidenceText: { color: '#555', fontSize: 8 },
});
