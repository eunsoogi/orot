import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

test.each(['failed', 'cancelled'] as const)(
  'preserves the runtime tool %s status',
  async status => {
    const prepared = preparedContext();
    const controller = new AbortController();
    jest.spyOn(prepared, 'searchEvidence').mockImplementationOnce(async () => {
      if (status === 'cancelled') controller.abort();
      throw new Error('synthetic search failure');
    });
    const { provider } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider);
    const onToolEvent = jest.fn();
    await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'selected account',
      confirmConsent: async () => true,
      signal: controller.signal,
      observer: { onToolEvent },
    });
    expect(onToolEvent.mock.calls.map(([event]) => event.status)).toEqual([
      'started',
      status,
    ]);
    expect(JSON.stringify(onToolEvent.mock.calls)).not.toContain(
      'synthetic search failure',
    );
  },
);
