import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const reply = {
  id: 'photo-reply:' + '1'.repeat(32),
  createdAt: '2026-10-05T00:00:00.000Z',
  text: 'Synthetic sensitive-looking output',
};

function hold() {
  let notify!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(done => {
    notify = done;
  });
  const resume = new Promise<void>(done => {
    release = done;
  });
  return {
    reached,
    release,
    async wait() {
      notify();
      await resume;
    },
  };
}

test.each(['consent revoked', 'action aborted'])(
  '%s during the last awaited statement prevents actual protected commit',
  async condition => {
    const connection = openSqliteTestDatabase(':memory:');
    const gate = hold();
    const abort = new AbortController();
    let granted = true;
    let commits = 0;
    try {
      await runMigrations(connection.database);
      const database: SqlDatabase = {
        execute: (...args) => connection.database.execute(...args),
        transaction: work =>
          connection.database.transaction(tx =>
            work({
              ...tx,
              commit() {
                commits++;
                return tx.commit();
              },
              async execute(sql, params) {
                const result = await tx.execute(sql, params);
                if (
                  sql.startsWith(
                    'SELECT p.id FROM conversation_direct_photo_replies p',
                  )
                )
                  await gate.wait();
                return result;
              },
            }),
          ),
      };
      const storage = createConversationArtifactStorage(database);
      await storage.createSession('owned', await storage.currentGeneration());
      const saving = storage.writeDirectPhotoReply(
        'owned',
        0,
        reply,
        () => granted && !abort.signal.aborted,
      );
      await gate.reached;
      if (condition === 'consent revoked') granted = false;
      else abort.abort();
      gate.release();
      await expect(saving).rejects.toThrow('request retired');
      expect(commits).toBe(0);
      expect(
        await storage.readSessionPresentationMany('owned', 0, [reply.id]),
      ).toEqual([null]);
    } finally {
      gate.release();
      connection.close();
    }
  },
);

test.each([false, true])(
  'the exact row seals before a held implicit driver tail and survives an outer settlement fault (%s)',
  async settlementFault => {
    const connection = openSqliteTestDatabase(':memory:');
    const gate = hold();
    let granted = true;
    let arm = false;
    let explicitCommitWithLiveApproval = false;
    try {
      await runMigrations(connection.database);
      const database: SqlDatabase = {
        execute: (...args) => connection.database.execute(...args),
        transaction: work =>
          connection.database.transaction(async tx => {
            await work({
              ...tx,
              commit() {
                const result = tx.commit();
                explicitCommitWithLiveApproval = granted;
                return result;
              },
            });
            if (arm) {
              arm = false;
              await gate.wait();
              if (settlementFault)
                throw new Error('Synthetic wrapper settlement failure');
            }
          }),
      };
      const storage = createConversationArtifactStorage(database);
      await storage.createSession('owned', await storage.currentGeneration());
      arm = true;
      const saving = storage.writeDirectPhotoReply(
        'owned',
        0,
        reply,
        () => granted,
      );
      await gate.reached;
      // The old implementation reaches this point without having sealed.
      const alreadyDurable = explicitCommitWithLiveApproval;
      granted = false;
      gate.release();
      await saving;
      expect(alreadyDurable).toBe(true);
      // This was saved while still authorized, not after revocation; history outlives a grant.
      expect(
        await storage.readSessionPresentationMany('owned', 0, [reply.id]),
      ).toEqual([
        expect.objectContaining({ answer: reply.text, directPhoto: true }),
      ]);
    } finally {
      gate.release();
      connection.close();
    }
  },
);
