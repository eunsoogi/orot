import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { runRagConversationTurn } from '../service';

jest.mock('@orot/agent-runtime', () => ({ runMultiAgentWorkflow: jest.fn() }));

test('marks a mixed-source response partial when the local explanation was not rendered', async () => {
  const paper = {
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    sourceRevision: '1',
    evidenceId: 'paper',
    evidenceRevision: '1',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  const local = {
    ...paper,
    sourceKind: 'personal_record' as const,
    sourceId: 'record',
    evidenceId: 'local',
  };
  jest.mocked(runMultiAgentWorkflow).mockResolvedValueOnce({
    status: 'result',
    value: { answer: '검증된 문헌 결과', literatureReferences: [paper] },
    citations: [paper, local],
    coverage: [],
    checkpoint: {} as never,
  });
  const outcome = await runRagConversationTurn({
    question: '기록과 논문을 비교해 주세요',
    previousMessages: [],
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    rag: { search: jest.fn(async () => []) } as never,
    workflow: {} as never,
  });
  expect(outcome).toMatchObject({
    status: 'answer',
    completion: 'partial',
    citations: [paper],
    answer: expect.stringContaining('기록과의 비교는 확인하지 못했어요'),
  });
});

test('keeps both citations when both claims were rendered and marks the comparison partial', async () => {
  const paper = {
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    sourceRevision: '1',
    evidenceId: 'paper',
    evidenceRevision: '1',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  const local = {
    ...paper,
    sourceKind: 'personal_record' as const,
    sourceId: 'record',
    evidenceId: 'local',
  };
  jest
    .mocked(runMultiAgentWorkflow)
    .mockResolvedValueOnce({
      status: 'result',
      value: {
        answer: '기록 원문과 문헌 원문. 비교 미확인.',
        completion: 'partial',
        literatureReferences: [paper],
        localReferences: [local],
      },
      citations: [paper, local],
      coverage: [],
      checkpoint: {} as never,
    });
  const outcome = await runRagConversationTurn({
    question: '기록과 문헌',
    previousMessages: [],
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    rag: { search: jest.fn(async () => []) } as never,
    workflow: {} as never,
  });
  expect(outcome).toMatchObject({
    status: 'answer',
    completion: 'partial',
    citations: [paper, local],
    answer: expect.stringContaining('비교 미확인'),
  });
});

test('refuses a rendered local claim whose source revision differs from its citation', async () => {
  const local = {
    sourceKind: 'personal_record' as const,
    sourceId: 'record',
    sourceRevision: '1',
    evidenceId: 'local',
    evidenceRevision: '1',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  jest
    .mocked(runMultiAgentWorkflow)
    .mockResolvedValueOnce({
      status: 'result',
      value: { answer: '기록 원문', localReferences: [local] },
      citations: [{ ...local, evidenceRevision: '2' }],
      coverage: [],
      checkpoint: {} as never,
    });
  const outcome = await runRagConversationTurn({
    question: '기록',
    previousMessages: [],
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    rag: { search: jest.fn(async () => []) } as never,
    workflow: {} as never,
  });
  expect(outcome.status).not.toBe('answer');
});
