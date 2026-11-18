import { createAiFeatureServices } from '../featureServices';
import { consent } from '../featureServiceFixtures';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { isPeriodSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { createConversationLocalAccess } from '../conversationLocalAccess';
import { createConversationSessionStorage } from '../conversationSessionStorage';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';

/** Real artifact pages mix generated parents with directly captured period sources. */
test.each(['same', 'reordered', 'distinct'] as const)(
  'shipping artifact page distinguishes %s scopes from repeated calculations',
  async variant => {
    const f = await sharedAncestryProfileFixture(1, false);
    const data = await f.input.loadLocalData();
    data.readHealthContext = createLocalEvidenceData(
      f.database,
    ).readHealthContext!;
    registerConversationReadOperation(data, async (scoped, registry) =>
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: createSymptomSummaryStorage(f.database),
        data: scoped,
        registry,
      }),
    );
    const artifact = (await f.storage.read('turn-0'))!;
    const summary = (await createSymptomSummaryStorage(f.database).read(
      'summary-0',
    ))!;
    const source = summary.sources.find(isPeriodSummarySource)!;
    for (let index = 1; index <= 2; index++) {
      const original = source.scope.window;
      const window =
        variant === 'reordered'
          ? {
              timeZone: original.timeZone,
              toExclusive: original.toExclusive,
              fromInclusive: original.fromInclusive,
            }
          : {
              ...original,
              ...(variant === 'distinct'
                ? {
                    toExclusive: new Date(
                      Date.UTC(2026, 9, 2 + index),
                    ).toISOString(),
                  }
                : {}),
            };
      const item = registerHealthContextEvidence({
        registry: f.input.registry,
        read: data.readHealthContext!,
        report: await data.readHealthContext!(window, [source.scope.topic]),
        scope: { ...source.scope, window },
      });
      const captured = await captureConversationToolSources(
        {
          version: 1,
          operationRunId: 'synthetic-run',
          callId: `synthetic-call-${index}`,
          toolName: 'health',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: item.sourceKind },
          resultSummary: { referenceCount: 1 },
          sources: [item],
        },
        f.input.registry,
      );
      const periods = captured.dependencies.filter(
        (dependency): dependency is typeof source =>
          'kind' in dependency && dependency.kind === 'health_context_period',
      );
      expect(periods).toHaveLength(1);
      await f.storage.append({
        ...artifact,
        id: `direct-${index}`,
        sources: periods,
        citations: periods.map(dependency => dependency.reference),
      });
    }
    // Match the shipping localData composition rather than injecting one raw store.
    const nativeTransaction = f.database.transaction.bind(f.database);
    let queue = Promise.resolve();
    f.database.transaction = work => {
      const next = queue.then(() => nativeTransaction(work));
      queue = next.catch(() => undefined);
      return next;
    };
    Object.assign(
      data,
      createConversationLocalAccess(f.database, () => data, {
        storage: async () =>
          jest.requireActual('../../../storage/conversationArtifactStorage'),
        notifications: async () =>
          jest.requireActual(
            '../../../replyNotifications/replyNotificationStorage',
          ),
        discovery: async () =>
          jest.requireActual('../conversationArtifactDiscovery'),
      }),
    );
    const open = createConversationSessionStorage(f.input.loadLocalData);
    await open();
    // Invalidate the bounded global report cache without changing this source window.
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'future-profile',
      effectiveAt: '2027-01-01T00:00:00Z',
      ingestedAt: '2027-01-01T00:00:00Z',
      recordedAt: '2027-01-01T00:00:00Z',
    });
    const services = createAiFeatureServices(consent, {
      loadLocalData: async () => data,
    });
    const options = services.conversationSessionOptions();
    const transaction = f.database.transaction.bind(f.database);
    const queries = new Map<string, number>();
    let aggregateMs = 0;
    let allSqlMs = 0;
    let sqlCount = 0;
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          const start = performance.now();
          const result = await execute(...args);
          const elapsed = performance.now() - start;
          allSqlMs += elapsed;
          sqlCount++;
          if (/WITH days\(/.test(args[0])) {
            aggregateMs += elapsed;
            const key = JSON.stringify(args);
            queries.set(key, (queries.get(key) ?? 0) + 1);
          }
          return result;
        };
        await work(tx);
      });
    try {
      const page = await options.restoreSessionPage!(
        'session',
        new AbortController().signal,
      );
      expect(page.turns).toHaveLength(3);
      expect(page.turns[0]!.answer).toBe(artifact.answer);

      console.info(
        'SYNTHETIC_ARTIFACT_HISTORY',
        JSON.stringify({
          uniqueQueries: queries.size,
          aggregateMs,
          allSqlMs,
          sqlCount,
          exactRepeatCounts: [...queries.values()],
        }),
      );
      expect([...queries.values()]).toEqual(
        variant === 'distinct' ? [1, 1, 1, 1, 1, 1] : [1, 1],
      );
      await f.repository.delete('health_observation', f.inside.id);
      const afterDelete = await options.restoreSessionPage!(
        'session',
        new AbortController().signal,
      );
      // Every source window above contains the deleted contributor. Remaining
      // rows may only be metadata notices, never the original protected answer.
      expect(
        afterDelete.turns.filter(turn => !turn.historyUnavailable),
      ).toEqual([]);
      for (const turn of afterDelete.turns) {
        expect(turn.question).toBe('');
        expect(turn.answer).not.toBe(artifact.answer);
        expect(turn.citations).toEqual([]);
      }
    } finally {
      f.database.transaction = transaction;
      f.close();
    }
  },
);
