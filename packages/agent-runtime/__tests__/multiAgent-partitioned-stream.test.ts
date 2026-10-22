import { providerSuccess, type LanguageModelStreamEvent } from '@orot/model-runtime';
import { runMultiAgentWorkflow, type MultiAgentResponderStreamEvent } from '../src';
import { partitionFixture } from './partitioned-result-fixtures';

test('appends later source-group text without clearing the prior draft or losing the paragraph separator', async () => {
  const f = partitionFixture();
  const events: MultiAgentResponderStreamEvent[] = [];
  const provider = {
    ...f.options.provider,
    capabilities: { ...f.options.provider.capabilities, streaming: true },
    async *stream(...args: Parameters<typeof f.options.provider.generate>) {
      const generated = await f.options.provider.generate(...args);
      if (!generated.ok) throw new Error('Expected fixture response');
      yield providerSuccess<LanguageModelStreamEvent>({
        type: 'text_snapshot',
        text: generated.value.text,
      });
      yield providerSuccess<LanguageModelStreamEvent>({
        type: 'completed',
        response: generated.value,
      });
    },
  };
  const result = await runMultiAgentWorkflow(
    { ...f.options, provider },
    {
      onTaskStreamEvent: (event) => events.push(event),
    },
  );
  expect(result.status).toBe('result');
  expect(events.filter((event) => event.type === 'started')).toHaveLength(1);
  let displayed = '';
  for (const event of events) {
    if (event.type === 'text_delta') displayed += event.text;
    if (event.type === 'text_snapshot') {
      expect(event.text.startsWith(displayed)).toBe(true);
      displayed = event.text;
    }
  }
  expect(displayed).toBe('evidence-0\n\nevidence-1');
});
