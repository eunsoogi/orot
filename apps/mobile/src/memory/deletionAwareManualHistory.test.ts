import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openLocalStorage } from '../storage/secureDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { buildManualHistoryEvidence } from '../aiFeatures/integration/manualHistoryEvidence';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';

jest.mock('../storage/secureDatabase', () => ({ openLocalStorage: jest.fn() }));

// Real SQLite, current-entry lookup and revision validators; only native database opening is replaced.
test('manual history keeps exact identity, revision and deletion fences', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const repository = createRecordRepository(db.database);
    jest.mocked(openLocalStorage).mockResolvedValue(repository);
    const entry = await repository.manualHistory.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Synthetic uncertain history.',
      effectiveDate: { status: 'unknown' },
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const { items } = buildManualHistoryEvidence({
      candidates: [(await repository.manualHistory.getEvidence(entry.id))!],
      repository: repository.manualHistory,
      registry,
    });
    const signal = new AbortController().signal;
    const validate = () =>
      revalidateWithLocalDeletionGuard(
        items,
        signal,
        (refs, current) => registry.revalidateEvidence(refs, current),
        ref => registry.resolve(ref),
      );
    expect(await validate()).toBe(true);
    const identity = registry.resolve(items[0])!;
    const downstream = jest.fn(async () => true);
    expect(
      await withLocalDeletionAwareRevalidation(downstream)(
        [
          {
            ...identity,
            locator: { kind: 'manual_history', entryId: 'different' },
          },
        ],
        signal,
      ),
    ).toBe(false);
    expect(downstream).not.toHaveBeenCalled();
    await db.database.execute(
      "UPDATE manual_history_entries SET payload_json = json_set(payload_json, '$.details', ?) WHERE id = ?",
      ['Synthetic changed history.', entry.id],
    );
    expect(await validate()).toBe(false);
    await repository.manualHistory.delete(entry.id);
    expect(await validate()).toBe(false);
    expect(
      await withLocalDeletionAwareRevalidation(downstream)([identity], signal),
    ).toBe(false);
    expect(downstream).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
