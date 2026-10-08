import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

describe('visit-question clarification workflow', () => {
  it('preserves the responder clarification in the public result', async () => {
    // Complete coverage keeps this on the task-result path, where the app owns the copy.
    const prepared = preparedContext();
    const message =
      '기록된 측정 날짜가 서로 다른데, 어느 날짜가 맞는지 알려 주세요.';
    const { provider } = makeProvider([
      JSON.stringify({
        type: 'result',
        value: { status: 'needs_clarification', message },
        citations: [],
      }),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result).toEqual({
      status: 'needs_clarification',
      message,
      memoryStatus: 'available',
    });
  });
});
