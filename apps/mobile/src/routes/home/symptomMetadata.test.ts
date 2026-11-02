import { createSymptomRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';

test('stores actual edit time separately and deletes metadata with the symptom', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    let now = '2026-10-01T12:00:00Z';
    const repository = createSymptomRepository(database, () => now);
    const entry = {
      id: 'symptom',
      effectiveAt: '2026-09-01T12:00:00Z',
      recordedAt: '2026-09-02T12:00:00Z',
      ingestedAt: '2026-09-02T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Pain',
      status: 'active' as const,
    };
    await repository.create(entry);
    expect(await repository.getLastUpdatedAt?.(entry.id)).toBe(now);
    now = '2026-10-02T12:00:00Z';
    await repository.update({ ...entry, description: 'Pain changed' });
    expect(await repository.getLastUpdatedAt?.(entry.id)).toBe(now);
    expect(await repository.get(entry.id)).toMatchObject({
      recordedAt: entry.recordedAt,
      ingestedAt: entry.ingestedAt,
      effectiveAt: entry.effectiveAt,
    });
    await database.execute('DELETE FROM symptom_entries WHERE id = ?', [
      entry.id,
    ]);
    expect(await repository.getLastUpdatedAt?.(entry.id)).toBeNull();
  } finally {
    close();
  }
});

test('does not invent legacy update times and preserves metadata on reopen', async () => {
  const { mkdtempSync, rmSync, copyFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-symptom-update-'));
  const path = join(directory, 'records.sqlite');
  try {
    const first = createHealthEvidenceTestDatabase(path);
    await runMigrations(first.database);
    const entry = {
      id: 'legacy',
      effectiveAt: '2026-09-01T12:00:00Z',
      recordedAt: '2026-09-02T12:00:00Z',
      ingestedAt: '2026-09-02T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Pain',
      status: 'active' as const,
    };
    await first.database.execute(
      'INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        entry.id,
        entry.effectiveAt,
        entry.recordedAt,
        entry.ingestedAt,
        JSON.stringify(entry),
      ],
    );
    const repository = createSymptomRepository(
      first.database,
      () => '2026-10-01T12:00:00Z',
    );
    expect(await repository.getLastUpdatedAt?.(entry.id)).toBeNull();
    await repository.update({ ...entry, description: 'Changed' });
    first.close();
    const restoredPath = join(directory, 'restored.sqlite');
    copyFileSync(path, restoredPath);
    const reopened = createHealthEvidenceTestDatabase(restoredPath);
    try {
      await runMigrations(reopened.database);
      const restored = createSymptomRepository(reopened.database);
      expect(await restored.getLastUpdatedAt?.(entry.id)).toBe(
        '2026-10-01T12:00:00Z',
      );
      await reopened.database.execute(
        'DELETE FROM symptom_entries WHERE id = ?',
        [entry.id],
      );
      expect(await restored.getLastUpdatedAt?.(entry.id)).toBeNull();
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rolls back the symptom when its update metadata cannot be saved', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const failing = {
      ...database,
      transaction: (operation: Parameters<typeof database.transaction>[0]) =>
        database.transaction(tx =>
          operation({
            ...tx,
            execute: (query, parameters) =>
              query.startsWith('INSERT INTO symptom_local_updates')
                ? Promise.reject(new Error('metadata failure'))
                : tx.execute(query, parameters),
          }),
        ),
    };
    const repository = createSymptomRepository(failing);
    const entry = {
      id: 'rollback',
      effectiveAt: '2026-09-01T12:00:00Z',
      recordedAt: '2026-09-02T12:00:00Z',
      ingestedAt: '2026-09-02T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Pain',
      status: 'active' as const,
    };
    await expect(repository.create(entry)).rejects.toThrow('metadata failure');
    expect(await repository.get(entry.id)).toBeNull();
  } finally {
    close();
  }
});
