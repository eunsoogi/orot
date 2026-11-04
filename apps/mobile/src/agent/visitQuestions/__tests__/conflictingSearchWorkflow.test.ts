import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';
import { clarificationQuestions } from '../clarificationQuestions';

describe('conflicting search results', () => {
  it('produces clarification questions when supplemental evidence reveals a conflict', async () => {
    const prepared = preparedContext();
    const preparedWithConflict = {
      ...prepared,
      searchEvidence: async (
        ...args: Parameters<typeof prepared.searchEvidence>
      ) => {
        const supplemental = await prepared.searchEvidence(...args);
        return {
          ...supplemental,
          batch: {
            ...supplemental.batch,
            conflicts: ['Conflicting health observation values exist.'],
          },
        };
      },
    };
    const { provider } = makeProvider([
      ...successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
      JSON.stringify({
        type: 'result',
        value: {
          status: 'suggestions',
          questions: clarificationQuestions.slice(0, 3).map(item => ({
            ...item,
            kind: 'clarification',
            priority: 'routine',
            evidenceIds: [],
          })),
        },
        citations: [],
      }),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared: preparedWithConflict,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected questions');
    expect(
      result.questions.every(
        question =>
          question.kind === 'clarification' && question.citations.length === 0,
      ),
    ).toBe(true);
  });
});
