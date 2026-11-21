import { selectConversationDisplayTurnIds } from '../conversationFirstDisplaySelection';
import * as diagnostics from '../../../providers/diagnostics';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import * as facts from '../healthOverviewFacts';
import { restoreRetainedSources } from '../restoreRetainedSources';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

test('history restores all dense record aliases without projecting unused summary review', async () => {
  const f = await quarantinedHistoryFixture();
  let hydrate = false;
  const timing = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, stage, outcome) => {
      if (stage === 'artifact_source_hydration')
        hydrate = outcome === 'started';
    });
  const project = jest.spyOn(facts, 'healthOverviewFacts');
  try {
    const data = {
      ...(await f.input.loadLocalData()),
      ...createLocalEvidenceData(f.database),
      repository: createLocalHealthEvidenceRepository(f.database),
    };
    const sources = [];
    for (let index = 0; index < 96; index++) {
      const id = `record-for-synthetic-alias-${index}`;
      const record = { ...f.inside, id };
      await f.repository.put('health_observation', record);
      const revision = fingerprint(record);
      sources.push({
        reference: {
          sourceKind: 'personal_record' as const,
          sourceId: id,
          sourceRevision: revision,
          evidenceId: id,
          evidenceRevision: revision,
          effectiveTime: record.effectiveAt,
          reviewState: 'unknown' as const,
          locator: { kind: 'record' as const, id },
        },
        records: [{ kind: 'health_observation' as const, id, revision }],
      });
    }
    const template = (await f.storage.read('newer'))!;
    await f.storage.append({
      ...template,
      id: 'dense',
      createdAt: '2026-10-07T00:00:00.000Z',
      sources,
      citations: sources.map(source => source.reference),
    });
    const directTransaction = f.database.transaction.bind(f.database);
    const directExecute = f.database.execute.bind(f.database);
    const counts: number[][] = [];
    f.database.transaction = async work => {
      if (hydrate) counts.at(-1)![0]++;
      return directTransaction(tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (query, bindings) => {
          if (hydrate) {
            counts.at(-1)![1]++;
            if (query.includes('history_alias_stale')) counts.at(-1)![2]++;
          }
          return execute(query, bindings);
        };
        return work(tx);
      });
    };
    f.database.execute = (query, bindings) => {
      if (hydrate) counts.at(-1)![1]++;
      return directExecute(query, bindings);
    };
    const readRecord = data.repository.readRecord;
    let outputDigest: string | undefined;
    for (let trial = 0; trial < 2; trial++) {
      const batching = trial % 2 === 1;
      // A new custom callback removes the independently issued factory authority.
      data.repository.readRecord = batching
        ? readRecord
        : (...args) => readRecord(...args);
      const registry = new LocalEvidenceReferenceRegistry();
      const discovery = createConversationArtifactDiscovery({
        database: f.database,
        storage: f.storage,
        registry,
        data,
      });
      const signal = new AbortController().signal;
      counts.push([0, 0, 0]);
      const page = await withConversationHistoryReadOperation(
        discovery,
        signal,
        scoped =>
          scoped.readSession({
            sessionId: 'session',
            signal,
            ids: selectConversationDisplayTurnIds(
              [{ kind: 'turn', id: 'dense' }],
              'session',
              signal,
              true,
            ),
          }),
        true,
      );
      expect(counts.at(-1)).toEqual(batching ? [1, 1, 1] : [96, 192, 0]);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.citations).toHaveLength(96);
      const digest = fingerprint(page);
      outputDigest ??= digest;
      expect(digest).toBe(outputDigest);
    }
    // The summary reader's explicit review evidence must remain available.
    expect(project).not.toHaveBeenCalled();
    const summary = await restoreRetainedSources(
      sources.slice(0, 1),
      new LocalEvidenceReferenceRegistry(),
      data,
    );
    expect(summary.sourceChanged).toBe(false);
    expect(summary.reviewEvidence).toHaveLength(1);
    expect(project).toHaveBeenCalledTimes(1);
  } finally {
    project.mockRestore();
    timing.mockRestore();
    f.close();
  }
});
