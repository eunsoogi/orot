import { providerSuccess } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { toolsFor } from '../featureServiceExecution';
import type { AiFeatureLocalData } from '../localData';
import { conversationInputsAreCurrent } from '../conversationEntryTargets';
import { guardConversationHistoryProvider } from '../conversationHistoryProviderGuard';
import { createConversationRetentionBridge } from '../conversationRetentionBridge';
import { finishConversationWorkflow } from '../finishConversationWorkflow';
import { standardSearchFixture } from '../../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';

function hold() {
  let release!: () => void;
  const pending = new Promise<void>(done => {
    release = done;
  });
  return { pending, release };
}

test.each([
  'unrelated-edit',
  'admitted-edit',
  'admitted-delete',
  'report-edit',
] as const)(
  'proof over two admitted records while one guarded dispatch is held: %s',
  async mode => {
    const { database, close } = createHealthEvidenceTestDatabase();
    const dispatched = hold();
    const response = hold();
    try {
      await runMigrations(database);
      const writer = createRecordRepository(database);
      const at = '2026-10-18T00:00:00.000Z';
      const row = (id: string) => ({
        id,
        status: 'active' as const,
        effectiveAt: at,
        ingestedAt: at,
        recordedAt: at,
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
        description: 'Synthetic curio marker.',
      });
      await writer.put('symptom_entry', row('admitted-a'));
      await writer.put('symptom_entry', row('admitted-b'));
      await writer.put('symptom_entry', row('unrelated'));
      const data: AiFeatureLocalData = {
        ...createLocalEvidenceData(database),
        repository: createLocalHealthEvidenceRepository(database),
        memoryStorage: { listRecords: async () => [] },
        loadMemoryRecords: async () => [],
        rag: {
          index: async () => {},
          search: async (_query, chunks) =>
            chunks
              .filter(chunk => !chunk.id.includes('unrelated'))
              .map(chunk => ({
                chunk,
                score: 1,
                lexicalRank: 1,
                vectorRank: 1,
              })),
        },
      };
      const registry = new LocalEvidenceReferenceRegistry();
      const signal = new AbortController().signal;
      const retrieved = await toolsFor(
        undefined,
        data,
        registry,
        6,
        true,
        'rag',
      )
        .find(tool => tool.id === 'local-personal-records')!
        .search({
          operationRunId: 'synthetic-held-proof',
          operationKey: 'tool-1',
          input: { query: 'curio' },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 6,
          maxPayloadBytes: 64 * 1024,
          signal,
        });
      if ('status' in retrieved)
        throw new Error('Synthetic source setup failed.');
      const references = retrieved.items.filter(item =>
        registry.resolve(item)?.evidenceId?.startsWith('admitted-'),
      );
      expect(references).toHaveLength(2);
      expect(
        references.map(item => registry.resolve(item)?.evidenceId).sort(),
      ).toEqual(['admitted-a', 'admitted-b']);
      const historyIsCurrent = conversationInputsAreCurrent(
        registry,
        references,
        signal,
      );
      expect(await historyIsCurrent()).toBe(true);
      const storage = createConversationArtifactStorage(database);
      await storage.createSession('owner', await storage.currentGeneration());
      const turn = createConversationTurnRetention({
        storage,
        sessionId: 'owner',
        turnId: 'turn',
        createdAt: at,
      });
      const question = 'Synthetic authored question';
      const opening = {
        callId: 'approved',
        text: 'Synthetic reviewed opening.',
      };
      await turn.startRequest(question, signal);
      await turn.persistReviewedOpening!(opening, signal, () => true);
      const saved = jest.fn(turn.save);
      const retention = createConversationRetentionBridge({
        observer: { onRetentionCandidate: saved },
        registry,
        question,
        providerId: 'fixture',
        modelId: 'fixture',
        signal,
      });
      retention.onValidatedEvidence(references);
      const provider = standardSearchFixture(true).provider;
      provider.generate.mockImplementation(async () => {
        dispatched.release();
        await response.pending;
        return providerSuccess({
          text: 'Synthetic completed explanation.',
          toolCalls: [],
          finishReason: 'complete',
        });
      });
      const guarded = guardConversationHistoryProvider(
        provider,
        historyIsCurrent,
      );
      const pending = guarded.generate(
        { messages: [{ role: 'user', content: question }] },
        { signal },
      );
      await dispatched.pending;
      if (mode === 'admitted-delete') {
        expect(await writer.delete('symptom_entry', 'admitted-a')).toBe(true);
      } else {
        await writer.put('symptom_entry', {
          ...row(mode === 'unrelated-edit' ? 'unrelated' : 'admitted-a'),
          description: 'Changed synthetic marker.',
        });
      }
      response.release();
      const result = await pending;
      if (!result.ok) throw new Error('Unexpected synthetic provider failure.');
      const continuation = jest.fn();
      const outcome = await finishConversationWorkflow({
        outcome: {
          status: 'answer',
          answer: result.value.text,
          citations: references,
        },
        observer: { onArtifactContinuation: continuation },
        generated: {
          choose: () => null,
          tools: [],
          artifactPagingSnapshot: undefined,
          researchPagingSnapshot: undefined,
          hasUnsupportedPagingState: () => false,
          hasPagingState: () => false,
          coldPaging: () => ({
            hasPagingState: false,
            researchPaging: undefined,
            artifactPaging: undefined,
          }),
        },
        localRetrievalFailed: () => false,
        historyIsCurrent:
          mode === 'report-edit' ? async () => true : historyIsCurrent,
        reportIsCurrent: mode === 'report-edit' ? historyIsCurrent : undefined,
        publicSearch: { status: 'success' },
        retention,
        signal,
      });
      expect(provider.generate).toHaveBeenCalledTimes(1);
      if (mode === 'unrelated-edit') {
        expect(outcome).toMatchObject({ status: 'answer' });
        expect(saved).toHaveBeenCalledTimes(1);
        expect(await storage.read('turn')).not.toBeNull();
      } else {
        expect(outcome).toEqual(
          mode === 'report-edit'
            ? { status: 'failure', kind: 'stale_evidence' }
            : {
                status: 'failure',
                kind: 'retrieval_failed',
                discardUnverifiedDraft: true,
              },
        );
        expect(saved).not.toHaveBeenCalled();
        if (mode !== 'report-edit') expect(continuation).not.toHaveBeenCalled();
        expect(await storage.read('turn')).toBeNull();
        await storage.interruptRecoveredRequests();
        expect(
          await storage.readSessionPresentationMany('owner', 0, ['turn']),
        ).toMatchObject(
          mode !== 'admitted-delete'
            ? [{ status: 'opening', initialResponse: opening }]
            : [{ status: 'interrupted' }],
        );
      }
    } finally {
      response.release();
      close();
    }
  },
);
