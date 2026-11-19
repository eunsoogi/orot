import {
  conversationHistorySources,
  conversationHistoryIsCurrent,
} from '../conversationHistorySources';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { restoreConversationParentSource } from '../restoreConversationParentSource';
import { captureConversationSources } from '../captureConversationSources';
import { fingerprint } from '../evidenceUtils';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';

/** Count actual production SQL, including private reader closures. No real data. */
function observe(database: SqlDatabase) {
  const stats = { aggregateSql: 0, transactions: 0, sql: 0 };
  const artifactReads: number[] = [];
  const count = (sql: string) => {
    stats.sql++;
    if (/WITH days\(/.test(sql)) stats.aggregateSql++;
  };
  const direct = database.execute.bind(database);
  const transaction = database.transaction.bind(database);
  database.execute = async (...args) => {
    count(args[0]);
    return direct(...args);
  };
  database.transaction = async operation =>
    transaction(async tx => {
      stats.transactions++;
      const index = artifactReads.push(0) - 1;
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        count(args[0]);
        if (
          args[0].startsWith(
            'SELECT a.id, a.session_id, a.created_at, a.result_json',
          )
        )
          artifactReads[index]!++;
        return execute(...args);
      };
      await operation(tx);
    });
  return {
    stats,
    artifactReads,
    reset() {
      stats.aggregateSql = 0;
      stats.transactions = 0;
      stats.sql = 0;
      artifactReads.length = 0;
    },
    restore() {
      database.execute = direct;
      database.transaction = transaction;
    },
  };
}

test.each([
  { count: 1, nested: false },
  { count: 3, nested: false },
  { count: 3, nested: true },
])(
  'profiles generated capture after workflow result $count/$nested',
  async ({ count, nested }) => {
    const f = await diverseHistoryProfileFixture(count, nested);
    const signal = new AbortController().signal;
    try {
      const refs: EvidenceReference[] = [];
      const data = await f.input.loadLocalData();
      for (let i = 0; i < count; i++) {
        const saved = (await f.storage.read(`turn-${i}`))!;
        const revision = fingerprint(saved);
        const reference: EvidenceReference = {
          sourceKind: 'generated_artifact',
          sourceId: saved.id,
          evidenceId: saved.id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: { kind: 'generated_artifact', type: 'conversation_turn' },
          effectiveTime: null,
          reviewState: 'unreviewed',
        };
        const restored = await restoreConversationParentSource(
          { kind: 'generated_conversation', reference, id: saved.id, revision },
          f.input.registry,
          data,
          signal,
          async () => ({ revision, sourceStatus: 'current' }),
        );
        expect(restored).not.toBeNull();
        refs.push(restored!.reference);
      }
      const retainedHistory = [];
      for (let i = 0; i < count; i++) {
        const saved = (await f.storage.read(`turn-${i}`))!;
        retainedHistory.push({ id: saved.id, question: saved.question });
      }
      const history = await conversationHistorySources({
        session: {
          id: 'session',
          version: (await f.storage.activeSessionVersion('session'))!,
        },
        retainedHistory,
        data,
        registry: f.input.registry,
        signal,
      });
      const observation = observe(f.database);
      try {
        expect(
          await conversationHistoryIsCurrent(
            f.input.registry,
            history.references,
            signal,
          ),
        ).toBe(true);
        // Each distinct window calculates its two SQL statements once; both strict
        // read fences still execute and reread artifacts in separate transactions.
        expect(observation.stats.aggregateSql).toBe(count * 2);
        expect(observation.stats.transactions).toBe(2);
        expect(observation.artifactReads).toHaveLength(2);
        expect(observation.artifactReads.every(reads => reads > 0)).toBe(true);
        console.info(
          'POST_RESULT_HISTORY_CURRENT',
          JSON.stringify({ count, nested, ...observation.stats }),
        );
        observation.reset();
        const admitted = await captureConversationSources(
          history.sources,
          f.input.registry,
          signal,
        );
        expect(admitted.sources.length).toBeGreaterThan(0);
        expect(observation.stats.aggregateSql).toBe(count * 2);
        expect(observation.stats.transactions).toBe(nested ? 4 : 2);
        expect(observation.artifactReads).toHaveLength(nested ? 4 : 2);
        expect(observation.artifactReads.every(reads => reads > 0)).toBe(true);
        console.info(
          'POST_RESULT_ADMITTED_SOURCES',
          JSON.stringify({ count, nested, ...observation.stats }),
        );
        observation.reset();
        const start = performance.now();
        const captured = await captureConversationSources(
          refs,
          f.input.registry,
          signal,
        );
        expect(captured.sources).toHaveLength(count);
        expect(observation.stats.aggregateSql).toBe(count * 2);
        expect(observation.stats.transactions).toBe(2);
        expect(observation.artifactReads).toHaveLength(2);
        expect(observation.artifactReads.every(reads => reads > 0)).toBe(true);
        console.info(
          'POST_RESULT_CAPTURE',
          JSON.stringify({
            count,
            nested,
            ms: performance.now() - start,
            ...observation.stats,
          }),
        );
        // A second capture must still check current sources; a successful first read
        // is not consent to reuse stale ancestry after mutation or deletion.
        await f.repository.delete('health_observation', 'inside');
        expect(
          await conversationHistoryIsCurrent(
            f.input.registry,
            history.references,
            signal,
          ),
        ).toBe(false);
        await expect(
          captureConversationSources(refs, f.input.registry, signal),
        ).rejects.toThrow();
      } finally {
        observation.restore();
      }
    } finally {
      f.close();
    }
  },
  120000,
);

test('direct period readSource calls share warm reader cache but six scopes churn its five entries', async () => {
  const f = await healthContextFixture();
  const signal = new AbortController().signal;
  try {
    const observation = observe(f.database);
    try {
      await captureConversationSources([f.item], f.registry, signal);
      expect(observation.stats.aggregateSql).toBe(0);
      const refs: EvidenceReference[] = [];
      for (let index = 0; index < 6; index++) {
        const window = {
          fromInclusive: '2026-10-01T00:00:00Z',
          toExclusive: new Date(Date.UTC(2026, 9, index + 2)).toISOString(),
          timeZone: 'UTC',
        };
        const report = await f.read(window, ['measurements']);
        refs.push(
          registerHealthContextEvidence({
            registry: f.registry,
            read: f.read,
            report,
            scope: {
              kind: 'health_context_period',
              version: 1,
              topic: 'measurements',
              window,
            },
          }),
        );
      }
      observation.reset();
      expect(
        (await captureConversationSources(refs, f.registry, signal)).sources,
      ).toHaveLength(6);
      expect(observation.stats.aggregateSql).toBe(12);
      console.info('POST_RESULT_DIRECT', JSON.stringify(observation.stats));
      await f.repository.put('health_observation', {
        ...f.inside,
        value: { kind: 'quantity', amount: 99, unit: 'count/min' },
      });
      await expect(
        captureConversationSources(refs, f.registry, signal),
      ).rejects.toThrow();
    } finally {
      observation.restore();
    }
  } finally {
    f.close();
  }
}, 120000);
