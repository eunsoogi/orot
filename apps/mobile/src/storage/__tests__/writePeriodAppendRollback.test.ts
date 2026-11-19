import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import * as scope from '../writePeriodCalculationScope';
import { assertSummaryPeriodCurrent } from '../symptomSummaryPeriods';

// Compare the pre-optimization validator with the real new append. Direct native
// writes join this transaction: its pre-existing rollback behavior is not repaired here.
test.each(['abort', 'delete-abort', 'sql-error-abort'] as const)(
  'append preserves original atomic write outcome on %s',
  async mode => {
    for (const baseline of [true, false]) {
      const f = await healthContextFixture();
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('session', await storage.currentGeneration());
      await f.database.execute(
        'CREATE TABLE synthetic_append_audit(value INTEGER)',
      );
      const original = f.database.transaction.bind(f.database);
      const controller = new AbortController();
      const failure = new Error('Original SQL error');
      let injected = false;
      const spy = baseline
        ? jest
            .spyOn(scope, 'withWritePeriodCalculations')
            .mockImplementation((_tx, work) => work(assertSummaryPeriodCurrent))
        : undefined;
      f.database.transaction = work =>
        original(async tx => {
          const execute = tx.execute.bind(tx);
          await work({
            ...tx,
            execute: async (...args) => {
              const result = await execute(...args);
              if (!injected && /WITH days\(/.test(args[0])) {
                injected = true;
                await execute('INSERT INTO synthetic_append_audit VALUES (1)');
                if (mode === 'delete-abort')
                  await execute('DELETE FROM health_observations WHERE id=?', [
                    f.inside.id,
                  ]);
                controller.abort();
                if (mode === 'sql-error-abort') throw failure;
              }
              return result;
            },
          });
        });
      try {
        const value = {
          id: 'new-turn',
          sessionId: 'session',
          createdAt: '2026-10-05T00:00:00.000Z',
          providerId: 'synthetic',
          modelId: 'synthetic',
          status: 'complete' as const,
          question: 'synthetic',
          answer: 'synthetic',
          sources: f.saved.sources,
        };
        const saving = storage.append(value, controller.signal);
        if (mode === 'sql-error-abort')
          await expect(saving).rejects.toBe(failure);
        else await expect(saving).rejects.toThrow();
        expect(injected).toBe(true);
        expect(
          (await f.database.execute('SELECT * FROM synthetic_append_audit'))
            .rows,
        ).toEqual([]);
        expect(
          (
            await f.database.execute(
              'SELECT id FROM conversation_artifacts WHERE id=?',
              [value.id],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await f.database.execute(
              'SELECT artifact_id FROM conversation_artifact_sources WHERE artifact_id=?',
              [value.id],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await f.database.execute(
              'SELECT artifact_id FROM conversation_artifact_periods WHERE artifact_id=?',
              [value.id],
            )
          ).rows,
        ).toEqual([]);
        // This is an existing write-transaction limitation, not deletion-preserving
        // read sentinel behavior: a joined DELETE is rolled back in both variants.
        expect(
          await f.repository.get('health_observation', f.inside.id),
        ).not.toBeNull();
      } finally {
        spy?.mockRestore();
        f.database.transaction = original;
        f.close();
      }
    }
  },
);
