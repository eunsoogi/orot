import { suggestionOutput } from '../testing/responseCorrectionFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

const unsupported = '기록이 정확한지 어떤 방법으로 확인하나요?';
const useful =
  '수면 패턴의 변화와 관련해 어떤 점을 관찰하고 기록하면 좋을까요?';

/** Authored responses exercise actual dispatch and correction limits, not model quality. */
test.each([false, true])(
  'unsupported verification gets at most one correction, repeated=%s',
  async repeated => {
    const { provider, requests } = makeProvider([
      suggestionOutput(unsupported),
      suggestionOutput(repeated ? unsupported : useful),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: preparedContext(),
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe(repeated ? 'rejected_output' : 'ready');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain(
      'Never invent a concern or pad a count',
    );
    expect(JSON.stringify(requests[1])).not.toContain('private-source-');
  },
);
