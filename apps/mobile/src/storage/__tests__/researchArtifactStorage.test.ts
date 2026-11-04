import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createResearchArtifactStorage } from '../researchArtifactStorage';

test('research snapshots are independently searchable and deletion fences an in-flight result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-research-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const lease = await store.currentGeneration();
    const input = {
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'external_medical_evidence',
      providerId: null,
      modelId: null,
      source: {
        kind: 'publication' as const,
        title: 'Synthetic publication',
        url: 'https://europepmc.org/article/MED/123',
        status: 'historical_snapshot' as const,
        retrievedAt: '2026-10-05T00:00:00.000Z',
      },
      generatedText: null,
    };
    await store.append([input, input], lease);
    connection.close();
    connection = openSqliteTestDatabase(path);
    const reopened = createResearchArtifactStorage(connection.database);
    await connection.database.execute(
      'UPDATE research_artifacts SET search_text = ?',
      [''],
    );
    expect((await reopened.search('synthetic', null, 10)).items).toEqual([]);
    await reopened.rebuildSearchIndex();
    const first = await reopened.search('SYNTHETIC', null, 1);
    expect(first.items).toHaveLength(1);
    expect(
      (await reopened.search('synthetic', first.nextCursor, 1)).items,
    ).toHaveLength(1);
    expect((await reopened.read(first.items[0]!.id))?.source).toEqual(
      input.source,
    );
    await expect(
      reopened.append(
        [{ ...input, generatedText: 'unlicensed abstract' }],
        lease,
      ),
    ).rejects.toThrow();
    await createRecordRepository(connection.database).deleteAllLocalData();
    expect((await reopened.search('synthetic', null, 10)).items).toEqual([]);
    await expect(reopened.append([input], lease)).rejects.toThrow();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('replaying the same saved request is idempotent and cannot resurrect a removed result', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const store = createResearchArtifactStorage(db.database);
    const lease = await store.currentGeneration();
    const item = {
      requestKey: 'run-operation-1',
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'medical_literature',
      providerId: null,
      modelId: null,
      source: {
        kind: 'publication' as const,
        title: 'Synthetic',
        url: 'https://europepmc.org/article/MED/123',
        status: 'historical_snapshot' as const,
        retrievedAt: '2026-10-05T00:00:00.000Z',
      },
      generatedText: null,
    };
    await store.append([item], lease);
    await store.append([item], lease);
    expect((await store.search('synthetic', null, 10)).items).toHaveLength(1);
    await store.remove(1);
    await expect(store.append([item], lease)).rejects.toThrow('removed');
    expect((await store.search('synthetic', null, 10)).items).toEqual([]);
  } finally {
    db.close();
  }
});

test('legacy web snapshots without complete input lineage are withheld', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const store = createResearchArtifactStorage(db.database);
    await store.currentGeneration();
    const legacy = {
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'symptom_summary',
      providerId: 'provider',
      modelId: 'model',
      source: {
        kind: 'public_web_search',
        sources: [{ title: 'Legacy synthetic', url: 'https://example.org' }],
        status: 'historical_snapshot',
        retrievedAt: '2026-10-05T00:00:00.000Z',
      },
      generatedText: 'Unverifiable earlier text',
    };
    await db.database.execute(
      'INSERT INTO research_artifacts (snapshot_json, search_text) VALUES (?, ?)',
      [JSON.stringify(legacy), 'legacy synthetic'],
    );
    const page = await store.search('legacy synthetic', null, 10);
    expect(page.items).toEqual([]);
    expect(page.unavailableCount).toBe(1);
    expect(await store.read(1)).toBeNull();
  } finally {
    db.close();
  }
});
