import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createConversationReadingPositionStorage } from '../conversationReadingPositionStorage';
const current = () => true;
const position = {
  turnId: 'turn',
  role: 'assistant' as const,
  offset: 18,
  bottom: false,
};
async function fixture() {
  const f = await healthContextFixture();
  const artifacts = createConversationArtifactStorage(f.database);
  await artifacts.createSession('session', await artifacts.currentGeneration());
  await artifacts.append({
    id: 'turn',
    sessionId: 'session',
    createdAt: '2026-11-16T00:00:00.000Z',
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    question: 'Synthetic question',
    answer: 'Synthetic answer',
    sources: f.saved.sources,
    citations: [f.saved.sources[0]!.reference],
  });
  return {
    ...f,
    artifacts,
    storage: createConversationReadingPositionStorage(f.database),
  };
}
test('protected anchor roundtrips through a new adapter without storing transcript text', async () => {
  const f = await fixture();
  try {
    expect(await f.storage.read('session', current)).toEqual({
      version: 0,
      position: null,
    });
    await f.storage.write('session', 0, position, current);
    expect(
      await createConversationReadingPositionStorage(f.database).read(
        'session',
        current,
      ),
    ).toEqual({ version: 0, position });
    const raw = await f.database.execute(
      'SELECT * FROM conversation_reading_positions',
    );
    expect(raw.rows).toEqual([
      {
        session_id: 'session',
        version: 0,
        generation: 0,
        turn_id: 'turn',
        role: 'assistant',
        offset: 18,
        bottom: 0,
      },
    ]);
    await f.storage.write('session', 0, { ...position, bottom: true }, current);
    expect((await f.storage.read('session', current))?.position?.bottom).toBe(
      true,
    );
  } finally {
    f.close();
  }
});
test('hidden, undone, deleted targets and stale versions cannot restore the old anchor', async () => {
  const f = await fixture();
  try {
    await f.storage.read('session', current);
    await f.storage.write('session', 0, position, current);
    await f.artifacts.hideSession('session', 0);
    await f.storage.write('session', 0, position, current);
    expect(await f.storage.read('session', current)).toBeNull();
    await f.artifacts.undoHiddenSession('session', 1);
    expect(await f.storage.read('session', current)).toEqual({
      version: 2,
      position: null,
    });
    await expect(
      f.storage.write('session', 0, position, current),
    ).rejects.toThrow();
    await f.storage.write('session', 2, position, current);
    await f.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      ['turn'],
    );
    await f.storage.write('session', 2, position, current);
    expect(await f.storage.read('session', current)).toEqual({
      version: 2,
      position: null,
    });
  } finally {
    f.close();
  }
});
test('generation clear fences a late old writer even if session ID and version are reused', async () => {
  const f = await fixture();
  try {
    await f.storage.read('session', current);
    await f.storage.write('session', 0, position, current);
    await f.database.execute(
      'UPDATE conversation_artifact_generation SET generation = generation + 1',
    );
    await f.database.execute(
      'UPDATE conversation_artifact_sessions SET generation = 1',
    );
    await f.storage.write('session', 0, position, current);
    expect(
      (await f.database.execute('SELECT * FROM conversation_reading_positions'))
        .rows,
    ).toEqual([]);
    expect(
      await createConversationReadingPositionStorage(f.database).read(
        'session',
        current,
      ),
    ).toEqual({ version: 0, position: null });
  } finally {
    f.close();
  }
});
test('cancelled owners, forged turns, malformed geometry and writers without a read lease cannot persist', async () => {
  const f = await fixture();
  try {
    await expect(
      f.storage.write('session', 0, position, current),
    ).rejects.toThrow();
    await expect(f.storage.read('session', () => false)).rejects.toThrow();
    await f.storage.read('session', current);
    await expect(
      f.storage.write('session', 0, position, () => false),
    ).rejects.toThrow();
    for (const offset of [NaN, Infinity, -1, 1000001])
      await expect(
        f.storage.write('session', 0, { ...position, offset }, current),
      ).rejects.toThrow();
    await f.storage.write(
      'session',
      0,
      { ...position, turnId: 'not-retained' },
      current,
    );
    expect(
      (await f.database.execute('SELECT * FROM conversation_reading_positions'))
        .rows,
    ).toEqual([]);
    await f.storage.write('session', 0, position, current);
    await f.artifacts.deleteSession('session');
    expect(await f.storage.read('session', current)).toBeNull();
    expect(
      (await f.database.execute('SELECT * FROM conversation_reading_positions'))
        .rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});

test('ownership loss after INSERT rolls the geometry write back atomically', async () => {
  const f = await fixture();
  try {
    await f.storage.read('session', current);
    let checks = 0;
    await expect(
      f.storage.write('session', 0, position, () => ++checks < 3),
    ).rejects.toThrow('cancelled');
    expect(
      (await f.database.execute('SELECT * FROM conversation_reading_positions'))
        .rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
