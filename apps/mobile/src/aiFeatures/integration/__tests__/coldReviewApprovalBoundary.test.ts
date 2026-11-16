import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { coldReviewedWorkflowFixture } from '../testSupport/coldReviewedWorkflowFixture';

/** Approval pause must stop before the optional reviewer or selected tool dispatch. */
test.each([false, true])(
  'review approval pause resumes once through the real SQLite journal (fallback v9=%s)',
  async fallback => {
    const x = await coldReviewedWorkflowFixture(false, undefined, fallback);
    try {
      let pause = () => {};
      let approvals = 0;
      x.f.authorize.mockImplementation(async () => {
        if (++approvals === 2) pause();
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
      expect(initial.status).toBe('paused');
      expect(x.generate).toHaveBeenCalledTimes(1);
      expect(x.search).not.toHaveBeenCalled();
      expect(
        x.liveEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(0);
      expect(
        await createConversationColdResumeStorage(x.db.database).open(
          x.identity,
        ),
      ).toBeDefined();
      x.f.authorize.mockResolvedValue('authorized');
      expect((await x.resume()).status).toBe('completed');
      expect(
        x.coldEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(1);
      expect(x.generate).toHaveBeenCalledTimes(4);
      expect(x.search).toHaveBeenCalledTimes(2);
      await expect(x.resume()).rejects.toThrow();
      expect(x.generate).toHaveBeenCalledTimes(4);
      expect(x.search).toHaveBeenCalledTimes(2);
    } finally {
      x.db.close();
    }
  },
);
