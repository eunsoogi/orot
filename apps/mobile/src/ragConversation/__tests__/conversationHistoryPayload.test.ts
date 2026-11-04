import { conversationHistoryPayload } from '../conversationHistoryPayload';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import { runRagConversationTurn } from '../service';

test('does not resend prior AI prose whose complete source lineage is unavailable', () => {
  const history = conversationHistoryPayload(
    [
      { id: 1, role: 'user', content: '기록을 알려 주세요' },
      { id: 2, role: 'assistant', content: '삭제될 수 있는 합성 건강 정보' },
      {
        id: 3,
        role: 'assistant',
        content: '검증되지 않은 스트림',
        incomplete: true,
      },
    ],
    '다음 질문',
  );
  expect(history).toEqual([
    { role: 'user', content: '기록을 알려 주세요' },
    {
      role: 'assistant',
      content:
        '이전 AI 답변은 현재 출처를 다시 확인하기 전에는 사용할 수 없어요.',
    },
  ]);
  expect(JSON.stringify(history)).not.toContain(
    '삭제될 수 있는 합성 건강 정보',
  );
});

test('the workflow also strips previous assistant prose supplied directly to the service', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer: '네, 말씀해 주세요.' },
      citations: [],
    }),
  );
  await runRagConversationTurn({
    ...f.options,
    previousMessages: [
      { role: 'user', content: '이전 질문' },
      { role: 'assistant', content: '삭제된 출처의 합성 비밀' },
    ],
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.generate.mock.calls[0]?.[0])).not.toContain(
    '삭제된 출처의 합성 비밀',
  );
});
