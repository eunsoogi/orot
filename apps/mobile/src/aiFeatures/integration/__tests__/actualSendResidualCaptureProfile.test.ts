import * as periodRemoval from '../../../storage/conversationPeriodRemoval';
import { previousPeriodNotRemoved } from '../../../storage/testSupport/previousPeriodNotRemoved';
import { traceSyntheticHealthSql } from '../../../../test-support/traceSyntheticHealthSql';
import { tracePeriodReaderProvenance } from '../testSupport/tracePeriodReaderProvenance';
import { appendSyntheticPriorTools } from '../testSupport/appendSyntheticPriorTools';
import { traceCaptureOwners } from '../testSupport/traceCaptureOwners';
import { NativeModules } from 'react-native';
import { createAiFeatureServices } from '../featureServices';
import { apple, selectionStore, consent } from '../featureServiceFixtures';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
/** Shipping send admission includes old direct sources, not only restored tool aliases. */
const profileEnv: Record<string, string | undefined> =
  jest.requireActual('node:process').env;
const cases = profileEnv.OROT_SYNTHETIC_RESIDUAL_CASE
  ? [profileEnv.OROT_SYNTHETIC_RESIDUAL_CASE]
  : ['nested-distinct-three', 'nested-distinct-six', 'nested-distinct-twelve'];
test.each(cases)('residual actual send retention: %s', async variant => {
  const env = profileEnv;
  const previousRemoval =
    env.OROT_SYNTHETIC_PERIOD_QUERY_BASELINE === '1'
      ? jest
          .spyOn(periodRemoval, 'assertPeriodNotRemoved')
          .mockImplementation(previousPeriodNotRemoved)
      : undefined;
  const readerTrace = tracePeriodReaderProvenance();
  const ownerTrace = traceCaptureOwners();
  const { f, data, count, original } = await actualSendRetentionFixture(
    variant,
    Number(env.OROT_SYNTHETIC_SEND_SAMPLES ?? 0),
  );
  if (env.OROT_SYNTHETIC_SAVED_TOOLS === '1')
    await appendSyntheticPriorTools(f, data, count);
  // Normalize setup warming in both variants without changing any contributor.
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'residual-outside',
    effectiveAt: '2029-01-01T00:00:00Z',
    ingestedAt: '2029-01-01T00:00:00Z',
    recordedAt: '2029-01-01T00:00:00Z',
  });
  let runnerCalls = 0,
    toolSearchCalls = 0;
  const started = performance.now();
  const marks: Record<string, number> = {};
  let phase = 'preparation';
  const queryIds = new Map<string, number>();
  const ownerQueries = new Map<string, Map<string, number>>();
  const counts = new Map<string, Map<string, number>>();
  const phaseDiagnostics: Record<string, Record<string, number>> = {};
  const previousDiagnostic = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn((_provider, stage, outcome) => {
    if (stage.startsWith('conversation_'))
      marks[`${stage}:${outcome}`] = performance.now() - started;
    if (
      stage === 'conversation_final_history_validation' &&
      outcome === 'started'
    )
      phase = 'final-history';
    if (stage === 'conversation_retention_capture' && outcome === 'started')
      phase = 'retention';
    if (outcome === 'completed' && stage.startsWith('report_sql_')) {
      const group = (phaseDiagnostics[phase] ??= {});
      group[stage] = (group[stage] ?? 0) + 1;
    }
  });
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const healthSql =
    env.OROT_SYNTHETIC_HEALTH_SQL === '1'
      ? traceSyntheticHealthSql(f.database, () => phase)
      : undefined;
  const transaction = f.database.transaction.bind(f.database);
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (/\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(args[0])) {
          const group = counts.get(phase) ?? new Map<string, number>();
          counts.set(phase, group);
          const key = JSON.stringify(args);
          if (!queryIds.has(key)) queryIds.set(key, queryIds.size + 1);
          group.set(key, (group.get(key) ?? 0) + 1);
          const owner = `${phase}:${ownerTrace.current()}`;
          const bucket = ownerQueries.get(owner) ?? new Map<string, number>();
          ownerQueries.set(owner, bucket);
          bucket.set(key, (bucket.get(key) ?? 0) + 1);
        }
        return execute(...args);
      };
      await work(tx);
    });
  const save = jest.fn(
    async (
      candidate: import('../../../ragConversation/conversationRetention').ConversationRetentionCandidate,
    ) => {
      marks.save = performance.now() - started;
      phase = 'save';
      await f.storage.append({
        ...candidate,
        id: 'saved-answer',
        sessionId: 'session',
        createdAt: '2026-11-02T00:00:00.000Z',
        status: 'complete',
      });
    },
  );
  const failure = jest.fn();
  const runner: typeof import('../../../ragConversation/service').runRagConversationTurn =
    async options => {
      runnerCalls++;
      phase = 'current-tool';
      const tool = options.workflow.tools.find(
        value => value.id === 'local-health-context',
      )!;
      toolSearchCalls++;
      const batch = await tool.search({
        operationRunId: 'synthetic-current',
        operationKey: 'health',
        input: {
          window: JSON.parse(JSON.stringify(original)),
          topics: ['measurements'],
        },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 20480,
        signal: new AbortController().signal,
      });
      if ('status' in batch || !batch.items.length)
        throw new Error('Missing synthetic health context');
      expect(options.validatedPriorTurns).toHaveLength(count);
      options.onValidatedEvidence?.(batch.items);
      return {
        status: 'answer',
        answer: 'Synthetic current answer',
        citations: batch.items,
      };
    };
  const services = createAiFeatureServices(consent, {
    loadLocalData: async () => data,
    ragRunner: runner,
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
  });
  try {
    const result = await services.sendRagMessage(
      '최근 건강 기록을 요약해 주세요',
      [],
      new AbortController().signal,
      {
        retentionSession: {
          id: 'session',
          version: (await f.storage.activeSessionVersion('session'))!,
        },
        retainedHistory: Array.from({ length: count }, (_, index) => ({
          id: `direct-${index}`,
          question: `Synthetic direct question ${index}`,
        })),
        onRetentionCandidate: save,
        onRetentionFailure: failure,
      },
    );
    marks.done = performance.now() - started;
    expect(result.status).toBe('answer');
    expect(runnerCalls).toBe(1);
    expect(toolSearchCalls).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
    const phases = Object.fromEntries(
      [...counts].map(([name, queries]) => [name, [...queries.values()]]),
    );
    const diagnostics: Record<string, number> = {};
    for (const [, stage, outcome] of report.mock.calls) {
      if (outcome === 'completed' && stage.startsWith('report_sql_'))
        diagnostics[stage] = (diagnostics[stage] ?? 0) + 1;
    }
    const ownerPhases = Object.fromEntries(
      [...ownerQueries].map(([key, values]) => [
        key,
        [...values].map(([sql, executions]) => ({
          syntheticQuery: queryIds.get(sql),
          count: executions,
        })),
      ]),
    );
    console.info(
      'SYNTHETIC_ACTUAL_SEND_RETENTION',
      JSON.stringify({
        variant,
        periodReaderRegistrations: readerTrace.stats,
        runnerCalls,
        toolSearchCalls,
        savedTools: env.OROT_SYNTHETIC_SAVED_TOOLS === '1',
        phases,
        diagnostics,
        phaseDiagnostics,
        marks,
        ownerPhases,
      }),
    );
    if (healthSql)
      console.info('SYNTHETIC_HEALTH_SQL', JSON.stringify(healthSql.summary()));
    // Exact calculation counts catch loss of reuse in normal CI, not only profiling.
    expect([...(counts.get('retention')?.values() ?? [])]).toEqual([
      ...Array(count * 2 - 2).fill(2),
      1,
      1,
    ]);
    expect(phaseDiagnostics.retention?.report_sql_unscoped ?? 0).toBe(0);
    expect([...(counts.get('save')?.values() ?? [])]).toEqual(
      Array(count * 2).fill(1),
    );
    phase = 'replay';
    const saved = await f.storage.read('saved-answer');
    expect(saved?.answer).toContain('Synthetic current answer');
    await f.repository.delete('health_observation', f.inside.id);
    await expect(f.storage.read('saved-answer')).resolves.toBeNull();
  } finally {
    ownerTrace.restore();
    readerTrace.restore();

    NativeModules.OrotProviderDiagnostics = previousDiagnostic;
    f.database.transaction = transaction;
    healthSql?.restore();
    previousRemoval?.mockRestore();
    f.close();
  }
});
