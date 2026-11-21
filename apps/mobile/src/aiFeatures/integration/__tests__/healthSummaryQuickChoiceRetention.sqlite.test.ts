import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { savedHistoryTranscript } from '../../../ragConversation/conversationSavedHistoryDisplay';
import { t } from '../../../i18n';
import { createAiFeatureServices } from '../featureServices';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

test('reopening the selected session restores the saved quick-choice summary and its section citations', async () => {
  const f = await healthContextFixture();
  try {
    const runner: typeof runDiseaseHypothesisAnalysis = async (
      options,
      _inventory,
      invocation,
    ) => {
      const batch = await options.tools[0]!.search({
        operationRunId: 'summary',
        operationKey: 'read',
        input: { window, topics: ['measurements'] },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 20480,
        signal: invocation!.signal!,
      });
      if ('status' in batch || !batch.items[0])
        throw new Error('Missing period');
      const item = batch.items[0];
      return {
        status: 'workflow',
        result: {
          status: 'result',
          value: {
            ...f.saved.analysis,
            hypotheses: f.saved.analysis.hypotheses.map(section => ({
              ...section,
              supportingEvidence: [item],
            })),
          },
          checkpoint: { evidenceReferences: [item] },
          citations: [item],
        },
      } as never;
    };
    const storage = createConversationArtifactStorage(f.database);
    const services = () =>
      createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => ({
          ...localData([]).data,
          readHealthContext: f.read,
          openConversationArtifactStorage: async () => storage,
        }),
        summaryStorage: async () => f.storage,
        diseaseRunner: runner,
        createOperationRunId: () => 'summary',
      });
    const original = services();
    const live = createConversationSessions(
      original.conversationSessionOptions!(),
    );
    try {
      await live.synchronizeModel();
      const id = live.getSnapshot().activeId;
      const question = t('conversationIntent.healthSummary');
      await live.sendQuickPrompt(
        id,
        question,
        (prompt, history, signal, observer) =>
          original.sendRagMessage(prompt, history, signal, observer, {
            intent: 'health-summary',
            entryKey: 'summary-quick-choice',
          }),
      );
      const completed = live
        .getSnapshot()
        .sessions.find(session => session.id === id)
        ?.messages.find(message => message.healthSummary);
      expect(completed?.retainedTurnId).toEqual(expect.any(String));
      const summary = completed!.healthSummary!;
      expect(summary.analysis.savedSummary?.status).toBe('saved');
      const retained = await storage.read(completed!.retainedTurnId!);
      expect(retained).toMatchObject({
        status: 'complete',
        question,
        healthSummary: summary.reference,
      });
      expect(await f.storage.list()).toHaveLength(1);
      live.dispose();
      const reopened = createConversationSessions(
        services().conversationSessionOptions!(),
      );
      try {
        await reopened.synchronizeModel();
        const snapshot = reopened.getSnapshot();
        const session = snapshot.sessions.find(
          row => row.id === snapshot.activeId,
        )!;
        const assistant = savedHistoryTranscript(
          session.savedHistoryDisplay ?? [],
          session.messages,
        ).find(message => message.healthSummary);
        expect(assistant?.healthSummary?.reference).toEqual(summary.reference);
        expect(assistant?.healthSummary?.analysis.hypotheses[0]?.summary).toBe(
          summary.analysis.hypotheses[0]?.summary,
        );
        expect(
          assistant?.healthSummary?.archivedSectionCitations?.[0],
        ).toHaveLength(1);
        expect(assistant?.archivedCitationTarget?.turnId).toBe(
          completed?.retainedTurnId,
        );
      } finally {
        reopened.dispose();
      }
    } finally {
      live.dispose();
    }
  } finally {
    f.close();
  }
});
