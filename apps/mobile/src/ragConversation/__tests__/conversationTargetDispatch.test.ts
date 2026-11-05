import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { runRagConversationTurn } from '../service';

jest.mock('@orot/agent-runtime', () => ({ runMultiAgentWorkflow: jest.fn() }));

test('dispatches the selected alias and intent independently of the edited request', async () => {
  const target = {
    sourceKind: 'personal_record' as const,
    sourceId: 's1',
    sourceRevision: 'sr1',
    evidenceId: 'e1',
    evidenceRevision: 'er1',
    locator: { kind: 'local-evidence' as const, token: 'e1' },
    effectiveTime: '2090-06-02T09:30:00.000Z',
    reviewState: 'unreviewed' as const,
    content: 'appointment: {"status":"scheduled"}',
  };
  const consent = { authorize: jest.fn() };
  jest
    .mocked(runMultiAgentWorkflow)
    .mockResolvedValue({
      status: 'needs_clarification',
      message: 'No current evidence is available.',
    } as never);
  await runRagConversationTurn({
    question: '수정한 요청',
    entryIntent: 'visit-questions',
    targetVisitEvidence: target,
    previousMessages: [{ role: 'user', content: '이전 요청' }],
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    rag: { search: jest.fn() } as never,
    workflow: {
      execution: { budget: { maxEvidenceItems: 8 } },
      consent,
    } as never,
  });
  expect(runMultiAgentWorkflow).toHaveBeenCalledWith(
    expect.objectContaining({
      request: '수정한 요청',
      consent,
      context: {
        history: [{ role: 'user', content: '이전 요청' }],
        intent: 'visit-questions',
        targetEvidenceId: 'e1',
      },
      initialEvidence: expect.objectContaining({ items: [target] }),
    }),
    expect.any(Object),
  );
});
