import { assertConversationArtifactCurrent } from '../../../storage/conversationArtifactFreshness';
import * as diagnostics from '../../../providers/diagnostics';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';

test('coalesces dense retained record fences without publishing a late deletion', async () => {
  const f = await quarantinedHistoryFixture();
  const directTransaction = f.database.transaction.bind(f.database);
  const registry = new LocalEvidenceReferenceRegistry();
  const data = {
    ...(await f.input.loadLocalData()),
    ...createLocalEvidenceData(f.database),
    repository: createLocalHealthEvidenceRepository(f.database),
  };
  const discovery = createConversationArtifactDiscovery({
    database: f.database,
    storage: f.storage,
    registry,
    data,
  });
  const ids = ['dense', 'newer'];
  const stages = ['artifact_initial_validation', 'artifact_final_validation'];
  let activeStage;
  let rejectBulk = false;
  const bulkError = new Error('Synthetic retained-source SQL error');
  let deleteBeforeFinal = false;
  let deleted = false;
  const reads = [0, 0];
  const signals = () => new AbortController().signal;
  const read = (historyPage, owner = discovery) => {
    const signal = signals();
    return withConversationHistoryReadOperation(
      owner,
      signal,
      scoped => scoped.readSession({ sessionId: 'session', signal, ids }),
      historyPage,
    );
  };
  const diagnostic = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, stage, outcome) => {
      if (!stages.includes(stage)) return;
      activeStage = outcome === 'started' ? stages.indexOf(stage) : undefined;
    });
  try {
    const sources = [];
    for (let index = 0; index < 96; index++) {
      const id = `synthetic-history-record-${index}`;
      const record = { ...f.inside, id };
      await f.repository.put('health_observation', record);
      const revision = fingerprint(record);
      const reference = {
        sourceKind: 'personal_record',
        sourceId: id,
        sourceRevision: revision,
        evidenceId: id,
        evidenceRevision: revision,
        effectiveTime: record.effectiveAt,
        reviewState: 'unknown',
        locator: { kind: 'record', id },
      };
      sources.push({
        reference,
        records: [{ kind: 'health_observation', id, revision }],
      });
    }
    const template = await f.storage.read('newer');
    await f.storage.append({
      ...template,
      id: 'dense',
      createdAt: '2026-10-07T00:00:00.000Z',
      sources,
      citations: sources.map(source => source.reference),
    });
    f.database.transaction = async operation => {
      if (deleteBeforeFinal && !deleted && activeStage === 1) {
        deleted = true;
        await f.repository.delete(
          'health_observation',
          sources[0].records[0].id,
        );
      }
      return directTransaction(tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (sql, parameters) => {
          if (activeStage !== undefined && sql.includes(' AS source_json'))
            reads[activeStage]++;
          if (
            rejectBulk &&
            activeStage === 0 &&
            sql.includes('UNION ALL') &&
            sql.includes(' AS source_json')
          ) {
            rejectBulk = false;
            throw bulkError;
          }
          return execute(sql, parameters);
        };
        return operation(tx);
      });
    };
    const hydrationReads = f.storage.beginReadOperation(signals(), {
      historyPage: true,
    });
    expect(hydrationReads).toBeDefined();
    try {
      activeStage = 0;
      expect(
        (await hydrationReads.readMany(['dense']))[0].citations,
      ).toHaveLength(96);
      expect(reads).toEqual([96, 0]);
    } finally {
      activeStage = undefined;
      hydrationReads?.dispose();
      reads.fill(0);
    }
    const baseline = await read(false);
    expect(reads).toEqual([96, 96]);
    reads.fill(0);
    // Each restoration owns its own alias registry; do not compare ephemeral
    // token counters from a registry that was used in a previous restoration.
    const owner = createConversationArtifactDiscovery({
      database: f.database,
      storage: f.storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data,
    });
    const restored = await read(true, owner);
    expect(reads).toEqual([1, 1]);
    expect(restored).toEqual(baseline);
    expect(restored.items.map(item => item.id)).toEqual(ids);
    expect(restored.items[0].citations).toHaveLength(96);
    rejectBulk = true;
    await expect(read(true)).rejects.toBe(bulkError);
    expect(rejectBulk).toBe(false);
    expect((await read(true)).items.map(item => item.id)).toEqual(ids);
    deleteBeforeFinal = true;
    await expect(read(true)).rejects.toThrow(
      'Conversation content changed during restoration.',
    );
    expect(deleted).toBe(true);
    expect(
      await f.repository.get('health_observation', sources[0].records[0].id),
    ).toBeNull();
    expect((await read(true)).items.map(item => item.id)).toEqual(['newer']);
  } finally {
    diagnostic.mockRestore();
    f.database.transaction = directTransaction;
    f.close();
  }
});

test('uses strict source order before batching a conflicting lineage', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const template = await f.storage.read('newer');
    const current = {
      kind: 'health_observation',
      id: f.inside.id,
      revision: fingerprint(f.inside),
    };
    const source = records => ({
      reference: {
        sourceKind: 'personal_record',
        sourceId: 'synthetic-source',
        evidenceId: 'synthetic-evidence',
      },
      records,
    });
    const missing = source([{ ...current, id: 'synthetic-missing-record' }]);
    const conflict = source([
      current,
      { ...current, revision: 'synthetic-conflict' },
    ]);
    let bulkQueries = 0;
    const verify = sources =>
      f.database.transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (sql, values) => {
          if (sql.includes('UNION ALL') && sql.includes(' AS source_json'))
            bulkQueries++;
          return execute(sql, values);
        };
        await assertConversationArtifactCurrent(
          tx,
          f.database,
          { ...template, sources },
          false,
          undefined,
          undefined,
          false,
          () => true,
        );
      });
    await expect(verify([missing, conflict])).rejects.toThrow(
      'A cited source was removed before saving.',
    );
    await expect(verify([conflict, missing])).rejects.toThrow(
      'A cited source has conflicting saved revisions.',
    );
    expect(bulkQueries).toBe(0);
  } finally {
    f.close();
  }
});
