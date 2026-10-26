import { readableHypothesis } from '../readableHypothesis';
import { reference } from '../taskTestSupport';

test.each([
  ['걸음수 32걸음 [e10, e2]', '걸음수 32걸음'],
  [
    '값 [120/80] mmHg, 범위 [60–100], 코드 [E20]',
    '값 [120/80] mmHg, 범위 [60–100], 코드 [E20]',
  ],
  ['원문 [2026-10-20] 및 [1, 2] 보존', '원문 [2026-10-20] 및 [1, 2] 보존'],
  ['혼합된 원문 [e1, vitamin D] 보존', '혼합된 원문 [e1, vitamin D] 보존'],
  ['알 수 없는 ID [MED:999] 보존', '알 수 없는 ID [MED:999] 보존'],
])('formats only citation groups in %s', (summary, expected) => {
  const item = {
    title: '요약',
    summary,
    supportingEvidence: [reference],
    contraryEvidence: [],
    uncertainty: '',
    missingData: [],
  };
  const result = readableHypothesis(item);
  expect(result.summary).toBe(expected);
  expect(result.supportingEvidence).toBe(item.supportingEvidence);
  expect(item.summary).toBe(summary);
});
