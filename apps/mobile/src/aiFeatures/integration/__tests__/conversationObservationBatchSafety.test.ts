import { selectConversationDisplayTurnIds } from '../conversationFirstDisplaySelection';
import * as diagnostics from '../../../providers/diagnostics';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

type Fault =
  | 'delete'
  | 'mutation'
  | 'staleness'
  | 'late-delete'
  | 'sql'
  | 'oversize'
  | 'lock'
  | 'replace-reader';
const denseId = 'synthetic-two-observations';

async function fixture(fault?: Fault, duplicate = false) {
  const f = await quarantinedHistoryFixture();
  const controller = new AbortController();
  const { signal } = controller;
  const registry = new LocalEvidenceReferenceRegistry();
  const read = createLocalHealthEvidenceRepository(f.database);
  const data = {
    ...(await f.input.loadLocalData()),
    ...createLocalEvidenceData(f.database),
    repository: read,
  };
  const originalRead = read.readRecord;
  const db = f.database;
  const saved = [0, 1].map(index => ({ ...f.inside, id: `fresh-${index}` }));
  for (const record of saved)
    await f.repository.put('health_observation', record);
  const [first] = saved;
  const sources = (duplicate ? [first!, ...saved] : saved).map(
    (record, index) => {
      const revision = fingerprint(record);
      return {
        reference: {
          sourceKind: 'personal_record' as const,
          sourceId: record.id,
          sourceRevision: revision,
          evidenceId: `turn-evidence-${index}`,
          evidenceRevision: revision,
          effectiveTime: record.effectiveAt,
          reviewState: 'unknown' as const,
          locator: { kind: 'record' as const, id: record.id },
        },
        records: [
          { kind: 'health_observation' as const, id: record.id, revision },
        ],
      };
    },
  );
  await f.storage.append({
    ...(await f.storage.read('newer'))!,
    id: denseId,
    createdAt: '2026-10-07T00:00:00.000Z',
    sources,
    citations: sources.map(source => source.reference),
  });
  let stage = '';
  let batch = 0;
  let strict = 0;
  let applied = false;
  const sqlError = new Error('Synthetic SQLite failure');
  const diagnostic = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, token, outcome) => {
      if (outcome === 'started') stage = token;
    });
  const transaction = db.transaction.bind(db);
  db.transaction = async work => {
    if (
      !applied &&
      fault &&
      ((stage === 'artifact_source_hydration' &&
        (fault === 'delete' ||
          fault === 'mutation' ||
          fault === 'staleness')) ||
        (stage === 'artifact_final_validation' && fault === 'late-delete'))
    ) {
      applied = true;
      if (fault === 'delete' || fault === 'late-delete')
        await f.repository.delete('health_observation', first!.id);
      if (fault === 'mutation')
        await f.repository.put('health_observation', {
          ...first!,
          value: { kind: 'quantity', amount: 73, unit: 'count/min' },
        });
      if (fault === 'staleness')
        await db.execute(
          "INSERT INTO transcript_artifact_staleness(transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES ('synthetic', 'health_observation', ?, 'old', 'new', '2026-10-08')",
          [first!.id],
        );
    }
    return transaction(tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (query, params) => {
        if (
          stage === 'artifact_source_hydration' &&
          query.includes(' AS payload_bytes') &&
          !query.includes(' AS history_alias_stale')
        )
          strict++;
        if (!query.includes(' AS history_alias_stale'))
          return execute(query, params);
        batch++;
        if (fault === 'sql') throw sqlError;
        const result = await execute(query, params);
        if (fault === 'lock') controller.abort();
        if (fault === 'replace-reader')
          read.readRecord = (...args) => originalRead(...args);
        if (fault === 'oversize' && result.rows.length) {
          return {
            ...result,
            rows: result.rows.map(row => ({
              ...row,
              payload_json: null,
              payload_bytes: 8193,
            })),
          };
        }
        return result;
      };
      return work(tx);
    });
  };
  const discovery = createConversationArtifactDiscovery({
    database: f.database,
    data,
    registry,
    storage: f.storage,
  });
  return {
    run: () =>
      withConversationHistoryReadOperation(
        discovery,
        signal,
        scoped =>
          scoped.readSession({
            sessionId: 'session',
            signal,
            ids: selectConversationDisplayTurnIds(
              [{ kind: 'turn', id: denseId }],
              'session',
              signal,
              true,
            ),
          }),
        true,
      ),
    counts: () => [batch, strict],
    sqlError,
    registry,
    deleteFirst: () => f.repository.delete('health_observation', first!.id),
    close: () => {
      diagnostic.mockRestore();
      f.close();
    },
  };
}

test.each(['delete', 'mutation', 'staleness'] as const)(
  'withholds an entire root after partial %s between initial validation and alias hydration',
  async fault => {
    const f = await fixture(fault);
    try {
      if (fault === 'staleness') {
        const page = await f.run();
        expect(page.items).toEqual([]);
        expect(page.unavailableCount).toBe(1);
      } else {
        await expect(f.run()).rejects.toThrow(
          'Conversation content changed during restoration.',
        );
      }
      expect(f.counts()).toEqual([1, 0]);
    } finally {
      f.close();
    }
  },
);

test.each(['oversize', 'replace-reader'] as const)(
  '%s falls back to the original exact readers',
  async fault => {
    const f = await fixture(fault);
    try {
      expect((await f.run()).items[0]?.citations).toHaveLength(2);
      expect(f.counts()).toEqual([1, 2]);
    } finally {
      f.close();
    }
  },
);

test('SQL failure remains retryable without replaying a failed transaction', async () => {
  const f = await fixture('sql');
  try {
    await expect(f.run()).rejects.toBe(f.sqlError);
    expect(f.counts()).toEqual([1, 0]);
  } finally {
    f.close();
  }
});

test.each(['late-delete', 'lock'] as const)(
  'does not publish hydrating aliases if %s invalidates the owner',
  async fault => {
    const f = await fixture(fault);
    try {
      await expect(f.run()).rejects.toThrow(
        fault === 'lock' ? /cancel/i : /changed/i,
      );
      expect(f.counts()).toEqual([1, 0]);
    } finally {
      f.close();
    }
  },
);

test('preserves persisted source order including shared rows, and live alias replay rechecks deletion', async () => {
  const f = await fixture(undefined, true);
  try {
    const page = await f.run();
    expect(page.items[0]?.citations).toHaveLength(3);
    expect(page.items[0]?.sources).toEqual(page.items[0]?.citations);
    expect(f.counts()).toEqual([1, 0]);
    const ref = page.items[0]!.citations[0]!;
    const s = new AbortController().signal;
    expect((await f.registry.readSource(ref, s)).status).toBe('available');
    await f.deleteFirst();
    expect((await f.registry.readSource(ref, s)).status).not.toBe('available');
  } finally {
    f.close();
  }
});
