import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const id = 'photo-reply:' + '1'.repeat(32);
const createdAt = '2026-10-05T00:00:00.000Z';
const text = 'Synthetic description of a selected paper drawing.';
const reply = { id, createdAt, text };

test('restart displays only photo marker and bounded reply under the exact lease, and Hide/Undo/permanent deletion is durable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-direct-photo-'));
  const path = join(root, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let store = createConversationArtifactStorage(connection.database);
    const generation = await store.currentGeneration();
    await store.createSession('owned', generation);
    await store.createSession('foreign', generation);
    await store.writeDirectPhotoReply('owned', 0, reply, () => true);
    expect(await store.listTimeline('owned', 0)).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await store.list('owned')).toEqual(
      expect.objectContaining({ items: [] }),
    );
    expect((await store.listSessions()).items.map(row => row.id)).toEqual([
      'owned',
    ]);
    connection.close();
    connection = openSqliteTestDatabase(path);
    // Native stores need not enable foreign_keys; deletion must still erase the reply.
    await connection.database.execute('PRAGMA foreign_keys = OFF');
    store = createConversationArtifactStorage(connection.database);
    const read = (version: number) =>
      store.readSessionPresentationMany('owned', version, [id]);
    const archive = [
      {
        id,
        createdAt,
        sessionId: 'owned',
        question: '',
        status: 'complete',
        answer: text,
        directPhoto: true,
      },
    ];
    expect(await read(0)).toEqual(archive);
    const signal = new AbortController().signal;
    const restore = conversationSavedHistoryDisplayOption(async () => store);
    expect((await restore('owned', 0, signal)).rows).toEqual([
      {
        kind: 'answer',
        id,
        createdAt,
        question: '',
        answer: text,
        directPhoto: true,
      },
    ]);
    // Even an explicitly requested ID cannot make a display-only reply model context.
    expect(
      await store.readProtectedPromptHistory('owned', 0, [id], signal),
    ).toEqual([]);
    expect(
      await store.protectedPromptHistoryIsCurrent(
        'owned',
        0,
        [{ id, createdAt }],
        signal,
      ),
    ).toBe(false);
    expect(
      (await store.listTimeline('owned', 0, undefined, 10, true)).items,
    ).toEqual([{ id, createdAt, version: 0, kind: 'turn' }]);
    expect(await store.readSessionPresentationMany('foreign', 0, [id])).toEqual(
      [null],
    );
    expect(
      await store.readSelectedArchivedCitation('owned', 0, id, createdAt, 0),
    ).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_direct_photo_replies',
        )
      ).rows,
    ).toEqual([
      { id, created_at: createdAt, session_id: 'owned', reply_text: text },
    ]);
    expect(await store.hideSession('owned', 0)).toBe(1);
    await expect(read(0)).rejects.toThrow('Conversation is unavailable.');
    await expect(read(1)).rejects.toThrow('Conversation is unavailable.');
    await expect(
      store.writeDirectPhotoReply(
        'owned',
        0,
        { ...reply, id: 'photo-reply:' + '2'.repeat(32) },
        () => true,
      ),
    ).rejects.toThrow('Conversation is unavailable.');
    expect(await store.undoHiddenSession('owned', 1)).toBe(2);
    await expect(read(0)).rejects.toThrow('Conversation is unavailable.');
    expect(await read(2)).toEqual(archive);
    expect(await store.hideSession('owned', 2)).toBe(3);
    await store.finalizeHiddenSession('owned', 3);
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_direct_photo_replies',
        )
      ).rows,
    ).toEqual([]);
    await expect(read(2)).rejects.toThrow('Conversation is unavailable.');
  } finally {
    connection.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('revocation during INSERT rolls back; attachment-like output and previous local-data generation cannot write', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    let current = true;
    const database: SqlDatabase = {
      execute: (...args) => connection.database.execute(...args),
      transaction: work =>
        connection.database.transaction(tx =>
          work({
            ...tx,
            async execute(sql, params) {
              const result = await tx.execute(sql, params);
              if (
                sql.startsWith('INSERT INTO conversation_direct_photo_replies')
              )
                current = false;
              return result;
            },
          }),
        ),
    };
    const store = createConversationArtifactStorage(database);
    await store.createSession('owned', await store.currentGeneration());
    await expect(
      store.writeDirectPhotoReply(
        'owned',
        0,
        { ...reply, text: 'data:image/jpeg;base64,AAAA' },
        () => true,
      ),
    ).rejects.toThrow('Invalid photo reply.');
    await expect(
      store.writeDirectPhotoReply('owned', 0, reply, () => current),
    ).rejects.toThrow('request retired');
    expect(await store.readSessionPresentationMany('owned', 0, [id])).toEqual([
      null,
    ]);
    await store.writeDirectPhotoReply('owned', 0, reply, () => true);
    await createRecordRepository(database).deleteAllLocalData();
    expect(
      (
        await database.execute(
          'SELECT * FROM conversation_direct_photo_replies',
        )
      ).rows,
    ).toEqual([]);
    await expect(
      store.writeDirectPhotoReply('owned', 0, reply, () => true),
    ).rejects.toThrow('Conversation is unavailable.');
  } finally {
    connection.close();
  }
});

test.each(['before', 'after'])(
  'a direct deletion %s the insert neither leaves private text nor rolls back the delete',
  async timing => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const database: SqlDatabase = {
        execute: (...args) => connection.database.execute(...args),
        transaction: work =>
          connection.database.transaction(tx =>
            work({
              ...tx,
              async execute(sql, params) {
                if (
                  !sql.startsWith(
                    'INSERT INTO conversation_direct_photo_replies',
                  )
                )
                  return tx.execute(sql, params);
                const remove = () =>
                  tx.execute(
                    'DELETE FROM conversation_artifact_sessions WHERE id = ?',
                    ['owned'],
                  );
                if (timing === 'before') await remove();
                const result = await tx.execute(sql, params);
                if (timing === 'after') await remove();
                return result;
              },
            }),
          ),
      };
      const store = createConversationArtifactStorage(database);
      await store.createSession('owned', await store.currentGeneration());
      await expect(
        store.writeDirectPhotoReply('owned', 0, reply, () => true),
      ).rejects.toThrow('Conversation is unavailable.');
      expect(await store.activeSessionVersion('owned')).toBeNull();
      expect(
        (
          await database.execute(
            'SELECT * FROM conversation_direct_photo_replies',
          )
        ).rows,
      ).toEqual([]);
    } finally {
      connection.close();
    }
  },
);
