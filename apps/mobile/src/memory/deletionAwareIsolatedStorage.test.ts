import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  audioSourceRecord,
  hashB,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
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

test('live RAG checks only requested descendants, preserving protected and abort fences', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    let statements = 0;
    let returnedRows = 0;
    let pause: (() => void) | undefined;
    const observe =
      (port: SqlExecutor): SqlExecutor['execute'] =>
      async (sql, params) => {
        const result = await port.execute(sql, params);
        statements += 1;
        returnedRows += result.rows.length;
        if (sql.includes('AS all_live')) pause?.();
        return result;
      };
    const traced: SqlDatabase = {
      execute: observe(db.database),
      transaction: fn =>
        db.database.transaction(tx => fn({ ...tx, execute: observe(tx) })),
    };
    const records = createRecordRepository(traced);
    const own = await records.sourceRecords.create(audioSourceRecord('owner'));
    const other = await records.sourceRecords.create({
      ...audioSourceRecord('different'),
      contentHash: hashB,
    });
    expect(other.id).not.toBe(own.id);
    const at = '2026-01-01T00:00:00Z';
    for (let i = 0; i < 150; i += 1) {
      await records.put('encounter', {
        id: `descendant-${i}`,
        effectiveAt: at,
        recordedAt: at,
        ingestedAt: at,
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'derived',
          sourceRecordIds: [i === 0 ? other.id : own.id],
        },
        encounterKind: 'outpatient',
        summary: 'synthetic',
      });
    }
    const ref = (evidenceId: string): EvidenceReference => ({
      evidenceId,
      sourceId: own.id,
      sourceKind: 'personal_record',
      sourceRevision: 'synthetic',
      evidenceRevision: 'synthetic',
      reviewState: 'unreviewed',
      locator: { kind: 'structured_record', recordId: evidenceId },
      effectiveTime: at,
    });
    const downstream = jest.fn(async () => true);
    const bind = (repository: typeof records) =>
      withLocalDeletionAwareRevalidation(downstream, {
        openRecords: async () => repository,
        openMemoryDatabase: async () => db.database,
      });
    const validate = bind(records);
    const legacy = bind({ ...records, hasSourceDeletionReferences: undefined });
    const live = [ref('descendant-1'), ref('descendant-2')];
    const signal = new AbortController().signal;
    statements = 0;
    returnedRows = 0;
    expect(await legacy(live, signal)).toBe(true);
    expect(statements).toBe(28);
    expect(returnedRows).toBe(300);
    statements = 0;
    returnedRows = 0;
    expect(await validate(live, signal)).toBe(true);
    expect(statements).toBe(6);
    expect(returnedRows).toBe(4);
    expect(await validate([ref('descendant-0')], signal)).toBe(false);
    expect(await validate([ref('absent')], signal)).toBe(false);
    const stopped = new AbortController();
    pause = () => stopped.abort();
    expect(await validate(live, stopped.signal)).toBe(false);
    pause = undefined;
    await records.delete('encounter', 'descendant-1');
    expect(await validate(live, signal)).toBe(false);
    expect(downstream).toHaveBeenCalledTimes(2);
  } finally {
    db.close();
  }
});
