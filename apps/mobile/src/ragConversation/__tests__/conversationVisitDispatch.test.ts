import {
  startExplicitVisitPreparation,
  sendConversationMessage,
} from '../conversationVisitDispatch';
import { createConversationSessions } from '../conversationSessions';
import { conversationEntryForSession } from '../useConversationEntryIntent';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';

jest.mock('../useConversationEntryIntent', () => ({
  conversationEntryForSession: jest.fn(),
  consumeConversationEntryForSession: jest.fn(),
}));

test('a typed composer turn stays in conversation until the preparation action is pressed', async () => {
  const context = {
    intent: 'visit-questions' as const,
    entryKey: 'entry',
    appointmentId: 'visit',
  };
  jest.mocked(conversationEntryForSession).mockReturnValue(context);
  const store = createConversationSessions();
  store.setDraft(1, '직접 작성한 질문');
  const prepare = jest.fn();
  const send = jest.fn().mockResolvedValue({
    status: 'answer',
    answer: '대화 답변',
    citations: [],
  });

  await sendConversationMessage(store, 1, send, prepare);

  expect(prepare).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(
    '직접 작성한 질문',
    [],
    expect.any(AbortSignal),
    expect.any(Object),
    context,
  );
  store.dispose();
});

test('explicit report selection takes precedence over an earlier visit entry', async () => {
  jest.mocked(conversationEntryForSession).mockReturnValue({
    intent: 'visit-questions',
    entryKey: 'visit',
    appointmentId: 'visit-a',
  });
  const store = createConversationSessions();
  const report = {
    identity: {
      kind: 'daily_report' as const,
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
      key: 'daily-report:2026-11-10@Asia/Seoul',
    },
    runId: 'run',
    revision: 2,
  };
  store.selectDailyReport(1, report);
  store.setDraft(1, '보고서에 대해 질문');
  const send = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  const prepare = jest.fn();
  await sendConversationMessage(store, 1, send, prepare);
  expect(prepare).not.toHaveBeenCalled();
  expect(send.mock.calls[0][4]).toMatchObject({ dailyReport: report });
  expect(store.getSnapshot().sessions[0]?.messages.at(-1)).toMatchObject({
    role: 'assistant',
    dailyReport: report,
  });
  store.dispose();
});

test('storage preflight failure retains visit intent for an edited retry', async () => {
  const fixture = await healthContextFixture();
  try {
    jest.mocked(conversationEntryForSession).mockReturnValue({
      intent: 'visit-questions',
      entryKey: 'entry',
      appointmentId: 'visit',
    });
    let first = true;
    let sequence = 0;
    const storage = createConversationArtifactStorage(fixture.database);
    const retention = createConversationSessionRetention({
      openStorage: async () => {
        if (first) {
          first = false;
          throw new Error('storage unavailable');
        }
        return storage;
      },
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    const prepare = jest
      .fn()
      .mockResolvedValue({ status: 'answer', answer: '준비', citations: [] });
    const onSend = jest.fn();
    store.setEntryPrompt(1, conversationIntentRequests['visit-questions']);
    await startExplicitVisitPreparation(store, 1, prepare);
    expect(prepare).not.toHaveBeenCalled();
    store.setDraft(1, '수정 요청');
    await sendConversationMessage(store, 1, onSend, prepare);
    expect(prepare).toHaveBeenCalledWith(
      '수정 요청',
      expect.any(Array),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.objectContaining({ appointmentId: 'visit' }),
    );
    expect(onSend).not.toHaveBeenCalled();
    store.dispose();
  } finally {
    fixture.close();
  }
});

test('edited initial failure retries preparation then allows an ordinary follow-up', async () => {
  jest.mocked(conversationEntryForSession).mockReturnValue({
    intent: 'visit-questions',
    entryKey: 'entry',
    appointmentId: 'visit',
  });
  const store = createConversationSessions();
  const prepare = jest
    .fn()
    .mockResolvedValueOnce({ status: 'unavailable' })
    .mockResolvedValueOnce({ status: 'answer', answer: '준비', citations: [] });
  const onSend = jest
    .fn()
    .mockResolvedValue({ status: 'answer', answer: '대화', citations: [] });
  store.setEntryPrompt(1, conversationIntentRequests['visit-questions']);
  await startExplicitVisitPreparation(store, 1, prepare);
  store.setDraft(1, '수정 요청');
  await sendConversationMessage(store, 1, onSend, prepare);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenLastCalledWith(
    '수정 요청',
    expect.any(Array),
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ appointmentId: 'visit' }),
  );
  store.setDraft(1, '추가 대화');
  await sendConversationMessage(store, 1, onSend, prepare);
  expect(onSend).toHaveBeenCalledTimes(1);
  store.dispose();
});
