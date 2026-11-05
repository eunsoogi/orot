import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const target = {
  sourceKind: 'external_medical' as const,
  sourceId: 'synthetic-source',
  sourceRevision: '1',
  evidenceId: 'target-evidence',
  evidenceRevision: '1',
  locator: { kind: 'structured_record' as const, recordId: 'synthetic' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
  content: 'appointment: {"status":"scheduled"}',
};

test('keeps selected-target turns behind consent and passes the alias to the task after approval', async () => {
  const f = fixture();
  const authorize = jest.fn(async () => 'renewal_required' as const);
  const options = {
    ...f.options,
    question: '수정한 질문',
    entryIntent: 'visit-questions' as const,
    targetVisitEvidence: target,
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        remoteProcessing: true,
        consentScope: {
          purpose: 'record_conversation' as const,
          dataCategories: ['health_records' as const],
          policyVersion: 'test',
        },
      },
      consent: { authorize },
    },
  };
  const denied = await runRagConversationTurn(options);
  expect(denied).toMatchObject({ status: 'failure', kind: 'consent_required' });
  expect(authorize).toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();

  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: '선택한 진료가 예정되어 있어요.',
      },
      citations: ['target-evidence'],
    }),
  );
  const allowed = await runRagConversationTurn({
    ...options,
    workflow: {
      ...options.workflow,
      consent: { authorize: async () => 'authorized' as const },
    },
  });
  expect(allowed.status).toBe('answer');
  const request = f.generate.mock.calls[0]![0];
  expect(JSON.stringify(request.messages)).toContain('target-evidence');
  expect(JSON.stringify(request.messages)).toContain('visit-questions');
  expect(JSON.stringify(request.messages)).toContain('수정한 질문');
});

test('sends a validated follow-up context only after model consent', async () => {
  const f = fixture();
  const options = {
    ...f.options,
    question: '지난주부터 시작됐어요',
    entryIntent: 'possibilities' as const,
    previousMessages: [{ role: 'user' as const, content: '피로가 있어요' }],
    validatedPriorTurns: [
      { question: '피로가 있어요', answer: '언제부터 시작됐나요?' },
    ],
    priorDialogueOmitted: true,
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        remoteProcessing: true,
        recipient: 'remote',
        consentScope: {
          purpose: 'record_conversation' as const,
          dataCategories: ['health_records' as const],
          policyVersion: 'test',
        },
      },
    },
  };
  f.authorize.mockResolvedValueOnce('denied' as never);
  expect(await runRagConversationTurn(options)).toMatchObject({
    status: 'failure',
    kind: 'consent_required',
  });
  expect(f.generate).not.toHaveBeenCalled();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer: '추가 확인이 필요해요.' },
      citations: ['synthetic-evidence'],
    }),
  );
  expect((await runRagConversationTurn(options)).status).toBe('answer');
  const messages = JSON.stringify(f.generate.mock.calls[0]![0].messages);
  expect(messages).toContain('언제부터 시작됐나요?');
  expect(messages).toContain('지난주부터 시작됐어요');
  expect(messages).toContain('possibilities');
  expect(messages).toContain('priorDialogueOmitted');
});
