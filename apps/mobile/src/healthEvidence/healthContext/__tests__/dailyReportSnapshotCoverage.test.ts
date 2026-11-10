import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createLocalEvidenceData } from '../../localEvidenceData';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';

test('applies source authorization, day overlap, ingestion cutoff, and bounded coverage', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createDailyReportStorage(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid fixture');
    await store.lookup(calendar.context.identity);
    const repository = createRecordRepository(connection.database);
    const base = {
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      observationKind: 'measurement' as const,
      concept: 'heart_rate',
      value: { kind: 'quantity' as const, amount: 72, unit: 'count/min' },
    };
    const put = (id: string, extra: object) =>
      repository.put(
        'health_observation',
        HealthObservationSchema.parse({
          ...base,
          id,
          effectiveAt: '2035-01-01T01:00:00Z',
          ...extra,
        }),
      );
    await put('sleep', {
      effectiveAt: '2034-12-31T23:30:00Z',
      endedAt: '2035-01-01T01:00:00Z',
      concept: 'sleep',
      value: { kind: 'text', text: 'asleepCore' },
    });
    await put('future', { effectiveAt: '2035-01-01T12:00:00Z' });
    await put('late', { ingestedAt: '2035-01-01T12:01:00Z' });
    await put('other', {});
    const scoped = await createLocalEvidenceData(connection.database)
      .readDailyReportSnapshot!(calendar.context, {
      sourceIds: ['sleep', 'future', 'late'],
    });
    expect(
      scoped.sourceSnapshot.records.map(record => record.recordId),
    ).toEqual(['sleep']);
    expect(scoped.sourceSnapshot.records[0]?.occurrence).toEqual({
      startInclusive: '2034-12-31T23:30:00Z',
      endExclusive: '2035-01-01T01:00:00Z',
    });
    expect(scoped.values[0]).toMatchObject({
      record: { value: { text: 'asleepCore' } },
    });
    await expect(
      readDailyReportSnapshot(
        connection.database,
        { ...calendar.context, effectiveCutoff: '2035-01-02T00:00:00Z' },
        {},
      ),
    ).rejects.toThrow('Invalid daily report calendar window');
    await put('oversized', { concept: 'x'.repeat(17000) });
    const oversized = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      { sourceIds: ['oversized'] },
    );
    expect(oversized.values).toHaveLength(0);
    expect(
      oversized.sourceSnapshot.coverage.find(
        item => item.source === 'health_observation',
      )?.status,
    ).toBe('partial');
    for (let index = 0; index < 5; index++)
      await put(`large-${index}`, { concept: 'x'.repeat(15000) });
    const large = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      {
        sourceIds: Array.from({ length: 5 }, (_, index) => `large-${index}`),
      },
    );
    expect(large.values.length).toBeGreaterThan(0);
    expect(large.values.length).toBeLessThan(5);
    expect(
      large.sourceSnapshot.coverage.find(
        item => item.source === 'health_observation',
      )?.status,
    ).toBe('partial');
    for (let index = 0; index < 101; index++)
      await put(`bounded-${String(index).padStart(3, '0')}`, {});
    const bounded = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      {},
    );
    expect(
      bounded.sourceSnapshot.coverage.find(
        item => item.source === 'health_observation',
      ),
    ).toMatchObject({
      status: 'partial',
      limitationCodes: expect.arrayContaining(['snapshot_incomplete']),
    });
    expect(bounded.sourceSnapshot.records.length).toBe(100);
  } finally {
    connection.close();
  }
});

test('retains symptom and dose event values without presenting an unlinked catalog name', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid fixture');
    const repo = createRecordRepository(connection.database);
    const metadata = {
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await repo.put('symptom_entry', {
      ...metadata,
      id: 'symptom',
      description: 'Synthetic symptom',
      status: 'active',
      severity: 3,
    });
    await repo.put('medication_assertion', {
      ...metadata,
      id: 'catalog',
      effectiveAt: '2034-12-01T01:00:00Z',
      assertionKind: 'prescribed',
      medicationName: 'Synthetic medicine',
    });
    await repo.put('dose_event', {
      ...metadata,
      id: 'dose',
      eventKind: 'taken',
      medicationAssertionId: 'catalog',
      dose: { amount: 2, unit: 'tablet' },
    });
    const snapshot = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      {},
    );
    expect(snapshot.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'symptom_entry',
          record: expect.objectContaining({
            description: 'Synthetic symptom',
            severity: 3,
          }),
        }),
        expect.objectContaining({
          kind: 'dose_event',
          record: expect.objectContaining({
            eventKind: 'taken',
            dose: { amount: 2, unit: 'tablet' },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(snapshot.values)).not.toContain('Synthetic medicine');
    expect(snapshot.lineage.map(item => item.localId).sort()).toEqual([
      'dose',
      'symptom',
    ]);
    expect(
      snapshot.sourceSnapshot.coverage.find(
        item => item.source === 'dose_event',
      )?.limitationCodes,
    ).toContain('medication_names_not_resolved');
  } finally {
    connection.close();
  }
});
