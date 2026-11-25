import { installReceiptFixturePlatform } from '../testSupport/conversationReceiptFixturePlatform';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../../../ragConversation/ConversationSessionsContext';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { apple, localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { LocalActionTool } from '@orot/agent-runtime';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { conversationAnswerMemoryAction } from '../conversationAnswerMemoryAction';
import { answerMemoryOutcome } from '../finishConversationWorkflow';
import type { AiFeatureLocalData } from '../localData';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

const previous = {
  id: 'synthetic-answer',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  createdAt: '2026-11-25T00:00:00.000Z',
  question: 'Synthetic local-record question.',
};
const request = {
  ...previous,
  id: 'synthetic-follow-up',
  createdAt: '2026-11-25T00:00:01.000Z',
  question: 'Please remember the preceding reply.',
};
const text = 'Synthetic answer from a previously validated record.';
const toolInput = { target: 'previous_completed_answer' };

async function setup() {
  const f = await healthContextFixture();
  const storage = createConversationArtifactStorage(f.database);
  try {
    await storage.createSession(
      previous.sessionId,
      await storage.currentGeneration(),
    );
    await storage.startRequest(previous);
    await storage.append({
      id: previous.id,
      sessionId: previous.sessionId,
      createdAt: previous.createdAt,
      question: previous.question,
      providerId: 'synthetic-device-model',
      modelId: 'synthetic-model',
      answer: text,
      status: 'complete',
      sources: f.saved.sources,
    });
    await storage.startRequest(request);
    let live = true;
    const confirm = jest.fn(async () => true);
    const action = conversationAnswerMemoryAction({
      data: {
        openConversationArtifactStorage: async () => storage,
      } as AiFeatureLocalData,
      observer: {
        inputOrigin: 'composer',
        retentionSession: { id: previous.sessionId, version: 0 },
        retentionRequestId: request.id,
        retainedHistory: [{ id: previous.id, question: previous.question }],
        expectedConversationModel: {
          providerId: 'synthetic-device-model',
          modelId: 'synthetic-model',
          isCurrent: () => live,
        },
        confirmHistorySave: confirm,
      },
      admittedAnswerIds: new Set([previous.id]),
    });
    const signal = new AbortController().signal;
    const tool = action.actions[0]!;
    const dispatch = (): ReturnType<LocalActionTool['execute']> =>
      tool.execute({
        input: toolInput,
        signal,
        operationRunId: 'synthetic-operation',
        operationKey: 'synthetic-key',
      });
    return {
      ...f,
      storage,
      tool,
      action,
      confirm,
      signal,
      dispatch,
      retire: () => {
        live = false;
      },
    };
  } catch (error) {
    f.close();
    throw error;
  }
}

test('books the exact original locally, without storing command or answer text in the pin', async () => {
  const f = await setup();
  try {
    expect(
      f.tool.parseInput({ target: 'synthetic-wrong-turn' }),
    ).toBeUndefined();
    expect(await f.tool.authorize(toolInput, f.signal)).toBe(true);
    expect(f.confirm).toHaveBeenCalledWith(text, f.signal);
    expect(f.action.receipt()).toBe('not_saved');
    expect(await f.dispatch()).toEqual({
      items: [],
      coverage: [],
      conflicts: [],
    });
    expect(
      answerMemoryOutcome({ status: 'no_evidence' }, f.action.receipt()),
    ).toMatchObject({ status: 'answer', committedAnswerMemory: true });
    const reopened = createConversationArtifactStorage(f.database);
    const pins = await reopened.listSavedConversationAnswers();
    expect(pins).toEqual([
      { artifactId: previous.id, savedAt: expect.any(String) },
    ]);
    expect(
      await reopened.readSavedConversationAnswer(previous.id, () => true),
    ).toBe(text);

    await f.repository.delete('health_observation', f.inside.id);
    expect(await reopened.listSavedConversationAnswers()).toEqual([]);
    expect(
      await reopened.readSavedConversationAnswer(previous.id, () => true),
    ).toBeNull();
  } finally {
    f.close();
  }
});

test.each(['original', 'owner'] as const)(
  'does not save after losing the confirmed %s',
  async lost => {
    const f = await setup();
    try {
      expect(await f.tool.authorize(toolInput, f.signal)).toBe(true);
      if (lost === 'original')
        await f.repository.delete('health_observation', f.inside.id);
      else f.retire();
      await expect(f.dispatch()).rejects.toThrow();
      expect(f.action.receipt()).toBe('not_saved');
      const prose = { status: 'answer' as const, answer: text, citations: [] };
      expect(answerMemoryOutcome(prose, f.action.receipt())).toEqual({
        status: 'failure',
        kind: 'answer_memory_not_saved',
        discardUnverifiedDraft: true,
      });
      expect(await f.storage.listSavedConversationAnswers()).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test('a mounted composer renders only the selected local tool commit receipt', async () => {
  const f = await setup();
  const runner: typeof runRagConversationTurn = async options => {
    const action = options.workflow.actions?.find(
      item => item.id === 'remember-conversation-answer',
    );
    if (action?.completion !== 'host_terminal')
      throw new Error('The terminal local model tool is absent.');
    const signal = new AbortController().signal;
    const operation = {
      operationRunId: options.workflow.execution.operationRunId,
      operationKey: 'tool-1',
    };
    expect(await action.authorize(toolInput, signal, operation)).toBe(true);
    await action.execute({ input: toolInput, ...operation, signal });
    expect(
      await options.workflow.confirmTerminalLocalAction?.({
        input: toolInput,
        ...operation,
        toolId: action.id,
        toolVersion: action.version,
        signal,
      }),
    ).toBeDefined();
    return {
      status: 'answer',
      answer: 'Untrusted model receipt.',
      citations: [],
    };
  };
  const authorize = jest.fn(async () => 'authorized' as const);
  const externalSearch = jest.fn();
  const send = createRagConversationService({
    selectedAi: async () => ({
      status: 'ready',
      selection: { providerId: apple.provider.id, modelId: apple.modelId },
      option: apple,
      provider: apple.provider,
      modelId: apple.modelId,
      recipient: 'Synthetic device',
      remoteProcessing: false,
    }),
    consent: { authorize },
    queryConsent: { authorize },
    externalEvidence: { search: externalSearch },
    registry: new LocalEvidenceReferenceRegistry(),
    loadLocalData: async () => ({
      ...localData([]).data,
      openConversationArtifactStorage: async () => f.storage,
    }),
    ragRunner: runner,
  });
  const restorePlatform = installReceiptFixturePlatform(() => {});
  const view = await render(
    <ConversationSessionsProvider>
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={(question, history, signal, observer) =>
          send(question, history, signal, {
            ...observer,
            inputOrigin: 'composer',
            retentionSession: { id: previous.sessionId, version: 0 },
            retentionRequestId: request.id,
            retainedHistory: [{ id: previous.id, question: previous.question }],
            confirmHistorySave: f.confirm,
            protectedLocalInput: true,
            suppressContextualOpening: true,
          })
        }
      />
    </ConversationSessionsProvider>,
  );
  try {
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '그래 그럼 기억해줘',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    expect(
      await screen.findByText('이 기기의 기억에 저장했어요.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Untrusted|저장하지 못했어요/u)).toBeNull();
    expect(externalSearch).not.toHaveBeenCalled();
    expect(await f.storage.listSavedConversationAnswers()).toHaveLength(1);
  } finally {
    await view.unmount();
    restorePlatform();
    f.close();
  }
});
