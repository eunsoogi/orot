import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { listGeneratedReports, listRecentMaterial } from '../catalog';
import { prepareConversationCatalogRemoval } from '../conversationCatalogExclusions';

const syntheticAnswer = 'Synthetic assistant answer';

async function fixture(databasePath?: string) {
  const f = await setup(databasePath);
  try {
    await f.save('target', {
      answer: syntheticAnswer,
      entryIntent: 'possibilities',
    });
    await f.save('other', { entryIntent: 'possibilities' });
    const rows = await listGeneratedReports(f.db);
    const row = rows.find(candidate => candidate.id === 'target');
    if (!row) throw new Error('Synthetic report did not enter the catalog.');
    return { f, row };
  } catch (error) {
    f.close();
    throw error;
  }
}

test('confirmed removal excludes the exact catalog entry without deleting its answer or peers', async () => {
  const { f, row } = await fixture();
  try {
    await f.db.execute('PRAGMA foreign_keys = OFF');
    const schemaVersion = await f.db.execute('PRAGMA user_version');
    const snapshot = await f.db.execute(
      'SELECT * FROM conversation_artifacts ORDER BY id',
    );
    const sources = await f.db.execute(
      'SELECT * FROM conversation_artifact_sources ORDER BY artifact_id',
    );
    const confirm = await prepareConversationCatalogRemoval(f.db, row, {
      current: () => true,
      confirmProtected: async () => true,
    });
    expect(await confirm?.()).toBe(true);
    expect(await confirm?.()).toBe(false);
    expect(
      (await listGeneratedReports(f.db)).map(item => item.id),
    ).not.toContain('target');
    expect((await listGeneratedReports(f.db)).map(item => item.id)).toContain(
      'other',
    );
    expect((await listRecentMaterial(f.db)).map(item => item.id)).toContain(
      'target',
    );
    expect(
      await f.db.execute('SELECT * FROM conversation_artifacts ORDER BY id'),
    ).toEqual(snapshot);
    expect(
      await f.db.execute(
        'SELECT * FROM conversation_artifact_sources ORDER BY artifact_id',
      ),
    ).toEqual(sources);
    expect(
      await f.db.execute('SELECT * FROM conversation_deleted_artifacts'),
    ).toMatchObject({ rows: [] });
    expect(await f.db.execute('PRAGMA user_version')).toEqual(schemaVersion);
    await f.db.execute("DELETE FROM conversation_artifacts WHERE id='target'");
    expect(
      await f.db.execute(
        'SELECT * FROM generated_conversation_catalog_exclusions',
      ),
    ).toMatchObject({ rows: [] });
  } finally {
    f.close();
  }
});

test('cancel, denied proof and stale session version cannot remove a row', async () => {
  const { f, row } = await fixture();
  try {
    let current = true;
    let positive = true;
    const authority = {
      current: () => current,
      confirmProtected: async () => positive,
    };
    const cancel = await prepareConversationCatalogRemoval(
      f.db,
      row,
      authority,
    );
    current = false;
    expect(await cancel?.()).toBe(false);
    current = true;
    const denied = await prepareConversationCatalogRemoval(
      f.db,
      row,
      authority,
    );
    positive = false;
    expect(await denied?.()).toBe(false);
    positive = true;
    const stale = await prepareConversationCatalogRemoval(f.db, row, authority);
    await f.db.execute(
      'UPDATE conversation_artifact_sessions SET version=version+1',
    );
    expect(await stale?.()).toBe(false);
    expect((await listGeneratedReports(f.db)).map(item => item.id)).toContain(
      'target',
    );
  } finally {
    f.close();
  }
});

test('keeps the removal after reopening the same file without changing the old reader contract', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-generated-catalog-'));
  const path = join(directory, 'records.sqlite');
  try {
    const { f, row } = await fixture(path);
    try {
      const remove = await prepareConversationCatalogRemoval(f.db, row, {
        current: () => true,
        confirmProtected: async () => true,
      });
      expect(await remove?.()).toBe(true);
    } finally {
      f.close();
    }
    const reopened = openSqliteTestDatabase(path);
    try {
      expect(
        (await listGeneratedReports(reopened.database)).map(item => item.id),
      ).toEqual(['other']);
      // The original assistant artifact remains readable by an older reader
      // that knows nothing about the optional catalog-only table.
      const oldReader = await reopened.database.execute(
        "SELECT json_extract(result_json,'$.answer') AS answer FROM conversation_artifacts WHERE id=?",
        [row.id],
      );
      expect(oldReader.rows).toEqual([{ answer: syntheticAnswer }]);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
