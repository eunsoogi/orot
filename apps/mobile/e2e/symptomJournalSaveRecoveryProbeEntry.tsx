import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import {
  SymptomEntrySchema,
  filterSymptomEntries,
  resolveSymptomEntry,
} from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';

/** Exercises the production route with a memory-only repository and one failed create and resolution attempt. */
function createRecoveryRepository(): SymptomJournalRepository {
  const entries: SymptomEntry[] = [];
  let createAttempts = 0;
  let resolveAttempts = 0;

  return {
    list: async filter => filterSymptomEntries(entries, filter),
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
    async resolve(id) {
      resolveAttempts += 1;
      if (resolveAttempts === 1)
        throw new Error('Synthetic symptom resolution failure.');
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const resolved = resolveSymptomEntry(
        entries[index]!,
        new Date().toISOString(),
      );
      entries[index] = resolved;
      return resolved;
    },
  };
}

/** Keeps the app's guarded Records navigation and injects no persistent user data. */
function SymptomJournalSaveRecoveryProbeEntry() {
  return <App loadSymptoms={async () => createRecoveryRepository()} />;
}

AppRegistry.registerComponent(
  appName,
  () => SymptomJournalSaveRecoveryProbeEntry,
);
