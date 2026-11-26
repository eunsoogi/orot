import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { bindHealthContextTool } from '../../../aiFeatures/integration/bindHealthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { bindLiveAliasHealthContext } from '../../../voiceConversation/bindLiveAliasHealthContext';
import {
  committedHealthContextSnapshotReader,
  createHealthContextReader,
} from '../reader';
import { isImmutableReportSnapshot } from '../committedReportScope';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-04T00:00:00Z',
  timeZone: 'UTC',
};
const topics = ['measurements'] as const;
const maxPayloadBytes = 8192;

test('legacy Live alias keeps the exact full digest, payload cap and final deletion proof', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    for (const i of [1, 2, 3]) {
      await records.put('health_observation', {
        ...healthObservation(
          'sample-' + i,
          'heart_rate',
          '2026-10-0' + i + 'T10:00:00Z',
        ),
        // The shared fixture's default import predates the last two observations.
        ingestedAt: '2026-10-04T00:00:00.000Z',
      });
    }
    const signal = new AbortController().signal;
    const options = {
      input: { topics: ['measurements'], window, detail: 'summary' },
      operationRunId: 'synthetic-run',
      operationKey: 'synthetic-challenge',
      allowedScope: { sourceKinds: ['personal_record'] as const },
      resultLimit: 1,
      maxPayloadBytes,
      signal,
    };
    const ordinary = createHealthContextReader(f.database);
    const baseRegistry = new LocalEvidenceReferenceRegistry();
    const legacy = bindHealthContextTool(
      { readHealthContext: ordinary },
      baseRegistry,
      'rag',
    )!;
    const aliasFactory = createHealthContextReader(f.database);
    const optimized = committedHealthContextSnapshotReader(aliasFactory);
    const alternate = new LocalEvidenceReferenceRegistry();
    const alias = bindLiveAliasHealthContext(
      { readHealthContext: aliasFactory },
      alternate,
    )!;
    const measured = await legacy.search(options);
    const reused = await alias.search(options);
    expect(measured).not.toHaveProperty('status');
    expect(reused).toEqual(measured);
    if ('status' in reused) throw new Error('Expected the verified aggregate.');
    expect(reused.items).toHaveLength(1);
    expect(await alternate.revalidateEvidence(reused.items, signal)).toBe(true);
    const under = { ...options, maxPayloadBytes: 1 };
    expect(await alias.search(under)).toEqual(await legacy.search(under));
    const snapshot = await optimized(window, topics, signal);
    expect(isImmutableReportSnapshot(snapshot)).toBe(true);
    expect(await optimized(window, topics, signal)).toBe(snapshot);
    const custom = jest.fn(ordinary);
    expect(committedHealthContextSnapshotReader(custom)).toBe(custom);

    await records.delete('health_observation', 'sample-1');
    expect(await alternate.revalidateEvidence(reused.items, signal)).toBe(
      false,
    );
    expect(await optimized(window, topics, signal)).not.toBe(snapshot);
    const replacement = await alias.search(options);
    expect(replacement).toEqual(await legacy.search(options));
  } finally {
    f.close();
  }
});
