import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type {
  EvidenceBatch,
  EvidenceReference,
  MultiAgentRunResult,
} from '@orot/agent-runtime';
import type { EvidenceChunk } from '@orot/rag';
import { runRagConversationTurn } from '../service';
import type { GroundedRagAnswer } from '../task';

jest.mock('@orot/agent-runtime', () => ({ runMultiAgentWorkflow: jest.fn() }));

const baseReference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed',
};

function snapshot(reference: EvidenceReference) {
  const chunk = {
    id: 'chunk-1',
    text: 'blood pressure evidence',
    metadata: {
      sourceId: reference.sourceId,
      evidenceId: reference.evidenceId,
    },
  } as EvidenceChunk;
  const batch: EvidenceBatch = {
    items: [{ ...reference, content: 'Blood pressure was recorded.' }],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: [reference.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 8,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
  return { batch, chunks: [chunk] };
}

function result(
  reference: EvidenceReference,
  answer: string,
): MultiAgentRunResult<GroundedRagAnswer> {
  return {
    status: 'result',
    value: { answer },
    citations: [reference],
    coverage: [],
    checkpoint: {} as never,
  };
}

test('loads a fresh snapshot for each turn and passes only E5-selected evidence to #117', async () => {
  const first = { ...baseReference };
  const second = {
    ...baseReference,
    evidenceRevision: '2',
    sourceRevision: '2',
  };
  const loadCurrentEvidence = jest
    .fn()
    .mockResolvedValueOnce(snapshot(first))
    .mockResolvedValueOnce(snapshot(second));
  const search = jest.fn(
    async (_query: string, chunks: readonly EvidenceChunk[]) => [
      { chunk: chunks[0], score: 1, lexicalRank: 1, vectorRank: 1 },
    ],
  );
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const workflow = { consent } as never;
  jest
    .mocked(runMultiAgentWorkflow)
    .mockResolvedValueOnce(result(first, '첫 답변'))
    .mockResolvedValueOnce(result(second, '두 번째 답변'));

  const run = (question: string) =>
    runRagConversationTurn({
      question,
      previousMessages: [],
      loadCurrentEvidence,
      rag: { search } as never,
      workflow,
    });
  const firstOutcome = await run('혈압 기록은?');
  const secondOutcome = await run('더 최근 기록은?');

  expect(firstOutcome).toMatchObject({ status: 'answer', answer: '첫 답변' });
  expect(secondOutcome).toMatchObject({
    status: 'answer',
    answer: '두 번째 답변',
  });
  expect(loadCurrentEvidence).toHaveBeenCalledTimes(2);
  expect(search).toHaveBeenCalledTimes(2);
  expect(jest.mocked(runMultiAgentWorkflow).mock.calls[1][0].consent).toBe(
    consent,
  );
  expect(
    jest.mocked(runMultiAgentWorkflow).mock.calls[0][0].initialEvidence.items[0]
      .evidenceRevision,
  ).toBe('1');
  expect(
    jest.mocked(runMultiAgentWorkflow).mock.calls[1][0].initialEvidence.items[0]
      .evidenceRevision,
  ).toBe('2');
});

test('does not call a model when retrieval finds no current evidence', async () => {
  jest.mocked(runMultiAgentWorkflow).mockClear();
  const loadCurrentEvidence = jest.fn(async () => snapshot(baseReference));
  const outcome = await runRagConversationTurn({
    question: '질문',
    previousMessages: [{ role: 'assistant', content: 'old model claim' }],
    loadCurrentEvidence,
    rag: { search: jest.fn(async () => []) } as never,
    workflow: {} as never,
  });
  expect(outcome).toEqual({ status: 'no_evidence' });
  expect(runMultiAgentWorkflow).not.toHaveBeenCalled();
});
