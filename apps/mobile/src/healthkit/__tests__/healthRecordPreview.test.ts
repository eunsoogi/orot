import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { selectHealthRecordPreview } from '../healthRecordPreview';

function records(count: number) {
  return Array.from({ length: count }, (_, index) =>
    healthObservation(
      String(index),
      'heart_rate',
      new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    ),
  );
}

test('selects twelve chronological ranks, preserves endpoints and never mutates originals', () => {
  const input = records(100).reverse();
  const before = [...input];
  const selected = selectHealthRecordPreview(input);
  expect(selected.map(record => record.id)).toEqual([
    '0',
    '9',
    '18',
    '27',
    '36',
    '45',
    '54',
    '63',
    '72',
    '81',
    '90',
    '99',
  ]);
  expect(input).toEqual(before);
  expect(selected.every(record => input.includes(record))).toBe(true);
});

test('preserves sparse and single-point records independently for each unit and concept', () => {
  const input = records(30);
  const alternate = {
    ...input[0]!,
    id: 'alternate',
    value: { kind: 'quantity' as const, amount: 1, unit: 'alternate' },
  };
  const differentConcept = { ...input[1]!, id: 'other', concept: 'step_count' };
  expect(
    selectHealthRecordPreview([...input, alternate, differentConcept]),
  ).toHaveLength(14);
  expect(selectHealthRecordPreview([alternate])).toEqual([alternate]);
  expect(selectHealthRecordPreview([])).toEqual([]);
});

test('does not plot invalid dates or nonfinite values', () => {
  const source = records(1)[0]!;
  expect(
    selectHealthRecordPreview([
      { ...source, effectiveAt: 'invalid' },
      {
        ...source,
        value: { kind: 'quantity', amount: NaN, unit: 'count/min' },
      },
    ]),
  ).toEqual([]);
});
