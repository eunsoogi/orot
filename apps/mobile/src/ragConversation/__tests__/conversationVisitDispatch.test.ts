import {
  sendConversationMessage,
  shouldPrepareVisitQuestions,
} from '../conversationVisitDispatch';
import { createConversationSessions } from '../conversationSessions';
import { conversationEntryForSession } from '../useConversationEntryIntent';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

jest.mock('../useConversationEntryIntent', () => ({
  conversationEntryForSession: jest.fn(),
}));

test('visit entry prepares only its first turn, while follow-ups stay conversation turns', () => {
  const entry = {
    intent: 'visit-questions' as const,
    entryKey: 'entry',
    appointmentId: 'visit',
  };
  expect(shouldPrepareVisitQuestions(entry, [])).toBe(true);
  expect(
    shouldPrepareVisitQuestions(entry, [
      { role: 'user', content: '이전 요청' },
    ]),
  ).toBe(false);
  expect(
    shouldPrepareVisitQuestions(
      { intent: 'conversation', entryKey: 'other' },
      [],
    ),
  ).toBe(false);
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
    store.setDraft(1, '처음 요청');
    await sendConversationMessage(store, 1, onSend, prepare);
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
  store.setDraft(1, '처음 요청');
  await sendConversationMessage(store, 1, onSend, prepare);
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
