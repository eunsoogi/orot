import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../packages/storage/__tests__/sqliteTestDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { buildManualHistoryEvidence } from '../aiFeatures/integration/manualHistoryEvidence';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';

jest.mock('../storage/secureDatabase', () => {
  throw new Error('Synthetic workflow accessed production storage');
});

// Real SQLite uses an explicit isolated binding; production module loading is a tripwire.
test('isolated storage preserves manual history identity, revision and deletion fences', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const repository = createRecordRepository(db.database);
    const storage = {
      openRecords: async () => repository,
      openMemoryDatabase: async () => db.database,
    };
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
        storage,
      );
    expect(await validate()).toBe(true);
    const identity = registry.resolve(items[0])!;
    const downstream = jest.fn(async () => true);
    expect(
      await withLocalDeletionAwareRevalidation(downstream, storage)(
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
      await withLocalDeletionAwareRevalidation(downstream, storage)(
        [identity],
        signal,
      ),
    ).toBe(false);
    expect(downstream).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test('empty and cancelled references never open either protected store', async () => {
  const storage = {
    openRecords: jest.fn(),
    openMemoryDatabase: jest.fn(),
  };
  const downstream = jest.fn(async () => true);
  const validate = withLocalDeletionAwareRevalidation(downstream, storage);
  expect(await validate([], new AbortController().signal)).toBe(true);
  const stopped = new AbortController();
  stopped.abort();
  expect(await validate([], stopped.signal)).toBe(false);
  expect(storage.openRecords).not.toHaveBeenCalled();
  expect(storage.openMemoryDatabase).not.toHaveBeenCalled();
  expect(downstream).toHaveBeenCalledTimes(1);
});
