import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { readEvidenceCandidates } from '../evidenceCandidates';

test('loads only the selected dose’s exact medication dependency even when registration predates the selected window', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const provenance = { origin: 'imported' as const, sourceRecordIds: [] };
    const reviewState = { status: 'unreviewed' as const };
    for (const id of ['linked-medication', 'unrelated-medication']) {
      await repository.put('medication_definition', {
        id,
        ingestedAt: '2026-10-01T00:00:00Z',
        provenance,
        reviewState,
        medicationConceptIdentifier: id,
        displayText: '합성 약',
        generalForm: 'tablet',
        isArchived: false,
        hasSchedule: true,
      });
    }
    // IDs are table-local. An unrelated older symptom with the same ID is not a dose dependency.
    await repository.put('symptom_entry', {
      status: 'active',
      id: 'linked-medication',
      effectiveAt: '2026-10-01T00:00:00Z',
      recordedAt: '2026-10-01T00:00:00Z',
      ingestedAt: '2026-10-01T00:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState,
      description: '관계없는 합성 증상',
    });
    await repository.put('dose_event', {
      id: 'selected-dose',
      effectiveAt: '2026-10-20T00:00:00Z',
      ingestedAt: '2026-10-20T01:00:00Z',
      provenance,
      reviewState,
      eventKind: 'observed',
      medicationDefinitionId: 'linked-medication',
      observationStatus: 'taken',
      dose: { amount: 1, unit: '정' },
    });
    const result = await readEvidenceCandidates(database, '', undefined, {
      timeRange: {
        fromInclusive: '2026-10-20T00:00:00Z',
        toExclusive: '2026-10-21T00:00:00Z',
      },
    });
    expect(result.candidates.map(entry => entry.record.id)).toEqual([
      'selected-dose',
    ]);
    expect(
      result.dependencies.map(entry => [entry.kind, entry.record.id]),
    ).toEqual([['medication_definition', 'linked-medication']]);
  } finally {
    close();
  }
});

test('resolves typed and shared provenance dependencies in one bounded native read', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const ingestedAt = '2026-10-01T00:00:00Z';
    const provenance = { origin: 'imported' as const, sourceRecordIds: [] };
    const reviewState = { status: 'unreviewed' as const };
    for (const id of ['shared', 'typed-only']) {
      await repository.put('medication_definition', {
        id,
        ingestedAt,
        provenance,
        reviewState,
        medicationConceptIdentifier: id,
        displayText: 'Synthetic medicine',
        generalForm: 'tablet',
        isArchived: false,
        hasSchedule: true,
      });
      await repository.put('symptom_entry', {
        id,
        ingestedAt,
        reviewState,
        effectiveAt: ingestedAt,
        recordedAt: ingestedAt,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        status: 'active',
        description: 'Synthetic symptom',
      });
    }
    await repository.put('dose_event', {
      id: 'selected-dose',
      effectiveAt: '2026-10-20T00:00:00Z',
      ingestedAt: '2026-10-20T00:00:00Z',
      provenance: { ...provenance, sourceRecordIds: ['shared'] },
      reviewState,
      eventKind: 'observed',
      medicationDefinitionId: 'typed-only',
      observationStatus: 'taken',
      dose: { amount: 1, unit: 'tablet' },
    });
    let dependencyQueries = 0;
    const result = await readEvidenceCandidates(
      {
        ...database,
        transaction: work =>
          database.transaction(tx =>
            work({
              ...tx,
              execute: (sql, args) => {
                if (
                  sql.startsWith('SELECT') &&
                  /WHERE (?:r\.)?id IN \(/.test(sql)
                )
                  dependencyQueries++;
                return tx.execute(sql, args);
              },
            }),
          ),
      },
      '',
      undefined,
      {
        timeRange: {
          fromInclusive: '2026-10-20T00:00:00Z',
          toExclusive: '2026-10-21T00:00:00Z',
        },
      },
    );
    expect(
      result.dependencies.map(item => [item.kind, item.record.id]).sort(),
    ).toEqual([
      ['medication_definition', 'shared'],
      ['medication_definition', 'typed-only'],
      ['symptom_entry', 'shared'],
    ]);
    expect(dependencyQueries).toBe(1);
  } finally {
    close();
  }
});
