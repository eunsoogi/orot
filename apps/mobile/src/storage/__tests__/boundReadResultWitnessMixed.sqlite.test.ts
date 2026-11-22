import { sharedAncestryProfileFixture } from '../../aiFeatures/integration/testSupport/sharedAncestryProfileFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import type { HealthContextTopic } from '../../healthEvidence/healthContext/types';
import type { ConversationArtifact } from '../conversationArtifactCodec';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { readOwnedBoundParentRows } from '../conversationArtifactRead';
import { guardedNativeDatabase } from '../protectedReadEpoch';

test('a unique root with a mixed five-topic DAG and ordinary record admits the native witness', async () => {
  const f = await sharedAncestryProfileFixture(1, false);
  try {
    const template = (await f.storage.read('turn-0'))!;
    const stockRef = template.citations![0]!;
    const read = createLocalEvidenceData(f.database).readHealthContext!;
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-10T00:00:00Z',
      timeZone: 'UTC',
    };
    const topics: HealthContextTopic[] = [
      'activity',
      'measurements',
      'medications',
      'sleep',
      'symptoms',
    ];
    const sources: ConversationArtifact['sources'][number][] = [];
    for (const topic of topics) {
      const scope = {
        kind: 'health_context_period' as const,
        version: 1 as const,
        window,
        topic,
      };
      const report = await read(window, [topic]);
      const rev = healthContextRevision(scope, report);
      sources.push({
        kind: 'health_context_period',
        scope,
        revision: rev,
        deletionGeneration: report.deletionGeneration,
        reference: {
          ...stockRef,
          sourceKind: 'personal_record',
          sourceId: `period-${topic}`,
          evidenceId: `period-${topic}`,
          locator: scope,
          sourceRevision: rev,
          evidenceRevision: rev,
        },
      });
    }
    const ordinaryRevision = fingerprint(f.inside);
    sources.push({
      reference: {
        ...stockRef,
        sourceKind: 'personal_record',
        sourceId: f.inside.id,
        evidenceId: f.inside.id,
        sourceRevision: ordinaryRevision,
        evidenceRevision: ordinaryRevision,
        locator: { kind: 'structured_record', recordId: f.inside.id },
      },
      records: [
        {
          kind: 'health_observation',
          id: f.inside.id,
          revision: ordinaryRevision,
        },
      ],
    });
    const row = (id: string, selected: ConversationArtifact['sources']) => ({
      ...template,
      id,
      sources: selected,
      citations: selected.map(item => item.reference),
    });
    const link = (item: ConversationArtifact) => {
      const revision = fingerprint(item);
      return {
        kind: 'generated_conversation' as const,
        id: item.id,
        revision,
        reference: {
          ...stockRef,
          sourceKind: 'generated_artifact' as const,
          sourceId: item.id,
          evidenceId: item.id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: {
            kind: 'generated_artifact' as const,
            type: 'conversation_turn' as const,
          },
        },
      };
    };
    const leaf = row('mixed-leaf', sources);
    await f.storage.append(leaf);
    const parents = Array.from({ length: 8 }, (_, i) =>
      row(`mixed-parent-${i}`, [link(leaf)]),
    );
    for (const value of parents) await f.storage.append(value);
    const root = row('mixed-root', parents.map(link));
    await f.storage.append(root);
    const scoped = createConversationArtifactStorage(
      guardedNativeDatabase(f.database),
    );
    await scoped.currentGeneration();
    const transaction = f.database.transaction.bind(f.database);
    let queries: string[] = [];
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (sql, binds) => {
          queries.push(sql);
          return execute(sql, binds);
        };
        await work(tx);
      });
    const doRead = async (storage: typeof f.storage) => {
      const signal = new AbortController().signal;
      const op = storage.beginReadOperation(signal)!;
      try {
        return (
          await readOwnedBoundParentRows(
            op,
            storage,
            signal,
            [root.id],
            'initial',
          )
        )?.rows;
      } finally {
        op.dispose();
      }
    };
    const baseline = await doRead(f.storage);
    const expected = queries;
    queries = [];
    const candidate = await doRead(scoped);
    expect(candidate).toEqual(baseline);
    expect(candidate?.[0]?.id).toBe(root.id);
    expect(
      queries.filter(sql => sql.includes('pragma_data_version')),
    ).toHaveLength(2);
    expect(queries.length).toBeLessThan(expected.length / 2);
    expect(
      queries.some(sql => sql.includes('occurrences AS MATERIALIZED')),
    ).toBe(true);
    expect(queries.some(sql => sql.includes('WITH RECURSIVE calendar'))).toBe(
      true,
    );
    expect(queries.some(sql => sql.includes('catalog AS ('))).toBe(true);
    expect(
      queries.some(sql => sql.includes('observations AS MATERIALIZED')),
    ).toBe(true);
    console.info('BOUND_WITNESS_MIXED', {
      baseline: expected.length,
      witness: queries.length,
    });
  } finally {
    f.close();
  }
});
