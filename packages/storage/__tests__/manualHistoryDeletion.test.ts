import { openEncryptedStorage } from '../src';
import { createDatabase, createOptions } from './manualHistoryTestSupport';

describe('manual history deletion', () => {
  it('deletes every correction in a lineage and leaves unrelated entries available', async () => {
    const database = createDatabase();
    const records = await openEncryptedStorage(createOptions(database));
    const original = await records.manualHistory.create({
      kind: 'note',
      title: 'Synthetic original history',
      details: 'Earlier synthetic details.',
      effectiveDate: { status: 'unknown' },
    });
    const unrelated = await records.manualHistory.create({
      kind: 'procedure',
      title: 'Synthetic unrelated procedure',
      details: 'Unrelated synthetic details.',
      effectiveDate: { status: 'known', date: '2021-03-04' },
    });
    const firstCorrection = await records.manualHistory.correct(original.id, {
      kind: 'note',
      title: 'Synthetic first correction',
      details: 'First corrected details.',
      effectiveDate: { status: 'unknown' },
    });
    const current = await records.manualHistory.correct(firstCorrection.id, {
      kind: 'note',
      title: 'Synthetic current correction',
      details: 'Latest corrected details.',
      effectiveDate: { status: 'unknown' },
    });

    await expect(records.manualHistory.delete(firstCorrection.id)).resolves.toBe(true);
    await expect(records.manualHistory.delete(firstCorrection.id)).resolves.toBe(false);
    await expect(records.manualHistory.list({ includeSuperseded: true })).resolves.toEqual([
      unrelated,
    ]);
    await expect(records.manualHistory.getEvidence(original.id)).resolves.toBeNull();
    await expect(records.manualHistory.getEvidence(current.id)).resolves.toBeNull();
    await expect(records.manualHistory.history(original.id)).rejects.toThrow(
      'Manual history entry not found.',
    );
    await database.closeAsync?.();
  });
});
