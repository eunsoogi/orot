import { isTypedVisitQuestionRequest } from '../typedVisitQuestionRequest';

test.each([
  '진료 질문을 준비해줘',
  '다음 진료에서 물어볼 질문을 기록과 근거를 바탕으로 준비해 주세요.',
  '다음 진료에서 검사 결과를 확인할 예정이에요. 질문 준비해줘',
  '이번 외래가 잡혀 있어요. 질문 3개 작성해 주세요.',
  '다음 외래에서 의사 선생님께 물어볼 질문 5개 작성해 주세요.',
  '검사 결과 중심으로 이번 진료 질문 목록을 만들어 주세요.',
  '다음 진료에서 물어볼 질문을 만들어 줘. 검사 결과 위주로.',
  '다음 진료 때 물어볼 질문을 검사 결과 위주로 5개 만들어 줄 수 있나요?',
])('recognizes a direct visit-question creation command: %s', request => {
  expect(isTypedVisitQuestionRequest(request)).toBe(true);
});

test.each([
  '다음 진료에서 혈압 검사가 필요한가요?',
  '질문 준비해줘.',
  '다음 진료에서 검사 결과를 확인할까요? 질문 준비해줘.',
  '다음 진료가 없어요. 질문 준비해줘.',
  '진료 질문을 만들지 말고 검사 결과만 설명해 줘.',
  '“진료 질문을 만드는 법을 알려줘”는 자연스러운 표현인가요?',
  '진료 질문은 어떻게 만들어?',
  '진료 질문을 만들어 줬나요?',
  '검사 결과를 정리해 줘.',
  '진료 질문을 만들어 줘. 일일 보고서도 만들어 줘.',
  '진료 질문을 만들어 줘 대신 일반 설명만 해 줘.',
])(
  'does not treat ordinary, quoted, negative or mixed text as creation: %s',
  request => {
    expect(isTypedVisitQuestionRequest(request)).toBe(false);
  },
);
