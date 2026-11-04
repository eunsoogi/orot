import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

test('keeps coverage gaps blocking when the visit-question task has not opted in', async () => {
  const prepared = preparedContext();
  const preparedWithGap = {
    ...prepared,
    searchEvidence: async (
      ...args: Parameters<typeof prepared.searchEvidence>
    ) => {
      const supplemental = await prepared.searchEvidence(...args);
      return {
        ...supplemental,
        batch: {
          ...supplemental.batch,
          coverage: supplemental.batch.coverage.map(entry => ({
            ...entry,
            gaps: ['Synthetic source unavailable'],
          })),
        },
      };
    },
  };
  const { provider } = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared: preparedWithGap,
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('needs_clarification');
});
