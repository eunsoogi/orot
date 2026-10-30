import { isRagConversationAvailabilityQuestion } from '../availabilityIntent';

test.each([
  '앱에서 어떤 건강 기록을 볼 수 있어요?',
  '연동된 건강 데이터가 있나요?',
  '저장된 혈압 기록을 확인할 수 있나요?',
  'What health records are available in the app?',
  'Can you see my Apple Health data?',
  'Do I have any symptom records saved here?',
])('recognizes a Korean or English availability question: %s', question => {
  expect(isRagConversationAvailabilityQuestion(question)).toBe(true);
});

test.each([
  '어제 혈압 수치가 얼마였나요?',
  '내 건강 데이터를 요약해 주세요.',
  'Is my blood pressure normal?',
  'Can you see whether my blood pressure is normal?',
  'Can you check my health data from last month?',
  'How many steps did I take today?',
  '어떤 건강 문제가 있는지 알려줘',
  'What does my health data stored here say about my blood pressure?',
])(
  'leaves a clinical data request on the grounded answer path: %s',
  question => {
    expect(isRagConversationAvailabilityQuestion(question)).toBe(false);
  },
);
