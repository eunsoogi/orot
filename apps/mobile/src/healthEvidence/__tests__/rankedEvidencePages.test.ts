import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { readRankedEvidencePage } from '../rankedEvidencePages';

const at = '2026-10-18T00:00:00.000Z';
const observation = (id: string, concept = 'heart_rate') => ({
  id,
  effectiveAt: at,
  ingestedAt: at,
  recordedAt: at,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  observationKind: 'measurement' as const,
  concept,
  value: { kind: 'quantity' as const, amount: 70, unit: 'count/min' },
});

test('ranks an older matching measurement ahead of newer unrelated pages', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (let index = 0; index < 110; index += 1) {
      await repository.put('health_observation', observation(`heart-${index}`));
    }
    await repository.put('health_observation', {
      ...observation('older-pressure', 'blood pressure systolic'),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    const page = await readRankedEvidencePage(
      database,
      'health_observation',
      'blood pressure',
      { limit: 2 },
    );
    expect(page.records).toHaveLength(2);
    expect(page.records[0]?.record.id).toBe('older-pressure');
    expect(page.nextCursor).not.toBeNull();
    expect(page.incomplete).toBe(false);
  } finally {
    close();
  }
});

test('uses a score, time, and ID cursor without skipping equal-ranked records', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await repository.put('health_observation', observation(id));
    }
    const first = await readRankedEvidencePage(
      database,
      'health_observation',
      'heart_rate',
      { limit: 2 },
    );
    const second = await readRankedEvidencePage(
      database,
      'health_observation',
      'heart_rate',
      { limit: 2, cursor: first.nextCursor },
    );
    const third = await readRankedEvidencePage(
      database,
      'health_observation',
      'heart_rate',
      { limit: 2, cursor: second.nextCursor },
    );
    expect(
      [...first.records, ...second.records, ...third.records].map(
        row => row.record.id,
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(third.nextCursor).toBeNull();
  } finally {
    close();
  }
});

test('treats punctuation as data and rejects cancellation before SQL', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    await createRecordRepository(database).put(
      'health_observation',
      observation('safe'),
    );
    const page = await readRankedEvidencePage(
      database,
      'health_observation',
      "O'Brien: (heart_rate) + 'quoted'",
      { limit: 2 },
    );
    expect(page.records).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    const execute = jest.spyOn(database, 'execute');
    await expect(
      readRankedEvidencePage(database, 'health_observation', '', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    close();
  }
});
