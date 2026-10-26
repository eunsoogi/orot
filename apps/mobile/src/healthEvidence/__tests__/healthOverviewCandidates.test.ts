import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { readEvidenceCandidates } from '../evidenceCandidates';

const at = '2026-10-18T00:00:00.000Z';
const metadata = {
  effectiveAt: at,
  ingestedAt: at,
  recordedAt: at,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test('overview selection preserves sparse health concepts despite dense unrelated measurements and query terms', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (let index = 0; index < 40; index += 1) {
      await repository.put('health_observation', {
        ...metadata,
        id: `other-${index}`,
        observationKind: 'measurement',
        concept: `unrelated-${index}`,
        value: { kind: 'quantity', amount: index, unit: 'count' },
      });
    }
    const concepts = [
      'blood pressure systolic',
      'blood pressure diastolic',
      'heart_rate',
      'body_mass',
      'step_count',
      'HKCategoryTypeIdentifierSleepAnalysis',
    ];
    for (const [index, concept] of concepts.entries()) {
      await repository.put('health_observation', {
        ...metadata,
        id: `health-${index}`,
        effectiveAt: '2020-01-01T00:00:00Z',
        observationKind: 'measurement',
        concept,
        value: { kind: 'quantity', amount: 70, unit: 'count' },
      });
    }
    await repository.put('symptom_entry', {
      status: 'active',
      ...metadata,
      id: 'symptom',
      description: 'Synthetic symptom',
    });
    const selected = await readEvidenceCandidates(
      database,
      'unrelated-1 unrelated-2',
      undefined,
      {
        selection: 'health_overview',
      } as never,
    );
    expect(selected.candidates.map(entry => entry.record.id)).toEqual(
      expect.arrayContaining([
        ...concepts.map((_, index) => `health-${index}`),
        'symptom',
      ]),
    );
    expect(selected.candidates.length).toBeLessThanOrEqual(17);
    expect(selected.catalog.totalRecordCount).toBe(47);
    const scoped = await readEvidenceCandidates(database, '', undefined, {
      selection: 'health_overview',
      timeRange: {
        fromInclusive: '2026-01-01T00:00:00Z',
        toExclusive: '2027-01-01T00:00:00Z',
      },
    } as never);
    expect(
      scoped.candidates.some(entry => entry.record.id.startsWith('health-')),
    ).toBe(false);
    expect(scoped.candidates.length).toBeLessThanOrEqual(17);
  } finally {
    close();
  }
});
