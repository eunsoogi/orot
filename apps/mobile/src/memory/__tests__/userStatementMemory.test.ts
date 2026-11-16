import {
  conversationStatementMemory,
  manualHistoryMemory,
} from '../userStatementMemory';
import { createManualHistoryEntry } from '@orot/domain';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
const turn: ConversationArtifact = {
  id: 'synthetic-turn',
  sessionId: 'synthetic-session',
  providerId: 'synthetic',
  modelId: 'synthetic',
  createdAt: '2026-11-01T10:00:00.000Z',
  status: 'complete',
  question: '저는 짧은 설명을 선호합니다',
  answer: 'Synthetic answer that must never become memory',
  sources: [],
};
export { turn };
test('exact authored preference has dated unreviewed lineage and excludes assistant prose', () => {
  const result = conversationStatementMemory(turn)!;
  expect(result.kind).toBe('preference');
  expect(result.text).toContain(turn.question);
  expect(result.text).not.toContain(turn.answer);
  expect(result.provenance).toMatchObject({
    reviewState: 'user_stated',
    sourceIds: [turn.id],
    sourceDates: [{ sourceId: turn.id, date: turn.createdAt }],
  });
});
test.each([
  '제 증상은 어떤 병인가요?',
  '내가 만약 수술을 했다면 설명해요',
  '제 친구는 아프다고 했어요',
  '저는 "의사가 약을 끊으라고 했다"고 말했어요',
  '저는 이것을 기억하지 말아 주세요',
  '진료 질문 준비하기',
])(
  'does not convert questions, quoted/third-party or hypothetical text into facts: %s',
  question => {
    expect(conversationStatementMemory({ ...turn, question })).toBeUndefined();
  },
);
test('dated health uncertainty and negation remain verbatim, not a current diagnosis', () => {
  const question = '저는 어제 잠깐 어지러웠지만 지금은 없어요';
  expect(conversationStatementMemory({ ...turn, question })?.text).toContain(
    question,
  );
  expect(conversationStatementMemory({ ...turn, question })?.text).toContain(
    '현재 상태나 의학적으로 확인된 사실이 아님',
  );
  expect(
    conversationStatementMemory({ ...turn, status: 'partial' }),
  ).toBeUndefined();
});
test('legacy history projection preserves unknown event date and correction source', () => {
  const source = createManualHistoryEntry({
    id: 'legacy',
    title: 'Synthetic history',
    kind: 'note',
    details: 'Maybe, not confirmed.',
    effectiveDate: { status: 'unknown' },
    recordedAt: turn.createdAt,
    supersedesId: 'prior',
  });
  const projected = manualHistoryMemory(source);
  expect(projected.text).toContain('발생일: 알 수 없음');
  expect(projected.text).toContain(source.details);
  expect(projected.provenance.sourceReferences).toEqual([
    { kind: 'manual_history', id: source.id },
  ]);
});

test('Korean omitted-speaker reports keep uncertainty and punctuation verbatim', () => {
  const question = '어제 운동 뒤에는 잠깐 어지러웠어요.';
  expect(conversationStatementMemory({ ...turn, question })?.text).toContain(
    question,
  );
  expect(
    conversationStatementMemory({
      ...turn,
      question: '오늘 혈압이 높다면 어떤 병인가요?',
    }),
  ).toBeUndefined();
  expect(
    conversationStatementMemory({
      ...turn,
      question: '제 혈압에 대해 알려줘요',
    }),
  ).toBeUndefined();
});

test.each([
  '제 혈압은 정상인가요',
  '저는 왜 계속 피곤한가요',
  'I have a friend who has diabetes.',
  'I have diabetes. Do not remember this.',
  'I have diabetes but do not save this.',
  'I have a mother with allergies.',
  'I have diabetes if this is a hypothetical example.',
  '제 엄마는 어제 아팠어요',
])(
  'does not auto-store interrogative, third-party, hypothetical or opted-out text: %s',
  question => {
    expect(conversationStatementMemory({ ...turn, question })).toBeUndefined();
  },
);
