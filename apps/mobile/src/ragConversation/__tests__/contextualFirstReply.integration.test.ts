import type {
  ProviderResult,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type { MultiAgentResponderStreamEvent } from '@orot/agent-runtime';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { standardSearchFixture } from '../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';

/** Preserved v9 production task + graph, synthetic provider outputs: ordering and exact prose, not model quality. */
test.each([
  ['지난 수면 기록을 살펴봐줘', '수면 기록의 흐름을 먼저 살펴볼게요.'],
  ['걷기 기록을 비교해줘', '걷기 기록을 어떤 기준으로 비교할지 살펴볼게요.'],
])(
  'publishes the reviewed model response before investigation: %s',
  async (request, candidate) => {
    const run = standardSearchFixture(true);
    const events: MultiAgentResponderStreamEvent[] = [];
    run.provider.generate.mockImplementation(
      async (payload): Promise<ProviderResult<LanguageModelResponse>> => {
        run.requests.push(payload);
        return providerSuccess({
          text:
            run.requests.length === 1
              ? candidate
              : run.requests.length === 2
                ? 'ALLOW'
                : JSON.stringify({
                    type: 'result',
                    value: {
                      answerKind: 'conversation',
                      answer: '어떤 점이 궁금하신가요?',
                    },
                    citations: [],
                  }),
          toolCalls:
            run.requests.length === 1
              ? [
                  {
                    id: 'first',
                    name: run.tool.id,
                    arguments: { query: 'synthetic' },
                  },
                ]
              : [],
          finishReason: run.requests.length === 1 ? 'tool_calls' : 'complete',
        });
      },
    );
    const original = run.search.getMockImplementation()!;
    run.search.mockImplementation(async () => {
      expect(events.filter(event => event.type === 'initial_response')).toEqual(
        [{ type: 'initial_response', callId: 'first', text: candidate }],
      );
      return original();
    });
    const result = await runMultiAgentWorkflow(
      {
        ...run.options,
        request,
        task: restoreConversationTask({
          taskType: ragConversationTask.taskType,
          taskVersion: '9',
        })!,
      },
      { config: run.config, onTaskStreamEvent: event => events.push(event) },
    );
    expect(result.status).toBe('result');
    expect(run.requests).toHaveLength(3);
    const reviewMessage = run.requests[1]?.messages.at(-1);
    expect(
      reviewMessage && 'content' in reviewMessage
        ? reviewMessage.content
        : undefined,
    ).toBe(JSON.stringify({ request, candidate }));
    expect(run.search).toHaveBeenCalledTimes(1);
  },
);

test('v10 never publishes unreviewed tool prose or spends a second opening review', async () => {
  const run = standardSearchFixture(true);
  const events: MultiAgentResponderStreamEvent[] = [];
  run.provider.generate
    .mockReset()
    .mockResolvedValueOnce(
      providerSuccess({
        text: 'unreviewed tool prose',
        toolCalls: [
          { id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } },
        ],
        finishReason: 'tool_calls',
      }),
    )
    .mockResolvedValueOnce(
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            answerKind: 'conversation',
            answer: '어떤 점이 궁금하신가요?',
          },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
  const result = await runMultiAgentWorkflow(
    {
      ...run.options,
      request: '걷기 기록을 비교해줘',
      task: ragConversationTask,
    },
    {
      config: run.config,
      onTaskStreamEvent: event => events.push(event),
    },
  );
  expect(result.status).toBe('result');
  expect(run.provider.generate).toHaveBeenCalledTimes(2);
  expect(events.filter(event => event.type === 'initial_response')).toEqual([]);
  expect(JSON.stringify(events)).not.toContain('unreviewed tool prose');
});
