import {
  acceptEmptyHealthBatch,
  acceptScopeContext,
  acceptScopeEvidence,
  currentScopeGeneration,
  expectedEvent,
  rejectScope,
} from './visitQuestionScopeGuard';

/** Test-only loader preserves the production context and audits real tool results before release. */
export async function loadVisitQuestionsContext() {
  const token = currentScopeGeneration();
  const original = await import('../src/agent/visitQuestions/localContext');
  return {
    ...original,
    async prepareUpcomingVisitQuestionContext(
      input: Parameters<typeof original.prepareUpcomingVisitQuestionContext>[0],
    ) {
      const prepared =
        await original.prepareUpcomingVisitQuestionContext(input);
      if (prepared.status !== 'ready') return prepared;
      if (
        prepared.appointment.calendarEventIdentifier !== expectedEvent ||
        prepared.evidence.batch.items.length !== 0
      )
        rejectScope(token, 'context_mismatch');
      acceptScopeContext(token);
      const periodTool = prepared.healthContextTool;
      return {
        ...prepared,
        async searchEvidence(
          ...args: Parameters<typeof prepared.searchEvidence>
        ) {
          const collection = await prepared.searchEvidence(...args);
          acceptScopeEvidence(token, collection);
          return collection;
        },
        ...(periodTool
          ? {
              healthContextTool: {
                ...periodTool,
                async search(request: Parameters<typeof periodTool.search>[0]) {
                  const result = await periodTool.search(request);
                  if (!('status' in result))
                    acceptEmptyHealthBatch(token, result.items.length);
                  return result;
                },
              },
            }
          : {}),
      };
    },
  };
}
