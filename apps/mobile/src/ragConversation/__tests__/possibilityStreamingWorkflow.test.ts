import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

function streamingOptions(answer: string, invalidCitation = false) {
  const f = fixture();
  const text = JSON.stringify({
    type: 'result',
    value: { answerKind: 'conversation', answer },
    citations: invalidCitation ? ['missing-evidence'] : [],
  });
  const split = text.indexOf(answer) + Math.floor(answer.length / 2);
  const response = { text, toolCalls: [], finishReason: 'complete' as const };
  return {
    ...f.options,
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    workflow: {
      ...f.options.workflow,
      provider: {
        ...f.options.workflow.provider,
        capabilities: {
          ...f.options.workflow.provider.capabilities,
          streaming: true,
        },
        generate: jest.fn(async () => providerSuccess(response)),
        async *stream() {
          yield providerSuccess({
            type: 'text_delta' as const,
            text: text.slice(0, split),
          });
          yield providerSuccess({
            type: 'text_delta' as const,
            text: text.slice(split),
          });
          yield providerSuccess({ type: 'completed' as const, response });
        },
      },
    },
  };
}

test('does not expose a clinical possibility with an invalid citation through workflow events', async () => {
  const events: unknown[] = [];
  const result = await runRagConversationTurn(
    {
      ...streamingOptions('당뇨일 수 있어요.', true),
      entryIntent: 'possibilities',
    },
    { onTaskStreamEvent: event => events.push(event) },
  );
  expect(JSON.stringify(events)).not.toContain('당뇨');
  expect(result.status).not.toBe('answer');
});

test('returns a conversational answer only after validation', async () => {
  const events: unknown[] = [];
  const result = await runRagConversationTurn(
    streamingOptions('함께 살펴볼 수 있어요.'),
    { onTaskStreamEvent: event => events.push(event) },
  );
  expect(JSON.stringify(events)).not.toContain('함께 살펴');
  expect(result).toMatchObject({
    status: 'answer',
    answer: '함께 살펴볼 수 있어요.',
  });
});

test('withholds medical prose mislabeled as conversation before final rejection', async () => {
  const events: unknown[] = [];
  const result = await runRagConversationTurn(
    streamingOptions('당뇨일 수 있어요.', true),
    { onTaskStreamEvent: event => events.push(event) },
  );
  expect(JSON.stringify(events)).not.toContain('당뇨');
  expect(result.status).not.toBe('answer');
});

test('publishes tool progress while the final answer is still pending', async () => {
  const { options } = fixture();
  const onToolEvent = jest.fn();
  const onTaskStreamEvent = jest.fn();
  const search = jest.fn(async () => {
    expect(onToolEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'started' }),
    );
    return { status: 'available' as const, publications: [] };
  });
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const generate = jest
    .fn()
    .mockResolvedValueOnce(
      providerSuccess({
        text: '',
        toolCalls: [
          { id: 'search', name: tool.id, arguments: { query: 'sleep' } },
        ],
        finishReason: 'tool_calls' as const,
      }),
    )
    .mockImplementationOnce(async () => {
      expect(onToolEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      return response({
        type: 'result',
        value: { answerKind: 'conversation', answer: '함께 살펴볼 수 있어요.' },
        citations: [],
      });
    });
  const result = await runRagConversationTurn(
    {
      ...options,
      workflow: {
        ...options.workflow,
        tools: [tool],
        provider: {
          ...options.workflow.provider,
          capabilities: {
            ...options.workflow.provider.capabilities,
            toolCalling: true,
          },
          generate,
        },
      },
    },
    { onToolEvent, onTaskStreamEvent },
  );
  expect(search).toHaveBeenCalledTimes(1);
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    status: 'answer',
    answer: '함께 살펴볼 수 있어요.',
  });
});

test('returns a validated possibility response after buffering', async () => {
  const events: unknown[] = [];
  const result = await runRagConversationTurn(
    {
      ...streamingOptions('기록을 함께 살펴볼 수 있어요.'),
      entryIntent: 'possibilities',
    },
    { onTaskStreamEvent: event => events.push(event) },
  );
  expect(JSON.stringify(events)).not.toContain('기록을 함께');
  expect(result).toMatchObject({
    status: 'answer',
    answer: '기록을 함께 살펴볼 수 있어요.',
  });
});
