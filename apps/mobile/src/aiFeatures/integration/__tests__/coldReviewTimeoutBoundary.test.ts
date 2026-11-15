import { providerSuccess } from '@orot/model-runtime';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { coldReviewedWorkflowFixture } from '../testSupport/coldReviewedWorkflowFixture';

/** A provider that ignores cancellation cannot turn an unconfirmed intent into cold replay. */
test.each([false, true])(
  'timed-out review never replays but live task can proceed (pause=%s)',
  async paused => {
    let finishReview: (() => void) | undefined;
    const x = await coldReviewedWorkflowFixture(
      false,
      () =>
        new Promise(resolve => {
          finishReview = () =>
            resolve(
              providerSuccess({
                text: 'ALLOW',
                finishReason: 'complete',
                toolCalls: [],
              }),
            );
        }),
    );
    try {
      let pause = () => {};
      let approvals = 0;
      x.f.authorize.mockImplementation(async () => {
        if (++approvals === 3 && paused) pause();
        return 'authorized';
      });
      const initial = await runContinuableConversationWorkflow(
        x.f.options,
        { onTaskStreamEvent: x.liveEvents },
        {
          persisted: x.persisted,
          bindPause: value => {
            pause = value;
          },
          waitForContinue: async () => false,
        },
      );
      // Auxiliary uncertainty does not block live final output; paused cold replay still fails closed.
      expect(initial.status).toBe(paused ? 'paused' : 'result');
      expect(x.generate).toHaveBeenCalledTimes(paused ? 2 : 4);
      expect(x.search).toHaveBeenCalledTimes(paused ? 1 : 2);
      expect(
        x.liveEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(0);
      finishReview?.();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(
        x.liveEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(0);
      expect(
        await createConversationColdResumeStorage(x.db.database).open(
          x.identity,
        ),
      ).toBeUndefined();
      await expect(x.resume()).rejects.toThrow();
      expect(x.generate).toHaveBeenCalledTimes(paused ? 2 : 4);
      expect(x.search).toHaveBeenCalledTimes(paused ? 1 : 2);
      expect(x.coldEvents).not.toHaveBeenCalled();
    } finally {
      x.db.close();
    }
  },
);
