import { openEncryptedStorage } from '../src';
import { createManualHistoryRepository } from '../src/manualHistory';
import { runMigrations } from '../src/migrations';
import { createDatabase, createOptions, recordedAt } from './manualHistoryTestSupport';

describe('manual history repository', () => {
  it('stores unknown dates explicitly and returns user-reported RAG evidence', async () => {
    const database = createDatabase();
    const records = await openEncryptedStorage(createOptions(database));
    const entry = await records.manualHistory.create({
      kind: 'note',
      title: 'Synthetic unknown-date entry',
      details: 'Synthetic details for storage tests.',
      effectiveDate: { status: 'unknown' },
    });

    expect(await records.manualHistory.get(entry.id)).toEqual(entry);
    expect(
      await database.execute(
        'SELECT effective_date, date_known FROM manual_history_entries WHERE id = ?',
        [entry.id],
      ),
    ).toEqual({ rows: [{ effective_date: null, date_known: 0 }] });
    expect(
      await records.manualHistory.list({
        kind: 'note',
        dateStatus: 'unknown',
        search: 'synthetic',
      }),
    ).toEqual([entry]);
    expect(await records.manualHistory.getEvidence(entry.id)).toMatchObject({
      sourceEntryId: entry.id,
      kind: 'note',
      text: 'Synthetic unknown-date entry\nSynthetic details for storage tests.',
      effectiveDate: { status: 'unknown' },
      provenance: { origin: 'user_reported' },
      reviewState: { status: 'unreviewed' },
    });
    await database.closeAsync?.();
  });

  it('appends corrections while current queries and evidence exclude superseded versions', async () => {
    const database = createDatabase();
    const records = await openEncryptedStorage(createOptions(database));
    const original = await records.manualHistory.create({
      kind: 'diagnosis_history',
      title: 'Synthetic history',
      details: 'Earlier synthetic details.',
      effectiveDate: { status: 'known', date: '2020-01-20' },
    });
    const procedure = await records.manualHistory.create({
      kind: 'procedure',
      title: 'Synthetic procedure',
      details: 'Synthetic procedure details.',
      effectiveDate: { status: 'known', date: '2021-03-04' },
    });
    const corrected = await records.manualHistory.correct(original.id, {
      kind: 'diagnosis_history',
      title: 'Current synthetic history',
      details: 'Corrected synthetic details.',
      effectiveDate: original.effectiveDate,
      correctionNote: 'Corrected the details.',
    });

    expect(corrected.supersedesId).toBe(original.id);
    expect(corrected.correctionNote).toBe('Corrected the details.');
    expect(await records.manualHistory.history(corrected.id)).toEqual([original, corrected]);
    await expect(
      records.manualHistory.correct(original.id, {
        kind: 'diagnosis_history',
        title: 'Stale synthetic correction',
        details: 'This must not create a second successor.',
        effectiveDate: original.effectiveDate,
      }),
    ).rejects.toThrow('Only the current manual history entry can be corrected.');
    expect(await records.manualHistory.list({ kind: 'diagnosis_history' })).toEqual([corrected]);
    expect(
      await records.manualHistory.list({
        kind: 'diagnosis_history',
        effectiveDateFrom: '2020-01-01',
        effectiveDateThrough: '2020-12-31',
      }),
    ).toEqual([corrected]);
    expect(await records.manualHistory.list({ kind: 'diagnosis_history', limit: 1 })).toEqual([
      corrected,
    ]);
    const allVersions = await records.manualHistory.list({ includeSuperseded: true });
    expect(allVersions).toHaveLength(3);
    expect(allVersions).toEqual(expect.arrayContaining([procedure, original, corrected]));
    expect(await records.manualHistory.getEvidence(original.id)).toBeNull();
    expect(
      await records.manualHistory.listEvidence({ search: 'current synthetic history' }),
    ).toMatchObject([
      {
        sourceEntryId: corrected.id,
        text: 'Current synthetic history\nCorrected synthetic details.',
        correctionNote: 'Corrected the details.',
      },
    ]);
    await database.closeAsync?.();
  });

  it('rolls back a correction that cannot be appended and preserves its prior history', async () => {
    const database = createDatabase();
    await runMigrations(database);
    const ids = ['synthetic-original', 'synthetic-collision', 'synthetic-collision'];
    const manualHistory = createManualHistoryRepository(database, {
      clock: () => recordedAt,
      createId: () => ids.shift() ?? 'synthetic-fallback',
    });
    const original = await manualHistory.create({
      kind: 'note',
      title: 'Synthetic original',
      details: 'Original synthetic details.',
      effectiveDate: { status: 'unknown' },
    });
    const collision = await manualHistory.create({
      kind: 'note',
      title: 'Synthetic collision',
      details: 'Existing synthetic entry with the correction ID.',
      effectiveDate: { status: 'unknown' },
    });

    await expect(
      manualHistory.correct(original.id, {
        kind: 'note',
        title: 'Failed synthetic correction',
        details: 'This append collides with an existing ID.',
        effectiveDate: { status: 'unknown' },
      }),
    ).rejects.toThrow();
    expect(await manualHistory.history(original.id)).toEqual([original]);
    const entries = await manualHistory.list({ includeSuperseded: true });
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(expect.arrayContaining([original, collision]));
    await database.closeAsync?.();
  });
});
