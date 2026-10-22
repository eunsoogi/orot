import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthContextReader } from '../src/healthEvidence/healthContext/reader';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import { registerHealthContextEvidence } from '../src/aiFeatures/integration/healthContextEvidence';
import {
  captureSymptomSummarySources,
  restoreSymptomSummary,
} from '../src/aiFeatures/integration/symptomSummarySources';
import { createSymptomSummaryStorage } from '../src/storage/symptomSummaryStorage';
import type { AiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import type { SavedSymptomSummary } from '../src/diseaseHypotheses/savedSummaries';
import {
  contextWindow,
  seedHealthContextNativeRecords,
} from './healthContextNativeFixtures';

/** Exercise computed-source persistence and deletion with an isolated encrypted file, never application records. */
export async function runHealthContextPersistenceTestOperation(
  identifier: unknown,
) {
  if (
    typeof identifier !== 'string' ||
    !/^test-period-summary-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Period persistence requires an isolated UUID');
  if (!isSQLCipher()) throw new Error('Period persistence requires SQLCipher');
  const random = new Uint8Array(32);
  globalThis.crypto.getRandomValues(random);
  const settings = {
    name: identifier + '.db',
    location: IOS_LIBRARY_PATH,
    encryptionKey: Array.from(random, byte =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  };
  let database = open(settings);
  try {
    if (
      !(await database.execute('PRAGMA cipher_version')).rows[0]?.cipher_version
    )
      throw new Error('The period database is not encrypted');
    await runMigrations(database);
    await seedHealthContextNativeRecords(createRecordRepository(database));
    const read = createHealthContextReader(database);
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const item = registerHealthContextEvidence({
      registry,
      read,
      report: await read(contextWindow, ['measurements']),
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window: contextWindow,
      },
    });
    const captured = await captureSymptomSummarySources(
      {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Synthetic period measurements',
            summary: '수축기 혈압 표본은 121–144 mmHg, 체중은 70.5 kg이에요.',
            supportingEvidence: [item],
            contraryEvidence: [],
            missingData: [],
            uncertainty: '',
          },
        ],
      },
      registry,
      signal,
    );
    const saved: SavedSymptomSummary = {
      ...captured,
      id: 'synthetic-period-summary',
      createdAt: '2026-10-05T00:00:00Z',
      modelId: 'synthetic-local',
      providerId: 'synthetic-local',
      modelName: 'Synthetic local summary',
    };
    await createSymptomSummaryStorage(database).append(saved);
    // Reopen the same encrypted file with new adapters; this is not a process-restart claim.
    database.close();
    database = open(settings);
    const storage = createSymptomSummaryStorage(database);
    const reloaded = await storage.read(saved.id);
    if (!reloaded)
      throw new Error('The saved computed source was not restored');
    const fresh = new LocalEvidenceReferenceRegistry();
    const restored = await restoreSymptomSummary(reloaded, fresh, {
      readHealthContext: createHealthContextReader(database),
    } as AiFeatureLocalData);
    const reference = restored.hypotheses[0]!.supportingEvidence[0]!;
    const source = await fresh.readSource(reference, signal);
    const records = createRecordRepository(database);
    await records.delete('health_observation', 'outside-period');
    const unrelatedDeletePreserved = (await storage.read(saved.id)) !== null;
    await records.delete('health_observation', 'bp-1-0');
    return {
      encrypted: true,
      reloaded: true,
      sourceChanged:
        restored.savedSummary?.status === 'saved'
          ? (restored.savedSummary.sourceChanged ?? false)
          : true,
      periodSourceAvailable:
        source.status === 'available' &&
        source.document.sourceKind === 'health_context_period',
      unrelatedDeletePreserved,
      summaryPurged:
        (await storage.read(saved.id)) === null &&
        (await storage.list()).length === 0,
      evidenceInvalidated: !(await fresh.revalidateEvidence(
        [reference],
        signal,
      )),
      periodRowsAfterDeletion: (
        await database.execute(
          'SELECT count(*) AS count FROM symptom_summary_periods',
        )
      ).rows[0]?.count,
      foreignKeys: (await database.execute('PRAGMA foreign_keys')).rows[0]
        ?.foreign_keys,
    };
  } finally {
    database.delete();
  }
}
