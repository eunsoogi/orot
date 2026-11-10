import { requestsLiteratureExplanation } from '../literatureIntent';
import { ragConversationTask } from '../task';

test.each([
  '수면에 관한 문헌을 설명해 주세요',
  '논문 찾아서 요약해 줘',
  'Summarize research papers about sleep',
])('identifies an explicit literature request: %s', question => {
  expect(requestsLiteratureExplanation(question)).toBe(true);
  const input = {
    request: question,
    evidence: { items: [], coverage: [], conflicts: [] },
  };
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
      input,
    ).status,
  ).not.toBe('valid');
  expect(
    ragConversationTask.isEvidenceIndependentResult?.(
      { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
      input,
    ),
  ).toBe(false);
  const raw = JSON.stringify({
    type: 'result',
    value: { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
  });
  expect(ragConversationTask.projectStreamedText?.(raw, input)).toBeUndefined();
});

test('does not stream an uncited risk claim for an indirect research question', () => {
  const input = {
    request: '수면과 비만 관련 연구는 어떤가요?',
    evidence: { items: [], coverage: [], conflicts: [] },
  };
  const raw = JSON.stringify({
    type: 'result',
    value: { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
  });
  expect(ragConversationTask.projectStreamedText?.(raw, input)).toBeUndefined();
});

test('does not expose an uncited risk claim for an indirect research question', () => {
  const input = {
    request: '수면과 비만 관련 연구는 어떤가요?',
    evidence: { items: [], coverage: [], conflicts: [] },
  };
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
      input,
    ).status,
  ).not.toBe('valid');
});

test.each([
  '고마워요',
  '논문 찾아줘서 고마워요',
  '내 수면 기록을 요약해 줘',
  'Thank you for the paper',
])(
  'does not treat a greeting or ordinary record question as a literature request: %s',
  question => {
    expect(requestsLiteratureExplanation(question)).toBe(false);
  },
);
