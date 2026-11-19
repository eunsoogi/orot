import {
  fingerprintText,
  stableJson,
} from '../../../aiFeatures/integration/evidenceUtils';
import { immutableReportJson } from '../immutableReportJson';

test('matches canonical bytes for key ordering, escapes and legacy primitive encodings', () => {
  const sparse = Array(4);
  sparse[1] = undefined;
  sparse[2] = null;
  sparse[3] = '';
  const facts = {
    '2': 'second',
    '10': 'tenth',
    ['__proto__']: 'ordinary property',
    ['']: undefined,
    nested: [
      {
        first: 'line\nquote"',
        date: '2026-03-08',
        end: '2026-03-08T05:00:00.0001Z',
      },
      {
        first: 'line\nquote"',
        end: '2026-03-08T05:00:00.0001Z',
        offset: '2026-03-08T00:00:00.0001-05:00',
      },
      { first: '서울', date: '2026-03-08', end: '2026-03-08T05:00:00.0001Z' },
    ],
    numbers: [0, -0, 1e-7, 1e21, 1.2345678901234567, NaN, Infinity, -Infinity],
    values: [
      true,
      false,
      null,
      sparse,
      {},
      { '\u0000': '😀', value: '\ud800' },
    ],
  };
  expect(immutableReportJson(facts)).toBe(stableJson(facts));
});

test('bounds temporary quote reuse without dropping facts from a long report', () => {
  const facts = {
    quantities: Array.from({ length: 4200 }, (_, index) => ({
      firstAt: `2026-03-08T05:00:00.${String(index).padStart(5, '0')}Z`,
      source: 'long '.repeat(20) + index,
      amount: index / 17,
    })),
  };
  expect(immutableReportJson(facts)).toBe(stableJson(facts));
});

test('retains the persisted UTF-16 hash for surrogate pairs and lone surrogates', () => {
  expect(fingerprintText('ASCII 서울 😀 \ud800')).toBe('f5249451d600579d');
});
