import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence } from '../taskTestSupport';

test('projects every safe summary topic rather than only the medication section', () => {
  const project = symptomSummaryTask.projectStreamedText!;
  const raw = JSON.stringify({
    type: 'result',
    value: {
      sections: [
        { summary: '예시약이 등록됐어요.' },
        { summary: '심박수는 76회/분이에요.' },
        { summary: '깊은 수면 구간이 기록됐어요.' },
      ],
    },
  });
  expect(project(raw, { request: '기록 요약', evidence })).toBe(
    '예시약이 등록됐어요.\n\n심박수는 76회/분이에요.\n\n깊은 수면 구간이 기록됐어요.',
  );
});

test('keeps the existing certainty and per-section length guard on every projected topic', () => {
  const raw = JSON.stringify({
    type: 'result',
    value: {
      sections: [
        { summary: '확진된 질환입니다.' },
        { summary: '가'.repeat(1201) },
        { summary: '걸음 기록이 있어요.' },
      ],
    },
  });
  expect(
    symptomSummaryTask.projectStreamedText!(raw, {
      request: '기록 요약',
      evidence,
    }),
  ).toBe('걸음 기록이 있어요.');
});
