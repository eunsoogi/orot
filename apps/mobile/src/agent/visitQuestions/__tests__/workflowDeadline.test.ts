import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

test.each([
  [30_000, 'ready'],
  [50_000, 'unavailable'],
] as const)(
  'bounds two model calls of %i ms with a 90-second deadline',
  async (delay, status) => {
    jest.useFakeTimers();
    try {
      const prepared = preparedContext();
      const base = makeProvider(
        successfulOutputs(
          prepared.initialEvidence,
          prepared.supplementalEvidence,
        ),
      );
      const provider = {
        ...base.provider,
        generate: async (
          ...args: Parameters<typeof base.provider.generate>
        ) => {
          await new Promise(resolve => setTimeout(resolve, delay));
          return base.provider.generate(...args);
        },
      };
      const { selection, option } = selectedOption(provider);
      let completed = false;
      const pending = runVisitQuestionWorkflow({
        prepared,
        selection,
        providerOptions: [option],
        recipient: 'synthetic account',
        confirmConsent: async () => true,
      }).then(result => {
        completed = true;
        return result;
      });
      await jest.advanceTimersByTimeAsync(45_001);
      expect(completed).toBe(false);
      await jest.advanceTimersByTimeAsync(45_000);
      expect((await pending).status).toBe(status);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);
