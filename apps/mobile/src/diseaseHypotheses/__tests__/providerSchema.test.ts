import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { diseaseHypothesisTask } from '../task';
import { serializeAppleRequest } from '../../providers/apple/serializeRequest';
import { guidedSchema } from '../../../../../packages/agent-runtime/src/multiAgent/guidedSchema';

test('the disease task schema reaches the real Apple adapter native boundary', async () => {
  const generate = jest.fn(async () => ({
    text: '{}',
    toolCalls: [],
    finishReason: 'complete' as const,
  }));
  const provider = new AppleFoundationModelsProvider({
    getAvailability: async () => ({ status: 'available' }),
    generate: async request => {
      serializeAppleRequest(request);
      return generate();
    },
    async *stream() {},
    cancel() {},
  });
  await provider.generate({
    messages: [
      { role: 'user', content: 'Synthetic supported symptom records' },
    ],
    responseFormat: {
      name: 'disease_hypotheses',
      schema: guidedSchema(diseaseHypothesisTask.resultSchema),
    },
  });
  expect(generate).toHaveBeenCalledTimes(1);
});
