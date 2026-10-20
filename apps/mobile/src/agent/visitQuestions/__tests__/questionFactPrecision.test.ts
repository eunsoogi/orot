import {
  hasUnsupportedDateOrValue,
  unsupportedDateOrValueKind,
} from '../questionFacts';
import { preparedContext } from '../testing/workflowFixtures';

const evidence = (content: string) => [
  { ...preparedContext().initialEvidence, content },
];

test.each([
  ['평균 혈압 122 mmHg', '121.53 mmHg', 'quantity_precision'],
  ['평균 혈압 121.5 mmHg', '121.53 mmHg', 'quantity_precision'],
  ['평균 혈압 121.53 mmHg', '121.534 mmHg', 'quantity_precision'],
  ['수면 평균 6.25시간', '375분', 'quantity_unit'],
  ['수면 평균 6시간', '375분', 'quantity_unit'],
  ['수면 평균 6.3시간', '375분', 'quantity_unit'],
  ['수면 평균 390분', '6.5시간', 'quantity_unit'],
])(
  'diagnoses but still rejects a transformed number: %s',
  (claim, content, category) => {
    const sources = evidence(content);
    expect(hasUnsupportedDateOrValue(claim, sources)).toBe(true);
    expect(unsupportedDateOrValueKind(claim, sources)).toBe(category);
  },
);

test.each([
  ['평균 혈압 130 mmHg', '121.53 mmHg'],
  ['복용량 6 mg', '5 mg'],
  ['측정값 121.5', '121.53'],
])(
  'keeps unrelated or unlabelled numbers in the value category: %s',
  (claim, content) => {
    expect(unsupportedDateOrValueKind(claim, evidence(content))).toBe(
      'quantity_value',
    );
  },
);

test.each([
  ['평균 혈압 121.53 mmHg', '121.53 mmHg'],
  ['수면 평균 375분', '375분'],
])('keeps an exact source value accepted: %s', (claim, content) => {
  expect(hasUnsupportedDateOrValue(claim, evidence(content))).toBe(false);
});
