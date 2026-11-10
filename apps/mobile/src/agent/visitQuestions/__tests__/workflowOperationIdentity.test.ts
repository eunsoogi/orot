import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import type { runVisitQuestionWorkflow } from '../workflow';

test('a reopened app does not reuse an earlier visit tool operation identity', async () => {
  const run = async (workflow: typeof runVisitQuestionWorkflow) => {
    const prepared = preparedContext();
    const { provider } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider);
    const onToolEvent = jest.fn();
    await workflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'selected account',
      confirmConsent: async () => true,
      observer: { onToolEvent },
    });
    return onToolEvent.mock.calls[0]![0].operationRunId;
  };
  let first!: typeof runVisitQuestionWorkflow;
  let second!: typeof runVisitQuestionWorkflow;
  jest.isolateModules(() => {
    first = require('../workflow').runVisitQuestionWorkflow;
  });
  jest.isolateModules(() => {
    second = require('../workflow').runVisitQuestionWorkflow;
  });
  expect(await run(first)).not.toBe(await run(second));
});
