import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { conversationFailureReporter } from '../../../ragConversation/conversationFailedPrompt';
import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

const providerId = 'chatgpt-plan:synthetic';
const modelId = 'synthetic-chatgpt';

test('protected memory retry does not invent a prior target, send it, or produce another assistant warning', async () => {
  const failedRetry = '그 답변을 기억해 줘';
  const generate = jest.fn();
  const open = jest.fn();
  const confirm = jest.fn();
  const authorize = jest.fn();
  const unavailablePrevious = {
    id: 1,
    role: 'assistant' as const,
    content: 'Existing withheld-source notice.',
    historyUnavailable: true as const,
  };
  const session = {
    messages: [
      unavailablePrevious,
      { id: 2, role: 'user' as const, content: failedRetry },
    ],
    draft: '',
    pendingMessage: null,
  } as unknown as ConversationSession;
  const integration = createConversationSummaryIntegration({
    consent: { authorize },
    dependencies: {},
    loadData: open,
    selectedAi: generate,
    registry: new LocalEvidenceReferenceRegistry(),
    diseaseRunner: jest.fn(),
    sendRagMessage: generate,
    loadSavedVisitQuestions: jest.fn(),
  });
  const abort = new AbortController();
  const result = await integration.sendRagMessage(
    failedRetry,
    [{ role: 'assistant', content: 'Protected synthetic original.' }],
    abort.signal,
    {
      inputOrigin: 'composer',
      expectedConversationModel: { providerId, modelId },
      archivedAnswerMemoryTarget: null,
      confirmHistorySave: confirm,
    },
  );
  expect(result).toEqual({
    status: 'failure',
    kind: 'protected_memory_not_saved',
    discardUnverifiedDraft: true,
  });
  if (result.status !== 'failure') throw new Error('Expected a local failure.');
  const update = jest.fn();
  const retain = jest.fn();
  conversationFailureReporter(
    () => session,
    update,
    { question: failedRetry, userMessageId: 2 } as never,
    retain,
    1,
  )(result);
  expect(retain).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      error: expect.stringMatching(/^기억에 저장하지 않았어요\./),
      messages: [
        unavailablePrevious,
        expect.objectContaining({ id: 2, failed: true }),
      ],
    }),
  );
  expect(JSON.stringify(update.mock.calls)).not.toContain('Apple Intelligence');
  expect(generate).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
});
