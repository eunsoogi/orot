import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { continuousConversationStorage } from '../continuousConversationStorage';
import { guardedNativeDatabase } from '../protectedReadEpoch';

const at = '2026-11-16T00:00:00.000Z';
const modelA = { providerId: 'synthetic-apple', modelId: 'a' };
const modelB = { providerId: 'synthetic-plan', modelId: 'b' };
const signal = () => new AbortController().signal;
function ownedStorage(database: SqlDatabase) {
  const owned = guardedNativeDatabase(database);
  return createConversationArtifactStorage(owned, owner => owner === owned);
}

async function saveTurn(
  storage: ReturnType<typeof ownedStorage>,
  sessionId: string,
  id: string,
  createdAt: string,
) {
  const question = 'Synthetic question';
  const opening = { callId: 'approved-opening', text: 'Synthetic first' };
  await storage.startRequest({
    id,
    sessionId,
    sessionVersion: 0,
    question,
    createdAt,
  });
  await storage.writeReviewedOpening({
    id,
    sessionId,
    version: 0,
    createdAt,
    opening,
    current: () => true,
    signal: signal(),
  });
  await storage.append({
    id,
    sessionId,
    question,
    createdAt,
    ...modelA,
    status: 'complete',
    answer: 'Synthetic final',
    sources: [],
  });
  return opening;
}

test('cold-reopens the exact previous owner, not the latest unrelated archived turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orot-previous-display-'));
  const path = join(dir, 'synthetic.sqlite');
  let file = openSqliteTestDatabase(path);
  try {
    await runMigrations(file.database);
    const storage = ownedStorage(file.database);
    const a = await storage.continuousSession(modelA, 'first', at, signal());
    const opening = await saveTurn(storage, a.id, 'first-turn', at);
    const generation = await storage.currentGeneration();
    await storage.createSession('unrelated', generation);
    await saveTurn(
      storage,
      'unrelated',
      'newer-unrelated',
      '2026-11-17T00:00:00.000Z',
    );
    const b = await storage.continuousSession(modelB, 'second', at, signal());
    file.close();
    file = openSqliteTestDatabase(path);
    const reopened = ownedStorage(file.database);
    expect(
      await reopened.continuousSession(modelB, 'unused', at, signal()),
    ).toEqual(b);
    const authority = { id: b.id, version: b.version, generation };
    const readPrior = reopened.readConversationDisplayPredecessor;
    const predecessor = await readPrior(authority, signal());
    expect(predecessor).toEqual({ id: a.id, version: a.version, generation });
    if (!predecessor) throw new Error('Missing exact display predecessor');
    const readDisplay = conversationSavedHistoryDisplayOption(
      async () => reopened,
    );
    const old = await readDisplay(
      predecessor.id,
      predecessor.version,
      signal(),
    );
    expect(old.rows).toMatchObject([
      {
        id: 'first-turn',
        kind: 'answer',
        initialResponse: opening,
        answer: 'Synthetic final',
      },
    ]);
    expect((await readDisplay(b.id, b.version, signal())).rows).toEqual([]);
    for (const stale of [
      { ...authority, id: a.id },
      { ...authority, version: b.version + 1 },
      { ...authority, generation: generation + 1 },
    ])
      expect(await readPrior(stale, signal())).toBeNull();
    expect(await readPrior(authority, AbortSignal.abort())).toBeNull();
  } finally {
    file.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(['hide-undo', 'delete', 'clear', 'hide-active'] as const)(
  'retires the persisted predecessor when its exact owner changes: %s',
  async reason => {
    const file = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(file.database);
      const storage = ownedStorage(file.database);
      const a = await storage.continuousSession(modelA, 'first', at, signal());
      const b = await storage.continuousSession(modelB, 'second', at, signal());
      const authority = {
        id: b.id,
        version: b.version,
        generation: await storage.currentGeneration(),
      };
      expect(
        await storage.readConversationDisplayPredecessor(authority, signal()),
      ).toMatchObject({ id: a.id });
      if (reason === 'hide-undo') {
        const hidden = await storage.hideSession(a.id, a.version);
        expect(hidden).not.toBeNull();
        await storage.undoHiddenSession(a.id, hidden!);
        expect(await storage.activeSessionVersion(a.id)).toBe(2);
      } else if (reason === 'delete') {
        await storage.deleteSession(a.id);
      } else if (reason === 'hide-active') {
        await storage.hideSession(b.id, b.version);
      } else {
        await file.database.execute(
          'UPDATE conversation_artifact_generation SET generation = generation + 1 WHERE singleton = 1',
        );
      }
      expect(
        await storage.readConversationDisplayPredecessor(authority, signal()),
      ).toBeNull();
      expect(
        (
          await file.database.execute(
            'SELECT 1 FROM conversation_display_predecessor',
          )
        ).rows,
      ).toEqual([]);
    } finally {
      file.close();
    }
  },
);

test('initial legacy adoption does not invent a predecessor, and hidden pointer is not borrowed', async () => {
  const file = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(file.database);
    const storage = ownedStorage(file.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('legacy', generation);
    await saveTurn(storage, 'legacy', 'legacy-turn', at);
    const a = await storage.continuousSession(modelA, 'unused', at, signal());
    expect(a.id).toBe('legacy');
    expect(
      await storage.readConversationDisplayPredecessor(
        { ...a, generation },
        signal(),
      ),
    ).toBeNull();
    await storage.hideSession(a.id, a.version);
    const b = await storage.continuousSession(modelB, 'second', at, signal());
    expect(
      await storage.readConversationDisplayPredecessor(
        { ...b, generation },
        signal(),
      ),
    ).toBeNull();
  } finally {
    file.close();
  }
});

test('aborting after the real pointer write rolls the new edge and session back together', async () => {
  const file = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(file.database);
    const storage = ownedStorage(file.database);
    const a = await storage.continuousSession(modelA, 'first', at, signal());
    const b = await storage.continuousSession(modelB, 'second', at, signal());
    const generation = await storage.currentGeneration();
    const abort = new AbortController();
    let afterPointerWrite = false;
    const cancellation = {
      execute: file.database.execute.bind(file.database),
      transaction: (work: Parameters<SqlDatabase['transaction']>[0]) =>
        file.database.transaction(tx =>
          work({
            ...tx,
            async execute(query, values) {
              const result = await tx.execute(query, values);
              if (
                query.startsWith(
                  'INSERT OR REPLACE INTO conversation_active_model',
                )
              ) {
                afterPointerWrite = true;
                abort.abort();
              }
              return result;
            },
          }),
        ),
    } satisfies SqlDatabase;
    const rollover = continuousConversationStorage(
      cancellation,
      async () => {},
    );
    await expect(
      rollover(modelA, 'cancelled-rollover', at, abort.signal),
    ).rejects.toThrow('selection cancelled');
    expect(afterPointerWrite).toBe(true);
    expect(await storage.activeSessionVersion('cancelled-rollover')).toBeNull();
    expect(
      await storage.continuousSession(modelB, 'unused', at, signal()),
    ).toEqual(b);
    expect(
      await storage.readConversationDisplayPredecessor(
        { ...b, generation },
        signal(),
      ),
    ).toMatchObject({ id: a.id });
  } finally {
    file.close();
  }
});
