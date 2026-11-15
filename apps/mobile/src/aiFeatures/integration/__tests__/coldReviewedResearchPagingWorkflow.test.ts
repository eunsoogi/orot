import { isMultiAgentCheckpointResumable } from '@orot/agent-runtime';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { coldReviewedWorkflowFixture } from '../testSupport/coldReviewedWorkflowFixture';

/** Real cold reconstruction must not re-emit a reviewed preview or repeat completed pages. */
test.each(['complete', 'repause', 'populated'] as const)(
  'reviewed cold paging (%s)',
  async mode => {
    const x = await coldReviewedWorkflowFixture(mode === 'populated');
    try {
      let pause = () => {};
      let approvals = 0;
      x.f.authorize.mockImplementation(async () => {
        if (++approvals === 3) pause();
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
      if (initial.status !== 'paused')
        throw new Error('Expected approval pause');
      const resumable = {
        ...x.f.options,
        operationJournal: x.persisted.operationJournal,
      };
      expect(
        isMultiAgentCheckpointResumable(initial.checkpoint, resumable),
      ).toBe(true);
      for (const patch of [
        ...(mode === 'populated' ? [] : [{ awaitingAuthorization: undefined }]),
        { awaitingAuthorization: 'model-99' },
        { pendingOperation: { kind: 'model', operationKey: 'model-2' } },
      ])
        expect(
          isMultiAgentCheckpointResumable(
            { ...initial.checkpoint, ...patch },
            resumable,
          ),
        ).toBe(false);
      expect(
        x.liveEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(1);
      expect(x.generate).toHaveBeenCalledTimes(2);
      expect(x.search).toHaveBeenCalledTimes(1);
      const saved = await createConversationColdResumeStorage(
        x.db.database,
      ).open(x.identity);
      expect(saved?.reconstruction.researchPaging).toEqual({
        version: 1,
        sequence: 1,
        tokens: [
          {
            token: 'research-page-1',
            query: 'synthetic',
            scope: 'run',
            cursor: x.expectedCursor,
          },
        ],
      });

      x.f.authorize.mockImplementation(async () => {
        if (mode !== 'complete' && x.generate.mock.calls.length === 3)
          x.pauseCold();
        return 'authorized';
      });
      if (mode !== 'complete') {
        expect((await x.resume()).status).toBe('paused');
        expect(x.search).toHaveBeenCalledTimes(2);
        expect(x.generate).toHaveBeenCalledTimes(3);
        const again = await createConversationColdResumeStorage(
          x.db.database,
        ).open(x.identity);
        expect(again?.attempt).toBe(1);
        expect(again?.reconstruction.researchPaging).toEqual(
          saved?.reconstruction.researchPaging,
        );
        x.f.authorize.mockImplementation(async () => 'authorized');
      }
      const result = await x.resume();
      expect(result.status).toBe('completed');
      // Completed tool protocol restores without re-emitting the first tool acknowledgment.
      expect(
        x.coldEvents.mock.calls.filter(([e]) => e.type === 'initial_response'),
      ).toHaveLength(0);
      expect(x.generate).toHaveBeenCalledTimes(4);
      expect(x.search).toHaveBeenCalledTimes(2);
      expect(x.search.mock.calls.map(call => call[0].cursor)).toEqual([
        undefined,
        x.expectedCursor,
      ]);
      await expect(x.resume()).rejects.toThrow();
      expect(x.search).toHaveBeenCalledTimes(2);
      expect(x.f.search).not.toHaveBeenCalled();
    } finally {
      x.db.close();
    }
  },
);
