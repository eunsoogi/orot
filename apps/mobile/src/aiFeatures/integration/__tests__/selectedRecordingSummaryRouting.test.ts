import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';

const memoryQuestion = '기억해 줘: 합성 프로젝트 데모는 금요일이에요.';
const session = {
  inputOrigin: 'composer',
  retentionSession: { id: 'synthetic-session', version: 0 },
  retentionRequestId: 'synthetic-request',
} as const;
const selected = {
  sourceId: 'synthetic-recording',
  signal: new AbortController().signal,
  isCurrent: () => true,
};
const typedTarget = {
  intent: 'health-summary',
  entryKey: 'synthetic-target',
} as const;

function fixture() {
  const downstream = jest.fn(async () => ({ status: 'no_evidence' as const }));
  const save = jest.fn(async () => 'local-only-key');
  const { sendRagMessage } = createConversationSummaryIntegration({
    consent: { authorize: jest.fn() },
    dependencies: {},
    loadData: jest.fn(async () => ({ saveConversationHistory: save }) as never),
    selectedAi: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    diseaseRunner: jest.fn(),
    sendRagMessage: downstream,
    loadSavedVisitQuestions: jest.fn(),
  });
  return { sendRagMessage, save, downstream };
}

it('attached questions reach only the closed recording route even with a leftover typed target', async () => {
  const f = fixture();
  const observer: RagConversationObserver = {
    ...session,
    selectedRecordingTranscript: selected,
  };
  expect(
    await f.sendRagMessage(
      'What is in this recording?',
      [],
      undefined,
      observer,
      typedTarget,
    ),
  ).toEqual({ status: 'no_evidence' });
  expect(f.downstream).toHaveBeenCalledWith(
    'What is in this recording?',
    [],
    undefined,
    observer,
    typedTarget,
  );
  expect(f.save).not.toHaveBeenCalled();
});

it('never transmits or silently saves an explicitly local memory command', async () => {
  const f = fixture();
  const controller = new AbortController();
  const active: RagConversationObserver = {
    ...session,
    selectedRecordingTranscript: selected,
  };
  expect(
    await f.sendRagMessage(memoryQuestion, [], controller.signal, active),
  ).toEqual({ status: 'failure', kind: 'validation_failed' });
  expect(f.downstream).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(
    await f.sendRagMessage(memoryQuestion, [], controller.signal, session),
  ).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('저장하지 않았어요'),
  });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.downstream).not.toHaveBeenCalled();
});
