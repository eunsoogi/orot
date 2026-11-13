import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

test('a photo-only turn preserves an empty question and requires explicit local consent', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValue(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer: '사진에 합성 문구가 있어요.' },
      citations: ['e1'],
    }),
  );
  const photo = {
    sourceKind: 'personal_record' as const,
    sourceId: 's1',
    sourceRevision: 'sr1',
    evidenceId: 'e1',
    evidenceRevision: 'er1',
    locator: { kind: 'local-evidence', token: 'e1' },
    effectiveTime: null,
    reviewState: 'unreviewed' as const,
    content: '사용자가 현재 대화에 첨부한 사진에서 추출한 글자:\nsynthetic',
  };
  const local = {
    ...photo,
    sourceId: '12345678-1234-4234-8234-123456789abc',
    sourceRevision: `sha256:${'a'.repeat(64)}`,
    evidenceId: 'section',
    locator: {
      kind: 'conversation_photo',
      requestId: 'request',
      sectionId: 'section',
    },
  };
  const consent = jest.fn().mockResolvedValue('authorized');
  const loadCurrentEvidence = jest.fn();
  const search = jest.fn();
  const options = {
    ...f.options,
    question: '',
    photoEvidence: [photo],
    loadCurrentEvidence,
    rag: { search },
    resolveLocalEvidenceIdentity: () => local,
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        allowedScope: { sourceKinds: ['personal_record' as const] },
        consentScope: {
          purpose: 'record_conversation',
          policyVersion: 'v1',
          dataCategories: ['photo_ocr'],
        },
      },
      photoInput: { evidenceIds: ['e1'], consent: { authorize: consent } },
    },
  };
  const outcome = await runRagConversationTurn(options);
  expect(outcome.status).toBe('answer');
  expect(consent).toHaveBeenCalledTimes(1);
  expect(loadCurrentEvidence).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
  const payload = JSON.stringify(f.generate.mock.calls[0]![0].messages);
  const taskMessage = f.generate.mock.calls[0]![0].messages.find(
    (message: { role: string; content: unknown }) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      message.content.includes('attachmentIntent'),
  );
  let taskBody: unknown = taskMessage?.content;
  while (typeof taskBody === 'string') taskBody = JSON.parse(taskBody);
  expect(taskBody).toMatchObject({ question: '' });
  expect(payload).toContain('attachmentIntent');
  expect(payload).toContain('synthetic');
  expect(payload).not.toContain(local.sourceId);
});

test('blank input and missing photo consent never reach a provider', async () => {
  const f = fixture();
  expect(
    await runRagConversationTurn({ ...f.options, question: '' }),
  ).toMatchObject({ status: 'failure', kind: 'validation_failed' });
  expect(f.generate).not.toHaveBeenCalled();
});
