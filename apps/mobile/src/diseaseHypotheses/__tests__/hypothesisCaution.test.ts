import { diseaseHypothesisTask } from '../task';
import { evidence, hypothesis } from '../taskTestSupport';

test.each([
  '현재 기록만으로 확진할 수는 없어요.',
  '확진 여부는 추가 진료에서 확인해야 해요.',
  '확진을 위해 추가 검사가 필요해요.',
  'These findings cannot be confirmed from the current records.',
])('accepts an explicit diagnostic limitation: %s', summary => {
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis({ summary })] },
      { request: '합성 가능성 검토', evidence },
    ).status,
  ).toBe('valid');
});

test.each([
  '확진할 수는 없지만 당뇨로 진단되었습니다.',
  '확진을 위한 검사가 필요하지만 분명히 당뇨입니다.',
  'These findings cannot be confirmed, but you definitely have diabetes.',
  'Diabetes is confirmed.',
])('rejects a diagnosis claim beside a limitation: %s', summary => {
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis({ summary })] },
      { request: '합성 가능성 검토', evidence },
    ).status,
  ).toBe('invalid');
});
