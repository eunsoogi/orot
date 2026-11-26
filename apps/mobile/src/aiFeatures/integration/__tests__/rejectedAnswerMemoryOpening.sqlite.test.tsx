import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getRagConversationFailureCopy } from '../../../ragConversation/copy';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createRagConversationService } from '../ragConversationService';
import { apple, localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { installReceiptFixturePlatform } from '../testSupport/conversationReceiptFixturePlatform';
import { mountVisibleAnswerReceiptFixture } from '../testSupport/mountVisibleAnswerReceiptFixture';

const previous = {
  id: 'synthetic-grounded-answer',
  sessionId: 'synthetic-answer-session',
  sessionVersion: 0,
  createdAt: '2026-11-25T00:00:00.000Z',
  question: 'Synthetic preceding question.',
};
const request = {
  id: 'synthetic-bookmark-request',
  createdAt: '2026-11-25T00:00:01.000Z',
  question: 'Keep the answer just above.',
};
const original = 'Synthetic previous answer with an actual protected source.';
const opening = 'I have saved that answer to this device.';
const proposal = 'Untrusted final claim of local storage.';
const target = { target: 'previous_completed_answer' };

function hold() {
  let release!: () => void;
  const reached = new Promise<void>(resolve => {
    release = resolve;
  });
  return { reached, release };
}

test.each(['apple', 'chatgpt'] as const)(
  '%s renders one failure and no conflicting opening after the original disappears',
  async kind => {
    const f = await healthContextFixture();
    const storage = createConversationArtifactStorage(f.database);
    const allow = hold();
    let view:
      Awaited<ReturnType<typeof mountVisibleAnswerReceiptFixture>> | undefined;
    const restorePlatform = installReceiptFixturePlatform(() => {});
    try {
      const remote = kind === 'chatgpt';
      const untrustedProvider = jest.fn(async () => {
        throw new Error('No provider generation in a synthetic runner');
      });
      const provider = {
        id: remote ? 'chatgpt-plan:synthetic' : apple.provider.id,
        kind: apple.provider.kind,
        displayName: apple.provider.displayName,
        capabilities: { ...apple.provider.capabilities, toolCalling: true },
        generate: untrustedProvider,
      };
      await storage.createSession(
        previous.sessionId,
        await storage.currentGeneration(),
      );
      await storage.startRequest(previous);
      await storage.append({
        ...previous,
        providerId: provider.id,
        modelId: apple.modelId,
        answer: original,
        status: 'complete',
        sources: f.saved.sources,
      });
      const confirmation = jest.fn(async () => {
        await allow.reached;
        return true;
      });
      const runner: typeof runRagConversationTurn = async options => {
        const action = options.workflow.actions?.find(
          item => item.id === 'remember-conversation-answer',
        );
        if (action?.completion !== 'host_terminal')
          throw new Error(
            'The existing protected terminal action was not eligible.',
          );
        const signal = new AbortController().signal;
        const operation = {
          operationRunId: options.workflow.execution.operationRunId,
          operationKey: 'tool-1',
        };
        if (await action.authorize(target, signal, operation)) {
          await expect(
            action.execute({ input: target, ...operation, signal }),
          ).rejects.toThrow();
        }
        return { status: 'answer', answer: proposal, citations: [] };
      };
      const approve = jest.fn(async () => 'authorized' as const);
      const externalSearch = jest.fn();
      const send = createRagConversationService({
        selectedAi: async () => ({
          status: 'ready',
          selection: { providerId: provider.id, modelId: apple.modelId },
          option: apple,
          provider,
          modelId: apple.modelId,
          recipient: 'Synthetic selected model',
          remoteProcessing: remote,
        }),
        consent: { authorize: approve },
        queryConsent: { authorize: approve },
        externalEvidence: { search: externalSearch },
        registry: new LocalEvidenceReferenceRegistry(),
        loadLocalData: async () => ({
          ...localData([]).data,
          openConversationArtifactStorage: async () => storage,
        }),
        ragRunner: runner,
      });
      view = await mountVisibleAnswerReceiptFixture({
        storage,
        previous,
        request,
        answer: original,
        onSend: async (question, history, signal, observer) => {
          if (!observer?.onReviewedOpening || !signal)
            throw new Error('The exact mounted opening owner was absent.');
          expect(
            await observer.onReviewedOpening(
              { callId: 'synthetic-reviewed-opening', text: opening },
              signal,
            ),
          ).toBe(true);
          return send(question, history, signal, {
            ...observer,
            inputOrigin: 'composer',
            confirmHistorySave: confirmation,
            ...(!remote ? { protectedLocalInput: true as const } : {}),
            suppressContextualOpening: true,
            ...(remote
              ? {
                  expectedConversationModel: {
                    providerId: provider.id,
                    modelId: apple.modelId,
                  },
                  templateProposalOwner: {
                    providerId: provider.id,
                    modelId: apple.modelId,
                    current: () => true,
                    recheck: async () => true,
                    watch: () => () => {},
                  },
                }
              : {}),
          });
        },
      });
      expect(await screen.findByText(original)).toBeTruthy();
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        request.question,
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      expect(await screen.findByText(opening)).toBeTruthy();
      // Await the real approved preview before changing its underlying storage.
      await waitFor(() => expect(confirmation).toHaveBeenCalledTimes(1));
      const savedOpening = await f.database.execute(
        'SELECT reviewed_opening_json FROM conversation_requests WHERE id = ?',
        [request.id],
      );
      expect(savedOpening.rows[0]?.reviewed_opening_json).toEqual(
        expect.any(String),
      );
      await act(async () => {
        await f.repository.delete('health_observation', f.inside.id);
        allow.release();
      });
      const specific = getRagConversationFailureCopy('answer_memory_not_saved');
      await screen.findByTestId('rag-conversation-error');
      expect(screen.queryByText(opening)).toBeNull();
      expect(screen.getAllByText(specific)).toHaveLength(1);
      expect(screen.queryByText(proposal)).toBeNull();
      expect(untrustedProvider).not.toHaveBeenCalled();
      expect(externalSearch).not.toHaveBeenCalled();
      const reopened = createConversationArtifactStorage(f.database);
      expect(await reopened.listSavedConversationAnswers()).toEqual([]);
      await reopened.interruptRecoveredRequests();
      const historyAfterLoss = await reopened.readSessionPresentationMany(
        previous.sessionId,
        previous.sessionVersion,
        [request.id],
      );
      expect(JSON.stringify(historyAfterLoss)).not.toContain(opening);
    } finally {
      allow.release();
      await view?.unmount();
      restorePlatform();
      f.close();
    }
  },
);
