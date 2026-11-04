import {
  annotatePublicSearchLimit,
  budgetAfterPublicSearch,
  runDefaultPublicSearch,
} from '../defaultPublicSearch';
import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('runs one public search using only controlled topics selected from the request', async () => {
  const run = publicEvidenceFixture();
  const result = await runDefaultPublicSearch({
    tool: createPublicWebEvidence(run)!.tool,
    operationRunId: 'default-search',
    request: '김테스트의 혈압 170/100은 어떤가요?',
    signal: run.controller.signal,
  });
  expect(result.status).toBe('success');
  expect(run.search).toHaveBeenCalledTimes(1);
  const query = run.search.mock.calls[0]![0].query;
  expect(query).toContain('blood pressure');
  expect(query).not.toContain('김테스트');
  expect(query).not.toContain('170/100');
});

test.each([
  ['산소포화도 92%의 의미', 'oxygen saturation'],
  ['최근 체중 변화', 'body weight'],
  ['혈당 추세', 'blood glucose'],
  ['호흡수와 체온', 'respiratory rate'],
  ['예약 시간을 잠시 확인해 주세요', 'general health'],
])(
  'selects a relevant public topic without copying personal text: %s',
  async (request, expected) => {
    const run = publicEvidenceFixture();
    await runDefaultPublicSearch({
      tool: createPublicWebEvidence(run)!.tool,
      operationRunId: 'topic-test',
      request,
      signal: run.controller.signal,
    });
    const query = run.search.mock.calls[0]![0].query;
    expect(query).toContain(expected);
    expect(query).not.toContain('92%');
    if (expected === 'general health') {
      expect(query).not.toContain('sleep');
      expect(query).not.toContain('medication');
    }
  },
);

test('keeps denied consent, unavailability, empty and cancellation distinct', async () => {
  const run = publicEvidenceFixture();
  const tool = createPublicWebEvidence(run)!.tool;
  const input = {
    tool,
    operationRunId: 'default-search',
    request: 'sleep',
    signal: run.controller.signal,
  };
  run.authorize.mockResolvedValueOnce('renewal_required');
  expect((await runDefaultPublicSearch(input)).status).toBe('consent_required');
  expect(run.search).not.toHaveBeenCalled();
  const unavailable = {
    ...tool,
    search: async () => {
      throw new Error('offline or unavailable');
    },
  };
  expect(
    (await runDefaultPublicSearch({ ...input, tool: unavailable })).status,
  ).toBe('unavailable');
  const empty = {
    ...tool,
    search: async () => ({ items: [], coverage: [], conflicts: [] }),
  };
  expect((await runDefaultPublicSearch({ ...input, tool: empty })).status).toBe(
    'empty',
  );
  run.controller.abort();
  expect((await runDefaultPublicSearch(input)).status).toBe('cancelled');
  expect(
    (await runDefaultPublicSearch({ ...input, tool: undefined })).status,
  ).toBe('cancelled');
});

test.each([
  ['consent_required', '동의가 없어'],
  ['unavailable', '사용할 수 없어'],
  ['empty', '결과를 찾지 못했어요'],
] as const)('keeps local results and explains %s', (status, notice) => {
  const local = {
    status: 'workflow' as const,
    result: {
      status: 'result' as const,
      value: {
        hypotheses: [
          {
            title: '기록',
            summary: '로컬 근거',
            supportingEvidence: [],
            contraryEvidence: [],
            uncertainty: '확인 필요',
            missingData: [],
          },
        ],
      },
      citations: [],
      coverage: [],
      checkpoint: {} as never,
    },
  };
  const result = annotatePublicSearchLimit(local, { status });
  expect(result.status).toBe('workflow');
  if (result.status !== 'workflow' || result.result.status !== 'result')
    throw new Error('Expected local result');
  expect(result.result.value.hypotheses[0]?.summary).toBe('로컬 근거');
  expect(result.result.value.hypotheses[0]?.missingData.join(' ')).toContain(
    notice,
  );
});

test('reserves an attempted public provider call, including an empty result', () => {
  const budget = { ...DEFAULT_MULTI_AGENT_BUDGET, maxModelCalls: 4 };
  expect(
    budgetAfterPublicSearch(budget, { status: 'empty' }, true).maxModelCalls,
  ).toBe(3);
  expect(
    budgetAfterPublicSearch(budget, { status: 'unavailable' }, true)
      .maxModelCalls,
  ).toBe(3);
  expect(
    budgetAfterPublicSearch(budget, { status: 'unavailable' }, false)
      .maxModelCalls,
  ).toBe(4);
  expect(
    budgetAfterPublicSearch(budget, { status: 'consent_required' }, true)
      .maxModelCalls,
  ).toBe(4);
});
