import * as removal from '../conversationPeriodRemoval';
import { previousPeriodNotRemoved } from '../testSupport/previousPeriodNotRemoved';
import { diverseHistoryProfileFixture } from '../../aiFeatures/integration/testSupport/diverseHistoryProfileFixture';
import { restoreConversationParentSource } from '../../aiFeatures/integration/restoreConversationParentSource';
import { captureConversationSources } from '../../aiFeatures/integration/captureConversationSources';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

/** Inject after the first membership statement resolves: the original separately awaited
 * snapshots must remain visible after static SQL template reuse. */
test.each(['previous', 'templates'] as const)(
  '%s strict read and capture reject a newly inserted marker',
  async implementation => {
    for (const boundary of ['read', 'capture'] as const) {
      const f = await diverseHistoryProfileFixture(1, false);
      const transaction = f.database.transaction;
      try {
        const saved = (await f.storage.read('turn-0'))!;
        const revision = fingerprint(saved);
        const reference = {
          ...saved.citations![0]!,
          sourceId: saved.id,
          evidenceId: saved.id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: { kind: 'generated_artifact', type: 'conversation_turn' },
        };
        const alias = await restoreConversationParentSource(
          { kind: 'generated_conversation', reference, id: saved.id, revision },
          f.input.registry,
          await f.input.loadLocalData(),
          new AbortController().signal,
          async () => ({ revision, sourceStatus: 'current' }),
        );
        if (implementation === 'previous')
          jest
            .spyOn(removal, 'assertPeriodNotRemoved')
            .mockImplementation(previousPeriodNotRemoved);
        let injected = false;
        f.database.transaction = work =>
          transaction.call(f.database, async tx => {
            const execute = tx.execute.bind(tx);
            tx.execute = async (sql, bindings) => {
              const result = await execute(sql, bindings);
              if (!injected && sql.includes('linked_ids(id)')) {
                injected = true;
                await execute(
                  "INSERT INTO agent_memory_removed_sources(source_id) VALUES ('inside')",
                );
              }
              return result;
            };
            await work(tx);
          });
        if (boundary === 'read')
          await expect(f.storage.read('turn-0')).resolves.toBeNull();
        else
          await expect(
            captureConversationSources(
              [alias!.reference],
              f.input.registry,
              new AbortController().signal,
            ),
          ).rejects.toThrow();
        expect(injected).toBe(true);
      } finally {
        jest.restoreAllMocks();
        f.database.transaction = transaction;
        f.close();
      }
    }
  },
);
