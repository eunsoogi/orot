import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('history marks a saved summary as changed even when a source edit is later reversed', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append({ ...f.saved, inputLineage: 'complete' });
    await f.repository.put('health_observation', {
      ...f.inside,
      value: { kind: 'quantity', amount: 99, unit: 'count/min' },
    });
    await f.repository.put('health_observation', f.inside);
    const persistence = createSymptomSummaryPersistence({
      storage: async () => f.storage,
      data: async () => ({ ...localData([]).data, readHealthContext: f.read }),
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(
      (await persistence.history.read(f.saved.id))?.savedSummary,
    ).toMatchObject({ sourceChanged: true });
  } finally {
    f.close();
  }
});

test('history does not return saved text deleted while its sources are being restored', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append({ ...f.saved, inputLineage: 'complete' });
    const persistence = createSymptomSummaryPersistence({
      storage: async () => f.storage,
      data: async () => ({
        ...localData([]).data,
        async readHealthContext(window, topics) {
          const report = await f.read(window, topics);
          await f.repository.delete('health_observation', 'inside');
          return report;
        },
      }),
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(await persistence.history.read(f.saved.id)).toBeNull();
  } finally {
    f.close();
  }
});

test('a deleted summary ID cannot be recreated while history is restoring', async () => {
  const f = await healthContextFixture();
  try {
    const saved = { ...f.saved, inputLineage: 'complete' as const };
    await f.storage.append(saved);
    const persistence = createSymptomSummaryPersistence({
      storage: async () => f.storage,
      data: async () => ({
        ...localData([]).data,
        async readHealthContext(window, topics) {
          const report = await f.read(window, topics);
          await f.database.execute(
            'DELETE FROM symptom_summary_runs WHERE id = ?',
            [saved.id],
          );
          await expect(f.storage.append(saved)).rejects.toThrow();
          return report;
        },
      }),
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(await persistence.history.read(saved.id)).toBeNull();
  } finally {
    f.close();
  }
});
