import type { LanguageModelRequest } from '@orot/model-runtime';
import { classifyCalendarEvents } from '../classificationWorkflow';
import {
  event,
  input,
  makeProvider,
  workflowResponse,
} from '../classificationWorkflowTestFixtures';

/** Consent review and provider latency share cancellation, without imposing an elapsed cutoff. */
test.each(['consent', 'provider'] as const)(
  'retains a calendar request after more than 45 seconds in %s',
  async phase => {
    jest.useFakeTimers();
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      entered = resolve;
    });
    const pause = async () => {
      entered();
      await new Promise<void>(resolve => setTimeout(resolve, 46_000));
    };
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      if (phase === 'provider') await pause();
      return workflowResponse(request);
    });
    try {
      const pending = classifyCalendarEvents(
        input([event(0)], {
          provider: makeProvider(generate),
          consent: {
            async authorize() {
              if (phase === 'consent') await pause();
              return 'authorized' as const;
            },
          },
        }),
      );
      await waiting;
      await jest.advanceTimersByTimeAsync(46_000);
      const result = await pending;
      expect(result.status).toBe('complete');
      expect(result.completedBatches).toBe(1);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  },
);
