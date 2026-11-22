import { runVisitQuestionWorkflow } from '../workflow';
import {
  fixture,
  output,
  supported,
  unsupported,
} from '../testing/numericCorrectionFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { unsupportedDateOrValueKind } from '../questionFacts';

test('corrects one unsupported unit with the cited unit before publication', async () => {
  const f = await fixture();
  try {
    expect(unsupportedDateOrValueKind(unsupported, [f.item])).toBe(
      'quantity_unit',
    );
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider);
    const confirmConsent = jest.fn(async () => true);
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready')
      expect(result.questions[0]?.questionText).toBe(supported);
    expect(requests).toHaveLength(2);
    const correction = JSON.stringify(requests[1]?.messages.at(-1));
    expect(correction).toContain('complete unit verbatim');
    expect(correction).toContain('preserve the unit spelling and symbol');
    expect(correction).toContain('Do not round');
    expect(confirmConsent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('72회/초');
    expect(await f.records.list('visit_question')).toEqual([]);
  } finally {
    f.close();
  }
});

test('stops after one rejected unit correction without accepting or storing the unsupported unit', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('rejected_output');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('72회/초');
    expect(await f.records.list('visit_question')).toEqual([]);
  } finally {
    f.close();
  }
});

test.each([
  ['unknown-evidence', '기록된 측정 조건을 의료진과 확인할 수 있어요.'],
  ['evidence-1', '고혈압입니다. 약을 중단하세요.'],
])(
  'keeps another citation or clinical-copy failure terminal before numeric correction (%s)',
  async (secondId, reason) => {
    const f = await fixture();
    try {
      const { provider, requests } = makeProvider([
        output(unsupported, secondId, reason),
        output(supported),
      ]);
      const { selection, option } = selectedOption(provider, 'on-device');
      const result = await runVisitQuestionWorkflow({
        prepared: f.context,
        selection,
        providerOptions: [option],
      });
      expect(result.status).toBe('rejected_output');
      expect(requests).toHaveLength(1);
    } finally {
      f.close();
    }
  },
);

test('does not publish unsafe final question copy even when its numeric facts match', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(supported, 'evidence-1', '고혈압입니다. 약을 중단하세요.'),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
    });
    expect(result).toMatchObject({ status: 'rejected_output' });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('약을 중단하세요');
  } finally {
    f.close();
  }
});

test('requires fresh consent before the correction payload and stops when it is denied', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider);
    let approvals = 0;
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent: async () => ++approvals === 1,
    });
    expect(result.status).toBe('consent_required');
    expect(requests).toHaveLength(1);
    expect(approvals).toBe(2);
  } finally {
    f.close();
  }
});

test('keeps unit correction bounded after two model-selected searches', async () => {
  const prepared = preparedContext();
  const lookup = (id: string) =>
    JSON.stringify({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id,
          name: 'visit-question-personal-record-search',
          arguments: { query: '합성 심박수 기록' },
        },
      ],
    });
  // Two lookups leave one correction call, which must still pass evidence validation.
  const { provider, requests } = makeProvider([
    lookup('first-lookup'),
    lookup('second-lookup'),
    output(unsupported),
    output(unsupported),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('rejected_output');
  expect(requests).toHaveLength(4);
  expect(prepared.searchEvidence).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(requests)).toContain(
    'The previous questions failed exact',
  );
});
