import {
  createManualHistoryRepository,
  readManualHistoryEntry,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../ordinaryConversationMemoryNote';

const question = 'For future replies, I prefer concise answers.';
const createdAt = '2026-11-22T00:00:00.000Z';
const source = {
  requestId: 'synthetic-request',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  question,
  createdAt,
};
const noteId = 'conversation-local-memory:auto:synthetic-request';
const keep = () => true;

async function prepared() {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const retained = createConversationArtifactStorage(f.database);
    await retained.createSession(source.sessionId, 0);
    await retained.startRequest({ ...source, id: source.requestId });
    await retained.append({
      id: source.requestId,
      sessionId: source.sessionId,
      question,
      createdAt,
      providerId: 'synthetic',
      modelId: 'synthetic',
      answer: 'An unrelated synthetic answer.',
      status: 'complete',
      sources: [],
    });
    const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
      f.database,
    );
    const deviceEpoch = 'a'.repeat(64);
    const receipt = await enrollment.replace(
      await enrollment.read(),
      deviceEpoch,
      keep,
    );
    if (!receipt) throw new Error('Synthetic consent did not commit.');
    return {
      ...f,
      retained,
      capture: {
        database: f.database,
        deviceEpoch,
        generation: receipt.generation,
        isCurrent: keep,
      },
    };
  } catch (error) {
    f.close();
    throw error;
  }
}

test('persists only exact authored bytes; deleting the note does not permit replay', async () => {
  const f = await prepared();
  try {
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, false, keep),
    ).toBe(false);
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, true, keep),
    ).toBe(true);
    const note = await readManualHistoryEntry(f.database, noteId);
    expect(note).toMatchObject({ details: question, recordedAt: createdAt });
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, true, keep),
    ).toBe(false);
    const history = createManualHistoryRepository(f.database);
    expect(await history.delete(noteId)).toBe(true);
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, true, keep),
    ).toBe(false);
    expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
    expect((await f.retained.read(source.requestId))?.answer).toBe(
      'An unrelated synthetic answer.',
    );
  } finally {
    f.close();
  }
});

test('rolls back an inserted note and exact receipt if the active owner is lost before commit', async () => {
  const f = await prepared();
  let owned = true;
  const database: SqlDatabase = {
    ...f.database,
    transaction: operation =>
      f.database.transaction(tx =>
        operation({
          ...tx,
          async execute(sql, values) {
            const result = await tx.execute(sql, values);
            if (
              sql.startsWith('INSERT INTO ordinary_conversation_memory_notes')
            )
              owned = false;
            return result;
          },
        }),
      ),
  };
  try {
    await expect(
      saveOrdinaryConversationMemoryNote(
        { ...f.capture, database, isCurrent: () => owned },
        source,
        true,
        keep,
      ),
    ).rejects.toThrow('Automatic local memory owner changed');
    expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
    expect(
      (
        await f.database.execute(
          'SELECT request_id FROM ordinary_conversation_memory_notes',
        )
      ).rows,
    ).toEqual([]);
    expect((await f.retained.read(source.requestId))?.answer).toBe(
      'An unrelated synthetic answer.',
    );
  } finally {
    f.close();
  }
});

test('permanent source deletion removes only its auto provenance, not explicit local notes', async () => {
  const f = await prepared();
  try {
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, true, keep),
    ).toBe(true);
    const neighbor = 'conversation-local-memory:synthetic-explicit';
    const history = createManualHistoryRepository(f.database, {
      createId: () => neighbor,
      clock: () => createdAt,
    });
    await history.create({
      kind: 'note',
      title: 'Synthetic explicit memory',
      details: 'Synthetic explicit neighbor.',
      effectiveDate: { status: 'unknown' },
    });
    const correction = await createManualHistoryRepository(f.database, {
      createId: () => 'synthetic-correction',
      clock: () => createdAt,
    }).correct(noteId, {
      kind: 'note',
      title: 'Synthetic corrected memory',
      details: 'Synthetic correction.',
      effectiveDate: { status: 'unknown' },
    });
    expect(correction.id).toBe(
      'conversation-local-memory:auto:synthetic-correction',
    );
    await f.retained.deleteSession(source.sessionId);
    expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
    expect(await readManualHistoryEntry(f.database, correction.id)).toBeNull();
    expect(await readManualHistoryEntry(f.database, neighbor)).not.toBeNull();
    expect(
      await saveOrdinaryConversationMemoryNote(f.capture, source, true, keep),
    ).toBe(false);
  } finally {
    f.close();
  }
});
