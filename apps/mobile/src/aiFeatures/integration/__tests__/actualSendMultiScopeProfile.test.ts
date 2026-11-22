import * as authority from '../boundCaptureAuthority';
import { traceCaptureOwners } from '../testSupport/traceCaptureOwners';
import { NativeModules } from 'react-native';
import { createAiFeatureServices } from '../featureServices';
import { apple, selectionStore, consent } from '../featureServiceFixtures';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
/** Shipping send admission includes old direct sources, not only restored tool aliases. */
test.each(['nested-topics-three', 'nested-topics-six'] as const)(
  'actual send retention: %s',
  async variant => {
    const env: Record<string, string | undefined> =
      jest.requireActual('node:process').env;
    const baseline =
      env.OROT_SYNTHETIC_BOUND_BASELINE === '1'
        ? jest
            .spyOn(authority, 'ownsBoundCaptureAuthority')
            .mockReturnValue(false)
        : undefined;
    const ownerTrace = traceCaptureOwners();
    const { f, data, count, original } = await actualSendRetentionFixture(
      variant,
      Number(env.OROT_SYNTHETIC_SEND_SAMPLES ?? 0),
    );
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
    const transaction = f.database.transaction.bind(f.database);
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          if (
            /\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(args[0])
          ) {
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
        phase = 'current-tool';
        const tool = options.workflow.tools.find(
          value => value.id === 'local-health-context',
        )!;
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
          phases,
          diagnostics,
          phaseDiagnostics,
          marks,
          ownerPhases,
        }),
      );
      // History remains dialogue-only across pre-dispatch and terminal checks.
      expect([...counts.keys()]).toEqual(['current-tool', 'save']);
      expect([...(counts.get('current-tool')?.values() ?? [])]).toEqual([1, 1]);
      expect([...(counts.get('save')?.values() ?? [])]).toEqual([1, 1]);
      phase = 'replay';
      const saved = await f.storage.read('saved-answer');
      expect(saved?.answer).toContain('Synthetic current answer');
      expect(
        saved?.historicalDialogueParents?.map(parent => parent.id),
      ).toEqual(Array.from({ length: count }, (_, index) => `direct-${index}`));
      expect(saved?.citations?.length).toBeGreaterThan(0);
      expect(
        saved?.sources.some(
          source =>
            'kind' in source && source.kind === 'generated_conversation',
        ),
      ).toBe(false);
      await f.repository.delete('health_observation', f.inside.id);
      await expect(f.storage.read('saved-answer')).resolves.toBeNull();
    } finally {
      ownerTrace.restore();
      baseline?.mockRestore();
      NativeModules.OrotProviderDiagnostics = previousDiagnostic;
      f.database.transaction = transaction;
      f.close();
    }
  },
);
