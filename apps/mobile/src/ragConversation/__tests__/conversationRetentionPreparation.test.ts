import { commitHealthKitChanges } from '../../healthkit/commitHealthKitChanges';
import { subscribeLocalSourceDeletion } from '../../storage/localDataClearEvents';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';

test.each([false, true])(
  'retries a temporary write failure without generating again (HealthKit deletion: %s)',
  async deleteUnrelated => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      let sequence = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `id-${++sequence}`,
        now: () => '2026-10-05T00:00:00.000Z',
      });
      const store = createConversationSessions({ retention });
      const prepare = jest.fn(async () => ({
        question: 'question',
        answer: 'answer',
        providerId: 'provider',
        modelId: 'model',
        sources: deleteUnrelated ? [] : f.saved.sources,
        citations: deleteUnrelated ? [] : [f.saved.sources[0]!.reference],
      }));
      const sender = jest.fn(async (_q, _history, _signal, observer) => {
        observer.onRetentionFailure(prepare);
        return {
          status: 'answer' as const,
          answer: 'answer',
          citations: [],
          healthSources: deleteUnrelated ? [] : (true as const),
        };
      });
      store.setDraft(1, 'question');
      await store.send(1, sender);
      expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
      if (deleteUnrelated) {
        const unsubscribe = subscribeLocalSourceDeletion(
          store.refreshAfterSourceDeletion,
        );
        try {
          await commitHealthKitChanges(f.repository, async writer =>
            Number(await writer.delete('health_observation', f.inside.id)),
          );
        } finally {
          unsubscribe();
        }
        expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
        expect(store.getSnapshot().sessions[0]?.messages.at(-1)?.content).toBe(
          'answer',
        );
      }
      await store.retrySave(1);
      expect((await storage.read('id-2'))?.answer).toBe('answer');
      expect(sender).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledTimes(1);
      store.dispose();
    } finally {
      f.close();
    }
  },
);

test('a validated partial candidate retains its completion status', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const turn = await retention.beginTurn(1, new AbortController().signal);
    await turn.save(
      {
        question: 'question',
        answer: 'partial answer',
        providerId: 'provider',
        modelId: 'model',
        status: 'partial',
        sources: f.saved.sources,
        citations: [f.saved.sources[0]!.reference],
      },
      new AbortController().signal,
    );
    expect((await storage.read('id-2'))?.status).toBe('partial');
  } finally {
    f.close();
  }
});

test('the retention bridge retries transient source capture through the real store', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const source = f.saved.sources[0]!;
    if (!isPeriodSummarySource(source))
      throw new Error('Expected a period source.');
    let first = true;
    const registry = new LocalEvidenceReferenceRegistry();
    const item = registry.add({
      reference: source.reference,
      content: 'synthetic evidence',
      validate: async () => true,
      readSource: async () => {
        if (first) {
          first = false;
          return { status: 'unavailable' };
        }
        return {
          status: 'available',
          document: {
            sourceKind: 'health_context_period',
            scope: source.scope,
            report: f.report,
          },
        };
      },
    });
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    const sender = jest.fn(async (_q, _history, signal, observer) => {
      const bridge = createConversationRetentionBridge({
        observer,
        registry,
        question: 'question',
        providerId: 'provider',
        modelId: 'model',
        signal: signal!,
      });
      const citation = referenceOnly(item);
      bridge.onValidatedEvidence([citation]);
      return (
        await bridge.finish({
          status: 'answer',
          answer: 'answer',
          citations: [citation],
        })
      ).outcome;
    });
    store.setDraft(1, 'question');
    await store.send(1, sender);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    await store.retrySave(1);
    expect((await storage.read('id-2'))?.answer).toBe('answer');
    expect(sender).toHaveBeenCalledTimes(1);
    store.dispose();
  } finally {
    f.close();
  }
});

test('unsupported generated lineage is reported without an endless retry', async () => {
  const registry = new LocalEvidenceReferenceRegistry();
  const item = registry.add({
    reference: {
      sourceKind: 'generated_artifact',
      sourceId: 'parent',
      sourceRevision: '1',
      evidenceId: 'parent',
      evidenceRevision: '1',
      locator: {},
      effectiveTime: null,
      reviewState: 'unreviewed',
    },
    content: 'previous answer',
    validate: async () => true,
    readSource: async () => ({
      status: 'available',
      document: {
        sourceKind: 'generated_artifact',
        metadata: {} as never,
        analysis: { hypotheses: [] },
        sourceStatus: 'current',
      },
    }),
  });
  const failure = jest.fn();
  const bridge = createConversationRetentionBridge({
    observer: {
      onRetentionCandidate: jest.fn(async () => {}),
      onRetentionFailure: failure,
    },
    registry,
    question: 'question',
    providerId: 'provider',
    modelId: 'model',
    signal: new AbortController().signal,
  });
  const citation = referenceOnly(item);
  bridge.onValidatedEvidence([citation]);
  await bridge.finish({
    status: 'answer',
    answer: 'answer',
    citations: [citation],
  });
  expect(failure).toHaveBeenCalledWith(undefined);
});

test('a removed source leaves no permanently failing retry in the queue', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    store.setDraft(1, 'question');
    await store.send(1, async (_q, _history, _signal, observer) => {
      observer!.onRetentionFailure!(async () => {
        throw new RetainedSourceInvalidError('removed');
      });
      return { status: 'answer', answer: 'answer', citations: [] };
    });
    await store.retrySave(1);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
    expect(store.getSnapshot().sessions[0]?.error).toContain('원본이 변경');
    expect(await storage.read('id-2')).toBeNull();
    store.dispose();
  } finally {
    f.close();
  }
});
