import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';
import { clarificationQuestions } from '../clarificationQuestions';

test('requires both source-linked and clarification questions when visit coverage has gaps', async () => {
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
  const outputs = successfulOutputs(
    prepared.initialEvidence,
    prepared.supplementalEvidence,
  );
  const corrected = JSON.parse(outputs[1]!);
  corrected.value.questions[2] = {
    ...clarificationQuestions[0],
    kind: 'clarification',
    priority: 'routine',
    evidenceIds: [],
  };
  const { provider } = makeProvider([...outputs, JSON.stringify(corrected)]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared: preparedWithGap,
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected questions');
  expect(result.questions[0]?.citations).toEqual([
    prepared.supplementalEvidence,
  ]);
  expect(result.questions[2]).toMatchObject({
    kind: 'clarification',
    citations: [],
  });
});
