import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry, NativeModules } from 'react-native';
import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';
import { SymptomRecoveryObservation } from './SymptomRecoveryObservation';

// This separate test entry bypasses testEntry.tsx, so install its structural sink only on explicit opt-in.
const settingsManager = NativeModules.SettingsManager;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const observeFocus = settings.OROT_TEST_NAVIGATION_OBSERVATION === 'YES';

/** Exercises the production route with a memory-only repository and one failed write. */
function createRecoveryRepository(): SymptomJournalRepository {
  const entries: SymptomEntry[] = [];
  let createAttempts = 0;

  return {
    list: async () => entries.slice(),
    async create(draft) {
      createAttempts += 1;
      if (createAttempts === 1) {
        throw new Error('Synthetic symptom save failure.');
      }

      const now = new Date().toISOString();
      const entry = SymptomEntrySchema.parse({
        id: `save-recovery-${createAttempts}`,
        effectiveAt: draft.onsetAt,
        recordedAt: now,
        ingestedAt: now,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        description: draft.description,
        ...(draft.bodySite ? { bodySite: draft.bodySite } : {}),
        ...(draft.severity === undefined ? {} : { severity: draft.severity }),
        status: draft.status,
        ...(draft.status === 'resolved'
          ? { resolvedAt: draft.resolvedAt }
          : {}),
      });
      entries.push(entry);
      return entry;
    },
    async update() {
      throw new Error('This symptom recovery probe does not edit entries.');
    },
    async resolve() {
      throw new Error('This symptom recovery probe does not resolve entries.');
    },
  };
}

/** Keeps the app's guarded Records navigation and injects no persistent user data. */
function SymptomJournalSaveRecoveryProbeEntry() {
  const app = <App loadSymptoms={async () => createRecoveryRepository()} />;
  return observeFocus ? (
    <SymptomRecoveryObservation>{app}</SymptomRecoveryObservation>
  ) : (
    app
  );
}

AppRegistry.registerComponent(
  appName,
  () => SymptomJournalSaveRecoveryProbeEntry,
);
