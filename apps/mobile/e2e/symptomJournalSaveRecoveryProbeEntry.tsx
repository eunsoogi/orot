import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry, NativeModules } from 'react-native';
import {
  SymptomEntrySchema,
  editSymptomEntry,
  filterSymptomEntries,
  resolveSymptomEntry,
} from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';

/** Exercises the production route with a memory-only repository and one failed create and resolution attempt. */
export function createRecoveryRepository(
  seedEdit = false,
): SymptomJournalRepository {
  // Only the opted-in edit journey starts with a valid synthetic entry; recovery cases remain empty.
  const entries: SymptomEntry[] = seedEdit
    ? [
        SymptomEntrySchema.parse({
          id: 'keyboard-seed',
          effectiveAt: '2025-04-02T00:30:00.000Z',
          recordedAt: '2025-04-02T00:30:00.000Z',
          ingestedAt: '2025-04-02T00:30:00.000Z',
          provenance: { origin: 'user_reported', sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' },
          description: '아픔',
          severity: 2,
          status: 'active',
        }),
      ]
    : [];
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
    async update(id, changes) {
      if (!seedEdit)
        throw new Error('This symptom recovery probe does not edit entries.');
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const updated = editSymptomEntry(entries[index]!, changes);
      entries[index] = updated;
      return updated;
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
  const settings =
    NativeModules.SettingsManager?.settings ??
    NativeModules.SettingsManager?.getConstants?.().settings ??
    {};
  return (
    <App
      loadSymptoms={async () =>
        createRecoveryRepository(settings.OROT_SYMPTOM_EDIT_FIXTURE === 'YES')
      }
    />
  );
}

AppRegistry.registerComponent(
  appName,
  () => SymptomJournalSaveRecoveryProbeEntry,
);
